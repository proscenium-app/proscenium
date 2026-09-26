// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! File identity survives a rename but changes when another object takes its path.
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
        #[cfg(not(unix))]
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
