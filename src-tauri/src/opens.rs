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
        let mut granted = self.granted.lock().unwrap();
        let mut queue = self.queue.lock().unwrap();
        for path in paths {
            granted.insert(path.clone());
            if !queue.contains(&path) {
                queue.push(path);
            }
        }
    }

    /// Everything queued since the last take, in the order it arrived.
    pub fn take(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.queue.lock().unwrap())
    }

    pub fn is_granted(&self, path: &Path) -> bool {
        self.granted.lock().unwrap().contains(path)
    }

    /// `dir` holds (or is) a path that was opened from Finder — a folder the
    /// app may ask about, because the writer's own open named something in it.
    pub fn is_around_granted(&self, dir: &Path) -> bool {
        let dir = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
        self.granted.lock().unwrap().iter().any(|path| {
            path.starts_with(&dir)
                || path.canonicalize().is_ok_and(|canonical| canonical.starts_with(&dir))
        })
    }
}

/// The filesystem paths among an open event's URLs. Anything that is not a
/// `file:` URL (a custom scheme, a malformed URL) is not ours to open.
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
    !name.starts_with('.') && Path::new(name).extension().is_some_and(|ext| ext == "proscenium")
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
    let parts: Vec<String> =
        rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
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
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let exists = canonical.exists();
    let is_dir = canonical.is_dir();
    let mut play_dirs =
        play_dirs_from(if is_dir { Some(canonical.as_path()) } else { canonical.parent() }, home);

    // The opened file is itself a play file, so its folder holds one whether or
    // not that folder can be listed — and under whatever name the file has now.
    let name = canonical.file_name().map(|n| n.to_string_lossy().to_string());
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
                _ => play_dirs.insert(0, PlayDir { dir: parent_dir, play_files: vec![name] }),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    /// No home folder anywhere near a temp directory.
    const NO_HOME: &str = "/nonexistent-home";

    /// A folder as the App Sandbox shows one the writer has not granted: it
    /// cannot be listed, but a path inside it can still be looked up. Restores
    /// the permissions on drop so the temp directory can be cleaned up.
    struct Unlisted(PathBuf);
    impl Unlisted {
        fn new(dir: &Path) -> Self {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o111)).unwrap();
            Unlisted(dir.to_path_buf())
        }
    }
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
        assert!(pending.take().is_empty(), "a second take hands nothing over again");
        // …but both stay readable for as long as the app runs.
        assert!(pending.is_granted(&a) && pending.is_granted(&b));
        assert!(!pending.is_granted(Path::new("/etc/passwd")));
        // The folders around an opened file may be asked about; others may not.
        assert!(pending.is_around_granted(Path::new("/tmp/A")));
        assert!(pending.is_around_granted(Path::new("/tmp/A/A.proscenium")));
        assert!(!pending.is_around_granted(Path::new("/tmp/C")));
    }

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
        let plays = tmp.path().canonicalize().unwrap().join("Plays");
        let play = plays.join("The Tide");
        touch(&play.join("The Tide.proscenium"));
        let script = play.join("Scenes/Draft two.fountain");
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
        let play = tmp.path().canonicalize().unwrap().join("Lear");
        touch(&play.join("Lear.proscenium"));
        // A temp file mid-write and a hidden file are never play files.
        touch(&play.join(".Lear.proscenium.1a2b.tmp"));
        touch(&play.join(".hidden.proscenium"));
        let f = facts(&play, Path::new(NO_HOME));
        assert!(f.is_dir);
        assert_eq!(f.play_dirs[0].dir, play.to_string_lossy());
        assert_eq!(f.play_dirs[0].play_files, vec!["Lear.proscenium".to_string()]);
    }

    #[test]
    fn facts_for_a_loose_file_have_no_play_and_a_missing_file_says_so() {
        let tmp = tempfile::tempdir().unwrap();
        let loose = tmp.path().canonicalize().unwrap().join("Downloads/Hamlet.fdx");
        touch(&loose);
        let f = facts(&loose, Path::new(NO_HOME));
        assert!(f.exists);
        assert!(f.play_dirs.is_empty(), "no play above a loose file: {:?}", f.play_dirs);

        let gone = facts(&tmp.path().join("gone.fountain"), Path::new(NO_HOME));
        assert!(!gone.exists);
    }

    #[test]
    fn a_play_that_cannot_be_listed_is_found_by_its_own_name() {
        // A script in a play outside the Plays folder, opened under the App
        // Sandbox: the open grants the file, not the folders around it. Listing
        // used to fail silently, the script looked loose, and "make a play from
        // it" copied it into a second play.
        let tmp = tempfile::tempdir().unwrap();
        let play = tmp.path().canonicalize().unwrap().join("Elsewhere/Lear");
        touch(&play.join("Lear.proscenium"));
        let script = play.join("Lear.fountain");
        touch(&script);
        let _unlisted = Unlisted::new(&play);
        assert!(std::fs::read_dir(&play).is_err(), "the test folder should refuse a listing");

        let f = facts(&script, Path::new(NO_HOME));
        assert_eq!(f.play_dirs.len(), 1, "{:?}", f.play_dirs);
        assert_eq!(f.play_dirs[0].dir, play.to_string_lossy());
        assert_eq!(f.play_dirs[0].play_files, vec!["Lear.proscenium".to_string()]);
    }

    #[test]
    fn an_opened_play_file_names_its_folder_under_any_name() {
        // Renamed in Finder, in a folder that cannot be listed: the file that
        // was opened is still the play file, and its folder is the play.
        let tmp = tempfile::tempdir().unwrap();
        let play = tmp.path().canonicalize().unwrap().join("Lear");
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
        let home = tmp.path().canonicalize().unwrap().join("alex");
        let stray = home.join("Documents/stray.proscenium");
        touch(&stray);
        let loose = home.join("Documents/Scripts/Draft.fountain");
        touch(&loose);
        touch(&home.join("home.proscenium"));

        assert!(facts(&loose, &home).play_dirs.is_empty(), "a loose script stays loose");
        assert!(facts(&stray, &home).play_dirs.is_empty(), "Documents is never a play");

        // A real play below it is still found, and the walk stops there.
        let play = home.join("Documents/Plays/Tide");
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
            assert!(never_a_play(Path::new(dir), home), "{dir} should never be a play");
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
