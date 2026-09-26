// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The error codes the app has shown, kept on this Mac (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D100
//! docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5): `error-codes.json` in app data, the newest [`KEPT`].
//!
//! It replaces the `conflict-repro.log` T2 removed, and holds far less: a code
//! and a time, never the sentence the writer read, which names plays and
//! folders. It is kept whatever the analytics switch says — it never leaves the
//! Mac unless the writer copies it out with Copy Diagnostics.
//!
//! The same error again within a minute adds to the last entry's count rather
//! than pushing out older entries, so a failure that repeats while the writer
//! works cannot erase the one that started it.

use std::fs;
use std::io;
use std::path::Path;
use std::sync::Mutex;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use super::events::ErrorCode;

pub const KEPT: usize = 50;
const SAME_ERROR_WITHIN: chrono::TimeDelta = chrono::TimeDelta::seconds(60);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub code: String,
    /// When it was last shown, to the second.
    pub at: String,
    #[serde(default = "one")]
    pub count: u32,
}

fn one() -> u32 {
    1
}

static WRITE: Mutex<()> = Mutex::new(());

/// The log, oldest first. Anything unreadable in it is left out.
pub fn read(path: &Path) -> Vec<Entry> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<Entry>>(&bytes).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|e| ErrorCode::parse(&e.code).is_some())
        .collect()
}

pub fn append(path: &Path, code: ErrorCode, at: DateTime<Utc>) -> io::Result<()> {
    let _guard = WRITE.lock().unwrap_or_else(|p| p.into_inner());
    let mut entries = read(path);
    let stamp = at.to_rfc3339_opts(SecondsFormat::Secs, true);
    let repeat = entries.last_mut().filter(|last| {
        last.code == code.as_str()
            && DateTime::parse_from_rfc3339(&last.at).is_ok_and(|t| at - t.with_timezone(&Utc) < SAME_ERROR_WITHIN)
    });
    match repeat {
        Some(last) => {
            last.count = last.count.saturating_add(1);
            last.at = stamp;
        }
        None => entries.push(Entry { code: code.as_str().to_string(), at: stamp, count: 1 }),
    }
    let excess = entries.len().saturating_sub(KEPT);
    entries.drain(..excess);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let bytes = serde_json::to_vec_pretty(&entries).map_err(io::Error::other)?;
    crate::store::write_atomic(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_log_keeps_codes_and_times_and_the_newest_fifty() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("error-codes.json");
        let start = DateTime::parse_from_rfc3339("2026-09-13T10:00:00Z").unwrap().with_timezone(&Utc);
        for i in 0..60 {
            let code = if i % 2 == 0 { ErrorCode::Save } else { ErrorCode::ExportPdf };
            append(&log, code, start + chrono::TimeDelta::minutes(i)).unwrap();
        }
        let entries = read(&log);
        assert_eq!(entries.len(), KEPT);
        assert_eq!(entries[0], Entry { code: "E-SAVE".into(), at: "2026-09-13T10:10:00Z".into(), count: 1 });
        assert_eq!(entries.last().unwrap().code, "E-EXPORT-PDF");
    }

    #[test]
    fn a_repeat_within_a_minute_is_counted_not_logged_again() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("error-codes.json");
        let start = Utc::now();
        append(&log, ErrorCode::FolderOpen, start).unwrap();
        for s in 1..=30 {
            append(&log, ErrorCode::Save, start + chrono::TimeDelta::seconds(s)).unwrap();
        }
        let entries = read(&log);
        assert_eq!(entries.len(), 2, "{entries:?}");
        assert_eq!(entries[1].count, 30);
        // A minute's quiet, and the same error is a new entry.
        append(&log, ErrorCode::Save, start + chrono::TimeDelta::seconds(200)).unwrap();
        assert_eq!(read(&log).len(), 3);
    }

    #[test]
    fn a_damaged_log_reads_as_what_it_still_holds() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("error-codes.json");
        fs::write(&log, "not json").unwrap();
        assert!(read(&log).is_empty());
        fs::write(&log, r#"[{"code":"E-SAVE","at":"2026-09-13T10:00:00Z"},{"code":"/Users/x","at":"t"}]"#).unwrap();
        assert_eq!(read(&log), [Entry { code: "E-SAVE".into(), at: "2026-09-13T10:00:00Z".into(), count: 1 }]);
        append(&log, ErrorCode::Boot, Utc::now()).unwrap();
        assert_eq!(read(&log).len(), 2);
    }
}
