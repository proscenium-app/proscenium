// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The native self-test (docs/engineering/release-engineering.md#REL-D4): smoke's checks, run inside
//! this app's own WKWebView, on the real Rust vault, on every Mac CI has.
//!
//! `bun run smoke` proves the shipped bundle in headless Chromium. The app is
//! WebKit, and before this nothing had ever run it below macOS 26.6 or on an
//! Intel Mac: every claim about an older Mac was a feature table. Launched with
//! `PROSCENIUM_SELFTEST=<report.json>`, a `selftest` build:
//!
//!  1. points the whole app at an empty temporary home and "picks" a fresh copy
//!     of sample-vault/ as its Plays folder — the real vault, watcher and
//!     settings code, on data nobody minds losing;
//!  2. runs scripts/smoke-checks.mjs in the page through the harness
//!     (scripts/selftest/harness.mjs), which asks this module for native key and
//!     mouse events, so input arrives through the menu bar and WebKit exactly as
//!     a writer's does;
//!  3. runs them in light, then dark, capturing the window after every check;
//!  4. writes the report and exits non-zero on any failure, or when the
//!     watchdog fires because the page never got far enough to say.
//!
//! **Unreachable in a shipped build.** The module, its commands, the
//! environment variable and the harness exist only with the Cargo feature;
//! `scripts/check-bundle.mjs --release` fails a binary that contains the word.
//! A self-test app is also a different app — its own bundle id, and a
//! non-persistent webview (scripts/build-app.mjs) — so a run on a writer's Mac
//! cannot touch their preferences, their WebKit storage or their plays.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::plugin::{Builder as PluginBuilder, TauriPlugin};
use tauri::{Runtime, Theme, WebviewWindow};

/// sample-vault/, embedded at build time (build.rs).
const VAULT: &[(&str, &[u8])] = include!(concat!(env!("OUT_DIR"), "/selftest_vault.rs"));

/// scripts/selftest/harness.mjs, bundled by scripts/build-app.mjs --selftest.
const HARNESS: &str = include_str!(env!("PROSCENIUM_SELFTEST_HARNESS"));

/// Smoke runs every check in both schemes; so does this.
const PASSES: [(&str, Theme); 2] = [("light", Theme::Light), ("dark", Theme::Dark)];

/// Long enough for the slowest runner to do both passes, short enough that a
/// page that never loads fails in minutes rather than at the job's timeout.
const DEFAULT_TIMEOUT_SECS: u64 = 420;

struct Run {
    report: PathBuf,
    shots: PathBuf,
    root: PathBuf,
    home: PathBuf,
    brk: Option<String>,
    /// Only the checks whose names contain this (`selftest.mjs --only`).
    only: Option<String>,
    started: Instant,
    state: Mutex<State>,
}

#[derive(Default)]
struct State {
    pass: usize,
    /// Finished passes.
    results: Vec<Value>,
    /// The running pass's checks, kept as they land: a run the watchdog ends
    /// still reports what failed before it hung.
    checks: Vec<Value>,
    /// Set when a check reloaded the page mid-pass: where the next page's
    /// harness resumes, and the console errors and advice the old page saw.
    resume_at: usize,
    carried_console: Vec<Value>,
    carried_advisories: serde_json::Map<String, Value>,
    finished: bool,
}

static RUN: OnceLock<Run> = OnceLock::new();

/// The test window's number, for captures made off the main thread.
static WINDOW_NUMBER: OnceLock<isize> = OnceLock::new();

/// What WebKit was told so the page keeps running and drawing behind a locked
/// screen (native::keep_drawing), as the report records it.
static DRAWING: OnceLock<Value> = OnceLock::new();

/// Whether the test window stood in as key behind a locked screen
/// (native::claim_key_status), as the report records it.
static KEY_STATUS: OnceLock<&'static str> = OnceLock::new();

fn run() -> Result<&'static Run, String> {
    RUN.get().ok_or_else(|| "no self-test is running".to_string())
}

fn say(line: &str) {
    let ms = RUN.get().map(|r| r.started.elapsed().as_millis()).unwrap_or(0);
    println!("[selftest {:>6}ms] {line}", ms);
}

/// The plugin that carries the harness into every page load. Commands are app
/// commands (lib.rs), because a plugin's commands need an ACL grant and this
/// must never have one.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    let builder = PluginBuilder::new("selftest");
    if !begin() {
        return builder.build();
    }
    builder
        .js_init_script(HARNESS)
        .setup(|_app, _api| {
            start_watchdog();
            native::report_synthesized_buttons();
            Ok(())
        })
        // Before the page runs a line: a check that starts while the screen is
        // locked must already be drawing.
        .on_webview_ready(|webview| {
            if webview.label() == "main" {
                let _ = webview.with_webview(|platform| {
                    let applied = native::keep_drawing(platform.inner());
                    say(&format!("drawing behind a locked screen: {applied}"));
                    let _ = DRAWING.set(applied);
                });
            }
        })
        // The config window is created after plugins set up, so it is met here.
        .on_window_ready(|window| {
            if window.label() == "main" {
                if let Ok(ns_window) = window.ns_window() {
                    let _ = WINDOW_NUMBER.set(native::window_number(ns_window));
                    if native::claim_key_status(ns_window) {
                        say("the screen is locked: the test window stands in as key");
                        let _ = KEY_STATUS.set("claimed behind a locked screen");
                    }
                }
                let _ = window.set_theme(Some(PASSES[0].1));
                // Input goes to the key window, so the test window must be it.
                let _ = window.set_focus();
            }
        })
        .build()
}

/// Read the environment and prepare the run, before anything resolves a path.
fn begin() -> bool {
    let Some(report) = std::env::var_os("PROSCENIUM_SELFTEST").map(PathBuf::from) else {
        return false;
    };
    let report = if report.is_absolute() {
        report
    } else {
        std::env::current_dir().map(|d| d.join(&report)).unwrap_or(report)
    };
    let shots = report.parent().map(Path::to_path_buf).unwrap_or_default();
    let _ = std::fs::create_dir_all(&shots);

    let root = std::env::temp_dir().join(format!("proscenium-selftest-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let home = root.join("home");
    if let Err(e) = std::fs::create_dir_all(&home) {
        eprintln!("[selftest] cannot create {}: {e}", home.display());
        std::process::exit(2);
    }
    // Every per-user directory the app resolves — settings, the play stores,
    // the debug log, Documents — now lives under an empty home. This runs
    // before the Tauri builder exists, while the process has one thread.
    std::env::set_var("HOME", &home);

    let brk = std::env::var("PROSCENIUM_SELFTEST_BREAK").ok().filter(|b| !b.is_empty());
    let only = std::env::var("PROSCENIUM_SELFTEST_ONLY").ok().filter(|o| !o.is_empty());
    let _ = RUN.set(Run {
        report,
        shots,
        root,
        home,
        brk,
        only,
        started: Instant::now(),
        state: Mutex::new(State::default()),
    });
    let run = RUN.get().unwrap();
    if let Err(e) = copy_vault(&plays_dir(run, 0)) {
        eprintln!("[selftest] cannot copy the sample vault: {e}");
        std::process::exit(2);
    }
    say(&format!(
        "v{} {} {}translated · macOS {} · report {}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::ARCH,
        if is_translated() { "" } else { "not " },
        macos_version(),
        run.report.display()
    ));
    true
}

fn start_watchdog() {
    let timeout = std::env::var("PROSCENIUM_SELFTEST_TIMEOUT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(DEFAULT_TIMEOUT_SECS);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(timeout));
        let pass = run().map(|r| r.state.lock().unwrap().pass).unwrap_or(0);
        // The window only, never the whole screen: on a desktop the screen is
        // someone's other work.
        if let (Ok(run), Some(number)) = (run(), WINDOW_NUMBER.get()) {
            let _ = std::process::Command::new("/usr/sbin/screencapture")
                .args(["-x", "-o", "-l", &number.to_string()])
                .arg(run.shots.join("timeout.window.png"))
                .status();
        }
        finish(Some(format!(
            "timed out after {timeout}s in the {} pass — the page never reported back",
            PASSES.get(pass).map(|p| p.0).unwrap_or("last")
        )));
    });
}

/// Each pass gets its own copy of the vault, so a watcher still holding the
/// last one never sees this one's files move.
fn plays_dir(run: &Run, pass: usize) -> PathBuf {
    run.root.join(format!("plays-{}", PASSES[pass].0))
}

fn copy_vault(dest: &Path) -> std::io::Result<()> {
    for (rel, bytes) in VAULT {
        let path = dest.join(rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, bytes)?;
    }
    Ok(())
}

/// The folder the welcome screen's "A folder I choose…" gets in a self-test:
/// the system panel is the one thing that cannot be driven, and everything
/// after it — the bookmark, the stored path, the open — runs for real.
pub fn picked_folder() -> Option<String> {
    let run = RUN.get()?;
    let pass = run.state.lock().ok()?.pass;
    Some(plays_dir(run, pass.min(PASSES.len() - 1)).to_string_lossy().to_string())
}

/// Where an export goes in a self-test: the save panel is the one thing that
/// cannot be driven, and everything after it — the bytes, the atomic write,
/// the file on disk — runs for real (docs/engineering/release-engineering.md#REL-121).
/// A folder of the run's own evidence, beside the report, so a CI run keeps
/// what each slice wrote.
pub fn export_destination(name: &str) -> Option<PathBuf> {
    let run = RUN.get()?;
    let dir = run.shots.join("exports");
    std::fs::create_dir_all(&dir).ok()?;
    let leaf = Path::new(name).file_name()?;
    Some(dir.join(leaf))
}

/// The file the last export wrote, by name and base64, for a check to read
/// back: what landed on disk, not what the page meant to write.
#[tauri::command]
pub fn selftest_exported() -> Result<Option<Value>, String> {
    use base64::Engine as _;
    let dir = run()?.shots.join("exports");
    let newest = std::fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .max();
    let Some((_, path)) = newest else { return Ok(None) };
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(json!({
        "name": path.file_name().map(|n| n.to_string_lossy().into_owned()),
        "base64": base64::engine::general_purpose::STANDARD.encode(bytes),
    })))
}

/// What the app asked Finder to show, in order, while a self-test runs.
static REVEALS: Mutex<Vec<Value>> = Mutex::new(Vec::new());

/// Keep a reveal instead of running it, when a self-test is running: `open`
/// would put a Finder window on the build host for every pass. Returns whether
/// it was kept.
pub fn record_reveal((how, path): (&str, &Path)) -> bool {
    if RUN.get().is_none() {
        return false;
    }
    say(&format!("reveal: {how} {}", path.display()));
    REVEALS.lock().unwrap_or_else(|p| p.into_inner()).push(json!({
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
    run()?;
    Ok(Value::Array(REVEALS.lock().unwrap_or_else(|p| p.into_inner()).clone()))
}

/// Which slice this is and whether it runs translated, for a check that must
/// say what it proved (the Intel slice under Rosetta, docs/engineering/release-engineering.md#REL-121).
#[tauri::command]
pub fn selftest_slice() -> Value {
    json!({ "arch": std::env::consts::ARCH, "translated": is_translated() })
}

#[tauri::command]
pub fn selftest_context() -> Result<Value, String> {
    let run = run()?;
    let state = run.state.lock().unwrap();
    let pass = state.pass;
    Ok(json!({
        "pass": PASSES[pass.min(PASSES.len() - 1)].0,
        "index": pass,
        "total": PASSES.len(),
        "break": run.brk,
        "only": run.only,
        "resumeAt": state.resume_at,
    }))
}

#[tauri::command]
pub fn selftest_log(line: String) {
    say(&line);
}

/// A check is about to reload the page (smoke-checks.mjs allows it only as a
/// check's last statement): keep what the page knew, for the page after it.
#[tauri::command]
pub fn selftest_reload(resume_at: usize, console: Vec<Value>, advisories: serde_json::Map<String, Value>) -> Result<(), String> {
    let run = run()?;
    let mut state = run.state.lock().unwrap();
    state.resume_at = resume_at;
    state.carried_console.extend(console);
    merge_advisories(&mut state.carried_advisories, advisories);
    say("the page reloads; the next check resumes on the new one");
    Ok(())
}

/// Union the surfaces each piece of advice was seen on.
fn merge_advisories(into: &mut serde_json::Map<String, Value>, from: serde_json::Map<String, Value>) {
    for (id, advice) in from {
        let entry = into.entry(id).or_insert_with(|| json!({ "help": advice["help"], "surfaces": [] }));
        let mut surfaces: Vec<Value> = entry["surfaces"].as_array().cloned().unwrap_or_default();
        for surface in advice["surfaces"].as_array().into_iter().flatten() {
            if !surfaces.contains(surface) {
                surfaces.push(surface.clone());
            }
        }
        entry["surfaces"] = Value::Array(surfaces);
    }
}

/// One check's result, the moment it has one.
#[tauri::command]
pub fn selftest_check(result: Value) -> Result<(), String> {
    run()?.state.lock().unwrap().checks.push(result);
    Ok(())
}

/// One key, down and up, as the NSEvent fields AppKit would have made for it.
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KeyEvent {
    key_code: u16,
    characters: String,
    characters_ignoring_modifiers: String,
    modifier_flags: usize,
}

#[tauri::command]
pub async fn selftest_key(window: WebviewWindow, event: KeyEvent) -> Result<(), String> {
    on_webview(&window, move |webview, ns_window| native::key(webview, ns_window, &event)).await
}

/// A left click at a point in the page's CSS pixels.
#[tauri::command]
pub async fn selftest_click(window: WebviewWindow, x: f64, y: f64, press: Option<bool>) -> Result<(), String> {
    // `press: false` only moves the pointer there: where it rests decides hover.
    let press = press.unwrap_or(true);
    on_webview(&window, move |webview, ns_window| native::click(webview, ns_window, x, y, press)).await
}

/// Where native input would go now, for a key or click the page never saw.
#[tauri::command]
pub async fn selftest_input_facts(window: WebviewWindow) -> Result<Value, String> {
    run()?;
    on_webview(&window, |_, ns_window| {
        Ok(json!({
            "firstResponder": native::first_responder(ns_window),
            "markedText": native::marked_text(ns_window),
            "locked": native::screen_locked(),
        }))
    })
    .await
}

/// Playwright's setViewportSize: the page's content becomes exactly this size.
/// A check narrows the window below the app's own minimum to prove the layout
/// reflows, so the self-test lifts that minimum for the run; the shipped app
/// never has this command.
#[tauri::command]
pub fn selftest_resize(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    run()?;
    window
        .set_min_size(Some(tauri::LogicalSize::new(320.0, 240.0)))
        .map_err(|e| e.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

/// The window as the screen shows it (`screencapture -l`, which needs the
/// Screen Recording grant and silently draws only the desktop without it), and
/// what WebKit itself drew (a WKWebView snapshot, which needs no grant). The
/// second is the one that proves a blank page is blank.
#[tauri::command]
pub async fn selftest_capture(window: WebviewWindow, name: String) -> Result<(), String> {
    let run = run()?;
    let safe: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
        .collect();
    let number = on_webview(&window, |_, ns_window| Ok(native::window_number(ns_window))).await?;
    let _ = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-o", "-l", &number.to_string()])
        .arg(run.shots.join(format!("{safe}.window.png")))
        .status();

    let (tx, rx) = mpsc::channel();
    on_webview(&window, move |webview, _| {
        native::snapshot(webview, tx);
        Ok(())
    })
    .await?;
    let png = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "the webview snapshot never came back".to_string())?
    })
    .await
    .map_err(|e| e.to_string())??;
    std::fs::write(run.shots.join(format!("{safe}.png")), png).map_err(|e| e.to_string())
}

/// scripts/selftest/ax-walk.js: WebKit's accessibility tree, read in the inspector.
const AX_WALK: &str = include_str!("../../scripts/selftest/ax-walk.js");

/// WebKit's own accessibility tree for the element `selector` names
/// (docs/app/preferences-and-help/accessibility.md#A11Y-16), as JSON: the roles,
/// names, states and live regions its NSAccessibility wrapper gives VoiceOver.
///
/// Read through the app's own Web Inspector, connected in-process: the
/// inspector's `DOM.getAccessibilityPropertiesForNode` answers from WebKit's
/// AccessibilityObject in the web content process. The other routes need a
/// grant a person clicks: the AX API on this pid needs the Accessibility
/// permission, and an NSAccessibility walk from the window stops at WebKit's
/// remote element, which crosses into the web process only for a trusted
/// client. This one needs nothing, and a shipped build has no inspector to
/// connect (no `selftest`, no developer extras).
#[tauri::command]
pub async fn selftest_ax(window: WebviewWindow, selector: String) -> Result<String, String> {
    run()?;
    let script = format!("const selector = {};\n{AX_WALK}", serde_json::to_string(&selector).map_err(|e| e.to_string())?);
    // The inspector's page loads after it connects: wait for it, a few seconds at most.
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let (tx, rx) = mpsc::channel();
        let script = script.clone();
        on_webview(&window, move |webview, _| {
            native::ax_tree(webview, &script, tx);
            Ok(())
        })
        .await?;
        let answer = tauri::async_runtime::spawn_blocking(move || {
            rx.recv_timeout(Duration::from_secs(20))
                .map_err(|_| "the inspector never answered".to_string())?
        })
        .await
        .map_err(|e| e.to_string())?;
        match answer {
            Ok(json) => return Ok(json),
            Err(e) if Instant::now() < deadline && native::inspector_loading(&e) => {
                tokio_sleep(Duration::from_millis(250)).await;
            }
            Err(e) => return Err(e),
        }
    }
}

async fn tokio_sleep(d: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

/// One surface's accessibility tree, as the harness wrote it in one scheme:
/// kept with the run's evidence (`<report dir>/aria/<name>.<scheme>.yml`),
/// and held against the checked-in expectation, which is returned, or null
/// when there is none. The expectation is `PROSCENIUM_SELFTEST_ARIA/<name>.yml`,
/// or `<name>.dark.yml` in the dark pass where the dark scheme reads the
/// surface otherwise (an Appearance menu naming the scheme it is in).
#[tauri::command]
pub fn selftest_aria(name: String, text: String, scheme: Option<String>) -> Result<Option<String>, String> {
    let run = run()?;
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("{name:?} is not a surface's file name"));
    }
    let scheme = scheme.unwrap_or_else(|| "light".into());
    if !matches!(scheme.as_str(), "light" | "dark") {
        return Err(format!("{scheme:?} is not a scheme"));
    }
    let dir = run.shots.join("aria");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{name}.{scheme}.yml")), format!("{text}\n")).map_err(|e| e.to_string())?;
    let Some(expected) = std::env::var_os("PROSCENIUM_SELFTEST_ARIA").map(PathBuf::from) else {
        return Ok(None);
    };
    let variant = expected.join(format!("{name}.{scheme}.yml"));
    let file = if scheme != "light" && variant.exists() { variant } else { expected.join(format!("{name}.yml")) };
    match std::fs::read_to_string(file) {
        Ok(t) => Ok(Some(t.trim_end().to_string())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// A pass is over: keep its results, then start the next from nothing, or end.
#[tauri::command]
pub fn selftest_done(window: WebviewWindow, result: Value) -> Result<(), String> {
    let run = run()?;
    let next = {
        let mut state = run.state.lock().unwrap();
        let mut result = result;
        result["checks"] = Value::Array(std::mem::take(&mut state.checks));
        // What a mid-pass reload carried over belongs to this pass.
        let mut console = std::mem::take(&mut state.carried_console);
        console.extend(result["console"].as_array().cloned().unwrap_or_default());
        result["console"] = Value::Array(console);
        let mut advisories = std::mem::take(&mut state.carried_advisories);
        if let Some(Value::Object(seen)) = result.get("advisories").cloned() {
            merge_advisories(&mut advisories, seen);
        }
        result["advisories"] = Value::Object(advisories);
        state.resume_at = 0;
        state.results.push(result);
        state.pass += 1;
        state.pass
    };
    let stop = run.state.lock().unwrap().results.last().is_some_and(|r| r["stop"] == true);
    if next >= PASSES.len() || stop {
        finish(None);
    }
    // A fresh first launch, as smoke's fresh browser context is: no settings,
    // no play stores, no remembered Plays folder, no local storage, and an
    // untouched copy of the vault.
    for dir in [run.home.join("Library"), run.home.join("Documents")] {
        if dir.starts_with(&run.root) {
            let _ = std::fs::remove_dir_all(&dir);
        }
    }
    copy_vault(&plays_dir(run, next)).map_err(|e| e.to_string())?;
    window.set_theme(Some(PASSES[next].1)).map_err(|e| e.to_string())?;
    say(&format!("starting the {} pass", PASSES[next].0));
    window
        .eval("try { localStorage.clear(); sessionStorage.clear(); } catch {} location.reload();")
        .map_err(|e| e.to_string())
}

/// Write the report and exit: 0 only when both passes ran and nothing failed.
fn finish(error: Option<String>) -> ! {
    let Ok(run) = run() else { std::process::exit(2) };
    let results = {
        let mut state = run.state.lock().unwrap();
        if state.finished {
            // The watchdog and the last pass can race; one report is enough.
            drop(state);
            loop {
                std::thread::sleep(Duration::from_secs(60));
            }
        }
        state.finished = true;
        let mut results = state.results.clone();
        if !state.checks.is_empty() {
            results.push(json!({
                "scheme": PASSES.get(state.pass).map(|p| p.0).unwrap_or("?"),
                "checks": state.checks,
                "console": [],
                "unfinished": true,
            }));
        }
        results
    };

    let mut failures: Vec<String> = Vec::new();
    for pass in &results {
        let scheme = pass["scheme"].as_str().unwrap_or("?");
        if let Some(crash) = pass["crash"].as_str() {
            // The first line is the message; the stack stays in the report.
            failures.push(format!("{scheme} · harness crashed: {}", crash.lines().next().unwrap_or("")));
        }
        for check in pass["checks"].as_array().into_iter().flatten() {
            if check["ok"] != true {
                failures.push(format!(
                    "{scheme} · {}: {}",
                    check["name"].as_str().unwrap_or("?"),
                    check["error"].as_str().unwrap_or("").lines().next().unwrap_or("")
                ));
            }
        }
        // Smoke fails a scheme on any console error, and so does this.
        if pass["console"].as_array().is_some_and(|c| !c.is_empty()) {
            failures.push(format!("{scheme} · console: {}", pass["console"][0]));
        }
    }
    if let Some(e) = &error {
        failures.push(e.clone());
    }
    let completed = results.iter().filter(|p| p.get("unfinished").is_none()).count();
    if completed < PASSES.len() && error.is_none() {
        failures.push(format!("only {completed} of {} passes ran", PASSES.len()));
    }

    let ok = failures.is_empty();
    let report = json!({
        "ok": ok,
        "failures": failures,
        "app": {
            "version": env!("CARGO_PKG_VERSION"),
            "arch": std::env::consts::ARCH,
            "translated": is_translated(),
            "macos": macos_version(),
            "drawing": DRAWING.get().cloned().unwrap_or(Value::Null),
            "keyStatus": KEY_STATUS.get().copied().unwrap_or("real"),
            "break": run.brk,
            "only": run.only,
        },
        "durationMs": run.started.elapsed().as_millis() as u64,
        "passes": results,
    });
    let text = serde_json::to_string_pretty(&report).unwrap_or_default();
    if let Err(e) = std::fs::write(&run.report, text) {
        eprintln!("[selftest] could not write {}: {e}", run.report.display());
    }
    if std::env::var_os("PROSCENIUM_SELFTEST_KEEP").is_none() && run.root.starts_with(std::env::temp_dir()) {
        let _ = std::fs::remove_dir_all(&run.root);
    }

    if ok {
        say(&format!("clean — both passes in {}s", run.started.elapsed().as_secs()));
    } else {
        say(&format!("{} failure(s):", failures.len()));
        for f in &failures {
            say(&format!("  {f}"));
        }
    }
    std::process::exit(if ok { 0 } else { 1 })
}

/// Run `f` on the main thread with the WKWebView and its NSWindow, and wait.
async fn on_webview<T, F>(window: &WebviewWindow, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(*mut std::ffi::c_void, *mut std::ffi::c_void) -> Result<T, String> + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |webview| {
            let _ = tx.send(f(webview.inner(), webview.ns_window()));
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "the main thread never ran the self-test's request".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Whether this process is an Intel slice running under Rosetta. The CI Intel
/// runner must say no: a universal app that only ever ran translated has not
/// proved its x86_64 slice runs natively.
fn is_translated() -> bool {
    let mut value: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let rc = unsafe {
        libc::sysctlbyname(
            c"sysctl.proc_translated".as_ptr(),
            (&mut value as *mut libc::c_int).cast(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    rc == 0 && value == 1
}

fn macos_version() -> String {
    objc2_foundation::NSProcessInfo::processInfo()
        .operatingSystemVersionString()
        .to_string()
}

/// The AppKit half, main thread only.
mod native {
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::mpsc::Sender;

    use block2::RcBlock;
    use std::sync::atomic::{AtomicPtr, AtomicUsize};

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, Imp, NSObjectProtocol, Sel};
    use objc2::{msg_send, sel, ClassType, MainThreadMarker};
    use objc2_app_kit::{
        NSApplication, NSBitmapImageFileType, NSBitmapImageRep, NSEvent, NSEventModifierFlags,
        NSEventType, NSImage, NSView, NSWindow,
    };
    use objc2_app_kit::{
        NSWindowDidBecomeKeyNotification, NSWindowDidBecomeMainNotification, NSWindowDidChangeOcclusionStateNotification,
    };
    use objc2_foundation::{NSDictionary, NSError, NSNotificationCenter, NSPoint, NSProcessInfo, NSString};
    use objc2_web_kit::{WKInactiveSchedulingPolicy, WKWebView};

    use super::KeyEvent;

    static EVENT_NUMBER: AtomicIsize = AtomicIsize::new(1);

    /// What the harness waits out: another app has the keyboard.
    pub const NOT_KEY: &str = "not-key-window";

    fn now() -> f64 {
        NSProcessInfo::processInfo().systemUptime()
    }

    /// Whether the console session's screen is locked. Then no app can become
    /// active, so no window is ever key — and nobody can be using the Mac.
    pub fn screen_locked() -> bool {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn CGSessionCopyCurrentDictionary() -> *const c_void;
        }
        #[link(name = "CoreFoundation", kind = "framework")]
        extern "C" {
            fn CFRelease(cf: *const c_void);
        }
        let dict = unsafe { CGSessionCopyCurrentDictionary() };
        if dict.is_null() {
            return false;
        }
        let dictionary = unsafe { &*(dict as *const NSDictionary<NSString, objc2::runtime::AnyObject>) };
        let key = NSString::from_str("CGSSessionScreenIsLocked");
        let locked = dictionary.objectForKey(&key).is_some_and(|v| {
            let on: bool = unsafe { msg_send![&*v, boolValue] };
            on
        });
        unsafe { CFRelease(dict) };
        locked
    }

    /// The mouse buttons a synthesized click holds down: bit 0 is the left.
    static PRESSED: AtomicUsize = AtomicUsize::new(0);

    extern "C-unwind" fn pressed_mouse_buttons(_class: &AnyObject, _cmd: Sel) -> usize {
        PRESSED.load(Ordering::Relaxed)
    }

    /// WebKit reads which buttons are down from `+[NSEvent pressedMouseButtons]`,
    /// which reports the hardware, and a synthesized click never touches the
    /// hardware: every pointerdown said no button was held (`buttons` 0), as no
    /// real click does, and a handler that reads `buttons` would have been
    /// tested against a press that cannot happen. WebKit's own test runner
    /// answers the same way: the class method reports the synthesized state.
    /// Only in the self-test build, which never ships.
    pub fn report_synthesized_buttons() {
        let meta = NSEvent::class().metaclass();
        if let Some(method) = meta.instance_method(sel!(pressedMouseButtons)) {
            let imp: Imp = unsafe {
                std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel) -> usize, Imp>(pressed_mouse_buttons)
            };
            unsafe { method.set_implementation(imp) };
        }
    }

    /// The test window, while it stands in as key behind a locked screen.
    static STAND_IN: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());

    fn standing_in() -> bool {
        !STAND_IN.load(Ordering::Relaxed).is_null()
    }

    extern "C-unwind" fn stand_in_window(_this: &AnyObject, _cmd: Sel) -> *mut AnyObject {
        STAND_IN.load(Ordering::Relaxed)
    }

    extern "C-unwind" fn is_stand_in(this: &AnyObject, _cmd: Sel) -> Bool {
        Bool::new(std::ptr::eq(this, STAND_IN.load(Ordering::Relaxed)))
    }

    /// Behind a locked screen no app can become active, so no window is ever
    /// key, and three things a writer's Mac never sees break at once: a menu
    /// item with no target (Tauri's Undo, Copy, Paste, Select All) sends its
    /// action down the key window's responder chain and it goes nowhere; the
    /// page never has focus, so `:focus`, focus rings and the caret are off;
    /// and AppKit drops a plain key sent through the application. So, for the
    /// whole run and only while the screen is locked, the test window tells
    /// AppKit and WebKit it is key and main, so the self-test never needs the
    /// screen unlocked. Proven on the build host with
    /// a probe first: an untargeted undo: then reaches the page, and it has focus.
    pub fn claim_key_status(ns_window: *mut c_void) -> bool {
        let Some(mtm) = MainThreadMarker::new() else { return false };
        if !screen_locked() {
            return false;
        }
        STAND_IN.store(ns_window as *mut AnyObject, Ordering::Relaxed);
        let window = unsafe { &*(ns_window as *const NSWindow) };
        let app = NSApplication::sharedApplication(mtm);
        // Tauri subclasses both; replace on the classes the objects really are.
        let app_class = app.class();
        let window_class = window.class();
        let window_getter: Imp = unsafe {
            std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel) -> *mut AnyObject, Imp>(stand_in_window)
        };
        let is_window: Imp =
            unsafe { std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel) -> Bool, Imp>(is_stand_in) };
        for (class, selector, imp) in [
            (app_class, sel!(keyWindow), window_getter),
            (app_class, sel!(mainWindow), window_getter),
            (window_class, sel!(isKeyWindow), is_window),
            (window_class, sel!(isMainWindow), is_window),
        ] {
            if let Some(method) = class.instance_method(selector) {
                unsafe { method.set_implementation(imp) };
            }
        }
        announce_key(window);
        true
    }

    /// WebKit reads focus again when told its window became key and main.
    fn announce_key(window: &NSWindow) {
        let center = NSNotificationCenter::defaultCenter();
        unsafe {
            center.postNotificationName_object(NSWindowDidBecomeKeyNotification, Some(window));
            center.postNotificationName_object(NSWindowDidBecomeMainNotification, Some(window));
        }
    }

    /// Key events go to the key window. Nobody is at a CI runner to take it
    /// away; on a desktop, clicking elsewhere mid-run would, so take it back.
    fn make_key(mtm: MainThreadMarker, window: &NSWindow) {
        if !window.isKeyWindow() {
            NSApplication::sharedApplication(mtm).activate();
            window.makeKeyAndOrderFront(None);
        }
    }

    /// Keep the page running and drawing while nobody can see it — behind the
    /// build host's locked screen, where the self-test runs
    /// unattended. Only the self-test build has
    /// this, and it never ships. Returns what took effect, for the report.
    ///
    /// - An inactive webview's timers are neither throttled nor suspended:
    ///   `inactiveSchedulingPolicy`, public since macOS 14.
    /// - WebKit stops lowering the page to hidden when its window is covered,
    ///   as the lock screen covers every window: `_windowOcclusionDetectionEnabled`,
    ///   WebKit SPI, asked for by selector and reported when a WebKit lacks it.
    pub fn keep_drawing(webview: *mut c_void) -> serde_json::Value {
        let webview = unsafe { &*(webview as *const WKWebView) };
        let policy = unsafe {
            let preferences = webview.configuration().preferences();
            preferences.setInactiveSchedulingPolicy(WKInactiveSchedulingPolicy::None);
            preferences.inactiveSchedulingPolicy() == WKInactiveSchedulingPolicy::None
        };
        let occlusion = if webview.respondsToSelector(sel!(_setWindowOcclusionDetectionEnabled:)) {
            let _: () = unsafe { msg_send![webview, _setWindowOcclusionDetectionEnabled: false] };
            // WebKit decides visibility again only when told the window's
            // occlusion changed, and a window already behind the lock screen
            // has been decided hidden. Tell it, now that occlusion is ignored.
            if let Some(window) = webview.window() {
                let center = NSNotificationCenter::defaultCenter();
                unsafe {
                    center.postNotificationName_object(NSWindowDidChangeOcclusionStateNotification, Some(&window));
                }
                if standing_in() {
                    announce_key(&window);
                }
            }
            if webview.respondsToSelector(sel!(_windowOcclusionDetectionEnabled)) {
                let on: bool = unsafe { msg_send![webview, _windowOcclusionDetectionEnabled] };
                if on { "still on" } else { "off" }
            } else {
                "set, not readable"
            }
        } else {
            "not offered by this WebKit"
        };
        serde_json::json!({
            "inactiveSchedulingPolicy": if policy { "none" } else { "unchanged" },
            "occlusionDetection": occlusion,
        })
    }

    /// The class of the window's first responder: the page's input goes to it.
    pub fn first_responder(ns_window: *mut c_void) -> String {
        let window = unsafe { &*(ns_window as *const NSWindow) };
        window.firstResponder().map_or_else(|| "none".to_string(), |r| r.class().name().to_string_lossy().into_owned())
    }

    /// Whether the text input system holds marked text in the first responder —
    /// a composition, or inline predictive text — which takes the next click.
    pub fn marked_text(ns_window: *mut c_void) -> Option<bool> {
        let window = unsafe { &*(ns_window as *const NSWindow) };
        let responder = window.firstResponder()?;
        if !responder.respondsToSelector(sel!(hasMarkedText)) {
            return None;
        }
        let marked: bool = unsafe { msg_send![&*responder, hasMarkedText] };
        Some(marked)
    }

    pub fn window_number(ns_window: *mut c_void) -> isize {
        let window = unsafe { &*(ns_window as *const NSWindow) };
        window.windowNumber()
    }

    pub fn key(_webview: *mut c_void, ns_window: *mut c_void, event: &KeyEvent) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let window = unsafe { &*(ns_window as *const NSWindow) };
        make_key(mtm, window);
        // Activation lands a moment later, so the harness asks again; a key sent
        // now would go nowhere, since AppKit gives keys only to the key window.
        // Except behind a locked screen, where no window can ever be key and no
        // one can have taken the keyboard: there the application still hands a
        // synthesized key to the window's first responder, and the page gets it.
        if !window.isKeyWindow() && !screen_locked() {
            return Err(NOT_KEY.to_string());
        }
        let app = NSApplication::sharedApplication(mtm);
        let flags = NSEventModifierFlags(event.modifier_flags);
        let chars = NSString::from_str(&event.characters);
        let ignoring = NSString::from_str(&event.characters_ignoring_modifiers);
        for kind in [NSEventType::KeyDown, NSEventType::KeyUp] {
            let ns_event = NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
                kind,
                NSPoint::new(0.0, 0.0),
                flags,
                now(),
                window.windowNumber(),
                None,
                &chars,
                &ignoring,
                false,
                event.key_code,
            )
            .ok_or("AppKit would not make the key event")?;
            // Through the application, not the window: that is the path that
            // offers a ⌘-chord to the menu bar before the page sees it. Standing
            // in behind a locked screen, AppKit drops a plain key sent that way,
            // so a plain key goes to the window, whose first responder is the page.
            if !standing_in() {
                app.sendEvent(&ns_event);
            } else if !flags.contains(NSEventModifierFlags::Command) {
                window.sendEvent(&ns_event);
            } else if kind == NSEventType::KeyDown {
                // AppKit's own order for a key equivalent: the key window's views
                // first — the page, whose shortcuts handle ⌘Z and ⌘F themselves —
                // and the menu only if nothing in the window took it.
                let taken = window.contentView().is_some_and(|view| view.performKeyEquivalent(&ns_event));
                if !taken {
                    app.sendEvent(&ns_event);
                }
            } else {
                window.sendEvent(&ns_event);
            }
        }
        Ok(())
    }

    pub fn click(webview: *mut c_void, ns_window: *mut c_void, x: f64, y: f64, press: bool) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let window = unsafe { &*(ns_window as *const NSWindow) };
        let view = unsafe { &*(webview as *const NSView) };
        make_key(mtm, window);
        let bounds = view.bounds();
        let local = NSPoint::new(x, if view.isFlipped() { y } else { bounds.size.height - y });
        let point = view.convertPoint_toView(local, None);
        let app = NSApplication::sharedApplication(mtm);
        let kinds: &[NSEventType] = if press {
            &[NSEventType::MouseMoved, NSEventType::LeftMouseDown, NSEventType::LeftMouseUp]
        } else {
            &[NSEventType::MouseMoved]
        };
        for &kind in kinds {
            PRESSED.store(usize::from(kind == NSEventType::LeftMouseDown), Ordering::Relaxed);
            let ns_event = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
                kind,
                point,
                NSEventModifierFlags(0),
                now(),
                window.windowNumber(),
                None,
                EVENT_NUMBER.fetch_add(1, Ordering::Relaxed),
                if kind == NSEventType::MouseMoved { 0 } else { 1 },
                if kind == NSEventType::LeftMouseDown { 1.0 } else { 0.0 },
            )
            .ok_or("AppKit would not make the mouse event")?;
            app.sendEvent(&ns_event);
        }
        Ok(())
    }

    /// Whether an inspector error means only that its page has not loaded yet.
    pub fn inspector_loading(error: &str) -> bool {
        error.contains("inspector is still loading") || error.contains("Can't find variable: WI") || error.contains("mainTarget")
    }

    /// Run `script` (scripts/selftest/ax-walk.js) in this webview's own Web
    /// Inspector, connecting it the first time, and deliver what it returns.
    /// Developer extras are turned on for the self-test's webview alone; the
    /// inspector's window is never shown.
    pub fn ax_tree(webview: *mut c_void, script: &str, tx: Sender<Result<String, String>>) {
        let webview = unsafe { &*(webview as *const WKWebView) };
        let fail = |tx: &Sender<Result<String, String>>, e: &str| {
            let _ = tx.send(Err(e.to_string()));
        };
        if !webview.respondsToSelector(sel!(_inspector)) {
            return fail(&tx, "this WebKit has no _inspector");
        }
        unsafe {
            let preferences = webview.configuration().preferences();
            let yes = objc2_foundation::NSNumber::new_bool(true);
            let _: () = msg_send![&*preferences, setValue: &*yes, forKey: &*NSString::from_str("developerExtrasEnabled")];
        }
        let inspector: *mut AnyObject = unsafe { msg_send![webview, _inspector] };
        let Some(inspector) = (unsafe { inspector.as_ref() }) else {
            return fail(&tx, "the webview gave no inspector");
        };
        let connected: bool = unsafe { msg_send![inspector, isConnected] };
        if !connected {
            let _: () = unsafe { msg_send![inspector, connect] };
        }
        let frontend: *mut WKWebView = unsafe { msg_send![inspector, inspectorWebView] };
        let Some(frontend) = (unsafe { frontend.as_ref() }) else {
            return fail(&tx, "the inspector is still loading");
        };
        // The inspector's own page is hidden, and behind a locked screen WebKit
        // throttles a hidden page's timers until its promises stop answering
        // (the first CI run lost a surface's tree to that every few checks).
        // It runs as the app's page does; it is never shown, and never key.
        unsafe {
            frontend.configuration().preferences().setInactiveSchedulingPolicy(WKInactiveSchedulingPolicy::None);
            if frontend.respondsToSelector(sel!(_setWindowOcclusionDetectionEnabled:)) {
                let _: () = msg_send![frontend, _setWindowOcclusionDetectionEnabled: false];
            }
        }
        let body = NSString::from_str(script);
        let arguments = NSDictionary::<NSString, AnyObject>::new();
        let world: *mut AnyObject = unsafe { msg_send![objc2::class!(WKContentWorld), pageWorld] };
        let block = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
            if let Some(error) = unsafe { error.as_ref() } {
                let message = error
                    .userInfo()
                    .objectForKey(&NSString::from_str("WKJavaScriptExceptionMessage"))
                    .and_then(|m| m.downcast::<NSString>().ok())
                    .map(|m| m.to_string())
                    .unwrap_or_else(|| error.localizedDescription().to_string());
                let _ = tx.send(Err(message));
                return;
            }
            let text = unsafe { Retained::retain(result) }
                .and_then(|r| r.downcast::<NSString>().ok())
                .map(|r| r.to_string());
            let _ = tx.send(text.ok_or_else(|| "the inspector returned no text".to_string()));
        });
        unsafe {
            let _: () = msg_send![
                frontend,
                callAsyncJavaScript: &*body,
                arguments: &*arguments,
                inFrame: std::ptr::null::<AnyObject>(),
                inContentWorld: world,
                completionHandler: &*block
            ];
        }
    }

    /// What WebKit drew, as PNG bytes, delivered on `tx` when WebKit is done.
    pub fn snapshot(webview: *mut c_void, tx: Sender<Result<Vec<u8>, String>>) {
        let webview = unsafe { &*(webview as *const WKWebView) };
        let block = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
            let png = (|| {
                let image = unsafe { image.as_ref() }.ok_or("WebKit returned no image")?;
                let tiff = image.TIFFRepresentation().ok_or("the snapshot has no bitmap")?;
                let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("the snapshot has no bitmap")?;
                let data = unsafe {
                    rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
                }
                .ok_or("the snapshot would not encode as PNG")?;
                Ok::<_, &str>(data.to_vec())
            })()
            .map_err(str::to_string);
            let _ = tx.send(png);
        });
        unsafe { webview.takeSnapshotWithConfiguration_completionHandler(None, &block) };
    }
}
