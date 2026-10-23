// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Anonymous usage and crash reports, and the diagnostics a writer controls
//! (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D100).
//!
//! **Your plays and files stay on your Mac.** What leaves it is a handful of
//! facts — which version, which features get used, when it crashed — and only
//! while Settings › Privacy says so.
//!
//! - [`allowlist`] — every address the app reaches or opens in the browser.
//! - `events` — the closed set of events, and what each carries.
//! - `active` — what a copy remembers of the periods it has counted itself in.
//! - `client` — the daily-count batch protocol, and the bounded queue in front of it.
//! - `crash` — crash files, from panics and from page errors.
//! - `errors` — the local log of error codes the app showed.
//! - `diagnostics` — Copy Diagnostics and feedback details.
//!
//! **The switch** is "Share anonymous usage and crash reports" (`shareAnalytics`,
//! on unless switched off). Off, nothing is queued, and whatever was waiting is
//! dropped without being sent; `update_settings` calls [`settings_changed`] the
//! moment it changes. Crash files and the error log are kept either way — they
//! leave only under the reports gates or in feedback the writer chooses to send.
//!
//! **The page cannot send.** Events go out from here only. The page may ask for
//! the few events only it sees happen (`events::PageEvent`, a closed enum) and
//! may report a closed error name and numeric stack frames; no command takes free text, and
//! the page holds no key and no address.
//!
//! **When.** The first flush waits a minute, so a writer who reads the Welcome
//! screen's notice and switches reports off at once sends nothing — not even
//! this launch. After that the queue is flushed once a minute if something new
//! was recorded, and once more when the app quits normally with the switch on.
//! Only a distribution build enables reports; development and local installs send nothing.

mod active;
pub mod allowlist;
pub(crate) mod client;
mod crash;
mod diagnostics;
mod envelope;
mod errors;
mod events;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::settings::Settings;
use client::{Client, Context, Outcome, Pending, Queue};
use events::{Channel, Event, PageEvent, Period, Surface, Version};

/// In app data: crash files, one per crash.
pub(crate) const CRASH_DIR: &str = "crashes";
/// In app data: the error codes the app showed.
pub(crate) const ERROR_LOG: &str = "error-codes.json";
/// In app data: the version that ran last, for `update_installed`.
const LAST_VERSION: &str = "last-version";

const FIRST_FLUSH_AFTER: Duration = Duration::from_secs(60);
const FLUSH_EVERY: Duration = Duration::from_secs(60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// A normal quit waits this long at most for the last flush.
const QUIT_TIMEOUT: Duration = Duration::from_secs(2);

pub struct Telemetry {
    /// None unless this distribution build explicitly enables reports.
    client: Option<Client>,
    context: Context,
    data_dir: Option<PathBuf>,
    state: Mutex<State>,
    /// When this launch began: the quit flush honours the first minute too.
    started: std::time::Instant,
    sending: Mutex<()>,
}

#[derive(Default)]
struct State {
    on: bool,
    notice_seen: bool,
    /// Bumped every time the switch goes off. A batch taken out of the queue
    /// before that is not sent after it, and its crash files are not deleted
    /// as sent.
    consent: u64,
    queue: Queue,
    crashes: std::collections::VecDeque<(PathBuf, crash::CrashRecord)>,
    /// Something was recorded since the last flush.
    fresh: bool,
    /// Surfaces already reported this launch: once each is enough to know a
    /// feature is used, and more would say how the writer works.
    shown: HashSet<Surface>,
    /// The periods this copy has counted itself in (active.rs); none without
    /// a data folder to remember them in, and then no `copy_active` at all.
    active: Option<active::Counted>,
}

/// A `copy_active` whose period has ended: the service would count it in the
/// period it arrives in, so it is never sent (active.rs).
fn stale(pending: &Pending, now: chrono::DateTime<chrono::Utc>) -> bool {
    matches!(pending.event, Event::CopyActive { period, .. } if period.of(pending.at) != period.of(now))
}

impl Telemetry {
    fn state(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A test build queues as a distribution build with reports compiled in
    /// would, and never sends: it has no client to send with
    /// (selftest_fixture.rs reads the queue).
    fn records(&self) -> bool {
        self.client.is_some() || cfg!(feature = "selftest")
    }

    fn record(&self, event: Event) {
        if !self.records() {
            return;
        }
        let mut state = self.state();
        if !state.on {
            return;
        }
        if let Event::SurfaceShown { surface } = &event {
            if !state.shown.insert(*surface) {
                return;
            }
        }
        state.queue.push(Pending {
            event,
            at: chrono::Utc::now(),
        });
        state.fresh = true;
    }

    /// One `copy_active` for each period `now` falls in that this copy has not
    /// counted itself in, unless one already waits for it. At launch, and each
    /// minute after, so a copy left open past midnight, into a new week or a
    /// new month counts itself there too.
    fn count_active(&self, now: chrono::DateTime<chrono::Utc>) {
        if !self.records() {
            return;
        }
        let mut guard = self.state();
        let state = &mut *guard;
        let Some(counted) = state.active.as_mut() else {
            return;
        };
        if !state.on {
            return;
        }
        let installed = counted.installed(now);
        for period in counted.due(now) {
            let waiting = state.queue.holds(|p| {
                matches!(p.event, Event::CopyActive { period: q, .. } if q == period && period.of(p.at) == period.of(now))
            });
            if !waiting {
                state.queue.push(Pending {
                    event: Event::CopyActive { period, installed },
                    at: now,
                });
                state.fresh = true;
            }
        }
    }

    /// The service answered a batch: each period it counted this copy in is
    /// written down. A batch it refused spends them too, so a refusal is not
    /// asked again each minute.
    fn counted(&self, batch: &[Pending]) {
        let marks: Vec<(Period, chrono::DateTime<chrono::Utc>)> = batch
            .iter()
            .filter_map(|p| match p.event {
                Event::CopyActive { period, .. } => Some((period, p.at)),
                _ => None,
            })
            .collect();
        if marks.is_empty() {
            return;
        }
        let mut state = self.state();
        let Some(counted) = state.active.as_mut() else {
            return;
        };
        for (period, at) in marks {
            counted.mark(period, at);
        }
        if let Some(dir) = &self.data_dir {
            counted.save(&dir.join(active::FILE));
        }
    }

    fn set_on(&self, on: bool) {
        let mut state = self.state();
        state.on = on;
        if !on {
            state.queue.clear();
            state.crashes.clear();
            state.fresh = false;
            state.consent += 1;
        }
    }

    fn queue_crash(&self, file: PathBuf, record: crash::CrashRecord) {
        let mut state = self.state();
        if self.client.is_none() || !state.on || !record.recent(chrono::Utc::now()) {
            return;
        }
        while state.crashes.len() >= crash::KEPT {
            state.crashes.pop_front();
        }
        state.crashes.push_back((file, record));
        state.fresh = true;
    }

    /// One bounded flush. A quit does not wait behind the scheduled sender.
    fn flush(&self, timeout: Duration, quitting: bool) {
        if self.started.elapsed() < FIRST_FLUSH_AFTER {
            return;
        }
        let Some(client) = &self.client else {
            return;
        };
        let Ok(_sender) = self.sending.try_lock() else {
            return;
        };
        let deadline = std::time::Instant::now() + timeout;
        {
            let mut state = self.state();
            if !state.on || !state.notice_seen || (!quitting && !state.fresh) {
                return;
            }
            state.fresh = false;
        }
        loop {
            let Some(left) = deadline
                .checked_duration_since(std::time::Instant::now())
                .filter(|d| !d.is_zero())
            else {
                return;
            };
            let (batch, crash, consent) = {
                let mut state = self.state();
                if !state.on || !state.notice_seen {
                    return;
                }
                let now = chrono::Utc::now();
                state.crashes.retain(|(_, r)| r.recent(now));
                state.queue.retain(|p| !stale(p, now));
                let batch = state.queue.take_batch(now);
                let crash = if batch.is_empty() {
                    state.crashes.pop_front()
                } else {
                    None
                };
                (batch, crash, state.consent)
            };
            if batch.is_empty() && crash.is_none() {
                return;
            }
            if self.state().consent != consent {
                return;
            }
            let outcome = if let Some((_, record)) = &crash {
                match envelope::encode(record) {
                    Some(bytes) => tauri::async_runtime::block_on(client.send_crash(bytes, left)),
                    None => Outcome::Refused,
                }
            } else {
                tauri::async_runtime::block_on(
                    client.send(client::body(&batch, &self.context), left),
                )
            };
            match outcome {
                Outcome::Sent => {
                    self.counted(&batch);
                    if self.state().consent == consent {
                        if let Some((file, _)) = &crash {
                            let _ = std::fs::remove_file(file);
                        }
                    }
                }
                Outcome::Wait => {
                    let mut state = self.state();
                    if state.on && state.consent == consent {
                        if let Some(crash) = crash {
                            state.crashes.push_front(crash);
                        } else {
                            state.queue.put_back(batch);
                        }
                    }
                    return;
                }
                Outcome::Refused => {
                    self.counted(&batch);
                    return;
                }
            }
        }
    }
}

/// First thing in `run()`: crash files for panics from here on.
pub fn install_panic_hook() {
    crash::install_hook();
}

/// From setup: what this launch says, and the schedule that sends it.
pub fn setup(app: &AppHandle) {
    // The whole version (version.rs): a release's `X.Y.Z`, which is its
    // package's, or a track build's `X.Y.Z-beta.N`, so the service counts a
    // beta's reports apart from the release's
    // (docs/engineering/services-and-feedback.md#SERV-272).
    let version = crate::version::whole(app);
    let data_dir = app.path().app_data_dir().ok();
    let (os_name, os_version) = operating_system();
    if let Some(dir) = &data_dir {
        crash::set_target(
            dir.join(CRASH_DIR),
            version.clone(),
            client::os_version(&os_version),
            std::env::consts::ARCH.into(),
        );
    }
    let settings = crate::settings::current(app);
    let client = Client::of_this_build();
    // What the copy has counted of itself, only where it could send or queue.
    let active = data_dir
        .as_ref()
        .filter(|_| client.is_some() || cfg!(feature = "selftest"))
        .map(|dir| {
            let now = chrono::Utc::now();
            active::Counted::load(&dir.join(active::FILE), active::first_ran(dir, now))
        });
    let telemetry = Telemetry {
        client,
        context: Context {
            app_version: version.clone(),
            os_name,
            os_version,
            arch: std::env::consts::ARCH,
            channel: Channel::of_this_build(),
        },
        data_dir: data_dir.clone(),
        state: Mutex::new(State {
            on: settings.share_analytics,
            notice_seen: settings.privacy_notice_seen,
            active,
            ..State::default()
        }),
        started: std::time::Instant::now(),
        sending: Mutex::new(()),
    };

    telemetry.record(Event::AppLaunched);
    telemetry.count_active(chrono::Utc::now());
    if let Some(dir) = &data_dir {
        if let Some((from, to)) = version_change(&dir.join(LAST_VERSION), &version) {
            telemetry.record(Event::UpdateInstalled { from, to });
        }
        for (file, record) in crash::read_all(&dir.join(CRASH_DIR)) {
            telemetry.queue_crash(file, record);
        }
    }
    let sends = telemetry.client.is_some();
    app.manage(telemetry);

    if sends {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(FIRST_FLUSH_AFTER);
            loop {
                let telemetry = app.state::<Telemetry>();
                telemetry.count_active(chrono::Utc::now());
                telemetry.flush(REQUEST_TIMEOUT, false);
                std::thread::sleep(FLUSH_EVERY);
            }
        });
    }
}

/// `update_settings` changed the settings: the switch takes effect now.
pub fn settings_changed(app: &AppHandle, settings: &Settings) {
    if let Some(telemetry) = app.try_state::<Telemetry>() {
        telemetry.set_on(settings.share_analytics);
        telemetry.state().notice_seen = settings.privacy_notice_seen;
    }
}

/// The app is quitting normally: one last flush, briefly, if reports are on —
/// and only once the first minute has passed. A launch that ends inside it
/// sends nothing, the same as one that stays open: the minute
/// is the writer's time to read the notice and say no.
pub fn on_exit(app: &AppHandle) {
    if let Some(telemetry) = app.try_state::<Telemetry>() {
        telemetry.flush(QUIT_TIMEOUT, true);
    }
}

/// The switch went off: what was waiting is dropped, and what was already
/// taken out to send is not sent (see [`Telemetry::flush`]).
pub fn switched_off(app: &AppHandle) {
    if let Some(telemetry) = app.try_state::<Telemetry>() {
        telemetry.set_on(false);
    }
}

/// The version that ran last, replaced by this one; the pair when they differ
/// and both are releases. A move to or from a track build is kept, and not
/// reported: `update_installed` names releases alone.
fn version_change(file: &Path, now: &str) -> Option<(Version, Version)> {
    let before = std::fs::read_to_string(file)
        .ok()
        .map(|s| s.trim().to_string());
    if before.as_deref() != Some(now) {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = crate::store::write_atomic(file, now.as_bytes());
    }
    let from = Version::parse(before.as_deref()?)?;
    let to = Version::parse(now)?;
    (from != to).then_some((from, to))
}

/// The operating system's name and version, as every event carries them.
#[cfg(target_os = "macos")]
pub(crate) fn operating_system() -> (&'static str, String) {
    let v = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    let version = if v.patchVersion > 0 {
        format!("{}.{}.{}", v.majorVersion, v.minorVersion, v.patchVersion)
    } else {
        format!("{}.{}", v.majorVersion, v.minorVersion)
    };
    ("macOS", version)
}

/// Windows' version and build, `10.0.<build>`, from where Windows keeps them
/// (`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`): the build is what
/// tells Windows 11 (22000 and later) from Windows 10. Never the monthly patch
/// number, which says more about a PC than a report needs
/// (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-15).
#[cfg(windows)]
pub(crate) fn operating_system() -> (&'static str, String) {
    use crate::registry::{dword, string, Root};
    let at = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    let version = match (
        dword(Root::Machine, at, "CurrentMajorVersionNumber"),
        dword(Root::Machine, at, "CurrentMinorVersionNumber"),
        string(Root::Machine, at, "CurrentBuildNumber"),
    ) {
        (Some(major), Some(minor), Some(build))
            if !build.is_empty() && build.bytes().all(|b| b.is_ascii_digit()) =>
        {
            format!("{major}.{minor}.{build}")
        }
        _ => String::new(),
    };
    ("Windows", version)
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(crate) fn operating_system() -> (&'static str, String) {
    (std::env::consts::OS, String::new())
}

/// One system's version for the tests, as the system says it and as a
/// report sends it: a Mac's `15.6.1` sends `15.6`, Windows' `10.0.26100`
/// sends itself.
#[cfg(test)]
pub(crate) mod example {
    pub const NAME: &str = if cfg!(windows) { "Windows" } else { "macOS" };
    pub const FULL: &str = if cfg!(windows) {
        "10.0.26100"
    } else {
        "15.6.1"
    };
    pub const SENT: &str = if cfg!(windows) { "10.0.26100" } else { "15.6" };
    /// What Copy Diagnostics says of the system and its chip.
    pub const LINE: &str = if cfg!(windows) {
        "Windows 10.0.26100, Arm64 (aarch64)"
    } else {
        "macOS 15.6.1, Apple silicon (aarch64)"
    };
    pub const SYSTEM: &str = if cfg!(windows) {
        "Windows 10.0.26100"
    } else {
        "macOS 15.6.1"
    };
}

/// The platform every report and the update check name: `darwin` or `windows`.
pub(crate) const fn platform() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else {
        "darwin"
    }
}

fn with_telemetry<T>(app: &AppHandle, f: impl FnOnce(&Telemetry) -> T) -> Option<T> {
    app.try_state::<Telemetry>().map(|t| f(&t))
}

/// The events only the page sees happen. An error shown is also kept in the
/// local error log, whatever the switch says.
#[tauri::command]
pub async fn telemetry_record(app: AppHandle, event: PageEvent) {
    #[cfg(feature = "selftest")]
    if let Ok(asked) = serde_json::to_value(&event) {
        crate::selftest_fixture::page_asked(asked);
    }
    with_telemetry(&app, |telemetry| {
        if let (PageEvent::ErrorShown { code }, Some(dir)) = (&event, &telemetry.data_dir) {
            let _ = errors::append(&dir.join(ERROR_LOG), *code, chrono::Utc::now());
        }
        telemetry.record(event.into());
    });
}

/// The error codes the local log holds, oldest first, once for each time one
/// was shown: what a test build's checks read back (selftest_fixture.rs), as
/// the in-memory vault keeps every code the page records.
#[cfg(feature = "selftest")]
pub(crate) fn shown_errors(app: &AppHandle) -> Vec<String> {
    let Some(dir) = with_telemetry(app, |telemetry| telemetry.data_dir.clone()).flatten() else {
        return Vec::new();
    };
    errors::read(&dir.join(ERROR_LOG))
        .into_iter()
        .flat_map(|entry| std::iter::repeat(entry.code).take(entry.count as usize))
        .collect()
}

/// The switch as the backend holds it, and what waits to be sent: what a test
/// build's checks read back (selftest_fixture.rs).
#[cfg(feature = "selftest")]
pub(crate) fn queue_for_check(app: &AppHandle) -> (bool, Vec<String>) {
    with_telemetry(app, |telemetry| {
        let state = telemetry.state();
        (state.on, state.queue.described())
    })
    .unwrap_or_default()
}

/// A page error: a closed failure kind and bounded numeric stack frames only.
#[tauri::command]
pub async fn telemetry_page_error(app: AppHandle, name: String, frames: Vec<crash::PageFrame>) {
    #[cfg(feature = "selftest")]
    crate::selftest_fixture::page_error(&name, frames.len());
    with_telemetry(&app, |telemetry| {
        if let Some(dir) = &telemetry.data_dir {
            let _ =
                crash::write_page_error(&dir.join(CRASH_DIR), &name, frames, &telemetry.context);
        }
    });
}

fn diagnostics_text(app: &AppHandle, formats_in_use: &[String]) -> Result<String, String> {
    let telemetry = app
        .try_state::<Telemetry>()
        .ok_or("diagnostics are not ready yet")?;
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let data_dir = telemetry
        .data_dir
        .clone()
        .ok_or("the app has no data folder")?;
    let home = crate::real_home();
    let is_icloud_item = |path: &Path| crate::scope::is_icloud_item(&path.to_string_lossy());
    let os = format!(
        "{} {}",
        telemetry.context.os_name, telemetry.context.os_version
    );
    let facts = diagnostics::gather(&diagnostics::Sources {
        config_dir: &config_dir,
        data_dir: &data_dir,
        home: &home,
        is_icloud_item: &is_icloud_item,
        formats_in_use,
        // The whole version: a track build's pre-release is what tells two copies apart.
        version: &crate::version::whole(app),
        channel: Channel::of_this_build(),
        arch: telemetry.context.arch,
        os: &os,
        can_send: telemetry.client.is_some(),
    });
    Ok(diagnostics::text(&facts))
}

/// Where this copy came from, as Copy Diagnostics names it: `developer-id`,
/// `app-store` or `local` on a Mac; `download`, `microsoft-store` or `local`
/// on Windows.
pub fn channel() -> &'static str {
    Channel::of_this_build().as_str()
}

#[tauri::command]
pub fn telemetry_configured(app: AppHandle) -> bool {
    // A build with a key, or without one, as a check stands in for it
    // (selftest_fixture.rs): a test build's own has none.
    #[cfg(feature = "selftest")]
    if let Some(keyed) = crate::selftest_fixture::staged_key() {
        return keyed;
    }
    with_telemetry(&app, |t| t.client.is_some()).unwrap_or(false)
}

/// Gather locally; feedback works even when this collection fails.
#[tauri::command]
pub async fn diagnostics_review(
    app: AppHandle,
    formats_in_use: Vec<String>,
) -> Result<String, String> {
    // Details a check has made unavailable (selftest_fixture.rs).
    #[cfg(feature = "selftest")]
    if crate::selftest_fixture::details_fail() {
        return Err("Unavailable".into());
    }
    diagnostics_text(&app, &formats_in_use)
}

pub(crate) fn copy_text(app: &AppHandle, text: &str) -> Result<(), String> {
    diagnostics::copy_to_clipboard(app, text)
}

/// Help › Copy Diagnostics: the text on the clipboard, and back to the page to
/// say what was copied.
#[tauri::command]
pub async fn diagnostics_copy(
    app: AppHandle,
    formats_in_use: Vec<String>,
) -> Result<String, String> {
    let text = diagnostics_text(&app, &formats_in_use)?;
    diagnostics::copy_to_clipboard(&app, &text)?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use events::{ErrorCode, PlaysBucket};
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    /// A server on this machine that answers every request with `status` and
    /// reports each body it received.
    fn server(status: u16) -> (String, mpsc::Receiver<String>) {
        server_with_delay(status, Duration::ZERO)
    }

    fn server_with_delay(status: u16, delay: Duration) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/events", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { return };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = v.trim().parse().unwrap();
                    }
                    if line == "\r\n" {
                        break;
                    }
                }
                let mut body = vec![0; length];
                let _ = reader.read_exact(&mut body);
                if tx.send(String::from_utf8(body).unwrap()).is_err() {
                    return;
                }
                std::thread::sleep(delay);
                let mut stream = stream;
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                );
            }
        });
        (url, rx)
    }

    fn telemetry(url: &str, on: bool) -> Telemetry {
        Telemetry {
            client: Client::to(url.to_string(), url.to_string()),
            context: Context {
                app_version: "1.0.0".into(),
                os_name: "macOS",
                os_version: example::SENT.into(),
                arch: "aarch64",
                channel: Channel::DeveloperId,
            },
            data_dir: None,
            state: Mutex::new(State {
                on,
                notice_seen: true,
                ..State::default()
            }),
            started: std::time::Instant::now() - FIRST_FLUSH_AFTER,
            sending: Mutex::new(()),
        }
    }

    fn events_in(body: &str) -> Vec<String> {
        let sent: serde_json::Value = serde_json::from_str(body).unwrap();
        sent["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["name"].as_str().unwrap().to_string())
            .collect()
    }

    const WAIT: Duration = Duration::from_secs(5);

    #[test]
    fn scheduled_and_quit_flushes_wait_for_the_notice_and_grace() {
        for quitting in [false, true] {
            let (url, received) = server(200);
            let mut t = telemetry(&url, true);
            t.state().notice_seen = false;
            t.record(Event::AppLaunched);
            t.flush(WAIT, quitting);
            assert!(received.recv_timeout(Duration::from_millis(100)).is_err());
            assert_eq!(t.state().queue.len(), 1);
            assert!(t.state().fresh);

            t.state().notice_seen = true;
            t.started = std::time::Instant::now();
            t.flush(WAIT, quitting);
            assert!(received.recv_timeout(Duration::from_millis(100)).is_err());
            assert_eq!(t.state().queue.len(), 1);

            t.started -= FIRST_FLUSH_AFTER;
            t.flush(WAIT, quitting);
            assert_eq!(
                events_in(&received.recv_timeout(WAIT).unwrap()),
                ["app_launched"]
            );
        }
    }

    #[test]
    fn switching_off_drops_what_waits_and_sends_nothing() {
        let (url, received) = server(200);
        let t = telemetry(&url, true);
        t.record(Event::FormatSaved);
        t.record(Event::ErrorShown {
            code: ErrorCode::Save,
        });
        t.set_on(false);
        t.flush(WAIT, true);
        t.record(Event::FormatSaved);
        t.flush(WAIT, true);
        assert!(
            received.recv_timeout(Duration::from_millis(300)).is_err(),
            "something was sent after the switch went off"
        );
        assert!(t.state().queue.is_empty());

        // On again: only what happens from now on.
        t.set_on(true);
        t.record(Event::PlayOpened {
            plays: PlaysBucket::One,
        });
        t.flush(WAIT, false);
        assert_eq!(
            events_in(&received.recv_timeout(WAIT).unwrap()),
            ["play_opened"]
        );
    }

    #[test]
    fn nothing_new_nothing_sent_and_a_failure_waits_for_the_next_event() {
        let (url, received) = server(503);
        let t = telemetry(&url, true);
        t.record(Event::FormatSaved);
        t.flush(WAIT, false);
        assert_eq!(
            events_in(&received.recv_timeout(WAIT).unwrap()),
            ["format_saved"]
        );
        assert_eq!(t.state().queue.len(), 1, "a server error keeps the event");

        // No new event: the schedule does not try again.
        t.flush(WAIT, false);
        t.flush(WAIT, false);
        assert!(
            received.recv_timeout(Duration::from_millis(300)).is_err(),
            "retried on its own"
        );

        // A new event takes the waiting one with it.
        t.record(Event::AppLaunched);
        t.flush(WAIT, false);
        assert_eq!(
            events_in(&received.recv_timeout(WAIT).unwrap()),
            ["format_saved", "app_launched"]
        );
    }

    #[test]
    fn quitting_flushes_whatever_waits_while_reports_are_on() {
        let (url, received) = server(200);
        let t = telemetry(&url, true);
        for _ in 0..30 {
            t.record(Event::FormatSaved);
        }
        t.state().fresh = false;
        t.flush(WAIT, true);
        assert_eq!(events_in(&received.recv_timeout(WAIT).unwrap()).len(), 25);
        assert_eq!(events_in(&received.recv_timeout(WAIT).unwrap()).len(), 5);
        assert!(t.state().queue.is_empty());
    }

    #[test]
    fn one_deadline_bounds_the_whole_quit_flush() {
        let (url, received) = server_with_delay(200, Duration::from_millis(200));
        let t = telemetry(&url, true);
        for _ in 0..75 {
            t.record(Event::FormatSaved);
        }
        let start = std::time::Instant::now();
        t.flush(Duration::from_millis(300), true);
        assert!(
            start.elapsed() < Duration::from_millis(550),
            "each batch must not get a fresh timeout"
        );
        assert!(received.recv_timeout(WAIT).is_ok());
        assert!(t.state().queue.len() >= 25, "unsent events stay queued");
    }

    #[test]
    fn opt_out_during_a_crash_request_keeps_the_local_file() {
        let (url, received) = server_with_delay(200, Duration::from_millis(200));
        let t = std::sync::Arc::new(telemetry(&url, true));
        let dir = tempfile::tempdir().unwrap();
        let record = crash::make_record(
            events::CrashKind::JsError,
            "TypeError",
            vec![crash::Frame {
                function: None,
                lineno: Some(1),
                colno: Some(2),
            }],
            "1.0.0",
            example::SENT,
            "aarch64",
            chrono::Utc::now(),
        );
        let file = crash::write(dir.path(), &record).unwrap();
        t.queue_crash(file.clone(), record);
        let sending = t.clone();
        let join = std::thread::spawn(move || sending.flush(WAIT, false));
        // The server reports the body before replying, leaving an actual in-flight request.
        received.recv_timeout(WAIT).unwrap();
        t.set_on(false);
        join.join().unwrap();
        assert!(file.exists());
        assert!(t.state().crashes.is_empty());
    }

    #[test]
    fn a_surface_is_reported_once_a_launch() {
        let (url, received) = server(200);
        let t = telemetry(&url, true);
        for _ in 0..3 {
            t.record(Event::SurfaceShown {
                surface: Surface::Board,
            });
        }
        t.record(Event::SurfaceShown {
            surface: Surface::Cast,
        });
        t.flush(WAIT, false);
        assert_eq!(
            events_in(&received.recv_timeout(WAIT).unwrap()),
            ["surface_shown", "surface_shown"]
        );
    }

    #[test]
    fn a_crash_stays_local_until_accepted_and_keeps_the_same_id_on_retry() {
        let dir = tempfile::tempdir().unwrap();
        let record = crash::make_record(
            events::CrashKind::JsError,
            "TypeError",
            vec![crash::Frame {
                function: None,
                lineno: Some(1),
                colno: Some(2),
            }],
            "1.0.0",
            example::SENT,
            "aarch64",
            chrono::Utc::now(),
        );
        let file = crash::write(dir.path(), &record).unwrap();
        let (url, received) = server(503);
        let t = telemetry(&url, true);
        t.queue_crash(file.clone(), record.clone());
        t.flush(WAIT, false);
        let first = received.recv_timeout(WAIT).unwrap();
        assert!(file.exists());
        t.flush(WAIT, false);
        assert!(received.recv_timeout(Duration::from_millis(100)).is_err());
        t.set_on(false);
        assert!(t.state().crashes.is_empty());
        assert!(file.exists());
        let (url, received) = server(200);
        let t = telemetry(&url, true);
        t.queue_crash(file.clone(), record);
        t.flush(WAIT, false);
        assert_eq!(first, received.recv_timeout(WAIT).unwrap());
        assert!(!file.exists());
    }

    #[test]
    fn a_build_without_reports_records_nothing() {
        let t = Telemetry {
            client: None,
            ..telemetry("http://127.0.0.1:9/", true)
        };
        t.record(Event::FormatSaved);
        assert!(t.state().queue.is_empty());
    }

    #[test]
    fn an_update_is_the_version_changing_between_launches() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("data").join(LAST_VERSION);
        assert_eq!(
            version_change(&file, "0.9.1"),
            None,
            "a first launch is not an update"
        );
        assert_eq!(version_change(&file, "0.9.1"), None);
        let (from, to) = version_change(&file, "1.0.0").unwrap();
        assert_eq!((from.as_str(), to.as_str()), ("0.9.1", "1.0.0"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "1.0.0");
        std::fs::write(&file, "garbage").unwrap();
        assert_eq!(version_change(&file, "1.0.1"), None);
    }

    /// A track build reports its whole version (docs/engineering/services-and-feedback.md#SERV-272):
    /// its batches and crashes say `X.Y.Z-beta.N`, and its moves to and from
    /// a release are no `update_installed`, which names releases alone.
    #[test]
    fn a_beta_build_says_its_whole_version_and_names_no_update_but_releases() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(LAST_VERSION);
        assert_eq!(version_change(&file, "1.0.0"), None);
        assert_eq!(version_change(&file, "1.0.1-beta.2"), None);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "1.0.1-beta.2");
        assert_eq!(version_change(&file, "1.0.1-beta.3"), None);
        assert_eq!(version_change(&file, "1.0.1"), None);
        let (from, to) = version_change(&file, "1.0.2").unwrap();
        assert_eq!((from.as_str(), to.as_str()), ("1.0.1", "1.0.2"));

        let beta = Context {
            app_version: "1.0.1-beta.2".into(),
            os_name: example::NAME,
            os_version: example::FULL.into(),
            arch: "aarch64",
            channel: Channel::DeveloperId,
        };
        let pending = [client::Pending {
            event: Event::AppLaunched,
            at: chrono::Utc::now(),
        }];
        let sent: serde_json::Value = serde_json::from_str(&client::body(&pending, &beta)).unwrap();
        assert_eq!(sent["version"], "1.0.1-beta.2");
        assert_eq!(sent["channel"], "developer-id");
        assert_eq!(sent["os"], example::SENT);
        let record = crash::make_record(
            events::CrashKind::JsError,
            "TypeError",
            vec![crash::Frame {
                function: None,
                lineno: Some(1),
                colno: Some(2),
            }],
            &beta.app_version,
            &beta.os_version,
            beta.arch,
            chrono::Utc::now(),
        );
        assert!(record.valid());
        assert_eq!(record.version, "1.0.1-beta.2");
    }

    fn counting(url: &str, dir: &Path, first: &str) -> Telemetry {
        let t = Telemetry {
            data_dir: Some(dir.to_path_buf()),
            ..telemetry(url, true)
        };
        t.state().active = Some(active::Counted {
            first: first.into(),
            ..Default::default()
        });
        t
    }

    /// Each `copy_active` sent, as `period/installed`.
    fn active_in(body: &str) -> Vec<String> {
        let sent: serde_json::Value = serde_json::from_str(body).unwrap();
        sent["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["name"] == "copy_active")
            .map(|e| {
                format!(
                    "{}/{}",
                    e["props"]["period"].as_str().unwrap(),
                    e["props"]["installed"].as_str().unwrap()
                )
            })
            .collect()
    }

    fn remembered(dir: &Path) -> serde_json::Value {
        serde_json::from_slice(&std::fs::read(dir.join(active::FILE)).unwrap()).unwrap()
    }

    /// docs/app/keeping-work/privacy-and-telemetry.md#PRIV-86
    #[test]
    fn a_copy_counts_itself_once_a_period_and_remembers_it_once_answered() {
        let dir = tempfile::tempdir().unwrap();
        let (url, received) = server(200);
        let now = chrono::Utc::now();
        let first = (now - chrono::TimeDelta::days(10))
            .format("%Y-%m-%d")
            .to_string();
        let t = counting(&url, dir.path(), &first);
        t.record(Event::AppLaunched);
        t.count_active(now);
        // Every minute asks again; one of each waits, never two.
        t.count_active(now);
        assert_eq!(t.state().queue.len(), 4);
        assert!(
            !dir.path().join(active::FILE).exists(),
            "nothing is remembered before an answer"
        );
        t.flush(WAIT, false);
        let body = received.recv_timeout(WAIT).unwrap();
        assert_eq!(
            events_in(&body),
            ["app_launched", "copy_active", "copy_active", "copy_active"]
        );
        assert_eq!(
            active_in(&body),
            ["day/recent", "week/recent", "month/recent"]
        );
        // Nothing in the batch but its closed name and two closed values: no
        // day, week, first-run day or anything else that could tell copies apart.
        for event in serde_json::from_str::<serde_json::Value>(&body).unwrap()["events"]
            .as_array()
            .unwrap()
        {
            if event["name"] == "copy_active" {
                assert_eq!(event["props"].as_object().unwrap().len(), 2, "{event}");
            }
        }
        assert!(!body.contains(&first) && !body.contains(&Period::Day.of(now)));
        assert_eq!(
            remembered(dir.path()),
            serde_json::json!({"first": first, "day": Period::Day.of(now), "week": Period::Week.of(now), "month": Period::Month.of(now)})
        );
        // Counted: the rest of the period asks for nothing.
        t.count_active(now);
        t.record(Event::FormatSaved);
        t.flush(WAIT, false);
        assert_eq!(
            events_in(&received.recv_timeout(WAIT).unwrap()),
            ["format_saved"]
        );
    }

    #[test]
    fn a_copy_left_open_counts_itself_in_the_new_day() {
        let dir = tempfile::tempdir().unwrap();
        let (url, received) = server(200);
        let now = chrono::Utc::now();
        let t = counting(&url, dir.path(), &now.format("%Y-%m-%d").to_string());
        {
            let mut state = t.state();
            let counted = state.active.as_mut().unwrap();
            // Counted yesterday, in every period yesterday fell in.
            for p in Period::ALL {
                counted.mark(p, now - chrono::TimeDelta::days(1));
            }
        }
        t.count_active(now);
        t.flush(WAIT, false);
        let sent = active_in(&received.recv_timeout(WAIT).unwrap());
        assert_eq!(sent[0], "day/new");
        // The week and month go too when midnight began them.
        let yesterday = now - chrono::TimeDelta::days(1);
        let expected = 1 + [Period::Week, Period::Month]
            .iter()
            .filter(|p| p.of(yesterday) != p.of(now))
            .count();
        assert_eq!(sent.len(), expected);
    }

    #[test]
    fn an_unanswered_copy_active_waits_and_one_past_its_period_is_never_sent() {
        let dir = tempfile::tempdir().unwrap();
        let (url, received) = server(503);
        let now = chrono::Utc::now();
        let t = counting(&url, dir.path(), "2020-01-01");
        t.count_active(now);
        t.flush(WAIT, false);
        assert_eq!(
            active_in(&received.recv_timeout(WAIT).unwrap()),
            ["day/earlier", "week/earlier", "month/earlier"]
        );
        // Offline: kept, not remembered, and not queued a second time.
        assert!(!dir.path().join(active::FILE).exists());
        t.count_active(now);
        assert_eq!(t.state().queue.len(), 3);

        // Queued in a period that has since ended: dropped, never sent late.
        let (url, received) = server(200);
        let t = counting(&url, dir.path(), "2020-01-01");
        let yesterday = now - chrono::TimeDelta::days(1);
        t.count_active(yesterday);
        t.record(Event::FormatSaved);
        t.flush(WAIT, false);
        let body = received.recv_timeout(WAIT).unwrap();
        let still = Period::ALL
            .iter()
            .filter(|p| p.of(yesterday) == p.of(now))
            .count();
        assert_eq!(active_in(&body).len(), still);
        assert!(!active_in(&body).iter().any(|e| e.starts_with("day/")));
    }

    #[test]
    fn a_refused_batch_spends_its_periods() {
        let dir = tempfile::tempdir().unwrap();
        let (url, received) = server(400);
        let now = chrono::Utc::now();
        let t = counting(&url, dir.path(), "2020-01-01");
        t.count_active(now);
        t.flush(WAIT, false);
        received.recv_timeout(WAIT).unwrap();
        assert_eq!(remembered(dir.path())["day"], Period::Day.of(now));
        t.count_active(now);
        assert!(t.state().queue.is_empty(), "asked again after a refusal");
    }

    #[test]
    fn switched_off_a_copy_neither_counts_itself_nor_remembers() {
        let dir = tempfile::tempdir().unwrap();
        let (url, received) = server(200);
        let now = chrono::Utc::now();
        let t = counting(&url, dir.path(), "2020-01-01");
        t.count_active(now);
        t.set_on(false);
        t.count_active(now);
        t.flush(WAIT, true);
        assert!(received.recv_timeout(Duration::from_millis(300)).is_err());
        assert!(!dir.path().join(active::FILE).exists());
        // On again: due, as it never was counted.
        t.set_on(true);
        t.count_active(now);
        assert_eq!(t.state().queue.len(), 3);

        // A build without reports, or a copy with nowhere to remember, counts nothing.
        let none = Telemetry {
            client: None,
            ..counting("http://127.0.0.1:9/", dir.path(), "2020-01-01")
        };
        none.count_active(now);
        assert!(none.state().queue.is_empty());
        let nowhere = telemetry("http://127.0.0.1:9/", true);
        nowhere.count_active(now);
        assert!(nowhere.state().queue.is_empty());
    }

    /// A batch already taken out of the queue when the switch
    /// goes off is not sent, and the crash file it carried is not deleted.
    #[test]
    fn a_batch_taken_before_opt_out_is_not_sent_after_it() {
        let (url, received) = server(200);
        let t = telemetry(&url, true);
        let dir = tempfile::tempdir().unwrap();
        let crash = dir.path().join("crash.json");
        std::fs::write(&crash, b"{}").unwrap();
        t.record(Event::FormatSaved);
        // The sender's first step, taking the batch, then the switch goes off
        // before its second: the request must not begin.
        let (batch, consent) = {
            let mut state = t.state();
            state.fresh = false;
            (state.queue.take_batch(chrono::Utc::now()), state.consent)
        };
        assert_eq!(batch.len(), 1);
        t.set_on(false);
        assert_ne!(t.state().consent, consent);
        // What flush does from here with that batch: nothing.
        t.flush(WAIT, true);
        assert!(
            received.recv_timeout(Duration::from_millis(300)).is_err(),
            "sent after opt-out"
        );
        assert!(
            crash.exists(),
            "a crash file is not marked sent after opt-out"
        );
    }
}
