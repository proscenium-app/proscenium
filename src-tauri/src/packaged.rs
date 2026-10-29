// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The Microsoft Store's copy: what differs when the app runs from its MSIX
//! package.
//!
//! A packaged app's new files in AppData are redirected into the package's own
//! store, which Windows removes with the package. WebView2's processes are not
//! the app's, though, and run outside the package: what they write to the real
//! AppData stays there. Its data folder, which Tauri puts under
//! `%LOCALAPPDATA%\<identifier>`, outlived the package on every machine the
//! installed-artifact proof ran on. So a packaged copy names WebView2 a folder
//! in the package's own store, where the app's own redirected local data lands
//! too, and an ordinary install keeps Tauri's.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};
use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentPackageFamilyName;

/// The package family this process runs in, or `None` when it is not packaged.
pub fn family() -> Option<String> {
    let mut len: u32 = 0;
    // SAFETY: a null buffer with a length of 0 asks for the length alone.
    let status = unsafe { GetCurrentPackageFamilyName(&mut len, std::ptr::null_mut()) };
    // An ordinary install answers APPMODEL_ERROR_NO_PACKAGE.
    if status != ERROR_INSUFFICIENT_BUFFER || len == 0 {
        return None;
    }
    let mut name = vec![0u16; len as usize];
    // SAFETY: `name` holds the `len` UTF-16 units the first call asked for.
    let status = unsafe { GetCurrentPackageFamilyName(&mut len, name.as_mut_ptr()) };
    if status != 0 {
        return None;
    }
    let end = name.iter().position(|&c| c == 0).unwrap_or(name.len());
    Some(String::from_utf16_lossy(&name[..end]))
}

/// WebView2's data folder for a packaged copy: the package's own local store,
/// `%LOCALAPPDATA%\Packages\<family>\LocalCache\Local\<identifier>`. `None`
/// for an ordinary install, which keeps Tauri's.
pub fn webview_data<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let family = family()?;
    let local = app.path().local_data_dir().ok()?;
    Some(
        local
            .join("Packages")
            .join(family)
            .join("LocalCache")
            .join("Local")
            .join(&app.config().identifier),
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn a_process_started_outside_a_package_has_no_family() {
        assert_eq!(super::family(), None);
    }
}
