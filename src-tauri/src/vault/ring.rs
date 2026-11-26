// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Proscenium’s Trash: where a delete goes on a system that keeps no trash of
//! its own (docs/engineering/cross-platform.md#PLAT-16).
//!
//! An iPad has none, so what the writer deletes there is kept in a ring in app
//! data, never in the Plays folder: sync never carries it to another device,
//! and the device that deleted it can put it back. Each thing is kept whole,
//! under `<when>-<name>`, and `manifest.json` beside them says where each came
//! from, so Put Back returns it there. What has been kept [`KEEP_DAYS`] days
//! goes for good.
//!
//! Rust stores bytes, TypeScript assigns meaning: what the page said of an
//! entry when it was deleted (its binder row, its play's name) is a note kept
//! and handed back unread.
//!
//! Only a system with no trash of its own keeps anything in a ring. On a Mac
//! or a PC a delete goes to the system's, and the page never opens this one.
#![cfg_attr(not(mobile), allow(dead_code))]

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::TimeZone;
use serde::{Deserialize, Serialize};

use super::atomic_file::rename_exclusive;
use super::{write_atomic, LocalFsVault, Vault, WriteOutcome};

/// How long the ring keeps what is deleted: the span an iPad's own Recently
/// Deleted keeps things for.
pub const KEEP_DAYS: u64 = 30;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const MANIFEST: &str = "manifest.json";
/// The page's note is kept whole or not at all, and never grows the manifest
/// past reading at once.
const NOTE_LIMIT: usize = 256 * 1024;
/// The names a put back tries before it gives up: its own, then "(put back)",
/// "(put back 2)" and on.
const NAMES: u32 = 100;
/// A copy left half made by an app that stopped mid-delete is a copy: the
/// original was not removed. Pruning takes it after a day.
const STAGED_MS: u64 = DAY_MS;

/// One lock for every ring's manifest. Deletes, put backs and pruning are
/// rare, and two at once must not each write the manifest the other read.
static RINGS: Mutex<()> = Mutex::new(());

fn held() -> std::sync::MutexGuard<'static, ()> {
    RINGS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Now, in epoch milliseconds.
pub fn now_ms() -> u64 {
    ms(SystemTime::now())
}

fn ms(at: SystemTime) -> u64 {
    at.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize, Deserialize, Default)]
struct Manifest {
    version: u32,
    #[serde(default)]
    entries: BTreeMap<String, Record>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Record {
    /// Where it was, relative to the folder it was deleted from.
    rel: String,
    /// When it was deleted, epoch milliseconds.
    deleted_ms: u64,
    /// What the page said of it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

/// One thing a ring keeps, as the page is told of it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Kept {
    /// Its name in the ring, which Put Back names it by.
    pub name: String,
    /// What it was called where it was.
    pub original: String,
    /// Where it was, relative to the folder it was deleted from. `None` for
    /// one kept before the ring had a manifest, which did not say.
    pub rel: Option<String>,
    pub is_dir: bool,
    /// A folder holding a play file of its own: a whole play.
    pub is_play: bool,
    /// When it was deleted, epoch milliseconds.
    pub deleted_ms: u64,
    /// When the ring lets it go.
    pub expires_ms: u64,
    /// What the page said of it when it was deleted.
    pub note: Option<String>,
}

/// One ring: a folder in app data, and its manifest.
pub struct Ring {
    dir: PathBuf,
}

impl Ring {
    pub fn at(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// Keep a copy of `abs` (a file or a folder), and say where it came from:
    /// `rel`, relative to the folder it is deleted from, and the page's note.
    /// The caller removes the original once this has answered; until then
    /// nothing is gone. Answers the entry's name in the ring.
    pub fn keep(
        &self,
        abs: &Path,
        rel: &str,
        note: Option<&str>,
        now: SystemTime,
    ) -> io::Result<String> {
        std::fs::create_dir_all(&self.dir)?;
        let original = abs
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "deleted".to_string());
        // Copied whole under a hidden name first, so a copy cut short is
        // never an entry: listing and Put Back see it whole or not at all.
        let staged = self.dir.join(format!(".{}.keeping", super::tmp_token()));
        if let Err(error) = copy_any(abs, &staged) {
            let _ = remove_any(&staged);
            return Err(error);
        }
        let _held = held();
        let name = self.free_name(&stamp(now), &original);
        let entry = self.dir.join(&name);
        if let Err(error) = rename_exclusive(&staged, &entry) {
            let _ = remove_any(&staged);
            return Err(error);
        }
        let mut manifest = self.read_manifest();
        manifest.version = 1;
        manifest.entries.insert(
            name.clone(),
            Record {
                rel: rel.to_string(),
                deleted_ms: ms(now),
                note: note.filter(|n| n.len() <= NOTE_LIMIT).map(str::to_string),
            },
        );
        // A delete whose way back cannot be written down is not made: the copy
        // goes, and the original was never touched.
        if let Err(error) = self.write_manifest(&manifest) {
            let _ = remove_any(&entry);
            return Err(error);
        }
        Ok(name)
    }

    /// Everything the ring keeps, newest first.
    pub fn entries(&self) -> io::Result<Vec<Kept>> {
        let _held = held();
        let manifest = self.read_manifest();
        let mut out = Vec::new();
        for (name, path) in self.names()? {
            out.push(self.kept(&name, &path, manifest.entries.get(&name))?);
        }
        out.sort_by(|a, b| {
            b.deleted_ms
                .cmp(&a.deleted_ms)
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(out)
    }

    /// One entry by its name in the ring, and where its bytes are.
    pub fn find(&self, name: &str) -> io::Result<(PathBuf, Kept)> {
        if !entry_name(name) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "That is not something Proscenium’s Trash keeps.",
            ));
        }
        let _held = held();
        let path = self.dir.join(name);
        if std::fs::symlink_metadata(&path).is_err() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "It is no longer in Proscenium’s Trash.",
            ));
        }
        let manifest = self.read_manifest();
        let kept = self.kept(name, &path, manifest.entries.get(name))?;
        Ok((path, kept))
    }

    /// Let one entry go: once it has been put back.
    pub fn forget(&self, name: &str) -> io::Result<()> {
        if !entry_name(name) {
            return Ok(());
        }
        let _held = held();
        remove_any(&self.dir.join(name))?;
        let mut manifest = self.read_manifest();
        if manifest.entries.remove(name).is_some() {
            self.write_manifest(&manifest)?;
        }
        Ok(())
    }

    /// Let go of everything kept its span, and of a copy a stopped delete
    /// left half made. Answers how many entries went.
    pub fn prune(&self, now_ms: u64) -> io::Result<usize> {
        let _held = held();
        let read = match std::fs::read_dir(&self.dir) {
            Ok(read) => read,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(error),
        };
        for entry in read.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.')
                && name.ends_with(".keeping")
                && mtime_ms(&entry.path()).is_some_and(|at| at.saturating_add(STAGED_MS) <= now_ms)
            {
                let _ = remove_any(&entry.path());
            }
        }
        let manifest = self.read_manifest();
        let mut kept = Manifest {
            version: 1,
            entries: BTreeMap::new(),
        };
        let mut gone = 0;
        for (name, path) in self.names()? {
            let record = manifest.entries.get(&name);
            let entry = self.kept(&name, &path, record)?;
            if entry.expires_ms <= now_ms {
                remove_any(&path)?;
                gone += 1;
            } else if let Some(record) = record {
                kept.entries.insert(name, record.clone());
            }
        }
        // Records whose entry has gone are dropped with the rest.
        if kept.entries.len() != manifest.entries.len() {
            self.write_manifest(&kept)?;
        }
        Ok(gone)
    }

    /// The entries' names and paths: everything in the ring but its manifest
    /// and what is hidden (a copy being made, the manifest's temp file).
    fn names(&self) -> io::Result<Vec<(String, PathBuf)>> {
        let read = match std::fs::read_dir(&self.dir) {
            Ok(read) => read,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut out = Vec::new();
        for entry in read {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if entry_name(&name) {
                out.push((name, entry.path()));
            }
        }
        Ok(out)
    }

    fn kept(&self, name: &str, path: &Path, record: Option<&Record>) -> io::Result<Kept> {
        let is_dir = std::fs::symlink_metadata(path)?.is_dir();
        // One kept before the manifest says when by its name, which is local
        // time, as it was written; failing that, by when it was copied.
        let deleted_ms = record
            .map(|r| r.deleted_ms)
            .or_else(|| stamped(name))
            .or_else(|| mtime_ms(path))
            .unwrap_or(0);
        let original = record
            .and_then(|r| r.rel.rsplit('/').next())
            .filter(|leaf| !leaf.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| unstamped(name).to_string());
        Ok(Kept {
            name: name.to_string(),
            original,
            rel: record.map(|r| r.rel.clone()),
            is_dir,
            is_play: is_dir && holds_play_file(path),
            deleted_ms,
            expires_ms: deleted_ms.saturating_add(KEEP_DAYS * DAY_MS),
            note: record.and_then(|r| r.note.clone()),
        })
    }

    /// `<when>-<name>`, or `<when>-<n>-<name>` when two deletes of one name
    /// land in the same second, as a binder folder and its contents can.
    fn free_name(&self, when: &str, original: &str) -> String {
        let mut n = 0u32;
        loop {
            let candidate = if n == 0 {
                format!("{when}-{original}")
            } else {
                format!("{when}-{n}-{original}")
            };
            if std::fs::symlink_metadata(self.dir.join(&candidate)).is_err() {
                return candidate;
            }
            n += 1;
        }
    }

    /// The manifest, or an empty one where there is none or it cannot be
    /// read: then every entry reads as one kept before the manifest, by its
    /// name, and nothing it holds is lost.
    fn read_manifest(&self) -> Manifest {
        std::fs::read(self.dir.join(MANIFEST))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    /// Written whole or not at all, as every file in app data is.
    fn write_manifest(&self, manifest: &Manifest) -> io::Result<()> {
        let bytes = serde_json::to_vec_pretty(manifest).map_err(io::Error::other)?;
        write_atomic(&self.dir.join(MANIFEST), &bytes)
    }
}

/// A name the ring keeps an entry under: one visible component that is not
/// the manifest.
fn entry_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name != MANIFEST
        && !name.contains(['/', '\\', '\0'])
}

/// A delete's time as its entry's name begins: local time, as a version's
/// name is, so the ring reads against the writer's own clock.
fn stamp(at: SystemTime) -> String {
    chrono::DateTime::<chrono::Local>::from(at)
        .format("%Y%m%d-%H%M%S")
        .to_string()
}

/// When an entry was deleted, from its name.
fn stamped(name: &str) -> Option<u64> {
    let when = name.get(..15)?;
    if name.as_bytes().get(15) != Some(&b'-') {
        return None;
    }
    let naive = chrono::NaiveDateTime::parse_from_str(when, "%Y%m%d-%H%M%S").ok()?;
    let local = chrono::Local.from_local_datetime(&naive).earliest()?;
    u64::try_from(local.timestamp_millis()).ok()
}

/// What an entry was called, from its name: what follows its time.
fn unstamped(name: &str) -> &str {
    match (stamped(name), name.get(16..)) {
        (Some(_), Some(rest)) if !rest.is_empty() => rest,
        _ => name,
    }
}

fn mtime_ms(path: &Path) -> Option<u64> {
    std::fs::symlink_metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .map(ms)
}

/// Whether a folder holds a play file of its own, by the one rule the Plays
/// screen lists plays by: a visible `.proscenium` file directly inside it.
fn holds_play_file(dir: &Path) -> bool {
    std::fs::read_dir(dir).is_ok_and(|read| {
        read.flatten().any(|entry| {
            entry.file_type().is_ok_and(|t| t.is_file())
                && is_play_file(&entry.file_name().to_string_lossy())
        })
    })
}

fn is_play_file(name: &str) -> bool {
    !name.starts_with('.')
        && Path::new(name)
            .extension()
            .is_some_and(|ext| ext == "proscenium")
}

/// A file copied, or a folder copied whole. App data and a chosen Plays folder
/// need not be on one volume, and a rename across two fails outright.
fn copy_any(from: &Path, to: &Path) -> io::Result<()> {
    if std::fs::symlink_metadata(from)?.is_dir() {
        copy_tree(from, to)
    } else {
        std::fs::copy(from, to).map(|_| ())
    }
}

fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

fn remove_any(path: &Path) -> io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => std::fs::remove_dir_all(path),
        Ok(_) => std::fs::remove_file(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// The name a put back tries `n`th: its own, then one that says it was put
/// back beside a namesake, before the extension a file keeps.
fn put_back_name(rel: &str, n: u32, is_dir: bool) -> String {
    if n == 0 {
        return rel.to_string();
    }
    let (dir, leaf) = match rel.rfind('/') {
        Some(i) => (&rel[..=i], &rel[i + 1..]),
        None => ("", rel),
    };
    let (stem, ext) = match leaf.rfind('.') {
        Some(i) if i > 0 && !is_dir => (&leaf[..i], &leaf[i..]),
        _ => (leaf, ""),
    };
    let tag = if n == 1 {
        " (put back)".to_string()
    } else {
        format!(" (put back {n})")
    };
    format!("{dir}{stem}{tag}{ext}")
}

/// Every folder and file inside `dir`, relative to it, folders first.
fn walk(
    dir: &Path,
    prefix: &str,
    folders: &mut Vec<String>,
    files: &mut Vec<String>,
) -> io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            folders.push(rel.clone());
            walk(&entry.path(), &rel, folders, files)?;
        } else {
            files.push(rel);
        }
    }
    Ok(())
}

impl LocalFsVault {
    /// Put a kept file or folder back at `into`, relative to this vault's
    /// root, through the vault's own writer: a file is created where nothing
    /// is, never over anything. Where the name is taken, it comes back beside
    /// its namesake as "<name> (put back)". Answers where it landed.
    pub fn put_back(&self, from: &Path, into: &str) -> io::Result<String> {
        let meta = std::fs::symlink_metadata(from)?;
        if meta.file_type().is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a symbolic link is not put back",
            ));
        }
        let bytes = if meta.is_dir() {
            None
        } else {
            Some(std::fs::read(from)?)
        };
        for n in 0..NAMES {
            let candidate = put_back_name(into, n, meta.is_dir());
            if self.exists(&candidate) {
                continue;
            }
            if let Some(bytes) = &bytes {
                match self.write_guarded(&candidate, bytes, Some(""), false)? {
                    WriteOutcome::Ok { .. } => return Ok(candidate),
                    // Something arrived there since it was looked at.
                    _ => continue,
                }
            }
            let top = self.resolve(&candidate)?;
            if let Some(parent) = top.parent() {
                std::fs::create_dir_all(parent)?;
            }
            // Made here or nowhere: a folder that arrived meanwhile is passed by.
            match std::fs::create_dir(&top) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
            return match self.fill(from, &candidate) {
                Ok(()) => Ok(candidate),
                Err(error) => {
                    // Only what this put back made goes: the ring still has it all.
                    let _ = std::fs::remove_dir_all(&top);
                    Err(error)
                }
            };
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "Every name it could come back under is taken.",
        ))
    }

    /// A kept folder's contents, into the folder just made for them at `rel`.
    fn fill(&self, from: &Path, rel: &str) -> io::Result<()> {
        let (mut folders, mut files) = (Vec::new(), Vec::new());
        walk(from, "", &mut folders, &mut files)?;
        for folder in folders {
            std::fs::create_dir_all(self.resolve(&format!("{rel}/{folder}"))?)?;
        }
        // A play's file last: until it lands the folder is not a play, so
        // nothing lists one half put back.
        files.sort_by_key(|file| is_play_file(file.rsplit('/').next().unwrap_or(file.as_str())));
        for file in files {
            let bytes = std::fs::read(from.join(&file))?;
            match self.write_guarded(&format!("{rel}/{file}"), &bytes, Some(""), false)? {
                WriteOutcome::Ok { .. } => {}
                _ => {
                    return Err(io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "Something arrived in the folder while it was being put back.",
                    ))
                }
            }
        }
        Ok(())
    }
}

/// Put a kept file or folder back into `dest` in app data (practice, a
/// format), under `name`, made whole beside it first and then given its name
/// where nothing has it. With `rename`, a taken name gives way to "<name> (put
/// back)"; without, the put back is refused, for a name that is an identity.
pub fn put_back_local(from: &Path, dest: &Path, name: &str, rename: bool) -> io::Result<String> {
    if !entry_name(name) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "That is not a name anything is put back under.",
        ));
    }
    std::fs::create_dir_all(dest)?;
    let is_dir = std::fs::symlink_metadata(from)?.is_dir();
    let staged = dest.join(format!(".{}.putting-back", super::tmp_token()));
    if let Err(error) = copy_any(from, &staged) {
        let _ = remove_any(&staged);
        return Err(error);
    }
    for n in 0..(if rename { NAMES } else { 1 }) {
        let candidate = put_back_name(name, n, is_dir);
        match rename_exclusive(&staged, &dest.join(&candidate)) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                let _ = remove_any(&staged);
                return Err(error);
            }
        }
    }
    let _ = remove_any(&staged);
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Something is already there under its name.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::SelfWrites;
    use std::sync::Arc;
    use std::time::Duration;

    /// A time `days` before `now`, for a test that dates an entry.
    fn days_ago(now: SystemTime, days: u64) -> SystemTime {
        now - Duration::from_millis(days * DAY_MS)
    }

    fn vault_at(root: &Path) -> LocalFsVault {
        LocalFsVault::open(root.to_path_buf(), Arc::new(SelfWrites::default()), None).unwrap()
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).unwrap()
    }

    #[test]
    fn a_kept_file_says_where_it_was_and_what_the_page_said() {
        let plays = tempfile::tempdir().unwrap();
        let ring_dir = tempfile::tempdir().unwrap();
        let ring = Ring::at(ring_dir.path().join("trash"));
        let file = plays.path().join("Tide/Notes/Structure.md");
        write(&file, "# Structure");
        let now = SystemTime::now();

        let name = ring
            .keep(
                &file,
                "Notes/Structure.md",
                Some("{\"title\":\"Structure\"}"),
                now,
            )
            .unwrap();
        // Kept, never moved: the caller removes the original.
        assert_eq!(read(&file), "# Structure");
        assert!(name.ends_with("-Structure.md"), "{name}");

        let entries = ring.entries().unwrap();
        assert_eq!(entries.len(), 1);
        let kept = &entries[0];
        assert_eq!(kept.name, name);
        assert_eq!(kept.original, "Structure.md");
        assert_eq!(kept.rel.as_deref(), Some("Notes/Structure.md"));
        assert!(!kept.is_dir && !kept.is_play);
        assert_eq!(kept.deleted_ms, ms(now));
        assert_eq!(kept.expires_ms, ms(now) + KEEP_DAYS * DAY_MS);
        assert_eq!(kept.note.as_deref(), Some("{\"title\":\"Structure\"}"));
        assert_eq!(
            read(&ring_dir.path().join("trash").join(&name)),
            "# Structure"
        );
        // Nothing but the entry and its manifest: no copy left half made.
        let mut names: Vec<_> = std::fs::read_dir(ring_dir.path().join("trash"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec![name, MANIFEST.to_string()]);
    }

    #[test]
    fn two_deletes_of_one_name_in_one_second_are_both_kept() {
        let plays = tempfile::tempdir().unwrap();
        let ring_dir = tempfile::tempdir().unwrap();
        let ring = Ring::at(ring_dir.path().to_path_buf());
        let now = SystemTime::now();
        let a = plays.path().join("a/Notes.md");
        let b = plays.path().join("b/Notes.md");
        write(&a, "first");
        write(&b, "second");
        let first = ring.keep(&a, "a/Notes.md", None, now).unwrap();
        let second = ring.keep(&b, "b/Notes.md", None, now).unwrap();
        assert_ne!(first, second);
        let entries = ring.entries().unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|e| e.original == "Notes.md"));
        assert_eq!(read(&ring_dir.path().join(&first)), "first");
        assert_eq!(read(&ring_dir.path().join(&second)), "second");
    }

    #[test]
    fn an_entry_kept_before_the_manifest_is_read_by_its_name() {
        let ring_dir = tempfile::tempdir().unwrap();
        let ring = Ring::at(ring_dir.path().to_path_buf());
        // Phase one's ring: `<local time>-<name>`, and nothing beside it.
        let play = ring_dir.path().join("20261103-091500-The Lighthouse");
        write(&play.join("The Lighthouse.proscenium"), "{}");
        write(
            &play.join("The Lighthouse.fountain"),
            "Title: The Lighthouse",
        );
        write(&ring_dir.path().join("20261103-091501-Ideas.md"), "ideas");

        let entries = ring.entries().unwrap();
        assert_eq!(entries.len(), 2);
        let lighthouse = entries
            .iter()
            .find(|e| e.original == "The Lighthouse")
            .unwrap();
        assert!(
            lighthouse.is_dir && lighthouse.is_play,
            "a whole play's folder is a play"
        );
        assert_eq!(lighthouse.rel, None);
        assert_eq!(lighthouse.note, None);
        let at = chrono::Local
            .with_ymd_and_hms(2026, 11, 3, 9, 15, 0)
            .earliest()
            .unwrap()
            .timestamp_millis() as u64;
        assert_eq!(lighthouse.deleted_ms, at);
        let ideas = entries.iter().find(|e| e.original == "Ideas.md").unwrap();
        assert!(!ideas.is_dir && !ideas.is_play);
        // Newest first.
        assert_eq!(entries[0].original, "Ideas.md");
    }

    #[test]
    fn a_name_with_no_time_in_it_is_dated_by_its_copy() {
        let ring_dir = tempfile::tempdir().unwrap();
        write(&ring_dir.path().join("Loose.md"), "loose");
        let entries = Ring::at(ring_dir.path().to_path_buf()).entries().unwrap();
        assert_eq!(entries[0].original, "Loose.md");
        assert!(entries[0].deleted_ms > 0);
    }

    #[test]
    fn a_manifest_that_cannot_be_read_loses_nothing_it_lists() {
        let plays = tempfile::tempdir().unwrap();
        let ring_dir = tempfile::tempdir().unwrap();
        let ring = Ring::at(ring_dir.path().to_path_buf());
        let file = plays.path().join("Scene.fountain");
        write(&file, "INT. HOUSE");
        let name = ring
            .keep(&file, "Act 1/Scene.fountain", None, SystemTime::now())
            .unwrap();
        std::fs::write(ring_dir.path().join(MANIFEST), "{ not json").unwrap();
        let entries = ring.entries().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, name);
        assert_eq!(entries[0].original, "Scene.fountain");
        assert_eq!(entries[0].rel, None);
    }

    #[test]
    fn put_back_returns_a_file_and_a_folder_where_they_were() {
        let plays = tempfile::tempdir().unwrap();
        let ring_dir = tempfile::tempdir().unwrap();
        let ring = Ring::at(ring_dir.path().to_path_buf());
        let play = plays.path().join("Tide");
        write(&play.join("Tide.proscenium"), "{}");
        write(&play.join("Notes/Structure.md"), "# Structure");
        write(&play.join("Research/Flood.md"), "1953");
        write(&play.join("Research/Maps/Coast.png"), "png");

        let now = SystemTime::now();
        let doc = ring
            .keep(
                &play.join("Notes/Structure.md"),
                "Notes/Structure.md",
                None,
                now,
            )
            .unwrap();
        std::fs::remove_file(play.join("Notes/Structure.md")).unwrap();
        let folder = ring
            .keep(&play.join("Research"), "Research", None, now)
            .unwrap();
        std::fs::remove_dir_all(play.join("Research")).unwrap();

        // From the Plays folder, into the play the entry came from.
        let vault = vault_at(plays.path());
        let (path, kept) = ring.find(&doc).unwrap();
        assert_eq!(
            vault
                .put_back(&path, &format!("Tide/{}", kept.rel.unwrap()))
                .unwrap(),
            "Tide/Notes/Structure.md"
        );
        let (path, _) = ring.find(&folder).unwrap();
        assert_eq!(
            vault.put_back(&path, "Tide/Research").unwrap(),
            "Tide/Research"
        );
        ring.forget(&doc).unwrap();
        ring.forget(&folder).unwrap();

        assert_eq!(read(&play.join("Notes/Structure.md")), "# Structure");
        assert_eq!(read(&play.join("Research/Flood.md")), "1953");
        assert_eq!(read(&play.join("Research/Maps/Coast.png")), "png");
        assert!(ring.entries().unwrap().is_empty());
        let manifest: Manifest =
            serde_json::from_slice(&std::fs::read(ring_dir.path().join(MANIFEST)).unwrap())
                .unwrap();
        assert!(manifest.entries.is_empty());
    }

    #[test]
    fn a_taken_name_puts_it_back_beside_its_namesake_never_over_it() {
        let plays = tempfile::tempdir().unwrap();
        let ring_dir = tempfile::tempdir().unwrap();
        let ring = Ring::at(ring_dir.path().to_path_buf());
        let notes = plays.path().join("Tide/Notes");
        write(&notes.join("Structure.md"), "the one deleted");
        let name = ring
            .keep(
                &notes.join("Structure.md"),
                "Notes/Structure.md",
                None,
                SystemTime::now(),
            )
            .unwrap();
        // A new document took the name meanwhile, and so did a first put back.
        write(&notes.join("Structure.md"), "the new one");
        write(&notes.join("Structure (put back).md"), "an earlier one");

        let vault = vault_at(plays.path());
        let (path, _) = ring.find(&name).unwrap();
        let landed = vault.put_back(&path, "Tide/Notes/Structure.md").unwrap();
        assert_eq!(landed, "Tide/Notes/Structure (put back 2).md");
        assert_eq!(read(&notes.join("Structure.md")), "the new one");
        assert_eq!(
            read(&notes.join("Structure (put back).md")),
            "an earlier one"
        );
        assert_eq!(
            read(&notes.join("Structure (put back 2).md")),
            "the one deleted"
        );

        // A whole play whose name a new play took comes back as a play of its own.
        let lighthouse = plays.path().join("The Lighthouse");
        write(
            &lighthouse.join("The Lighthouse.proscenium"),
            "{\"id\":\"old\"}",
        );
        write(&lighthouse.join("The Lighthouse.fountain"), "old words");
        let play = ring
            .keep(&lighthouse, "The Lighthouse", None, SystemTime::now())
            .unwrap();
        std::fs::remove_dir_all(&lighthouse).unwrap();
        write(
            &lighthouse.join("The Lighthouse.proscenium"),
            "{\"id\":\"new\"}",
        );
        let (path, kept) = ring.find(&play).unwrap();
        assert!(kept.is_play);
        assert_eq!(
            vault.put_back(&path, "The Lighthouse").unwrap(),
            "The Lighthouse (put back)"
        );
        assert_eq!(
            read(
                &plays
                    .path()
                    .join("The Lighthouse (put back)/The Lighthouse.proscenium")
            ),
            "{\"id\":\"old\"}"
        );
        assert_eq!(
            read(&lighthouse.join("The Lighthouse.proscenium")),
            "{\"id\":\"new\"}"
        );
        assert!(!lighthouse.join("The Lighthouse.fountain").exists());
    }

    #[test]
    fn a_put_back_reaches_nothing_outside_the_folder_it_goes_into() {
        let plays = tempfile::tempdir().unwrap();
        let ring_dir = tempfile::tempdir().unwrap();
        let ring = Ring::at(ring_dir.path().to_path_buf());
        let file = plays.path().join("x.md");
        write(&file, "x");
        let name = ring.keep(&file, "x.md", None, SystemTime::now()).unwrap();
        let vault = vault_at(&plays.path().join("."));
        let (path, _) = ring.find(&name).unwrap();
        assert!(vault.put_back(&path, "../outside.md").is_err());
        assert!(ring.find("../manifest.json").is_err());
        assert!(ring.find(MANIFEST).is_err());
    }

    #[test]
    fn a_put_back_into_app_data_keeps_an_identity_or_takes_a_name_that_says_so() {
        let ring_dir = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let ring = Ring::at(ring_dir.path().to_path_buf());
        let sessions = data.path().join("sessions");
        let practice = sessions.join("01J00000000000000000000000");
        write(
            &practice.join("Practice Play/Practice Play.fountain"),
            "practice",
        );
        let name = ring
            .keep(
                &practice,
                "01J00000000000000000000000",
                None,
                SystemTime::now(),
            )
            .unwrap();
        std::fs::remove_dir_all(&practice).unwrap();
        let (path, kept) = ring.find(&name).unwrap();
        assert_eq!(kept.original, "01J00000000000000000000000");
        assert_eq!(
            put_back_local(&path, &sessions, &kept.original, false).unwrap(),
            "01J00000000000000000000000"
        );
        assert_eq!(
            read(&practice.join("Practice Play/Practice Play.fountain")),
            "practice"
        );
        // Its name is its identity: taken, it is refused rather than renamed.
        assert!(put_back_local(&path, &sessions, &kept.original, false).is_err());
        // A format's file name is not: it comes back beside its namesake.
        let formats = data.path().join("formats");
        write(&formats.join("House.json"), "{\"new\":true}");
        let format = ring_dir.path().join("House.json.kept");
        write(&format, "{\"old\":true}");
        assert_eq!(
            put_back_local(&format, &formats, "House.json", true).unwrap(),
            "House (put back).json"
        );
        assert_eq!(read(&formats.join("House.json")), "{\"new\":true}");
        assert_eq!(
            read(&formats.join("House (put back).json")),
            "{\"old\":true}"
        );
        // Nothing half made is left behind it.
        assert!(std::fs::read_dir(&sessions).unwrap().all(|e| !e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with('.')));
    }

    #[test]
    fn pruning_lets_go_of_what_was_kept_its_span() {
        let plays = tempfile::tempdir().unwrap();
        let ring_dir = tempfile::tempdir().unwrap();
        let ring = Ring::at(ring_dir.path().to_path_buf());
        let now = SystemTime::now();
        for (name, days) in [
            ("old.md", KEEP_DAYS + 1),
            ("due.md", KEEP_DAYS),
            ("young.md", 2),
        ] {
            let file = plays.path().join(name);
            write(&file, name);
            ring.keep(&file, name, None, days_ago(now, days)).unwrap();
        }
        // One left from before the manifest, dated by its name.
        let stamped_old = format!("{}-legacy.md", stamp(days_ago(now, KEEP_DAYS + 3)));
        write(&ring_dir.path().join(&stamped_old), "legacy");
        // A copy a stopped delete left half made, a day and more ago.
        let staged = ring_dir.path().join(".abc.keeping");
        write(&staged.join("half.md"), "half");

        let gone = ring.prune(ms(now) + 2 * DAY_MS).unwrap();
        assert_eq!(gone, 3, "the old one, the one due, and the legacy one");
        let left: Vec<_> = ring
            .entries()
            .unwrap()
            .into_iter()
            .map(|e| e.original)
            .collect();
        assert_eq!(left, vec!["young.md".to_string()]);
        assert!(!staged.exists());
        let manifest: Manifest =
            serde_json::from_slice(&std::fs::read(ring_dir.path().join(MANIFEST)).unwrap())
                .unwrap();
        assert_eq!(manifest.entries.len(), 1);
        // Nothing is pruned before its time, and a ring never made prunes nothing.
        assert_eq!(ring.prune(ms(now)).unwrap(), 0);
        assert_eq!(
            Ring::at(ring_dir.path().join("none"))
                .prune(ms(now))
                .unwrap(),
            0
        );
    }

    #[test]
    fn a_copy_being_made_is_never_an_entry() {
        let ring_dir = tempfile::tempdir().unwrap();
        write(&ring_dir.path().join(".x1.keeping/Half.md"), "half");
        write(&ring_dir.path().join(".manifest.json.x2.tmp"), "{");
        assert!(Ring::at(ring_dir.path().to_path_buf())
            .entries()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn names_that_say_put_back() {
        assert_eq!(
            put_back_name("Notes/Structure.md", 0, false),
            "Notes/Structure.md"
        );
        assert_eq!(
            put_back_name("Notes/Structure.md", 1, false),
            "Notes/Structure (put back).md"
        );
        assert_eq!(
            put_back_name("Notes/Structure.md", 3, false),
            "Notes/Structure (put back 3).md"
        );
        assert_eq!(put_back_name("Research", 1, true), "Research (put back)");
        assert_eq!(put_back_name("Act 1.5", 1, true), "Act 1.5 (put back)");
        assert_eq!(put_back_name(".hidden", 1, false), ".hidden (put back)");
        assert_eq!(put_back_name("README", 1, false), "README (put back)");
    }
}
