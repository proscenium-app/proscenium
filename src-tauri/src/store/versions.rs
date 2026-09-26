// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Versions — the local ring of a script's earlier states (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
//!
//! A version is a **local convenience, not canon**: a copy of what the session
//! held, so a writer can pull back an earlier state. It lives in app data,
//! never in the play folder — a directory inside a synced tree is synced or not
//! at a provider's discretion, and the contract cannot depend on that either
//! way. Two devices each keep their own timeline by design; interleaving them
//! would resurrect deleted snapshots.
//!
//! Mechanism only (Rust stores bytes): *when* to snapshot is frontend policy
//! (`src/storage/history-policy.ts`), and the CONTENT comes from the frontend
//! session — the state worth preserving is what the session holds, which the
//! on-disk file no longer has once an external change lands.
//!
//! Atomic writes, identical-content dedup, a bounded ring, and reasons that are
//! never pruned.

use serde::Serialize;

use super::PlayStore;

/// Newest-first listing row.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    /// File name (`<yyyymmddTHHMMSS.mmm±HHMM>-<reason>.<ext>`).
    pub name: String,
    /// ISO-8601 with the offset the version was taken at.
    pub ts: String,
    /// Why it was taken (`save`, `collision`, `pre-keep`, …).
    pub reason: String,
    pub size: u64,
    /// True when the ring may never prune this one.
    pub pinned: bool,
}

/// Ring size per script. At tens of KB per play this caps a script's versions
/// around 15 MB — app-data scale.
const MAX_ENTRIES: usize = 300;

/// Reasons that survive pruning forever (docs/app/keeping-work/storage-and-file-format.md#STOR-D9, docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
///
/// Each one is the ONLY surviving copy of something: `collision` holds the
/// bytes a guarded write could not land, `pre-keep` the side the writer chose
/// to replace, `pre-reload-at-banner` the buffer they gave up at a banner, and
/// `recovery` the words a crash left in a recovery snapshot, which are kept
/// whether or not the writer takes them back. Pruning any of those turns "both
/// sides of a collision are kept" (docs/app/keeping-work/storage-and-file-format.md#STOR-105) into a promise with a shelf life. The
/// plain `pre-reload` — the automatic reload of a clean buffer — is not pinned:
/// nothing was at stake, because nothing was unsaved.
const PINNED_REASONS: &[&str] = &["collision", "pre-keep", "pre-reload-at-banner", "recovery"];

pub fn is_pinned(reason: &str) -> bool {
    PINNED_REASONS.contains(&reason)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn valid_reason(reason: &str) -> bool {
    !reason.is_empty()
        && reason.len() <= 24
        && reason
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Version names are stamped in the writer's OWN time, because the writer is
/// who reads them — in Finder, in a backup, over someone's shoulder. A file
/// made at half past four in the afternoon must not be called `230036`.
///
/// Two shapes exist and both must parse forever:
///
///  - local (current): `20260805T163040.387-0500` — ISO 8601 basic, `T` at
///    index 8, an explicit offset, so the instant survives DST and travel.
///  - UTC (before the 1.0 storage layout): `20260805-213040-387` — `-` at index 8, implicitly
///    Zulu. Versions taken before this changed still read correctly, and the
///    1.0 migration moves them across without renaming them.
///
/// The discriminator is that one character, which is why the local form uses
/// `T` rather than another dash.
const LOCAL_STAMP_LEN: usize = 24; // 20260805T163040.387-0500
const UTC_STAMP_LEN: usize = 19; // 20260805-213040-387

fn is_local_stamp(name: &str) -> bool {
    name.as_bytes().get(8) == Some(&b'T')
}

/// The stamp as ISO-8601 with its offset. None for foreign files.
fn ts_from_name(name: &str) -> Option<String> {
    if is_local_stamp(name) {
        let stamp = name.get(0..LOCAL_STAMP_LEN)?;
        // Round-trip through chrono so a malformed stamp is rejected here
        // rather than becoming an Invalid Date in the panel.
        let parsed = chrono::DateTime::parse_from_str(stamp, "%Y%m%dT%H%M%S%.3f%z").ok()?;
        return Some(parsed.to_rfc3339_opts(chrono::SecondsFormat::Millis, false));
    }
    let stamp = name.get(0..UTC_STAMP_LEN)?;
    let b = stamp.as_bytes();
    let digits = |r: std::ops::Range<usize>| {
        stamp
            .get(r)
            .filter(|s| s.bytes().all(|c| c.is_ascii_digit()))
    };
    if b.get(8) != Some(&b'-') || b.get(15) != Some(&b'-') {
        return None;
    }
    Some(format!(
        "{}-{}-{}T{}:{}:{}.{}Z",
        digits(0..4)?,
        digits(4..6)?,
        digits(6..8)?,
        digits(9..11)?,
        digits(11..13)?,
        digits(13..15)?,
        digits(16..19)?,
    ))
}

/// The instant a name encodes, for ordering. Unparseable names sort last.
fn instant_from_name(name: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let ts = ts_from_name(name)?;
    Some(
        chrono::DateTime::parse_from_rfc3339(&ts)
            .ok()?
            .with_timezone(&chrono::Utc),
    )
}

fn reason_from_name(name: &str) -> Option<String> {
    let stem = name.split('.').next()?;
    // The local stamp carries a `.mmm`, so its stem stops inside the stamp —
    // take the reason from the whole name in that case.
    let rest = if is_local_stamp(name) {
        name.get(LOCAL_STAMP_LEN + 1..)?.split('.').next()?
    } else {
        stem.get(UTC_STAMP_LEN + 1..)?
    };
    // A same-millisecond disambiguator (`-1`, `-2`) may trail the reason.
    let reason = rest
        .trim_end_matches(|c: char| c.is_ascii_digit())
        .trim_end_matches('-');
    if valid_reason(reason) {
        Some(reason.to_string())
    } else {
        None
    }
}

fn dir_for(script_id: &str) -> std::io::Result<String> {
    if !valid_id(script_id) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid script id",
        ));
    }
    Ok(format!("versions/{script_id}"))
}

impl PlayStore {
    /// Write `bytes` into the script's ring. Content comes from the frontend
    /// (not the file on disk) because the state worth preserving is what the
    /// SESSION holds — before an external reload the on-disk file is already
    /// "theirs", and only the buffer still has "ours". A version identical to
    /// the newest entry is deduped (its name returned).
    pub fn version_snapshot(
        &self,
        script_id: &str,
        reason: &str,
        bytes: &[u8],
        ext: &str,
    ) -> std::io::Result<String> {
        if !valid_reason(reason) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid version reason",
            ));
        }
        if ext.is_empty() || ext.len() > 12 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid version extension",
            ));
        }
        let dir = dir_for(script_id)?;

        // Dedup against the newest entry: restoring + immediately snapshotting
        // (or a pre-destructive version right after a save one) adds nothing.
        // Except where it would cost a pin: words that must be kept — a
        // collision, a crash's recovery — are not safe in an entry the ring may
        // prune, however identical, so they get a pinned entry of their own.
        if let Some(newest) = self
            .version_entries(script_id)?
            .first()
            .filter(|newest| newest.pinned || !is_pinned(reason))
        {
            if let Ok(existing) = self.read(&format!("{dir}/{}", newest.name)) {
                if crate::vault::sha256_hex(&existing) == crate::vault::sha256_hex(bytes) {
                    return Ok(newest.name.clone());
                }
            }
        }

        // One snapshot picks its name and lands at a time, process-wide:
        // two asked for in the same millisecond — autosave's and the
        // recovery check's — both found the same name free, and the second
        // replaced the first while both callers were told their copy was kept.
        static NAMING: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _naming = NAMING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Local time with an explicit offset (see `ts_from_name`): the name a
        // writer reads matches the clock they took it by.
        let stamp = chrono::Local::now()
            .format("%Y%m%dT%H%M%S%.3f%z")
            .to_string();
        let mut n = 0u32;
        let name = loop {
            let candidate = if n == 0 {
                format!("{stamp}-{reason}.{ext}")
            } else {
                format!("{stamp}-{reason}-{n}.{ext}")
            };
            if !self.exists(&format!("{dir}/{candidate}")) {
                break candidate;
            }
            n += 1;
        };
        self.write(&format!("{dir}/{name}"), bytes)?;
        self.version_prune(script_id)?;
        Ok(name)
    }

    /// All versions for a script, newest first. Foreign files are ignored.
    pub fn version_entries(&self, script_id: &str) -> std::io::Result<Vec<VersionEntry>> {
        let dir = dir_for(script_id)?;
        let mut entries = Vec::new();
        for name in self.list(&dir)? {
            let (Some(ts), Some(reason)) = (ts_from_name(&name), reason_from_name(&name)) else {
                continue;
            };
            let size = self
                .read(&format!("{dir}/{name}"))
                .map(|b| b.len() as u64)
                .unwrap_or(0);
            let pinned = is_pinned(&reason);
            entries.push(VersionEntry {
                name,
                ts,
                reason,
                size,
                pinned,
            });
        }
        // Newest first, ordered by the INSTANT each name encodes rather than by
        // the name itself: local stamps and the older UTC ones share a folder,
        // and an hour repeats every autumn. Ties keep name order so the
        // same-millisecond disambiguator (`-1`, `-2`) stays stable.
        entries.sort_by(|a, b| {
            instant_from_name(&b.name)
                .cmp(&instant_from_name(&a.name))
                .then_with(|| b.name.cmp(&a.name))
        });
        Ok(entries)
    }

    /// The bytes of one version.
    pub fn version_read(&self, script_id: &str, name: &str) -> std::io::Result<Vec<u8>> {
        if name.contains('/') || name.contains('\\') || name.starts_with('.') {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "invalid version name",
            ));
        }
        self.read(&format!("{}/{name}", dir_for(script_id)?))
    }

    /// Prune to the ring size, counting and removing only unpinned entries.
    ///
    /// A pinned version does not occupy a slot: it is the only copy of
    /// something, and letting a run of ordinary saves push it out would break
    /// docs/app/keeping-work/storage-and-file-format.md#STOR-105 quietly, months later, which is the worst way for it to break.
    fn version_prune(&self, script_id: &str) -> std::io::Result<()> {
        let dir = dir_for(script_id)?;
        let entries = self.version_entries(script_id)?;
        let prunable: Vec<&VersionEntry> = entries.iter().filter(|e| !e.pinned).collect();
        if prunable.len() <= MAX_ENTRIES {
            return Ok(());
        }
        for old in &prunable[MAX_ENTRIES..] {
            let _ = self.remove(&format!("{dir}/{}", old.name));
        }
        Ok(())
    }
}
