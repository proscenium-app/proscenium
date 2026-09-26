// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The vault: the only module that touches the filesystem.
//!
//! Boundary (docs/engineering/architecture.md#ARCH-D100): **Rust stores bytes, TypeScript assigns meaning.**
//! The vault opens a folder and lists/reads/writes/trashes files durably. It knows
//! nothing about Fountain, the play schema, or card metadata.
//!
//! It implements the conflict **safety floor** mechanism (docs/app/keeping-work/storage-and-file-format.md#STOR-D9): atomic
//! writes (docs/app/keeping-work/storage-and-file-format.md#STOR-106: temp + fsync + rename), collision-on-write sibling preservation
//! (docs/app/keeping-work/storage-and-file-format.md#STOR-105: never clobber a file that changed underneath us), and a self-write token
//! the watcher uses to suppress echo events.
//!
//! All public paths are **relative to the vault root** (docs/app/keeping-work/storage-and-file-format.md#STOR-D3). Paths that
//! escape the root via `..` are rejected — the app touches exactly one tree.

use std::collections::{HashMap, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

pub mod icloud;
pub mod read_limit;
mod identity;
pub(crate) mod path_key;
use path_key::{path_key, comparison_path};
pub(crate) mod atomic_file;
mod move_journal;
mod write_journal;
pub use move_journal::PendingMove;
pub use write_journal::SavedCopy;
use identity::FileIdentity;
pub mod sync_names;
pub use sync_names::{is_sync_artifact, is_temp_sibling};

/// Result of a guarded write (docs/app/keeping-work/storage-and-file-format.md#STOR-D7 write algorithm).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WriteOutcome {
    /// The write landed on the intended file.
    Ok { hash: String },
    /// The file changed underneath us. NOTHING was written and the on-disk
    /// file was left untouched; `hash` is what is actually on disk.
    ///
    /// **No sibling is made.** Before 1.0 our bytes were preserved to
    /// `<name>.proscenium-conflict-<ts>.<ext>` right next to the play — ten of
    /// them sat in one folder from a single night in July. docs/app/keeping-work/storage-and-file-format.md#STOR-105 still holds, in a
    /// place the writer can actually use: the caller pins a version (storage
    /// docs/app/keeping-work/storage-and-file-format.md#STOR-D9), which is reachable from the banner and from Versions.
    Collision { hash: String },
    /// Same mismatch, on a file with several legitimate writers (the play
    /// file). Nothing was written; the caller rebases onto `hash` and retries
    /// once. Not a version either — there is nothing here the app cannot
    /// rebuild from the state it already holds.
    Stale { hash: String },
}

/// One directory entry from a `list`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub rel_path: String,
    pub is_dir: bool,
    /// A provider artifact, a provider conflict copy, or our own momentary
    /// temp sibling (docs/app/keeping-work/storage-and-file-format.md#STOR-D9, docs/app/keeping-work/storage-and-file-format.md#STOR-D11) — never a binder item.
    pub is_sync_artifact: bool,
    /// Last-modified time, epoch milliseconds; `None` when the platform will
    /// not say. This is the ONLY timestamp that moves when something other than
    /// the app writes a file — an iPad edit, another tool, a sync — so it is what
    /// the plays dashboard means by MODIFIED.
    pub modified_ms: Option<u64>,
}

/// Tokens for writes the app just made, so the watcher can drop the resulting
/// change events instead of mistaking them for external edits (docs/app/keeping-work/storage-and-file-format.md#STOR-D7).
#[derive(Default)]
pub struct SelfWrites {
    inner: Mutex<VecDeque<(PathBuf, String, Instant, u64)>>,
    sequence: AtomicU64,
}

pub struct WriteToken { path: PathBuf, generation: u64 }

// Generous: macOS FSEvents can deliver coalesced events many seconds late
// under continuous typing churn. Generations, not historical hashes, decide
// which token remains eligible when several writes coalesce.
const SELF_WRITE_TTL: Duration = Duration::from_secs(30);

// `is_self_write` is the watcher's half of the suppression handshake, so it is
// unreachable on mobile until the foreground rescan takes the watcher's place
// (docs/engineering/cross-platform.md#PLAT-D103). It stays compiled and tested rather than cfg-gated —
// the token store is platform-neutral, and the rescan will want exactly this
// surface.
#[cfg_attr(mobile, allow(dead_code))]
impl SelfWrites {
    pub fn record(&self, path: &Path, hash: &str) -> WriteToken {
        let mut q = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = self.sequence.fetch_add(1, Ordering::Relaxed);
        q.push_back((comparison_path(path), hash.to_string(), Instant::now(), generation));
        Self::evict(&mut q);
        WriteToken { path: comparison_path(path), generation }
    }

    /// A newer installation retires every older generation at this path.
    pub fn committed(&self, token: &WriteToken) {
        let mut q = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        q.retain(|(path, _, _, generation)| path != &token.path || *generation >= token.generation);
    }

    /// Failure never leaves an authorship claim for bytes that did not land.
    pub fn revoke(&self, token: &WriteToken) {
        let mut q = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        q.retain(|(path, _, _, generation)| path != &token.path || *generation != token.generation);
    }

    /// True if `(path, hash)` matches a recent self-write (consuming it).
    #[cfg(test)]
    pub fn is_self_write(&self, path: &Path, hash: &str) -> bool {
        let mut q = self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        Self::evict(&mut q);
        Self::consume(&mut q, path, hash)
    }

    /// The read and authorship decision share a token snapshot. A completed
    /// newer write cannot retire a token after the watcher has read its bytes
    /// but before it classifies them.
    pub fn observe(&self, path: &Path) -> std::io::Result<(String, bool)> {
        let mut q = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        Self::evict(&mut q);
        let hash = sha256_hex(&std::fs::read(path)?);
        let own = Self::consume(&mut q, path, &hash);
        Ok((hash, own))
    }

    fn consume(q: &mut VecDeque<(PathBuf, String, Instant, u64)>, path: &Path, hash: &str) -> bool {
        let path = comparison_path(path);
        if let Some(idx) = q
            .iter()
            .rposition(|(p, h, _, _)| p == &path && h == hash)
        {
            let generation = q[idx].3;
            q.retain(|(p, _, _, g)| p != &path || *g > generation);
            return true;
        }
        false
    }

    fn evict(q: &mut VecDeque<(PathBuf, String, Instant, u64)>) {
        let now = Instant::now();
        while let Some((_, _, t, _)) = q.front() {
            if now.duration_since(*t) > SELF_WRITE_TTL {
                q.pop_front();
            } else {
                break;
            }
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{:x}", hasher.finalize())
}

/// The storage abstraction (docs/engineering/cross-platform.md#PLAT-D100). One trait; platform backends
/// (macOS/iOS local FS here, Android SAF later) implement it. The frontend only
/// ever sees this surface.
pub trait Vault: Send + Sync {
    fn root(&self) -> &Path;
    fn list(&self, rel_dir: &str) -> std::io::Result<Vec<Entry>>;
    fn read(&self, rel: &str) -> std::io::Result<Vec<u8>>;
    fn exists(&self, rel: &str) -> bool;
    /// Move to the OS trash (recoverable), never a permanent unlink.
    fn trash(&self, rel: &str) -> std::io::Result<()>;
    /// Atomically relocate a file or directory within the vault (binder
    /// move/rename). A directory rename moves its whole subtree atomically.
    fn rename(&self, from: &str, to: &str) -> std::io::Result<()>;
    /// Create a directory (and parents) for a new binder folder.
    fn mkdir(&self, rel: &str) -> std::io::Result<()>;
    /// Guarded write (docs/app/keeping-work/storage-and-file-format.md#STOR-D9). `expected` is the hash the caller believes
    /// is on disk; if the real file differs, nothing is written and the caller
    /// pins a version holding these bytes.
    fn write(&self, rel: &str, bytes: &[u8], expected: Option<&str>)
        -> std::io::Result<WriteOutcome>;
    /// Guarded write for the play file, which has several legitimate writers:
    /// a mismatch yields `Stale` carrying disk truth, so the caller rebuilds
    /// its change on the new base and retries once.
    fn write_rebasable(&self, rel: &str, bytes: &[u8], expected: Option<&str>)
        -> std::io::Result<WriteOutcome>;
}

/// Local-filesystem backend (macOS first; iOS reuses it under a security-scoped
/// resource at unit K).
pub struct LocalFsVault {
    root: PathBuf,
    root_identity: FileIdentity,
    journal: Option<move_journal::MoveJournal>,
    writes: Option<write_journal::WriteJournal>,
    #[cfg(test)]
    _test_journal: Option<tempfile::TempDir>,
    self_writes: Arc<SelfWrites>,
    /// Where a recoverable delete goes where there is no OS trash (mobile).
    /// In app data, never in the play folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). Desktop hands the
    /// item to the OS trash instead, so nothing reads this there.
    #[cfg_attr(not(any(target_os = "ios", target_os = "android")), allow(dead_code))]
    trash_dir: Option<PathBuf>,
}

static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// One lock per file, held from a guarded write's hash check through its
/// rename. Without it two writers holding the same expected hash could both
/// pass the check before either renamed, and both be told "ok" while the later
/// rename replaced the earlier one's bytes. Process-wide rather than per vault:
/// the Plays folder and a play inside it are two vaults over the same files.
fn write_lock(target: &Path) -> Arc<Mutex<()>> {
    static LOCKS: std::sync::OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
        std::sync::OnceLock::new();
    let mut locks = LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.entry(comparison_path(target)).or_default().clone()
}

/// Recursive directory copy — mobile's trash, which cannot assume that app
/// data and a chosen Plays folder sit on the same volume.
#[cfg(any(target_os = "ios", target_os = "android"))]
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
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

/// A short, unique token for an atomic write's temp sibling. Process id plus a
/// counter: two windows writing the same file at the same instant must not pick
/// the same temp name, and the name has to stay matchable by `is_temp_sibling`.
pub fn tmp_token() -> String {
    let seq = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{:x}{:x}", std::process::id(), seq)
}

/// Atomic write: temp sibling → fsync → rename over target (docs/app/keeping-work/storage-and-file-format.md#STOR-106).
///
/// The temp file is a **hidden sibling in the target's own directory**,
/// `.<name>.<random>.tmp` (docs/app/keeping-work/storage-and-file-format.md#STOR-D9), for two reasons that both matter: it is
/// guaranteed to be on the same volume as its target, which is the only
/// condition under which rename(2) is atomic; and it is the only dot-prefixed
/// thing the app ever creates in a play, alive for milliseconds. The watcher and
/// the reconciler ignore that pattern.
///
/// Creating the parent is how folders come into being at all: a binder folder
/// is a row until the first file lands in it (docs/app/keeping-work/storage-and-file-format.md#STOR-D3).
///
/// A crash leaves either the complete old file or the complete new file. A
/// write that fails partway takes its temp file with it, so a full disk never
/// leaves a hidden half-file in a play.
///
/// **The temp name is created exclusively.** A name already
/// there — a leftover, or a symlink someone planted where the writer would
/// write next — is never opened, and so never truncated: the writer takes the
/// next token instead. Nothing at a taken name is removed, because it was not
/// this write's to remove.
///
/// **The one atomic writer.** The vault writes the play with it, and app data
/// (Versions, Changes, recovery snapshots) goes through the same function, so
/// "atomic" means one thing everywhere the app puts bytes on disk.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = target.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent directory")
    })?;
    std::fs::create_dir_all(parent)?;

    let name = tmp_stem(target);
    for _ in 0..8 {
        let tmp = parent.join(format!(".{name}.{}.tmp", tmp_token()));
        match write_atomic_via(&tmp, target, bytes) {
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            done => return done,
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "every temp name tried was already taken",
    ))
}

/// One attempt at [`write_atomic`] through a chosen temp name. `AlreadyExists`
/// when something is at that name — and then that something is untouched.
pub(crate) fn write_atomic_via(tmp: &Path, target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;

    // `create_new`: O_EXCL, so an existing file or link at the temp name fails
    // here rather than being opened for writing.
    let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(tmp)?;
    let written = (|| {
        f.write_all(bytes)?;
        f.flush()?;
        // The replacement is a new inode: it keeps the old file's permission
        // bits, so a file the writer restricted to themselves stays restricted.
        // A new file gets what the umask gives every new file.
        if let Ok(meta) = std::fs::symlink_metadata(target) {
            if meta.is_file() {
                f.set_permissions(meta.permissions())?;
            }
        }
        f.sync_all()?;
        // Atomic replace. On the same filesystem this is a single rename(2).
        std::fs::rename(tmp, target)
    })();
    drop(f);
    if let Err(e) = written {
        // Only the temp file this call created: an `AlreadyExists` never gets here.
        let _ = std::fs::remove_file(tmp);
        return Err(e);
    }

    // A recovery caller must not call its only copy safe when the directory
    // entry could not be synced.
    if let Some(parent) = target.parent() {
        atomic_file::sync_dir(parent)?;
    }
    Ok(())
}

/// The target's name as the temp sibling repeats it: cut so that
/// `.<name>.<token>.tmp` fits a 255-byte filename even when the target's own
/// name is at the limit — a legal 250-character name could be
/// read and never saved, because its temp name was too long to make.
fn tmp_stem(target: &Path) -> String {
    const KEEP: usize = 200;
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    if name.len() <= KEEP {
        return name;
    }
    let mut end = KEEP;
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    name[..end].to_string()
}

/// Why a write was refused, where the OS's own error cannot say (docs/app/keeping-work/storage-and-file-format.md#STOR-D9,
/// "When the disk refuses a write").
///
/// The writer is told what would let the save go through, and two of the
/// answers are invisible in the error. macOS reports a file locked in Finder as
/// EPERM, which is also what a privacy or sandbox refusal looks like; and a play
/// on a drive that was disconnected as EACCES, as if its folder were only not
/// the writer's to change. The vault looks, and puts what it saw in front of the
/// OS's words: `locked: Operation not permitted (os error 1)`.
/// `src/storage/save-failure.ts` reads these names, and its test reads them here.
pub mod refused {
    /// Finder's Locked is set on the file.
    pub const LOCKED: &str = "locked";
    /// Finder's Locked is set on the folder the file is in.
    pub const FOLDER_LOCKED: &str = "folder-locked";
    /// The folder the vault is — the play's, or the Plays folder — is not there.
    pub const FOLDER_GONE: &str = "folder-gone";
}

const EPERM: i32 = 1;

fn refusal(reason: &str, e: std::io::Error) -> std::io::Error {
    std::io::Error::new(e.kind(), format!("{reason}: {e}"))
}

/// Finder's Locked: the user immutable flag (`UF_IMMUTABLE`, `chflags uchg`).
/// macOS will not replace a file that has it, nor make a file in a folder that
/// has it.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn locked_in_finder(path: &Path) -> bool {
    use std::os::darwin::fs::MetadataExt;
    const UF_IMMUTABLE: u32 = 0x0000_0002;
    std::fs::metadata(path).is_ok_and(|m| m.st_flags() & UF_IMMUTABLE != 0)
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn locked_in_finder(_path: &Path) -> bool {
    false
}

/// True when two vault paths differ only by letter case: "charlie.md" and
/// "Charlie.md". A Mac volume sees those as one file.
fn is_case_only(from: &str, to: &str) -> bool {
    from != to && path_key(from) == path_key(to)
}

/// A relative path under `root`, or an error. Rejects `..`, absolute paths and
/// platform prefixes lexically, and then **any symlink on the way**:
/// a link inside a play pointing outside it would carry
/// every read, write, rename and trash out with it, and the lexical check
/// cannot see that. The policy is the simplest one that holds — no links,
/// in any component, the leaf included. A check-then-use race remains where a
/// link is swapped in between; the app opens nothing by handle, so that is
/// noted rather than closed.
pub(crate) fn resolve_under(root: &Path, rel: &str, what: &str) -> std::io::Result<PathBuf> {
    let mut out = root.to_path_buf();
    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(c) => {
                out.push(c);
                if std::fs::symlink_metadata(&out).is_ok_and(|m| m.file_type().is_symlink()) {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        format!("path goes through a symbolic link, which the {what} does not follow"),
                    ));
                }
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!("path escapes the {what}"),
                ));
            }
        }
    }
    Ok(out)
}

impl LocalFsVault {
    pub fn open(
        root: PathBuf,
        self_writes: Arc<SelfWrites>,
        trash_dir: Option<PathBuf>,
    ) -> std::io::Result<Self> {
        let root = root.canonicalize().unwrap_or(root);
        // Never resurrect a vault on a path that no longer exists — otherwise a
        // deleted last-opened folder would be silently recreated as an empty
        // skeleton on auto-reopen instead of failing back to the empty state.
        if !root.is_dir() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "vault folder does not exist",
            ));
        }
        // Nothing is scaffolded here. A play folder holds the writer's work,
        // the play file, and (for milliseconds at a time) an atomic write's
        // temp sibling — and nothing else (docs/app/keeping-work/storage-and-file-format.md#STOR-D3, docs/app/keeping-work/storage-and-file-format.md#STOR-111). The pre-1.0
        // `.proscenium/tmp` directory is gone.
        let root_identity = FileIdentity::read(&root)?;
        #[cfg(test)]
        let test_journal = tempfile::tempdir()?;
        #[cfg(test)]
        let journal = Some(move_journal::MoveJournal::new(test_journal.path().join(root_identity.key())));
        #[cfg(not(test))]
        let journal = None;
        #[cfg(test)]
        let writes = Some(write_journal::WriteJournal::new(test_journal.path().join(root_identity.key())));
        #[cfg(not(test))]
        let writes = None;
        Ok(Self { root, root_identity, self_writes, trash_dir, journal, writes,
            #[cfg(test)] _test_journal: Some(test_journal),
        })
    }

    /// Resolve a relative path under the root, rejecting `..` escapes and
    /// symlinks (I-security; see [`resolve_under`]).
    fn resolve(&self, rel: &str) -> std::io::Result<PathBuf> {
        self.require_root()?;
        resolve_under(&self.root, rel, "vault")
    }

    fn require_root(&self) -> std::io::Result<()> {
        if !self.root.is_dir() || FileIdentity::read(&self.root).ok().as_ref() != Some(&self.root_identity) {
            return Err(refusal(refused::FOLDER_GONE, std::io::ErrorKind::NotFound.into()));
        }
        Ok(())
    }

    pub fn identity(&self) -> String { self.root_identity.key() }

    pub fn with_journal(mut self, app_data: &Path) -> Self {
        self.journal = Some(move_journal::MoveJournal::new(app_data.join("transactions").join(self.identity())));
        self.writes = Some(write_journal::WriteJournal::new(app_data.join("transactions").join(self.identity())));
        self
    }

    fn journal(&self) -> std::io::Result<&move_journal::MoveJournal> {
        self.journal.as_ref().ok_or_else(|| std::io::Error::other("The file-operation journal is unavailable."))
    }

    pub fn recover_moves(&self) -> std::io::Result<Vec<PendingMove>> {
        self.require_root()?;
        let moves = self.journal()?.recover(&self.root)?;
        self.writes()?.recover(&self.root, |rel| self.journal()?.write_guard(rel))?;
        Ok(moves)
    }

    fn writes(&self) -> std::io::Result<&write_journal::WriteJournal> {
        self.writes.as_ref().ok_or_else(|| std::io::Error::other("The save journal is unavailable."))
    }

    pub fn saved_copies(&self) -> std::io::Result<Vec<SavedCopy>> { self.writes()?.saved_copies() }

    pub fn read_saved_copy(&self, id: &str) -> std::io::Result<Vec<u8>> { self.writes()?.read_copy(id) }

    pub fn begin_move(&self, from: &str, to: &str, manifest: String, payload: String) -> std::io::Result<PendingMove> {
        self.relocate(from, to, Some(manifest), Some(payload))?
            .ok_or_else(|| std::io::Error::other("The move has no metadata intent."))
    }

    pub fn has_pending_moves(&self) -> bool { self.journal.as_ref().is_some_and(|journal| journal.has_pending()) }

    fn relocate(&self, from: &str, to: &str, manifest: Option<String>, payload: Option<String>) -> std::io::Result<Option<PendingMove>> {
        let src = self.resolve(from)?;
        let dst = self.resolve(to)?;
        icloud::require_available(&src)?;
        let journal = self.journal()?;
        let token = if src.is_file() {
            std::fs::read(&src).ok().map(|bytes| self.self_writes.record(&dst, &sha256_hex(&bytes)))
        } else { None };
        let result = journal.begin(&self.root, from, to, manifest, payload);
        if let Some(token) = token {
            if result.is_ok() { self.self_writes.committed(&token); }
            else { self.self_writes.revoke(&token); }
        }
        result
    }

    pub fn finish_move(&self, id: &str) -> std::io::Result<()> {
        self.require_root()?;
        self.journal()?.finish(&self.root, id)
    }

    pub fn rollback_move(&self, id: &str) -> std::io::Result<()> {
        self.require_root()?;
        self.journal()?.rollback(&self.root, id)
    }

    /// The absolute path for a vault-relative one, with the same `..` rejection
    /// every other operation gets. Used by the iCloud fetch (which speaks
    /// absolute paths) and by "Reveal in Finder", which has to hand the OS a
    /// real path for the row the writer right-clicked.
    pub fn abs_path(&self, rel: &str) -> std::io::Result<PathBuf> {
        self.resolve(rel)
    }

    fn rel_of(&self, abs: &Path) -> String {
        abs.strip_prefix(&self.root)
            .unwrap_or(abs)
            .to_string_lossy()
            .replace('\\', "/")
    }

    /// Desktop: hand the item to the OS trash, where the user already knows to
    /// look for it.
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    fn trash_impl(&self, abs: &Path) -> std::io::Result<()> {
        os_trash(abs).map_err(|e| std::io::Error::other(e.to_string()))
    }

    /// Mobile: there is no OS trash to hand a file to (and the `trash` crate has
    /// no platform module for these targets — it does not compile, let alone
    /// run). The recoverable-delete contract is kept with a device-local ring
    /// in APP DATA (docs/app/keeping-work/storage-and-file-format.md#STOR-D10), never inside the play folder.
    ///
    /// Living outside the Plays folder is the point, twice over: it is never
    /// canonical, and it is never synced — so a delete on the iPad cannot be
    /// resurrected onto the Mac by the sync layer, while the bytes stay
    /// recoverable on the device that did the deleting.
    ///
    /// A copy-then-remove rather than a rename: app data and the Plays folder
    /// are on the same volume today, but a chosen folder need not be, and a
    /// cross-device rename fails outright.
    #[cfg(any(target_os = "ios", target_os = "android"))]
    fn trash_impl(&self, abs: &Path) -> std::io::Result<()> {
        let Some(dir) = self.trash_dir.clone() else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "no trash directory for this play",
            ));
        };
        std::fs::create_dir_all(&dir)?;

        let name = abs
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "deleted".to_string());
        // Local time, like a version's name — a writer digging something out of
        // the trash reads these names against their own clock.
        let ts = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();

        // Second-resolution timestamps collide when a binder folder and its
        // contents go in the same tick; suffix rather than clobber.
        let mut n = 0u32;
        let dest = loop {
            let candidate = dir.join(if n == 0 {
                format!("{ts}-{name}")
            } else {
                format!("{ts}-{n}-{name}")
            });
            if !candidate.exists() {
                break candidate;
            }
            n += 1;
        };

        if abs.is_dir() {
            copy_tree(abs, &dest)?;
            std::fs::remove_dir_all(abs)?;
        } else {
            std::fs::copy(abs, &dest)?;
            std::fs::remove_file(abs)?;
        }
        Ok(())
    }

}

impl Vault for LocalFsVault {
    fn root(&self) -> &Path {
        &self.root
    }

    fn list(&self, rel_dir: &str) -> std::io::Result<Vec<Entry>> {
        let dir = self.resolve(rel_dir)?;
        let mut entries = Vec::new();
        // `.<name>.icloud` stubs, held back until the real names are known.
        let mut evicted: Vec<String> = Vec::new();

        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            // Our own atomic-write temp file, alive for milliseconds. Listing
            // it would flicker a phantom row into the binder mid-save.
            if is_temp_sibling(&name) {
                continue;
            }
            // An iCloud stub stands for a file whose bytes are in the cloud. It
            // is listed under the name it stands for, never its own, so the
            // binder and docs/app/keeping-work/storage-and-file-format.md#STOR-D8 reconciliation see the play that is really there
            // rather than hidden junk plus a missing file (vault::icloud).
            if let Some(target) = icloud::placeholder_target(&name) {
                evicted.push(target.to_string());
                continue;
            }
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let modified_ms = entry
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);
            entries.push(Entry {
                rel_path: self.rel_of(&path),
                is_dir,
                is_sync_artifact: is_sync_artifact(&name),
                modified_ms,
                name,
            });
        }

        for name in evicted {
            // Both can exist for the moment a download is landing; the real file
            // wins, so we never report the same material twice.
            if entries.iter().any(|e| e.name == name) {
                continue;
            }
            let path = dir.join(&name);
            // An evicted file's bytes are in the cloud; its stub's mtime says
            // when eviction happened, not when the writer wrote. Reporting that
            // would be worse than reporting nothing.
            entries.push(Entry {
                rel_path: self.rel_of(&path),
                is_dir: false,
                is_sync_artifact: is_sync_artifact(&name),
                modified_ms: None,
                name,
            });
        }

        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(entries)
    }

    fn read(&self, rel: &str) -> std::io::Result<Vec<u8>> {
        let path = self.resolve(rel)?;
        icloud::require_available(&path)?;
        read_limit::read_document(&path)
    }

    fn exists(&self, rel: &str) -> bool {
        self.resolve(rel).map(|p| p.exists() || icloud::unavailable(&p)).unwrap_or(false)
    }

    fn trash(&self, rel: &str) -> std::io::Result<()> {
        // Deletes are recoverable, never a silent unlink (docs/app/organizing/workspace-model.md#WORK-D100).
        // The mechanism is platform-specific; the contract is not — see
        // `trash_impl`.
        self.trash_impl(&self.resolve(rel)?)
    }

    fn rename(&self, from: &str, to: &str) -> std::io::Result<()> {
        if from == to { return Ok(()); }
        self.relocate(from, to, None, None).map(|_| ())
    }

    fn mkdir(&self, rel: &str) -> std::io::Result<()> {
        std::fs::create_dir_all(self.resolve(rel)?)
    }

    fn write(
        &self,
        rel: &str,
        bytes: &[u8],
        expected: Option<&str>,
    ) -> std::io::Result<WriteOutcome> {
        self.write_guarded(rel, bytes, expected, false)
    }

    fn write_rebasable(
        &self,
        rel: &str,
        bytes: &[u8],
        expected: Option<&str>,
    ) -> std::io::Result<WriteOutcome> {
        self.write_guarded(rel, bytes, expected, true)
    }
}

impl LocalFsVault {
    /// The docs/app/keeping-work/storage-and-file-format.md#STOR-D9 write algorithm. Neither outcome writes anything on a mismatch;
    /// `rebase` only selects which one the caller is told.
    ///
    /// `false` — authored bytes (a script, a document). The caller pins a
    /// version and shows the banner: the writer decides.
    /// `true` — the play file, which has several legitimate writers. The
    /// caller re-reads, rebuilds its change on the new base, and retries once.
    ///
    /// An `expected` that no content hashes to — the empty string — therefore
    /// writes only where no file is yet. That is how a new play is created
    /// without any chance of writing over one already there.
    fn write_guarded(
        &self,
        rel: &str,
        bytes: &[u8],
        expected: Option<&str>,
        rebase: bool,
    ) -> std::io::Result<WriteOutcome> {
        let target = self.resolve(rel)?;
        // A write lands in the folder it was made for, or nowhere. The atomic
        // writer makes the folders a binder row stands for (docs/app/keeping-work/storage-and-file-format.md#STOR-29); asked for a
        // file in a play whose folder had gone — moved in Finder, or on a drive
        // that was disconnected — it made that folder again, and the words went
        // into a copy of it that nobody would look in.
        if !self.root.is_dir() {
            return Err(refusal(
                refused::FOLDER_GONE,
                std::io::ErrorKind::NotFound.into(),
            ));
        }
        let new_hash = sha256_hex(bytes);
        let lock = write_lock(&target);
        let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.require_root()?;
        icloud::require_available(&target)?;
        let _transaction = self.journal()?.write_guard(rel)?;
        let _process = self.writes()?.lock(rel)?;

        // docs/app/keeping-work/storage-and-file-format.md#STOR-D9: if the file changed under us since we last read/wrote it, write
        // NOTHING. The on-disk file is left completely untouched, and the
        // caller pins a version holding our bytes — which is how docs/app/keeping-work/storage-and-file-format.md#STOR-105 ("both
        // sides of a collision are kept") is honoured now that no conflict
        // sibling is ever written into a play folder (docs/app/keeping-work/storage-and-file-format.md#STOR-111).
        let baseline = if target.exists() {
            let current =
                sha256_hex(&std::fs::read(&target).map_err(|e| self.explain(&target, e))?);
            if let Some(expected) = expected {
                if current != expected {
                    return Ok(if rebase {
                        WriteOutcome::Stale { hash: current }
                    } else {
                        WriteOutcome::Collision { hash: current }
                    });
                }
            }
            Some(current)
        } else { None };

        if baseline.is_none() && expected.is_some_and(|hash| !hash.is_empty()) {
            return Ok(if rebase { WriteOutcome::Stale { hash: String::new() } }
                else { WriteOutcome::Collision { hash: String::new() } });
        }

        // Register the suppression token BEFORE the rename makes the bytes
        // visible. The watcher thread can read the file the instant the rename
        // lands; if the token were recorded afterwards, a read inside that
        // window finds no token and reports OUR OWN write as an external
        // change — the false conflict banner (reproduced 400/400
        // by watcher::tests::a_watcher_racing_our_writes_…). Pre-registering
        // closes the window. Completion retires older tokens; failure revokes
        // this one, so neither can hide a later external rollback.
        let token = self.self_writes.record(&target, &new_hash);
        match self.writes()?.replace(&self.root, rel, bytes, baseline) {
            Ok(true) => {},
            Ok(false) => {
                self.self_writes.revoke(&token);
                let hash = match self.read(rel) {
                    Ok(bytes) => sha256_hex(&bytes),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
                    Err(error) => return Err(error),
                };
                return Ok(if rebase { WriteOutcome::Stale { hash } } else { WriteOutcome::Collision { hash } });
            },
            Err(error) => {
                self.self_writes.revoke(&token);
                return Err(self.explain(&target, error));
            },
        }
        self.self_writes.committed(&token);
        Ok(WriteOutcome::Ok { hash: new_hash })
    }

    /// A refused write's error, with what the vault can see and the error
    /// cannot say ([`refused`]). The folder is asked before the file: making
    /// the temp sibling in a locked folder fails before anything reaches the file.
    fn explain(&self, target: &Path, e: std::io::Error) -> std::io::Error {
        let permission = e.raw_os_error() == Some(EPERM);
        if !self.root.is_dir() {
            refusal(refused::FOLDER_GONE, e)
        } else if permission && target.parent().is_some_and(locked_in_finder) {
            refusal(refused::FOLDER_LOCKED, e)
        } else if permission && locked_in_finder(target) {
            refusal(refused::LOCKED, e)
        } else {
            e
        }
    }
}

/// Hand a file or folder to the OS trash: on macOS through NSFileManager's
/// `trashItemAtURL`, not by scripting Finder, which is the `trash` crate's
/// default. Scripting Finder asks the writer to let Proscenium control Finder
/// the first time they delete anything, and a delete fails wherever that is
/// declined or cannot be answered: the locked build host the self-test runs on
/// found it. The item lands in the
/// same Trash; Finder's delete sound goes, and on some macOS versions so does
/// Put Back, while dragging it out of the Trash still restores it.
#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub(crate) fn os_trash(path: &Path) -> Result<(), trash::Error> {
    #[allow(unused_mut)]
    let mut context = trash::TrashContext::default();
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        context.set_delete_method(DeleteMethod::NsFileManager);
    }
    context.delete(path)
}

#[cfg(test)]
mod tests;
