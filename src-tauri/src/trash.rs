// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Proscenium’s Trash, as the page opens it (docs/engineering/cross-platform.md#PLAT-16):
//! every ring a delete on this device went to, what each keeps, and Put Back.
//!
//! A system with a trash of its own (a Mac, a PC) keeps nothing here, and the
//! page never asks. The rings are in app data, outside the Plays folder, each
//! kept for what it is put back into:
//!
//! ```text
//! <app data>/
//! ├── trash/                  ← deleted with the Plays folder open: back into the Plays folder
//! ├── plays/<playId>/trash/   ← deleted in one play: back into that play
//! ├── tutorials/trash/        ← practice: back into Help & Tutorials
//! └── formats-trash/          ← the writer's formats: back into the formats folder
//! ```

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::store;
use crate::vault::ring::{self, Kept, Ring};

/// The formats' ring, beside the formats folder in app data.
pub const FORMATS_RING: &str = "formats-trash";

/// Which ring an entry is in, which says where it goes back to.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RingRef {
    /// One play's, by its id: what was deleted in it.
    Play {
        #[serde(rename = "playId")]
        play_id: String,
    },
    /// The Plays folder's: what was deleted with the Plays folder open.
    Plays,
    /// Practice from Help & Tutorials.
    Practice,
    /// The writer's own formats.
    Formats,
}

/// One thing Proscenium’s Trash keeps, and the ring it is in.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    ring: RingRef,
    #[serde(flatten)]
    kept: Kept,
}

/// Where a put back landed.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PutBack {
    /// Relative to the folder open, for a play's ring and the Plays folder's;
    /// its name, for practice and a format.
    rel: String,
    /// Its own name was taken, so it came back beside it under another.
    renamed: bool,
    /// What the page said of it when it was deleted.
    note: Option<String>,
}

/// Where a ring is, under app data. A play's id is checked before it names a
/// folder, as the play's own store checks it.
fn ring_dir(base: &Path, ring: &RingRef) -> Result<PathBuf, String> {
    Ok(match ring {
        RingRef::Play { play_id } => {
            if !store::valid_id(play_id) {
                return Err("That is not a play Proscenium’s Trash keeps anything of.".into());
            }
            base.join("plays").join(play_id).join("trash")
        }
        RingRef::Plays => base.join("trash"),
        RingRef::Practice => base.join("tutorials").join("trash"),
        RingRef::Formats => base.join(FORMATS_RING),
    })
}

/// Every ring there is under `base`: the three that always have a place, and
/// each play's that has been made.
fn rings_in(base: &Path) -> Vec<(RingRef, PathBuf)> {
    let mut rings: Vec<(RingRef, PathBuf)> = [RingRef::Plays, RingRef::Practice, RingRef::Formats]
        .into_iter()
        .filter_map(|ring| ring_dir(base, &ring).ok().map(|dir| (ring, dir)))
        .collect();
    if let Ok(read) = std::fs::read_dir(base.join("plays")) {
        for entry in read.flatten() {
            let play_id = entry.file_name().to_string_lossy().to_string();
            let ring = RingRef::Play { play_id };
            if let Ok(dir) = ring_dir(base, &ring) {
                if dir.is_dir() {
                    rings.push((ring, dir));
                }
            }
        }
    }
    rings
}

/// What every ring keeps, newest first, once what has been kept its span has gone.
fn list_in(base: &Path, now_ms: u64) -> Vec<TrashEntry> {
    let mut out = Vec::new();
    for (ring, dir) in rings_in(base) {
        let kept = Ring::at(dir);
        let _ = kept.prune(now_ms);
        // A ring that cannot be read hides nothing the others keep.
        if let Ok(entries) = kept.entries() {
            out.extend(entries.into_iter().map(|kept| TrashEntry {
                ring: ring.clone(),
                kept,
            }));
        }
    }
    out.sort_by_key(|entry| std::cmp::Reverse(entry.kept.deleted_ms));
    out
}

#[tauri::command]
pub async fn trash_list(app: AppHandle) -> Result<Vec<TrashEntry>, String> {
    let base = store::app_data_dir(&app).map_err(|e| e.to_string())?;
    Ok(list_in(&base, ring::now_ms()))
}

/// Put one entry back. A play's, or the Plays folder's, goes into the folder
/// open, at `into` (the page knows where its play is now); practice goes back
/// into Help & Tutorials under its own id, and a format into the formats
/// folder. Never over anything: a taken name gives way to one that says it
/// was put back, and practice, whose name is its identity, is refused instead.
#[tauri::command]
pub async fn trash_put_back(
    app: AppHandle,
    state: crate::ManagerState<'_>,
    ring: RingRef,
    name: String,
    into: Option<String>,
) -> Result<PutBack, String> {
    let base = store::app_data_dir(&app).map_err(|e| e.to_string())?;
    let kept_in = Ring::at(ring_dir(&base, &ring)?);
    let (from, kept) = kept_in.find(&name).map_err(|e| e.to_string())?;
    let (rel, wanted) = match ring {
        RingRef::Play { .. } | RingRef::Plays => {
            let into =
                into.ok_or("Where it goes back to was not said, so nothing was put back.")?;
            let vault = crate::current_vault(&state)?;
            (
                vault.put_back(&from, &into).map_err(|e| e.to_string())?,
                into,
            )
        }
        RingRef::Practice => {
            if !crate::tutorials::valid_id(&kept.original) {
                return Err("That practice has no name it can come back under.".into());
            }
            let sessions = base.join("tutorials").join("sessions");
            let landed = ring::put_back_local(&from, &sessions, &kept.original, false)
                .map_err(|_| "That practice is already in Help & Tutorials.".to_string())?;
            (landed, kept.original.clone())
        }
        RingRef::Formats => {
            if !crate::formats::valid_file_name(&kept.original) {
                return Err("That format has no name it can come back under.".into());
            }
            let formats = base.join("formats");
            (
                ring::put_back_local(&from, &formats, &kept.original, true)
                    .map_err(|e| e.to_string())?,
                kept.original.clone(),
            )
        }
    };
    // What was asked is done; the ring letting its copy go is housekeeping,
    // and a copy it could not let go is only listed again.
    let _ = kept_in.forget(&name);
    Ok(PutBack {
        renamed: rel != wanted,
        rel,
        note: kept.note,
    })
}

/// At launch, what every ring has kept its span goes, off the main thread:
/// nothing waits for it.
#[cfg(mobile)]
pub fn prune_at_launch(app: &AppHandle) {
    let Ok(base) = store::app_data_dir(app) else {
        return;
    };
    std::thread::spawn(move || {
        let now = ring::now_ms();
        for (_, dir) in rings_in(&base) {
            let _ = Ring::at(dir).prune(now);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    const PLAY: &str = "01J0000000000000000000PLAY";

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn a_ring_is_named_by_what_it_keeps_and_a_play_id_never_leaves_app_data() {
        let base = Path::new("/data");
        assert_eq!(
            ring_dir(
                base,
                &RingRef::Play {
                    play_id: PLAY.into()
                }
            )
            .unwrap(),
            base.join("plays").join(PLAY).join("trash")
        );
        assert_eq!(ring_dir(base, &RingRef::Plays).unwrap(), base.join("trash"));
        assert_eq!(
            ring_dir(base, &RingRef::Practice).unwrap(),
            base.join("tutorials/trash")
        );
        assert_eq!(
            ring_dir(base, &RingRef::Formats).unwrap(),
            base.join(FORMATS_RING)
        );
        for bad in ["../x", "", "a/b", "."] {
            assert!(
                ring_dir(
                    base,
                    &RingRef::Play {
                        play_id: bad.into()
                    }
                )
                .is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_page_names_a_ring_as_the_record_says() {
        let play: RingRef = serde_json::from_str(r#"{"kind":"play","playId":"A1"}"#).unwrap();
        assert_eq!(
            play,
            RingRef::Play {
                play_id: "A1".into()
            }
        );
        let plays: RingRef = serde_json::from_str(r#"{"kind":"plays"}"#).unwrap();
        assert_eq!(plays, RingRef::Plays);
        assert_eq!(
            serde_json::to_value(RingRef::Practice).unwrap(),
            serde_json::json!({ "kind": "practice" })
        );
    }

    #[test]
    fn every_ring_is_listed_newest_first_with_what_has_had_its_span_gone() {
        let data = tempfile::tempdir().unwrap();
        let base = data.path();
        let src = tempfile::tempdir().unwrap();
        let now = SystemTime::now();
        let keep = |ring: &RingRef, name: &str, rel: &str, days: u64| {
            let file = src.path().join(name);
            write(&file, name);
            Ring::at(ring_dir(base, ring).unwrap())
                .keep(
                    &file,
                    rel,
                    None,
                    now - Duration::from_secs(days * 24 * 3600) - Duration::from_secs(1),
                )
                .unwrap();
        };
        let play = RingRef::Play {
            play_id: PLAY.into(),
        };
        keep(&play, "Structure.md", "Notes/Structure.md", 0);
        keep(
            &RingRef::Practice,
            "01J00000000000000000000000",
            "01J00000000000000000000000",
            1,
        );
        keep(&RingRef::Formats, "House.json", "House.json", 2);
        keep(&RingRef::Plays, "Old Play", "Old Play", ring::KEEP_DAYS + 1);
        // A folder in app data that is no play's is passed by.
        std::fs::create_dir_all(base.join("plays/not a play id/trash")).unwrap();

        let listed = list_in(base, ring::now_ms());
        let seen: Vec<_> = listed
            .iter()
            .map(|e| (e.ring.clone(), e.kept.original.as_str()))
            .collect();
        assert_eq!(
            seen,
            vec![
                (play, "Structure.md"),
                (RingRef::Practice, "01J00000000000000000000000"),
                (RingRef::Formats, "House.json"),
            ]
        );
        // The one kept past its span is gone from the disk, not only the list.
        assert!(Ring::at(base.join("trash")).entries().unwrap().is_empty());
        let json = serde_json::to_value(&listed[0]).unwrap();
        assert_eq!(
            json["ring"],
            serde_json::json!({ "kind": "play", "playId": PLAY })
        );
        assert_eq!(json["rel"], "Notes/Structure.md");
        assert_eq!(json["isDir"], false);
    }

    #[test]
    fn app_data_with_no_ring_lists_nothing() {
        let data = tempfile::tempdir().unwrap();
        assert!(list_in(data.path(), ring::now_ms()).is_empty());
        assert!(list_in(&data.path().join("missing"), ring::now_ms()).is_empty());
    }
}
