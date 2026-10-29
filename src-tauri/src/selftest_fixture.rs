// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The faults smoke's checks stage, staged in the real app
//! (docs/engineering/release-engineering.md#REL-129).
//!
//! In a browser, smoke's checks run on the in-memory vault
//! (src/storage/dev-mock.ts), and they stage what a writer meets on a bad day
//! through its hooks: a save the disk refuses, a slow write a binder op waits
//! behind, a script still downloading, a version that cannot be read. Those
//! checks proved the failure paths against a stand-in and nothing else. A test
//! build answers the same hooks here, on the real Rust vault, its app data and
//! its watcher: `window.__prosceniumGate("write", rel, { fail })` holds or
//! refuses the real `vault_write` for that file, and the page meets the error
//! a refused write gives it. The page's half is scripts/selftest/fixture.mjs,
//! which the Mac's harness carries and smoke's WebView2 driver injects.
//!
//! **A test build's only.** The module, its one command and every call into it
//! exist with the `selftest` feature alone: nothing else in the crate names it
//! unless it is compiled with that feature, so a release build has no gate to
//! hold, no command to stage one and no word of it in the binary
//! (`scripts/check-bundle.mjs --release` on a Mac, and the Windows release
//! build's own scan, scripts/windows/release-build.mjs).

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::store::{app_data_dir, PlayStore};
use crate::vault::path_key::comparison_path;
use crate::vault::Vault;

/// The vault calls a gate can stand in front of, as the in-memory vault names
/// them: a held read is a script still downloading from iCloud, a held write a
/// slow disk, a held answer a write whose bytes are on disk while the disk makes
/// them durable, a held listing a folder not brought down yet; a failed one is
/// the error the page is given.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Op {
    Read,
    Write,
    /// A write that landed, before the page is told: `vault_write` answers
    /// only after its bytes are durable, and another writer can come in then.
    Answer,
    List,
    VersionSnapshot,
    VersionRead,
    /// A read of a play's app data (Changes' before- and after-texts), named
    /// by its key in the play's store, not a vault path.
    StoreRead,
}

struct Gate {
    op: Op,
    /// The file the call must name, as a comparison key; none for every call of
    /// its kind. A key ending in `*` names every key that starts with what
    /// comes before it.
    key: Option<String>,
    fail: Option<String>,
    /// The calls held here, in the order they came.
    waiting: Vec<Sender<()>>,
}

#[derive(Default)]
struct Gates {
    gates: Vec<Gate>,
    /// Calls a gate refused, by kind: how a check knows a refused save was tried again.
    failed: Vec<(Op, usize)>,
    /// Calls let through by an opened gate, still to go, in the order they came.
    released: VecDeque<Sender<()>>,
    /// Whether a released call is under way: the next goes when it is done.
    passing: bool,
}

fn gates() -> MutexGuard<'static, Gates> {
    static GATES: OnceLock<Mutex<Gates>> = OnceLock::new();
    GATES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

/// A vault path as a gate compares it: a file's one key, however a call spells it.
fn key_of(path: &Path) -> String {
    comparison_path(path).to_string_lossy().replace('\\', "/")
}

/// Where a call through a gate is: held calls, once let through, go one at a
/// time in the order they came, as the in-memory vault lets them, so that a
/// save queued behind a held one still lands after it. The next goes when
/// this is dropped, at the end of the command it was taken for.
pub struct Passage {
    released: bool,
}

impl Drop for Passage {
    fn drop(&mut self) {
        if self.released {
            release_next(&mut gates());
        }
    }
}

fn release_next(g: &mut Gates) {
    while let Some(next) = g.released.pop_front() {
        // A call that is no longer waiting (its command ended) is passed over.
        if next.send(()).is_ok() {
            g.passing = true;
            return;
        }
    }
    g.passing = false;
}

/// Before a vault call: through at once, held until a check opens its gate,
/// or refused with the gate's error. `path` is the file the call names (none
/// for a call that names none, a version's).
pub async fn pass(op: Op, path: Option<&Path>) -> Result<Passage, String> {
    pass_key(op, path.map(key_of)).await
}

/// `pass` for a call named by a key of its own: app data's, by its key in the play's store.
pub async fn pass_key(op: Op, key: Option<String>) -> Result<Passage, String> {
    let names = |gate: &Gate| match (&gate.key, &key) {
        (None, _) => true,
        (Some(want), Some(have)) => match want.strip_suffix('*') {
            Some(prefix) => have.starts_with(prefix),
            None => want == have,
        },
        (Some(_), None) => false,
    };
    let held = {
        let mut g = gates();
        let Some(at) = g.gates.iter().position(|gate| gate.op == op && names(gate)) else {
            return Ok(Passage { released: false });
        };
        if let Some(fail) = g.gates[at].fail.clone() {
            match g.failed.iter_mut().find(|(kind, _)| *kind == op) {
                Some((_, n)) => *n += 1,
                None => g.failed.push((op, 1)),
            }
            return Err(fail);
        }
        let (tx, rx) = channel();
        g.gates[at].waiting.push(tx);
        rx
    };
    // Off the command's thread, as a slow disk would be.
    let _ = tauri::async_runtime::spawn_blocking(move || held.recv()).await;
    Ok(Passage { released: true })
}

/// The watcher's health a check has staged, held until the check ends it;
/// none, for the watcher's own.
fn staged() -> MutexGuard<'static, Option<&'static str>> {
    static STAGED: Mutex<Option<&'static str>> = Mutex::new(None);
    STAGED.lock().unwrap_or_else(|p| p.into_inner())
}

/// The health a check is holding the watcher at, if one is: the watcher says
/// nothing over it, and its status answers it (watcher/mod.rs).
pub fn staged_health() -> Option<&'static str> {
    *staged()
}

/// What a check stands in for, of the system and the services, and what the
/// app handed them: everything here lasts until the next new page.
#[derive(Default)]
struct Stand {
    /// The accent the system answers: Some(None) for none.
    accent: Option<Option<String>>,
    /// Whether the system asks for a caret that does not blink.
    caret: Option<bool>,
    /// The version of the update a check staged, ready to install. A store
    /// build has no updater to stage one for.
    #[cfg_attr(not(all(desktop, feature = "updater")), allow(dead_code))]
    update: Option<String>,
    /// The updater's state before a check first stood in for another, put
    /// back when the page goes, as a reload makes the in-memory one afresh.
    update_before: Option<UpdateBefore>,
    /// An install of that update, waiting for the check to refuse it.
    installing: Option<Sender<()>>,
    /// Feedback the app would have sent, as it would have sent it.
    sent: Vec<Value>,
    /// The last message Copy Message copied.
    copied: String,
    /// What a copy put on the clipboard, where the system refused it to a test.
    clipboard: Option<String>,
    /// Sending fails as it does with no connection.
    offline: bool,
    /// Technical details are unavailable.
    no_details: bool,
    /// Every event the page asked to be recorded, as it asked, switch or no switch.
    asked: Vec<Value>,
    /// Every page error the page reported, by its name and frame count.
    page_errors: Vec<String>,
}

/// The updater's state, where there is an updater. A store build has none: the
/// store updates it (docs/engineering/release-engineering.md#REL-56).
#[cfg(all(desktop, feature = "updater"))]
type UpdateBefore = crate::updates::UpdateState;
#[cfg(not(all(desktop, feature = "updater")))]
type UpdateBefore = ();

fn stand() -> MutexGuard<'static, Stand> {
    static STAND: OnceLock<Mutex<Stand>> = OnceLock::new();
    STAND
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

/// Whether a self-test is running, rather than the update proof a test build also is.
pub fn testing() -> bool {
    crate::selftest::exports_dir().is_some()
}

/// The accent a check stands in for the system's (accent.rs).
pub fn staged_accent() -> Option<Option<String>> {
    stand().accent.clone()
}

/// The caret setting a check stands in for the system's (caret.rs).
pub fn staged_caret() -> Option<bool> {
    stand().caret
}

/// The update a check staged, by version (updates.rs `update_restart`).
#[cfg(all(desktop, feature = "updater"))]
pub fn staged_update() -> Option<String> {
    stand().update.clone()
}

/// An install of the staged update: until the check refuses it.
#[cfg(all(desktop, feature = "updater"))]
pub async fn installing() {
    let (tx, rx) = channel();
    stand().installing = Some(tx);
    let _ = tauri::async_runtime::spawn_blocking(move || rx.recv()).await;
}

/// Feedback the app sends, kept instead (feedback/mod.rs), or the error a
/// send with no connection gives.
pub fn keep_feedback(body: Value) -> Result<(), String> {
    let mut stand = stand();
    if stand.offline {
        return Err(
            "You're offline. Your message is saved here; try again once you're connected.".into(),
        );
    }
    stand.sent.push(body);
    Ok(())
}

/// What Copy Message copied (feedback/mod.rs).
pub fn feedback_copied(message: &str) {
    stand().copied = message.to_string();
}

/// The system refused its clipboard to a test, as Windows does to a session
/// behind a locked screen (telemetry/diagnostics.rs): true when a test is
/// running, and the words are kept as the clipboard's, with a line in the log.
#[cfg(windows)]
pub fn clipboard_refused(text: &str) -> bool {
    if !testing() {
        return false;
    }
    println!(
        "[selftest] the clipboard is refused to this session (a locked screen): {} characters kept instead",
        text.chars().count()
    );
    stand().clipboard = Some(text.to_string());
    true
}

/// Whether a check has made technical details unavailable (telemetry/mod.rs).
pub fn details_fail() -> bool {
    stand().no_details
}

/// An event the page asked to be recorded, as it asked (telemetry/mod.rs).
pub fn page_asked(event: Value) {
    stand().asked.push(event);
}

/// A page error the page reported (telemetry/mod.rs).
pub fn page_error(name: &str, frames: usize) {
    stand()
        .page_errors
        .push(format!("{name} {frames} frames").trim().to_string());
}

/// The quits a check asked, and what became of them.
#[derive(Default)]
struct Quits {
    /// Question ids the checks asked: answers to these are theirs, and never end the app.
    asked: Vec<u64>,
    heard: Vec<u64>,
    /// Answers that came before the check was waiting for them: (id, heard, go).
    answers: Vec<(u64, bool, bool)>,
    waiting: Vec<(u64, Sender<(bool, bool)>)>,
    /// The page said go, or the writer chose Quit Anyway: the app would be gone.
    gone: bool,
}

fn quits() -> MutexGuard<'static, Quits> {
    static QUITS: OnceLock<Mutex<Quits>> = OnceLock::new();
    QUITS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|p| p.into_inner())
}

/// The quit gate's next question is a check's (quit.rs `request_for_check`).
pub fn quit_asked(id: u64) {
    quits().asked.push(id);
}

/// The page heard question `id`.
pub fn quit_heard(id: u64) {
    let mut q = quits();
    if q.asked.contains(&id) {
        q.heard.push(id);
    }
}

/// Question `id` was answered: `go`, or called off. True when it was a
/// check's question, whose answer goes to the check and ends nothing.
pub fn quit_answered(id: u64, go: bool) -> bool {
    let mut q = quits();
    if !q.asked.contains(&id) {
        return false;
    }
    q.gone |= go;
    let heard = q.heard.contains(&id);
    match q.waiting.iter().position(|(asked, _)| *asked == id) {
        Some(at) => {
            let (_, answer) = q.waiting.remove(at);
            let _ = answer.send((heard, go));
        }
        None => q.answers.push((id, heard, go)),
    }
    true
}

/// Quit Anyway, after a check asked: the app would be gone, and stays.
pub fn quit_now_for_check() -> bool {
    let mut q = quits();
    if q.asked.is_empty() {
        return false;
    }
    q.gone = true;
    true
}

/// Whether this build has a reports key, as a check stands in for it: it
/// lasts across a relaunch, as the in-memory vault's flag in local storage
/// does, until the next first launch.
fn key() -> MutexGuard<'static, Option<bool>> {
    static KEY: Mutex<Option<bool>> = Mutex::new(None);
    KEY.lock().unwrap_or_else(|p| p.into_inner())
}

/// The reports key a check stands in for (telemetry/mod.rs `telemetry_configured`).
pub fn staged_key() -> Option<bool> {
    *key()
}

/// A fresh first launch (selftest.rs): everything [`page_loaded`] lets go of,
/// and the reports key too, which lasts across a relaunch.
pub fn reset() {
    *key() = None;
    page_loaded();
}

/// The app, for what a reset puts back that only the app can: the updater's state.
fn app_handle() -> &'static OnceLock<AppHandle> {
    static APP: OnceLock<AppHandle> = OnceLock::new();
    &APP
}

/// Everything a launch starts without: every gate opened and every count
/// cleared, the watcher's own health, no quit asked, and no recovery owner
/// held. A new page's, which stands in for a relaunch as a reload is a fresh
/// in-memory vault.
fn page_loaded() {
    *staged() = None;
    *next_pick() = None;
    printed().clear();
    exported().clear();
    let before = {
        let mut stand = stand();
        if let Some(installing) = stand.installing.take() {
            let _ = installing.send(());
        }
        std::mem::take(&mut *stand).update_before
    };
    #[cfg(all(desktop, feature = "updater"))]
    if let (Some(before), Some(app)) = (before, app_handle().get()) {
        crate::updates::stage_for_check(app, before);
    }
    #[cfg(not(all(desktop, feature = "updater")))]
    let _ = before;
    {
        let mut q = quits();
        for (_, answer) in q.waiting.drain(..) {
            let _ = answer.send((false, false));
        }
        *q = Quits::default();
    }
    crate::quit::reset_for_check();
    crate::store::PlayStore::forget_owners_for_check();
    let mut g = gates();
    for gate in g.gates.drain(..).collect::<Vec<_>>() {
        g.released.extend(gate.waiting);
    }
    g.failed.clear();
    // Nothing waits on order across a reset: every held call goes now.
    for waiting in g.released.drain(..) {
        let _ = waiting.send(());
    }
    g.passing = false;
}

/// What a check asks of the fixture (scripts/selftest/fixture.mjs names each
/// for the in-memory vault's hook it stands in for).
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Call {
    /// Hold every `kind` call naming `rel` (relative to the folder open now;
    /// none for every call of that kind) until the gates open, or refuse it
    /// with `fail`.
    Gate {
        kind: Op,
        rel: Option<String>,
        fail: Option<String>,
    },
    /// How many `kind` calls are held at a gate now.
    Held { kind: Op },
    /// How many `kind` calls a gate has refused since this launch.
    Failed { kind: Op },
    /// Open the gates for `kind`, or every gate: the held calls go through
    /// in the order they came.
    Open { kind: Option<Op> },
    /// What the disk holds at `rel` in the folder open now, or null.
    Peek { rel: String },
    /// The same, by its path in the Plays folder, whatever is open.
    PeekKey { key: String },
    /// Every file in the Plays folder, by its path there.
    StoreKeys,
    /// An outside writer (a sync, another editor) changed `rel` in the folder
    /// open now: the bytes land as another program's would, atomically and with
    /// no token of the app's own, and the app's watcher reports them. Answers
    /// their hash.
    ExternalChange { rel: String, content: String },
    /// The same bytes reported under another spelling of the same file
    /// (`event` against `rel`): the watcher can name a path otherwise than a
    /// read does. The write carries the app's own token, so the watcher's own
    /// report of it is dropped and the page hears only the other spelling.
    ExternalAlias {
        rel: String,
        event: String,
        content: String,
    },
    /// An outside tool removed `rel` in the folder open now, and the watcher reports it.
    ExternalRemove { rel: String },
    /// A file put at `key` in the Plays folder that the watcher does not
    /// report: one there before launch, or an edit the watcher missed.
    QuietWrite { key: String, content: String },
    /// The watcher's health, as the page hears it, held at `status` until a
    /// check sets it back to "watching".
    WatcherHealth { status: String },
    /// A copy of `rel` kept during a save, as a save that displaced other
    /// bytes keeps one, and the page told so.
    SavedCopy { rel: String, content: String },
    /// Quit, as ⌘Q does: the page is asked, and this answers what it said,
    /// `{ heard, go }`, once it answers. The app is never ended by it.
    Quit,
    /// Whether the app would be gone: a check's quit the page said go to, or
    /// Quit Anyway after one.
    QuitGone,
    /// How many plays hold the note a quit leaves for their next open.
    KeptAtQuit,
    /// A new page: the last one is gone as a relaunch's would be.
    PageLoaded,
    /// This build has a reports key, or has none; null, its own answer.
    AnalyticsKey { on: Option<bool> },
    /// Whether the reports notice was seen, as stored; with `seen`, first stored so.
    NoticeSeen { seen: Option<bool> },
    /// What an in-memory vault's path ("/dev/sample-vault/…", "/dev/outside/…")
    /// is here: the Plays folder and the folder it sits in, which holds
    /// sample-outside/'s files beside it.
    Where { path: String },
    /// The folder the next folder panel answers with, once; the Plays folder after it.
    NextPick { path: String },
    /// Every file an export wrote since this launch, oldest first, as
    /// `{ name, base64 }`: one for each export, as the in-memory vault hands
    /// the browser one download each, though two of one name are one file.
    Exported,
    /// Every PDF handed to print since this launch, oldest first, as `{ name, base64 }`.
    Printed,
    /// Tutorial progress as stored, or null; with `content`, first stored so,
    /// as another window would, past the lock and the hash it holds.
    TutorialProgress { content: Option<String> },
    /// Every practice file in app data, as `{ "/dev/app-data/tutorials/<path>": text }`,
    /// the in-memory vault's spelling; with `files`, those first written.
    TutorialFiles {
        files: Option<std::collections::BTreeMap<String, String>>,
    },
    /// What every Reset Progress kept of the progress it replaced.
    PreservedProgress,
    /// The system's accent is `hex`, or none; null gives the system's own back.
    /// The page is told as it is when the window comes forward (fixture.mjs).
    SystemAccent { hex: Option<String> },
    /// The system asks, or does not ask, for a caret that does not blink.
    SteadyCaret { on: bool },
    /// The updater's state is `state`, as another build's would be (a store
    /// copy's is `{ kind: "unavailable" }`); answers the state it replaced.
    UpdateState { state: Value },
    /// An update downloaded and ready; with `finish`, the install it started
    /// is refused, as a replacement that fails is.
    Update {
        #[cfg_attr(not(all(desktop, feature = "updater")), allow(dead_code))]
        finish: bool,
    },
    /// Whether an install of the staged update is under way.
    UpdateHeld,
    /// What feedback was sent, what Copy Message copied, and the draft as kept.
    Feedback,
    /// Sending feedback fails as it does with no connection, or works again.
    FeedbackOffline { on: bool },
    /// Technical details are unavailable, or available again.
    DetailsUnavailable { on: bool },
    /// What reports hold: the switch, every event the page asked for, what
    /// waits to be sent, the error codes and the page errors.
    Telemetry,
    /// A menu item chosen, by its id, as the menu bar sends it (menu.rs).
    Menu { id: String },
    /// Finder (or File Explorer) opened these paths, the in-memory vault's
    /// spelling: queued and said, as the system's open event is (lib.rs, opens.rs).
    OpenFiles { paths: Vec<String> },
    /// A file outside the Plays folder, at the in-memory vault's path, from base64.
    OutsideFile { path: String, base64: String },
    /// Every version, in any play, whose text holds `text`.
    VersionsWith { text: String },
    /// How many recovery copies, in any play, hold `text`.
    RecoveryWith { text: String },
    /// The error codes shown since this launch, oldest first, one for each time.
    Errors,
    /// The Plays folder opened, but its access could not be kept for the next launch.
    FolderAccess,
}

/// The fixture's one command: what the in-memory vault's hooks do in a
/// browser, done here. Registered in a test build alone (lib.rs).
#[tauri::command]
pub async fn selftest_fixture(
    app: AppHandle,
    state: crate::ManagerState<'_>,
    call: Call,
) -> Result<Value, String> {
    let _ = app_handle().set(app.clone());
    match call {
        Call::Gate { kind, rel, fail } => {
            let key = match rel {
                // App data is named by its own key in the play's store.
                Some(rel) if kind == Op::StoreRead => Some(rel),
                Some(rel) => Some(key_of(&in_open_folder(&state, &rel)?)),
                None => None,
            };
            gates().gates.push(Gate {
                op: kind,
                key,
                fail,
                waiting: Vec::new(),
            });
            Ok(Value::Null)
        }
        Call::Held { kind } => Ok(json!(gates()
            .gates
            .iter()
            .filter(|gate| gate.op == kind)
            .map(|gate| gate.waiting.len())
            .sum::<usize>())),
        Call::Failed { kind } => Ok(json!(gates()
            .failed
            .iter()
            .find(|(op, _)| *op == kind)
            .map_or(0, |(_, n)| *n))),
        Call::Open { kind } => {
            let mut g = gates();
            let (opening, kept): (Vec<_>, Vec<_>) = g
                .gates
                .drain(..)
                .partition(|gate| kind.map_or(true, |k| gate.op == k));
            g.gates = kept;
            for gate in opening {
                g.released.extend(gate.waiting);
            }
            if !g.passing {
                release_next(&mut g);
            }
            Ok(Value::Null)
        }
        Call::Peek { rel } => Ok(text_at(&in_open_folder(&state, &rel)?)),
        Call::PeekKey { key } => Ok(text_at(&plays_folder()?.join(key))),
        Call::StoreKeys => {
            let root = plays_folder()?;
            let mut keys = Vec::new();
            files_under(&root, &root, &mut keys);
            keys.sort();
            Ok(json!(keys))
        }
        Call::ExternalChange { rel, content } => {
            let path = in_open_folder(&state, &rel)?;
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            crate::vault::write_atomic(&path, content.as_bytes()).map_err(|e| e.to_string())?;
            Ok(json!(crate::vault::sha256_hex(content.as_bytes())))
        }
        Call::ExternalAlias {
            rel,
            event,
            content,
        } => {
            let vault = crate::current_vault(&state)?;
            let path = vault.root().join(&rel);
            write_as_the_app(&state, &path, content.as_bytes())?;
            let hash = crate::vault::sha256_hex(content.as_bytes());
            let _ = app.emit(
                crate::watcher::EVENT_EXTERNAL_CHANGE,
                crate::watcher::ExternalChange {
                    root: vault.root().to_string_lossy().into_owned(),
                    rel_path: event,
                    hash: Some(hash),
                },
            );
            Ok(Value::Null)
        }
        Call::ExternalRemove { rel } => {
            let path = in_open_folder(&state, &rel)?;
            if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            }
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        Call::QuietWrite { key, content } => {
            write_as_the_app(&state, &plays_folder()?.join(key), content.as_bytes())?;
            Ok(Value::Null)
        }
        Call::WatcherHealth { status } => {
            let status = match status.as_str() {
                "watching" => "watching",
                "restarting" => "restarting",
                "unavailable" => "unavailable",
                other => return Err(format!("no watcher health is called {other}")),
            };
            *staged() = (status != "watching").then_some(status);
            let root = crate::current_vault(&state)?
                .root()
                .to_string_lossy()
                .into_owned();
            let _ = app.emit(
                crate::watcher::EVENT_HEALTH,
                crate::watcher::WatchHealth { root, status },
            );
            Ok(Value::Null)
        }
        Call::SavedCopy { rel, content } => {
            let vault = crate::current_vault(&state)?;
            vault
                .keep_copy_for_check(&rel, content.as_bytes())
                .map_err(|e| e.to_string())?;
            let _ = app.emit(
                "vault://saved-copies",
                vault.root().to_string_lossy().into_owned(),
            );
            Ok(Value::Null)
        }
        Call::Quit => {
            use crate::quit::Request;
            let id = match crate::quit::request_for_check(&app) {
                Request::Ask(id) => id,
                Request::Hold => return Err("a quit is already being asked".into()),
                Request::Quit => {
                    quits().gone = true;
                    return Ok(json!({ "heard": false, "go": true }));
                }
            };
            let answer = {
                let mut q = quits();
                match q.answers.iter().position(|(asked, _, _)| *asked == id) {
                    Some(at) => {
                        let (_, heard, go) = q.answers.remove(at);
                        return Ok(json!({ "heard": heard, "go": go }));
                    }
                    None => {
                        let (tx, rx) = channel();
                        q.waiting.push((id, tx));
                        rx
                    }
                }
            };
            let (heard, go) = tauri::async_runtime::spawn_blocking(move || answer.recv())
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            Ok(json!({ "heard": heard, "go": go }))
        }
        Call::QuitGone => Ok(json!(quits().gone)),
        Call::KeptAtQuit => Ok(json!(play_stores(&app)
            .iter()
            .filter(|(_, store)| store.exists("kept-at-quit.json"))
            .count())),
        Call::PageLoaded => {
            page_loaded();
            Ok(Value::Null)
        }
        Call::AnalyticsKey { on } => {
            *key() = on;
            Ok(Value::Null)
        }
        Call::NoticeSeen { seen } => {
            if let Some(seen) = seen {
                crate::settings::update_settings(
                    app.clone(),
                    crate::settings::SettingsPatch {
                        privacy_notice_seen: Some(seen),
                        ..Default::default()
                    },
                )
                .await?;
            }
            Ok(json!(crate::settings::current(&app).privacy_notice_seen))
        }
        Call::Where { path } => Ok(json!(real_path(&path)?.to_string_lossy())),
        Call::Exported => Ok(json!(exported()
            .iter()
            .map(|(name, bytes)| file_json(name, bytes))
            .collect::<Vec<_>>())),
        Call::TutorialProgress { content } => {
            let path = tutorials_dir(&app)?.join("progress.json");
            if let Some(content) = content {
                crate::vault::write_atomic(&path, content.as_bytes()).map_err(|e| e.to_string())?;
            }
            Ok(text_at(&path))
        }
        Call::TutorialFiles { files } => {
            let dir = tutorials_dir(&app)?;
            for (key, text) in files.unwrap_or_default() {
                let rel = key
                    .strip_prefix(TUTORIALS)
                    .ok_or_else(|| format!("{key} is not under {TUTORIALS}"))?;
                let path = crate::vault::resolve_under(&dir, rel, "tutorials")
                    .map_err(|e| e.to_string())?;
                crate::vault::write_atomic(&path, text.as_bytes()).map_err(|e| e.to_string())?;
            }
            let mut keys = Vec::new();
            files_under(&dir, &dir, &mut keys);
            Ok(json!(keys
                .into_iter()
                .filter(|key| key.contains('/'))
                .filter_map(|key| {
                    let text = String::from_utf8(std::fs::read(dir.join(&key)).ok()?).ok()?;
                    Some((format!("{TUTORIALS}{key}"), text))
                })
                .collect::<std::collections::BTreeMap<_, _>>()))
        }
        Call::PreservedProgress => {
            let dir = tutorials_dir(&app)?;
            let mut kept: Vec<_> = std::fs::read_dir(&dir)
                .into_iter()
                .flatten()
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    name.starts_with("progress-preserved-") && name.ends_with(".json")
                })
                .map(|e| text_at(&e.path()))
                .collect();
            kept.retain(|text| !text.is_null());
            Ok(json!(kept))
        }
        Call::SystemAccent { hex } => {
            stand().accent = hex.map(Some);
            Ok(Value::Null)
        }
        Call::SteadyCaret { on } => {
            stand().caret = Some(on);
            Ok(Value::Null)
        }
        // A store build has no updater to stand in for: its state is the
        // store copy's, always, which is the only state a check may ask for.
        #[cfg(not(all(desktop, feature = "updater")))]
        Call::UpdateState { state } => match state["kind"].as_str() {
            Some("unavailable") => Ok(json!({ "kind": "unavailable" })),
            _ => Err("a store copy has no updater: the store updates it".into()),
        },
        #[cfg(not(all(desktop, feature = "updater")))]
        Call::Update { .. } => Err("a store copy has no updater: the store updates it".into()),
        #[cfg(all(desktop, feature = "updater"))]
        Call::UpdateState { state } => {
            let state: crate::updates::UpdateState =
                serde_json::from_value(state).map_err(|e| e.to_string())?;
            let was = crate::updates::stage_for_check(&app, state);
            stand().update_before.get_or_insert_with(|| was.clone());
            serde_json::to_value(was).map_err(|e| e.to_string())
        }
        #[cfg(all(desktop, feature = "updater"))]
        Call::Update { finish } => {
            if finish {
                if let Some(installing) = stand().installing.take() {
                    let _ = installing.send(());
                }
            } else {
                let version = "9.9.9".to_string();
                stand().update = Some(version.clone());
                let was = crate::updates::stage_for_check(
                    &app,
                    crate::updates::UpdateState::Ready {
                        version,
                        notes: None,
                        published_at: None,
                    },
                );
                stand().update_before.get_or_insert(was);
            }
            Ok(Value::Null)
        }
        Call::UpdateHeld => Ok(json!(stand().installing.is_some())),
        Call::Feedback => {
            let (sent, copied, clipboard) = {
                let stand = stand();
                (
                    stand.sent.clone(),
                    stand.copied.clone(),
                    stand.clipboard.clone(),
                )
            };
            Ok(json!({
                "sent": sent,
                "copied": copied,
                "saved": crate::feedback::saved_for_check(&app),
                "clipboard": clipboard,
            }))
        }
        Call::FeedbackOffline { on } => {
            stand().offline = on;
            Ok(Value::Null)
        }
        Call::DetailsUnavailable { on } => {
            stand().no_details = on;
            Ok(Value::Null)
        }
        Call::Telemetry => {
            let (on, queued) = crate::telemetry::queue_for_check(&app);
            let stand = stand();
            Ok(json!({
                "on": on,
                "asked": stand.asked,
                "queued": queued,
                "errors": crate::telemetry::shown_errors(&app),
                "pageErrors": stand.page_errors,
            }))
        }
        Call::Menu { id } => {
            crate::menu::on_menu_event(&app, &id);
            Ok(Value::Null)
        }
        Call::OpenFiles { paths } => {
            use tauri::Manager;
            let paths = paths
                .iter()
                .map(|path| real_path(path))
                .collect::<Result<Vec<_>, _>>()?;
            // Finder grants a sandboxed app the file it opens and nothing
            // beside it: to read and write a document the app edits, to read
            // one it only reads (Info.plist's roles), as Launch Services does
            // (docs/app/keeping-work/storage-and-file-format.md#STOR-146).
            for path in &paths {
                crate::selftest::grant(path, finder_edits(path), "Finder")?;
            }
            app.state::<crate::opens::PendingOpens>().push(paths);
            let _ = app.emit(crate::opens::EVENT_OPENED, ());
            Ok(Value::Null)
        }
        Call::OutsideFile { path, base64 } => {
            use base64::Engine as _;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(base64)
                .map_err(|e| e.to_string())?;
            // Made by another program: under the App Sandbox, not by the app.
            crate::selftest::write_outside(&real_path(&path)?, &bytes)?;
            Ok(Value::Null)
        }
        Call::Printed => Ok(json!(printed()
            .iter()
            .map(|(name, bytes)| file_json(name, bytes))
            .collect::<Vec<_>>())),
        Call::NextPick { path } => {
            *next_pick() = Some(real_path(&path)?.to_string_lossy().into_owned());
            Ok(Value::Null)
        }
        Call::VersionsWith { text } => versions_with(&app, &text),
        Call::RecoveryWith { text } => recovery_with(&app, &text),
        Call::Errors => Ok(json!(crate::telemetry::shown_errors(&app))),
        Call::FolderAccess => {
            let root = dunce::canonicalize(plays_folder()?).map_err(|e| e.to_string())?;
            crate::folder_access::report(
                &app,
                root.to_string_lossy().into_owned(),
                "The folder opened, but its access could not be renewed for the next launch."
                    .into(),
            );
            Ok(Value::Null)
        }
    }
}

/// A path relative to the folder open now, as the vault's own calls resolve it.
fn in_open_folder(state: &crate::ManagerState<'_>, rel: &str) -> Result<PathBuf, String> {
    let vault = crate::current_vault(state)?;
    Ok(if rel.is_empty() || rel == "." {
        vault.root().to_path_buf()
    } else {
        vault.root().join(rel)
    })
}

/// Put `bytes` at `path` atomically with the app's own token, as its own save
/// would: its watcher takes the change for the app's and reports nothing.
fn write_as_the_app(
    state: &crate::ManagerState<'_>,
    path: &Path,
    bytes: &[u8],
) -> Result<(), String> {
    let parent = path.parent().ok_or("no folder to write in")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // The name the watcher reports it by: under the folder's real path.
    let path = dunce::canonicalize(parent)
        .map_err(|e| e.to_string())?
        .join(path.file_name().ok_or("no file to write")?);
    let tokens = state
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .self_writes
        .clone();
    let token = tokens.record(&path, &crate::vault::sha256_hex(bytes));
    match crate::vault::write_atomic(&path, bytes) {
        Ok(()) => {
            tokens.committed(&token);
            Ok(())
        }
        Err(e) => {
            tokens.revoke(&token);
            Err(e.to_string())
        }
    }
}

/// The in-memory vault's spelling of app data's tutorial folder.
const TUTORIALS: &str = "/dev/app-data/tutorials/";

/// App data's tutorial folder: retained practice and its progress (tutorials.rs).
fn tutorials_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)
        .map_err(|e| e.to_string())?
        .join("tutorials"))
}

/// The files exports wrote since this launch, by name, in the order written.
fn exported() -> MutexGuard<'static, Vec<(String, Vec<u8>)>> {
    static EXPORTED: Mutex<Vec<(String, Vec<u8>)>> = Mutex::new(Vec::new());
    EXPORTED.lock().unwrap_or_else(|p| p.into_inner())
}

/// An export the save panel's answer took (export.rs), kept as it was written.
pub fn keep_export(name: &str, bytes: &[u8]) {
    exported().push((name.to_string(), bytes.to_vec()));
}

/// The PDFs handed to print since this launch: a test keeps them, by name.
fn printed() -> MutexGuard<'static, Vec<(String, Vec<u8>)>> {
    static PRINTED: Mutex<Vec<(String, Vec<u8>)>> = Mutex::new(Vec::new());
    PRINTED.lock().unwrap_or_else(|p| p.into_inner())
}

/// Keep a PDF handed to print, when a test is running (export.rs): true when
/// it was kept, and no print panel or PDF app is to be shown.
pub fn keep_print(title: &str, bytes: &[u8]) -> bool {
    if crate::selftest::exports_dir().is_none() {
        return false;
    }
    printed().push((format!("{title}.pdf"), bytes.to_vec()));
    true
}

fn file_json(name: &str, bytes: &[u8]) -> Value {
    use base64::Engine as _;
    json!({
        "name": name,
        "base64": base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// The folder the next folder panel answers with, when a check chose one.
fn next_pick() -> MutexGuard<'static, Option<String>> {
    static NEXT: Mutex<Option<String>> = Mutex::new(None);
    NEXT.lock().unwrap_or_else(|p| p.into_inner())
}

/// What the folder panel answers this once, when a check chose (lib.rs
/// `vault_pick_folder`); after it, the run's Plays folder again.
pub fn take_next_pick() -> Option<String> {
    next_pick().take()
}

/// An in-memory vault's absolute path, here. Its Plays folder is
/// "/dev/sample-vault", and the folder it sits in, "/dev", holds the files a
/// check opens from outside it; a test build lays its own out the same way
/// (selftest.rs, scripts/smoke-webview2.mjs).
fn real_path(path: &str) -> Result<PathBuf, String> {
    let plays = plays_folder()?;
    let dev = plays.parent().ok_or("the Plays folder sits in no folder")?;
    let under = |base: &Path, rest: &str| {
        rest.split('/')
            .filter(|part| !part.is_empty())
            .fold(base.to_path_buf(), |path, part| path.join(part))
    };
    if let Some(rest) = path.strip_prefix("/dev/sample-vault") {
        if rest.is_empty() || rest.starts_with('/') {
            return Ok(under(&plays, rest));
        }
    }
    match path.strip_prefix("/dev") {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => Ok(under(dev, rest)),
        _ => Err(format!("{path} is not a path in the checks' /dev")),
    }
}

/// Whether the app is an Editor of this file's kind (tauri.conf.json's file
/// associations): a play and a script, which Finder grants it to write.
fn finder_edits(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("proscenium") || e.eq_ignore_ascii_case("fountain"))
}

/// The run's Plays folder: the copy of sample-vault/ "A folder I choose…" picked.
fn plays_folder() -> Result<PathBuf, String> {
    crate::selftest::plays_root().ok_or_else(|| "no test is running".to_string())
}

/// What a file holds, as the in-memory vault holds it: its text, or for bytes
/// that are not text, one character a byte (`atob`'s string); null if absent.
fn text_at(path: &Path) -> Value {
    std::fs::read(path).ok().map_or(Value::Null, |bytes| {
        Value::String(
            String::from_utf8(bytes)
                .unwrap_or_else(|e| e.into_bytes().into_iter().map(char::from).collect()),
        )
    })
}

/// Every file under `dir`, by its path under `root`. Hidden names are left out,
/// as the in-memory vault holds none: an atomic write's sibling is there for
/// an instant, and a stray one is found by the checks that look for it.
fn files_under(root: &Path, dir: &Path, keys: &mut Vec<String>) {
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => files_under(root, &path, keys),
            Ok(_) => keys.push(
                path.strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
            ),
            Err(_) => {}
        }
    }
}

/// Each play's store in app data, by play id.
fn play_stores(app: &AppHandle) -> Vec<(String, PlayStore)> {
    let Ok(plays) = app_data_dir(app).map(|d| d.join("plays")) else {
        return Vec::new();
    };
    std::fs::read_dir(plays)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| {
            (
                e.file_name().to_string_lossy().into_owned(),
                PlayStore::at(e.path()),
            )
        })
        .collect()
}

fn versions_with(app: &AppHandle, text: &str) -> Result<Value, String> {
    let mut found = Vec::new();
    for (_, store) in play_stores(app) {
        for script in store.list("versions").map_err(|e| e.to_string())? {
            for entry in store.version_entries(&script).map_err(|e| e.to_string())? {
                let Ok(bytes) = store.version_read(&script, &entry.name) else {
                    continue;
                };
                if String::from_utf8_lossy(&bytes).contains(text) {
                    found.push(json!({ "reason": entry.reason, "pinned": entry.pinned }));
                }
            }
        }
    }
    Ok(json!(found))
}

fn recovery_with(app: &AppHandle, text: &str) -> Result<Value, String> {
    fn count(dir: &Path, text: &str) -> usize {
        std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| {
                let path = entry.path();
                if path.is_dir() {
                    count(&path, text)
                } else if path.extension().is_some_and(|e| e == "snapshot") {
                    std::fs::read(&path)
                        .is_ok_and(|b| String::from_utf8_lossy(&b).contains(text))
                        .into()
                } else {
                    0
                }
            })
            .sum()
    }
    Ok(json!(play_stores(app)
        .iter()
        .map(|(_, store)| count(&store.root().join("recovery"), text))
        .sum::<usize>()))
}
