// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::{fs::File, io::{self, Read}, path::Path};

/// Matches src/storage/read-limit.ts. Read at most one byte beyond the bound
/// even if the file grows after stat; never allocate from an untrusted length.
pub const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;
fn too_large() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData,
        "This file is larger than Proscenium's 16 MiB document limit. Its original has not been changed.")
}
fn bounded(mut reader: impl Read) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.by_ref().take(MAX_DOCUMENT_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES { return Err(too_large()); }
    Ok(bytes)
}
pub fn read_document(path: &Path) -> io::Result<Vec<u8>> {
    let file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "This document is not a regular file."));
    }
    if metadata.len() > MAX_DOCUMENT_BYTES { return Err(too_large()); }
    bounded(file)
}

/// A package's files: each one's `/`-separated path inside it, and its bytes.
pub type PackageFiles = Vec<(String, Vec<u8>)>;

/// Files a package may hold, matching the import's ZIP entry bound
/// (docs/app/importing/document-import.md#IMPT-80).
const MAX_PACKAGE_FILES: usize = 4096;
const MAX_PACKAGE_DEPTH: usize = 16;

/// A package-form document (a `.pages` folder) as its files: each regular file
/// by its `/`-separated path inside the folder, in path order. The whole
/// package is held to the one-document bound, because it is kept as the play's
/// original (docs/app/importing/document-import.md#IMPT-89). A plain file is
/// `None`, for the caller to read as bytes; links inside are skipped, never
/// followed.
pub fn read_package(dir: &Path) -> io::Result<Option<PackageFiles>> {
    if !std::fs::symlink_metadata(dir)?.is_dir() {
        return Ok(None);
    }
    let mut files = Vec::new();
    let mut total: u64 = 0;
    let mut pending = vec![(dir.to_path_buf(), String::new(), 0usize)];
    while let Some((at, prefix, depth)) = pending.pop() {
        for entry in std::fs::read_dir(&at)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let rel = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
            if kind.is_dir() {
                if depth >= MAX_PACKAGE_DEPTH { return Err(too_complex()); }
                pending.push((entry.path(), rel, depth + 1));
            } else if kind.is_file() {
                if files.len() >= MAX_PACKAGE_FILES { return Err(too_complex()); }
                // Checked before the read, and again after it: a file can grow.
                if total + entry.metadata()?.len() > MAX_DOCUMENT_BYTES { return Err(too_large()); }
                let bytes = read_document(&entry.path())?;
                total += bytes.len() as u64;
                if total > MAX_DOCUMENT_BYTES { return Err(too_large()); }
                files.push((rel, bytes));
            }
        }
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(Some(files))
}
fn too_complex() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData,
        "This document holds too many files to import. Export it to Word and import that. Its original has not been changed.")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a106_bounded_reader_stops_a_growing_input() {
        let mut stream = io::repeat(b'a');
        assert!(bounded(&mut stream).unwrap_err().to_string().contains("16 MiB"));
        assert_eq!(bounded(io::Cursor::new(b"small")).unwrap(), b"small");
    }

    #[test]
    fn a106_oversized_open_leaves_the_file_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("large.fdx");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_DOCUMENT_BYTES + 1).unwrap();
        assert!(read_document(&path).unwrap_err().to_string().contains("16 MiB"));
        assert_eq!(file.metadata().unwrap().len(), MAX_DOCUMENT_BYTES + 1);
    }

    #[test]
    fn impt89_a_package_reads_as_its_files_in_path_order_without_following_links() {
        let dir = tempfile::tempdir().unwrap();
        let package = dir.path().join("Draft.pages");
        std::fs::create_dir_all(package.join("Metadata")).unwrap();
        std::fs::write(package.join("Index.zip"), b"index").unwrap();
        std::fs::write(package.join("Metadata/Properties.plist"), b"plist").unwrap();
        std::fs::write(package.join(".iwpv2"), b"verifier").unwrap();
        std::fs::write(dir.path().join("elsewhere.txt"), b"not the package's").unwrap();
        std::os::unix::fs::symlink(dir.path().join("elsewhere.txt"), package.join("link.txt")).unwrap();
        let files = read_package(&package).unwrap().unwrap();
        let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, [".iwpv2", "Index.zip", "Metadata/Properties.plist"]);
        assert_eq!(files[1].1, b"index");
        // A plain file is not a package: the caller reads it as bytes.
        assert!(read_package(&dir.path().join("elsewhere.txt")).unwrap().is_none());
    }

    #[test]
    fn impt89_a_package_over_the_document_bound_is_refused_whole() {
        let dir = tempfile::tempdir().unwrap();
        let package = dir.path().join("Large.pages");
        std::fs::create_dir(&package).unwrap();
        for name in ["a", "b"] {
            File::create(package.join(name)).unwrap().set_len(MAX_DOCUMENT_BYTES / 2 + 1).unwrap();
        }
        assert!(read_package(&package).unwrap_err().to_string().contains("16 MiB"));
    }
}
