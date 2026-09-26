// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Filesystem watching (docs/app/keeping-work/storage-and-file-format.md#STOR-D9 external-change path).
//!
//! Wraps `notify`, drops events that echo the app's own atomic writes
//! (self-write suppression), coalesces duplicate events by content hash, and
//! forwards genuine external changes to the frontend as Tauri events. The
//! frontend decides what to do (reload vs dirty-gate) — Rust only reports.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::vault::sync_names::{is_conflict_copy, is_provider_artifact};
use crate::vault::{is_temp_sibling, SelfWrites};
use crate::vault::path_key::comparison_path;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WatchedFile { path: PathBuf, hash: String }
type ObservedFiles = HashMap<PathBuf, WatchedFile>;

pub const EVENT_EXTERNAL_CHANGE: &str = "vault://external-change";
pub const EVENT_CONFLICT_COPY: &str = "vault://conflict-copy";
pub const EVENT_HEALTH: &str = "vault://watcher-health";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WatchHealth {
    pub root: String,
    pub status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChange {
    pub root: String,
    pub rel_path: String,
    /// Content hash, or `null` if the file was removed.
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCopy {
    pub root: String,
    pub rel_path: String,
}

/// Keeps the OS watcher alive. Dropping it stops watching.
pub struct WatchHandle {
    stop: Arc<AtomicBool>,
    health: Arc<Mutex<WatchHealth>>,
}

impl WatchHandle {
    pub fn health(&self) -> WatchHealth { self.health.lock().unwrap_or_else(|p| p.into_inner()).clone() }
}

impl Drop for WatchHandle {
    fn drop(&mut self) { self.stop.store(true, Ordering::Release); }
}

fn rel_of(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Start watching `root` recursively, emitting events to the frontend.
pub fn start(
    app: AppHandle,
    root: PathBuf,
    self_writes: Arc<SelfWrites>,
) -> notify::Result<WatchHandle> {
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let stop = Arc::new(AtomicBool::new(false));
    let health = Arc::new(Mutex::new(WatchHealth { root: root.to_string_lossy().into(), status: "restarting" }));
    let handle = WatchHandle { stop: stop.clone(), health: health.clone() };
    std::thread::spawn(move || {
        let mut last_emitted = ObservedFiles::new();
        let mut watcher = None;
        let mut retry_at = Instant::now();
        let mut scan_at = Instant::now();
        let say = |status| {
            let mut current = health.lock().unwrap_or_else(|p| p.into_inner());
            if current.status != status {
                current.status = status;
                // A failed event delivery remains queryable through watcher_status.
                if app.emit(EVENT_HEALTH, current.clone()).is_err() { current.status = "unavailable"; }
            }
        };
        while !stop.load(Ordering::Acquire) {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<(), ()> {
                if watcher.is_none() && Instant::now() >= retry_at {
                    say("restarting");
                    let tx = tx.clone();
                    let mut fresh = notify::recommended_watcher(move |event| { let _ = tx.send(event); }).map_err(|_| ())?;
                    fresh.watch(&root, RecursiveMode::Recursive).map_err(|_| ())?;
                    watcher = Some(fresh);
                    scan_at = Instant::now();
                }
                if Instant::now() >= scan_at {
                    let mut observed = last_emitted.clone();
                    let changes = rescan(&root, &self_writes, &mut observed).map_err(|_| ())?;
                    for (path, decision) in changes {
                        if stop.load(Ordering::Acquire) { return Ok(()); }
                        emit_decision(&app, &root, &path, decision).map_err(|_| ())?;
                    }
                    last_emitted = observed;
                    scan_at = Instant::now() + Duration::from_secs(30);
                    if watcher.is_some() { say("watching"); }
                }
                match rx.recv_timeout(Duration::from_millis(250)) {
                    Ok(Ok(event)) => {
                        if event.need_rescan() { return Err(()); }
                        if needs_rescan(&event) { scan_at = Instant::now(); }
                        for path in event.paths {
                            if stop.load(Ordering::Acquire) { return Ok(()); }
                            let mut observed = last_emitted.clone();
                            let decision = classify(&self_writes, &mut observed, &path);
                            if decision == WatchDecision::Uncertain { scan_at = Instant::now(); }
                            else {
                                emit_decision(&app, &root, &path, decision).map_err(|_| ())?;
                                last_emitted = observed;
                            }
                        }
                    }
                    Ok(Err(_)) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return Err(()),
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                }
                Ok(())
            }));
            if !matches!(result, Ok(Ok(()))) {
                watcher = None;
                say("unavailable");
                retry_at = Instant::now() + Duration::from_secs(2);
                scan_at = retry_at;
            }
        }
    });
    Ok(handle)
}

fn needs_rescan(event: &notify::Event) -> bool {
    use notify::{EventKind, event::{ModifyKind, RemoveKind}};
    event.need_rescan() || event.paths.is_empty() || event.paths.iter().any(|path| path.is_dir()) ||
        matches!(event.kind, EventKind::Any | EventKind::Other |
            EventKind::Modify(ModifyKind::Name(_)) | EventKind::Remove(RemoveKind::Folder | RemoveKind::Any))
}

/// A complete walk precedes deletion inference. Unreadable trees retain the
/// prior map; a later retry can still report every missed deletion.
fn rescan(root: &Path, tokens: &SelfWrites, last: &mut ObservedFiles)
    -> std::io::Result<Vec<(PathBuf, WatchDecision)>> {
    fn walk(dir: &Path, files: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if matches!(name.as_str(), ".stfolder" | ".stversions") || is_temp_sibling(&name) || is_provider_artifact(&name) { continue; }
            let kind = entry.file_type()?;
            if kind.is_symlink() { continue; }
            if kind.is_dir() { walk(&entry.path(), files)?; }
            else { files.push(entry.path()); }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(root, &mut files)?;
    let present: HashSet<_> = files.iter().map(|path| comparison_path(path)).collect();
    let missing: Vec<_> = last.iter().filter(|(key, _)| !present.contains(*key)).map(|(_, file)| file.path.clone()).collect();
    let mut changes = Vec::new();
    let mut observed = last.clone();
    for path in files.into_iter().chain(missing) {
        let decision = classify(tokens, &mut observed, &path);
        if decision == WatchDecision::Uncertain {
            return Err(std::io::Error::new(std::io::ErrorKind::WouldBlock, "a watched file is not readable yet"));
        }
        changes.push((path, decision));
    }
    *last = observed;
    Ok(changes)
}

/// What the watcher decided about one filesystem event. Separating the
/// decision from the Tauri emission makes the whole classification testable
/// against a real filesystem with no app handle, which is how a false conflict banner was hunted down.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchDecision {
    /// A provider artifact, our own temp sibling, or an unreadable file.
    Ignore,
    /// A directory, provider-only file, or read failure needs a complete scan.
    Uncertain,
    /// A provider conflict copy appeared (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
    ConflictCopy,
    /// The file no longer exists.
    Removed,
    /// Echo of one of our own atomic writes — suppressed (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
    SelfWrite,
    /// notify fired again for content we already reported.
    Duplicate,
    /// A genuine external change, carrying the new content hash.
    External(String),
}

/// Classify one filesystem event. Consumes a matching self-write token and
/// updates the coalescing map, exactly as the live watcher does.
pub fn classify(
    self_writes: &SelfWrites,
    last_emitted: &mut ObservedFiles,
    path: &Path,
) -> WatchDecision {
    // Ignore whole subtrees, not just leaf names: a provider's bookkeeping
    // dirs. `.stversions/` in particular holds COPIES of real script files,
    // whose leaf names look exactly like ours — matching on the filename alone
    // let that churn through as external changes (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
    if path
        .components()
        .any(|c| matches!(c.as_os_str().to_str(), Some(".stfolder" | ".stversions")))
    {
        return WatchDecision::Ignore;
    }

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // Our own atomic write, mid-flight. It exists for milliseconds and its
    // rename is the event that matters; reporting the temp file would mean a
    // phantom external change on every single save.
    if is_temp_sibling(&name) || is_provider_artifact(&name) {
        return WatchDecision::Ignore;
    }
    if is_conflict_copy(&name) {
        return WatchDecision::ConflictCopy;
    }

    let key = comparison_path(path);
    if path.is_dir() || crate::vault::icloud::unavailable(path) { return WatchDecision::Uncertain; }
    if !path.exists() {
        last_emitted.remove(&key);
        return WatchDecision::Removed;
    }

    let Ok((hash, own)) = self_writes.observe(path) else {
        return WatchDecision::Uncertain;
    };

    // Echo of our own atomic write — drop it (docs/app/keeping-work/storage-and-file-format.md#STOR-D9 self-write suppression).
    if own {
        last_emitted.insert(key, WatchedFile { path: path.to_path_buf(), hash });
        return WatchDecision::SelfWrite;
    }
    // notify can fire several events per save; only report real content changes.
    if last_emitted.get(&key).is_some_and(|file| file.hash == hash && file.path == path) {
        return WatchDecision::Duplicate;
    }
    // An unchanged hash with a changed spelling still reaches reconciliation.
    last_emitted.insert(key, WatchedFile { path: path.to_path_buf(), hash: hash.clone() });
    WatchDecision::External(hash)
}

fn emit_decision(
    app: &AppHandle,
    root: &Path,
    path: &Path,
    decision: WatchDecision,
) -> tauri::Result<()> {
    let rel = rel_of(root, path);
    let root = root.to_string_lossy().into_owned();

    match decision {
        WatchDecision::Ignore | WatchDecision::Uncertain | WatchDecision::SelfWrite | WatchDecision::Duplicate => Ok(()),
        WatchDecision::ConflictCopy => {
            app.emit(EVENT_CONFLICT_COPY, ConflictCopy { root, rel_path: rel })
        }
        WatchDecision::Removed => {
            app.emit(
                EVENT_EXTERNAL_CHANGE,
                ExternalChange { root, rel_path: rel, hash: None },
            )
        }
        WatchDecision::External(hash) => {
            app.emit(
                EVENT_EXTERNAL_CHANGE,
                ExternalChange { root, rel_path: rel, hash: Some(hash) },
            )
        }
    }
}

#[cfg(test)]
mod tests;
