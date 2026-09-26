// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Proscenium Rust core.
//!
//! Boundary (docs/engineering/architecture.md#ARCH-D100): **Rust stores bytes, TypeScript assigns meaning.**
//! This crate opens one user-chosen folder and lists/reads/writes it atomically
//! and durably, watches for external changes, and detects conflict artifacts. It
//! never needs to understand Fountain, the play schema, or card metadata.

mod accent;
mod authority;
mod conflict;
mod export;
mod feedback;
mod folder_access;
mod formats;
/// Desktop-only: iOS has no menu bar, and every item here is also bound at
/// the window by the frontend, so the mobile build simply carries neither.
#[cfg(desktop)]
mod menu;
mod opens;
mod providers;
/// Desktop-only: a quit asks the page to keep its words first (docs/app/keeping-work/storage-and-file-format.md#STOR-D13).
/// iOS ends an app from the background, where the page's hide flush runs.
#[cfg(desktop)]
mod quit;
mod scope;
/// The native self-test (docs/engineering/release-engineering.md#REL-D4). Exists only with the Cargo
/// feature; a release build has no trace of it (scripts/check-bundle.mjs).
#[cfg(feature = "selftest")]
mod selftest;
mod settings;
mod smartsubs;
mod store;
mod symbols;
/// Anonymous usage and crash reports, crash files, the local error log, and
/// Copy Diagnostics (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D100). `telemetry::allowlist` holds
/// every address the app uses.
mod telemetry;
mod tutorials;
/// The in-app updater (docs/engineering/release-engineering.md#REL-D6). Desktop builds with the
/// `updater` feature only: the App Store and the iPad are updated by the store.
#[cfg(all(desktop, feature = "updater"))]
mod updates;
mod vault;
/// The version this copy answers to, with a track build's pre-release in it.
mod version;
/// Desktop-only: mobile has no usable filesystem watch and rescans on foreground
/// instead (docs/engineering/cross-platform.md#PLAT-D103). Gated at the module so the mobile build
/// carries no dead watcher code.
#[cfg(desktop)]
mod watcher;
#[cfg(target_os = "macos")]
mod webview_policy;
#[cfg(target_os = "macos")]
mod window_color;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

use authority::{Authority, FolderGrant};
use store::PlayStore;
use vault::{sha256_hex, LocalFsVault, SelfWrites, Vault, WriteOutcome};

/// The single piece of mutable backend state: which vault is open, the watcher
/// keeping it live, and the self-write tokens shared with that watcher.
#[derive(Default)]
struct VaultManager {
    self_writes: Arc<SelfWrites>,
    vault: Option<Arc<LocalFsVault>>,
    #[cfg(desktop)]
    watch: Option<watcher::WatchHandle>,
}

type ManagerState<'a> = State<'a, Mutex<VaultManager>>;

/// The folder the panel just granted, with the bookmark taken while the grant
/// was fresh — held until the app actually opens it as the Plays folder. A
/// folder refused after picking (docs/app/keeping-work/storage-and-file-format.md#STOR-D2) is therefore never remembered, and
/// the next launch cannot reopen it.
#[derive(Default)]
struct PickedFolder(Mutex<Option<(PathBuf, Option<String>)>>);

fn estr<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn current_vault(state: &ManagerState) -> Result<Arc<LocalFsVault>, String> {
    state
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .vault
        .clone()
        .ok_or_else(|| "no vault is open".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenResult {
    root: String,
    identity: String,
    moves: Vec<vault::PendingMove>,
    /// Pre-existing Syncthing conflict copies found at open (docs/app/keeping-work/storage-and-file-format.md#STOR-D7).
    conflicts: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadResult {
    content: String,
    hash: String,
}

/// Open the platform folder picker; returns the chosen absolute path, or null.
///
/// MUST be async: a sync command runs on the main thread, and the native folder
/// dialog also needs the main thread to display — so blocking the command thread
/// on the picker deadlocks the UI (the spin-wheel). As an async command this runs
/// on a worker; the blocking picker goes on the blocking pool, leaving the main
/// thread free to show the dialog (the same pattern the dialog plugin uses).
#[cfg(desktop)]
#[tauri::command]
async fn vault_pick_folder(
    app: AppHandle,
    authority: State<'_, Authority>,
    picked: State<'_, PickedFolder>,
    start: Option<String>,
    message: Option<String>,
) -> Result<Option<FolderGrant>, String> {
    // A self-test answers the one panel it cannot drive; the bookmark is taken
    // for real, and remembered when the folder opens, like any other pick.
    #[cfg(feature = "selftest")]
    if let Some(path) = selftest::picked_folder() {
        let _ = (&start, &message);
        *picked.0.lock().unwrap_or_else(|p| p.into_inner()) =
            Some((PathBuf::from(&path), scope::bookmark(&path)));
        return authority.grant(std::path::Path::new(&path)).map(Some);
    }
    let handle = app.clone();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = handle.dialog().file();
        // Opened at the folder the app already knows the writer means: a play
        // opened from Finder whose folder the sandbox has not granted yet, so
        // the grant is one click on the folder already in front of them.
        if let Some(dir) = start.filter(|d| std::path::Path::new(d).is_dir()) {
            dialog = dialog.set_directory(dir);
        }
        // On macOS this is the panel's message line: why the last folder could
        // not be the Plays folder, shown where the next choice is made.
        if let Some(text) = message {
            dialog = dialog.set_title(text);
        }
        dialog.blocking_pick_folder()
    })
    .await
    .ok()
    .flatten();
    let Some(path) = chosen
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
    else {
        return Ok(None);
    };

    // Take the security-scoped bookmark NOW, while the grant is fresh (storage
    // docs/app/keeping-work/storage-and-file-format.md#STOR-D12). Under App Sandbox this click is the only thing that will ever make
    // this folder readable again on a later launch; a stored path is a hint.
    // It is remembered when the folder opens (`vault_open`), not here.
    let bookmark = scope::bookmark(&path);
    *picked.0.lock().unwrap_or_else(|p| p.into_inner()) = Some((PathBuf::from(&path), bookmark));
    authority.grant(std::path::Path::new(&path)).map(Some)
}

/// Mobile goes through the vault-picker plugin, because `plugin-dialog`
/// implements file pickers on iOS but **not** `pick_folder`
/// (tauri-apps/plugins-workspace#933).
///
/// The picker returns a path *and* a bookmark, and the bookmark is the half that
/// matters: on iOS a path is not permission, so it is the bookmark that lets the
/// next launch reopen a folder outside our container. Both are stored here, at
/// the moment the grant is fresh.
#[cfg(mobile)]
#[tauri::command]
async fn vault_pick_folder(
    app: AppHandle,
    authority: State<'_, Authority>,
    picked: State<'_, PickedFolder>,
    _start: Option<String>,
    _message: Option<String>,
) -> Result<Option<FolderGrant>, String> {
    use tauri_plugin_vault_picker::VaultPickerExt;

    match app.vault_picker().pick_folder() {
        Ok(Some(chosen)) => {
            *picked.0.lock().unwrap_or_else(|p| p.into_inner()) =
                Some((PathBuf::from(&chosen.path), Some(chosen.bookmark)));
            authority
                .grant(std::path::Path::new(&chosen.path))
                .map(Some)
        }
        // Cancelled — an answer, not a failure. A picker that failed leaves the
        // writer where they were, which is the same answer.
        Ok(None) | Err(_) => Ok(None),
    }
}

/// The vault from the last launch, ready to hand to `vault_open` — or null.
///
/// **One command on every platform**, so the frontend bootstrap carries no
/// platform branch (docs/engineering/cross-platform.md#PLAT-D100's rule). What differs is underneath:
/// every platform resolves its saved security-scoped bookmark, which is what
/// actually re-grants access. Only app-owned folders can reuse a path hint. A
/// resolve can hand back a *renewed* bookmark — iOS marks one stale when the
/// item moves or its provider re-registers — so we persist whatever comes back,
/// and report a failure without dropping a usable current grant.
///
/// The iOS fallback to a bare stored path is not a leak: a vault inside our own
/// container ("On My iPad") needs no grant, and its path is stable for as long
/// as the container exists — a reinstall takes the settings file with it.
#[tauri::command]
async fn vault_reopen_last(app: AppHandle) -> Option<FolderGrant> {
    let authority = app.state::<Authority>();
    if let Some(stored) = settings::last_vault_bookmark(&app) {
        #[cfg(mobile)]
        {
            use tauri_plugin_vault_picker::VaultPickerExt;
            match app.vault_picker().resolve_bookmark(stored.clone()) {
                Ok(reopened) => {
                    // The Plays folder may be a folder inside the one the
                    // bookmark names, kept on that folder's grant (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
                    let path =
                        settings::reopen_path(reopened.path, settings::last_vault_path(&app));
                    let _ =
                        folder_access::retain(&app, path.clone(), Some(reopened.bookmark), None);
                    return authority.grant(std::path::Path::new(&path)).ok();
                }
                Err(_) => {
                    // The folder may have been deleted or moved off-device.
                    // Falling through to the stored path lets an in-container
                    // vault still open; a stale one fails at `vault_open` and
                    // lands on the welcome screen, which is the honest outcome.
                }
            }
        }
        #[cfg(desktop)]
        if let Some(reopened) = scope::resolve(&stored) {
            // A resolve can hand back a REFRESHED bookmark (the folder moved,
            // or its provider re-registered). Persist it and report any
            // failure to retain access. The Plays folder may be a
            // folder inside the one the bookmark names, kept on that folder's
            // grant when no bookmark of its own could be made (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
            let path = settings::reopen_path(reopened.path, settings::last_vault_path(&app));
            let _ = folder_access::retain(&app, path.clone(), reopened.bookmark, reopened.problem);
            return authority.grant(std::path::Path::new(&path)).ok();
        }
        if let Some(path) = settings::last_vault_path(&app) {
            folder_access::report(
                &app,
                path,
                "The saved folder could not be reopened. Choose it again to restore access.".into(),
            );
        }
    }
    // A saved path is only a hint, never permission. Without a valid bookmark only an
    // app-owned folder can reopen without a fresh native selection.
    let stored = settings::last_vault_path(&app)?;
    let path = std::path::Path::new(&stored).canonicalize().ok()?;
    let mut own_roots = vec![app.path().app_data_dir().ok()];
    if let Some(cloud) = scope::cloud_root() {
        own_roots.push(Some(PathBuf::from(cloud)));
    }
    #[cfg(mobile)]
    own_roots.push(app.path().document_dir().ok());
    let own = own_roots
        .into_iter()
        .flatten()
        .filter_map(|p| p.canonicalize().ok())
        .any(|p| path.starts_with(p));
    if own {
        authority.grant(&path).ok()
    } else {
        folder_access::report(
            &app,
            stored,
            "Choose your Plays folder again so Proscenium can retain access.".into(),
        );
        None
    }
}

/// The app's own Documents directory — mobile's always-available vault location
/// ("On My iPad", docs/engineering/cross-platform.md#PLAT-D103: where the folder lives is the user's
/// choice, and this is the one choice that needs no grant at all). Inside our
/// container, so no security scoping and no picker are involved; it is a plain
/// directory the `LocalFsVault` opens like any other.
///
/// Defined on every platform so the command list stays single; desktop simply
/// has no reason to call it, having a real picker.
/// The app's own iCloud Drive container — the zero-click default for where
/// plays live (docs/app/keeping-work/storage-and-file-format.md#STOR-D12), shown in Finder as iCloud Drive › Proscenium.
///
/// `None` when iCloud is unavailable (not signed in, or disabled for this app),
/// in which case the welcome screen does not offer it rather than offering a
/// door that opens onto nothing.
#[tauri::command]
async fn vault_cloud_root(app: AppHandle) -> Option<FolderGrant> {
    app.state::<Authority>()
        .grant(std::path::Path::new(&scope::cloud_root()?))
        .ok()
}

#[tauri::command]
async fn vault_default_root(
    app: AppHandle,
    authority: State<'_, Authority>,
) -> Result<FolderGrant, String> {
    #[cfg(desktop)]
    {
        let _ = (app, authority);
        Err("choose a Plays folder in the folder panel".into())
    }
    #[cfg(mobile)]
    {
        let dir = app.path().document_dir().map_err(estr)?;
        std::fs::create_dir_all(&dir).map_err(estr)?;
        authority.grant(&dir)
    }
}

#[tauri::command]
async fn vault_folder_below(
    authority: State<'_, Authority>,
    handle: String,
    relative: String,
) -> Result<FolderGrant, String> {
    authority.descendant(&handle, &relative)
}

/// Point the app at a folder — the Plays folder, or one play — scanning for
/// provider conflict copies and starting the watcher.
///
/// `play_id` is present only when the folder is a play. Only mobile's
/// recoverable delete needs it, and only to place the bytes in app data
/// (docs/app/keeping-work/storage-and-file-format.md#STOR-D10) rather than inside the play folder.
#[tauri::command]
async fn vault_open(
    app: AppHandle,
    state: ManagerState<'_>,
    authority: State<'_, Authority>,
    picked: State<'_, PickedFolder>,
    handle: String,
    play_id: Option<String>,
) -> Result<OpenResult, String> {
    let path = authority.resolve(&handle)?;
    let trash_dir = play_id
        .as_deref()
        .and_then(|id| PlayStore::open(&app, id).ok())
        .map(|s| s.root().join("trash"));
    let mut mgr = state.lock().unwrap_or_else(|p| p.into_inner());
    let self_writes = mgr.self_writes.clone();
    // The frontend settled the old workspace before opening this one. Release
    // its transaction owner before recovering the same folder after a failure.
    mgr.vault = None;
    #[cfg(desktop)]
    {
        mgr.watch = None;
    }
    let vault = Arc::new(
        LocalFsVault::open(path, self_writes.clone(), trash_dir)
            .map_err(estr)?
            .with_journal(&store::app_data_dir(&app).map_err(estr)?),
    );
    let moves = vault.recover_moves().map_err(estr)?;
    let root = vault.root().to_path_buf();
    let conflicts = conflict::scan(&root);

    // Desktop watches the tree; mobile rescans on foreground instead
    // (docs/engineering/cross-platform.md#PLAT-D103). `notify` does compile for iOS, but resolves to a
    // polling backend there, and continuously polling a cloud-synced folder is
    // the wrong trade on a battery device. Dropping the watcher is safe by
    // construction: the conflict floor (docs/app/keeping-work/storage-and-file-format.md#STOR-D9) catches a stale buffer by
    // hash on the next read, so a missed event costs freshness, never bytes.
    #[cfg(desktop)]
    {
        mgr.watch = Some(watcher::start(app.clone(), root.clone(), self_writes).map_err(estr)?);
    }
    #[cfg(mobile)]
    {
        let _ = (&app, &self_writes);
    }

    let identity = vault.identity();
    mgr.vault = Some(vault);

    // A Plays folder the panel just granted is remembered now that it has
    // opened, with the bookmark taken at the click (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). A play's own
    // folder is never the Plays folder, and a grant for some other folder than
    // the one that opened is dropped.
    if play_id.is_none() {
        if let Some((granted, bookmark)) = picked.0.lock().unwrap_or_else(|p| p.into_inner()).take()
        {
            if granted.canonicalize().unwrap_or(granted) == root {
                #[cfg(target_os = "macos")]
                let problem = bookmark.is_none().then(|| "Proscenium could not make a bookmark for this folder. Choose it again to retain access.".into());
                #[cfg(not(target_os = "macos"))]
                let problem = None;
                let _ = folder_access::retain(
                    &app,
                    root.to_string_lossy().to_string(),
                    bookmark,
                    problem,
                );
            }
        }
    }

    Ok(OpenResult {
        root: root.to_string_lossy().to_string(),
        identity,
        moves,
        conflicts,
    })
}

#[tauri::command]
async fn vault_list(state: ManagerState<'_>, rel_dir: String) -> Result<Vec<vault::Entry>, String> {
    current_vault(&state)?.list(&rel_dir).map_err(estr)
}

#[tauri::command]
#[cfg(desktop)]
async fn watcher_status(state: ManagerState<'_>) -> Result<Option<watcher::WatchHealth>, String> {
    let health = state
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .watch
        .as_ref()
        .map(|watch| watch.health());
    Ok(health)
}

#[tauri::command]
#[cfg(mobile)]
async fn watcher_status() -> Option<()> {
    None
}

/// A read that comes back "not found" may be an **evicted** iCloud file rather
/// than a missing one: iCloud keeps the name and takes the bytes. Ask the
/// platform to fetch it, then read once more.
///
/// This lives at the command layer, not in the vault, so `LocalFsVault` stays
/// platform-neutral (docs/engineering/architecture.md#ARCH-D100: Rust stores bytes) and the whole notion of
/// eviction is confined to the boundary that already knows about plugins.
#[cfg(mobile)]
fn fetch_evicted(app: &AppHandle, vault: &LocalFsVault, rel: &str) -> Result<Vec<u8>, String> {
    use tauri_plugin_vault_picker::VaultPickerExt;

    let abs = vault.abs_path(rel).map_err(estr)?;
    let ready = app
        .vault_picker()
        .materialize(abs.to_string_lossy().to_string(), None)
        .map_err(estr)?;
    if !ready {
        // Deliberately not "missing": the file exists, its bytes are elsewhere.
        // Saying "missing" here is what would let docs/app/keeping-work/storage-and-file-format.md#STOR-D8 reconciliation mistake a
        // slow download for a deleted play.
        return Err(format!(
            "{rel} is in iCloud and has not finished downloading yet"
        ));
    }
    vault.read(rel).map_err(estr)
}

#[tauri::command]
async fn vault_read(
    #[allow(unused_variables)] app: AppHandle,
    state: ManagerState<'_>,
    rel: String,
) -> Result<ReadResult, String> {
    let vault = current_vault(&state)?;
    let bytes = match vault.read(&rel) {
        Ok(bytes) => bytes,
        #[cfg(mobile)]
        Err(e)
            if matches!(
                e.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::WouldBlock
            ) =>
        {
            fetch_evicted(&app, &vault, &rel)?
        }
        Err(e) => return Err(estr(e)),
    };
    let hash = sha256_hex(&bytes);
    let content = String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8".to_string())?;
    Ok(ReadResult { content, hash })
}

/// Guarded write. `rebasable` is true only for the play file, which has
/// several legitimate writers: a mismatch reports `stale` with disk truth so
/// the caller can rebuild its change on the new base. Everything else reports
/// `collision`, and the caller pins a version (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
#[tauri::command]
async fn vault_write(
    app: AppHandle,
    state: ManagerState<'_>,
    rel: String,
    content: String,
    expected: Option<String>,
    rebasable: Option<bool>,
) -> Result<WriteOutcome, String> {
    let vault = current_vault(&state)?;
    let bytes = content.as_bytes();
    let result = if rebasable.unwrap_or(false) {
        vault
            .write_rebasable(&rel, bytes, expected.as_deref())
            .map_err(estr)
    } else {
        vault.write(&rel, bytes, expected.as_deref()).map_err(estr)
    };
    // Copies also survive failures after a swap. The next open/foreground
    // query is the fallback when a page misses this notification.
    if vault
        .saved_copies()
        .map_or(true, |copies| !copies.is_empty())
    {
        let _ = app.emit(
            "vault://saved-copies",
            vault.root().to_string_lossy().to_string(),
        );
    }
    result
}

#[tauri::command]
async fn vault_saved_copies(state: ManagerState<'_>) -> Result<Vec<vault::SavedCopy>, String> {
    current_vault(&state)?.saved_copies().map_err(estr)
}

/// Imported originals are immutable copies. This command has no overwrite mode.
#[tauri::command]
async fn vault_create_binary(
    state: ManagerState<'_>,
    rel: String,
    base64: String,
) -> Result<WriteOutcome, String> {
    use base64::Engine;
    let limit = vault::read_limit::MAX_DOCUMENT_BYTES as usize;
    if base64.len() > limit.div_ceil(3) * 4 {
        return Err("This file exceeds the 16 MiB import limit.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64)
        .map_err(estr)?;
    if bytes.len() > limit {
        return Err("This file exceeds the 16 MiB import limit.".into());
    }
    current_vault(&state)?
        .write(&rel, &bytes, Some(""))
        .map_err(estr)
}

#[tauri::command]
async fn vault_read_saved_copy(state: ManagerState<'_>, id: String) -> Result<String, String> {
    String::from_utf8(current_vault(&state)?.read_saved_copy(&id).map_err(estr)?)
        .map_err(|_| "The saved copy is not valid UTF-8.".into())
}

#[tauri::command]
async fn vault_exists(state: ManagerState<'_>, rel: String) -> Result<bool, String> {
    Ok(current_vault(&state)?.exists(&rel))
}

/// Move a file/dir to the OS trash (user-facing delete — recoverable).
#[tauri::command]
async fn vault_trash(state: ManagerState<'_>, rel: String) -> Result<(), String> {
    current_vault(&state)?.trash(&rel).map_err(estr)
}

/// Atomically relocate a file/dir within the vault (binder move/rename).
#[tauri::command]
async fn vault_rename(state: ManagerState<'_>, from: String, to: String) -> Result<(), String> {
    current_vault(&state)?.rename(&from, &to).map_err(estr)
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
enum MoveStart {
    Ok { intent: vault::PendingMove },
    Refused { message: String, blocked: bool },
}

#[tauri::command]
async fn vault_begin_move(
    state: ManagerState<'_>,
    from: String,
    to: String,
    manifest: String,
    payload: String,
) -> Result<MoveStart, String> {
    let vault = current_vault(&state)?;
    Ok(match vault.begin_move(&from, &to, manifest, payload) {
        Ok(intent) => MoveStart::Ok { intent },
        Err(error) => MoveStart::Refused {
            message: error.to_string(),
            blocked: vault.has_pending_moves(),
        },
    })
}

#[tauri::command]
async fn vault_finish_move(state: ManagerState<'_>, id: String) -> Result<(), String> {
    current_vault(&state)?.finish_move(&id).map_err(estr)
}

#[tauri::command]
async fn vault_rollback_move(state: ManagerState<'_>, id: String) -> Result<(), String> {
    current_vault(&state)?.rollback_move(&id).map_err(estr)
}

/// Create a directory (and parents) — a new binder folder.
#[tauri::command]
async fn vault_mkdir(state: ManagerState<'_>, rel: String) -> Result<(), String> {
    current_vault(&state)?.mkdir(&rel).map_err(estr)
}

/// Open the vault in Finder ("Reveal in Finder").
///
/// With `rel`, reveals AND selects that file — `open -R` — so "Reveal in
/// Finder" on a binder row lands on the row's own file rather than dumping the
/// writer at the vault root to go find it. Without one, opens the root.
///
/// `rel` is resolved through the vault so it cannot escape the root; a path
/// that does not resolve falls back to the root rather than erroring, because
/// the worst case of a stale binder entry should be a folder you can look in.
#[cfg(desktop)]
#[tauri::command]
async fn vault_reveal(state: ManagerState<'_>, rel: Option<String>) -> Result<(), String> {
    let vault = current_vault(&state)?;
    let root = vault.root().to_path_buf();
    let target = rel
        .as_deref()
        .filter(|r| !r.is_empty())
        .and_then(|r| vault.abs_path(r).ok())
        .filter(|p| p.exists());

    // A self-test keeps what Finder was asked to show instead of opening a
    // window on the build host: the click, the command and the path it
    // resolved are the app's; showing a folder is Finder's.
    #[cfg(feature = "selftest")]
    if selftest::record_reveal(
        target
            .as_deref()
            .map_or(("open", root.as_path()), |p| ("open -R", p)),
    ) {
        return Ok(());
    }
    let mut cmd = std::process::Command::new("open");
    match target {
        Some(path) => {
            cmd.arg("-R").arg(path);
        }
        None => {
            cmd.arg(&root);
        }
    }
    cmd.spawn().map_err(estr)?;
    Ok(())
}

/// There is no file manager to reveal into on mobile, and no `open` to spawn.
/// The frontend hides the affordance via `capabilities().canReveal` rather than
/// testing the platform, so this is only ever reached by a stale UI.
#[cfg(mobile)]
#[tauri::command]
async fn vault_reveal(_state: ManagerState<'_>, _rel: Option<String>) -> Result<(), String> {
    Err("this platform has no file manager to reveal the folder in".to_string())
}

/// What this build can actually do.
///
/// The frontend branches on **capabilities, never on platform names** — the rule
/// docs/engineering/cross-platform.md#PLAT-D100 sets out is that an `if (platform === …)` in React is a
/// smell that platform difference has leaked above the vault. Adding a platform
/// means answering this record honestly, not editing the UI. The flags coincide
/// today because desktop is the only complete backend; they diverge as the
/// mobile pieces land (the folder picker arrives before file watching does, and
/// watching may never arrive at all).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Capabilities {
    /// A folder picker exists. Mobile awaits its platform plugin
    /// (tauri-apps/plugins-workspace#933).
    can_pick_folder: bool,
    /// The picker can show a line of text — why the last folder could not be
    /// the Plays folder. The iOS document picker has nowhere to put one.
    picker_shows_message: bool,
    /// "Reveal in Finder" has somewhere to reveal into.
    can_reveal: bool,
    /// An export can be written to a user-chosen path outside the vault.
    can_export_anywhere: bool,
    /// The OS delivers filesystem change events. When false, the foreground
    /// rescan carries the external-change contract instead — the conflict floor
    /// (docs/app/keeping-work/storage-and-file-format.md#STOR-D9) makes a missed event safe either way.
    can_watch_files: bool,
}

#[tauri::command]
async fn capabilities() -> Capabilities {
    let desktop = cfg!(desktop);
    Capabilities {
        // iOS has the vault-picker plugin; Android's SAF side is not written
        // yet, so it still falls back to the in-container Documents vault.
        can_pick_folder: desktop || cfg!(target_os = "ios"),
        picker_shows_message: desktop,
        can_reveal: desktop,
        can_export_anywhere: desktop,
        can_watch_files: desktop,
    }
}

/// Snapshot session content into the script's version ring (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
/// Returns the version's name (an identical newest entry is deduped).
#[tauri::command]
async fn versions_snapshot(
    app: AppHandle,
    play_id: String,
    script_id: String,
    reason: String,
    content: String,
    ext: String,
) -> Result<String, String> {
    PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .version_snapshot(&script_id, &reason, content.as_bytes(), &ext)
        .map_err(estr)
}

/// A script's versions, newest first.
#[tauri::command]
async fn versions_list(
    app: AppHandle,
    play_id: String,
    script_id: String,
) -> Result<Vec<store::VersionEntry>, String> {
    PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .version_entries(&script_id)
        .map_err(estr)
}

/// One version's content.
#[tauri::command]
async fn versions_read(
    app: AppHandle,
    play_id: String,
    script_id: String,
    name: String,
) -> Result<String, String> {
    let bytes = PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .version_read(&script_id, &name)
        .map_err(estr)?;
    String::from_utf8(bytes).map_err(|_| "version is not valid UTF-8".to_string())
}

/// Read one file from a play's app-data store — the Changes baselines and
/// before-texts, the recovery snapshot, the derived cache (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
/// `None` when it is not there, which is an ordinary answer here.
#[tauri::command]
async fn store_read(
    app: AppHandle,
    play_id: String,
    rel: String,
) -> Result<Option<String>, String> {
    let store = PlayStore::open(&app, &play_id).map_err(estr)?;
    if !store.exists(&rel) {
        return Ok(None);
    }
    let bytes = store.read(&rel).map_err(estr)?;
    Ok(String::from_utf8(bytes).ok())
}

#[tauri::command]
async fn store_write(
    app: AppHandle,
    play_id: String,
    rel: String,
    content: String,
) -> Result<(), String> {
    PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .write(&rel, content.as_bytes())
        .map_err(estr)
}

#[tauri::command]
async fn store_remove(app: AppHandle, play_id: String, rel: String) -> Result<(), String> {
    PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .remove(&rel)
        .map_err(estr)
}

/// Replace a script's recovery snapshot (docs/app/keeping-work/storage-and-file-format.md#STOR-D10) — what the buffer held
/// while autosave could not land it. Atomic, in app data, never in the play.
#[tauri::command]
async fn recovery_write(
    app: AppHandle,
    play_id: String,
    script_id: String,
    owner: String,
    content: String,
) -> Result<(), String> {
    PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .recovery_write(&script_id, &owner, content.as_bytes())
        .map_err(estr)
}

/// A script's recovery snapshot, or null — the ordinary answer.
#[tauri::command]
async fn recovery_read(
    app: AppHandle,
    play_id: String,
    script_id: String,
    owner: String,
) -> Result<Option<String>, String> {
    let bytes = PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .recovery_read(&script_id, &owner)
        .map_err(estr)?;
    Ok(bytes.and_then(|b| String::from_utf8(b).ok()))
}

#[tauri::command]
async fn recovery_remove(
    app: AppHandle,
    play_id: String,
    script_id: String,
    owner: String,
) -> Result<(), String> {
    PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .recovery_remove(&script_id, &owner)
        .map_err(estr)
}

#[tauri::command]
async fn recovery_list(
    app: AppHandle,
    play_id: String,
    script_id: Option<String>,
) -> Result<Vec<store::recovery::RecoveryFile>, String> {
    PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .recovery_list(script_id.as_deref())
        .map_err(estr)
}

#[tauri::command]
async fn recovery_release(
    app: AppHandle,
    play_id: String,
    script_id: String,
    owner: String,
) -> Result<(), String> {
    PlayStore::open(&app, &play_id)
        .map_err(estr)?
        .recovery_release(&script_id, &owner)
        .map_err(estr)
}

/// What a folder is before it becomes the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D2, docs/app/keeping-work/storage-and-file-format.md#STOR-D11): a
/// play itself, inside one, and which sync providers manage it. The frontend
/// decides what may be chosen (`src/workspace/plays-folder.ts`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderFacts {
    /// Canonical, as the vault would open it.
    path: String,
    /// It directly holds a play file: it IS a play.
    is_play: bool,
    /// The nearest folder above it that holds a play file.
    inside_play: Option<String>,
    /// `icloud`, `dropbox`, `syncthing`, … (providers.rs), in detection order.
    providers: Vec<String>,
    /// Its contents can be listed now. Under the App Sandbox a folder the
    /// writer has not picked with the panel cannot be, and has to be granted
    /// before it can be opened.
    listable: bool,
}

/// The writer's real home, even inside the App Sandbox, where `HOME` is the
/// app's container and every provider path would look like "not under home".
fn real_home() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    let text = home.to_string_lossy().to_string();
    match text.find("/Library/Containers/") {
        Some(i) => PathBuf::from(&text[..i]),
        None => home,
    }
}

/// Only for a folder the writer has put in front of the app: the one the
/// panel just granted, the one open now or a real folder inside it, or one
/// around a file opened from Finder. The webview gets no way to probe the rest
/// of the disk with it.
#[tauri::command]
async fn vault_folder_facts(
    state: ManagerState<'_>,
    picked: State<'_, PickedFolder>,
    pending: State<'_, opens::PendingOpens>,
    path: String,
) -> Result<FolderFacts, String> {
    let dir = PathBuf::from(&path);
    let resolved = dir.canonicalize().ok();
    let canonical = resolved.clone().unwrap_or(dir);
    let same = |other: &std::path::Path| {
        other.canonicalize().unwrap_or_else(|_| other.to_path_buf()) == canonical
    };
    let is_picked = picked
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
        .is_some_and(|(p, _)| same(p));
    // A folder inside the one open, which the vault lists already: the Plays
    // screen offers one when the Plays folder looks chosen one level too high
    // (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). Only a path that resolves, so `..` never walks out of it.
    let is_open = state
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .vault
        .as_ref()
        .is_some_and(|v| {
            same(v.root()) || resolved.as_ref().is_some_and(|r| r.starts_with(v.root()))
        });
    if !(is_picked || is_open || pending.is_around_granted(&canonical)) {
        return Err("that folder was not chosen or opened in Proscenium".to_string());
    }

    let home = real_home();
    let plays = opens::play_dirs_from(Some(canonical.as_path()), &home);
    let here = canonical.to_string_lossy().to_string();
    let is_icloud = |p: &std::path::Path| scope::is_icloud_item(&p.to_string_lossy());
    Ok(FolderFacts {
        is_play: plays.first().is_some_and(|d| d.dir == here),
        inside_play: plays.iter().find(|d| d.dir != here).map(|d| d.dir.clone()),
        listable: std::fs::read_dir(&canonical).is_ok(),
        providers: providers::detect(
            &canonical,
            &providers::Environment {
                home: home.clone(),
                is_icloud_item: &is_icloud,
            },
        ),
        path: here,
    })
}

/// Paths opened from Finder since the last call, in the order they arrived
/// (opens.rs). The frontend calls this once it is ready, and again on each
/// `app://opened` signal.
#[tauri::command]
async fn opens_take(pending: State<'_, opens::PendingOpens>) -> Result<Vec<String>, String> {
    Ok(pending
        .take()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

/// What is on disk around a path that was opened from Finder — never any other.
#[derive(Serialize)]
struct OpenedWithGrant {
    #[serde(flatten)]
    facts: opens::OpenedFacts,
    folder: Option<FolderGrant>,
}

#[tauri::command]
async fn opened_facts(
    pending: State<'_, opens::PendingOpens>,
    authority: State<'_, Authority>,
    path: String,
) -> Result<OpenedWithGrant, String> {
    let p = PathBuf::from(&path);
    if !pending.is_granted(&p) {
        return Err("that file was not opened with Proscenium".to_string());
    }
    let facts = opens::facts(&p, &real_home());
    // The OS-open grant reaches the play that contains the opened file. Its
    // parent is a different folder, selected natively if it is to hold plays.
    let folder = facts
        .play_dirs
        .first()
        .and_then(|play| authority.grant(std::path::Path::new(&play.dir)).ok());
    Ok(OpenedWithGrant { facts, folder })
}

/// The text of a file opened from Finder, to make a play from it. Refuses any
/// path that did not arrive by an open event.
#[tauri::command]
async fn opened_read(
    pending: State<'_, opens::PendingOpens>,
    path: String,
) -> Result<ReadResult, String> {
    let p = PathBuf::from(&path);
    if !pending.is_granted(&p) {
        return Err("that file was not opened with Proscenium".to_string());
    }
    let bytes = vault::read_limit::read_document(&p).map_err(estr)?;
    let hash = sha256_hex(&bytes);
    let content = String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8".to_string())?;
    Ok(ReadResult { content, hash })
}

#[tauri::command]
async fn opened_read_binary(
    pending: State<'_, opens::PendingOpens>,
    path: String,
) -> Result<String, String> {
    use base64::Engine;
    let p = PathBuf::from(path);
    if !pending.is_granted(&p) {
        return Err("that file was not opened with Proscenium".into());
    }
    let bytes = vault::read_limit::read_document(&p).map_err(estr)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[derive(Serialize)]
struct PackageFile {
    path: String,
    base64: String,
}

/// A package-form `.pages` document opened from Finder, as its files, for the
/// page to zip whole: the import reads it, and the play keeps it as its
/// original (docs/app/importing/document-import.md#IMPT-89). `None` when the
/// path is a plain file, which `opened_read_binary` reads.
#[tauri::command]
async fn opened_read_package(
    pending: State<'_, opens::PendingOpens>,
    path: String,
) -> Result<Option<Vec<PackageFile>>, String> {
    use base64::Engine;
    let p = PathBuf::from(path);
    if !pending.is_granted(&p) {
        return Err("that file was not opened with Proscenium".into());
    }
    let files = vault::read_limit::read_package(&p).map_err(estr)?;
    Ok(files.map(|files| {
        files
            .into_iter()
            .map(|(path, bytes)| PackageFile {
                path,
                base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
            .collect()
    }))
}

/// Where the main window may navigate: its own origin only. Production serves
/// the page as `tauri://localhost`; development, from Vite on localhost.
fn navigation_allowed(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" => cfg!(dev) && url.host_str() == Some("localhost"),
        _ => false,
    }
}

/// The page has painted its first frame (main.tsx): WebKit may draw its own
/// background again (window_color.rs says why it was off until now).
#[tauri::command]
fn page_painted(webview: tauri::Webview) {
    #[cfg(all(target_os = "macos", feature = "webkit-background"))]
    window_color::draw_webkit_background(&webview);
    #[cfg(not(all(target_os = "macos", feature = "webkit-background")))]
    let _ = webview;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Crash files for any panic from here on: its place, never its message
    // (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D4). Where they go is known once setup runs.
    telemetry::install_panic_hook();
    // Before any webview exists, so WebKit can't cache the substitution state
    // first. No-op off macOS.
    smartsubs::disable_for_this_app();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_vault_picker::init());
    #[cfg(feature = "selftest")]
    let builder = builder.plugin(selftest::plugin());
    #[cfg(all(desktop, feature = "updater"))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    builder
        // Before anything can open a file: a launch caused by a double-click
        // delivers its paths before the webview exists (opens.rs).
        .manage(opens::PendingOpens::default())
        .manage(Authority::default())
        .manage(folder_access::Access::default())
        .manage(PickedFolder::default())
        .setup(|app| {
            // The one window, made here rather than by the config (`create:
            // false`) so it can carry a navigation veto: the page may go
            // nowhere but its own origin. The CSP fences
            // fetches, images and frames; it does not fence a top-level
            // navigation, and `location.href = "https://…?d=" + text` would
            // have carried a script out with the request.
            let main = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("tauri.conf.json has no main window")?;
            #[cfg(target_os = "macos")]
            {
                // The desk, light or dark, from the first instant (window_color.rs).
                let background = window_color::desk(
                    &settings::current(app.handle()).appearance,
                    window_color::system_is_dark(),
                );
                webview_policy::build(app.handle().clone(), main, background)
                    .map_err(std::io::Error::other)?;
            }
            #[cfg(not(target_os = "macos"))]
            tauri::WebviewWindowBuilder::from_config(app.handle(), &main)?
                .on_navigation(navigation_allowed)
                .build()?;
            // The native menu bar (docs/engineering/design-system.md#UI-D107). Every item forwards its id to the
            // webview, which is the single place that says what an id means.
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                app.set_menu(menu::build_menu(&handle)?)?;
                app.on_menu_event(move |app, event| {
                    menu::on_menu_event(app, event.id().0.as_str());
                });
                // Every quit asks the page to keep its words first (quit.rs).
                quit::setup(app.handle());
            }
            // A fresh launch has no unsaved edits; also clears a stale dirty
            // flag left by a crash, which would hold every update back.
            let _ = settings::write_buffer_state(app.handle(), false);
            app.manage(Mutex::new(VaultManager::default()));
            #[cfg(all(desktop, feature = "updater"))]
            updates::setup(app.handle());
            telemetry::setup(app.handle());
            Ok(())
        })
        // The last window closing is the app quitting: it waits for the same
        // answer ⌘Q does, instead of taking the page with it (quit.rs).
        .on_window_event(|window, event| {
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                quit::close_requested(window.app_handle());
            }
            #[cfg(mobile)]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            page_painted,
            vault_pick_folder,
            vault_cloud_root,
            vault_default_root,
            vault_folder_below,
            vault_reopen_last,
            capabilities,
            vault_open,
            vault_list,
            watcher_status,
            vault_read,
            vault_write,
            vault_create_binary,
            vault_saved_copies,
            vault_read_saved_copy,
            vault_exists,
            vault_trash,
            vault_rename,
            vault_begin_move,
            vault_finish_move,
            vault_rollback_move,
            vault_mkdir,
            vault_reveal,
            versions_snapshot,
            versions_list,
            versions_read,
            store_read,
            store_write,
            store_remove,
            recovery_write,
            recovery_read,
            recovery_remove,
            recovery_list,
            recovery_release,
            settings::get_last_vault,
            settings::set_last_vault,
            folder_access::folder_access_state,
            folder_access::folder_access_retry,
            settings::get_settings,
            settings::update_settings,
            settings::reveal_plays_folder,
            settings::open_formats_folder,
            settings::open_license,
            settings::open_support,
            settings::open_privacy,
            symbols::formatting_symbols,
            accent::system_accent,
            tutorials::tutorials_root,
            tutorials::tutorials_session,
            tutorials::tutorials_sessions,
            tutorials::tutorials_reserve_copy,
            tutorials::tutorials_copy_file,
            tutorials::tutorials_trash,
            tutorials::tutorials_read,
            tutorials::tutorials_write,
            settings::app_info,
            settings::set_buffer_state,
            #[cfg(desktop)]
            quit::quit_heard,
            #[cfg(desktop)]
            quit::quit_settled,
            #[cfg(desktop)]
            quit::quit_now,
            formats::list_user_formats,
            formats::save_user_format,
            formats::trash_user_format,
            formats::import_format_file,
            formats::export_format_file,
            export::save_export,
            export::print_export,
            telemetry::telemetry_record,
            telemetry::telemetry_configured,
            telemetry::telemetry_page_error,
            telemetry::diagnostics_copy,
            telemetry::diagnostics_review,
            feedback::feedback_load,
            feedback::feedback_save,
            feedback::feedback_discard,
            feedback::feedback_send,
            feedback::feedback_copy,
            #[cfg(all(desktop, feature = "updater"))]
            updates::update_state,
            #[cfg(all(desktop, feature = "updater"))]
            updates::update_check,
            #[cfg(all(desktop, feature = "updater"))]
            updates::update_restart,
            #[cfg(all(desktop, feature = "updater"))]
            updates::update_release_notes,
            #[cfg(feature = "selftest")]
            selftest::selftest_context,
            #[cfg(feature = "selftest")]
            selftest::selftest_log,
            #[cfg(feature = "selftest")]
            selftest::selftest_check,
            #[cfg(feature = "selftest")]
            selftest::selftest_reload,
            #[cfg(feature = "selftest")]
            selftest::selftest_key,
            #[cfg(feature = "selftest")]
            selftest::selftest_click,
            #[cfg(feature = "selftest")]
            selftest::selftest_resize,
            #[cfg(feature = "selftest")]
            selftest::selftest_input_facts,
            #[cfg(feature = "selftest")]
            selftest::selftest_capture,
            #[cfg(feature = "selftest")]
            selftest::selftest_ax,
            #[cfg(feature = "selftest")]
            selftest::selftest_aria,
            #[cfg(feature = "selftest")]
            selftest::selftest_exported,
            #[cfg(feature = "selftest")]
            selftest::selftest_slice,
            #[cfg(feature = "selftest")]
            selftest::selftest_reveals,
            #[cfg(feature = "selftest")]
            selftest::selftest_proof_context,
            #[cfg(feature = "selftest")]
            selftest::selftest_proof_log,
            #[cfg(feature = "selftest")]
            selftest::selftest_done,
            opens_take,
            opened_facts,
            opened_read,
            opened_read_binary,
            opened_read_package,
            vault_folder_facts,
        ])
        .build(tauri::generate_context!())
        // Nothing runs before this: a builder that cannot make the app has no
        // window to say so in, so the process ends here with the reason on stderr.
        .expect("error while building the Proscenium application")
        .run(|app, event| {
            // Finder's "open these" (docs/app/keeping-work/storage-and-file-format.md#STOR-D5): queue, then say so. The same
            // path for a launch and for an app already running.
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let tauri::RunEvent::Opened { urls } = &event {
                let paths = opens::paths_from_urls(urls);
                if !paths.is_empty() {
                    app.state::<opens::PendingOpens>().push(paths);
                    let _ = app.emit(opens::EVENT_OPENED, ());
                }
            }
            // A normal quit sends what is waiting, briefly, if reports are on.
            if let tauri::RunEvent::Exit = &event {
                telemetry::on_exit(app);
            }
            let _ = (app, event);
        });
}

#[cfg(test)]
mod navigation_tests {
    use super::navigation_allowed;

    /// The page stays on its own origin: a navigation elsewhere could carry a play out in its address.
    #[test]
    fn the_main_window_navigates_nowhere_but_its_own_origin() {
        let url = |s: &str| tauri::Url::parse(s).unwrap();
        assert!(navigation_allowed(&url("tauri://localhost/index.html")));
        assert!(navigation_allowed(&url("tauri://localhost/")));
        assert!(!navigation_allowed(&url(
            "https://attacker.example/?d=SYNTHETIC%20PLAY%20LINE"
        )));
        assert!(!navigation_allowed(&url("http://attacker.example/")));
        assert!(!navigation_allowed(&url(
            "file:///Users/writer/Plays/x.html"
        )));
        assert!(!navigation_allowed(&url("javascript:alert(1)")));
        assert_eq!(
            navigation_allowed(&url("http://localhost:1420/")),
            cfg!(dev)
        );
    }
}
