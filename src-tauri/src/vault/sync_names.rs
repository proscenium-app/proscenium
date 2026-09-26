// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Recognizing what a sync provider left behind (docs/app/keeping-work/storage-and-file-format.md#STOR-D11), plus our own
//! momentary temp files (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
//!
//! The app never syncs. It reads and writes a folder that something else syncs,
//! and it has to stay correct while that happens. Where a provider's naming is
//! documented and stable, its conflict copy is recognized as *another version
//! of X* and surfaced under Changes — never listed as a script, never opened as
//! the play's own file.
//!
//! Where it is not stable, the copy is indistinguishable from a file the writer
//! made, and pretending otherwise would hide real work. iCloud (`<name> 2`),
//! OneDrive (`<name>-<Device>`) and Google Drive (`<name> (1)`) therefore appear
//! as ordinary documents, which is honest.
//!
//! **This list is duplicated in `src/workspace/sync-names.ts` and the two must
//! agree.** If one side learns a pattern the other has not, a conflict copy
//! becomes a script in the binder.

/// Syncthing: `<name>.sync-conflict-YYYYMMDD-HHMMSS-<7 chars>.<ext>`.
fn is_syncthing_conflict(name: &str) -> bool {
    let Some(idx) = name.find(".sync-conflict-") else {
        return false;
    };
    let rest = &name[idx + ".sync-conflict-".len()..];
    let b = rest.as_bytes();
    // YYYYMMDD-HHMMSS-XXXXXXX. then an extension.
    if b.len() < 24 {
        return false;
    }
    // Bytes, not `&str` ranges: a name with a multi-byte character where the
    // date should be must read as "not a conflict copy", not panic the watcher
    // on a slice that is not a char boundary.
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    digits(0..8)
        && b[8] == b'-'
        && digits(9..15)
        && b[15] == b'-'
        && b[16..23].iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        && b[23] == b'.'
}

/// Dropbox: `<name> (<who>'s conflicted copy <date>).<ext>` — the English form.
/// A localized form is an ordinary file; guessing at translations would start
/// hiding files a writer named themselves.
fn is_dropbox_conflict(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let Some(idx) = lower.find("conflicted copy ") else {
        return false;
    };
    if !lower[..idx].contains(" (") {
        return false;
    }
    let rest = &lower[idx + "conflicted copy ".len()..];
    let b = rest.as_bytes();
    if b.len() < 11 {
        return false;
    }
    let digits = |r: std::ops::Range<usize>| b[r].iter().all(u8::is_ascii_digit);
    digits(0..4) && b[4] == b'-' && digits(5..7) && b[7] == b'-' && digits(8..10) && b[10] == b')'
}

/// True for a conflict copy whose provider names it unambiguously.
pub fn is_conflict_copy(name: &str) -> bool {
    is_syncthing_conflict(name) || is_dropbox_conflict(name)
}

/// Syncthing's own bookkeeping — never a binder item, never a conflict copy.
pub fn is_provider_artifact(name: &str) -> bool {
    matches!(name, ".stfolder" | ".stversions" | ".stignore")
        || (name.starts_with("~syncthing~") && name.ends_with(".tmp"))
}

/// The momentary temp sibling of an atomic write (docs/app/keeping-work/storage-and-file-format.md#STOR-D9):
/// `.<name>.<random>.tmp`, in the target's own directory, alive for
/// milliseconds. The watcher and the reconciler both ignore it — otherwise
/// every save would flicker a phantom binder row.
pub fn is_temp_sibling(name: &str) -> bool {
    if !name.starts_with('.') || !name.ends_with(".tmp") {
        return false;
    }
    // `.tmp` itself is a writer's file, not ours: there is no name in it.
    if name.len() <= 1 + ".tmp".len() {
        return false;
    }
    let inner = &name[1..name.len() - ".tmp".len()];
    // `<name>.<random>`: there must be a random segment, and a name before it.
    match inner.rfind('.') {
        Some(dot) if dot > 0 => {
            !inner[dot + 1..].is_empty()
                && inner[dot + 1..].bytes().all(|c| c.is_ascii_alphanumeric())
        }
        _ => false,
    }
}

/// Anything that is not a binder item and must never be offered as one.
pub fn is_sync_artifact(name: &str) -> bool {
    is_provider_artifact(name) || is_conflict_copy(name) || is_temp_sibling(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_syncthing() {
        assert!(is_conflict_copy(
            "script.sync-conflict-20260618-120000-ABCDEFG.fountain"
        ));
        assert!(is_provider_artifact(".stfolder"));
        assert!(is_provider_artifact(".stversions"));
        assert!(is_provider_artifact("~syncthing~script.fountain.tmp"));
        assert!(!is_conflict_copy("script.fountain"));
        // A near-miss must not be swallowed: it is a file the writer may have made.
        assert!(!is_conflict_copy("script.sync-conflict-2026-06-18.fountain"));
    }

    #[test]
    fn classifies_dropbox() {
        assert!(is_conflict_copy(
            "The Weight of Water (Robin's conflicted copy 2026-07-18).fountain"
        ));
        assert!(!is_conflict_copy("The Weight of Water (draft two).fountain"));
        // A localized form is deliberately an ordinary file.
        assert!(!is_conflict_copy(
            "The Weight of Water (copie en conflit 2026-07-18).fountain"
        ));
    }

    #[test]
    fn classifies_our_temp_sibling() {
        assert!(is_temp_sibling(".The Weight of Water.fountain.a1b2c3.tmp"));
        assert!(is_temp_sibling(".x.9.tmp"));
        // Not ours: a writer's own dotfile, and a plain .tmp.
        assert!(!is_temp_sibling(".DS_Store"));
        assert!(!is_temp_sibling("draft.tmp"));
        assert!(!is_temp_sibling(".tmp"));
    }
}
