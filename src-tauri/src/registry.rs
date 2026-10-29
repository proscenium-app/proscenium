// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! What Windows keeps in its registry and the app reads, never writes: its
//! version and build, the accent colour, whether apps are dark.

use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::System::Registry::{
    RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
};

/// Where a value is read from.
#[derive(Clone, Copy)]
pub enum Root {
    Machine,
    User,
}

impl Root {
    fn key(self) -> HKEY {
        match self {
            Root::Machine => HKEY_LOCAL_MACHINE,
            Root::User => HKEY_CURRENT_USER,
        }
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

/// A DWORD value, or None when it is not there.
pub fn dword(root: Root, key: &str, name: &str) -> Option<u32> {
    let (key, name) = (wide(key), wide(name));
    let (mut value, mut size) = (0u32, 4u32);
    // SAFETY: terminated strings, and a DWORD's buffer with its own size.
    let status = unsafe {
        RegGetValueW(
            root.key(),
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut value as *mut u32).cast(),
            &mut size,
        )
    };
    (status == ERROR_SUCCESS).then_some(value)
}

/// A string value, or None when it is not there or is longer than a short one.
pub fn string(root: Root, key: &str, name: &str) -> Option<String> {
    let (key, name) = (wide(key), wide(name));
    let mut buffer = [0u16; 256];
    let mut size = std::mem::size_of_val(&buffer) as u32;
    // SAFETY: terminated strings, and the buffer with its size in bytes.
    let status = unsafe {
        RegGetValueW(
            root.key(),
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    (status == ERROR_SUCCESS).then(|| {
        let units = (size as usize / 2).saturating_sub(1).min(buffer.len());
        String::from_utf16_lossy(&buffer[..units])
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every Windows the app runs on says what it is here.
    #[test]
    fn windows_says_its_version_and_build() {
        let at = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
        assert_eq!(
            dword(Root::Machine, at, "CurrentMajorVersionNumber"),
            Some(10)
        );
        let build = string(Root::Machine, at, "CurrentBuildNumber").expect("a build number");
        assert!(build.parse::<u32>().is_ok_and(|b| b >= 19045), "{build}");
        assert_eq!(dword(Root::Machine, at, "NoSuchValue"), None);
    }
}
