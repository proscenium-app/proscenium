// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The iPad probe: the page's harness for the iPad simulator's proof
//! (scripts/ipad-sim.mjs). Exists only with Cargo's `ipad-probe` feature,
//! which only that script's simulator build turns on, and which no release
//! build carries: the bundle's check refuses a binary with its words in it
//! (scripts/check-bundle.mjs).
//!
//! The driver starts the app with one step of the proof in
//! `PROSCENIUM_IPAD_PROBE` (scripts/ipad/probe.js says what each does); the
//! page runs it and leaves its report in the app's cache, where
//! `simctl get_app_container` finds it. `PROSCENIUM_IPAD_PROBE_NO_RULES` builds
//! the window without WebKit's content rules: the network step's negative
//! control, which must see the connection the rules refuse.

use tauri::{AppHandle, Manager};

/// The probe's script, with its step, for a launch that asked for one.
pub fn script() -> Option<String> {
    let step = std::env::var("PROSCENIUM_IPAD_PROBE").ok()?;
    let probe = serde_json::json!({
        "step": step,
        "words": std::env::var("PROSCENIUM_IPAD_PROBE_WORDS").unwrap_or_default(),
        "port": std::env::var("PROSCENIUM_IPAD_PROBE_PORT").unwrap_or_default(),
    });
    Some(format!(
        "window.__PROSCENIUM_IPAD_PROBE__ = {probe};\n{}",
        include_str!("../../scripts/ipad/probe.js")
    ))
}

/// The negative control: no content rules in the web view.
pub fn without_rules() -> bool {
    std::env::var_os("PROSCENIUM_IPAD_PROBE_NO_RULES").is_some()
}

/// Every folder the vault opens coordinated, as one in iCloud Drive is: the
/// simulator has no iCloud account, so this is how the proof reaches the
/// coordinator.
pub fn coordinate_everything() -> bool {
    std::env::var_os("PROSCENIUM_IPAD_PROBE_COORDINATE").is_some()
}

/// A Plays folder iCloud has not brought down, stood in for
/// (docs/engineering/cross-platform.md#PLAT-69). The simulator has no iCloud
/// account, so the driver empties each play's folder into the folder that
/// `PROSCENIUM_IPAD_PROBE_ICLOUD` names, outside the Plays folder: each play is
/// then a name with nothing in it, as on an iPad that never downloaded it. A
/// download pass asks; by the next one, the first play still held has come
/// down, as iCloud brings down what an earlier pass asked for. None for a
/// launch that stages no such folder: then the iPad's own answer is asked.
pub fn download(root: &std::path::Path) -> Option<tauri_plugin_vault_picker::Downloading> {
    use std::sync::atomic::{AtomicBool, Ordering};
    static ASKED: AtomicBool = AtomicBool::new(false);
    let held = std::path::PathBuf::from(std::env::var_os("PROSCENIUM_IPAD_PROBE_ICLOUD")?);
    if ASKED.swap(false, Ordering::SeqCst) {
        if let Some(play) = names_in(&held).into_iter().next() {
            let from = held.join(&play);
            let to = root.join(&play);
            for name in names_in(&from) {
                if let Err(e) = std::fs::rename(from.join(&name), to.join(&name)) {
                    note(format!(
                        "download pass: {play}/{name} could not come down: {e}"
                    ));
                }
            }
            let _ = std::fs::remove_dir(&from);
            note(format!("download pass: {play} came down"));
        }
    }
    let waiting = files_under(&held);
    ASKED.store(waiting > 0, Ordering::SeqCst);
    note(format!("download pass: {waiting} waiting"));
    Some(tauri_plugin_vault_picker::Downloading {
        ubiquitous: true,
        waiting,
    })
}

/// A folder's entries' names, sorted, or none for a folder that is not there.
fn names_in(dir: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

/// How many files are anywhere under `dir`.
fn files_under(dir: &std::path::Path) -> u32 {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .map(|e| {
                    if e.file_type().is_ok_and(|t| t.is_dir()) {
                        files_under(&e.path())
                    } else {
                        1
                    }
                })
                .sum()
        })
        .unwrap_or(0)
}

/// The iPad's own download pass over the open folder, asked once by the probe's
/// step: the Swift side answers on the simulator too, where no folder is
/// iCloud's, so the step proves it is there and says so.
#[tauri::command]
pub async fn ipad_probe_swift_download(
    app: AppHandle,
    state: crate::ManagerState<'_>,
) -> Result<tauri_plugin_vault_picker::Downloading, String> {
    use crate::vault::Vault;
    use tauri_plugin_vault_picker::VaultPickerExt;
    let root = crate::current_vault(&state)?
        .root()
        .to_string_lossy()
        .into_owned();
    app.vault_picker()
        .download_folder(root)
        .map_err(|e| e.to_string())
}

/// What the app did that the report should say, in order.
static NOTES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

pub fn note(line: String) {
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    let at = START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_millis();
    NOTES
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .push(format!("{at} ms: {line}"));
}

/// A step's report, as `<app cache>/probe/<step>.json`.
#[tauri::command]
pub fn ipad_probe_report(app: AppHandle, step: String, data: String) -> Result<(), String> {
    if step.is_empty() || !step.bytes().all(|b| b.is_ascii_lowercase()) {
        return Err(format!("{step:?} is not a probe step"));
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("probe");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // With how many accesses went through the coordinator, which only Rust knows.
    let mut report: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("the report is not JSON: {e}"))?;
    if let Some(fields) = report.as_object_mut() {
        fields.insert("coordinated".into(), crate::ipad::coordinated().into());
        fields.insert(
            "coordinatedRoots".into(),
            crate::ipad::coordinated_roots().into(),
        );
        // Which of the probe's variables this launch was given, by name.
        let given: Vec<String> = std::env::vars_os()
            .map(|(k, _)| k.to_string_lossy().into_owned())
            .filter(|k| k.starts_with("PROSCENIUM_IPAD_PROBE"))
            .collect();
        fields.insert("given".into(), given.into());
        let notes = NOTES.lock().unwrap_or_else(|p| p.into_inner()).clone();
        fields.insert("notes".into(), notes.into());
    }
    crate::vault::write_atomic(
        &dir.join(format!("{step}.json")),
        report.to_string().as_bytes(),
    )
    .map_err(|e| e.to_string())
}
