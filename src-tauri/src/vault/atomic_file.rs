// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Atomic filesystem primitives for guarded writes and recoverable moves.
//!
//! **Windows** keeps the same floor in its own terms
//! (docs/app/keeping-work/storage-and-file-format.md#STOR-D9):
//!
//! - an install is `MoveFileExW` with `MOVEFILE_WRITE_THROUGH`, which NTFS
//!   journals and has on disk when it returns, so a folder needs no sync of
//!   its own, and has none: [`sync_dir`] does nothing there;
//! - the exchange is `ReplaceFileW`, which keeps the displaced file at a side
//!   name, then a write-through move of it to the name the replacement left.
//!   Between the two the displaced file is at its side name, so recovery
//!   finishes an exchange interrupted there ([`finish_exchange`]);
//! - a lock is `LockFileEx` on the same app-data lock file;
//! - a temporary sibling is hidden until just before it is installed;
//! - a sharing violation from an indexer, an antivirus scanner or a sync
//!   client is waited out and tried again, for up to two seconds, never taken
//!   for a failed save.
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;

/// A folder's entries reach the disk. On Windows a folder has no sync: every
/// install there is a write-through rename, which is on disk when it returns.
pub fn sync_dir(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        File::open(path)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

/// A file's bytes reach the disk. Windows flushes only through a handle that
/// may write, so the file is opened for writing there, and nothing is written.
pub fn sync_file(path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        OpenOptions::new().write(true).open(path)?.sync_all()
    }
    #[cfg(not(windows))]
    {
        File::open(path)?.sync_all()
    }
}

pub fn create_dir_durable(path: &Path) -> io::Result<()> {
    if path.is_dir() {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("no journal parent"))?;
    create_dir_durable(parent)?;
    #[cfg_attr(not(unix), allow(unused_mut))]
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

/// A temporary sibling, made only where nothing has its name: a leftover, or
/// a link someone planted there, is never opened, and so never truncated. On
/// Windows it is marked hidden, as its leading dot hides it elsewhere.
pub fn create_temp(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.attributes(windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_HIDDEN);
    }
    options.open(path)
}

/// The hidden mark comes off a temporary sibling just before it is installed:
/// a rename keeps a file's attributes, and a play's files are never hidden.
/// Nothing to do where a leading dot is what hides a name.
pub fn unhide(file: &File) -> io::Result<()> {
    #[cfg(windows)]
    {
        win::unhide(file)
    }
    #[cfg(not(windows))]
    {
        let _ = file;
        Ok(())
    }
}

/// Install `from` at `to`, replacing what is there, in one rename.
pub fn replace(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        win::move_file(from, to, true)
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(from, to)
    }
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
    // Without MOVEFILE_REPLACE_EXISTING a name already taken is refused.
    #[cfg(windows)]
    {
        win::move_file(from, to, false)
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "linux",
        target_os = "android",
        windows
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
    #[cfg(windows)]
    {
        win::exchange(from, to)
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "linux",
        target_os = "android",
        windows
    )))]
    {
        let _ = (from, to);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "atomic exchange is unavailable",
        ))
    }
}

/// Where an exchange keeps the displaced file between its two steps, on
/// Windows: the temporary name with `x` before `.tmp`. A token is hex, so no
/// temporary name of a save ends that way, and the name is still a temporary
/// sibling's, which the watcher and the binder pass over.
#[cfg(any(windows, test))]
pub fn exchange_side(path: &Path) -> io::Result<std::path::PathBuf> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "no file name"))?;
    let side = match name.strip_suffix(".tmp") {
        Some(stem) => format!("{stem}x.tmp"),
        None => format!("{name}x"),
    };
    Ok(path.with_file_name(side))
}

/// Finish an exchange that stopped between its steps, so the journal finds
/// each file where it looks. One call on macOS and Linux, so nothing there can
/// stop between steps. On Windows the displaced file can be left at its side
/// name: put back where `to` was when the replace did not happen, or at
/// `from` when it did. Both names taken is never settled by a guess: it is an
/// error, the intent is kept, and the writer is asked to reopen.
pub fn finish_exchange(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        let side = exchange_side(from)?;
        let present = |path: &Path| match std::fs::symlink_metadata(path) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        };
        if !present(&side)? {
            return Ok(());
        }
        if !present(to)? {
            return rename_exclusive(&side, to);
        }
        if !present(from)? {
            return rename_exclusive(&side, from);
        }
        Err(io::Error::other(
            "An interrupted save left a file aside. Reopen the play to recover it.",
        ))
    }
    #[cfg(not(windows))]
    {
        let _ = (from, to);
        Ok(())
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
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            options.custom_flags(
                windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT,
            );
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
        #[cfg(windows)]
        {
            win::lock(&file, exclusive)?;
            Ok(Self { file })
        }
        #[cfg(not(any(unix, windows)))]
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
/// descriptor, close-on-exec ones too, until it execs. (A Windows lock belongs
/// to its handle, which no child inherits; it is unlocked here all the same.)
impl Drop for FileLock {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            // SAFETY: `file` owns this descriptor until after this call.
            unsafe { libc::flock(self.file.as_raw_fd(), libc::LOCK_UN) };
        }
        #[cfg(windows)]
        win::unlock(&self.file);
    }
}

#[cfg(windows)]
mod win {
    use std::fs::File;
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{
        ERROR_ACCESS_DENIED, ERROR_LOCK_VIOLATION, ERROR_SHARING_VIOLATION, HANDLE,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        FileBasicInfo, LockFileEx, MoveFileExW, ReplaceFileW, SetFileInformationByHandle,
        UnlockFileEx, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NORMAL, FILE_BASIC_INFO,
        LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY, MOVEFILE_REPLACE_EXISTING,
        MOVEFILE_WRITE_THROUGH, REPLACEFILE_IGNORE_ACL_ERRORS, REPLACEFILE_IGNORE_MERGE_ERRORS,
    };
    use windows_sys::Win32::System::IO::OVERLAPPED;

    /// How long a sharing violation is waited out before it is the answer.
    const PATIENCE: Duration = Duration::from_secs(2);

    /// A path as Win32 takes it: wide, terminated, and verbatim when it is an
    /// absolute drive path, so a name past MAX_PATH reaches its file, as std's
    /// own calls make sure it does.
    fn wide(path: &Path) -> io::Result<Vec<u16>> {
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        if wide.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a path contains a null character",
            ));
        }
        let drive = wide.len() >= 3
            && (wide[0] as u8).is_ascii_alphabetic()
            && wide[0] < 0x80
            && wide[1] == u16::from(b':')
            && wide[2] == u16::from(b'\\');
        if drive && !wide.contains(&u16::from(b'/')) {
            let mut verbatim: Vec<u16> = r"\\?\".encode_utf16().collect();
            verbatim.append(&mut wide);
            wide = verbatim;
        }
        wide.push(0);
        Ok(wide)
    }

    fn check(ok: i32) -> io::Result<()> {
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }

    /// Someone else has the file open for a moment: an indexer, an antivirus
    /// scanner, a sync client.
    fn transient(error: &io::Error) -> bool {
        [
            ERROR_SHARING_VIOLATION,
            ERROR_LOCK_VIOLATION,
            ERROR_ACCESS_DENIED,
        ]
        .iter()
        .any(|code| error.raw_os_error() == Some(*code as i32))
    }

    fn patiently(mut op: impl FnMut() -> io::Result<()>) -> io::Result<()> {
        let deadline = Instant::now() + PATIENCE;
        let mut wait = Duration::from_millis(10);
        loop {
            match op() {
                Err(error) if transient(&error) && Instant::now() < deadline => {
                    std::thread::sleep(wait);
                    wait = (wait * 2).min(Duration::from_millis(250));
                }
                done => return done,
            }
        }
    }

    pub fn move_file(from: &Path, to: &Path, replacing: bool) -> io::Result<()> {
        let (from, to) = (wide(from)?, wide(to)?);
        let flags = MOVEFILE_WRITE_THROUGH
            | if replacing {
                MOVEFILE_REPLACE_EXISTING
            } else {
                0
            };
        // SAFETY: both strings are terminated and live through the call.
        patiently(|| check(unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), flags) }))
    }

    /// `to` takes `from`'s file and `from` takes `to`'s. ReplaceFileW keeps
    /// the displaced file at the side name; a write-through move then gives it
    /// the name the replacement left. A failed replace has put everything back
    /// or left it for [`super::finish_exchange`], which the caller runs.
    pub fn exchange(from: &Path, to: &Path) -> io::Result<()> {
        let side = super::exchange_side(from)?;
        let (from_w, to_w, side_w) = (wide(from)?, wide(to)?, wide(&side)?);
        let flags = REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_IGNORE_ACL_ERRORS;
        // SAFETY: the strings are terminated and live through the call; the
        // two reserved pointers are null, as the API requires.
        patiently(|| {
            check(unsafe {
                ReplaceFileW(
                    to_w.as_ptr(),
                    from_w.as_ptr(),
                    side_w.as_ptr(),
                    flags,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            })
        })?;
        move_file(&side, from, false)?;
        // ReplaceFileW has no write-through of its own: flush the installed
        // file, as MOVEFILE_WRITE_THROUGH flushes a moved one.
        let mut installed = None;
        patiently(|| {
            installed = Some(std::fs::OpenOptions::new().write(true).open(to)?);
            Ok(())
        })?;
        installed.map_or(Ok(()), |file| file.sync_all())
    }

    pub fn unhide(file: &File) -> io::Result<()> {
        use std::os::windows::fs::MetadataExt;
        let attributes = file.metadata()?.file_attributes();
        if attributes & FILE_ATTRIBUTE_HIDDEN == 0 {
            return Ok(());
        }
        let rest = attributes & !FILE_ATTRIBUTE_HIDDEN;
        let info = FILE_BASIC_INFO {
            // Zero leaves a time as it is.
            CreationTime: 0,
            LastAccessTime: 0,
            LastWriteTime: 0,
            ChangeTime: 0,
            FileAttributes: if rest == 0 {
                FILE_ATTRIBUTE_NORMAL
            } else {
                rest
            },
        };
        // SAFETY: the handle is open for writing, and `info` is the struct
        // FileBasicInfo names, passed with its own size.
        check(unsafe {
            SetFileInformationByHandle(
                file.as_raw_handle() as HANDLE,
                FileBasicInfo,
                (&info as *const FILE_BASIC_INFO).cast(),
                std::mem::size_of::<FILE_BASIC_INFO>() as u32,
            )
        })
    }

    /// The whole range, so one lock covers the file however it grows.
    pub fn lock(file: &File, exclusive: bool) -> io::Result<()> {
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        let flags = LOCKFILE_FAIL_IMMEDIATELY
            | if exclusive {
                LOCKFILE_EXCLUSIVE_LOCK
            } else {
                0
            };
        // SAFETY: the handle lives as long as `file`; the OVERLAPPED is only
        // read for its offset, zero, during this synchronous call.
        let locked = check(unsafe {
            LockFileEx(
                file.as_raw_handle() as HANDLE,
                flags,
                0,
                u32::MAX,
                u32::MAX,
                &mut overlapped,
            )
        });
        locked.map_err(|error| {
            if error.raw_os_error() == Some(ERROR_LOCK_VIOLATION as i32) {
                io::Error::new(io::ErrorKind::WouldBlock, error)
            } else {
                error
            }
        })
    }

    pub fn unlock(file: &File) {
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        // SAFETY: as in `lock`; the range is the one locked.
        unsafe {
            UnlockFileEx(
                file.as_raw_handle() as HANDLE,
                0,
                u32::MAX,
                u32::MAX,
                &mut overlapped,
            )
        };
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

    /// The exchange keeps each file whole: the one that takes the name is the
    /// staged file itself, not a copy of its bytes, so its identity goes with it.
    #[test]
    fn an_exchanged_file_keeps_its_identity_and_leaves_nothing_aside() {
        let dir = tempfile::tempdir().unwrap();
        let temp = dir.path().join(".A.fountain.1a2b.tmp");
        let target = dir.path().join("A.fountain");
        std::fs::write(&temp, b"ours").unwrap();
        std::fs::write(&target, b"theirs").unwrap();
        let (staged, displaced) = (
            super::super::FileIdentity::read(&temp).unwrap(),
            super::super::FileIdentity::read(&target).unwrap(),
        );
        exchange(&temp, &target).unwrap();
        assert_eq!(super::super::FileIdentity::read(&target).unwrap(), staged);
        assert_eq!(super::super::FileIdentity::read(&temp).unwrap(), displaced);
        assert!(!exchange_side(&temp).unwrap().exists());
        let mut names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(names, [".A.fountain.1a2b.tmp", "A.fountain"]);
    }

    #[test]
    fn an_exchange_side_is_still_a_temporary_sibling() {
        let side = exchange_side(Path::new(".A.fountain.1a2b.tmp")).unwrap();
        assert_eq!(side, Path::new(".A.fountain.1a2bx.tmp"));
        assert!(super::super::is_temp_sibling(&side.to_string_lossy()));
    }

    /// The states an exchange can stop in between its steps, put back where
    /// the journal looks: `to` first when the replace never happened. Only
    /// Windows' exchange has steps.
    #[cfg(windows)]
    #[test]
    fn an_interrupted_exchange_is_finished_where_the_journal_looks() {
        let dir = tempfile::tempdir().unwrap();
        let temp = dir.path().join(".A.fountain.1a2b.tmp");
        let target = dir.path().join("A.fountain");
        let side = exchange_side(&temp).unwrap();

        // Nothing aside: nothing to do.
        finish_exchange(&temp, &target).unwrap();

        // The target moved aside, the replacement never took its name.
        std::fs::write(&temp, b"ours").unwrap();
        std::fs::write(&side, b"theirs").unwrap();
        finish_exchange(&temp, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"theirs");
        assert_eq!(std::fs::read(&temp).unwrap(), b"ours");

        // The replacement took the name; the displaced file is still aside.
        std::fs::rename(&temp, dir.path().join("moved")).unwrap();
        std::fs::rename(&target, &side).unwrap();
        std::fs::rename(dir.path().join("moved"), &target).unwrap();
        finish_exchange(&temp, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"ours");
        assert_eq!(std::fs::read(&temp).unwrap(), b"theirs");

        // Every name taken is never settled by a guess.
        std::fs::write(&side, b"a third").unwrap();
        assert!(finish_exchange(&temp, &target).is_err());
        assert_eq!(std::fs::read(&side).unwrap(), b"a third");
    }

    /// A hidden temporary file installs as a file Explorer shows.
    #[test]
    fn a_temporary_file_is_hidden_until_it_is_installed() {
        let dir = tempfile::tempdir().unwrap();
        let temp = dir.path().join(".A.fountain.1a2b.tmp");
        let target = dir.path().join("A.fountain");
        let mut file = create_temp(&temp).unwrap();
        assert!(
            create_temp(&temp).is_err(),
            "a taken name is never reopened"
        );
        file.write_all(b"words").unwrap();
        #[cfg(windows)]
        let hidden = |path: &Path| {
            use std::os::windows::fs::MetadataExt;
            std::fs::metadata(path).unwrap().file_attributes()
                & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_HIDDEN
                != 0
        };
        #[cfg(windows)]
        assert!(hidden(&temp));
        unhide(&file).unwrap();
        file.sync_all().unwrap();
        drop(file);
        replace(&temp, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"words");
        #[cfg(windows)]
        assert!(!hidden(&target));
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
        assert!(matches!(FileLock::try_at(&lock), Err(e) if e.kind() == io::ErrorKind::WouldBlock));
        drop(owner);
        assert!(FileLock::try_at(&lock).is_ok());
    }

    #[test]
    fn shared_locks_share_and_exclude_an_exclusive_one() {
        let dir = tempfile::tempdir().unwrap();
        let lock = dir.path().join("lock");
        let first = FileLock::try_shared_at(&lock).unwrap();
        let second = FileLock::try_shared_at(&lock).unwrap();
        assert!(matches!(FileLock::try_at(&lock), Err(e) if e.kind() == io::ErrorKind::WouldBlock));
        drop((first, second));
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
