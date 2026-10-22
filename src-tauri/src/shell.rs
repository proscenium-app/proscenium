// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Handing something to the system to show: a folder in its file manager, a
//! file in the app the writer opens it with, an address in their browser, and
//! a file shown selected in its folder. On a Mac, `open`; on Windows, its
//! shell, and File Explorer for a file shown selected
//! (docs/engineering/cross-platform.md#PLAT-67).

use std::path::Path;

/// Open a folder, a file or an address as the system would on a double-click.
pub fn open(target: impl AsRef<std::ffi::OsStr>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
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
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
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
