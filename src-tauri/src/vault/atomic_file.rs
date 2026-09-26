// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Atomic filesystem primitives for guarded writes and recoverable moves.
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

pub fn sync_dir(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

pub fn create_dir_durable(path: &Path) -> io::Result<()> {
    if path.is_dir() {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("no journal parent"))?;
    create_dir_durable(parent)?;
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => sync_dir(parent),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists && path.is_dir() => Ok(()),
        Err(error) => Err(error),
    }
}

pub fn sync_parents(from: &Path, to: &Path) -> io::Result<()> {
    if let Some(parent) = from.parent() {
        sync_dir(parent)?;
    }
    if to.parent() != from.parent() {
        if let Some(parent) = to.parent() {
            sync_dir(parent)?;
        }
    }
    Ok(())
}

/// Install an immutable journal record. No existence query authorises replacement.
pub fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("no journal directory"))?;
    create_dir_durable(parent)?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        sync_dir(parent)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(path);
    }
    result
}

#[cfg(unix)]
fn c_path(path: &Path) -> io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "a path contains a null byte"))
}

/// A destination that appeared after name selection is never overwritten.
pub fn rename_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let (from, to) = (c_path(from)?, c_path(to)?);
        // SAFETY: both C strings remain alive throughout the filesystem call.
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let (from, to) = (c_path(from)?, c_path(to)?);
        // SAFETY: valid C paths, no borrowed file descriptors.
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "linux",
        target_os = "android"
    )))]
    {
        let _ = (from, to);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "exclusive relocation is unavailable",
        ))
    }
}

/// Keep the displaced inode at the temporary name until its bytes are validated.
pub fn exchange(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let (from, to) = (c_path(from)?, c_path(to)?);
        // SAFETY: both C strings remain alive throughout the filesystem call.
        let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_SWAP) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let (from, to) = (c_path(from)?, c_path(to)?);
        // SAFETY: valid C paths, no borrowed file descriptors.
        let result = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_EXCHANGE,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "linux",
        target_os = "android"
    )))]
    {
        let _ = (from, to);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "atomic exchange is unavailable",
        ))
    }
}

/// A stable app-data lock file is never unlinked: all processes lock one inode.
pub struct FileLock {
    file: File,
}

impl FileLock {
    pub fn try_at(path: &Path) -> io::Result<Self> {
        Self::try_mode(path, true)
    }

    pub fn try_shared_at(path: &Path) -> io::Result<Self> {
        Self::try_mode(path, false)
    }

    fn try_mode(path: &Path, exclusive: bool) -> io::Result<Self> {
        if let Some(parent) = path.parent() {
            create_dir_durable(parent)?;
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }
        let file = options.open(path)?;
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            // SAFETY: this file owns its descriptor for the entire lock lifetime.
            let mode = if exclusive {
                libc::LOCK_EX
            } else {
                libc::LOCK_SH
            };
            if unsafe { libc::flock(file.as_raw_fd(), mode | libc::LOCK_NB) } != 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Self { file })
        }
        #[cfg(not(unix))]
        {
            let _ = (file, exclusive);
            Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "interprocess file locking is unavailable",
            ))
        }
    }
}

/// Unlocked here, not by the close that follows: a `flock` belongs to the open
/// file description, and a process spawned on any thread holds a copy of every
/// descriptor, close-on-exec ones too, until it execs.
impl Drop for FileLock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            // SAFETY: `file` owns this descriptor until after this call.
            unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_UN) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exchange_keeps_the_displaced_file_and_new_install_is_exclusive() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        std::fs::write(&a, b"LOCAL").unwrap();
        std::fs::write(&b, b"EXTERNAL").unwrap();
        assert!(rename_exclusive(&a, &b).is_err());
        assert_eq!(std::fs::read(&b).unwrap(), b"EXTERNAL");
        exchange(&a, &b).unwrap();
        assert_eq!(std::fs::read(&a).unwrap(), b"EXTERNAL");
        assert_eq!(std::fs::read(&b).unwrap(), b"LOCAL");
        sync_parents(&a, &b).unwrap();
    }

    #[test]
    fn the_journal_and_its_lock_cannot_be_replaced_by_another_owner() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("operation.json");
        write_new(&path, b"first intent").unwrap();
        assert!(write_new(&path, b"second intent").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"first intent");
        let lock = dir.path().join("lock");
        let owner = FileLock::try_at(&lock).unwrap();
        assert!(FileLock::try_at(&lock).is_err());
        drop(owner);
        assert!(FileLock::try_at(&lock).is_ok());
    }

    /// A process spawned on any thread holds a copy of every descriptor until
    /// it execs; `try_clone` is that copy. Seen as a flaky `cargo test`: a
    /// write's released guard refused the rename after it (WouldBlock).
    #[test]
    fn a_released_lock_is_free_while_a_spawned_process_still_holds_its_descriptor() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join("lock");
        let guard = FileLock::try_shared_at(&lock).unwrap();
        let _inherited = guard.file.try_clone().unwrap();
        drop(guard);
        let owner = FileLock::try_at(&lock).unwrap();
        let _inherited_too = owner.file.try_clone().unwrap();
        drop(owner);
        assert!(FileLock::try_at(&lock).is_ok());
    }
}
