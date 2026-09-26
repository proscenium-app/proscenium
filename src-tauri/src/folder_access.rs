// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Session access can work even when its bookmark cannot be retained.
//! Keep the folder open, but retain and publish that distinct failure.
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub const EVENT: &str = "folder-access://state";
#[derive(Clone, Serialize)]
pub struct Issue {
    pub path: String,
    pub message: String,
}
#[derive(Default)]
pub struct Access(Mutex<Option<Issue>>);

pub fn report(app: &AppHandle, path: String, message: String) {
    let issue = Some(Issue { path, message });
    *app.state::<Access>()
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner()) = issue.clone();
    let _ = app.emit(EVENT, issue);
}

pub fn retain(
    app: &AppHandle,
    path: String,
    bookmark: Option<String>,
    problem: Option<String>,
) -> Result<(), String> {
    let result = crate::settings::remember_vault(app, path.clone(), bookmark);
    let result = retention_result(problem, result);
    match &result {
        Err(message) => report(app, path, message.clone()),
        Ok(()) => {
            *app.state::<Access>()
                .0
                .lock()
                .unwrap_or_else(|p| p.into_inner()) = None;
            let _ = app.emit(EVENT, None::<Issue>);
        }
    }
    result
}

fn retention_result(problem: Option<String>, saved: Result<(), String>) -> Result<(), String> {
    saved.map_err(|e| format!("E-FOLDER-ACCESS: The folder's access could not be saved: {e}"))?;
    match problem {
        Some(message) => Err(format!("E-FOLDER-ACCESS: {message}")),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn folder_access_state(app: AppHandle) -> Option<Issue> {
    app.state::<Access>()
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

#[tauri::command]
pub fn folder_access_retry(app: AppHandle) -> Result<(), String> {
    let Some(issue) = folder_access_state(app.clone()) else {
        return Ok(());
    };
    // An unresolved saved path is a hint, not a fresh grant. Such a failure
    // requires the panel; only a folder already granted this session retries.
    if !app
        .state::<crate::authority::Authority>()
        .contains(std::path::Path::new(&issue.path))
    {
        return Err("Choose the folder again to restore access.".into());
    }
    let bookmark = crate::scope::bookmark(&issue.path);
    #[cfg(target_os = "macos")]
    let problem = bookmark.is_none().then(|| {
        "Proscenium could not make a bookmark for this folder. Choose the folder again.".to_string()
    });
    #[cfg(not(target_os = "macos"))]
    let problem = None;
    retain(&app, issue.path, bookmark, problem)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_failed_bookmark_or_persistence_is_a_distinct_failure() {
        assert!(retention_result(None, Ok(())).is_ok());
        for result in [
            retention_result(Some("renewal failed".into()), Ok(())),
            retention_result(None, Err("disk full".into())),
        ] {
            assert!(result.unwrap_err().starts_with("E-FOLDER-ACCESS:"));
        }
    }
}
