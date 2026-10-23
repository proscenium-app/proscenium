// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Handing something to the system to show: a folder in its file manager, a
//! file in the app the writer opens it with, an address in their browser, and
//! a file shown selected in its folder. On a Mac, NSWorkspace; on Windows, its
//! shell, and File Explorer for a file shown selected
//! (docs/engineering/cross-platform.md#PLAT-67).
//!
//! NSWorkspace rather than running `/usr/bin/open`: a sandboxed app's child
//! process inherits its sandbox, and the store build may start no helper to
//! do what the system's own API does (docs/engineering/release-engineering.md#REL-56).

use std::path::Path;

/// Open a folder, a file or an address as the system would on a double-click.
pub fn open(target: impl AsRef<std::ffi::OsStr>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        mac::open(target.as_ref())
    }
    #[cfg(windows)]
    {
        win::open(target.as_ref())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = target;
        Err("this platform has nothing to open it with".to_string())
    }
}

/// Show a file selected in its folder: Finder's Reveal, File Explorer's.
pub fn reveal(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        mac::reveal(path)
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `/select,"<path>"` exactly as written: Explorer reads its own
        // command line, and a path with a space is quoted after the comma.
        let mut arg = std::ffi::OsString::from("/select,\"");
        arg.push(path.as_os_str());
        arg.push("\"");
        std::process::Command::new("explorer.exe")
            .raw_arg(arg)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = path;
        Err("this platform has no file manager".to_string())
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::OsStr;
    use std::path::Path;

    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSArray, NSString, NSURL};

    /// What the target names: an address when it has a scheme (`https:`,
    /// `mailto:`), otherwise a file or folder on disk.
    fn url_of(target: &OsStr) -> Option<objc2::rc::Retained<NSURL>> {
        let text = target.to_str();
        match text {
            Some(t) if super::is_address(t) => NSURL::URLWithString(&NSString::from_str(t)),
            _ => NSURL::from_file_path(Path::new(target)),
        }
    }

    pub fn open(target: &OsStr) -> Result<(), String> {
        let url = url_of(target).ok_or("that cannot be opened")?;
        if NSWorkspace::sharedWorkspace().openURL(&url) {
            Ok(())
        } else {
            Err("macOS could not open it".to_string())
        }
    }

    pub fn reveal(path: &Path) -> Result<(), String> {
        let url = NSURL::from_file_path(path).ok_or("that file cannot be shown")?;
        NSWorkspace::sharedWorkspace()
            .activateFileViewerSelectingURLs(&NSArray::from_retained_slice(&[url]));
        Ok(())
    }
}

/// An address rather than a path: a scheme of letters before a colon, which
/// no absolute path has.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn is_address(target: &str) -> bool {
    target.split_once(':').is_some_and(|(scheme, _)| {
        scheme.len() > 1
            && scheme.starts_with(|c: char| c.is_ascii_alphabetic())
            && scheme
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
    })
}

#[cfg(test)]
mod tests {
    use super::is_address;

    #[test]
    fn an_address_has_a_scheme_and_a_path_does_not() {
        assert!(is_address("https://proscenium.ink/license"));
        assert!(is_address("mailto:someone@example.com"));
        assert!(!is_address("/Users/writer/Plays/The Tide"));
        assert!(!is_address("/Users/writer/Plays/Act: One"));
        // A drive letter is a path, not a one-letter scheme.
        assert!(!is_address("C:\\Plays"));
    }
}

#[cfg(windows)]
mod win {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    /// The shell's open, on a thread of its own with COM as the shell wants
    /// it: a handler it hands the file to may be a COM object.
    pub fn open(target: &OsStr) -> Result<(), String> {
        let target: Vec<u16> = target.encode_wide().chain(Some(0)).collect();
        std::thread::spawn(move || {
            let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
            // SAFETY: COM for this thread alone, undone below; terminated
            // strings; no window, parameters or directory.
            unsafe {
                let com = CoInitializeEx(
                    std::ptr::null(),
                    (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
                );
                let done = ShellExecuteW(
                    std::ptr::null_mut(),
                    verb.as_ptr(),
                    target.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    SW_SHOWNORMAL,
                );
                if com >= 0 {
                    CoUninitialize();
                }
                // More than 32 is success, as ShellExecute has always said it.
                if done as isize > 32 {
                    Ok(())
                } else {
                    Err(format!(
                        "Windows could not open it (shell error {})",
                        done as isize
                    ))
                }
            }
        })
        .join()
        .map_err(|_| "opening it stopped short".to_string())?
    }
}
