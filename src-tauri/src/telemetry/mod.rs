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

pub mod allowlist;
mod client;
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
use events::{Channel, Event, PageEvent, Surface, Version};

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
}

impl Telemetry {
    fn state(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn record(&self, event: Event) {
        if self.client.is_none() {
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
                state.crashes.retain(|(_, r)| r.recent(chrono::Utc::now()));
                let batch = state.queue.take_batch(chrono::Utc::now());
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
                Outcome::Refused => return,
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
    let version = app.package_info().version.to_string();
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
    let telemetry = Telemetry {
        client: Client::of_this_build(),
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
            ..State::default()
        }),
        started: std::time::Instant::now(),
        sending: Mutex::new(()),
    };

    telemetry.record(Event::AppLaunched);
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
                app.state::<Telemetry>().flush(REQUEST_TIMEOUT, false);
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

/// The version that ran last, replaced by this one; the pair when they differ.
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

#[cfg(not(target_os = "macos"))]
pub(crate) fn operating_system() -> (&'static str, String) {
    (std::env::consts::OS, String::new())
}

fn with_telemetry<T>(app: &AppHandle, f: impl FnOnce(&Telemetry) -> T) -> Option<T> {
    app.try_state::<Telemetry>().map(|t| f(&t))
}

/// The events only the page sees happen. An error shown is also kept in the
/// local error log, whatever the switch says.
#[tauri::command]
pub async fn telemetry_record(app: AppHandle, event: PageEvent) {
    with_telemetry(&app, |telemetry| {
        if let (PageEvent::ErrorShown { code }, Some(dir)) = (&event, &telemetry.data_dir) {
            let _ = errors::append(&dir.join(ERROR_LOG), *code, chrono::Utc::now());
        }
        telemetry.record(event.into());
    });
}

/// A page error: a closed failure kind and bounded numeric stack frames only.
#[tauri::command]
pub async fn telemetry_page_error(app: AppHandle, name: String, frames: Vec<crash::PageFrame>) {
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
/// `app-store` or `local`.
pub fn channel() -> &'static str {
    Channel::of_this_build().as_str()
}

#[tauri::command]
pub fn telemetry_configured(app: AppHandle) -> bool {
    with_telemetry(&app, |t| t.client.is_some()).unwrap_or(false)
}

/// Gather locally; feedback works even when this collection fails.
#[tauri::command]
pub async fn diagnostics_review(
    app: AppHandle,
    formats_in_use: Vec<String>,
) -> Result<String, String> {
    diagnostics_text(&app, &formats_in_use)
}

pub(crate) fn copy_text(text: &str) -> Result<(), String> {
    diagnostics::copy_to_clipboard(text)
}

/// Help › Copy Diagnostics: the text on the clipboard, and back to the page to
/// say what was copied.
#[tauri::command]
pub async fn diagnostics_copy(
    app: AppHandle,
    formats_in_use: Vec<String>,
) -> Result<String, String> {
    let text = diagnostics_text(&app, &formats_in_use)?;
    diagnostics::copy_to_clipboard(&text)?;
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
                os_version: "15.6".into(),
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
            "15.6",
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
            "15.6",
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
