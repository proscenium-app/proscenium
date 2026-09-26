// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Watcher classification tests — the false-conflict-banner hunt.
//!
//! The banner fires when the frontend receives an external-change event whose
//! hash is OUR OWN fresh write. These tests exercise the real classifier
//! against a real filesystem at the exact interleavings the watcher thread can
//! observe, so the race is proven or ruled out by evidence rather than theory.

use super::*;

#[test]
fn a220_rescan_follows_an_unchanged_case_rename_without_a_false_removal() {
    let (_dir, vault, tokens) = new_vault();
    let from = vault.root().join("Café.fountain");
    let to = vault.root().join("CAFÉ.fountain");
    std::fs::write(&from, b"same words").unwrap();
    let mut last = ObservedFiles::new();
    assert!(matches!(classify(&tokens, &mut last, &from), WatchDecision::External(_)));
    std::fs::rename(&from, &to).unwrap();
    let changes = rescan(vault.root(), &tokens, &mut last).unwrap();
    assert_eq!(last.len(), 1);
    assert!(changes.iter().any(|(path, decision)| path == &to && matches!(decision, WatchDecision::External(_))));
    assert!(!changes.iter().any(|(_, decision)| decision == &WatchDecision::Removed));
}

#[test]
fn a2_16_a_coalesced_save_does_not_hide_an_external_rollback() {
    let (_dir, vault, self_writes) = new_vault();
    let abs = vault.root().join("A.fountain");
    vault.write("A.fountain", b"A", None).unwrap();
    vault.write("A.fountain", b"B", None).unwrap();
    let mut last = HashMap::new();
    assert_eq!(classify(&self_writes, &mut last, &abs), WatchDecision::SelfWrite);
    std::fs::write(&abs, b"A").unwrap();
    assert_eq!(classify(&self_writes, &mut last, &abs), WatchDecision::External(sha256_hex(b"A")));
}

#[test]
fn a2_16_failed_writes_revoke_only_their_own_generation() {
    let (_dir, vault, tokens) = new_vault();
    let path = vault.root().join("A.fountain");
    let older = tokens.record(&path, &sha256_hex(b"A"));
    let newer = tokens.record(&path, &sha256_hex(b"B"));
    tokens.revoke(&older);
    std::fs::write(&path, b"A").unwrap();
    let mut last = HashMap::new();
    assert_eq!(classify(&tokens, &mut last, &path), WatchDecision::External(sha256_hex(b"A")));
    tokens.revoke(&newer);
    std::fs::write(&path, b"B").unwrap();
    assert_eq!(classify(&tokens, &mut last, &path), WatchDecision::External(sha256_hex(b"B")));
}
use crate::vault::{sha256_hex, LocalFsVault, SelfWrites, Vault, WriteOutcome};
use std::sync::Arc;

fn new_vault() -> (tempfile::TempDir, LocalFsVault, Arc<SelfWrites>) {
    let dir = tempfile::tempdir().unwrap();
    let self_writes = Arc::new(SelfWrites::default());
    let vault =
        LocalFsVault::open(dir.path().to_path_buf(), self_writes.clone(), None).unwrap();
    (dir, vault, self_writes)
}

#[test]
fn a2_17_overflow_and_directory_events_require_a_full_scan() {
    let (dir, _vault, _tokens) = new_vault();
    let overflow = notify::Event::new(notify::EventKind::Any).set_flag(notify::event::Flag::Rescan);
    assert!(needs_rescan(&overflow));
    let directory = notify::Event::new(notify::EventKind::Modify(notify::event::ModifyKind::Any))
        .add_path(dir.path().to_path_buf());
    assert!(needs_rescan(&directory));
    let removed = notify::Event::new(notify::EventKind::Remove(notify::event::RemoveKind::Folder))
        .add_path(dir.path().join("vanished"));
    assert!(needs_rescan(&removed));
}

#[test]
fn a2_17_restart_scan_recovers_missed_changes_additions_and_removals() {
    let (dir, _vault, tokens) = new_vault();
    let a = dir.path().join("A.fountain");
    let b = dir.path().join("B.md");
    let c = dir.path().join("C.md");
    std::fs::write(&a, b"A").unwrap();
    std::fs::write(&b, b"B").unwrap();
    let mut last = HashMap::new();
    rescan(dir.path(), &tokens, &mut last).unwrap();
    // No file event is delivered: an error/overflow or restart must cover all three.
    std::fs::write(&a, b"NEWEST").unwrap();
    std::fs::remove_file(&b).unwrap();
    std::fs::write(&c, b"C").unwrap();
    let changes = rescan(dir.path(), &tokens, &mut last).unwrap();
    assert!(changes.contains(&(a, WatchDecision::External(sha256_hex(b"NEWEST")))));
    assert!(changes.contains(&(b, WatchDecision::Removed)));
    assert!(changes.contains(&(c, WatchDecision::External(sha256_hex(b"C")))));
}

#[test]
fn a2_17_an_unavailable_scan_never_turns_remote_bytes_into_deletions() {
    let (dir, _vault, tokens) = new_vault();
    let a = dir.path().join("A.fountain");
    std::fs::write(&a, b"A").unwrap();
    let mut last = HashMap::new();
    rescan(dir.path(), &tokens, &mut last).unwrap();
    let before = last.clone();
    std::fs::remove_file(&a).unwrap();
    std::fs::write(dir.path().join(".A.fountain.icloud"), b"stub").unwrap();
    assert!(rescan(dir.path(), &tokens, &mut last).is_err());
    assert_eq!(last, before);
    assert!(rescan(&dir.path().join("missing"), &tokens, &mut last).is_err());
    assert_eq!(last, before);
}

/// The core guarantee: a completed app write is never reported as external.
#[test]
fn a_completed_self_write_is_suppressed_not_emitted() {
    let (_dir, vault, self_writes) = new_vault();
    let mut last = HashMap::new();
    vault.write("script/play.fountain", b"# ACT ONE\n", None).unwrap();
    let abs = vault.root().join("script/play.fountain");

    assert_eq!(classify(&self_writes, &mut last, &abs), WatchDecision::SelfWrite);
}

/// SUSPECT (a), Rust half — a watcher thread reading the file WHILE the app
/// writes it. The atomic write makes the new bytes visible at the rename; if
/// the self-write token is registered only after that, a watcher read landing
/// in between finds no token, classifies our own bytes as an external change,
/// and the frontend raises a false conflict banner against a dirty buffer.
///
/// This races the real write path (no interleaving is simulated): one thread
/// saves repeatedly while another classifies as fast as it can. Any External
/// decision carrying content WE wrote is the bug, caught in the act.
#[test]
fn a_watcher_racing_our_writes_never_reports_our_own_bytes_as_external() {
    use std::sync::atomic::{AtomicBool, Ordering};

    let (_dir, vault, self_writes) = new_vault();
    let rel = "script/play.fountain";
    let vault = Arc::new(vault);
    vault.write(rel, b"gen000\n", None).unwrap();
    let abs = vault.root().join(rel);

    const GENERATIONS: usize = 400;
    // Every byte-string this test will ever write — anything the watcher
    // reports as "external" from this set came from us.
    let ours: std::collections::HashSet<String> = (0..=GENERATIONS)
        .map(|g| crate::vault::sha256_hex(format!("gen{g:03}\n").as_bytes()))
        .collect();

    let done = Arc::new(AtomicBool::new(false));
    let writer = {
        let (vault, done) = (vault.clone(), done.clone());
        std::thread::spawn(move || {
            let mut expected = crate::vault::sha256_hex(b"gen000\n");
            for g in 1..=GENERATIONS {
                let bytes = format!("gen{g:03}\n").into_bytes();
                match vault.write(rel, &bytes, Some(&expected)).unwrap() {
                    WriteOutcome::Ok { hash } => expected = hash,
                    other => panic!("nobody else is writing, got {other:?}"),
                }
            }
            done.store(true, Ordering::SeqCst);
        })
    };

    let mut last = HashMap::new();
    let mut leaked: Vec<String> = Vec::new();
    while !done.load(Ordering::SeqCst) {
        if let WatchDecision::External(hash) = classify(&self_writes, &mut last, &abs) {
            if ours.contains(&hash) {
                leaked.push(hash);
            }
        }
    }
    writer.join().unwrap();

    assert!(
        leaked.is_empty(),
        "{} of our own writes were classified as EXTERNAL changes — this is the \
         false conflict banner: the watcher can read \
         the renamed file before the self-write token is registered. Leaked \
         hashes: {:?}",
        leaked.len(),
        &leaked[..leaked.len().min(3)],
    );
}

/// The same window on the other write path that makes bytes visible: a binder
/// move or rename.
#[test]
fn a_rename_also_suppresses_its_own_event() {
    let (_dir, vault, self_writes) = new_vault();
    let mut last = HashMap::new();

    vault.write("a/x.fountain", b"# ACT ONE\n", None).unwrap();
    let src = vault.root().join("a/x.fountain");
    assert_eq!(classify(&self_writes, &mut last, &src), WatchDecision::SelfWrite);

    vault.rename("a/x.fountain", "b/moved.fountain").unwrap();
    let dst = vault.root().join("b/moved.fountain");
    assert_eq!(
        classify(&self_writes, &mut last, &dst),
        WatchDecision::SelfWrite,
        "a binder move was reported as an external change"
    );
}

/// A save's temp sibling exists for milliseconds and the watcher sees it.
/// Reporting it would mean a phantom external change on every single save,
/// which is exactly the false banner the suppression work went after.
#[test]
fn the_temp_sibling_of_a_write_is_ignored() {
    let (_dir, vault, self_writes) = new_vault();
    let mut last = HashMap::new();
    vault.write("Play.fountain", b"# ACT ONE\n", None).unwrap();

    let tmp = vault.root().join(".Play.fountain.beef1.tmp");
    std::fs::write(&tmp, b"in flight").unwrap();
    assert_eq!(
        classify(&self_writes, &mut last, &tmp),
        WatchDecision::Ignore,
        "an atomic write's temp sibling was reported"
    );
}

/// A provider conflict copy is surfaced under Changes, never as a script.
#[test]
fn a_dropbox_conflict_copy_is_recognized() {
    let (_dir, vault, self_writes) = new_vault();
    let mut last = HashMap::new();
    let copy = vault
        .root()
        .join("Play (Robin\u{2019}s conflicted copy 2026-07-18).fountain");
    std::fs::write(&copy, b"theirs").unwrap();
    assert_eq!(
        classify(&self_writes, &mut last, &copy),
        WatchDecision::ConflictCopy
    );
}

/// A genuine outside edit must still come through — the suppression fix must
/// not blind the watcher (that would break the whole safety floor).
#[test]
fn a_genuine_external_edit_is_still_reported() {
    let (_dir, vault, self_writes) = new_vault();
    let mut last = HashMap::new();
    let rel = "script/play.fountain";
    vault.write(rel, b"ours\n", None).unwrap();
    let abs = vault.root().join(rel);
    assert_eq!(classify(&self_writes, &mut last, &abs), WatchDecision::SelfWrite);

    // Syncthing (or another editor) writes the file directly.
    std::fs::write(&abs, b"theirs\n").unwrap();
    let decision = classify(&self_writes, &mut last, &abs);
    assert_eq!(decision, WatchDecision::External(crate::vault::sha256_hex(b"theirs\n")));

    // notify commonly fires twice for one save; the second is coalesced.
    assert_eq!(classify(&self_writes, &mut last, &abs), WatchDecision::Duplicate);
}

/// A stale token must never suppress a later genuine edit that happens to
/// arrive while the token is still live (tokens are single-use per hash).
#[test]
fn a_self_write_token_suppresses_exactly_one_event() {
    let (_dir, vault, self_writes) = new_vault();
    let mut last = HashMap::new();
    let rel = "x.fountain";
    vault.write(rel, b"ours\n", None).unwrap();
    let abs = vault.root().join(rel);

    assert_eq!(classify(&self_writes, &mut last, &abs), WatchDecision::SelfWrite);
    // A second event for the SAME bytes has no token left; it coalesces on
    // content instead (last_emitted was primed by the suppression).
    assert_eq!(classify(&self_writes, &mut last, &abs), WatchDecision::Duplicate);
}

/// Our own temp siblings and a provider's bookkeeping never reach the
/// frontend; conflict copies do (as their own event, never as an external
/// change).
#[test]
fn temp_siblings_and_sync_artifacts_are_classified_correctly() {
    let (_dir, vault, self_writes) = new_vault();
    let mut last = HashMap::new();
    let root = vault.root();

    // There is no `.proscenium/` directory any more (docs/app/keeping-work/storage-and-file-format.md#STOR-D3, docs/app/keeping-work/storage-and-file-format.md#STOR-111); the
    // in-flight file of an atomic write is a hidden sibling instead.
    std::fs::write(root.join(".play.fountain.7f2a.tmp"), b"x").unwrap();
    assert_eq!(
        classify(&self_writes, &mut last, &root.join(".play.fountain.7f2a.tmp")),
        WatchDecision::Ignore,
    );

    let conflict = root.join("play.sync-conflict-20260720-120000-ABCDEFG.fountain");
    std::fs::write(&conflict, b"theirs").unwrap();
    assert_eq!(classify(&self_writes, &mut last, &conflict), WatchDecision::ConflictCopy);

    std::fs::create_dir_all(root.join(".stfolder")).unwrap();
    std::fs::write(root.join(".stfolder/marker"), b"x").unwrap();
    assert_eq!(
        classify(&self_writes, &mut last, &root.join(".stfolder/marker")),
        WatchDecision::Ignore,
    );
}

/// A deleted file is reported with a null hash and clears its coalescing entry.
#[test]
fn removal_is_reported_and_resets_coalescing() {
    let (_dir, vault, self_writes) = new_vault();
    let mut last = HashMap::new();
    let rel = "x.fountain";
    vault.write(rel, b"ours\n", None).unwrap();
    let abs = vault.root().join(rel);
    assert_eq!(classify(&self_writes, &mut last, &abs), WatchDecision::SelfWrite);

    std::fs::remove_file(&abs).unwrap();
    assert_eq!(classify(&self_writes, &mut last, &abs), WatchDecision::Removed);
    assert!(!last.contains_key(&abs), "removal must clear the coalescing entry");

    // The same content coming back is a real change, not a coalesced dup.
    std::fs::write(&abs, b"ours\n").unwrap();
    assert!(matches!(
        classify(&self_writes, &mut last, &abs),
        WatchDecision::External(_)
    ));
}
