// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Updates (docs/engineering/release-engineering.md#REL-D6): find a newer Proscenium, fetch it while the
//! writer works, and wait for them.
//!
//! - **Checked from here, not from the page.** tauri-plugin-updater's Rust side
//!   does the check and the download, so the webview needs no network
//!   permission and holds none (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2). The endpoint is
//!   `latest.json` on the repository's GitHub releases, and every download is
//!   verified against the public key in tauri.conf.json before a byte of it
//!   is used.
//! - **When:** at launch and once a day while the app runs, every hour on the
//!   alpha track (it brings each change as it lands, and a day's wait defeats that), and only while
//!   Settings › Updates › "Check for updates automatically" is on (the default).
//!   The day is measured by the wall clock, so a laptop asleep all night checks
//!   when it wakes rather than a full day of awake time later. "Check for
//!   Updates…" and Check Now ask at once, whatever the switch says, and so does
//!   a change of track.
//! - **Where, and as what:** the track's own address on proscenium.ink, and for
//!   stable GitHub's `latest.json` after it (GitHub holds only stable releases), asked
//!   with this copy's whole version (version.rs). An update is offered only when
//!   it is newer than that version, so a copy never goes back.
//! - **Alpha asks with its key** (docs/app/preferences-and-help/settings.md#SET-38): the
//!   `Proscenium-Track-Key` header, from `settings.json`, on alpha's check and
//!   its download and on nothing else, and never across a redirect. Without a
//!   key there is nothing alpha will answer, so a copy set to alpha without one
//!   does not ask, and says so.
//! - **Never restarts on its own.** A downloaded update waits, and the app says
//!   so quietly. The restart is the writer's: the page flushes pending edits,
//!   and [`update_restart`] refuses while the unsaved-work beacon the installer
//!   already trusts still says dirty.
//! - **A build with no updater key fetches nothing.** With an empty `pubkey`
//!   there is nothing it could verify, so it never asks. The key has been in
//!   tauri.conf.json since the enrollment sitting (2026-09-18), so every build
//!   from then on checks; until launch there is no release to find, and
//!   Settings › Updates says the check failed. The release script refuses to
//!   build a release without the key.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Error as UpdaterError, Update, UpdaterExt};

use crate::settings::{self, UpdateTrack};

mod download;
#[cfg(all(test, target_os = "macos"))]
#[path = "updates/tests/rehearsal.rs"]
mod rehearsal;
#[cfg(target_os = "macos")]
mod install;

/// The header alpha's key travels in, beside `Proscenium-OS`; the Worker reads
/// the same name (services/edge/src/updates.ts).
pub(crate) const TRACK_KEY_HEADER: &str = "Proscenium-Track-Key";

/// The event the page listens on; its payload is the [`UpdateState`].
pub const EVENT_STATE: &str = "updates://state";

/// The release notes live beside each release; only the version varies. The
/// address is kept with every other one the app uses (telemetry/allowlist.rs).
const RELEASES: &str = crate::telemetry::allowlist::RELEASES;

/// Long enough after launch that the check never competes with opening a play.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(15);
/// How often the schedule looks at the clock.
const TICK: Duration = Duration::from_secs(10 * 60);

/// How long after one check the schedule asks again: a day, and an hour on the
/// alpha track, which is for someone who wants each change as it lands.
fn every(track: UpdateTrack) -> Duration {
    match track {
        UpdateTrack::Alpha => Duration::from_secs(60 * 60),
        UpdateTrack::Beta | UpdateTrack::Stable => Duration::from_secs(24 * 60 * 60),
    }
}

/// The addresses a copy on `track` asks, made from tauri.conf.json's: its own
/// host's first, with the whole version written in, then for stable only the
/// rest, GitHub's `latest.json`, which holds releases alone. A track's address
/// is the same one with the track's name after `/v1/`.
fn endpoints_for(configured: &[&str], track: UpdateTrack, version: &str) -> Option<Vec<String>> {
    let (own, rest) = configured.split_first()?;
    let own = own.replace("{{current_version}}", version);
    let segment = match track {
        UpdateTrack::Stable => return Some(std::iter::once(own).chain(rest.iter().map(|s| s.to_string())).collect()),
        UpdateTrack::Beta => "beta",
        UpdateTrack::Alpha => "alpha",
    };
    own.contains("/v1/{{target}}/").then(|| vec![own.replacen("/v1/", &format!("/v1/{segment}/"), 1)])
}

/// What the writer can be told about updates, as the page receives it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum UpdateState {
    /// Nothing asked yet this launch.
    Idle,
    /// A build that cannot verify an update, and so never looks for one.
    Unconfigured,
    Checking,
    UpToDate { checked_at: u64 },
    Downloading { version: String, received: u64, total: Option<u64> },
    /// Downloaded and verified: it installs when the writer restarts.
    Ready { version: String, notes: Option<String>, published_at: Option<i64> },
    Installing { version: String },
    Failed { reason: FailReason, message: String, checked_at: u64 },
}

/// Why a check failed, in the kinds the page words differently.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FailReason {
    /// No connection, or GitHub did not answer.
    Offline,
    /// The download's signature did not match the key: it was thrown away.
    Signature,
    /// The track is alpha, and this copy holds no key for it: nothing was asked.
    NoKey,
    /// Anything else, with the plugin's own words in `message`.
    Other,
}

struct Inner {
    state: UpdateState,
    ready: Option<(Update, Arc<Vec<u8>>)>,
    busy: bool,
    last_check: Option<SystemTime>,
}

pub struct Updates(Mutex<Inner>);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Whether this build carries the key an update is verified against.
fn configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|c| c.get("pubkey"))
        .and_then(|k| k.as_str())
        .is_some_and(|k| !k.trim().is_empty())
}

fn publish(app: &AppHandle, state: UpdateState) -> UpdateState {
    app.state::<Updates>().0.lock().unwrap_or_else(|p| p.into_inner()).state = state.clone();
    let _ = app.emit(EVENT_STATE, state.clone());
    state
}

/// Manage the state and start the schedule. Called once, from setup.
pub fn setup(app: &AppHandle) {
    app.manage(Updates(Mutex::new(Inner {
        state: UpdateState::Idle,
        ready: None,
        busy: false,
        last_check: None,
    })));
    if !configured(app) {
        publish(app, UpdateState::Unconfigured);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_CHECK_AFTER);
        loop {
            let settings = settings::current(&app);
            let every = every(settings.update_track);
            let due = app
                .state::<Updates>()
                .0
                .lock()
                .unwrap()
                .last_check
                .map_or(true, |t| t.elapsed().map_or(true, |e| e >= every));
            if due && settings.check_for_updates {
                tauri::async_runtime::block_on(check(&app));
            }
            std::thread::sleep(TICK);
        }
    });
}

/// The writer chose another track (docs/app/preferences-and-help/settings.md#SET-37). An
/// update waiting to install came from the track they left, so it goes, and the
/// new track is asked at once. A check already running for the old track
/// notices when it finishes, and asks again.
pub fn track_changed(app: &AppHandle) {
    if !configured(app) {
        return;
    }
    {
        let updates = app.state::<Updates>();
        let mut inner = updates.0.lock().unwrap_or_else(|p| p.into_inner());
        if matches!(inner.state, UpdateState::Ready { .. }) && !inner.busy {
            inner.ready = None;
            inner.state = UpdateState::Idle;
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        check(&app).await;
    });
}

/// Ask for a newer version and, if there is one, download it. A check already
/// running, or an update already waiting, answers with where things stand.
pub async fn check(app: &AppHandle) -> UpdateState {
    if !configured(app) {
        return publish(app, UpdateState::Unconfigured);
    }
    {
        let updates = app.state::<Updates>();
        let mut inner = updates.0.lock().unwrap_or_else(|p| p.into_inner());
        if inner.busy || matches!(inner.state, UpdateState::Ready { .. }) {
            return inner.state.clone();
        }
        inner.busy = true;
        inner.last_check = Some(SystemTime::now());
    }
    publish(app, UpdateState::Checking);

    // A change of track while this was out means its answer is for the track
    // the writer left: it is dropped, and the new track asked.
    let outcome = loop {
        let track = settings::current(app).update_track;
        let outcome = fetch(app, track).await;
        if settings::current(app).update_track == track {
            break outcome;
        }
    };
    let state = match outcome {
        Ok(None) => UpdateState::UpToDate { checked_at: now_ms() },
        Ok(Some((update, bytes))) => {
            let state = UpdateState::Ready {
                version: update.version.clone(),
                notes: update.body.clone(),
                published_at: update.date.map(|d| d.unix_timestamp() * 1000),
            };
            app.state::<Updates>().0.lock().unwrap_or_else(|p| p.into_inner()).ready = Some((update, Arc::new(bytes)));
            state
        }
        Err(e) => {
            let reason = match &e {
                UpdaterError::Io(io) if io.to_string() == NO_KEY => FailReason::NoKey,
                UpdaterError::Reqwest(_) | UpdaterError::Network(_) => FailReason::Offline,
                UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
                    FailReason::Signature
                }
                _ => FailReason::Other,
            };
            UpdateState::Failed { reason, message: e.to_string(), checked_at: now_ms() }
        }
    };
    app.state::<Updates>().0.lock().unwrap_or_else(|p| p.into_inner()).busy = false;
    publish(app, state)
}

/// A check that gets no answer gives up after this; a download, after this.
/// Without them a connection that stays open and stops delivering — a Wi-Fi
/// handover, a captive portal — left Checking or Downloading on the screen
/// until the app quit.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Why an alpha check did not go out: there was no key to send.
const NO_KEY: &str = "Alpha needs a key, and this copy has none";

/// The key a check on `track` sends: alpha's, and only on alpha, because a
/// stable check's second endpoint is GitHub. Alpha without one is not asked.
fn key_for(track: UpdateTrack, stored: impl FnOnce() -> Option<String>) -> std::io::Result<Option<String>> {
    match track {
        UpdateTrack::Alpha => stored().map(Some).ok_or_else(|| std::io::Error::other(NO_KEY)),
        UpdateTrack::Beta | UpdateTrack::Stable => Ok(None),
    }
}

async fn fetch(app: &AppHandle, track: UpdateTrack) -> Result<Option<(Update, Vec<u8>)>, UpdaterError> {
    // A self-test run asks no update service:
    // the pipeline's runs are not copies in use, and what a track publishes
    // must not change what a check sees.
    if cfg!(feature = "selftest") {
        return Ok(None);
    }
    let key = key_for(track, || settings::update_track_key(app))?;
    let config = app.config();
    let updater_config = config.plugins.0.get("updater").ok_or_else(|| std::io::Error::other("No updater configuration"))?;
    let configured = updater_config.get("endpoints").and_then(|v| v.as_array())
        .and_then(|list| list.iter().map(|v| v.as_str()).collect::<Option<Vec<_>>>())
        .ok_or_else(|| std::io::Error::other("No update endpoints"))?;
    let version = crate::version::whole(app);
    let current = semver::Version::parse(&version).map_err(std::io::Error::other)?;
    let endpoints = endpoints_for(&configured, track, &version)
        .ok_or_else(|| std::io::Error::other("No update endpoints for this track"))?
        .iter()
        .map(|s| reqwest::Url::parse(s))
        .collect::<Result<Vec<_>, _>>()
        .map_err(std::io::Error::other)?;
    if !endpoints.iter().all(download::allowed) {
        return Err(std::io::Error::other("The update endpoint is not permitted").into());
    }
    let os = crate::telemetry::operating_system().1.split('.').take(2).collect::<Vec<_>>().join(".");
    let Some(mut update) = metadata(app, &endpoints, &os, key.as_deref(), &current).await? else {
        return Ok(None);
    };
    #[cfg(target_os = "macos")]
    install::preflight(&install::running_bundle()?)?;
    // The plugin's `Update` starts with no deadline of its own, whatever the
    // builder was given.
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    let version = update.version.clone();
    publish(app, UpdateState::Downloading { version: version.clone(), received: 0, total: None });
    let mut received = 0u64;
    let mut last = Instant::now();
    let progress = app.clone();
    let key = updater_config.get("pubkey").and_then(|v| v.as_str()).unwrap_or("");
    let bytes = download::archive(&update, key,
            |chunk, total| {
                received += chunk as u64;
                // A progress event per network chunk would be hundreds a second.
                if last.elapsed() >= Duration::from_millis(250) {
                    last = Instant::now();
                    publish(
                        &progress,
                        UpdateState::Downloading { version: version.clone(), received, total },
                    );
                }
            },
        )
        .await?;
    #[cfg(target_os = "macos")]
    install::inspect(&bytes, &app.config().identifier, &update.version, &version)?;
    Ok(Some((update, bytes)))
}

/// Keep archive origins tied to the endpoint that supplied them. A Worker
/// answer can never silently select a GitHub download (or vice versa).
/// The update's headers carry on to its download (download.rs), so alpha's
/// key reaches alpha's archive and nothing else does.
async fn metadata<R: tauri::Runtime>(app: &AppHandle<R>, endpoints: &[reqwest::Url], os: &str, key: Option<&str>, current: &semver::Version) -> Result<Option<Update>, UpdaterError> {
    let mut failure = None;
    for endpoint in endpoints {
        // Newer than the whole version this copy answers to: the plugin knows
        // only the package's, `X.Y.Z`, which every alpha of it sorts below.
        let current = current.clone();
        let mut builder = app.updater_builder().endpoints(vec![endpoint.clone()])?.timeout(CHECK_TIMEOUT)
            .header("Proscenium-OS", os)?;
        if let Some(key) = key {
            builder = builder.header(TRACK_KEY_HEADER, key)?;
        }
        let keyed = key.is_some();
        let result = builder
            .configure_client(move |client| client.user_agent("").redirect(download::redirects_for(keyed)))
            .version_comparator(move |_, remote| remote.version > current)
            .build()?.check().await;
        match result {
            Ok(Some(update)) => {
                let origin_matches = if endpoint.host_str() == Some("updates.proscenium.ink") {
                    update.download_url.host_str() == endpoint.host_str()
                } else { update.download_url.host_str() != Some("updates.proscenium.ink") };
                if origin_matches { return Ok(Some(update)); }
                failure = Some(std::io::Error::other("The archive does not belong to its update endpoint").into());
            }
            Ok(None) => return Ok(None),
            Err(error) => failure = Some(error),
        }
    }
    Err(failure.unwrap_or_else(|| std::io::Error::other("No update endpoints").into()))
}

#[tauri::command]
pub async fn update_state(app: AppHandle) -> UpdateState {
    app.state::<Updates>().0.lock().unwrap_or_else(|p| p.into_inner()).state.clone()
}

/// Check Now, and the menu's "Check for Updates…": at once, whatever the switch says.
#[tauri::command]
pub async fn update_check(app: AppHandle) -> UpdateState {
    check(&app).await
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RestartOutcome {
    /// Edits are still being written; nothing was installed. Ask again shortly.
    Unsaved,
    /// There is no downloaded update to install.
    NotReady,
    /// An earlier Restart to Update is installing it now.
    Installing,
}

/// Install the waiting update and relaunch into it — only on the writer's word,
/// and only with nothing unsaved. The page flushes first; this is the second
/// lock on the same door, reading the beacon the installer reads.
#[tauri::command]
pub async fn update_restart(app: AppHandle) -> Result<RestartOutcome, String> {
    if unsaved_edits(&app) {
        return Ok(RestartOutcome::Unsaved);
    }
    // One installer at a time: the update is TAKEN, not copied,
    // and `busy` holds until it is in place or has failed. A second click, or
    // Settings and the notice pressed together, used to start two installers
    // moving the same bundle.
    let pending = {
        let updates = app.state::<Updates>();
        let mut inner = updates.0.lock().unwrap_or_else(|p| p.into_inner());
        if inner.busy {
            return Ok(RestartOutcome::Installing);
        }
        let taken = inner.ready.take();
        if taken.is_some() {
            inner.busy = true;
        }
        taken
    };
    let Some((update, bytes)) = pending else {
        return Ok(RestartOutcome::NotReady);
    };
    publish(&app, UpdateState::Installing { version: update.version.clone() });
    let installed = tauri::async_runtime::spawn_blocking({
        let update = update.clone();
        let bytes = bytes.clone();
        let id = app.config().identifier.clone();
        let current = crate::version::whole(&app);
        move || {
            #[cfg(target_os = "macos")]
            { install::install(&install::running_bundle()?, &bytes, &id, &update.version, &current).map_err(UpdaterError::from) }
            #[cfg(not(target_os = "macos"))]
            { let _ = (id, current); update.install(bytes.as_slice()) }
        }
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r.map_err(|e| e.to_string()));
    if let Err(e) = installed {
        // Still downloaded and verified: the writer can try again.
        let updates = app.state::<Updates>();
        let mut inner = updates.0.lock().unwrap_or_else(|p| p.into_inner());
        inner.ready = Some((update, bytes));
        inner.busy = false;
        let (update, _) = inner.ready.as_ref().expect("restored above");
        let state = UpdateState::Ready { version: update.version.clone(), notes: update.body.clone(), published_at: update.date.map(|d| d.unix_timestamp() * 1000) };
        drop(inner);
        publish(&app, state);
        return Err(e);
    }
    app.restart()
}

/// Release notes in the writer's browser: one version's, or every release's.
/// The address is fixed; the page supplies at most a version, and only a
/// version is accepted.
#[tauri::command]
pub async fn update_release_notes(version: Option<String>) -> Result<(), String> {
    let url = match version {
        Some(v) if is_version(&v) => format!("{RELEASES}/v{v}"),
        Some(v) => return Err(format!("\"{v}\" is not a version")),
        None => RELEASES.to_string(),
    };
    std::process::Command::new("open").arg(url).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

fn is_version(v: &str) -> bool {
    let parts: Vec<&str> = v.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.len() <= 6 && p.bytes().all(|b| b.is_ascii_digit()))
}

/// The unsaved-work beacon (`buffer-state.json`, settings.rs): the page writes
/// it on every save-status change, and a fresh launch clears it.
fn unsaved_edits(app: &AppHandle) -> bool {
    app.path()
        .app_config_dir()
        .ok()
        .and_then(|dir| std::fs::read(dir.join("buffer-state.json")).ok())
        .map_or(true, |bytes| unsafe_beacon(&bytes))
}

fn unsafe_beacon(bytes: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(bytes).ok()
        .and_then(|beacon| {
            if beacon.get("pid").and_then(|p| p.as_u64()) != Some(std::process::id() as u64) { return None; }
            beacon.get("dirty").and_then(|d| d.as_bool())
        })
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a7_01_an_unknown_or_torn_beacon_is_unsafe() {
        for bytes in [b"".as_slice(), b"{", b"{}", br#"{"dirty":null}"#, br#"{"dirty":true}"#, br#"{"dirty":false}"#, br#"{"dirty":false,"pid":0}"#] {
            assert!(unsafe_beacon(bytes));
        }
        assert!(!unsafe_beacon(&serde_json::to_vec(&serde_json::json!({ "dirty": false, "pid": std::process::id() })).unwrap()));
    }

    const CONFIGURED: [&str; 2] = [
        "https://updates.proscenium.ink/v1/{{target}}/{{arch}}/{{current_version}}",
        "https://github.com/proscenium-app/proscenium/releases/latest/download/latest.json",
    ];

    #[test]
    fn each_track_asks_its_own_address_with_the_whole_version() {
        assert_eq!(
            endpoints_for(&CONFIGURED, UpdateTrack::Stable, "1.0.0").unwrap(),
            vec![
                "https://updates.proscenium.ink/v1/{{target}}/{{arch}}/1.0.0".to_string(),
                CONFIGURED[1].to_string(),
            ]
        );
        assert_eq!(
            endpoints_for(&CONFIGURED, UpdateTrack::Alpha, "1.0.1-alpha.57").unwrap(),
            vec!["https://updates.proscenium.ink/v1/alpha/{{target}}/{{arch}}/1.0.1-alpha.57".to_string()]
        );
        assert_eq!(
            endpoints_for(&CONFIGURED, UpdateTrack::Beta, "1.0.1-beta.2").unwrap(),
            vec!["https://updates.proscenium.ink/v1/beta/{{target}}/{{arch}}/1.0.1-beta.2".to_string()]
        );
        // A copy that left alpha for stable still says what it is running.
        assert_eq!(
            endpoints_for(&CONFIGURED, UpdateTrack::Stable, "1.0.1-alpha.57").unwrap()[0],
            "https://updates.proscenium.ink/v1/{{target}}/{{arch}}/1.0.1-alpha.57"
        );
        // Each address is one the download rules allow.
        for track in [UpdateTrack::Stable, UpdateTrack::Beta, UpdateTrack::Alpha] {
            for address in endpoints_for(&CONFIGURED, track, "1.0.1-alpha.57").unwrap() {
                assert!(download::allowed(&reqwest::Url::parse(&address).unwrap()), "{address}");
            }
        }
        assert_eq!(endpoints_for(&[], UpdateTrack::Stable, "1.0.0"), None);
        assert_eq!(endpoints_for(&["https://example.invalid/latest.json"], UpdateTrack::Alpha, "1.0.0"), None);
    }

    #[test]
    fn only_alpha_sends_the_key_and_alpha_without_one_asks_nothing() {
        let key = || Some("k".repeat(43));
        assert_eq!(key_for(UpdateTrack::Alpha, key).unwrap(), key());
        for track in [UpdateTrack::Stable, UpdateTrack::Beta] {
            assert_eq!(key_for(track, || panic!("{track:?} read the key")).unwrap(), None);
        }
        let missing = key_for(UpdateTrack::Alpha, || None).unwrap_err();
        // The check's failure names why, so the page can offer Stable.
        let reason = match &UpdaterError::from(missing) {
            UpdaterError::Io(io) if io.to_string() == NO_KEY => FailReason::NoKey,
            _ => FailReason::Other,
        };
        assert_eq!(reason, FailReason::NoKey);
        assert_eq!(serde_json::to_value(FailReason::NoKey).unwrap(), serde_json::json!("noKey"));
    }

    #[test]
    fn alpha_asks_every_hour_and_the_rest_every_day() {
        assert_eq!(every(UpdateTrack::Alpha), Duration::from_secs(3600));
        assert_eq!(every(UpdateTrack::Beta), Duration::from_secs(86_400));
        assert_eq!(every(UpdateTrack::Stable), Duration::from_secs(86_400));
    }

    #[test]
    fn a_track_sorts_between_the_releases_around_it() {
        let v = |s: &str| semver::Version::parse(s).unwrap();
        assert!(v("1.0.0") < v("1.0.1-alpha.7"));
        assert!(v("1.0.1-alpha.7") < v("1.0.1-alpha.57"));
        assert!(v("1.0.1-alpha.57") < v("1.0.1-beta.1"));
        assert!(v("1.0.1-beta.1") < v("1.0.1"));
    }

    #[test]
    fn release_notes_take_only_a_version() {
        assert!(is_version("0.9.1"));
        assert!(is_version("1.0.0"));
        for bad in ["", "1.0", "1.0.0.0", "v1.0.0", "1.0.0-rc.1", "1..0", "1.0.0/../../x", "1.0.0 --x"] {
            assert!(!is_version(bad), "{bad:?} passed");
        }
    }

    #[test]
    fn state_serializes_as_the_page_reads_it() {
        let ready = UpdateState::Ready { version: "0.9.1".into(), notes: None, published_at: Some(1) };
        assert_eq!(
            serde_json::to_value(ready).unwrap(),
            serde_json::json!({ "kind": "ready", "version": "0.9.1", "notes": null, "publishedAt": 1 })
        );
        let failed = UpdateState::Failed { reason: FailReason::Offline, message: "m".into(), checked_at: 2 };
        assert_eq!(
            serde_json::to_value(failed).unwrap(),
            serde_json::json!({ "kind": "failed", "reason": "offline", "message": "m", "checkedAt": 2 })
        );
        assert_eq!(
            serde_json::to_value(RestartOutcome::Unsaved).unwrap(),
            serde_json::json!({ "kind": "unsaved" })
        );
    }
}
