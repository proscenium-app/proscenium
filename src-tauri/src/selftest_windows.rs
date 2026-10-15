// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The Windows half of the `selftest` feature (docs/engineering/release-engineering.md#REL-D4).
//!
//! On a Mac nothing can drive WebKit inside an app, so the self-test is a
//! harness in the page (selftest.rs). WebView2 can be driven from outside, so
//! on Windows the test build is the release build with three differences, and
//! its driver attaches through WebView2's debugging port:
//!
//! - it opens WebView2's DevTools port on the loopback address when
//!   `PROSCENIUM_SELFTEST_DEVTOOLS` names one, itself, since an elevated
//!   process ignores WebView2's own variables (and a release build clears
//!   them, lib.rs);
//! - it answers the two panels a test cannot drive, as the Mac's does: the
//!   folder picker with `PROSCENIUM_SELFTEST_FOLDER`, and the save panel with
//!   a file in `PROSCENIUM_SELFTEST_EXPORTS`. Everything after each panel (the
//!   grant, the open, the bytes, the atomic write) runs for real;
//! - it keeps what it was asked to show in File Explorer instead of opening a
//!   window on the test machine.
//!
//! Started with `PROSCENIUM_UPDATE_PROOF`, a test build is the update proof's
//! copy instead, for the proof's driver on a clean hosted machine: built under the real
//! app's identifier and installed as a writer's copy is, its updater asks,
//! and the page presses Check Now and Restart to Update itself, as a Mac's
//! does (scripts/update-proof/drive.js).
//!
//! Its identifier is its own (`org.habiby.proscenium.selftest`), so its
//! settings and plays are never a writer's. **Unreachable in a shipped build:**
//! the module exists only with the Cargo feature.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde_json::{json, Value};
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::Runtime;

const FOLDER: &str = "PROSCENIUM_SELFTEST_FOLDER";
const EXPORTS: &str = "PROSCENIUM_SELFTEST_EXPORTS";
const DEVTOOLS: &str = "PROSCENIUM_SELFTEST_DEVTOOLS";
const WEBVIEW: &str = "PROSCENIUM_SELFTEST_WEBVIEW";

fn running() -> bool {
    [FOLDER, EXPORTS, DEVTOOLS, WEBVIEW]
        .iter()
        .any(|name| std::env::var_os(name).is_some())
}

/// WebView2's profile for a test run: the folder `PROSCENIUM_SELFTEST_WEBVIEW`
/// names, a fresh one for each launch, since WebView2's processes let go of
/// the last one a while after the app has gone.
pub fn webview_data() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os(WEBVIEW)?))
}

/// WebView2's arguments for a test build driven from outside: Tauri's own,
/// and the DevTools port `PROSCENIUM_SELFTEST_DEVTOOLS` names, on the
/// loopback address. The build asks for the port itself because an elevated
/// process, as a hosted runner's is, ignores WebView2's own variables.
pub fn browser_args() -> Option<String> {
    let port: u16 = std::env::var(DEVTOOLS).ok()?.parse().ok()?;
    say(&format!(
        "WebView2's DevTools port is {port}, on the loopback address"
    ));
    Some(format!(
        "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
         --remote-debugging-port={port} --remote-debugging-address=127.0.0.1"
    ))
}

fn say(line: &str) {
    println!("[selftest] {line}");
}

/// Nothing to carry into the page for a test, whose driver is outside it.
/// The update proof is the exception: its driver is the page's own, as on a
/// Mac (scripts/update-proof/drive.js).
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let builder = PluginBuilder::new("selftest");
    if begin_proof() {
        return builder.js_init_script(PROOF_DRIVE).build();
    }
    if running() {
        say("a test build, driven through WebView2's debugging port");
    }
    builder.build()
}

// --- the update proof ---------------------------------------------------------

/// scripts/update-proof/drive.js: what the proof does in the page.
const PROOF_DRIVE: &str = include_str!("../../scripts/update-proof/drive.js");

/// A run of the update proof on Windows, on a clean hosted machine:
/// the copy of the version updated from, installed for the user as a writer's
/// is, started with `PROSCENIUM_UPDATE_PROOF=<log>`. Its updater asks the
/// real update service, or the stand-in an update-proof build is given
/// (`PROSCENIUM_UPDATE_PROOF_ORIGIN`, telemetry/allowlist.rs `proof`), and
/// its page presses Check Now, types a line and presses Restart to Update.
/// What the copy comes back as is the script's to judge.
struct Proof {
    log: PathBuf,
    line: String,
    started: Instant,
    /// The stand-in's origin, when the proof asks one rather than the real service.
    #[cfg(feature = "update-proof")]
    origin: Option<reqwest::Url>,
}

static PROOF: OnceLock<Proof> = OnceLock::new();

/// Whether this process is the update proof, whose updater asks: a test build
/// started for anything else asks no update service anything.
pub fn proving_update() -> bool {
    PROOF.get().is_some()
}

/// The stand-in an update proof asks, given at launch; none, for the real service.
#[cfg(feature = "update-proof")]
pub fn proof_origin() -> Option<&'static reqwest::Url> {
    PROOF.get().and_then(|proof| proof.origin.as_ref())
}

fn begin_proof() -> bool {
    let Some(log) = std::env::var_os("PROSCENIUM_UPDATE_PROOF").map(PathBuf::from) else {
        return false;
    };
    let line = std::env::var("PROSCENIUM_UPDATE_PROOF_LINE").unwrap_or_default();
    if line.is_empty()
        || !line
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == ' ')
    {
        eprintln!("[update-proof] PROSCENIUM_UPDATE_PROOF_LINE must be letters, digits, spaces and hyphens");
        std::process::exit(2);
    }
    // A stand-in's origin, or nothing: one that is not a loopback address and
    // a port ends the run rather than be ignored, since the proof would then
    // ask the real service.
    #[cfg(feature = "update-proof")]
    let origin = {
        use crate::telemetry::allowlist::proof;
        match std::env::var(proof::ORIGIN_VAR) {
            Ok(given) if !given.is_empty() => match proof::loopback_origin(&given) {
                Some(origin) => Some(origin),
                None => {
                    eprintln!(
                        "[update-proof] {} must be {}",
                        proof::ORIGIN_VAR,
                        proof::SHAPE
                    );
                    std::process::exit(2);
                }
            },
            _ => None,
        }
    };
    let _ = PROOF.set(Proof {
        log,
        line,
        started: Instant::now(),
        #[cfg(feature = "update-proof")]
        origin,
    });
    proof_say(&format!(
        "v{} {} · Windows · {}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::ARCH,
        std::env::current_exe()
            .map(|p| p.display().to_string())
            .unwrap_or_default()
    ));
    true
}

/// The app's configuration, for a proof that asks a stand-in: the updater's one
/// address is the stand-in's (telemetry/allowlist.rs `proof::point_updater`),
/// and nothing else changes, the key an update is verified with least of all.
/// Called before the app is built, since the plugin reads its configuration
/// once, as it starts.
#[cfg(feature = "update-proof")]
pub fn proof_context<R: Runtime>(mut context: tauri::Context<R>) -> tauri::Context<R> {
    let Some(origin) = proof_origin() else {
        return context;
    };
    match context
        .config_mut()
        .plugins
        .0
        .get_mut("updater")
        .and_then(Value::as_object_mut)
    {
        Some(updater) => {
            let endpoint = crate::telemetry::allowlist::proof::point_updater(updater, origin);
            proof_say(&format!(
                "the updater asks a stand-in of the service: {endpoint}"
            ));
        }
        None => {
            proof_say("FAILED: this build has no updater configuration to point at the stand-in");
            std::process::exit(2);
        }
    }
    context
}

/// One line of the proof's log, which the script reads after this process is gone.
fn proof_say(line: &str) {
    use std::io::Write as _;
    let Some(proof) = PROOF.get() else { return };
    let line = format!("[{:>7}ms] {line}\n", proof.started.elapsed().as_millis());
    print!("[update-proof] {line}");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&proof.log)
    {
        let _ = f.write_all(line.as_bytes());
    }
}

/// What the proof's page needs: the line to type.
#[tauri::command]
pub fn selftest_proof_context() -> Result<Value, String> {
    let proof = PROOF.get().ok_or("no update proof is running")?;
    Ok(json!({ "line": proof.line }))
}

/// A line from the proof's page, into its log.
#[tauri::command]
pub fn selftest_proof_log(line: String) -> Result<(), String> {
    PROOF.get().ok_or("no update proof is running")?;
    proof_say(&line);
    Ok(())
}

/// The folder "A folder I choose…" gets in a test.
pub fn picked_folder() -> Option<String> {
    let folder = PathBuf::from(std::env::var_os(FOLDER)?);
    say(&format!("the folder picker answers {}", folder.display()));
    Some(folder.to_string_lossy().into_owned())
}

/// Where an export goes in a test: the file the save panel would have named,
/// in the run's own folder.
pub fn export_destination(name: &str) -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os(EXPORTS)?);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(Path::new(name).file_name()?))
}

/// The file the last export wrote, by name and base64, for a check to read
/// back: what landed on disk, not what the page meant to write.
#[tauri::command]
pub fn selftest_exported() -> Result<Option<Value>, String> {
    use base64::Engine as _;
    let dir = PathBuf::from(std::env::var_os(EXPORTS).ok_or("no test is running")?);
    let newest = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .max();
    let Some((_, path)) = newest else {
        return Ok(None);
    };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(json!({
        "name": path.file_name().map(|n| n.to_string_lossy().into_owned()),
        "base64": base64::engine::general_purpose::STANDARD.encode(bytes),
    })))
}

/// What the app asked File Explorer to show, in order, while a test runs.
static REVEALS: Mutex<Vec<Value>> = Mutex::new(Vec::new());

/// Keep a reveal instead of running it, when a test is running. Returns
/// whether it was kept.
pub fn record_reveal((how, path): (&str, &Path)) -> bool {
    if !running() {
        return false;
    }
    say(&format!("reveal: {how} {}", path.display()));
    REVEALS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .push(json!({
            "how": how,
            "path": path.to_string_lossy(),
            "exists": path.exists(),
            "isDir": path.is_dir(),
        }));
    true
}

/// Every reveal kept so far.
#[tauri::command]
pub fn selftest_reveals() -> Result<Value, String> {
    if !running() {
        return Err("no test is running".into());
    }
    Ok(Value::Array(
        REVEALS.lock().unwrap_or_else(|p| p.into_inner()).clone(),
    ))
}

/// The chip this build is, for a check that says which wrote an export. A
/// PC's x64 is not an Intel Mac (docs/app/preferences-and-help/settings.md#SET-40):
/// `mac` says so.
#[tauri::command]
pub fn selftest_slice() -> Value {
    json!({ "arch": std::env::consts::ARCH, "translated": false, "mac": false })
}

/// A line a check wants in the run's output.
#[tauri::command]
pub fn selftest_log(line: String) {
    say(&line);
}

/// What a Mac's run reads of AppKit's input state; a PC's driver reads the
/// page from outside, so there is nothing here to add.
#[tauri::command]
pub fn selftest_input_facts() -> Value {
    json!({})
}
