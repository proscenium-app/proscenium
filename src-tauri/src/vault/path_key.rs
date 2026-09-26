// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::{Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

/// docs/app/keeping-work/storage-and-file-format.md#STOR-D4, shared with src/storage/path-key.ts. Comparison/lock keys only;
/// never use the result to address a file on disk.
pub fn path_key(path: &str) -> String {
    path.nfc().collect::<String>().trim_end_matches('/').to_lowercase().nfc().collect()
}
pub fn comparison_path(path: &Path) -> PathBuf { PathBuf::from(path_key(&path.to_string_lossy())) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a220_unicode_case_and_trailing_separator_share_one_key() {
        assert_eq!(path_key("Notes/Café.md"), path_key("NOTES/Cafe\u{301}.MD/"));
        assert_ne!(path_key("Notes/Café.md"), path_key("Notes/Cafe.md"));
    }
}
