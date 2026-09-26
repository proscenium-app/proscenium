// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::{io, path::{Path, PathBuf}};
use serde::Serialize;
use tauri::{AppHandle, State};
use crate::{authority::{Authority, FolderGrant}, store, vault::{resolve_under, Vault, WriteOutcome, LocalFsVault, SelfWrites, atomic_file::{create_dir_durable, sync_dir, FileLock}}};

fn owned_dir(base: &Path, practice: bool) -> Result<PathBuf, String> {
    let mut path = base.to_path_buf();
    for part in if practice { & ["tutorials", "practice"][..] } else { & ["tutorials"][..] } {
        path.push(part);
        if std::fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("The tutorial folder is a symbolic link. Practice was not opened.".into());
        }
        create_dir_durable(&path).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

#[tauri::command]
pub fn tutorials_root(app: AppHandle, authority: State<'_, Authority>) -> Result<FolderGrant, String> {
    authority.grant(&owned_dir(&store::app_data_dir(&app).map_err(|e| e.to_string())?, true)?)
}

#[derive(Serialize)]
pub struct Progress { content: Option<String>, hash: String }

fn read(path: &Path) -> Result<Progress, String> {
    if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("The tutorial progress file is a symbolic link. It was not read or changed.".into());
    }
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(Progress { hash: crate::vault::sha256_hex(content.as_bytes()), content: Some(content) }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Progress { content: None, hash: String::new() }),
        Err(e) => Err(e.to_string()),
    }
}

fn write(path: &Path, content: &str, expected: &str, preserve: bool) -> Result<String, String> {
    if content.len() > 1_048_576 { return Err("Tutorial progress is too large.".into()); }
    let value: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    if value.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return Err("This tutorial progress needs a different version of Proscenium.".into());
    }
    let _lock = FileLock::try_at(&path.with_extension("lock")).map_err(|e| e.to_string())?;
    let previous = read(path)?;
    if previous.hash != expected { return Err("Tutorial progress changed in another window. Choose Reload Saved Tutorial Progress in Help.".into()); }
    if let Some(old) = previous.content {
        let known = serde_json::from_str::<serde_json::Value>(&old).ok()
            .is_some_and(|v| v.get("version").and_then(|v| v.as_u64()) == Some(1));
        if !known && !preserve { return Err("Saved tutorial progress could not be read. Reset Progress keeps a copy before starting again.".into()); }
        if preserve {
            let key = previous.hash.replace(':', "-");
            let backup = resolve_under(path.parent().ok_or("Missing tutorial folder")?, &format!("progress-preserved-{key}.json"), "tutorial progress").map_err(|e| e.to_string())?;
            if backup.exists() {
                if std::fs::read(&backup).map_err(|e| e.to_string())? != old.as_bytes() { return Err("The preserved progress could not be verified. Progress was not reset.".into()); }
            } else { store::write_atomic(&backup, old.as_bytes()).map_err(|e| e.to_string())?; }
        }
    }
    store::write_atomic(path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(crate::vault::sha256_hex(content.as_bytes()))
}

#[tauri::command]
pub fn tutorials_read(app: AppHandle) -> Result<Progress, String> {
    let base = store::app_data_dir(&app).map_err(|e| e.to_string())?;
    read(&owned_dir(&base, false)?.join("progress.json"))
}

#[tauri::command]
pub fn tutorials_write(app: AppHandle, content: String, expected: String, preserve: Option<bool>) -> Result<String, String> {
    let base = store::app_data_dir(&app).map_err(|e| e.to_string())?;
    write(&owned_dir(&base, false)?.join("progress.json"), &content, &expected, preserve.unwrap_or(false))
}

fn valid_id(id: &str) -> bool {
    id.len() == 26 && id.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let data = store::app_data_dir(app).map_err(|e| e.to_string())?;
    owned_dir(&data, false)
}

fn under(base: &Path, relative: &str) -> io::Result<PathBuf> {
    create_dir_durable(base)?;
    resolve_under(base, relative, "tutorial practice")
}

pub fn session(base: &Path, id: &str, create: bool) -> io::Result<PathBuf> {
    if !valid_id(id) { return Err(io::Error::other("invalid tutorial session")); }
    let sessions = under(base, "sessions")?;
    create_dir_durable(&sessions)?;
    let parent = under(&sessions, id)?;
    if create {
        // Exclusive: restarting can never replace an earlier attempt.
        std::fs::create_dir(&parent)?;
        sync_dir(&sessions)?;
        create_dir_durable(&parent.join("Practice Play"))?;
    }
    let play = under(&sessions, &format!("{id}/Practice Play"))?;
    if !play.is_dir() { return Err(io::Error::other("This practice is no longer available. Your other practice has been kept.")); }
    Ok(play)
}

#[tauri::command]
pub fn tutorials_session(app: AppHandle, authority: State<'_, Authority>, id: String, create: bool) -> Result<FolderGrant, String> {
    let play = session(&root(&app)?, &id, create).map_err(|e| e.to_string())?;
    authority.grant(play.parent().ok_or("Missing tutorial session folder")?)
}

#[tauri::command]
pub fn tutorials_sessions(app: AppHandle) -> Result<Vec<String>, String> {
    let base = root(&app)?;
    let sessions = under(&base, "sessions").map_err(|e| e.to_string())?;
    if !sessions.exists() { return Ok(vec![]); }
    let mut found = vec![];
    for item in std::fs::read_dir(sessions).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let id = item.file_name().to_string_lossy().into_owned();
        if valid_id(&id) && session(&base, &id, false).is_ok() { found.push(id); }
    }
    found.sort(); found.reverse(); Ok(found)
}

// Old practice remains readable without accepting a caller-supplied root (docs/app/keeping-work/storage-and-file-format.md#STOR-173).
fn practice_source(base: &Path, id: Option<&str>, legacy: Option<&str>) -> io::Result<PathBuf> {
    match (id, legacy) {
        (Some(id), None) => session(base, id, false),
        (None, Some(dir)) if !dir.is_empty() && dir != "." && dir != ".." && !dir.contains(['/', '\\']) => {
            under(base, &format!("practice/{dir}"))
        }
        _ => Err(io::Error::other("Invalid tutorial practice")),
    }
}

/// Reserve a copy's directory exclusively. A concurrent creator cannot be merged into.
#[tauri::command]
pub fn tutorials_reserve_copy(state: crate::ManagerState<'_>, name: String) -> Result<(), String> {
    if name.is_empty() || name.contains(['/', '\\']) || name == "." || name == ".." { return Err("Choose a play name.".into()); }
    let vault = crate::current_vault(&state)?;
    let dir = resolve_under(vault.root(), &name, "practice copy").map_err(|e| e.to_string())?;
    std::fs::create_dir(&dir).and_then(|()| sync_dir(vault.root())).map_err(|e| e.to_string())
}

fn copy_file(source: &Path, target: &impl Vault, relative: &str, destination: &str) -> io::Result<()> {
    let from = resolve_under(source, relative, "practice copy")?;
    let bytes = std::fs::read(from)?;
    // Same guarded writer as the editor, and a destination that must not exist.
    let result = target.write(destination, &bytes, Some(""))?;
    if !matches!(result, WriteOutcome::Ok { .. }) { return Err(io::Error::other("The destination already exists. The original practice is kept.")); }
    if target.read(destination)? != bytes { return Err(io::Error::other("The copy could not be verified. The original practice is kept.")); }
    Ok(())
}

#[tauri::command]
pub fn tutorials_copy_file(app: AppHandle, state: crate::ManagerState<'_>, id: Option<String>, legacy: Option<String>, relative: String, destination: String) -> Result<(), String> {
    let base = root(&app)?;
    let source = practice_source(&base, id.as_deref(), legacy.as_deref()).map_err(|e| e.to_string())?;
    let target = crate::current_vault(&state)?;
    copy_file(&source, target.as_ref(), &relative, &destination).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tutorials_trash(app: AppHandle, state: crate::ManagerState<'_>, id: String) -> Result<(), String> {
    let base = root(&app)?;
    let play = session(&base, &id, false).map_err(|e| e.to_string())?;
    if crate::current_vault(&state).is_ok_and(|v| play.parent().is_some_and(|parent| v.root().starts_with(parent))) { return Err("Stop this practice before moving it to Trash.".into()); }
    let vault = LocalFsVault::open(base.join("sessions"), std::sync::Arc::new(SelfWrites::default()), Some(base.join("trash"))).map_err(|e| e.to_string())?;
    vault.trash(&id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "01J00000000000000000000000";
    #[test]
    fn practice_is_retained_and_cannot_escape_or_be_recreated() {
        let root = tempfile::tempdir().unwrap();
        let play = session(root.path(), ID, true).unwrap();
        std::fs::write(play.join("Words.fountain"), "My words").unwrap();
        assert!(session(root.path(), ID, true).is_err());
        assert_eq!(session(root.path(), ID, false).unwrap(), play);
        assert_eq!(std::fs::read_to_string(play.join("Words.fountain")).unwrap(), "My words");
        for id in ["../outside", "/tmp/outside", "", "not-a-session"] { assert!(session(root.path(), id, true).is_err()); }
        #[cfg(unix)] {
            let other = tempfile::tempdir().unwrap();
            let id = "01J00000000000000000000001";
            std::os::unix::fs::symlink(other.path(), root.path().join("sessions").join(id)).unwrap();
            assert!(session(root.path(), id, false).is_err());
        }
    }
    #[test]
    fn copies_preserve_binary_files_and_refuse_collisions_and_escapes() {
        let source = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let vault = LocalFsVault::open(dest.path().to_owned(), std::sync::Arc::new(SelfWrites::default()), None).unwrap();
        let bytes = [0, 255, 128, 42];
        std::fs::write(source.path().join("reference.png"), bytes).unwrap();
        copy_file(source.path(), &vault, "reference.png", "Play/reference.png").unwrap();
        assert_eq!(vault.read("Play/reference.png").unwrap(), bytes);
        assert!(copy_file(source.path(), &vault, "reference.png", "Play/reference.png").is_err());
        assert!(copy_file(source.path(), &vault, "../reference.png", "other").is_err());
        assert!(copy_file(source.path(), &vault, "reference.png", "../other").is_err());
        assert_eq!(std::fs::read(source.path().join("reference.png")).unwrap(), bytes);
    }

    #[test]
    fn progress_lock_and_symlink_backup_fail_without_changing_progress() {
        let temp = tempfile::tempdir().unwrap();
        let base = owned_dir(temp.path(), false).unwrap();
        let path = base.join("progress.json");
        let text = r#"{"version":1,"attempts":[]}"#;
        let hash = write(&path, text, "", false).unwrap();
        {
            let _lock = FileLock::try_at(&base.join("progress.lock")).unwrap();
            assert!(write(&path, text, &hash, true).is_err());
            assert_eq!(read(&path).unwrap().hash, hash);
        }
        #[cfg(unix)] {
            let target = tempfile::NamedTempFile::new().unwrap();
            std::fs::write(target.path(), "original bytes").unwrap();
            let backup = base.join(format!("progress-preserved-{}.json", hash.replace(':', "-")));
            std::os::unix::fs::symlink(target.path(), backup).unwrap();
            assert!(write(&path, text, &hash, true).is_err());
            assert_eq!(std::fs::read_to_string(target.path()).unwrap(), "original bytes");
            assert_eq!(read(&path).unwrap().hash, hash);
            let legacy = base.join("practice"); std::fs::create_dir(&legacy).unwrap();
            std::os::unix::fs::symlink(temp.path(), legacy.join("Linked Play")).unwrap();
            assert!(practice_source(&base, None, Some("Linked Play")).is_err());
        }
    }
    #[test]
    fn reset_preserves_damaged_progress_and_refuses_stale_reset() {
        let temp = tempfile::tempdir().unwrap();
        let base = owned_dir(temp.path(), false).unwrap();
        let path = base.join("progress.json");
        let next = r#"{"version":1,"attempts":[]}"#;
        for damaged in ["broken", r#"{"version":99}"#, r#"{"version":1,"attempts":null}"#] {
            std::fs::write(&path, damaged).unwrap();
            let before = read(&path).unwrap();
            assert!(write(&path, next, "stale", true).is_err());
            let hash = write(&path, next, &before.hash, true).unwrap();
            assert_eq!(read(&path).unwrap().hash, hash);
            let backup = base.join(format!("progress-preserved-{}.json", before.hash.replace(':', "-")));
            assert_eq!(std::fs::read_to_string(backup).unwrap(), damaged);
        }
        for dir in ["..", "../outside", "/tmp/outside"] { assert!(practice_source(&base, None, Some(dir)).is_err()); }
        assert!(practice_source(&base, Some(ID), Some("Play")).is_err());
    }

    #[test]
    fn progress_cannot_replace_unread_or_newer_words() {
        let temp = tempfile::tempdir().unwrap();
        let path = owned_dir(temp.path(), false).unwrap().join("progress.json");
        let first = r#"{"version":1,"attempts":[]}"#;
        let hash = write(&path, first, "", false).unwrap();
        assert!(write(&path, r#"{"version":1}"#, "", false).is_err());
        assert_eq!(read(&path).unwrap().content.as_deref(), Some(first));
        assert!(write(&path, r#"{"version":2}"#, &hash, false).is_err());
        assert_eq!(read(&path).unwrap().hash, hash);
    }
    #[cfg(unix)]
    #[test]
    fn practice_authority_cannot_follow_a_link_to_personal_plays() {
        let temp = tempfile::tempdir().unwrap();
        let plays = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(plays.path(), temp.path().join("tutorials")).unwrap();
        assert!(owned_dir(temp.path(), true).is_err());
        assert_eq!(std::fs::read_dir(plays.path()).unwrap().count(), 0);
    }
}
