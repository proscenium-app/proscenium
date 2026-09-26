// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The user's custom script-format files, kept OUTSIDE any vault in the
//! per-app config dir (`<app-config-dir>/formats/*.json`, beside
//! settings.json). Rust hands back raw file text; the TypeScript format
//! module parses and validates (boundary rule: Rust stores bytes, TypeScript
//! assigns meaning). Best-effort like settings: an unreadable directory or
//! file degrades to "fewer formats", never an error that blocks the app.
//!
//! The format designer writes here too: a save goes through the store's atomic
//! write, a delete goes to the Trash, and import and export each pass through
//! the system's own file panel. Every command that names a file takes a bare
//! file name, checked to be one — never a path the webview could point
//! anywhere else.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

/// A format file is a few kilobytes; anything past this is not one.
const MAX_FORMAT_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserFormatFile {
    pub file_name: String,
    pub content: String,
}

fn formats_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("formats"))
}

/// A bare `.json` file name: one path component, visible, no separators. A
/// hand-made format may have any such name, so this is not the id rule.
fn valid_file_name(name: &str) -> bool {
    name.ends_with(".json")
        && name.len() > ".json".len()
        && name.len() <= 255
        && !name.starts_with('.')
        && !name.contains(['/', '\\', '\0'])
        && Path::new(name).file_name().and_then(|n| n.to_str()) == Some(name)
}

/// The text is a JSON object — the least a format file is. Its meaning is
/// checked in TypeScript; this only refuses to put something that is not even
/// JSON into the folder the app reads formats from.
fn check_json_object(content: &str) -> Result<(), String> {
    match serde_json::from_str::<serde_json::Value>(content) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        Ok(_) => Err("a format file is a JSON object".to_string()),
        Err(e) => Err(format!("not valid JSON: {e}")),
    }
}

/// List the user's format files, sorted by file name for deterministic load
/// order. Creates the directory on first call so it is discoverable.
#[tauri::command]
pub async fn list_user_formats(app: AppHandle) -> Vec<UserFormatFile> {
    let Some(dir) = formats_dir(&app) else {
        return Vec::new();
    };
    let _ = fs::create_dir_all(&dir);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<UserFormatFile> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
                return None;
            }
            let content = fs::read_to_string(&path).ok()?;
            Some(UserFormatFile {
                file_name: entry.file_name().to_string_lossy().into_owned(),
                content,
            })
        })
        .collect();
    out.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    out
}

fn save_at(dir: &Path, file_name: &str, content: &str) -> Result<(), String> {
    if !valid_file_name(file_name) {
        return Err(format!("\"{file_name}\" is not a format file name"));
    }
    check_json_object(content)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    crate::store::write_atomic(&dir.join(file_name), content.as_bytes()).map_err(|e| e.to_string())
}

/// Save one format file into the formats folder, atomically: a crash leaves
/// the old file or the new one, never half of either.
#[tauri::command]
pub async fn save_user_format(
    app: AppHandle,
    file_name: String,
    content: String,
) -> Result<(), String> {
    let dir = formats_dir(&app).ok_or("the app has no formats folder")?;
    save_at(&dir, &file_name, &content)
}

/// Move one format file to the Trash, where the writer can still find it. A
/// file already gone is not an error: the result the writer asked for holds.
#[tauri::command]
pub async fn trash_user_format(app: AppHandle, file_name: String) -> Result<(), String> {
    if !valid_file_name(&file_name) {
        return Err(format!("\"{file_name}\" is not a format file name"));
    }
    let dir = formats_dir(&app).ok_or("the app has no formats folder")?;
    let path = dir.join(&file_name);
    if !path.exists() {
        return Ok(());
    }
    discard(&path)
}

#[cfg(not(any(target_os = "ios", target_os = "android")))]
fn discard(path: &Path) -> Result<(), String> {
    crate::vault::os_trash(path).map_err(|e| e.to_string())
}

/// Mobile has no system Trash to hand a file to (and the `trash` crate does not
/// build there); a format is a small settings file, not writing, so it goes.
#[cfg(any(target_os = "ios", target_os = "android"))]
fn discard(path: &Path) -> Result<(), String> {
    fs::remove_file(path).map_err(|e| e.to_string())
}

/// Read a format file the writer picked in the system's Open panel (a theatre's
/// style sheet, a colleague's format). Null when they cancel. Nothing is copied
/// here: the frontend validates it, names it, and saves it through
/// `save_user_format`, so an invalid file never lands in the folder.
#[cfg(desktop)]
#[tauri::command]
pub async fn import_format_file(app: AppHandle) -> Result<Option<UserFormatFile>, String> {
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .file()
            .set_title("Import a Format")
            .add_filter("Format file", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if size > MAX_FORMAT_BYTES {
        return Err("that file is too large to be a format".to_string());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "format.json".to_string());
    Ok(Some(UserFormatFile { file_name, content }))
}

/// Save a copy of a format wherever the writer chooses in the Save panel — to
/// send to a theatre, or to contribute to `formats/`. Returns where it went, or
/// null when they cancel.
#[cfg(desktop)]
#[tauri::command]
pub async fn export_format_file(
    app: AppHandle,
    suggested_name: String,
    content: String,
) -> Result<Option<String>, String> {
    check_json_object(&content)?;
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        handle
            .dialog()
            .file()
            .set_title("Export Format")
            .set_file_name(suggested_name)
            .add_filter("Format file", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(path) = picked.and_then(|p| p.into_path().ok()) else {
        return Ok(None);
    };
    crate::store::write_atomic(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// There is no Open or Save panel to pass a format through on mobile yet.
#[cfg(mobile)]
#[tauri::command]
pub async fn import_format_file(_app: AppHandle) -> Result<Option<UserFormatFile>, String> {
    Err("this platform cannot import a format yet".to_string())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn export_format_file(
    _app: AppHandle,
    _suggested_name: String,
    _content: String,
) -> Result<Option<String>, String> {
    Err("this platform cannot export a format yet".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_name_is_one_visible_json_name() {
        for good in [
            "my-format.json",
            "Théâtre National.json",
            "uk_international.v2.json",
        ] {
            assert!(valid_file_name(good), "refused {good}");
        }
        for bad in [
            "",
            ".json",
            ".hidden.json",
            "format.txt",
            "../settings.json",
            "sub/format.json",
            "C:\\formats\\x.json",
            "nul\0.json",
        ] {
            assert!(!valid_file_name(bad), "accepted {bad:?}");
        }
    }

    #[test]
    fn a_save_is_whole_and_leaves_nothing_else_behind() {
        let dir = tempfile::tempdir().unwrap();
        let formats = dir.path().join("formats");
        save_at(&formats, "mine.json", "{\"id\":\"mine\"}\n").unwrap();
        save_at(
            &formats,
            "mine.json",
            "{\"id\":\"mine\",\"name\":\"Mine\"}\n",
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(formats.join("mine.json")).unwrap(),
            "{\"id\":\"mine\",\"name\":\"Mine\"}\n"
        );
        let names: Vec<String> = fs::read_dir(&formats)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["mine.json"]);
    }

    #[test]
    fn a_save_refuses_what_is_not_a_format_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(save_at(dir.path(), "../escape.json", "{}").is_err());
        assert!(save_at(dir.path(), "x.json", "not json").is_err());
        assert!(save_at(dir.path(), "x.json", "[1, 2]").is_err());
        assert!(!dir.path().join("x.json").exists());
    }
}
