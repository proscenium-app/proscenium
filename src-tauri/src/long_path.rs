// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Windows' old limit on a path, 260 characters (docs/engineering/cross-platform.md#PLAT-67).
//!
//! The app does not declare itself long-path aware, and a writer's Windows
//! does not allow it by default, so a Windows call given a plain path past the
//! limit fails. A play's folder and files are named for its title
//! (src/workspace/filename.ts), so a long title in a Plays folder a few
//! folders deep passes it. Windows takes any length in the `\\?\` form.
//!
//! So the app keeps, compares and shows a path in its plain form, `C:\…`,
//! whatever its length ([`canonical`], [`plain`]), and the `\\?\` form is
//! given only to a call that does not make it itself ([`verbatim`]): Rust's
//! own file calls and the vault's do (vault/atomic_file.rs); the folder watch
//! does not. Comparing a canonical path that came back in the `\\?\` form with
//! one that did not judged a long play's own folder to be outside the Plays
//! folder, and it never opened.

use std::path::{Path, PathBuf};

/// `path`, canonical, in its plain form: what the app keeps and compares.
pub fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    Ok(plain(&dunce::canonicalize(path)?))
}

/// A path in the `\\?\` form, `\\?\C:\…` or `\\?\UNC\server\share\…`, in its
/// plain form, whatever its length; any other path as it is. A name the plain
/// form would read otherwise (a trailing dot or space, a device's name, `.`
/// or `..`, which `\\?\` takes literally) keeps the `\\?\` form.
#[cfg(windows)]
pub fn plain(path: &Path) -> PathBuf {
    use std::path::{Component, Prefix};
    let mut components = path.components();
    let Some(Component::Prefix(prefix)) = components.next() else {
        return path.to_path_buf();
    };
    let head = match prefix.kind() {
        Prefix::VerbatimDisk(drive) => format!("{}:\\", drive as char),
        Prefix::VerbatimUNC(server, share) => format!(
            r"\\{}\{}\",
            server.to_string_lossy(),
            share.to_string_lossy()
        ),
        _ => return path.to_path_buf(),
    };
    let mut out = PathBuf::from(head);
    for component in components {
        match component {
            Component::RootDir => {}
            Component::Normal(name) if plain_name(&name.to_string_lossy()) => out.push(name),
            _ => return path.to_path_buf(),
        }
    }
    out
}

#[cfg(not(windows))]
pub fn plain(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// `path` in the `\\?\` form when it is long enough to need it, for a Windows
/// call that does not make that form itself; any other path as it is.
#[cfg(windows)]
pub fn verbatim(path: &Path) -> PathBuf {
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Component, Prefix};
    // A folder's limit is twelve short of a file's: room for an 8.3 name.
    if path.as_os_str().encode_wide().count() < 248 {
        return path.to_path_buf();
    }
    let text = path.to_string_lossy();
    match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(_) => PathBuf::from(format!(r"\\?\{text}")),
            Prefix::UNC(..) => PathBuf::from(format!(r"\\?\UNC\{}", &text[2..])),
            _ => path.to_path_buf(),
        },
        _ => path.to_path_buf(),
    }
}

#[cfg(not(windows))]
pub fn verbatim(path: &Path) -> PathBuf {
    path.to_path_buf()
}

/// A name Windows reads as itself in a plain path.
#[cfg_attr(not(windows), allow(dead_code))]
fn plain_name(name: &str) -> bool {
    if name.is_empty() || name.ends_with('.') || name.ends_with(' ') {
        return false;
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    let device = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ((stem.starts_with("COM") || stem.starts_with("LPT"))
        && stem.chars().count() == 4
        && stem
            .chars()
            .last()
            .is_some_and(|c| matches!(c, '1'..='9' | '¹' | '²' | '³')));
    !device
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_windows_reads_as_itself_is_plain() {
        for name in [
            "Plays",
            "The Weight of Water",
            "Pièce",
            "戯曲と脚本",
            "CON-file",
            "COM0",
            "Aux-file.draft",
        ] {
            assert!(plain_name(name), "{name}");
        }
        for name in [
            "", ".", "..", "Draft.", "Draft ", "CON", "con.txt", "COM1", "LPT²", "CONIN$",
        ] {
            assert!(!plain_name(name), "{name}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_long_path_is_kept_plain_and_given_verbatim() {
        let long = format!(r"C:\Plays\{}\Play", "戯曲".repeat(130));
        let plain_long = PathBuf::from(&long);
        assert_eq!(plain(&PathBuf::from(format!(r"\\?\{long}"))), plain_long);
        assert_eq!(verbatim(&plain_long), PathBuf::from(format!(r"\\?\{long}")));
        assert_eq!(verbatim(Path::new(r"C:\Plays")), PathBuf::from(r"C:\Plays"));
        assert_eq!(
            plain(Path::new(r"\\?\UNC\server\share\Plays")),
            PathBuf::from(r"\\server\share\Plays")
        );
        // A name the plain form would read otherwise keeps `\\?\`.
        let odd = PathBuf::from(r"\\?\C:\Plays\Draft.");
        assert_eq!(plain(&odd), odd);
        assert_eq!(plain(Path::new(r"C:\Plays")), PathBuf::from(r"C:\Plays"));
    }

    #[cfg(windows)]
    #[test]
    fn a_long_folder_is_canonical_in_its_plain_form() {
        let root = tempfile::tempdir().unwrap();
        let mut deep = canonical(root.path()).unwrap();
        while deep.to_string_lossy().chars().count() < 300 {
            deep.push("Сочинения и пьесы");
        }
        std::fs::create_dir_all(&deep).unwrap();
        let found = canonical(&deep).unwrap();
        assert!(
            !found.to_string_lossy().starts_with(r"\\?\"),
            "{}",
            found.display()
        );
        assert!(found.starts_with(canonical(root.path()).unwrap()));
    }
}
