// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! App-data store and version-ring tests (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).

use super::*;

fn new_store() -> (tempfile::TempDir, PlayStore) {
    let dir = tempfile::tempdir().unwrap();
    let store = PlayStore::at(dir.path().join("plays").join("01J9PLAY"));
    (dir, store)
}

#[test]
fn writes_and_reads_back_creating_parents() {
    let (_dir, store) = new_store();
    assert!(!store.exists("changes/baseline/x"));
    store.write("changes/baseline/x", b"before").unwrap();
    assert!(store.exists("changes/baseline/x"));
    assert_eq!(store.read("changes/baseline/x").unwrap(), b"before");
    store.remove("changes/baseline/x").unwrap();
    assert!(!store.exists("changes/baseline/x"));
    // Removing what is not there is an ordinary answer, not an error: the
    // caller is clearing state it may never have written.
    store.remove("changes/baseline/x").unwrap();
}

#[test]
fn path_traversal_is_rejected() {
    let (_dir, store) = new_store();
    assert!(store.read("../../etc/passwd").is_err());
    assert!(store.write("../escape", b"x").is_err());
    assert!(!store.exists("../../somewhere"));
}

#[test]
fn an_atomic_write_leaves_no_temp_behind() {
    let (_dir, store) = new_store();
    store.write("cache/scenes.json", b"{}").unwrap();
    let left: Vec<String> = store
        .list("cache")
        .unwrap()
        .into_iter()
        .filter(|n| n.ends_with(".tmp"))
        .collect();
    assert!(left.is_empty(), "temp file left behind: {left:?}");
}

#[test]
fn version_snapshot_stores_lists_and_reads_back() {
    let (_dir, store) = new_store();
    let id = "01J9ZA1F2G3H4J5K6L7M8N9P0Q";
    let name = store
        .version_snapshot(id, "save", b"v1", "fountain")
        .unwrap();
    assert!(name.ends_with("-save.fountain"));

    let entries = store.version_entries(id).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].reason, "save");
    assert!(!entries[0].pinned);
    assert_eq!(store.version_read(id, &entries[0].name).unwrap(), b"v1");

    // In app data, keyed by play id — never inside the play folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
    assert!(store.root().join("versions").join(id).join(&name).is_file());
}

#[test]
fn versions_dedup_identical_content_and_order_newest_first() {
    let (_dir, store) = new_store();
    let id = "script-a";
    let first = store
        .version_snapshot(id, "save", b"v1", "fountain")
        .unwrap();
    // Identical bytes → deduped to the same entry, no new file.
    let again = store
        .version_snapshot(id, "pre-reload", b"v1", "fountain")
        .unwrap();
    assert_eq!(first, again);
    assert_eq!(store.version_entries(id).unwrap().len(), 1);

    let second = store
        .version_snapshot(id, "save", b"v2", "fountain")
        .unwrap();
    let entries = store.version_entries(id).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].name, second);
    assert_eq!(store.version_read(id, &entries[0].name).unwrap(), b"v2");
    assert_eq!(store.version_read(id, &entries[1].name).unwrap(), b"v1");
}

#[test]
fn identical_words_that_must_be_kept_are_never_deduped_into_a_prunable_entry() {
    // A save lands, then the same words are pinned — a banner's collision, a
    // crash's recovery. Deduping into the save would hand back a name the ring
    // is free to prune, while the caller deletes the recovery snapshot believing
    // the words are pinned.
    let (_dir, store) = new_store();
    let id = "script-kept";
    let save = store
        .version_snapshot(id, "save", b"the words", "fountain")
        .unwrap();
    let kept = store
        .version_snapshot(id, "recovery", b"the words", "fountain")
        .unwrap();
    assert_ne!(save, kept);
    let entries = store.version_entries(id).unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().find(|e| e.name == kept).unwrap().pinned);

    // Pinned already: another pin of the same words adds nothing.
    let again = store
        .version_snapshot(id, "collision", b"the words", "fountain")
        .unwrap();
    assert_eq!(again, kept);
    assert_eq!(store.version_entries(id).unwrap().len(), 2);
}

#[test]
fn a_pinned_version_is_never_pruned() {
    // docs/app/keeping-work/storage-and-file-format.md#STOR-105 says both sides of a collision are kept. Since 1.0 the app writes no
    // conflict sibling into the play folder, so the pinned version IS the
    // surviving copy — letting a run of ordinary saves push it out of the ring
    // would break the invariant quietly, months later.
    let (_dir, store) = new_store();
    let id = "script-pinned";
    let pinned = store
        .version_snapshot(
            id,
            "collision",
            b"the-bytes-that-could-not-land",
            "fountain",
        )
        .unwrap();
    assert!(store.version_entries(id).unwrap()[0].pinned);

    // Overflow the ring several times over with ordinary saves.
    for i in 0..(MAX_RING_FOR_TEST + 20) {
        store
            .version_snapshot(id, "save", format!("v{i}").as_bytes(), "fountain")
            .unwrap();
    }

    let entries = store.version_entries(id).unwrap();
    assert!(
        entries.iter().any(|e| e.name == pinned),
        "the pinned collision version was pruned away"
    );
    assert_eq!(
        store.version_read(id, &pinned).unwrap(),
        b"the-bytes-that-could-not-land"
    );
    // The ordinary ones are still bounded.
    let unpinned = entries.iter().filter(|e| !e.pinned).count();
    assert!(unpinned <= MAX_RING_FOR_TEST, "ring unbounded: {unpinned}");
}

/// Mirrors `versions::MAX_ENTRIES`. Kept local so the test states the number it
/// depends on rather than borrowing a private one.
const MAX_RING_FOR_TEST: usize = 300;

#[test]
fn versions_reject_hostile_input_loudly() {
    let (_dir, store) = new_store();
    assert!(store
        .version_snapshot("../escape", "save", b"x", "fountain")
        .is_err());
    assert!(store
        .version_snapshot("id-1", "Bad Reason!", b"x", "fountain")
        .is_err());
    assert!(store
        .version_snapshot("id-1", "save", b"x", "../f")
        .is_err());
    assert!(store.version_read("id-1", "../../settings.json").is_err());
    // Listing an untouched script is just empty.
    assert!(store.version_entries("id-1").unwrap().is_empty());
}

#[test]
fn versions_stamp_names_in_local_time_with_an_offset() {
    let (_dir, store) = new_store();
    let id = "script-local";
    let name = store
        .version_snapshot(id, "save", b"v1", "fountain")
        .unwrap();

    // ISO 8601 basic: the `T` is what tells a local stamp from the old UTC one.
    assert_eq!(name.as_bytes()[8], b'T', "expected a local stamp in {name}");
    let entries = store.version_entries(id).unwrap();
    assert_eq!(entries[0].reason, "save");

    let now = chrono::Local::now();
    assert!(name.starts_with(&now.format("%Y%m%d").to_string()));
    assert!(name[0..24].ends_with(&now.format("%z").to_string()));
    let parsed = chrono::DateTime::parse_from_rfc3339(&entries[0].ts).unwrap();
    assert!(
        (now.timestamp_millis() - parsed.timestamp_millis()).abs() < 5_000,
        "ts {} is not the instant the file names",
        entries[0].ts,
    );
}

#[test]
fn versions_still_read_the_utc_names_written_before_the_change() {
    // The 1.0 migration moves the ring across without renaming its files, so
    // every name a writer's vault already holds has to keep parsing.
    let (_dir, store) = new_store();
    let id = "script-mixed";
    store
        .write(
            &format!("versions/{id}/20260729-213028-520-pre-reload.fountain"),
            b"old",
        )
        .unwrap();

    let entries = store.version_entries(id).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].reason, "pre-reload");
    assert_eq!(entries[0].ts, "2026-07-29T21:30:28.520Z");
    assert_eq!(store.version_read(id, &entries[0].name).unwrap(), b"old");

    // A new local-stamped version is newer, and ordering is by instant — not
    // by name, where 'T' vs '-' at index 8 would decide it.
    let fresh = store
        .version_snapshot(id, "save", b"new", "fountain")
        .unwrap();
    let entries = store.version_entries(id).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].name, fresh);
    assert_eq!(entries[1].ts, "2026-07-29T21:30:28.520Z");
}

#[test]
fn versions_ignore_a_stamp_that_is_not_a_time() {
    let (_dir, store) = new_store();
    let id = "script-junk";
    // `valid_reason` is a charset rule, not a closed set — an unfamiliar but
    // well-formed reason is a legitimate entry, so the junk here is junk by
    // shape: no stamp, an impossible instant, an illegal reason.
    for junk in [
        "notes.txt",
        "20261345T997799.999-0500-save.fountain",
        "20260805T163040.387-0500-PRE_RELOAD.fountain",
    ] {
        store.write(&format!("versions/{id}/{junk}"), b"x").unwrap();
    }
    assert!(store.version_entries(id).unwrap().is_empty());
}

// --- recovery snapshots (docs/app/keeping-work/storage-and-file-format.md#STOR-D10, docs/app/keeping-work/storage-and-file-format.md#STOR-D13) ---------------------------------

const OWNER: &str = "01OWNER";

#[test]
fn sessions_keep_independent_files_and_only_abandoned_owners_are_listed() {
    let (_dir, store) = new_store();
    store.recovery_write(SCRIPT, "A", b"A UNSAVED").unwrap();
    store.recovery_write(SCRIPT, "B", b"B UNSAVED").unwrap();
    assert!(store.recovery_list(None).unwrap().is_empty());
    store.recovery_remove(SCRIPT, "B").unwrap();
    assert_eq!(
        store.recovery_read(SCRIPT, "A").unwrap().unwrap(),
        b"A UNSAVED"
    );
    store.recovery_release(SCRIPT, "A").unwrap();
    assert!(store.recovery_remove(SCRIPT, "A").is_err());
    let abandoned = store.recovery_list(Some(SCRIPT)).unwrap();
    assert_eq!(abandoned.len(), 1);
    assert_eq!(abandoned[0].owner, "A");
    assert_eq!(abandoned[0].content, "A UNSAVED");
    assert!(store
        .recovery_write(SCRIPT, "A", b"overwrite abandoned")
        .is_err());
    store.recovery_write(SCRIPT, "C", b"C UNSAVED").unwrap();
    store.recovery_remove(SCRIPT, "A").unwrap();
    assert_eq!(
        store.recovery_read(SCRIPT, "C").unwrap().unwrap(),
        b"C UNSAVED"
    );
}

#[test]
fn legacy_files_are_claimed_without_overwrite_and_live_os_locks_are_respected() {
    let (_dir, store) = new_store();
    store
        .write(&format!("recovery/{SCRIPT}.snapshot"), b"LEGACY WORDS")
        .unwrap();
    assert!(store.recovery_write(SCRIPT, "legacy", b"new").is_err());
    let lock = crate::vault::atomic_file::FileLock::try_at(
        &store
            .root()
            .join(format!("recovery-owners/{SCRIPT}/legacy.lock")),
    )
    .unwrap();
    assert!(store.recovery_list(None).unwrap().is_empty());
    drop(lock);
    let recovered = store.recovery_list(None).unwrap();
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].owner, "legacy");
    assert_eq!(recovered[0].content, "LEGACY WORDS");
    store.recovery_remove(SCRIPT, "legacy").unwrap();
    assert!(store.recovery_list(None).unwrap().is_empty());
}
const SCRIPT: &str = "01J9ZA1F2G3H4J5K6L7M8N9P0Q";

#[test]
fn a_recovery_snapshot_round_trips_under_the_plays_app_data() {
    let (dir, store) = new_store();
    assert_eq!(store.recovery_read(SCRIPT, OWNER).unwrap(), None);

    store
        .recovery_write(SCRIPT, OWNER, b"She opens the door and")
        .unwrap();
    assert_eq!(
        store.recovery_read(SCRIPT, OWNER).unwrap().as_deref(),
        Some(&b"She opens the door and"[..])
    );
    // Exactly where docs/app/keeping-work/storage-and-file-format.md#STOR-D10 puts it: the play's app data, keyed by script.
    let expected = dir
        .path()
        .join("plays/01J9PLAY/recovery")
        .join(format!("{SCRIPT}/{OWNER}.snapshot"));
    assert!(expected.is_file(), "snapshot not at {}", expected.display());
}

#[test]
fn a_second_snapshot_replaces_the_first_and_leaves_no_temp_behind() {
    let (_dir, store) = new_store();
    store.recovery_write(SCRIPT, OWNER, b"first").unwrap();
    store
        .recovery_write(SCRIPT, OWNER, b"second, longer than the first")
        .unwrap();
    assert_eq!(
        store.recovery_read(SCRIPT, OWNER).unwrap().as_deref(),
        Some(&b"second, longer than the first"[..])
    );
    let names = store.list(&format!("recovery/{SCRIPT}")).unwrap();
    assert_eq!(
        names,
        vec![format!("{OWNER}.snapshot")],
        "stray files: {names:?}"
    );
}

/// The property that makes a snapshot worth having: a write that fails partway
/// leaves the previous snapshot whole. Simulated by making the directory
/// refuse new files, so the temp file cannot be created.
#[cfg(unix)]
#[test]
fn a_failed_snapshot_write_leaves_the_previous_one_whole() {
    use std::os::unix::fs::PermissionsExt;

    let (_dir, store) = new_store();
    store
        .recovery_write(SCRIPT, OWNER, b"the words that must survive")
        .unwrap();
    let recovery = store.root().join("recovery").join(SCRIPT);
    let before = std::fs::metadata(&recovery).unwrap().permissions();
    std::fs::set_permissions(&recovery, std::fs::Permissions::from_mode(0o555)).unwrap();

    let failed = store.recovery_write(SCRIPT, OWNER, b"half of a newer");
    std::fs::set_permissions(&recovery, before).unwrap();

    assert!(failed.is_err(), "a read-only directory accepted a write");
    assert_eq!(
        store.recovery_read(SCRIPT, OWNER).unwrap().as_deref(),
        Some(&b"the words that must survive"[..])
    );
    assert_eq!(
        store.list("recovery").unwrap().len(),
        1,
        "a temp file was left behind"
    );
}

#[test]
fn removing_a_snapshot_is_idempotent() {
    let (_dir, store) = new_store();
    store.recovery_write(SCRIPT, OWNER, b"x").unwrap();
    store.recovery_remove(SCRIPT, OWNER).unwrap();
    assert_eq!(store.recovery_read(SCRIPT, OWNER).unwrap(), None);
    store.recovery_remove(SCRIPT, OWNER).unwrap();
}

#[test]
fn a_recovery_snapshot_refuses_an_id_that_could_name_another_path() {
    let (_dir, store) = new_store();
    for hostile in ["", "../escape", "a/b", "..", "x.snapshot/../../y"] {
        assert!(
            store.recovery_write(hostile, OWNER, b"x").is_err(),
            "accepted {hostile:?}"
        );
        assert!(
            store.recovery_read(hostile, OWNER).is_err(),
            "read {hostile:?}"
        );
        assert!(
            store.recovery_remove(hostile, OWNER).is_err(),
            "removed {hostile:?}"
        );
    }
}

/// Eight snapshots asked for in the same instant are eight
/// versions, not one name written eight times.
#[test]
fn concurrent_snapshots_never_share_a_name() {
    let dir = tempfile::tempdir().unwrap();
    let store = std::sync::Arc::new(PlayStore::at(dir.path().join("plays").join("01J9PLAY")));
    let handles: Vec<_> = (0..8)
        .map(|i| {
            let store = store.clone();
            std::thread::spawn(move || {
                store
                    .version_snapshot(
                        "01J9SCRIPT",
                        "collision",
                        format!("words {i}").as_bytes(),
                        "fountain",
                    )
                    .unwrap()
            })
        })
        .collect();
    let names: std::collections::HashSet<String> =
        handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(names.len(), 8, "{names:?}");
    assert_eq!(store.version_entries("01J9SCRIPT").unwrap().len(), 8);
}
