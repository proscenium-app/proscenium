// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! iCloud eviction artifacts.
//!
//! iCloud removes the *contents* of files it decides are not needed locally,
//! leaving a hidden stub named `.<original>.icloud` where the file's bytes used
//! to be. The stub is not a material, and its name is not the file's name.
//!
//! Treating it as either would be actively dangerous: a synced vault on a fresh
//! iPad would list as a folder of hidden junk with **every real play missing**,
//! and docs/app/keeping-work/storage-and-file-format.md#STOR-D8 reconciliation would faithfully report the writer's plays as
//! missing — a frightening lie about someone's work. So the vault maps a stub
//! back to the name it stands for, and fetches the bytes on read. Nothing above
//! the vault needs to know eviction exists.

use std::path::Path;

/// A name with remote-only bytes is occupied, and is not a readable empty file.
pub fn unavailable(path: &Path) -> bool {
    if !path.exists() {
        return path.file_name().is_some_and(|name| {
            path.with_file_name(format!(".{}.icloud", name.to_string_lossy()))
                .exists()
        });
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        use std::os::macos::fs::MetadataExt;
        // sys/stat.h SF_DATALESS: the provider owns the bytes but has evicted them.
        const SF_DATALESS: u32 = 0x4000_0000;
        std::fs::symlink_metadata(path).is_ok_and(|meta| meta.st_flags() & SF_DATALESS != 0)
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    false
}

pub fn require_available(path: &Path) -> std::io::Result<()> {
    if unavailable(path) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::WouldBlock,
            "This file is in iCloud and has not finished downloading yet.",
        ));
    }
    Ok(())
}

/// The real filename a `.icloud` stub stands for, or `None` when `name` is an
/// ordinary file.
pub fn placeholder_target(name: &str) -> Option<&str> {
    let inner = name.strip_prefix('.')?;
    let target = inner.strip_suffix(".icloud")?;
    if target.is_empty() {
        None
    } else {
        Some(target)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_a_stub_to_the_file_it_stands_for() {
        assert_eq!(
            placeholder_target(".running.fountain.icloud"),
            Some("running.fountain")
        );
        assert_eq!(
            placeholder_target(".the-weight-of-water.index.json.icloud"),
            Some("the-weight-of-water.index.json")
        );
        assert_eq!(
            placeholder_target(".project.json.icloud"),
            Some("project.json")
        );
    }

    #[test]
    fn leaves_ordinary_files_alone() {
        assert_eq!(placeholder_target("running.fountain"), None);
        assert_eq!(placeholder_target("project.json"), None);
        // Our own cache directory is dot-prefixed but is not a stub.
        assert_eq!(placeholder_target(".proscenium"), None);
        // Nor is a Syncthing marker.
        assert_eq!(placeholder_target(".stfolder"), None);
    }

    #[test]
    fn rejects_degenerate_names_rather_than_inventing_an_empty_file() {
        // A stub with nothing in front of the suffix names no file at all;
        // mapping it to "" would put a nameless entry in the binder.
        assert_eq!(placeholder_target(".icloud"), None);
        assert_eq!(placeholder_target("..icloud"), None);
        // Not dot-prefixed, so not a stub even though it ends the same way.
        assert_eq!(placeholder_target("notes.icloud"), None);
    }
}
