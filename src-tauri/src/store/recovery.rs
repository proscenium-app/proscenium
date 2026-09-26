// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Each live editor owns its own recovery file. OS locks distinguish a live
//! owner from an abandoned file; listing claims abandoned files until they
//! have been safely pinned or explicitly released. Envelopes stay opaque.
use super::{valid_id, PlayStore};
use crate::vault::atomic_file::{sync_dir, FileLock};
use serde::Serialize;
use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

struct Owner {
    _lock: FileLock,
    abandoned: bool,
}
fn owners() -> &'static Mutex<HashMap<PathBuf, Owner>> {
    static OWNERS: OnceLock<Mutex<HashMap<PathBuf, Owner>>> = OnceLock::new();
    OWNERS.get_or_init(Default::default)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryFile {
    pub script_id: String,
    pub owner: String,
    pub content: String,
}

fn snapshot_rel(script: &str, owner: &str) -> io::Result<String> {
    if !valid_id(script) || !valid_id(owner) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid recovery identity",
        ));
    }
    Ok(if owner == "legacy" {
        format!("recovery/{script}.snapshot")
    } else {
        format!("recovery/{script}/{owner}.snapshot")
    })
}

impl PlayStore {
    fn recovery_lock(&self, script: &str, owner: &str) -> io::Result<FileLock> {
        let path = self.resolve(&format!("recovery-owners/{script}/{owner}.lock"))?;
        FileLock::try_at(&path)
    }

    pub fn recovery_write(&self, script: &str, owner: &str, bytes: &[u8]) -> io::Result<()> {
        let rel = snapshot_rel(script, owner)?;
        if owner == "legacy" {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "legacy recovery files are read-only",
            ));
        }
        let path = self.resolve(&rel)?;
        let mut live = owners().lock().unwrap_or_else(|p| p.into_inner());
        if let Some(held) = live.get(&path) {
            if held.abandoned {
                return Err(io::Error::other(
                    "An earlier session owns those recovery words.",
                ));
            }
        } else {
            let lock = self.recovery_lock(script, owner)?;
            if path.exists() {
                return Err(io::Error::other(
                    "The recovery session identifier is already in use.",
                ));
            }
            live.insert(
                path,
                Owner {
                    _lock: lock,
                    abandoned: false,
                },
            );
        }
        self.write(&rel, bytes)
    }

    pub fn recovery_read(&self, script: &str, owner: &str) -> io::Result<Option<Vec<u8>>> {
        let rel = snapshot_rel(script, owner)?;
        let path = self.resolve(&rel)?;
        let live = owners().lock().unwrap_or_else(|p| p.into_inner());
        if !path.exists() {
            return Ok(None);
        }
        if !live.contains_key(&path) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "The recovery file has not been claimed.",
            ));
        }
        self.read(&rel).map(Some)
    }

    pub fn recovery_remove(&self, script: &str, owner: &str) -> io::Result<()> {
        let rel = snapshot_rel(script, owner)?;
        let path = self.resolve(&rel)?;
        let mut live = owners().lock().unwrap_or_else(|p| p.into_inner());
        if !path.exists() {
            return Ok(());
        }
        let held = live.get(&path).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::PermissionDenied,
                "The recovery file belongs to another session.",
            )
        })?;
        let abandoned = held.abandoned;
        std::fs::remove_file(&path)?;
        if let Some(parent) = path.parent() {
            sync_dir(parent)?;
        }
        if abandoned {
            live.remove(&path);
        }
        Ok(())
    }

    /// Releasing ownership never deletes words. A later open can claim them.
    pub fn recovery_release(&self, script: &str, owner: &str) -> io::Result<()> {
        let path = self.resolve(&snapshot_rel(script, owner)?)?;
        owners()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&path);
        Ok(())
    }

    /// All abandoned sessions, including the pre-owner legacy filename. A
    /// second app process cannot read/delete a live owner's or a claimed file.
    pub fn recovery_list(&self, script: Option<&str>) -> io::Result<Vec<RecoveryFile>> {
        if script.is_some_and(|id| !valid_id(id)) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid script id",
            ));
        }
        let mut names = Vec::new();
        for name in self.list("recovery")? {
            if let Some(id) = name.strip_suffix(".snapshot") {
                if valid_id(id) && script.map_or(true, |wanted| wanted == id) {
                    names.push((id.to_string(), "legacy".to_string()));
                }
            } else if valid_id(&name) && script.map_or(true, |wanted| wanted == name) {
                for file in self.list(&format!("recovery/{name}"))? {
                    if let Some(owner) = file.strip_suffix(".snapshot") {
                        if valid_id(owner) && owner != "legacy" {
                            names.push((name.clone(), owner.to_string()));
                        }
                    }
                }
            }
        }
        let mut live = owners().lock().unwrap_or_else(|p| p.into_inner());
        let mut files = Vec::new();
        for (script_id, owner) in names {
            let rel = snapshot_rel(&script_id, &owner)?;
            let path = self.resolve(&rel)?;
            if live.get(&path).is_some_and(|held| !held.abandoned) {
                continue;
            }
            if !live.contains_key(&path) {
                let lock = match self.recovery_lock(&script_id, &owner) {
                    Ok(lock) => lock,
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => continue,
                    Err(e) => return Err(e),
                };
                live.insert(
                    path.clone(),
                    Owner {
                        _lock: lock,
                        abandoned: true,
                    },
                );
            }
            match std::fs::read(&path) {
                Ok(bytes) => files.push(RecoveryFile {
                    script_id,
                    owner,
                    content: String::from_utf8(bytes)
                        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?,
                }),
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    live.remove(&path);
                }
                Err(e) => return Err(e),
            }
        }
        Ok(files)
    }
}
