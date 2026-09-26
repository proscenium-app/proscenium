// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! A guarded replace retains the displaced inode until validation. A durable
//! intent makes every exchange recoverable; unexpected bytes are immutable
//! app-data copies, exposed in Changes, before any rollback or cleanup.
use std::fs::OpenOptions;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use super::atomic_file::{create_dir_durable, exchange, rename_exclusive, sync_dir, write_new, FileLock};
use super::{resolve_under, sha256_hex, tmp_stem, tmp_token, FileIdentity};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedCopy { pub id: String, pub rel: String, pub hash: String, pub created_ms: u64 }

#[derive(Clone, Deserialize, Serialize)]
struct Intent {
    id: String,
    rel: String,
    temporary: String,
    staged: FileIdentity,
    baseline: Option<String>,
    new_hash: String,
    created_ms: u64,
}

pub struct WriteJournal { directory: PathBuf }

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 160 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
}

fn read_optional(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn same_inode(path: &Path, identity: &FileIdentity) -> bool { FileIdentity::read(path).ok().as_ref() == Some(identity) }

impl WriteJournal {
    pub fn new(directory: PathBuf) -> Self { Self { directory } }
    fn records(&self) -> PathBuf { self.directory.join("writes") }
    fn copies(&self) -> PathBuf { self.directory.join("saved-copies") }
    fn record(&self, id: &str) -> io::Result<PathBuf> {
        if !valid_id(id) { return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid write identifier")); }
        Ok(self.records().join(format!("{id}.json")))
    }
    fn copy_path(&self, id: &str, ext: &str) -> io::Result<PathBuf> {
        if !valid_id(id) { return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid saved-copy identifier")); }
        resolve_under(&self.copies(), &format!("{id}.{ext}"), "saved copy")
    }

    /// All processes use the same inode for one physical file name, including
    /// Unicode normalization and case aliases (docs/app/keeping-work/storage-and-file-format.md#STOR-D4).
    pub fn lock(&self, rel: &str) -> io::Result<FileLock> {
        let key = sha256_hex(super::path_key(rel).as_bytes());
        FileLock::try_at(&self.directory.join("write-locks").join(&key[7..]))
    }

    fn intents(&self) -> io::Result<Vec<Intent>> {
        let entries = match std::fs::read_dir(self.records()) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let mut intents = Vec::new();
        for entry in entries {
            let entry = entry?;
            if entry.path().extension().map_or(true, |ext| ext != "json") { continue; }
            if !entry.file_type()?.is_file() || entry.metadata()?.len() > 65_536 { return Err(io::Error::other("The unfinished save record could not be read safely.")); }
            let intent: Intent = serde_json::from_slice(&std::fs::read(entry.path())?)?;
            if self.record(&intent.id)? != entry.path() { return Err(io::Error::other("The unfinished save has a different identity.")); }
            intents.push(intent);
        }
        Ok(intents)
    }

    pub fn has_pending(&self, rel: &str) -> io::Result<bool> { Ok(self.intents()?.iter().any(|intent| intent.rel == rel)) }

    fn keep(&self, intent: &Intent, bytes: &[u8]) -> io::Result<()> {
        let hash = sha256_hex(bytes);
        let id = format!("{}-{}", intent.id, &hash[7..]);
        let path = self.copy_path(&id, "bytes")?;
        match write_new(&path, bytes) {
            Ok(()) => {},
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists && std::fs::read(&path)? == bytes => {},
            Err(e) => return Err(e),
        }
        let copy = SavedCopy { id: id.clone(), rel: intent.rel.clone(), hash, created_ms: intent.created_ms };
        let metadata = serde_json::to_vec(&copy)?;
        let path = self.copy_path(&id, "json")?;
        match write_new(&path, &metadata) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists && std::fs::read(&path)? == metadata => Ok(()),
            Err(e) => Err(e),
        }
    }

    pub fn saved_copies(&self) -> io::Result<Vec<SavedCopy>> {
        let entries = match std::fs::read_dir(self.copies()) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let mut copies = Vec::new();
        for entry in entries {
            let entry = entry?;
            if entry.path().extension().map_or(true, |ext| ext != "json") { continue; }
            if !entry.file_type()?.is_file() || entry.metadata()?.len() > 65_536 { return Err(io::Error::other("A saved copy's details could not be read safely.")); }
            let copy: SavedCopy = serde_json::from_slice(&std::fs::read(entry.path())?)?;
            if self.copy_path(&copy.id, "json")? != entry.path() { return Err(io::Error::other("A saved copy has a different identity.")); }
            copies.push(copy);
        }
        copies.sort_by(|a, b| b.created_ms.cmp(&a.created_ms).then(a.id.cmp(&b.id)));
        Ok(copies)
    }

    pub fn read_copy(&self, id: &str) -> io::Result<Vec<u8>> {
        let metadata: SavedCopy = serde_json::from_slice(&std::fs::read(self.copy_path(id, "json")?)?)?;
        let bytes = std::fs::read(self.copy_path(id, "bytes")?)?;
        if metadata.id != id || sha256_hex(&bytes) != metadata.hash { return Err(io::Error::other("The saved copy could not be verified.")); }
        Ok(bytes)
    }

    fn forget(&self, intent: &Intent) -> io::Result<()> {
        std::fs::remove_file(self.record(&intent.id)?)?;
        sync_dir(&self.records())
    }

    fn clean_temp(&self, root: &Path, intent: &Intent) -> io::Result<()> {
        let temp = resolve_under(root, &intent.temporary, "vault")?;
        match std::fs::remove_file(&temp) {
            Ok(()) => sync_dir(temp.parent().ok_or_else(|| io::Error::other("no temporary parent"))?)?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {},
            Err(e) => return Err(e),
        }
        self.forget(intent)
    }

    /// The caller holds both the root move guard and the per-file process lock.
    /// `true` means the intended bytes landed; false means disk changed.
    pub fn replace(&self, root: &Path, rel: &str, bytes: &[u8], baseline: Option<String>) -> io::Result<bool> {
        if self.has_pending(rel)? { return Err(io::Error::other("unfinished-save: An unfinished save needs recovery. Reopen the play before saving.")); }
        let target = resolve_under(root, rel, "vault")?;
        let parent = target.parent().ok_or_else(|| io::Error::other("no write parent"))?;
        create_dir_durable(parent)?;
        let temp = parent.join(format!(".{}.{}.tmp", tmp_stem(&target), tmp_token()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = options.open(&temp)?;
        let created_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        let intent = Intent { id: format!("{created_ms:x}{}", tmp_token()), rel: rel.into(),
            temporary: temp.strip_prefix(root).map_err(io::Error::other)?.to_string_lossy().into_owned(),
            staged: FileIdentity::read(&temp)?, baseline, new_hash: sha256_hex(bytes), created_ms };
        if let Err(error) = write_new(&self.record(&intent.id)?, &serde_json::to_vec(&intent)?) {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
        let prepared = (|| {
            file.write_all(bytes)?;
            if let Ok(meta) = std::fs::symlink_metadata(&target) {
                if meta.is_file() { file.set_permissions(meta.permissions())?; }
            }
            file.sync_all()
        })();
        drop(file);
        if let Err(error) = prepared { self.clean_temp(root, &intent)?; return Err(error); }
        if intent.baseline.is_some() {
            match exchange(&temp, &target) {
                Ok(()) => {},
                Err(error) if error.kind() == io::ErrorKind::NotFound => { self.clean_temp(root, &intent)?; return Ok(false); },
                Err(error) => { self.clean_temp(root, &intent)?; return Err(error); },
            }
            sync_dir(parent)?;
            self.settle_exchange(root, &intent)
        } else {
            match rename_exclusive(&temp, &target) {
                Ok(()) => { sync_dir(parent)?; self.forget(&intent)?; Ok(true) },
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => { self.clean_temp(root, &intent)?; Ok(false) },
                Err(error) => { self.clean_temp(root, &intent)?; Err(error) },
            }
        }
    }

    fn settle_exchange(&self, root: &Path, intent: &Intent) -> io::Result<bool> {
        let target = resolve_under(root, &intent.rel, "vault")?;
        let temp = resolve_under(root, &intent.temporary, "vault")?;
        let displaced = read_optional(&temp)?;
        let current = read_optional(&target)?;
        let ours = same_inode(&target, &intent.staged) && current.as_ref().is_some_and(|b| sha256_hex(b) == intent.new_hash);
        if displaced.as_ref().is_some_and(|b| Some(sha256_hex(b)) == intent.baseline) {
            // The exchanged pre-image was precisely the accepted baseline.
            // Sync both names before retiring the durable record.
            sync_dir(target.parent().ok_or_else(|| io::Error::other("no target parent"))?)?;
            self.clean_temp(root, intent)?;
            return Ok(ours);
        }
        if let Some(bytes) = displaced.as_ref() { self.keep(intent, bytes)?; }
        // Unexpected bytes are durable BEFORE trying to restore their original
        // name. An intervening third writer is retained at temp by this swap.
        if ours && displaced.is_some() {
            exchange(&temp, &target)?;
            sync_dir(target.parent().ok_or_else(|| io::Error::other("no target parent"))?)?;
            if let Some(again) = read_optional(&temp)? {
                if sha256_hex(&again) != intent.new_hash { self.keep(intent, &again)?; }
            }
        }
        self.clean_temp(root, intent)?;
        Ok(false)
    }

    /// Recovery runs before editors open. Live owners are skipped; their lock
    /// and journal continue to exclude saves from this instance at that path.
    pub fn recover(&self, root: &Path, guard: impl Fn(&str) -> io::Result<Option<FileLock>>) -> io::Result<()> {
        for intent in self.intents()? {
            let _root = guard(&intent.rel)?;
            let _file = match self.lock(&intent.rel) {
                Ok(lock) => lock,
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => continue,
                Err(e) => return Err(e),
            };
            // The live owner may have finished while we acquired its lock.
            if !self.record(&intent.id)?.exists() { continue; }
            let temp = resolve_under(root, &intent.temporary, "vault")?;
            if same_inode(&temp, &intent.staged) {
                let bytes = std::fs::read(&temp)?;
                // Complete local words that never became the acknowledged
                // canonical file survive too. An incomplete temp is scratch.
                if sha256_hex(&bytes) == intent.new_hash { self.keep(&intent, &bytes)?; }
                self.clean_temp(root, &intent)?;
            } else {
                self.settle_exchange(root, &intent)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{LocalFsVault, SelfWrites, Vault, WriteOutcome};
    use std::sync::Arc;

    #[test]
    fn a220_unicode_case_aliases_share_the_os_write_lock() {
        let base = tempfile::tempdir().unwrap();
        let journal = WriteJournal::new(base.path().to_path_buf());
        let _first = journal.lock("Notes/Café.md").unwrap();
        assert!(matches!(journal.lock("NOTES/Cafe\u{301}.MD"), Err(error) if error.kind() == io::ErrorKind::WouldBlock));
    }

    fn staged(root: &Path, journal: &WriteJournal, bytes: &[u8], baseline: &[u8]) -> Intent {
        std::fs::write(root.join("A.fountain"), baseline).unwrap();
        let temp = root.join(".A.fountain.0123.tmp");
        write_new(&temp, bytes).unwrap();
        let intent = Intent { id: "a201".into(), rel: "A.fountain".into(), temporary: ".A.fountain.0123.tmp".into(),
            staged: FileIdentity::read(&temp).unwrap(), baseline: Some(sha256_hex(baseline)),
            new_hash: sha256_hex(bytes), created_ms: 1 };
        write_new(&journal.record(&intent.id).unwrap(), &serde_json::to_vec(&intent).unwrap()).unwrap();
        intent
    }

    #[test]
    fn a2_01_cold_open_after_exchange_restores_and_keeps_unexpected_bytes() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("Play");
        std::fs::create_dir(&root).unwrap();
        let directory = base.path().join("data");
        let journal = WriteJournal::new(directory.clone());
        let intent = staged(&root, &journal, b"OURS", b"BASE");
        std::fs::write(root.join("A.fountain"), b"EXTERNAL").unwrap();
        exchange(&root.join(&intent.temporary), &root.join("A.fountain")).unwrap();
        drop(journal);
        let reopened = WriteJournal::new(directory);
        reopened.recover(&root, |_| Ok(None)).unwrap();
        assert_eq!(std::fs::read(root.join("A.fountain")).unwrap(), b"EXTERNAL");
        let copies = reopened.saved_copies().unwrap();
        assert_eq!(copies.len(), 1);
        assert_eq!(reopened.read_copy(&copies[0].id).unwrap(), b"EXTERNAL");
        assert!(!reopened.has_pending("A.fountain").unwrap());
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
    }

    #[test]
    fn a2_01_cold_open_keeps_staged_local_words_and_does_not_replace_the_file() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("Play");
        std::fs::create_dir(&root).unwrap();
        let journal = WriteJournal::new(base.path().join("data"));
        staged(&root, &journal, b"LATEST UNSAVED WORDS", b"BASE");
        journal.recover(&root, |_| Ok(None)).unwrap();
        assert_eq!(std::fs::read(root.join("A.fountain")).unwrap(), b"BASE");
        let copy = &journal.saved_copies().unwrap()[0];
        assert_eq!(journal.read_copy(&copy.id).unwrap(), b"LATEST UNSAVED WORDS");
    }

    #[test]
    fn a2_01_a_third_external_writer_after_exchange_keeps_both_external_versions() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("Play");
        std::fs::create_dir(&root).unwrap();
        let journal = WriteJournal::new(base.path().join("data"));
        let intent = staged(&root, &journal, b"OURS", b"BASE");
        std::fs::write(root.join("A.fountain"), b"EXTERNAL B").unwrap();
        exchange(&root.join(&intent.temporary), &root.join("A.fountain")).unwrap();
        std::fs::write(root.join("replacement"), b"EXTERNAL C").unwrap();
        std::fs::rename(root.join("replacement"), root.join("A.fountain")).unwrap();
        assert!(!journal.settle_exchange(&root, &intent).unwrap());
        assert_eq!(std::fs::read(root.join("A.fountain")).unwrap(), b"EXTERNAL C");
        assert_eq!(journal.read_copy(&journal.saved_copies().unwrap()[0].id).unwrap(), b"EXTERNAL B");
    }

    #[test]
    fn a2_01_failure_to_keep_a_displaced_file_leaves_the_journal_and_both_inodes() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("Play");
        std::fs::create_dir(&root).unwrap();
        let journal = WriteJournal::new(base.path().join("data"));
        let intent = staged(&root, &journal, b"OURS", b"BASE");
        std::fs::write(root.join("A.fountain"), b"EXTERNAL B").unwrap();
        exchange(&root.join(&intent.temporary), &root.join("A.fountain")).unwrap();
        std::fs::write(journal.copies(), b"blocked directory").unwrap();
        assert!(journal.settle_exchange(&root, &intent).is_err());
        assert_eq!(std::fs::read(root.join("A.fountain")).unwrap(), b"OURS");
        assert_eq!(std::fs::read(root.join(&intent.temporary)).unwrap(), b"EXTERNAL B");
        assert!(journal.has_pending("A.fountain").unwrap());
        std::fs::remove_file(journal.copies()).unwrap();
        journal.recover(&root, |_| Ok(None)).unwrap();
        assert_eq!(std::fs::read(root.join("A.fountain")).unwrap(), b"EXTERNAL B");
    }

    #[test]
    fn a2_01_write_lock_child() {
        let Some(base) = std::env::var_os("PROSCENIUM_TEST_WRITE_LOCK") else { return; };
        let base = PathBuf::from(base);
        let vault = LocalFsVault::open(base.join("Play"), Arc::new(SelfWrites::default()), None).unwrap().with_journal(&base.join("data"));
        let _owner = vault.writes().unwrap().lock("A.fountain").unwrap();
        std::fs::write(base.join("held"), b"ready").unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !base.join("release").exists() && std::time::Instant::now() < deadline { std::thread::sleep(std::time::Duration::from_millis(10)); }
    }

    #[test]
    fn a2_01_another_process_cannot_pass_the_same_write_check() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("Play");
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("A.fountain"), b"BASE").unwrap();
        let vault = LocalFsVault::open(root.clone(), Arc::new(SelfWrites::default()), None).unwrap().with_journal(&base.path().join("data"));
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "vault::write_journal::tests::a2_01_write_lock_child"])
            .env("PROSCENIUM_TEST_WRITE_LOCK", base.path()).stdout(std::process::Stdio::null()).spawn().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !base.path().join("held").exists() && std::time::Instant::now() < deadline { std::thread::sleep(std::time::Duration::from_millis(10)); }
        assert!(base.path().join("held").exists());
        assert_eq!(vault.write("A.fountain", b"OURS", Some(&sha256_hex(b"BASE"))).unwrap_err().kind(), io::ErrorKind::WouldBlock);
        assert_eq!(std::fs::read(root.join("A.fountain")).unwrap(), b"BASE");
        std::fs::write(base.path().join("release"), b"done").unwrap();
        assert!(child.wait().unwrap().success());
        assert!(matches!(vault.write("A.fountain", b"OURS", Some(&sha256_hex(b"BASE"))).unwrap(), WriteOutcome::Ok { .. }));
    }
}
