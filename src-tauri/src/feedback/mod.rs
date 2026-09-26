// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//! Manual feedback and its one durable draft. Independent of reports and the vault.
use crate::vault::atomic_file::{sync_dir, FileLock};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    message: String,
    email: String,
    include_details: bool,
}
#[derive(Serialize, Deserialize)]
struct Saved {
    draft: Draft,
    id: Option<String>,
}
#[derive(Serialize)]
struct Message<'a> {
    id: &'a str,
    message: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<&'a str>,
}
const FILE: &str = "feedback-draft.json";
fn failure() -> String {
    "Your message couldn't be sent. It's saved here.".into()
}
fn store_error() -> String {
    "Your draft couldn't be saved. Keep this sheet open and try again.".into()
}
fn has_draft(d: &Draft) -> bool {
    !d.message.is_empty() || !d.email.is_empty() || d.include_details
}
fn read(root: &Path) -> Result<Option<Saved>, String> {
    match std::fs::read(root.join(FILE)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|_| "Your saved draft couldn't be read. It has been kept on this Mac.".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(store_error()),
    }
}
fn remove(root: &Path) -> Result<(), String> {
    match std::fs::remove_file(root.join(FILE)) {
        Ok(()) => sync_dir(root).map_err(|_| store_error()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(store_error()),
    }
}
fn write(root: &Path, saved: &Saved) -> Result<(), String> {
    let bytes = serde_json::to_vec(saved).map_err(|_| store_error())?;
    crate::store::write_atomic(&root.join(FILE), &bytes).map_err(|_| store_error())
}
fn keep(root: &Path, draft: Draft, sending: bool) -> Result<Saved, String> {
    let previous = read(root)?;
    let mut id = previous
        .filter(|s| s.draft == draft)
        .and_then(|s| s.id)
        .filter(|id| {
            uuid::Uuid::parse_str(id)
                .is_ok_and(|value| value.get_version_num() == 4 && value.to_string() == *id)
        });
    if sending && id.is_none() {
        id = Some(uuid::Uuid::new_v4().to_string());
    }
    let saved = Saved { draft, id };
    if has_draft(&saved.draft) {
        write(root, &saved)?;
    } else {
        remove(root)?;
    }
    Ok(saved)
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::store::app_data_dir(app).map_err(|_| store_error())
}
fn lock(root: &Path) -> Result<FileLock, String> {
    FileLock::try_at(&root.join("feedback-draft.lock"))
        .map_err(|_| "Feedback is already busy. Try again in a moment.".into())
}
fn email_allowed(email: &str) -> bool {
    if email.len() > 254 {
        return false;
    }
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && local
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".!#$%&'*+/=?^_`{|}~-".contains(&b))
        && domain.contains('.')
        && domain.split('.').all(|part| {
            !part.is_empty()
                && part.as_bytes()[0].is_ascii_alphanumeric()
                && part.as_bytes()[part.len() - 1].is_ascii_alphanumeric()
                && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}
fn message<'a>(saved: &'a Saved, details: Option<&'a str>) -> Result<Message<'a>, String> {
    let d = &saved.draft;
    if d.message.trim().is_empty() {
        return Err("Write a message first.".into());
    }
    if d.message.graphemes(true).take(10_001).count() > 10_000 {
        return Err("Shorten your message to 10,000 characters to send.".into());
    }
    let email = d.email.trim();
    if !email.is_empty() && !email_allowed(email) {
        return Err("Check your email address.".into());
    }
    let details = if d.include_details {
        Some(details.filter(|v| v.len() <= 65536).ok_or(
            "Technical details are unavailable. Uncheck Include technical details to send.",
        )?)
    } else {
        None
    };
    Ok(Message {
        id: saved.id.as_deref().ok_or_else(failure)?,
        message: &d.message,
        email: (!email.is_empty()).then_some(email),
        details,
    })
}
async fn deliver(address: &str, body: &Message<'_>) -> Result<(), String> {
    let bytes = serde_json::to_vec(body).map_err(|_| failure())?;
    if bytes.len() > 1024 * 1024 {
        return Err("This message is too large to send. Shorten it and try again.".into());
    }
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| failure())?;
    let mut response = client
        .post(address)
        .header("Content-Type", "application/json")
        .body(bytes)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "You're offline. Your message is saved here; try again once you're connected."
                    .into()
            } else {
                failure()
            }
        })?;
    let status = response.status();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| failure())? {
        if bytes.len() + chunk.len() > 4096 {
            return Err(failure());
        }
        bytes.extend_from_slice(&chunk);
    }
    let reply: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
    if status.as_u16() == 201 && reply.get("id").and_then(|v| v.as_str()) == Some(body.id) {
        return Ok(());
    }
    if status.is_client_error() {
        // Only our published validation reasons reach the UI, never arbitrary server text.
        let reason = reply.get("reason").and_then(|v| v.as_str()).unwrap_or("");
        let allowed = [
            "Shorten your message to 10,000 characters to send.",
            "Check your email address.",
            "Technical details are too long.",
            "This message is too large to send.",
        ];
        return Err(format!(
            "The feedback service couldn't accept this message.{}",
            if allowed.contains(&reason) {
                format!(" {reason}")
            } else {
                String::new()
            }
        ));
    }
    Err(failure())
}
#[tauri::command]
pub fn feedback_load(app: tauri::AppHandle) -> Result<Draft, String> {
    let root = root(&app)?;
    let _guard = lock(&root)?;
    Ok(read(&root)?.map(|s| s.draft).unwrap_or_default())
}
#[tauri::command]
pub fn feedback_save(app: tauri::AppHandle, draft: Draft) -> Result<(), String> {
    let root = root(&app)?;
    let _guard = lock(&root)?;
    keep(&root, draft, false).map(|_| ())
}
#[tauri::command]
pub fn feedback_discard(app: tauri::AppHandle) -> Result<(), String> {
    let root = root(&app)?;
    let _guard = lock(&root)?;
    remove(&root)
}
#[tauri::command]
pub async fn feedback_send(
    app: tauri::AppHandle,
    draft: Draft,
    details: Option<String>,
) -> Result<(), String> {
    let root = root(&app)?;
    let _guard = lock(&root)?;
    let saved = keep(&root, draft, true)?;
    let body = message(&saved, details.as_deref())?;
    deliver(crate::telemetry::allowlist::FEEDBACK, &body).await?;
    remove(&root)
}
#[tauri::command]
pub fn feedback_copy(message: String) -> Result<(), String> {
    crate::telemetry::copy_text(&message)
}
#[cfg(test)]
mod tests;
