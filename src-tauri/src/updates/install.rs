// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! A verified archive is bound to its manifest, staged on the
//! destination volume, and exchanged atomically. The pinned plugin's macOS
//! installer is deliberately not called: its failed move drops the old app.

use flate2::read::GzDecoder;
use std::fs;
use std::io::{self, Cursor, Read};
use std::path::{Component, Path, PathBuf};

const MAX_EXPANDED: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;
const MAX_PLIST: u64 = 1024 * 1024;

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

pub fn running_bundle() -> io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    exe.ancestors()
        .find(|p| p.extension().is_some_and(|e| e == "app"))
        .map(Path::to_path_buf)
        .ok_or_else(|| invalid("Move Proscenium to Applications and reopen it before updating."))
}

pub fn preflight(bundle: &Path) -> io::Result<()> {
    if bundle
        .components()
        .any(|p| p.as_os_str() == "AppTranslocation")
    {
        return Err(invalid("Move Proscenium to Applications, eject the downloaded disk image, and reopen it before updating."));
    }
    let parent = bundle
        .parent()
        .ok_or_else(|| invalid("The app has no install folder."))?;
    if !bundle.is_dir() || fs::symlink_metadata(bundle)?.file_type().is_symlink() {
        return Err(invalid(
            "Reopen the installed Proscenium app before updating.",
        ));
    }
    // Creating a sibling proves both writability and same-volume staging. A
    // writable app on another volume is supported; nothing goes through /tmp.
    let probe = tempfile::Builder::new().prefix(".proscenium-preflight-").tempdir_in(parent)
        .map_err(|_| invalid("This copy is in a folder Proscenium cannot update. Move it to Applications and reopen it."))?;
    let a = probe.path().join("old");
    let b = probe.path().join("new");
    fs::create_dir(&a)?;
    fs::create_dir(&b)?;
    exchange(&a, &b).map_err(|_| invalid("This volume cannot safely replace the app. Move Proscenium to Applications and reopen it."))?;
    Ok(())
}

fn archive(bytes: &[u8]) -> tar::Archive<GzDecoder<Cursor<&[u8]>>> {
    tar::Archive::new(GzDecoder::new(Cursor::new(bytes)))
}

/// No extraction occurs until the signature was verified by download.rs.
/// Inspect every entry before unpacking: one bundle, bounded expansion, and
/// no traversal or links outside that bundle.
pub fn inspect(
    bytes: &[u8],
    expected_id: &str,
    expected_version: &str,
    current_version: &str,
) -> io::Result<String> {
    let expected = semver::Version::parse(expected_version).map_err(|e| invalid(e.to_string()))?;
    let current = semver::Version::parse(current_version).map_err(|e| invalid(e.to_string()))?;
    if expected <= current {
        return Err(invalid("The update must be newer than this version."));
    }
    let mut bundle = None;
    let mut info = None;
    let mut executable = None;
    let mut paths = std::collections::HashSet::new();
    let mut executables = std::collections::HashSet::new();
    let mut expanded = 0u64;
    for (count, entry) in archive(bytes).entries()?.enumerate() {
        if count >= MAX_ENTRIES {
            return Err(invalid("The update contains too many files."));
        }
        let mut entry = entry?;
        expanded = expanded
            .checked_add(entry.size())
            .ok_or_else(|| invalid("The update is too large."))?;
        if expanded > MAX_EXPANDED {
            return Err(invalid("The expanded update exceeds its size limit."));
        }
        let path = entry.path()?.into_owned();
        if !paths.insert(path.clone()) {
            return Err(invalid("The update repeats an archive path."));
        }
        let components: Vec<_> = path.components().collect();
        if components.is_empty()
            || components
                .iter()
                .any(|p| !matches!(p, Component::Normal(_)))
        {
            return Err(invalid("The update contains an unsafe path."));
        }
        let root = components[0].as_os_str().to_string_lossy().into_owned();
        if !root.ends_with(".app") || bundle.as_ref().is_some_and(|b| b != &root) {
            return Err(invalid("The update must contain exactly one app bundle."));
        }
        bundle = Some(root.clone());
        let kind = entry.header().entry_type();
        if components.len() == 1 && !kind.is_dir() {
            return Err(invalid("The app bundle must be a directory."));
        }
        if kind.is_file() && entry.header().mode()? & 0o111 != 0 {
            executables.insert(path.clone());
        }
        if kind.is_symlink() {
            let target = entry
                .link_name()?
                .ok_or_else(|| invalid("The update contains an invalid link."))?;
            let mut depth = components.len() - 1;
            for component in target.components() {
                match component {
                    Component::Normal(_) => depth += 1,
                    Component::CurDir => {}
                    Component::ParentDir if depth > 1 => depth -= 1,
                    _ => return Err(invalid("The update contains a link outside its bundle.")),
                }
            }
        } else if !kind.is_dir() && !kind.is_file() {
            return Err(invalid("The update contains an unsupported archive entry."));
        }
        if path == Path::new(&root).join("Contents/Info.plist") {
            if info.is_some() || !kind.is_file() || entry.size() > MAX_PLIST {
                return Err(invalid("The update contains an invalid app manifest."));
            }
            let mut data = Vec::new();
            entry.read_to_end(&mut data)?;
            let value =
                plist::Value::from_reader(Cursor::new(data)).map_err(|e| invalid(e.to_string()))?;
            let dict = value
                .as_dictionary()
                .ok_or_else(|| invalid("The update has no app manifest."))?;
            let field = |name| dict.get(name).and_then(plist::Value::as_string);
            // macOS allows only X.Y.Z in CFBundleShortVersionString, so a track
            // build's whole version is its own key, and both must agree with
            // the notice.
            let short = field("CFBundleShortVersionString");
            let whole = field(crate::version::KEY).or(short);
            let base = format!("{}.{}.{}", expected.major, expected.minor, expected.patch);
            if field("CFBundleIdentifier") != Some(expected_id)
                || whole != Some(expected_version)
                || short != Some(base.as_str())
            {
                return Err(invalid(
                    "The signed app's identity or version does not match the update notice.",
                ));
            }
            let binary = field("CFBundleExecutable")
                .ok_or_else(|| invalid("The update does not name its executable."))?;
            if Path::new(binary).components().count() != 1
                || !matches!(
                    Path::new(binary).components().next(),
                    Some(Component::Normal(_))
                )
            {
                return Err(invalid("The update names an invalid executable."));
            }
            executable = Some(Path::new(&root).join("Contents/MacOS").join(binary));
            info = Some(());
        }
    }
    if info.is_none() {
        return Err(invalid("The update has no app manifest."));
    }
    if !executable.is_some_and(|path| executables.contains(&path)) {
        return Err(invalid("The update is missing its executable."));
    }
    bundle.ok_or_else(|| invalid("The update contains no app."))
}

fn exchange(a: &Path, b: &Path) -> io::Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let a = std::ffi::CString::new(a.as_os_str().as_bytes())?;
    let b = std::ffi::CString::new(b.as_os_str().as_bytes())?;
    // macOS 14's atomic exchange: either both names change or neither does.
    if unsafe { libc::renamex_np(a.as_ptr(), b.as_ptr(), libc::RENAME_SWAP) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn sync_tree(path: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        for entry in fs::read_dir(path)? {
            sync_tree(&entry?.path())?;
        }
    }
    fs::File::open(path)?.sync_all()
}

fn swap(
    bundle: &Path,
    staged: &Path,
    mut exchange: impl FnMut(&Path, &Path) -> io::Result<()>,
    durable: impl FnOnce() -> io::Result<()>,
) -> io::Result<()> {
    exchange(bundle, staged)?;
    if let Err(error) = durable() {
        // A failed durability step restores the original. If the filesystem
        // also refuses rollback, retain both paths for recovery, never delete.
        return match exchange(bundle, staged) {
            Ok(()) => Err(error),
            Err(rollback) => Err(invalid(format!("The update could not finish ({error}) or restore the old app ({rollback}). Its recoverable copy remains at {}.", staged.display()))),
        };
    }
    Ok(())
}

pub fn install(
    bundle: &Path,
    bytes: &[u8],
    id: &str,
    version: &str,
    current: &str,
) -> io::Result<()> {
    preflight(bundle)?;
    let name = inspect(bytes, id, version, current)?;
    let parent = bundle
        .parent()
        .ok_or_else(|| invalid("The app has no install folder."))?;
    let stage = tempfile::Builder::new()
        .prefix(".proscenium-update-")
        .tempdir_in(parent)?;
    archive(bytes).unpack(stage.path())?;
    let staged = stage.path().join(name);
    sync_tree(&staged)?;
    fs::File::open(stage.path())?.sync_all()?;
    // From here on, cleanup must be explicit. A process interruption retains
    // the stage and, after the exchange, the complete old app inside it.
    let directory = stage.keep();
    swap(bundle, &staged, exchange, || {
        fs::File::open(parent)?.sync_all()?;
        fs::File::open(&directory)?.sync_all()
    })?;
    // Only a durable, successful swap permits deleting the old app. Failure
    // to clean it up is harmless; the installed app is already complete.
    let _ = fs::remove_dir_all(directory);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pair() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("Proscenium.app");
        let new = dir.path().join("New.app");
        for (path, text) in [(&old, "old"), (&new, "new")] {
            fs::create_dir(path).unwrap();
            fs::write(path.join("binary"), text).unwrap();
        }
        (dir, old, new)
    }

    #[test]
    fn a_failed_swap_or_sync_keeps_the_working_app() {
        let (_dir, old, new) = pair();
        assert!(swap(
            &old,
            &new,
            |_, _| Err(io::Error::from(io::ErrorKind::PermissionDenied)),
            || Ok(())
        )
        .is_err());
        assert_eq!(fs::read(old.join("binary")).unwrap(), b"old");
        assert!(swap(&old, &new, exchange, || Err(io::Error::from(
            io::ErrorKind::StorageFull
        )))
        .is_err());
        assert_eq!(fs::read(old.join("binary")).unwrap(), b"old");
        assert_eq!(fs::read(new.join("binary")).unwrap(), b"new");
    }

    #[test]
    fn a_successful_atomic_swap_retains_the_old_bundle_until_cleanup() {
        let (_dir, old, new) = pair();
        swap(&old, &new, exchange, || Ok(())).unwrap();
        assert_eq!(fs::read(old.join("binary")).unwrap(), b"new");
        assert_eq!(fs::read(new.join("binary")).unwrap(), b"old");
    }

    #[test]
    fn a_refused_rollback_retains_both_bundles_for_recovery() {
        let (_dir, old, new) = pair();
        let mut calls = 0;
        let result = swap(
            &old,
            &new,
            |a, b| {
                calls += 1;
                if calls == 1 {
                    exchange(a, b)
                } else {
                    Err(io::Error::from(io::ErrorKind::PermissionDenied))
                }
            },
            || Err(io::Error::from(io::ErrorKind::StorageFull)),
        );
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("recoverable copy remains"));
        assert_eq!(fs::read(old.join("binary")).unwrap(), b"new");
        assert_eq!(fs::read(new.join("binary")).unwrap(), b"old");
    }

    #[test]
    fn location_preflight_supports_writable_folders_and_refuses_translocation() {
        let (dir, old, _) = pair();
        preflight(&old).unwrap();
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
        assert!(preflight(Path::new("/private/AppTranslocation/random/Proscenium.app")).is_err());
        assert!(preflight(&dir.path().join("absent.app")).is_err());
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o500)).unwrap();
        let denied = preflight(&old);
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert!(denied.is_err());
    }

    fn fixture(id: &str, version: &str) -> Vec<u8> {
        fixture_with(id, version, None)
    }

    /// An archive whose app says `short` to macOS and, on a track, `whole` in
    /// its own key.
    fn fixture_with(id: &str, short: &str, whole: Option<&str>) -> Vec<u8> {
        let mut dict = plist::Dictionary::new();
        dict.insert("CFBundleIdentifier".into(), id.into());
        dict.insert("CFBundleShortVersionString".into(), short.into());
        if let Some(whole) = whole {
            dict.insert(crate::version::KEY.into(), whole.into());
        }
        dict.insert("CFBundleExecutable".into(), "proscenium".into());
        let mut xml = Vec::new();
        plist::Value::Dictionary(dict)
            .to_writer_xml(&mut xml)
            .unwrap();
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut tar = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(xml.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, "Proscenium.app/Contents/Info.plist", &xml[..])
            .unwrap();
        let mut binary = tar::Header::new_gnu();
        binary.set_size(3);
        binary.set_mode(0o755);
        binary.set_cksum();
        tar.append_data(
            &mut binary,
            "Proscenium.app/Contents/MacOS/proscenium",
            &b"exe"[..],
        )
        .unwrap();
        tar.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn the_signed_bundle_must_match_the_manifest_and_be_newer() {
        let bytes = fixture("org.habiby.proscenium", "1.1.0");
        assert!(inspect(&bytes, "org.habiby.proscenium", "1.1.0", "1.0.0").is_ok());
        assert!(inspect(&bytes, "org.habiby.proscenium", "9.0.0", "1.0.0").is_err());
        assert!(inspect(&bytes, "org.habiby.proscenium", "1.1.0", "1.1.0").is_err());
        assert!(inspect(&bytes, "org.habiby.proscenium", "1.1.0", "2.0.0").is_err());
        assert!(inspect(&bytes, "a.different.app", "1.1.0", "1.0.0").is_err());
    }

    #[test]
    fn a_track_archive_is_checked_by_its_whole_version() {
        const ID: &str = "org.habiby.proscenium";
        let alpha = fixture_with(ID, "1.0.1", Some("1.0.1-alpha.58"));
        assert!(inspect(&alpha, ID, "1.0.1-alpha.58", "1.0.1-alpha.57").is_ok());
        assert!(
            inspect(&alpha, ID, "1.0.1-alpha.58", "1.0.0").is_ok(),
            "stable to alpha"
        );
        assert!(
            inspect(&alpha, ID, "1.0.1-alpha.58", "1.0.1-alpha.58").is_err(),
            "not newer"
        );
        assert!(
            inspect(&alpha, ID, "1.0.1-alpha.59", "1.0.1-alpha.57").is_err(),
            "another alpha's notice"
        );
        assert!(
            inspect(&alpha, ID, "1.0.1", "1.0.0").is_err(),
            "an alpha passed off as the release"
        );
        // A release carries no key, and supersedes its own alphas.
        let release = fixture(ID, "1.0.1");
        assert!(inspect(&release, ID, "1.0.1", "1.0.1-alpha.57").is_ok());
        assert!(
            inspect(&release, ID, "1.0.1-alpha.58", "1.0.1-alpha.57").is_err(),
            "a release passed off as an alpha"
        );
        // The key and the version macOS reads must be the same X.Y.Z.
        let mismatched = fixture_with(ID, "1.0.2", Some("1.0.1-alpha.58"));
        assert!(inspect(&mismatched, ID, "1.0.1-alpha.58", "1.0.1-alpha.57").is_err());
    }

    #[test]
    fn a_complete_install_replaces_only_after_archive_validation() {
        let (dir, old, _) = pair();
        let bytes = fixture("org.habiby.proscenium", "1.1.0");
        assert!(install(&old, &bytes, "org.habiby.proscenium", "9.0.0", "1.0.0").is_err());
        assert_eq!(fs::read(old.join("binary")).unwrap(), b"old");
        install(&old, &bytes, "org.habiby.proscenium", "1.1.0", "1.0.0").unwrap();
        assert_eq!(
            fs::read(old.join("Contents/MacOS/proscenium")).unwrap(),
            b"exe"
        );
        assert_eq!(
            fs::read_dir(dir.path()).unwrap().count(),
            2,
            "only a successful install cleans its backup"
        );
    }
}
