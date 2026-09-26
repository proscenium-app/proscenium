// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Folder paths are descriptions, not permission: the page must not make any folder the Plays root by naming it. Only native picks,
//! restored bookmarks, app-owned directories and OS opens mint these handles.

use serde::Serialize;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize)]
pub struct FolderGrant {
    pub handle: String,
    pub path: String,
}

#[derive(Default)]
pub struct Authority(Mutex<HashMap<String, PathBuf>>);

impl Authority {
    pub fn contains(&self, path: &Path) -> bool {
        let Ok(path) = path.canonicalize() else {
            return false;
        };
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .values()
            .any(|p| p == &path)
    }
    /// Never exposed as an IPC command: callers have established native authority.
    pub fn grant(&self, path: &Path) -> Result<FolderGrant, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if !path.is_dir() {
            return Err("the chosen folder is not available".into());
        }
        let mut grants = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let handle = loop {
            let random = std::collections::hash_map::RandomState::new();
            let token: String = (0..2)
                .map(|i| {
                    let mut h = random.build_hasher();
                    h.write_u64(i);
                    format!("{:016x}", h.finish())
                })
                .collect();
            if !grants.contains_key(&token) {
                break token;
            }
        };
        grants.insert(handle.clone(), path.clone());
        Ok(FolderGrant {
            handle,
            path: path.to_string_lossy().into_owned(),
        })
    }

    pub fn resolve(&self, handle: &str) -> Result<PathBuf, String> {
        self.0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(handle)
            .cloned()
            .ok_or_else(|| "choose this folder in Proscenium before opening it".into())
    }

    pub fn descendant(&self, handle: &str, relative: &str) -> Result<FolderGrant, String> {
        let root = self.resolve(handle)?;
        let path = crate::vault::resolve_under(&root, relative, "chosen folder")
            .map_err(|e| e.to_string())?;
        let resolved = path.canonicalize().map_err(|e| e.to_string())?;
        if !resolved.starts_with(&root) {
            return Err("that folder is outside the chosen folder".into());
        }
        self.grant(&resolved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_or_a_forged_handle_never_opens_a_folder() {
        let root = tempfile::tempdir().unwrap();
        let authority = Authority::default();
        assert!(authority.resolve(root.path().to_str().unwrap()).is_err());
        assert!(authority
            .resolve("00000000000000000000000000000000")
            .is_err());
        let grant = authority.grant(root.path()).unwrap();
        assert_eq!(
            authority.resolve(&grant.handle).unwrap(),
            root.path().canonicalize().unwrap()
        );
        assert!(
            Authority::default().resolve(&grant.handle).is_err(),
            "handles do not survive their native session"
        );
    }

    #[test]
    fn descendants_need_a_grant_and_cannot_escape_it() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("Play")).unwrap();
        let authority = Authority::default();
        let grant = authority.grant(root.path()).unwrap();
        assert!(authority.descendant(&grant.handle, "Play").is_ok());
        assert!(authority.descendant("forged", "Play").is_err());
        for path in ["../", "/", "Play/../../"] {
            assert!(authority.descendant(&grant.handle, path).is_err());
        }
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), root.path().join("escape")).unwrap();
            assert!(authority.descendant(&grant.handle, "escape").is_err());
        }
    }
}
