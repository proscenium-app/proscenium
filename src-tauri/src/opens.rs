// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Files opened from Finder (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
//!
//! Double-clicking a play, a script or an `.fdx` sends the app
//! `RunEvent::Opened`. A double-click that LAUNCHES the app delivers that event
//! before the webview has loaded, so nothing is listening yet: the paths are
//! queued here, and the frontend drains the queue when it is ready — and again
//! whenever the `app://opened` signal says more arrived while it was running.
//! The signal carries no paths, so a path can never be handled twice (once
//! from the event, once from the queue) or dropped between the two.
//!
//! Rust stores bytes, TypeScript assigns meaning: this module does not decide
//! what an opened file IS. It reports what is on disk around it (`facts`) and
//! reads it on request; `src/workspace/open-route.ts` classifies.
//!
//! **Only paths that arrived by an open event can be read here.** The webview
//! otherwise reaches nothing outside the open vault, and a command that read
//! any path it was handed would undo that. Under the App Sandbox the open event
//! is also what grants access to the file, so the same list is the honest
//! answer to "may this be read?" there too.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

/// The frontend's cue that `take` has something for it. No payload by design.
pub const EVENT_OPENED: &str = "app://opened";

#[derive(Default)]
pub struct PendingOpens {
    queue: Mutex<Vec<PathBuf>>,
    granted: Mutex<HashSet<PathBuf>>,
}

impl PendingOpens {
    /// Queue paths from an open event, and remember them as readable.
    pub fn push(&self, paths: Vec<PathBuf>) {
        let mut granted = self.granted.lock().unwrap_or_else(|p| p.into_inner());
        let mut queue = self.queue.lock().unwrap_or_else(|p| p.into_inner());
        for path in paths {
            granted.insert(path.clone());
            if !queue.contains(&path) {
                queue.push(path);
            }
        }
    }

    /// Everything queued since the last take, in the order it arrived.
    pub fn take(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.queue.lock().unwrap_or_else(|p| p.into_inner()))
    }

    pub fn is_granted(&self, path: &Path) -> bool {
        self.granted
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .contains(path)
    }

    /// `dir` holds (or is) a path that was opened from Finder — a folder the
    /// app may ask about, because the writer's own open named something in it.
    pub fn is_around_granted(&self, dir: &Path) -> bool {
        let dir = dunce::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        self.granted
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .iter()
            .any(|path| {
                path.starts_with(&dir)
                    || dunce::canonicalize(path).is_ok_and(|canonical| canonical.starts_with(&dir))
            })
    }
}

/// The filesystem paths among an open event's URLs. Anything that is not a
/// `file:` URL (a custom scheme, a malformed URL) is not ours to open.
#[cfg(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "android",
    all(test, unix)
))]
pub fn paths_from_urls(urls: &[tauri::Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|u| u.scheme() == "file")
        .filter_map(|u| u.to_file_path().ok())
        .collect()
}

/// One directory above (or at) an opened path that directly holds play files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayDir {
    pub dir: String,
    pub play_files: Vec<String>,
}

/// What is on disk around an opened path, for the frontend to classify.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFacts {
    /// Absolute and canonical where the filesystem allows, so it compares with
    /// the vault root (which the vault canonicalizes too).
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
    /// Every directory from the path's own (the path itself, for a directory)
    /// up to the first folder that can never be a play (`never_a_play`) that
    /// directly holds a `.proscenium` file, nearest first. A directory the
    /// sandbox will not list is still found by its own name's play file.
    pub play_dirs: Vec<PlayDir>,
}

/// How far up to look. A play is a folder or two above its scripts; nothing
/// real is thirty-two levels deep, and a bound keeps a pathological mount from
/// turning an open into a crawl.
const MAX_ANCESTORS: usize = 32;

/// The same rule discovery uses (play-file.ts `isPlayFileName`): the extension
/// exactly, and never a hidden file, so a file Finder calls a play is one the
/// Plays screen lists.
fn is_play_file_name(name: &str) -> bool {
    !name.starts_with('.')
        && Path::new(name)
            .extension()
            .is_some_and(|ext| ext == "proscenium")
}

/// The play files directly in `dir`, or `None` when it cannot be listed.
fn play_files_in(dir: &Path) -> Option<Vec<String>> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|name| is_play_file_name(name))
        .collect();
    names.sort();
    Some(names)
}

/// The play file a folder keeps under its own name (docs/app/keeping-work/storage-and-file-format.md#STOR-D4), if it has one.
///
/// For a folder that cannot be listed. The App Sandbox refuses to list a folder
/// the writer has not granted, but lets any path be looked up — its profile
/// allows `file-read-metadata` everywhere — so a play outside the Plays folder
/// is still recognised by the one name it is expected to have.
fn named_play_file(dir: &Path) -> Vec<String> {
    let Some(name) = dir.file_name().map(|n| n.to_string_lossy().to_string()) else {
        return Vec::new();
    };
    let file = format!("{name}.proscenium");
    if is_play_file_name(&file) && dir.join(&file).is_file() {
        vec![file]
    } else {
        Vec::new()
    }
}

/// A folder that is never a play, and above which no play can be: the
/// filesystem's own top levels, a volume's root, the home folder and what is
/// above it, and the folders a Mac keeps for everything — Desktop, Documents,
/// Downloads, iCloud Drive, and each cloud provider's root.
///
/// Without this bound a single stray `.proscenium` file in Documents made every
/// loose script anywhere below it "a script in the play called Documents", and
/// opening one asked to make the home folder the Plays folder.
pub fn never_a_play(dir: &Path, home: &Path) -> bool {
    // "/", "/Users", "/Volumes", "/private" …
    if dir.components().count() <= 2 {
        return true;
    }
    if dir.parent() == Some(Path::new("/Volumes")) {
        return true;
    }
    if home.as_os_str().is_empty() {
        return false;
    }
    if home.starts_with(dir) {
        return true;
    }
    let Ok(rel) = dir.strip_prefix(home) else {
        return false;
    };
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
    matches!(
        parts.as_slice(),
        ["Desktop"]
            | ["Documents"]
            | ["Downloads"]
            | ["Library"]
            | ["Library", "Mobile Documents"]
            | ["Library", "Mobile Documents", "com~apple~CloudDocs"]
            // Desktop & Documents Folders, kept in iCloud Drive.
            | ["Library", "Mobile Documents", "com~apple~CloudDocs", "Desktop"]
            | ["Library", "Mobile Documents", "com~apple~CloudDocs", "Documents"]
            | ["Library", "CloudStorage"]
            | ["Library", "CloudStorage", _]
    )
}

/// Every folder from `start` up to the first that can never be a play that
/// directly holds a play file, nearest first.
pub fn play_dirs_from(start: Option<&Path>, home: &Path) -> Vec<PlayDir> {
    let mut play_dirs = Vec::new();
    let mut dir = start;
    for _ in 0..MAX_ANCESTORS {
        let Some(d) = dir else { break };
        if never_a_play(d, home) {
            break;
        }
        let files = play_files_in(d).unwrap_or_else(|| named_play_file(d));
        if !files.is_empty() {
            play_dirs.push(PlayDir {
                dir: d.to_string_lossy().to_string(),
                play_files: files,
            });
        }
        dir = d.parent();
    }
    play_dirs
}

/// Gather the facts about one opened path. `home` is the writer's real home
/// folder, which bounds how far up a play is looked for.
pub fn facts(path: &Path, home: &Path) -> OpenedFacts {
    let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let exists = canonical.exists();
    let is_dir = canonical.is_dir();
    let mut play_dirs = play_dirs_from(
        if is_dir {
            Some(canonical.as_path())
        } else {
            canonical.parent()
        },
        home,
    );

    // The opened file is itself a play file, so its folder holds one whether or
    // not that folder can be listed — and under whatever name the file has now.
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string());
    if let (true, false, Some(name), Some(parent)) = (exists, is_dir, name, canonical.parent()) {
        if is_play_file_name(&name) && !never_a_play(parent, home) {
            let parent_dir = parent.to_string_lossy().to_string();
            match play_dirs.first_mut() {
                Some(nearest) if nearest.dir == parent_dir => {
                    if !nearest.play_files.contains(&name) {
                        nearest.play_files.push(name);
                        nearest.play_files.sort();
                    }
                }
                _ => play_dirs.insert(
                    0,
                    PlayDir {
                        dir: parent_dir,
                        play_files: vec![name],
                    },
                ),
            }
        }
    }

    OpenedFacts {
        path: canonical.to_string_lossy().to_string(),
        exists,
        is_dir,
        play_dirs,
    }
}

/// What a launch was asked to open, on Windows: File Explorer starts the app
/// with each file it opens as an argument, `"%1"` in the installers'
/// registration. Only absolute paths: the app is given no other arguments.
#[cfg(any(windows, test))]
pub fn launch_paths(args: impl IntoIterator<Item = std::ffi::OsString>) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .collect()
}

/// A file opened from File Explorer while Proscenium is running reaches the
/// copy already running (docs/app/keeping-work/storage-and-file-format.md#STOR-D5):
/// Windows starts a second process for it, which hands its paths over and
/// ends, as macOS sends the running app an open event.
///
/// The first copy holds a named mutex for as long as it runs and listens on a
/// message-only window; a second finds that window and sends it the paths in
/// one `WM_COPYDATA`, then exits before it has made anything. Both names carry
/// the app's identifier, so a self-test build never hands a file to a
/// writer's copy, and the mutex is per session (`Local\`), as the window is.
#[cfg(windows)]
pub mod handoff {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::PathBuf;
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    use tauri::{AppHandle, Emitter, Manager};
    use windows_sys::Win32::Foundation::{
        GetLastError, ERROR_ALREADY_EXISTS, HWND, LPARAM, LRESULT, WPARAM,
    };
    use windows_sys::Win32::System::DataExchange::COPYDATASTRUCT;
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, CreateWindowExW, DefWindowProcW, FindWindowExW,
        GetWindowThreadProcessId, RegisterClassW, SendMessageTimeoutW, HWND_MESSAGE,
        SMTO_ABORTIFHUNG, WM_COPYDATA, WNDCLASSW,
    };

    use super::PendingOpens;

    /// `dwData` of a hand-off: "PROS", so no other sender's data is read as paths.
    const KIND: usize = 0x5052_4F53;

    /// How long a second copy waits for the first one's window: the first may
    /// still be starting.
    const WAIT: Duration = Duration::from_secs(5);

    static APP: OnceLock<AppHandle> = OnceLock::new();

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(Some(0)).collect()
    }

    fn class(identifier: &str) -> Vec<u16> {
        wide(&format!("{identifier}.opens"))
    }

    /// The paths as UTF-16, each ended by a null.
    fn encode(paths: &[PathBuf]) -> Vec<u16> {
        paths
            .iter()
            .flat_map(|path| path.as_os_str().encode_wide().chain(Some(0)))
            .collect()
    }

    pub(super) fn decode(units: &[u16]) -> Vec<PathBuf> {
        units
            .split(|unit| *unit == 0)
            .filter(|path| !path.is_empty())
            .map(|path| PathBuf::from(OsString::from_wide(path)))
            .collect()
    }

    /// Run first, before anything else is made. True when a copy is already
    /// running and has taken `paths`: this process then has nothing to do.
    pub fn to_running(identifier: &str, paths: &[PathBuf]) -> bool {
        let name = wide(&format!("Local\\{identifier}.running"));
        // SAFETY: a terminated name; the handle is kept for the process's
        // whole life, which is what holding the mutex means.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        let running = !handle.is_null() && unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        if !running {
            return false;
        }
        let class = class(identifier);
        let deadline = Instant::now() + WAIT;
        let window = loop {
            // SAFETY: a terminated class name; a message-only window is found
            // only under HWND_MESSAGE.
            let window = unsafe {
                FindWindowExW(
                    HWND_MESSAGE,
                    std::ptr::null_mut(),
                    class.as_ptr(),
                    std::ptr::null(),
                )
            };
            if !window.is_null() || Instant::now() >= deadline {
                break window;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        // A copy that never made its window: run beside it rather than drop the open.
        if window.is_null() {
            return false;
        }
        let units = encode(paths);
        let data = COPYDATASTRUCT {
            dwData: KIND,
            cbData: (units.len() * 2) as u32,
            lpData: units.as_ptr() as *mut _,
        };
        let mut process = 0u32;
        let mut answer = 0usize;
        // SAFETY: `data` and `units` outlive the synchronous send; the running
        // copy may bring its window forward, which only this process may allow.
        unsafe {
            GetWindowThreadProcessId(window, &mut process);
            AllowSetForegroundWindow(process);
            SendMessageTimeoutW(
                window,
                WM_COPYDATA,
                0,
                &data as *const COPYDATASTRUCT as LPARAM,
                SMTO_ABORTIFHUNG,
                5_000,
                &mut answer,
            ) != 0
                && answer == 1
        }
    }

    /// The running copy's side: its window, made on the main thread, whose
    /// loop is the app's.
    pub fn listen(app: &AppHandle, identifier: &str) -> Result<(), String> {
        let _ = APP.set(app.clone());
        let class = class(identifier);
        // SAFETY: the class name lives in a leaked buffer, as a registered
        // class's name must for as long as the class exists; the procedure
        // is a plain function.
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class: &'static [u16] = Box::leak(class.into_boxed_slice());
            let mut description: WNDCLASSW = std::mem::zeroed();
            description.lpfnWndProc = Some(receive);
            description.hInstance = instance;
            description.lpszClassName = class.as_ptr();
            if RegisterClassW(&description) == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            let window = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if window.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        Ok(())
    }

    unsafe extern "system" fn receive(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if message != WM_COPYDATA || lparam == 0 {
            return DefWindowProcW(window, message, wparam, lparam);
        }
        // SAFETY: for WM_COPYDATA, lParam is the sender's COPYDATASTRUCT,
        // valid until this returns; its data is `cbData` bytes of UTF-16.
        let data = &*(lparam as *const COPYDATASTRUCT);
        if data.dwData != KIND || (data.cbData > 0 && data.lpData.is_null()) {
            return 0;
        }
        let units = if data.cbData == 0 {
            &[][..]
        } else {
            std::slice::from_raw_parts(data.lpData as *const u16, data.cbData as usize / 2)
        };
        let paths = decode(units);
        let Some(app) = APP.get() else { return 0 };
        if !paths.is_empty() {
            app.state::<PendingOpens>().push(paths);
        }
        // Said and shown once the loop that called this is free again.
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let _ = handle.emit(super::EVENT_OPENED, ());
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        });
        1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// File Explorer's arguments are the files it opens; the program's own
    /// name and anything that is not an absolute path are not.
    #[test]
    fn a_launch_opens_the_absolute_paths_it_was_given() {
        let tmp = tempfile::tempdir().unwrap();
        let play = tmp.path().join("Lear").join("Lear.proscenium");
        let args = [
            std::ffi::OsString::from("proscenium.exe"),
            play.clone().into_os_string(),
            std::ffi::OsString::from("relative.fountain"),
        ];
        assert_eq!(launch_paths(args), vec![play]);
        assert!(launch_paths([std::ffi::OsString::from("proscenium.exe")]).is_empty());
    }

    /// What one copy sends another is every path, whole, in order.
    #[cfg(windows)]
    #[test]
    fn a_handed_off_open_arrives_whole() {
        use std::os::windows::ffi::OsStrExt;
        let paths = [
            PathBuf::from(r"C:\Users\writer\Documents\Plays\Lear\Lear.proscenium"),
            PathBuf::from(r"C:\Users\writer\Desktop\Café — draft.fountain"),
        ];
        let units: Vec<u16> = paths
            .iter()
            .flat_map(|p| p.as_os_str().encode_wide().chain(Some(0)))
            .collect();
        assert_eq!(handoff::decode(&units), paths);
        assert!(handoff::decode(&[]).is_empty());
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    /// No home folder anywhere near a temp directory.
    const NO_HOME: &str = "/nonexistent-home";

    /// A folder as the App Sandbox shows one the writer has not granted: it
    /// cannot be listed, but a path inside it can still be looked up. Restores
    /// the permissions on drop so the temp directory can be cleaned up.
    #[cfg(unix)]
    struct Unlisted(PathBuf);
    #[cfg(unix)]
    impl Unlisted {
        fn new(dir: &Path) -> Self {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o111)).unwrap();
            Unlisted(dir.to_path_buf())
        }
    }
    #[cfg(unix)]
    impl Drop for Unlisted {
        fn drop(&mut self) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(0o755));
        }
    }

    #[test]
    fn a_launch_open_waits_in_the_queue_and_is_handed_over_once() {
        let pending = PendingOpens::default();
        let a = PathBuf::from("/tmp/A/A.proscenium");
        let b = PathBuf::from("/tmp/B.fountain");
        pending.push(vec![a.clone(), b.clone()]);
        // Delivered twice (Finder retrying), queued once.
        pending.push(vec![a.clone()]);
        assert_eq!(pending.take(), vec![a.clone(), b.clone()]);
        assert!(
            pending.take().is_empty(),
            "a second take hands nothing over again"
        );
        // …but both stay readable for as long as the app runs.
        assert!(pending.is_granted(&a) && pending.is_granted(&b));
        assert!(!pending.is_granted(Path::new("/etc/passwd")));
        // The folders around an opened file may be asked about; others may not.
        assert!(pending.is_around_granted(Path::new("/tmp/A")));
        assert!(pending.is_around_granted(Path::new("/tmp/A/A.proscenium")));
        assert!(!pending.is_around_granted(Path::new("/tmp/C")));
    }

    /// A Mac's open event; Windows hands a launch its paths as arguments.
    #[cfg(unix)]
    #[test]
    fn only_file_urls_become_paths() {
        let urls = vec![
            tauri::Url::parse("file:///Users/w/Plays/The%20Tide/The%20Tide.proscenium").unwrap(),
            tauri::Url::parse("proscenium://open?x=1").unwrap(),
            tauri::Url::parse("https://example.com/a.fountain").unwrap(),
        ];
        assert_eq!(
            paths_from_urls(&urls),
            vec![PathBuf::from("/Users/w/Plays/The Tide/The Tide.proscenium")]
        );
    }

    #[test]
    fn facts_find_the_play_a_script_belongs_to_nearest_first() {
        let tmp = tempfile::tempdir().unwrap();
        let plays = dunce::canonicalize(tmp.path()).unwrap().join("Plays");
        let play = plays.join("The Tide");
        touch(&play.join("The Tide.proscenium"));
        let script = play.join("Scenes").join("Draft two.fountain");
        touch(&script);

        let f = facts(&script, Path::new(NO_HOME));
        assert!(f.exists && !f.is_dir);
        assert_eq!(f.path, script.to_string_lossy());
        assert_eq!(
            f.play_dirs,
            vec![PlayDir {
                dir: play.to_string_lossy().to_string(),
                play_files: vec!["The Tide.proscenium".into()],
            }]
        );
    }

    #[test]
    fn facts_for_a_play_folder_start_at_the_folder_itself() {
        let tmp = tempfile::tempdir().unwrap();
        let play = dunce::canonicalize(tmp.path()).unwrap().join("Lear");
        touch(&play.join("Lear.proscenium"));
        // A temp file mid-write and a hidden file are never play files.
        touch(&play.join(".Lear.proscenium.1a2b.tmp"));
        touch(&play.join(".hidden.proscenium"));
        let f = facts(&play, Path::new(NO_HOME));
        assert!(f.is_dir);
        assert_eq!(f.play_dirs[0].dir, play.to_string_lossy());
        assert_eq!(
            f.play_dirs[0].play_files,
            vec!["Lear.proscenium".to_string()]
        );
    }

    #[test]
    fn facts_for_a_loose_file_have_no_play_and_a_missing_file_says_so() {
        let tmp = tempfile::tempdir().unwrap();
        let loose = dunce::canonicalize(tmp.path())
            .unwrap()
            .join("Downloads/Hamlet.fdx");
        touch(&loose);
        let f = facts(&loose, Path::new(NO_HOME));
        assert!(f.exists);
        assert!(
            f.play_dirs.is_empty(),
            "no play above a loose file: {:?}",
            f.play_dirs
        );

        let gone = facts(&tmp.path().join("gone.fountain"), Path::new(NO_HOME));
        assert!(!gone.exists);
    }

    #[cfg(unix)]
    #[test]
    fn a_play_that_cannot_be_listed_is_found_by_its_own_name() {
        // A script in a play outside the Plays folder, opened under the App
        // Sandbox: the open grants the file, not the folders around it. Listing
        // used to fail silently, the script looked loose, and "make a play from
        // it" copied it into a second play.
        let tmp = tempfile::tempdir().unwrap();
        let play = dunce::canonicalize(tmp.path())
            .unwrap()
            .join("Elsewhere/Lear");
        touch(&play.join("Lear.proscenium"));
        let script = play.join("Lear.fountain");
        touch(&script);
        let _unlisted = Unlisted::new(&play);
        assert!(
            std::fs::read_dir(&play).is_err(),
            "the test folder should refuse a listing"
        );

        let f = facts(&script, Path::new(NO_HOME));
        assert_eq!(f.play_dirs.len(), 1, "{:?}", f.play_dirs);
        assert_eq!(f.play_dirs[0].dir, play.to_string_lossy());
        assert_eq!(
            f.play_dirs[0].play_files,
            vec!["Lear.proscenium".to_string()]
        );
    }

    #[cfg(unix)]
    #[test]
    fn an_opened_play_file_names_its_folder_under_any_name() {
        // Renamed in Finder, in a folder that cannot be listed: the file that
        // was opened is still the play file, and its folder is the play.
        let tmp = tempfile::tempdir().unwrap();
        let play = dunce::canonicalize(tmp.path()).unwrap().join("Lear");
        let file = play.join("Lear (old).proscenium");
        touch(&file);
        let _unlisted = Unlisted::new(&play);

        let f = facts(&file, Path::new(NO_HOME));
        assert_eq!(
            f.play_dirs,
            vec![PlayDir {
                dir: play.to_string_lossy().to_string(),
                play_files: vec!["Lear (old).proscenium".into()],
            }]
        );
    }

    #[test]
    fn a_stray_play_file_in_documents_makes_no_play_of_anything() {
        let tmp = tempfile::tempdir().unwrap();
        let home = dunce::canonicalize(tmp.path()).unwrap().join("alex");
        let stray = home.join("Documents/stray.proscenium");
        touch(&stray);
        let loose = home.join("Documents/Scripts/Draft.fountain");
        touch(&loose);
        touch(&home.join("home.proscenium"));

        assert!(
            facts(&loose, &home).play_dirs.is_empty(),
            "a loose script stays loose"
        );
        assert!(
            facts(&stray, &home).play_dirs.is_empty(),
            "Documents is never a play"
        );

        // A real play below it is still found, and the walk stops there.
        let play = home.join("Documents").join("Plays").join("Tide");
        touch(&play.join("Tide.proscenium"));
        let script = play.join("Tide.fountain");
        touch(&script);
        let f = facts(&script, &home);
        assert_eq!(f.play_dirs.len(), 1, "{:?}", f.play_dirs);
        assert_eq!(f.play_dirs[0].dir, play.to_string_lossy());
    }

    #[test]
    fn the_folders_a_mac_keeps_for_everything_are_never_plays() {
        let home = Path::new("/Users/writer");
        for dir in [
            "/",
            "/Users",
            "/Users/writer",
            "/Volumes/Work",
            "/Users/writer/Documents",
            "/Users/writer/Desktop",
            "/Users/writer/Downloads",
            "/Users/writer/Library/Mobile Documents/com~apple~CloudDocs",
            "/Users/writer/Library/Mobile Documents/com~apple~CloudDocs/Documents",
            "/Users/writer/Library/CloudStorage/Dropbox",
        ] {
            assert!(
                never_a_play(Path::new(dir), home),
                "{dir} should never be a play"
            );
        }
        for dir in [
            "/Users/writer/Documents/Plays",
            "/Users/writer/Documents/Plays/Lear",
            "/Users/writer/Library/Mobile Documents/com~apple~CloudDocs/Writing/Plays/Lear",
            "/Users/writer/Library/CloudStorage/Dropbox/Plays/Lear",
            "/Volumes/Work/Plays/Lear",
        ] {
            assert!(!never_a_play(Path::new(dir), home), "{dir} can be a play");
        }
    }
}
