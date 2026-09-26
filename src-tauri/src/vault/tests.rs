// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Conflict safety-floor invariant tests (docs/app/keeping-work/storage-and-file-format.md#STOR-D9, docs/app/keeping-work/storage-and-file-format.md#STOR-105, docs/app/keeping-work/storage-and-file-format.md#STOR-106, docs/app/keeping-work/storage-and-file-format.md#STOR-111 + security).
//!
//! The dirty-gate invariant (docs/app/keeping-work/storage-and-file-format.md#STOR-104) and "unparseable file doesn't break open" (docs/app/keeping-work/storage-and-file-format.md#STOR-107)
//! live in the TS storage client and the Fountain engine respectively; here we
//! prove the *mechanism* the floor stands on: atomic writes through a temp
//! sibling, and a collision that writes nothing at all.

use super::*;
use std::sync::Arc;

fn new_vault() -> (tempfile::TempDir, LocalFsVault) {
    let dir = tempfile::tempdir().unwrap();
    let vault = LocalFsVault::open(
        dir.path().to_path_buf(),
        Arc::new(SelfWrites::default()),
        None,
    )
    .unwrap();
    (dir, vault)
}

#[test]
fn imported_binary_original_is_exact_and_create_only() {
    let (_dir, vault) = new_vault();
    let original = [0, 255, 128, 13, 10, 80, 75];
    let path = "Imported/Originals/Draft.docx";
    assert!(matches!(vault.write(path, &original, Some("")).unwrap(), WriteOutcome::Ok { .. }));
    assert_eq!(vault.read(path).unwrap(), original);
    assert!(matches!(vault.write(path, b"replacement", Some("")).unwrap(), WriteOutcome::Collision { .. }));
    assert_eq!(vault.read(path).unwrap(), original);
    assert!(vault.write("../outside.docx", &original, Some("")).is_err());
}

/// Transplanted from the review's native reproduction: the other writer waits
/// for the real temp file, after the original hash check, then changes the file.
#[test]
fn a2_01_an_external_edit_after_the_hash_check_is_never_discarded() {
    let (dir, vault) = new_vault();
    std::fs::write(dir.path().join("race.fountain"), b"BASE").unwrap();
    let root = dir.path().to_path_buf();
    let other = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if std::fs::read_dir(&root).unwrap().flatten().any(|entry|
                entry.file_name().to_string_lossy().starts_with(".race.fountain.")) {
                std::fs::write(root.join("race.fountain"), b"EXTERNAL WORDS").unwrap();
                return;
            }
            std::thread::yield_now();
        }
        panic!("the production writer never created its temporary file");
    });
    let out = vault.write("race.fountain", &vec![b'L'; 32 * 1024 * 1024], Some(&sha256_hex(b"BASE"))).unwrap();
    other.join().unwrap();
    assert!(matches!(out, WriteOutcome::Collision { .. }));
    assert_eq!(std::fs::read(dir.path().join("race.fountain")).unwrap(), b"EXTERNAL WORDS");
    let copies = vault.saved_copies().unwrap();
    assert_eq!(copies.len(), 1);
    assert_eq!(vault.read_saved_copy(&copies[0].id).unwrap(), b"EXTERNAL WORDS");
}

#[test]
fn a2_09_a_missing_expected_file_conflicts_instead_of_reappearing() {
    let (dir, vault) = new_vault();
    let WriteOutcome::Ok { hash } = vault.write("A.fountain", b"before", None).unwrap() else { panic!() };
    std::fs::remove_file(dir.path().join("A.fountain")).unwrap();
    assert!(matches!(vault.write("A.fountain", b"later", Some(&hash)).unwrap(), WriteOutcome::Collision { .. }));
    assert!(!dir.path().join("A.fountain").exists());
}

#[test]
fn a2_09_icloud_stub_is_unavailable_and_cannot_be_overwritten_as_absent() {
    let (dir, vault) = new_vault();
    std::fs::write(dir.path().join(".A.fountain.icloud"), b"provider stub").unwrap();
    assert!(vault.exists("A.fountain"));
    let err = vault.read("A.fountain").unwrap_err();
    assert_ne!(err.kind(), std::io::ErrorKind::NotFound);
    assert!(vault.write("A.fountain", b"stale", Some("old hash")).is_err());
    assert!(vault.write("A.fountain", b"new", Some("")).is_err());
    assert!(!dir.path().join("A.fountain").exists());
}

#[test]
fn a2_09_a_different_directory_at_the_old_root_never_receives_the_buffer() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("Play");
    std::fs::create_dir(&root).unwrap();
    let vault = LocalFsVault::open(root.clone(), Arc::new(SelfWrites::default()), None).unwrap();
    std::fs::rename(&root, base.path().join("Moved")).unwrap();
    std::fs::create_dir(&root).unwrap();
    assert!(vault.write("A.fountain", b"UNIQUE WORDS", None).is_err());
    assert!(!root.join("A.fountain").exists());
}

/// Every file under `root`, relative and forward-slashed. Used by the tests
/// that assert the app wrote NOTHING beyond what they asked for (docs/app/keeping-work/storage-and-file-format.md#STOR-111).
fn all_files(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(root, &p, out);
            } else {
                out.push(
                    p.strip_prefix(root)
                        .unwrap_or(&p)
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
    }
    walk(root, root, &mut out);
    out.sort();
    out
}

#[test]
fn i3_atomic_write_lands_complete_with_no_temp_left() {
    let (_dir, vault) = new_vault();
    let out = vault.write("Scenes/play.fountain", b"# ACT ONE\n", None).unwrap();
    assert!(matches!(out, WriteOutcome::Ok { .. }));
    assert_eq!(vault.read("Scenes/play.fountain").unwrap(), b"# ACT ONE\n");

    // docs/app/keeping-work/storage-and-file-format.md#STOR-111: the play folder holds the file the caller asked for, and nothing
    // else. No `.proscenium/`, no temp directory, no leftover temp sibling.
    assert_eq!(all_files(vault.root()), vec!["Scenes/play.fountain"]);
    assert!(
        !vault.root().join(".proscenium").exists(),
        "the app scaffolded a hidden directory"
    );
}

#[test]
fn i3_the_temp_sibling_lives_in_the_targets_own_directory() {
    // Rename is atomic only within one filesystem, and a chosen Plays folder
    // may be on a different volume from anywhere else we could put a temp
    // file. The sibling is also the ONLY dot-prefixed thing the app creates in
    // a play, which is why its shape has to match `is_temp_sibling`.
    let (_dir, vault) = new_vault();
    let deep = vault.root().join("Notes");
    std::fs::create_dir_all(&deep).unwrap();

    // Hold the directory open across a write by watching what lands in it.
    vault.write("Notes/a.md", b"one", None).unwrap();
    vault.write("Notes/a.md", b"two", None).unwrap();
    assert_eq!(all_files(vault.root()), vec!["Notes/a.md"]);

    // And the pattern the watcher/reconciler filter on is the one we produce.
    let token = tmp_token();
    assert!(is_temp_sibling(&format!(".a.md.{token}.tmp")));
}

#[test]
fn i3_write_overwrites_a_matching_file_in_place() {
    let (_dir, vault) = new_vault();
    let first = vault.write("a.txt", b"one", None).unwrap();
    let WriteOutcome::Ok { hash } = first else {
        panic!("expected Ok")
    };
    // We pass the hash we believe is on disk; nothing changed, so it lands.
    let out = vault.write("a.txt", b"two", Some(&hash)).unwrap();
    assert!(matches!(out, WriteOutcome::Ok { .. }));
    assert_eq!(vault.read("a.txt").unwrap(), b"two");
}

#[test]
fn i2_a_collision_writes_nothing_and_reports_disk_truth() {
    // Before 1.0 our bytes went to `<name>.proscenium-conflict-<ts>.<ext>` next
    // to the play; ten of those sat in one folder from a single night in July.
    // Now the write is refused and the CALLER pins a version (docs/app/keeping-work/storage-and-file-format.md#STOR-D9), so
    // both sides still survive — one on disk, one in app data — and the play
    // folder stays the writer's.
    let (_dir, vault) = new_vault();
    let WriteOutcome::Ok { hash: expected } =
        vault.write("a.txt", b"ours-base", None).unwrap()
    else {
        panic!("expected Ok")
    };

    // Simulate an external edit that changed the file underneath us.
    std::fs::write(vault.root().join("a.txt"), b"THEIRS").unwrap();

    let out = vault.write("a.txt", b"OURS-NEW", Some(&expected)).unwrap();
    let WriteOutcome::Collision { hash } = out else {
        panic!("expected Collision, got {out:?}")
    };

    // Their version is untouched, and it is the ONLY file in the folder.
    assert_eq!(vault.read("a.txt").unwrap(), b"THEIRS");
    assert_eq!(hash, sha256_hex(b"THEIRS"), "Collision carries disk truth");
    assert_eq!(all_files(vault.root()), vec!["a.txt"]);

    // The caller can adopt disk truth and land the write deliberately.
    let out = vault.write("a.txt", b"OURS-NEW", Some(&hash)).unwrap();
    assert!(matches!(out, WriteOutcome::Ok { .. }));
    assert_eq!(vault.read("a.txt").unwrap(), b"OURS-NEW");
}

#[test]
fn a_rebasable_write_reports_stale_so_the_caller_can_rebuild() {
    // The play file has several legitimate writers: our own reconcile, a card
    // edit, another tool, any sync. On 2026-07-26 a stale expectation that
    // nothing ever refreshed produced 48 conflict copies in one sitting, one
    // per autosave tick. It reports disk truth and writes NOTHING.
    let (_dir, vault) = new_vault();
    let WriteOutcome::Ok { hash: expected } = vault
        .write_rebasable("Play.proscenium", b"ours-base", None)
        .unwrap()
    else {
        panic!("expected Ok")
    };

    std::fs::write(vault.root().join("Play.proscenium"), b"THEIRS").unwrap();

    let out = vault
        .write_rebasable("Play.proscenium", b"OURS-NEW", Some(&expected))
        .unwrap();
    let WriteOutcome::Stale { hash } = out else {
        panic!("expected Stale, got {out:?}")
    };

    assert_eq!(vault.read("Play.proscenium").unwrap(), b"THEIRS");
    assert_eq!(hash, sha256_hex(b"THEIRS"), "Stale carries disk truth");
    assert_eq!(all_files(vault.root()), vec!["Play.proscenium"]);

    // And the caller can rebase onto that hash and land the write.
    let out = vault
        .write_rebasable("Play.proscenium", b"OURS-REBASED", Some(&hash))
        .unwrap();
    assert!(matches!(out, WriteOutcome::Ok { .. }), "rebase should land");
    assert_eq!(vault.read("Play.proscenium").unwrap(), b"OURS-REBASED");
}

#[test]
fn i2_no_expected_hash_means_blind_overwrite_is_allowed() {
    // A first write (expected = None) is allowed to create/replace; the floor
    // only refuses when the caller asserts an expected hash that doesn't match.
    let (_dir, vault) = new_vault();
    vault.write("a.txt", b"x", None).unwrap();
    let out = vault.write("a.txt", b"y", None).unwrap();
    assert!(matches!(out, WriteOutcome::Ok { .. }));
    assert_eq!(vault.read("a.txt").unwrap(), b"y");
}

#[test]
fn an_expected_hash_no_content_has_writes_only_where_nothing_is() {
    // How the frontend creates a file that must not exist yet (ipc.ts
    // `vault.create`): a new play's script and play file, and the `.fdx` kept
    // beside them. A name that turned out to be taken — a folder
    // whose name differs only by Unicode form, say — is left exactly as it was.
    let (_dir, vault) = new_vault();
    let out = vault.write("Lear/Lear.fountain", b"new play", Some("")).unwrap();
    assert!(matches!(out, WriteOutcome::Ok { .. }), "nothing there: it lands");

    let out = vault.write("Lear/Lear.fountain", b"another new play", Some("")).unwrap();
    assert!(matches!(out, WriteOutcome::Collision { .. }), "got {out:?}");
    assert_eq!(vault.read("Lear/Lear.fountain").unwrap(), b"new play");
}

#[test]
fn self_write_token_is_recorded_and_consumed_once() {
    let (_dir, vault) = new_vault();
    let WriteOutcome::Ok { hash } = vault.write("a.txt", b"hello", None).unwrap() else {
        panic!()
    };
    let abs = vault.root().join("a.txt");
    // The watcher would see exactly this (path, hash) echo and drop it.
    assert!(vault.self_writes.is_self_write(&abs, &hash));
    // Consumed — a second identical event would NOT be suppressed.
    assert!(!vault.self_writes.is_self_write(&abs, &hash));
}

#[test]
fn path_traversal_is_rejected() {
    let (_dir, vault) = new_vault();
    assert!(vault.read("../etc/passwd").is_err());
    assert!(vault.write("../escape.txt", b"x", None).is_err());
    assert!(!vault.exists("../../somewhere"));
}

#[test]
fn milestone_external_edit_handled_safely_on_real_script() {
    // The end-to-end safety-floor flow, exercised on the real sample script
    // bytes through the vault's public API.
    let (_dir, vault) = new_vault();
    let rel = "The Weight of Water.fountain";
    let original = std::fs::read(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../sample-vault/The Weight of Water/The Weight of Water.fountain"
    ))
    .expect("sample script readable");

    // Open: the script is on disk; the app reads it (lastKnownHash = opened).
    let WriteOutcome::Ok { hash: opened } = vault.write(rel, &original, None).unwrap() else {
        panic!("expected Ok")
    };

    // Draft + autosave: edit lands in place because nothing changed under us.
    let edited = [&original[..], b"\nA new line of action.\n"].concat();
    let WriteOutcome::Ok { hash: saved } = vault.write(rel, &edited, Some(&opened)).unwrap()
    else {
        panic!("expected Ok")
    };
    assert_eq!(vault.read(rel).unwrap(), edited);

    // An external edit changes the file underneath us.
    let theirs = [&original[..], b"\nTheir external change.\n"].concat();
    std::fs::write(vault.root().join(rel), &theirs).unwrap();

    // We keep editing and autosave, still believing `saved` is on disk. The
    // write is refused; their version survives untouched, and ours is still in
    // the caller's hands to pin as a version.
    let mine = [&edited[..], b"and more of mine.\n"].concat();
    let WriteOutcome::Collision { hash: theirs_hash } =
        vault.write(rel, &mine, Some(&saved)).unwrap()
    else {
        panic!("expected Collision")
    };
    assert_eq!(vault.read(rel).unwrap(), theirs, "their version survived");
    assert_eq!(all_files(vault.root()), vec![rel], "the folder stayed clean");

    // "Keep this" resolution: the caller pins a version of theirs (app data,
    // tested in store::tests) and promotes ours against disk truth.
    assert_eq!(theirs_hash, sha256_hex(&theirs));
    let WriteOutcome::Ok { .. } = vault.write(rel, &mine, Some(&theirs_hash)).unwrap() else {
        panic!("promotion should land")
    };
    assert_eq!(vault.read(rel).unwrap(), mine, "mine is now canonical");
}

#[test]
fn rename_relocates_atomically_and_suppresses_echo() {
    let (_dir, vault) = new_vault();
    let WriteOutcome::Ok { hash } = vault.write("a/x.fountain", b"# ACT ONE\n", None).unwrap()
    else {
        panic!()
    };
    vault.rename("a/x.fountain", "b/renamed.fountain").unwrap();
    assert!(!vault.exists("a/x.fountain"));
    assert_eq!(vault.read("b/renamed.fountain").unwrap(), b"# ACT ONE\n");
    // The relocated bytes are unchanged → the watcher echo is suppressed.
    let abs = vault.root().join("b/renamed.fountain");
    assert!(vault.self_writes.is_self_write(&abs, &hash));
}

#[test]
fn a_case_only_rename_changes_the_name_on_disk() {
    // "charlie" → "Charlie": one file twice over on a Mac volume (docs/app/keeping-work/storage-and-file-format.md#STOR-D4).
    let (_dir, vault) = new_vault();
    let WriteOutcome::Ok { hash } = vault.write("Characters/charlie.md", b"# CHARLIE\n", None).unwrap()
    else {
        panic!()
    };
    vault.rename("Characters/charlie.md", "Characters/Charlie.md").unwrap();
    // What the directory lists is what Finder and the binder show — and the
    // temporary name it went through is gone.
    assert_eq!(all_files(vault.root()), vec!["Characters/Charlie.md"]);
    assert_eq!(vault.read("Characters/Charlie.md").unwrap(), b"# CHARLIE\n");
    let abs = vault.root().join("Characters/Charlie.md");
    assert!(vault.self_writes.is_self_write(&abs, &hash));
}

#[test]
fn a_case_only_rename_carries_a_folder_and_its_subtree() {
    let (_dir, vault) = new_vault();
    vault.write("characters/Mara.md", b"# MARA\n", None).unwrap();
    vault.rename("characters", "Characters").unwrap();
    assert_eq!(all_files(vault.root()), vec!["Characters/Mara.md"]);
    let dirs: Vec<String> = std::fs::read_dir(vault.root())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(dirs, vec!["Characters"]);
}

#[test]
fn list_flags_provider_artifacts_and_sorts() {
    let (_dir, vault) = new_vault();
    vault.write("b.fountain", b"b", None).unwrap();
    vault.write("a.fountain", b"a", None).unwrap();
    std::fs::write(
        vault.root().join("a.sync-conflict-20260618-120000-ABCDEFG.fountain"),
        b"theirs",
    )
    .unwrap();
    std::fs::write(
        vault
            .root()
            .join("a (Robin's conflicted copy 2026-07-18).fountain"),
        b"theirs too",
    )
    .unwrap();

    let entries = vault.list(".").unwrap();
    let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names.first(), Some(&"a (Robin's conflicted copy 2026-07-18).fountain"));
    for marked in [
        "a.sync-conflict-20260618-120000-ABCDEFG.fountain",
        "a (Robin's conflicted copy 2026-07-18).fountain",
    ] {
        let e = entries.iter().find(|e| e.name == marked).unwrap();
        assert!(e.is_sync_artifact, "{marked} was not recognized");
    }
    // A file the writer made themselves is never swallowed.
    let ordinary = entries.iter().find(|e| e.name == "a.fountain").unwrap();
    assert!(!ordinary.is_sync_artifact);
}

#[test]
fn a_temp_sibling_is_never_listed() {
    // It exists for milliseconds, but a `list` inside that window would flicker
    // a phantom row into the binder mid-save.
    let (_dir, vault) = new_vault();
    vault.write("a.fountain", b"a", None).unwrap();
    std::fs::write(vault.root().join(".a.fountain.beef1.tmp"), b"in flight").unwrap();

    let names: Vec<String> = vault.list(".").unwrap().into_iter().map(|e| e.name).collect();
    assert_eq!(names, vec!["a.fountain"], "temp sibling leaked: {names:?}");
}

#[test]
fn an_evicted_icloud_file_lists_under_its_real_name() {
    // The failure this guards against: a synced folder on a fresh iPad listing
    // as hidden junk with every real play "missing", which docs/app/keeping-work/storage-and-file-format.md#STOR-D8 reconciliation
    // would then report to the writer as lost work.
    let (_dir, vault) = new_vault();
    vault.write("here.fountain", b"local", None).unwrap();
    // iCloud took the bytes and left a stub in their place.
    std::fs::write(vault.root().join(".evicted.fountain.icloud"), b"").unwrap();

    let entries = vault.list(".").unwrap();
    let names: Vec<_> = entries.iter().map(|e| e.name.as_str()).collect();

    assert!(names.contains(&"evicted.fountain"), "evicted play vanished: {names:?}");
    assert!(names.contains(&"here.fountain"));
    // The stub itself is never a binder item.
    assert!(
        !names.iter().any(|n| n.ends_with(".icloud")),
        "the stub leaked into the binder: {names:?}"
    );

    let evicted = entries.iter().find(|e| e.name == "evicted.fountain").unwrap();
    assert!(!evicted.is_dir);
    assert_eq!(evicted.rel_path, "evicted.fountain");
}

#[test]
fn a_landing_download_is_not_reported_twice() {
    // Both forms coexist for the moment a download completes. Listing the file
    // twice would put a duplicate document in the binder.
    let (_dir, vault) = new_vault();
    vault.write("landing.fountain", b"arrived", None).unwrap();
    std::fs::write(vault.root().join(".landing.fountain.icloud"), b"").unwrap();

    let entries = vault.list(".").unwrap();
    let hits = entries.iter().filter(|e| e.name == "landing.fountain").count();
    assert_eq!(hits, 1, "duplicate entry while a download was landing");
}

#[test]
fn two_writes_expecting_the_same_hash_never_both_land() {
    // The check and the rename used to run unlocked, a write-and-fsync apart:
    // two writers holding the same expected hash (the app's own play-file
    // commits, a sheet and the appearances sync) could both be told "ok", and
    // the later rename silently replaced the earlier one's bytes. One of the
    // two must be told the file changed under it.
    let (_dir, vault) = new_vault();
    let vault = Arc::new(vault);
    for round in 0..60 {
        let WriteOutcome::Ok { hash: base } =
            vault.write("race.txt", format!("base {round}").as_bytes(), None).unwrap()
        else {
            panic!("expected Ok")
        };
        let gate = Arc::new(std::sync::Barrier::new(2));
        let writers: Vec<_> = ["left", "right"]
            .into_iter()
            .map(|who| {
                let (vault, gate, base) = (vault.clone(), gate.clone(), base.clone());
                std::thread::spawn(move || {
                    gate.wait();
                    vault.write("race.txt", format!("{who} {round}").as_bytes(), Some(&base)).unwrap()
                })
            })
            .collect();
        let landed = writers
            .into_iter()
            .map(|w| w.join().unwrap())
            .filter(|out| matches!(out, WriteOutcome::Ok { .. }))
            .count();
        assert_eq!(landed, 1, "round {round}: {landed} writes landed on one expected hash");
    }
}

/// Finder's Locked on `path` while the guard lives. Taken off again on drop, so
/// a failed assertion still leaves a temp directory that can be removed.
#[cfg(target_os = "macos")]
struct LockedInFinder(std::path::PathBuf);

#[cfg(target_os = "macos")]
impl LockedInFinder {
    fn new(path: std::path::PathBuf) -> Self {
        let status = std::process::Command::new("chflags").arg("uchg").arg(&path).status().unwrap();
        assert!(status.success(), "chflags uchg {}", path.display());
        LockedInFinder(path)
    }
}

#[cfg(target_os = "macos")]
impl Drop for LockedInFinder {
    fn drop(&mut self) {
        let _ = std::process::Command::new("chflags").arg("nouchg").arg(&self.0).status();
    }
}

#[cfg(target_os = "macos")]
#[test]
fn a_script_locked_in_finder_is_refused_as_locked_and_left_alone() {
    // Seen 2026-09-13 in the installed app: a locked script's autosave reached
    // the writer as "Operation not permitted (os error 1)", which is also what
    // a privacy refusal says. The vault names the lock, keeps the OS's words
    // behind it, and changes nothing on disk.
    let (_dir, vault) = new_vault();
    let WriteOutcome::Ok { hash } = vault.write("Hamlet.fountain", b"theirs", None).unwrap() else {
        panic!("expected Ok")
    };
    let _lock = LockedInFinder::new(vault.root().join("Hamlet.fountain"));
    let err = vault.write("Hamlet.fountain", b"ours", Some(&hash)).unwrap_err();
    assert_eq!(err.to_string(), "locked: Operation not permitted (os error 1)");
    assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
    assert_eq!(vault.read("Hamlet.fountain").unwrap(), b"theirs");
    assert_eq!(all_files(vault.root()), vec!["Hamlet.fountain"], "a temp sibling was left behind");
}

#[cfg(target_os = "macos")]
#[test]
fn a_folder_locked_in_finder_is_refused_as_the_folder_locked() {
    let (_dir, vault) = new_vault();
    vault.write("Characters/Mara.md", b"theirs", None).unwrap();
    let _lock = LockedInFinder::new(vault.root().join("Characters"));
    let err = vault.write("Characters/Mara.md", b"ours", None).unwrap_err();
    assert_eq!(err.to_string(), "folder-locked: Operation not permitted (os error 1)");
    assert_eq!(vault.read("Characters/Mara.md").unwrap(), b"theirs");
}

#[cfg(target_os = "macos")]
#[test]
fn a_folder_nobody_may_change_is_refused_in_the_os_words_alone() {
    // EACCES is a folder that is not the writer's to change, not a lock; the
    // vault adds nothing it did not see.
    use std::os::unix::fs::PermissionsExt;
    let (_dir, vault) = new_vault();
    vault.write("Drafts/one.md", b"theirs", None).unwrap();
    let drafts = vault.root().join("Drafts");
    std::fs::set_permissions(&drafts, std::fs::Permissions::from_mode(0o555)).unwrap();
    // Run as root, the folder takes the file anyway, and there is nothing to see.
    let unwritable = std::fs::File::create(drafts.join("probe")).is_err();
    let result = vault.write("Drafts/one.md", b"ours", None);
    std::fs::set_permissions(&drafts, std::fs::Permissions::from_mode(0o755)).unwrap();
    if unwritable {
        assert_eq!(result.unwrap_err().to_string(), "Permission denied (os error 13)");
    }
}

#[test]
fn a_write_never_makes_again_the_folder_its_vault_was() {
    // The play's folder went away while it was open: moved in Finder, or on a
    // drive that was disconnected. The atomic writer used to make the folder
    // again and put the script in it, a copy of the play nobody would find.
    let dir = tempfile::tempdir().unwrap();
    let play = dir.path().join("Hamlet");
    std::fs::create_dir(&play).unwrap();
    let vault = LocalFsVault::open(play.clone(), Arc::new(SelfWrites::default()), None).unwrap();
    vault.write("Hamlet.fountain", b"first", None).unwrap();
    std::fs::rename(&play, dir.path().join("Hamlet (moved)")).unwrap();

    let err = vault.write("Hamlet.fountain", b"words", None).unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
    assert!(err.to_string().starts_with("folder-gone: "), "{err}");
    assert!(!play.exists(), "the write made the play's folder again");
    assert_eq!(
        std::fs::read(dir.path().join("Hamlet (moved)/Hamlet.fountain")).unwrap(),
        b"first"
    );
}

// --- findings of an outside code review ---------------------------------------------------

/// A name planted at the temp sibling — here a symlink to a file the
/// writer would never mean to touch — is not opened, so it is not truncated.
#[test]
fn a1_04_a_planted_temp_name_is_never_opened() {
    let (dir, _vault) = new_vault();
    let outside = tempfile::tempdir().unwrap();
    let victim = outside.path().join("private.txt");
    std::fs::write(&victim, b"the writer's other file").unwrap();
    let target = dir.path().join("draft.fountain");
    let tmp = dir.path().join(".draft.fountain.deadbeef.tmp");
    std::os::unix::fs::symlink(&victim, &tmp).unwrap();

    let err = write_atomic_via(&tmp, &target, b"new words").unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(std::fs::read(&victim).unwrap(), b"the writer's other file");
    assert!(std::fs::symlink_metadata(&tmp).unwrap().file_type().is_symlink(), "the planted link is not ours to remove");
    assert!(!target.exists());

    // The public writer just takes another token.
    write_atomic(&target, b"new words").unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"new words");
    assert_eq!(std::fs::read(&victim).unwrap(), b"the writer's other file");
}

/// A file the writer restricted to themselves stays restricted after a save.
#[test]
fn a1_09_a_save_keeps_the_files_permission_bits() {
    use std::os::unix::fs::PermissionsExt;
    let (dir, vault) = new_vault();
    let target = dir.path().join("private.md");
    std::fs::write(&target, b"before").unwrap();
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
    vault.write("private.md", b"after", None).unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), b"after");
    assert_eq!(std::fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o600);
}

/// A legal name at the filesystem's limit can still be saved — the temp
/// sibling does not repeat all of it.
#[test]
fn a2_22_a_name_at_the_length_limit_still_saves() {
    let (dir, vault) = new_vault();
    let name = format!("{}.md", "n".repeat(247));
    std::fs::write(dir.path().join(&name), b"read but never saved").unwrap();
    vault.write(&name, b"saved after all", None).unwrap();
    assert_eq!(std::fs::read(dir.path().join(&name)).unwrap(), b"saved after all");
    assert_eq!(all_files(dir.path()), vec![name]);
}

/// A symlink inside the play is refused in every
/// component, so nothing outside the chosen folder is read, written, renamed or
/// removed through it.
#[test]
fn a1_02_a_symlink_inside_the_play_is_not_followed() {
    let (dir, vault) = new_vault();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.md"), b"outside the play").unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("escape")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret.md"), dir.path().join("leaf.md")).unwrap();

    for rel in ["escape/secret.md", "leaf.md", "escape"] {
        let err = vault.read(rel).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied, "{rel}");
        assert!(vault.write(rel, b"x", None).is_err(), "{rel}");
        assert!(vault.rename(rel, "moved.md").is_err(), "{rel}");
        assert!(vault.rename("moved.md", rel).is_err(), "{rel}");
    }
    assert!(vault.mkdir("escape/new-folder").is_err());
    assert_eq!(std::fs::read(outside.path().join("secret.md")).unwrap(), b"outside the play");
    assert!(!outside.path().join("new-folder").exists());
    assert!(!outside.path().join("moved.md").exists());
}

/// A move never lands on a file that is already there.
#[test]
fn a2_02_a_rename_onto_an_occupied_name_moves_nothing() {
    let (dir, vault) = new_vault();
    std::fs::write(dir.path().join("a.md"), b"a's words").unwrap();
    std::fs::write(dir.path().join("b.md"), b"b's words").unwrap();
    let err = vault.rename("a.md", "b.md").unwrap_err();
    assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(std::fs::read(dir.path().join("a.md")).unwrap(), b"a's words");
    assert_eq!(std::fs::read(dir.path().join("b.md")).unwrap(), b"b's words");
    // The same file under another case is still allowed.
    vault.rename("a.md", "A.md").unwrap();
}

/// A provider-shaped name with a multi-byte character where the date
/// should be is not a conflict copy — and does not panic the watcher's thread.
#[test]
fn a2_17_a_conflict_name_with_multibyte_characters_does_not_panic() {
    assert!(!sync_names::is_conflict_copy("draft.sync-conflict-€€€€€€€€.fountain"));
    assert!(!sync_names::is_conflict_copy("draft (Robin's conflicted copy €€€€-€€-€€).md"));
    assert!(sync_names::is_conflict_copy("draft.sync-conflict-20260915-101010-ABCDEFG.fountain"));
}
#[test]
fn a220_aliases_share_self_write_generations_and_in_process_locks() {
    let writes = SelfWrites::default();
    let old = writes.record(Path::new("Notes/Café.md"), "old");
    writes.committed(&old);
    let new = writes.record(Path::new("NOTES/Cafe\u{301}.MD"), "new");
    writes.committed(&new);
    assert!(!writes.is_self_write(Path::new("notes/café.md"), "old"));
    assert!(writes.is_self_write(Path::new("Notes/Café.md"), "new"));
    assert!(Arc::ptr_eq(&write_lock(Path::new("Notes/Café.md")), &write_lock(Path::new("NOTES/Cafe\u{301}.MD"))));
}
