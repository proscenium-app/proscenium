// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! App data: everything disposable or local, keyed by play id (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
//!
//! ```text
//! <app data>/
//! ├── settings.json                      ← Plays folder bookmark + hint, accent…
//! └── plays/<playId>/
//!     ├── versions/<scriptId>/<ts>-<reason>.fountain
//!     ├── changes/                       ← baselines and before-texts
//!     ├── recovery/<scriptId>.snapshot
//!     ├── cache/
//!     └── trash/                         ← iOS/Android only
//! ```
//!
//! **None of this lives in the Plays folder.** Before 1.0 the version ring and
//! the change ledger sat in a `.proscenium/` directory inside each play, which
//! put app state inside a tree a sync provider was free to sync, evict, or
//! resolve however it liked — and put a hidden directory in a folder that is
//! supposed to hold only the writer's work (docs/app/keeping-work/storage-and-file-format.md#STOR-111).
//!
//! Deleting the whole directory loses no writing: the current state of every
//! file is always in the play folder.
//!
//! Boundary as everywhere else: **Rust stores bytes, TypeScript assigns
//! meaning.** This module knows about paths, rings and pruning, and nothing
//! about what a version contains.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

pub mod recovery;
pub mod versions;
/// The vault's atomic writer, which app data uses too (vault::write_atomic).
pub(crate) use crate::vault::write_atomic;
pub use versions::VersionEntry;

#[cfg(test)]
mod tests;

/// One play's app-data directory.
pub struct PlayStore {
    root: PathBuf,
}

/// A play id is a ULID we minted. Validated before it becomes a directory name
/// so a malformed one can never reach outside the store.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The app-data root. On a sandboxed Mac this resolves inside the container,
/// which is exactly what docs/app/keeping-work/storage-and-file-format.md#STOR-D12 wants: no entitlement, no bookmark, no picker.
pub fn app_data_dir(app: &AppHandle) -> std::io::Result<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string()))
}

impl PlayStore {
    pub fn open(app: &AppHandle, play_id: &str) -> std::io::Result<Self> {
        if !valid_id(play_id) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid play id",
            ));
        }
        let root = app_data_dir(app)?.join("plays").join(play_id);
        Ok(Self { root })
    }

    /// A store rooted at an explicit directory. The path-based door, for tests
    /// and for the migration, neither of which has a Tauri `AppHandle`.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn at(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve a store-relative path: the vault's own rule — no `..`, no
    /// absolute paths, no symlinks — because this module touches exactly one tree.
    fn resolve(&self, rel: &str) -> std::io::Result<PathBuf> {
        crate::vault::resolve_under(&self.root, rel, "store")
    }

    pub fn exists(&self, rel: &str) -> bool {
        self.resolve(rel).map(|p| p.exists()).unwrap_or(false)
    }

    pub fn read(&self, rel: &str) -> std::io::Result<Vec<u8>> {
        std::fs::read(self.resolve(rel)?)
    }

    /// Write durably. The store is local and disposable, but a half-written
    /// baseline would make a diff lie, and a half-written recovery snapshot
    /// would offer a writer half their words — so it goes through the vault's
    /// own atomic writer, the same temp + fsync + rename as a script.
    pub fn write(&self, rel: &str, bytes: &[u8]) -> std::io::Result<()> {
        let target = self.resolve(rel)?;
        crate::vault::write_atomic(&target, bytes)
    }

    pub fn remove(&self, rel: &str) -> std::io::Result<()> {
        let p = self.resolve(rel)?;
        if !p.exists() {
            return Ok(());
        }
        if p.is_dir() {
            std::fs::remove_dir_all(p)
        } else {
            std::fs::remove_file(p)
        }
    }

    /// File names directly under `rel_dir`, sorted. Missing directory = empty.
    pub fn list(&self, rel_dir: &str) -> std::io::Result<Vec<String>> {
        let dir = self.resolve(rel_dir)?;
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut names: Vec<String> = std::fs::read_dir(&dir)?
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        Ok(names)
    }
}
