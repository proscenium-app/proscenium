// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Which sync providers manage a folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D11), for the one sentence
//! that says where the plays live, for diagnostics, and for the one placement
//! the app refuses outright: a folder two providers both manage (docs/app/keeping-work/storage-and-file-format.md#STOR-D2), where
//! an eviction by one presents as a deletion to the other.
//!
//! Detection order, as docs/app/keeping-work/storage-and-file-format.md#STOR-D11 gives it for macOS:
//!
//!  1. **File Provider clients** — the provider segment of
//!     `~/Library/CloudStorage/<Provider>-<account>/` (Dropbox, OneDrive, Google
//!     Drive, Box, and anything else built on File Provider). Authoritative for
//!     that tree, so the iCloud check below is not asked there: a File Provider
//!     item can call itself ubiquitous too.
//!  2. **iCloud Drive** — anything under `~/Library/Mobile Documents/`, or an
//!     item the platform says is ubiquitous (Desktop & Documents in iCloud keeps
//!     `~/Documents` at its old path, so the path alone would miss it).
//!  3. **Dropbox's classic client** — a folder under a path in
//!     `~/.dropbox/info.json`.
//!  4. **Syncthing** — a `.stfolder` marker at or above the folder.
//!
//! Anything else is a folder on this Mac only. Facts, not meaning: the words a
//! writer reads are the frontend's (`src/workspace/plays-folder.ts`).

use std::path::{Path, PathBuf};

/// What detection needs from the world, injected so tests need no Dropbox, no
/// iCloud account and no real home directory.
pub struct Environment<'a> {
    pub home: PathBuf,
    /// The platform's answer to "is this an iCloud item?" (scope.rs).
    pub is_icloud_item: &'a dyn Fn(&Path) -> bool,
}

/// Provider ids: `icloud`, `dropbox`, `onedrive`, `google-drive`, `box`,
/// `syncthing`, or another File Provider's own name, lower-cased.
pub fn detect(path: &Path, env: &Environment) -> Vec<String> {
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let mut found: Vec<String> = Vec::new();
    let mut add = |id: String| {
        if !found.contains(&id) {
            found.push(id);
        }
    };

    let cloud_storage = env.home.join("Library/CloudStorage");
    let file_provider = path
        .strip_prefix(&cloud_storage)
        .ok()
        .and_then(|rest| rest.components().next())
        .map(|c| file_provider_id(&c.as_os_str().to_string_lossy()));
    if let Some(id) = &file_provider {
        add(id.clone());
    }

    if path.starts_with(env.home.join("Library/Mobile Documents"))
        || (file_provider.is_none() && (env.is_icloud_item)(&path))
    {
        add("icloud".into());
    }

    if dropbox_roots(&env.home)
        .iter()
        .any(|root| path.starts_with(root))
    {
        add("dropbox".into());
    }

    if path.ancestors().any(|dir| dir.join(".stfolder").exists()) {
        add("syncthing".into());
    }

    found
}

/// `Dropbox`, `OneDrive-Personal`, `GoogleDrive-alex@example.com`, `Box-Box`.
fn file_provider_id(segment: &str) -> String {
    let name = segment.split('-').next().unwrap_or(segment);
    match name {
        "GoogleDrive" => "google-drive".into(),
        other => other.to_lowercase(),
    }
}

/// The folders Dropbox's classic client syncs, from its own `info.json`
/// (`{"personal": {"path": …}, "business": {"path": …}}`). Unreadable — the
/// sandbox, or no Dropbox — is no folders.
fn dropbox_roots(home: &Path) -> Vec<PathBuf> {
    let Ok(bytes) = std::fs::read(home.join(".dropbox/info.json")) else {
        return Vec::new();
    };
    let Ok(serde_json::Value::Object(accounts)) = serde_json::from_slice(&bytes) else {
        return Vec::new();
    };
    accounts
        .values()
        .filter_map(|a| a.get("path")?.as_str())
        .map(|p| {
            let p = PathBuf::from(p);
            p.canonicalize().unwrap_or(p)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(home: &Path, icloud: &'static dyn Fn(&Path) -> bool) -> Environment<'static> {
        Environment {
            home: home.to_path_buf(),
            is_icloud_item: icloud,
        }
    }

    fn mkdir(p: &Path) -> PathBuf {
        std::fs::create_dir_all(p).unwrap();
        p.canonicalize().unwrap()
    }

    #[test]
    fn a_plain_folder_is_this_mac_only() {
        let tmp = tempfile::tempdir().unwrap();
        let home = mkdir(&tmp.path().join("home"));
        let plays = mkdir(&home.join("Documents/Plays"));
        assert!(detect(&plays, &env(&home, &|_| false)).is_empty());
    }

    #[test]
    fn icloud_by_path_and_by_the_platforms_word() {
        let tmp = tempfile::tempdir().unwrap();
        let home = mkdir(&tmp.path().join("home"));
        let drive = mkdir(&home.join("Library/Mobile Documents/com~apple~CloudDocs/Writing/Plays"));
        assert_eq!(detect(&drive, &env(&home, &|_| false)), vec!["icloud"]);
        // Desktop & Documents in iCloud: the old path, and the platform says so.
        let docs = mkdir(&home.join("Documents/Plays"));
        assert_eq!(detect(&docs, &env(&home, &|_| true)), vec!["icloud"]);
    }

    #[test]
    fn file_provider_clients_are_named_by_their_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let home = mkdir(&tmp.path().join("home"));
        for (segment, id) in [
            ("Dropbox", "dropbox"),
            ("OneDrive-Personal", "onedrive"),
            ("GoogleDrive-writer@example.com", "google-drive"),
            ("Box-Box", "box"),
        ] {
            let plays = mkdir(
                &home
                    .join("Library/CloudStorage")
                    .join(segment)
                    .join("Plays"),
            );
            // Even when the platform calls its items ubiquitous, it is not iCloud.
            assert_eq!(detect(&plays, &env(&home, &|_| true)), vec![id.to_string()]);
        }
    }

    #[test]
    fn dropbox_classic_from_its_own_info_file() {
        let tmp = tempfile::tempdir().unwrap();
        let home = mkdir(&tmp.path().join("home"));
        let dropbox = mkdir(&home.join("Dropbox"));
        let plays = mkdir(&dropbox.join("Plays"));
        std::fs::create_dir_all(home.join(".dropbox")).unwrap();
        std::fs::write(
            home.join(".dropbox/info.json"),
            format!(
                r#"{{"personal":{{"path":"{}","host":1}}}}"#,
                dropbox.display()
            ),
        )
        .unwrap();
        assert_eq!(detect(&plays, &env(&home, &|_| false)), vec!["dropbox"]);
        assert!(detect(&mkdir(&home.join("Elsewhere")), &env(&home, &|_| false)).is_empty());
    }

    #[test]
    fn syncthing_from_a_marker_at_or_above() {
        let tmp = tempfile::tempdir().unwrap();
        let home = mkdir(&tmp.path().join("home"));
        let share = mkdir(&home.join("Sync"));
        std::fs::create_dir(share.join(".stfolder")).unwrap();
        let plays = mkdir(&share.join("Writing/Plays"));
        assert_eq!(detect(&plays, &env(&home, &|_| false)), vec!["syncthing"]);
    }

    /// docs/app/keeping-work/storage-and-file-format.md#STOR-D2's example, exactly: a Syncthing share inside iCloud Drive.
    #[test]
    fn two_providers_on_one_tree_are_both_reported() {
        let tmp = tempfile::tempdir().unwrap();
        let home = mkdir(&tmp.path().join("home"));
        let share = mkdir(&home.join("Library/Mobile Documents/com~apple~CloudDocs/Shared"));
        std::fs::create_dir(share.join(".stfolder")).unwrap();
        let plays = mkdir(&share.join("Plays"));
        assert_eq!(
            detect(&plays, &env(&home, &|_| false)),
            vec!["icloud", "syncthing"]
        );
    }
}
