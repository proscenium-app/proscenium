// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Coordinated access to a folder in iCloud Drive
//! (docs/engineering/cross-platform.md#PLAT-12).
//!
//! On an iPad, Apple's rule for a folder picked through the document picker is
//! that its contents are read and written through a file coordinator, so that
//! iCloud's own process, which syncs the folder, never meets a file half
//! listed, half read or half replaced. The vault stays the one atomic writer
//! (docs/app/keeping-work/storage-and-file-format.md#STOR-D9): a coordinator
//! only says when a listing, a read or a replace may run, and the vault runs it
//! inside that access.
//!
//! Nothing here knows the platform. The iPad's build installs a
//! [`Coordinator`] at launch, backed by the folder-picker plugin; every other
//! build installs none, and each access below then runs as it always has. A
//! coordinator also says which paths it covers: a folder on the device itself
//! is not in iCloud Drive and pays nothing.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// What the vault is about to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// List a folder's contents, as far as they are known: nothing is fetched.
    List,
    /// Read a file. A file whose bytes iCloud has evicted is fetched first.
    Read,
    /// Put a new file in the old one's place: the atomic replace.
    Replace,
}

impl Access {
    /// How the iPad's coordinator names it to the folder-picker plugin.
    #[cfg_attr(not(any(target_os = "ios", test)), allow(dead_code))]
    pub fn as_str(self) -> &'static str {
        match self {
            Access::List => "list",
            Access::Read => "read",
            Access::Replace => "replace",
        }
    }
}

/// An access the coordinator granted. It is held until dropped.
pub trait Lease: Send {
    /// The path to use while the access is held: the coordinator may hand back
    /// another URL for the same item, for one that moved.
    fn path(&self) -> &Path;
}

/// What the platform gives the vault for coordinated access.
pub trait Coordinator: Send + Sync {
    /// Whether `path` is somewhere access must be coordinated.
    fn covers(&self, path: &Path) -> bool;
    /// Waits until `access` to `path` is granted, and holds it in the lease.
    fn begin(&self, path: &Path, access: Access) -> std::io::Result<Box<dyn Lease>>;
}

static COORDINATOR: OnceLock<Box<dyn Coordinator>> = OnceLock::new();

/// The platform's coordinator, once, at launch.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub fn install(coordinator: Box<dyn Coordinator>) {
    let _ = COORDINATOR.set(coordinator);
}

/// Runs `op` on `path`, inside coordinated access when the platform's
/// coordinator covers the path, and as it is otherwise.
///
/// A coordinated access that gives back a different path than the one asked
/// for is refused for a replace: the vault's write lock, its journal and its
/// self-write tokens all name the original path, and a write that moved under
/// them would land where none of them looked. A listing or a read takes the
/// path given.
pub fn with<T>(
    path: &Path,
    access: Access,
    op: impl FnOnce(&Path) -> std::io::Result<T>,
) -> std::io::Result<T> {
    with_coordinator(COORDINATOR.get().map(|c| &**c), path, access, op)
}

fn with_coordinator<T>(
    coordinator: Option<&dyn Coordinator>,
    path: &Path,
    access: Access,
    op: impl FnOnce(&Path) -> std::io::Result<T>,
) -> std::io::Result<T> {
    let Some(coordinator) = coordinator.filter(|c| c.covers(path)) else {
        return op(path);
    };
    let lease = coordinator.begin(path, access)?;
    let given: PathBuf = lease.path().to_path_buf();
    if access == Access::Replace && !same_place(&given, path) {
        return Err(std::io::Error::other(
            "The file moved while it was being saved. Nothing was written.",
        ));
    }
    let result = op(&given);
    drop(lease);
    result
}

/// Whether the coordinator handed back the place it was asked for. On an iPad
/// Foundation names a file in iCloud Drive `/var/mobile/…` where the vault's
/// canonical root is `/private/var/mobile/…`: one file under two spellings,
/// which is no move. Only a file that really moved is refused.
fn same_place(given: &Path, asked: &Path) -> bool {
    if given == asked {
        return true;
    }
    let canonical = |p: &Path| -> Option<PathBuf> {
        Some(dunce::canonicalize(p.parent()?).ok()?.join(p.file_name()?))
    };
    match (canonical(given), canonical(asked)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    /// A coordinator that writes down what it was asked, and covers one folder.
    struct Recorder {
        root: PathBuf,
        log: Arc<Mutex<Vec<String>>>,
        moved_to: Option<PathBuf>,
    }

    struct Held {
        path: PathBuf,
        log: Arc<Mutex<Vec<String>>>,
    }

    impl Lease for Held {
        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for Held {
        fn drop(&mut self) {
            self.log.lock().unwrap().push("end".into());
        }
    }

    impl Coordinator for Recorder {
        fn covers(&self, path: &Path) -> bool {
            path.starts_with(&self.root)
        }
        fn begin(&self, path: &Path, access: Access) -> std::io::Result<Box<dyn Lease>> {
            self.log
                .lock()
                .unwrap()
                .push(format!("begin {} {}", access.as_str(), path.display()));
            Ok(Box::new(Held {
                path: self.moved_to.clone().unwrap_or_else(|| path.to_path_buf()),
                log: self.log.clone(),
            }))
        }
    }

    fn recorder(moved_to: Option<&str>) -> (Recorder, Arc<Mutex<Vec<String>>>) {
        let log = Arc::new(Mutex::new(Vec::new()));
        (
            Recorder {
                root: PathBuf::from("/cloud/Plays"),
                log: log.clone(),
                moved_to: moved_to.map(PathBuf::from),
            },
            log,
        )
    }

    #[test]
    fn a_covered_path_is_reached_only_inside_its_access() {
        let (c, log) = recorder(None);
        let seen = with_coordinator(
            Some(&c),
            Path::new("/cloud/Plays/Tide/Tide.proscenium"),
            Access::Read,
            |p| {
                log.lock().unwrap().push("read".into());
                Ok(p.to_path_buf())
            },
        )
        .unwrap();
        assert_eq!(seen, PathBuf::from("/cloud/Plays/Tide/Tide.proscenium"));
        assert_eq!(
            *log.lock().unwrap(),
            [
                "begin read /cloud/Plays/Tide/Tide.proscenium",
                "read",
                "end"
            ]
        );
    }

    #[test]
    fn a_path_on_the_device_itself_pays_nothing() {
        let (c, log) = recorder(None);
        with_coordinator(
            Some(&c),
            Path::new("/device/Documents/Plays"),
            Access::List,
            |_| Ok(()),
        )
        .unwrap();
        assert!(log.lock().unwrap().is_empty());
        // And with no coordinator at all, as on every desktop build.
        let ran = with_coordinator(None, Path::new("/cloud/Plays"), Access::List, |_| Ok(1));
        assert_eq!(ran.unwrap(), 1);
    }

    #[test]
    fn a_failed_operation_still_gives_the_access_back() {
        let (c, log) = recorder(None);
        let failed: std::io::Result<()> = with_coordinator(
            Some(&c),
            Path::new("/cloud/Plays/a.md"),
            Access::Replace,
            |_| Err(std::io::ErrorKind::PermissionDenied.into()),
        );
        assert!(failed.is_err());
        assert_eq!(log.lock().unwrap().last().unwrap(), "end");
    }

    /// A replace writes where its lock, its journal and its tokens point, or
    /// nowhere; a read follows the coordinator's path.
    #[test]
    fn a_replace_the_coordinator_moved_writes_nothing() {
        let (c, log) = recorder(Some("/cloud/Plays/elsewhere.md"));
        let wrote = std::cell::Cell::new(false);
        let refused = with_coordinator(
            Some(&c),
            Path::new("/cloud/Plays/a.md"),
            Access::Replace,
            |_| {
                wrote.set(true);
                Ok(())
            },
        );
        assert!(refused.is_err());
        assert!(!wrote.get());
        assert_eq!(log.lock().unwrap().last().unwrap(), "end");

        let read = with_coordinator(
            Some(&c),
            Path::new("/cloud/Plays/a.md"),
            Access::Read,
            |p| Ok(p.to_path_buf()),
        )
        .unwrap();
        assert_eq!(read, PathBuf::from("/cloud/Plays/elsewhere.md"));
    }

    /// An iPad's coordinator names a file `/var/mobile/…` where the vault asked
    /// for `/private/var/mobile/…`. The same file under another spelling is no
    /// move, so the save goes ahead; a file elsewhere is still refused.
    #[cfg(unix)]
    #[test]
    fn a_replace_handed_another_spelling_of_its_file_still_saves() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("Plays");
        std::fs::create_dir(&real).unwrap();
        std::fs::write(real.join("a.md"), "words").unwrap();
        let alias = dir.path().join("alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();

        let log = Arc::new(Mutex::new(Vec::new()));
        let c = Recorder {
            root: real.clone(),
            log,
            moved_to: Some(alias.join("a.md")),
        };
        let wrote = std::cell::Cell::new(false);
        with_coordinator(Some(&c), &real.join("a.md"), Access::Replace, |_| {
            wrote.set(true);
            Ok(())
        })
        .unwrap();
        assert!(wrote.get());

        assert!(same_place(&alias.join("a.md"), &real.join("a.md")));
        assert!(!same_place(&alias.join("b.md"), &real.join("a.md")));
    }
}
