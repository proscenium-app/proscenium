// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Relocation intent is durable before the first rename. Binder meaning stays
//! in the opaque frontend payload; Rust tracks only paths and filesystem identity.
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use unicode_normalization::UnicodeNormalization;
use super::atomic_file::{FileLock, create_dir_durable, rename_exclusive, sync_dir, sync_parents, write_new};
use super::{FileIdentity, is_case_only, resolve_under, tmp_stem, tmp_token};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMove {
    pub id: String,
    pub from: String,
    pub to: String,
    pub manifest: Option<String>,
    pub payload: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Intent {
    #[serde(flatten)]
    pending: PendingMove,
    temporary: Option<String>,
    source: FileIdentity,
}

#[derive(Default)]
struct Owner { lock: Option<FileLock>, manifests: Vec<String> }

pub struct MoveJournal {
    directory: PathBuf,
    owner: Mutex<Owner>,
}

impl MoveJournal {
    pub fn new(directory: PathBuf) -> Self { Self { directory, owner: Mutex::new(Owner::default()) } }

    pub fn has_pending(&self) -> bool { self.intents().map_or(true, |intents| !intents.is_empty()) }

    fn acquire(&self, owner: &mut Owner) -> io::Result<()> {
        if owner.lock.is_none() {
            owner.lock = Some(FileLock::try_at(&self.directory.join("lock"))
                .map_err(|error| io::Error::new(error.kind(), "A file operation in another window has not finished yet. Try again."))?);
        }
        Ok(())
    }

    fn records(&self) -> PathBuf { self.directory.join("moves") }

    fn record_path(&self, id: &str) -> io::Result<PathBuf> {
        if id.is_empty() || id.len() > 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid move identifier"));
        }
        Ok(self.records().join(format!("{id}.json")))
    }

    fn intents(&self) -> io::Result<Vec<Intent>> {
        let entries = match std::fs::read_dir(self.records()) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut intents = Vec::new();
        for entry in entries {
            let entry = entry?;
            if entry.path().extension().map_or(true, |ext| ext != "json") { continue; }
            if entry.file_type()?.is_symlink() || entry.metadata()?.len() > 131_072 {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "The unfinished move record could not be read safely."));
            }
            let intent: Intent = serde_json::from_slice(&std::fs::read(entry.path())?)?;
            if self.record_path(&intent.pending.id)? != entry.path() {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "The unfinished move record has a different identity."));
            }
            intents.push(intent);
        }
        intents.sort_by(|a, b| a.pending.id.cmp(&b.pending.id));
        Ok(intents)
    }

    fn remove_record(&self, id: &str) -> io::Result<()> {
        match std::fs::remove_file(self.record_path(id)?) {
            Ok(()) => sync_dir(&self.records()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn refresh_owner(&self, owner: &mut Owner) -> io::Result<()> {
        let intents = self.intents()?;
        owner.manifests = intents.iter().filter_map(|intent| intent.pending.manifest.clone()).collect();
        if intents.is_empty() { owner.lock = None; }
        Ok(())
    }

    /// Guard ordinary writes against an unfinished move in any app process.
    /// The owning transaction may update only its declared metadata file.
    pub fn write_guard(&self, rel: &str) -> io::Result<Option<FileLock>> {
        let owner = self.owner.lock().unwrap_or_else(|p| p.into_inner());
        if owner.lock.is_some() {
            if owner.manifests.iter().any(|manifest| manifest == rel) { return Ok(None); }
            return Err(io::Error::new(io::ErrorKind::WouldBlock,
                "A file move has not finished. Reopen the play to finish it before saving."));
        }
        let guard = FileLock::try_shared_at(&self.directory.join("lock"))?;
        if self.has_pending() {
            return Err(io::Error::new(io::ErrorKind::WouldBlock, "An unfinished file move needs recovery. Reopen the play before saving."));
        }
        Ok(Some(guard))
    }

    fn plan(&self, root: &Path, from: &str, to: &str, manifest: Option<String>, payload: Option<String>) -> io::Result<Intent> {
        let src = resolve_under(root, from, "vault")?;
        let dst = resolve_under(root, to, "vault")?;
        if let Some(manifest) = &manifest { resolve_under(root, manifest, "vault")?; }
        if payload.as_ref().is_some_and(|payload| payload.len() > 65_536) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "move metadata is too large"));
        }
        super::icloud::require_available(&src)?;
        if !is_case_only(from, to) && std::fs::symlink_metadata(&dst).is_ok() {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, "Something is already at that name, so nothing was moved."));
        }
        let id = format!("{:x}{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos(), tmp_token());
        let temporary = if is_case_only(from, to) {
            let temp = src.with_file_name(format!(".{}.{}.tmp", tmp_stem(&src), tmp_token()));
            Some(temp.strip_prefix(root).map_err(io::Error::other)?.to_string_lossy().into_owned())
        } else { None };
        let intent = Intent { pending: PendingMove { id, from: from.into(), to: to.into(), manifest, payload },
            temporary, source: FileIdentity::read(&src)? };
        write_new(&self.record_path(&intent.pending.id)?, &serde_json::to_vec(&intent)?)?;
        Ok(intent)
    }

    pub fn begin(&self, root: &Path, from: &str, to: &str, manifest: Option<String>, payload: Option<String>) -> io::Result<Option<PendingMove>> {
        let mut owner = self.owner.lock().unwrap_or_else(|p| p.into_inner());
        if owner.lock.is_some() { return Err(io::Error::other("An earlier file move needs to finish first. Reopen the play.")); }
        self.acquire(&mut owner)?;
        if self.has_pending() { return Err(io::Error::other("An earlier file move needs recovery. Reopen the play.")); }
        let intent = match self.plan(root, from, to, manifest, payload) {
            Ok(intent) => intent,
            Err(error) => { owner.lock = None; return Err(error); }
        };
        owner.manifests = intent.pending.manifest.iter().cloned().collect();
        if let Err(error) = forward(root, &intent) {
            if backward(root, &intent).is_ok() { self.remove_record(&intent.pending.id)?; self.refresh_owner(&mut owner)?; }
            return Err(error);
        }
        if intent.pending.payload.is_none() {
            self.remove_record(&intent.pending.id)?;
            self.refresh_owner(&mut owner)?;
            Ok(None)
        } else { Ok(Some(intent.pending)) }
    }

    /// Run before normal listing. A stopped process relinquishes its OS lock;
    /// a live transaction in another instance is left entirely alone.
    pub fn recover(&self, root: &Path) -> io::Result<Vec<PendingMove>> {
        let mut owner = self.owner.lock().unwrap_or_else(|p| p.into_inner());
        self.acquire(&mut owner)?;
        let mut pending = Vec::new();
        for intent in self.intents()? {
            forward(root, &intent)?;
            if intent.pending.payload.is_none() { self.remove_record(&intent.pending.id)?; }
            else { pending.push(intent.pending); }
        }
        self.refresh_owner(&mut owner)?;
        Ok(pending)
    }

    pub fn finish(&self, root: &Path, id: &str) -> io::Result<()> {
        let mut owner = self.owner.lock().unwrap_or_else(|p| p.into_inner());
        self.acquire(&mut owner)?;
        if let Some(manifest) = self.intents()?.iter().find(|intent| intent.pending.id == id)
            .and_then(|intent| intent.pending.manifest.as_deref()) {
            let path = resolve_under(root, manifest, "vault")?;
            std::fs::File::open(&path)?.sync_all()?;
            if let Some(parent) = path.parent() { sync_dir(parent)?; }
        }
        self.remove_record(id)?;
        self.refresh_owner(&mut owner)
    }

    pub fn rollback(&self, root: &Path, id: &str) -> io::Result<()> {
        let mut owner = self.owner.lock().unwrap_or_else(|p| p.into_inner());
        self.acquire(&mut owner)?;
        let intent = self.intents()?.into_iter().find(|intent| intent.pending.id == id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "The unfinished move record is missing."))?;
        backward(root, &intent)?;
        // Keep the intent until the frontend confirms that metadata still
        // names the original location. A crash here resumes the original move.
        Ok(())
    }
}

fn exact_identity(path: &Path, identity: &FileIdentity) -> bool {
    if FileIdentity::read(path).ok().as_ref() != Some(identity) { return false; }
    // Case-insensitive APFS answers true for both spellings. A completed case
    // move is recognised by the actual directory entry, not an alias lookup.
    path.parent().and_then(|parent| std::fs::read_dir(parent).ok()).is_some_and(|entries|
        entries.flatten().any(|entry| path.file_name().is_some_and(|name|
            entry.file_name().to_string_lossy().nfc().eq(name.to_string_lossy().nfc()))))
}

fn forward(root: &Path, intent: &Intent) -> io::Result<()> {
    let src = resolve_under(root, &intent.pending.from, "vault")?;
    let dst = resolve_under(root, &intent.pending.to, "vault")?;
    let temp = intent.temporary.as_ref().map(|rel| resolve_under(root, rel, "vault")).transpose()?;
    if exact_identity(&dst, &intent.source) && !exact_identity(&src, &intent.source) {
        return sync_parents(&src, &dst);
    }
    if let Some(parent) = dst.parent() { create_dir_durable(parent)?; }
    if exact_identity(&src, &intent.source) {
        let next = temp.as_ref().unwrap_or(&dst);
        rename_exclusive(&src, next)?;
        sync_parents(&src, next)?;
    }
    if let Some(temp) = &temp {
        if exact_identity(temp, &intent.source) {
            rename_exclusive(temp, &dst)?;
            sync_parents(temp, &dst)?;
        }
    }
    if !exact_identity(&dst, &intent.source) {
        return Err(io::Error::other("The file's location changed during an unfinished move. Its move record has been kept."));
    }
    Ok(())
}

fn backward(root: &Path, intent: &Intent) -> io::Result<()> {
    let src = resolve_under(root, &intent.pending.from, "vault")?;
    if exact_identity(&src, &intent.source) { return Ok(()); }
    let candidates = intent.temporary.iter().chain(std::iter::once(&intent.pending.to));
    for rel in candidates {
        let path = resolve_under(root, rel, "vault")?;
        if exact_identity(&path, &intent.source) {
            rename_exclusive(&path, &src)?;
            return sync_parents(&path, &src);
        }
    }
    Err(io::Error::other("The file could not be moved back safely. Reopen the play to finish its move."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a2_21_a_crash_between_case_rename_steps_is_completed_before_listing() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("Play");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("a.fountain"), b"ONLY COPY").unwrap();
        let directory = base.path().join("app-data");
        let journal = MoveJournal::new(directory.clone());
        let intent = journal.plan(&root, "a.fountain", "A.fountain", None, None).unwrap();
        rename_exclusive(&root.join("a.fountain"), &root.join(intent.temporary.unwrap())).unwrap();
        drop(journal);
        assert!(MoveJournal::new(directory).recover(&root).unwrap().is_empty());
        assert_eq!(std::fs::read(root.join("A.fountain")).unwrap(), b"ONLY COPY");
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
    }

    #[test]
    fn a2_08_metadata_failure_rolls_back_and_another_file_at_the_old_path_is_protected() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("Play");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("A.fountain"), b"ORIGINAL").unwrap();
        std::fs::write(root.join("Play.proscenium"), b"original metadata").unwrap();
        let journal = MoveJournal::new(base.path().join("app-data"));
        let pending = journal.begin(&root, "A.fountain", "B.fountain", Some("Play.proscenium".into()), Some("item A".into())).unwrap().unwrap();
        assert!(journal.write_guard("A.fountain").is_err());
        assert!(journal.write_guard("Play.proscenium").is_ok());
        std::fs::write(root.join("A.fountain"), b"NEW ARRIVAL").unwrap();
        assert!(journal.rollback(&root, &pending.id).is_err());
        assert_eq!(std::fs::read(root.join("A.fountain")).unwrap(), b"NEW ARRIVAL");
        assert_eq!(std::fs::read(root.join("B.fountain")).unwrap(), b"ORIGINAL");
        std::fs::remove_file(root.join("A.fountain")).unwrap();
        journal.rollback(&root, &pending.id).unwrap();
        assert_eq!(std::fs::read(root.join("A.fountain")).unwrap(), b"ORIGINAL");
        assert!(!root.join("B.fountain").exists());
        journal.finish(&root, &pending.id).unwrap();
        assert!(journal.write_guard("A.fountain").is_ok());
    }

    #[test]
    fn a2_08_reopen_returns_the_same_item_intent_after_the_file_moved() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("Play");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("A.fountain"), b"ORIGINAL").unwrap();
        let directory = base.path().join("app-data");
        let journal = MoveJournal::new(directory.clone());
        let pending = journal.begin(&root, "A.fountain", "B.fountain", Some("Play.proscenium".into()), Some("stable item A".into())).unwrap().unwrap();
        assert!(MoveJournal::new(directory.clone()).recover(&root).is_err());
        drop(journal);
        let reopened = MoveJournal::new(directory);
        let recovered = reopened.recover(&root).unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].payload.as_deref(), Some("stable item A"));
        std::fs::write(root.join("Play.proscenium"), b"metadata now names B").unwrap();
        reopened.finish(&root, &pending.id).unwrap();
        assert!(reopened.recover(&root).unwrap().is_empty());
    }
}
