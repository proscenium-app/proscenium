// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! File identity survives a rename but changes when another object takes its path.
//!
//! On Windows it is the volume's serial number and the file's id in it, as
//! NTFS keeps them (`FILE_ID_INFO`). An NTFS id fits 64 bits; ReFS's 128-bit
//! ids are folded into them.
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FileIdentity {
    device: u64,
    inode: u64,
}

impl FileIdentity {
    pub fn read(path: &Path) -> std::io::Result<Self> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            let meta = std::fs::symlink_metadata(path)?;
            Ok(Self {
                device: meta.dev(),
                inode: meta.ino(),
            })
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::Storage::FileSystem::{
                FileIdInfo, GetFileInformationByHandleEx, FILE_FLAG_BACKUP_SEMANTICS,
                FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO, FILE_READ_ATTRIBUTES,
                FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
            };
            // The link itself, never what it names, as `symlink_metadata`
            // reads it elsewhere; a folder opens only with backup semantics.
            let file = std::fs::OpenOptions::new()
                .access_mode(FILE_READ_ATTRIBUTES)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(path)?;
            let mut info: FILE_ID_INFO = unsafe { std::mem::zeroed() };
            // SAFETY: `info` is the struct FileIdInfo names, passed with its
            // own size, and the handle lives through the call.
            let ok = unsafe {
                GetFileInformationByHandleEx(
                    file.as_raw_handle() as _,
                    FileIdInfo,
                    (&mut info as *mut FILE_ID_INFO).cast(),
                    std::mem::size_of::<FILE_ID_INFO>() as u32,
                )
            };
            if ok == 0 {
                return Err(std::io::Error::last_os_error());
            }
            let id = info.FileId.Identifier;
            let half = |range: std::ops::Range<usize>| {
                let mut bytes = [0u8; 8];
                bytes.copy_from_slice(&id[range]);
                u64::from_le_bytes(bytes)
            };
            Ok(Self {
                device: info.VolumeSerialNumber,
                inode: half(0..8) ^ half(8..16),
            })
        }
        #[cfg(not(any(unix, windows)))]
        {
            let _ = path;
            Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "file identity unavailable on this host",
            ))
        }
    }

    pub fn key(&self) -> String {
        format!("{:x}-{:x}", self.device, self.inode)
    }
}

#[cfg(test)]
mod tests {
    use super::FileIdentity;

    #[test]
    fn identity_follows_a_file_through_a_rename_and_not_its_name() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        std::fs::write(&a, b"one").unwrap();
        let first = FileIdentity::read(&a).unwrap();
        assert_eq!(FileIdentity::read(&a).unwrap(), first);
        std::fs::rename(&a, &b).unwrap();
        assert_eq!(FileIdentity::read(&b).unwrap(), first);
        std::fs::write(&a, b"another file at the old name").unwrap();
        assert_ne!(FileIdentity::read(&a).unwrap(), first);
        // A folder has one too: the vault holds its root to it.
        let folder = FileIdentity::read(dir.path()).unwrap();
        assert_ne!(folder, first);
        assert_eq!(FileIdentity::read(dir.path()).unwrap(), folder);
    }
}
