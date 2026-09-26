// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Provider conflict-copy discovery (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
//!
//! Scans the open folder for conflict copies a provider left behind — Syncthing
//! and Dropbox, the two whose naming is documented and stable — at open time;
//! the watcher reports new ones as they appear. They are surfaced under Changes
//! as *another version of X*, never listed as scripts.
//!
//! This module **never** deletes or rewrites either version. The writer
//! compares, keeps one, and moves the other to the trash.

use std::path::Path;

use crate::vault::sync_names::{is_conflict_copy, is_provider_artifact};

/// Relative paths (forward-slash) of every provider conflict copy found.
pub fn scan(root: &Path) -> Vec<String> {
    let mut found = Vec::new();
    walk(root, root, &mut found);
    found.sort();
    found
}

fn walk(root: &Path, dir: &Path, found: &mut Vec<String>) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            // Don't descend into a provider's own bookkeeping. `.stversions/`
            // in particular holds COPIES of real script files whose leaf names
            // look exactly like ours.
            if !is_provider_artifact(&name) && !name.starts_with('.') {
                walk(root, &path, found);
            }
        } else if is_conflict_copy(&name) {
            found.push(rel_of(root, &path));
        }
    }
}

fn rel_of(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}
