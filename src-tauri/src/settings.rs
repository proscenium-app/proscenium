// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! App-global preferences, kept OUTSIDE any vault (architecture: app prefs never
//! leak into canonical workspace files), as `settings.json` in the per-app
//! config dir.
//!
//! **One typed model** (docs/app/preferences-and-help/settings.md#SET-D100, Part A). Every
//! preference used to be its own pair of commands — `get_accent`/`set_accent`,
//! `get_running_time_strip`/… — and each pair read the file into a struct and
//! wrote the struct back. That did not scale to the three threads adding
//! settings, and it had two faults this shape exists to remove:
//!
//! - **A key this build did not know was deleted by the next write.** The struct
//!   round-trip dropped anything a newer build, or another thread, had stored.
//!   The file is read as a JSON object now, and only the keys a patch names are
//!   touched: `lastVault`, its bookmark, and every key nobody here has heard of
//!   go back out as they came in.
//! - **Writes were a bare `fs::write`, and every command raced every other.** A
//!   torn file loses the bookmark that re-grants the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D12),
//!   and a launch-time `remember_vault` interleaved with a preference write
//!   could put back a stale one. Writes go through the store's atomic write now
//!   (temp, fsync, rename), and one lock serializes every read-modify-write.
//!
//! `get_settings` answers every preference with its default filled in;
//! `update_settings` takes a partial patch, validates ALL of it before touching
//! the file, and answers with the settings as stored. `lastVault` and its
//! bookmark are not in the model — docs/app/keeping-work/storage-and-file-format.md#STOR-D12 owns them, through
//! `remember_vault` and `vault_reopen_last` — and a patch that names them, or
//! anything else the model does not know, is refused.
//!
//! Reading stays forgiving: a missing file, one that is not JSON, or a value of
//! the wrong type degrades to the default for that preference — never an error
//! that blocks opening.
//!
//! **Adding a preference** (T1's update switch, T4's analytics switch, T3b's
//! default format): a field on [`Settings`] and its line in [`from_object`], an
//! `Option` field on [`SettingsPatch`] (plus a rule in [`validate`] if a bare
//! type check is not enough), and the same three things in
//! `src/storage/settings-model.ts`. Rust-side readers call [`current`].

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// The accent ids, in the order Settings shows them. `src/ui/use-accent.ts`
/// names and colours them; `settings-model.test.ts` reads THIS line, so the two
/// lists cannot drift apart without a failing test.
pub const ACCENTS: [&str; 5] = ["gilt", "velvet", "inkblue", "iris", "system"];

/// Gilt is the default (docs/engineering/design-system.md#UI-D102).
const DEFAULT_ACCENT: &str = "gilt";
pub const DEFAULT_SCENE_STATUSES: [&str; 4] = ["idea", "drafting", "revising", "ready for reading"];

/// The statuses a play can carry on the Plays screen, in order (docs/app/preferences-and-help/settings.md#SET-7).
/// `settings-model.test.ts` reads this line, so the two lists cannot drift.
pub const DEFAULT_PLAY_STATUSES: [&str; 8] = [
    "idea",
    "outlining",
    "drafting",
    "revising",
    "workshop",
    "submitted",
    "produced",
    "shelved",
];
/// Longer than any workflow word; past it, a status is a sentence.
const MAX_STATUS_CHARS: usize = 40;
/// More than a popup of statuses can be read down.
const MAX_STATUSES: usize = 24;
const PLAY_STATUSES: &str = "playStatuses";

/// Longer than any word a dictionary holds; a "word" past it is a paste
/// accident, not something to teach the checker.
const MAX_WORD_CHARS: usize = 100;

const LAST_VAULT: &str = "lastVault";
const LAST_VAULT_BOOKMARK: &str = "lastVaultBookmark";
const LEARNED_WORDS: &str = "learnedWords";
const DEFAULT_FORMAT: &str = "defaultFormat";
const LAST_PLAY: &str = "lastPlay";
/// Alpha's key (docs/app/preferences-and-help/settings.md#SET-38): what the alpha track asks
/// for, sent with alpha's checks and downloads and nothing else (updates.rs).
/// Written by a patch or by scripts/track-key.mjs, and never read back to the
/// page, which is told only whether there is one.
const UPDATE_TRACK_KEY: &str = "updateTrackKey";

/// What the app shows when it opens (Settings › General).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenAtLaunch {
    /// The Plays screen.
    Plays,
    /// Where the writer left off: the play open when the app closed, if it is
    /// still in the Plays folder, or the Plays screen if that was what was
    /// open. The Plays screen was the default, so nobody's app changed on
    /// upgrade, until a writer wanted back the page that was open when the app
    /// closed.
    #[default]
    LastPlay,
}

/// Which updates this copy takes (Settings › Updates,
/// docs/app/preferences-and-help/settings.md#SET-37). Every track is newer than the
/// one below it, and a copy never installs an older version, so a slower track
/// waits until it passes the version already installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateTrack {
    /// Releases.
    #[default]
    Stable,
    /// Releases, and each release's betas before it.
    Beta,
    /// Every change that passed its tests, as it lands.
    Alpha,
}

/// Whether this copy is the Intel build. An Intel Mac takes stable releases
/// alone: alpha and beta are built for Apple silicon only
/// (docs/app/preferences-and-help/settings.md#SET-40).
pub(crate) const INTEL: bool = cfg!(target_arch = "x86_64");

/// The track a copy follows: the one stored, except that an Intel Mac follows
/// stable whatever is stored, and leaves the stored value as it is.
pub(crate) fn effective_track(stored: UpdateTrack, intel: bool) -> UpdateTrack {
    if intel {
        UpdateTrack::Stable
    } else {
        stored
    }
}

/// Every preference, with its default filled in. What `get_settings` answers.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// The accent colour, one of [`ACCENTS`] — the only theme choice the app
    /// offers; light and dark follow the system.
    pub accent: String,
    pub appearance: String,
    pub format_order: Vec<String>,
    pub scene_statuses: Vec<String>,
    pub interface_text_size: u16,
    /// Whether the page map, once the running-time strip, shows under the
    /// script (docs/app/preferences-and-help/settings.md#SET-9).
    /// Absent means shown: it has been on since it shipped, and an absent
    /// preference must never read as a preference for off.
    pub running_time_strip: bool,
    /// Whether the spell checker underlines anything. The document menu's
    /// Check Spelling and Settings › Writing are two views of this one value.
    pub spellcheck: bool,
    /// Words the writer taught the spell checker, sorted, one spelling each. An
    /// app preference rather than play content: a name learned in one play is
    /// spelled the same in the next.
    pub learned_words: Vec<String>,
    /// The Plays screen's statuses, in order (docs/app/preferences-and-help/settings.md#SET-7). A new play starts as
    /// the first. Renaming or deleting one changes this list only: a play keeps
    /// the word its play file holds (docs/app/keeping-work/storage-and-file-format.md#STOR-D5, a free-form label).
    pub play_statuses: Vec<String>,
    /// Whether the Plays screen shows Progress, a page count per play — and
    /// counts it at all. On unless switched off.
    pub show_progress: bool,
    pub open_at_launch: OpenAtLaunch,
    /// The id of the play last open — state the app keeps so `LastPlay` has
    /// somewhere to go, not a choice the writer makes.
    pub last_play: Option<String>,
    /// Whether Proscenium looks for a newer version by itself, at launch and
    /// once a day (docs/engineering/release-engineering.md#REL-D6, updates.rs). On unless switched off;
    /// Check Now and the menu's Check for Updates… ask either way.
    pub check_for_updates: bool,
    /// Where updates come from (Settings › Updates): stable unless chosen.
    pub update_track: UpdateTrack,
    /// Whether this copy holds alpha's key, which is all the page learns of it
    /// (docs/app/preferences-and-help/settings.md#SET-37).
    pub has_update_track_key: bool,
    /// The format a new play starts in (Settings › Formats), or null for the
    /// app's default. An id only: whether that format still exists is the
    /// registry's question, and an unknown id falls back to the default.
    pub default_format: Option<String>,
    /// "Share anonymous usage and crash reports" (Settings › Privacy,
    /// docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3). On unless switched off; off, nothing is
    /// sent and anything waiting to go is dropped (telemetry/mod.rs).
    pub share_analytics: bool,
    /// The Welcome screen has said, once, that reports are sent — state the app
    /// keeps, not a choice the writer makes.
    pub privacy_notice_seen: bool,
}

/// A partial update: every field is optional, and a field that is absent (or
/// null) is left as it is. Unknown fields are refused rather than ignored, so a
/// misspelt key fails loudly instead of silently saving nothing — and
/// `lastVault` cannot be written from here at all.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format_order: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_statuses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interface_text_size: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub running_time_strip: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spellcheck: Option<bool>,
    /// The whole list: edited in one place, rarely, and in order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub play_statuses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_progress: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open_at_launch: Option<OpenAtLaunch>,
    /// A play's id, or `null` to clear it: the writer went back to the Plays screen.
    #[serde(default, skip_serializing, deserialize_with = "set_or_clear")]
    pub last_play: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub check_for_updates: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_track: Option<UpdateTrack>,
    /// Alpha's key, as the writer entered it. Write-only: the model answers
    /// `hasUpdateTrackKey`, never the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_track_key: Option<String>,
    /// A format id, or `null` to go back to the app's default. The one field
    /// where null means something, so it is read apart from the rest.
    #[serde(default, skip_serializing, deserialize_with = "set_or_clear")]
    pub default_format: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_analytics: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub privacy_notice_seen: Option<bool>,
    /// A change to the dictionary, never the whole list. Replacing the list
    /// would let a window holding an older copy wipe the word another just
    /// learned; adding and removing single words cannot.
    #[serde(default, skip_serializing)]
    pub learned_words: Option<WordsPatch>,
}

/// A present field as `Some`, so an explicit `null` (`Some(None)`) can mean
/// "clear" while an absent one (`None`) still means "leave it".
fn set_or_clear<'de, D: serde::Deserializer<'de>>(
    de: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(de).map(Some)
}

/// A format id, by validation's own rule (src/format/validate.ts).
fn valid_format_id(id: &str) -> bool {
    id.len() <= 64
        && id.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A key as scripts/track-key.mjs makes it: 32 random bytes, base64url,
/// unpadded. The Worker holds the same shape (services/edge/src/updates.ts).
pub(crate) fn valid_track_key(key: &str) -> bool {
    key.len() == 43
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Words to teach and to forget. Removals apply after additions, so a word in
/// both is forgotten.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WordsPatch {
    #[serde(default)]
    pub add: Vec<String>,
    #[serde(default)]
    pub remove: Vec<String>,
}

/// Version, architecture and channel, for Settings › About and Updates.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// The whole version this copy answers to (version.rs).
    version: String,
    /// The architecture of the code actually running: `aarch64` or `x86_64`.
    /// A universal binary runs one slice or the other, and this names which.
    arch: &'static str,
    /// `developer-id`, `app-store` or `local`: what updates this copy, if anything.
    channel: &'static str,
}

/// One writer at a time, for the whole process. Reads need no lock — a write
/// replaces the file by rename, so a reader sees the old file or the new one.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("settings.json"))
}

/// A play as the Plays screen knows it: the ULID in its play file, or the
/// folder's name when the file has none (`vault-plays.ts`). Only ever compared
/// with the plays found in the folder — never joined into a path — so the rule
/// is only that it is a real, printable name.
/// One status as the model accepts it: trimmed already, not empty, short, no
/// control characters (`isStatus` in settings-model.ts).
fn valid_status(status: &str) -> bool {
    !status.is_empty()
        && status == status.trim()
        && status.chars().count() <= MAX_STATUS_CHARS
        && !status.chars().any(char::is_control)
}

/// A stored list, read softly: what is usable survives, in order, once each.
fn read_statuses(items: &[Value]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for status in items
        .iter()
        .filter_map(Value::as_str)
        .filter(|s| valid_status(s))
    {
        if !out
            .iter()
            .any(|kept| kept.to_lowercase() == status.to_lowercase())
        {
            out.push(status.to_string());
        }
    }
    out.truncate(MAX_STATUSES);
    out
}

fn valid_play_ref(id: &str) -> bool {
    !id.trim().is_empty() && id.chars().count() <= 512 && !id.chars().any(char::is_control)
}

/// The file as a JSON object; empty when it is missing or unreadable.
fn read_object(path: &Path) -> Map<String, Value> {
    read_object_or_unreadable(path).0
}

/// The file as a JSON object, and whether it was there but could not be read:
/// missing is a first run; unreadable or malformed is a writer whose choices
/// exist and cannot be seen.
fn read_object_or_unreadable(path: &Path) -> (Map<String, Value>, bool) {
    match fs::read(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => (Map::new(), false),
        Err(_) => (Map::new(), true),
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(Value::Object(map)) => (map, false),
            _ => (Map::new(), true),
        },
    }
}

/// The preferences in `obj`, each one falling back to its default on its own —
/// a mangled accent does not cost the writer their dictionary.
pub(crate) fn from_object(obj: &Map<String, Value>) -> Settings {
    let accent = obj
        .get("accent")
        .and_then(Value::as_str)
        .filter(|a| ACCENTS.contains(a))
        .unwrap_or(DEFAULT_ACCENT)
        .to_string();
    let flag = |key: &str| obj.get(key).and_then(Value::as_bool);
    Settings {
        accent,
        appearance: obj
            .get("appearance")
            .and_then(Value::as_str)
            .filter(|s| ["system", "light", "dark"].contains(s))
            .unwrap_or("system")
            .to_string(),
        format_order: obj
            .get("formatOrder")
            .and_then(Value::as_array)
            .map(|items| {
                let mut ids = Vec::new();
                for id in items
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|id| valid_format_id(id))
                {
                    if !ids.iter().any(|s| s == id) && ids.len() < 256 {
                        ids.push(id.to_string());
                    }
                }
                ids
            })
            .unwrap_or_default(),
        scene_statuses: obj
            .get("sceneStatuses")
            .and_then(Value::as_array)
            .map(|items| read_statuses(items))
            .unwrap_or_else(|| {
                DEFAULT_SCENE_STATUSES
                    .iter()
                    .map(|s| s.to_string())
                    .collect()
            }),
        interface_text_size: obj
            .get("interfaceTextSize")
            .and_then(Value::as_u64)
            .filter(|n| (100..=200).contains(n))
            .unwrap_or(100) as u16,
        running_time_strip: flag("runningTimeStrip").unwrap_or(true),
        spellcheck: flag("spellcheck").unwrap_or(true),
        learned_words: obj
            .get(LEARNED_WORDS)
            .and_then(Value::as_array)
            .map(|words| {
                words
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        play_statuses: obj
            .get(PLAY_STATUSES)
            .and_then(Value::as_array)
            .map(|items| read_statuses(items))
            .unwrap_or_else(|| {
                DEFAULT_PLAY_STATUSES
                    .iter()
                    .map(|s| s.to_string())
                    .collect()
            }),
        show_progress: flag("showProgress").unwrap_or(true),
        open_at_launch: obj
            .get("openAtLaunch")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default(),
        last_play: obj
            .get(LAST_PLAY)
            .and_then(Value::as_str)
            .filter(|id| valid_play_ref(id))
            .map(str::to_string),
        check_for_updates: flag("checkForUpdates").unwrap_or(true),
        update_track: effective_track(
            obj.get("updateTrack")
                .cloned()
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default(),
            INTEL,
        ),
        has_update_track_key: obj
            .get(UPDATE_TRACK_KEY)
            .and_then(Value::as_str)
            .is_some_and(valid_track_key),
        default_format: obj
            .get(DEFAULT_FORMAT)
            .and_then(Value::as_str)
            .filter(|id| valid_format_id(id))
            .map(str::to_string),
        share_analytics: flag("shareAnalytics").unwrap_or(true),
        privacy_notice_seen: flag("privacyNoticeSeen").unwrap_or(false),
    }
}

/// Every value in the patch, checked before any of it is applied: a patch is
/// all or nothing, so one bad value cannot leave half a change on disk. Types
/// are already checked — serde refused a patch whose `spellcheck` is a string.
fn validate(patch: &SettingsPatch) -> Result<(), String> {
    if patch
        .appearance
        .as_ref()
        .is_some_and(|s| !["system", "light", "dark"].contains(&s.as_str()))
    {
        return Err("Unknown appearance".into());
    }
    if let Some(ids) = &patch.format_order {
        if ids.len() > 256
            || ids
                .iter()
                .enumerate()
                .any(|(i, id)| !valid_format_id(id) || ids[..i].contains(id))
        {
            return Err("Invalid format order".into());
        }
    }
    if patch
        .interface_text_size
        .is_some_and(|n| !(100..=200).contains(&n))
    {
        return Err("interfaceTextSize must be a whole percentage from 100 to 200".into());
    }
    if let Some(accent) = &patch.accent {
        if !ACCENTS.contains(&accent.as_str()) {
            return Err(format!("\"{accent}\" is not an accent"));
        }
    }
    for list in [&patch.play_statuses, &patch.scene_statuses]
        .into_iter()
        .flatten()
    {
        if list.len() > MAX_STATUSES {
            return Err(format!("at most {MAX_STATUSES} statuses"));
        }
        for (i, status) in list.iter().enumerate() {
            if !valid_status(status) {
                return Err(format!("\"{status}\" is not a status"));
            }
            if list[..i]
                .iter()
                .any(|earlier| earlier.to_lowercase() == status.to_lowercase())
            {
                return Err(format!("\"{status}\" is in the list twice"));
            }
        }
    }
    if let Some(Some(id)) = &patch.last_play {
        if !valid_play_ref(id) {
            return Err(format!("\"{id}\" is not a play"));
        }
    }
    if patch
        .update_track_key
        .as_deref()
        .is_some_and(|key| !valid_track_key(key))
    {
        return Err("That is not a key".into());
    }
    if patch
        .update_track
        .is_some_and(|t| effective_track(t, INTEL) != t)
    {
        return Err("An Intel Mac takes stable releases only".into());
    }
    if let Some(Some(id)) = &patch.default_format {
        if !valid_format_id(id) {
            return Err(format!("\"{id}\" is not a format id"));
        }
    }
    if let Some(words) = &patch.learned_words {
        for word in words.add.iter().chain(&words.remove) {
            let trimmed = word.trim();
            if trimmed.is_empty() || trimmed.chars().count() > MAX_WORD_CHARS {
                return Err(format!("\"{word}\" is not a word the dictionary can hold"));
            }
        }
    }
    Ok(())
}

/// Case-insensitive, as the checker's own comparison is: "Vronsky" and
/// "vronsky" are one entry, and the first spelling taught is the one kept.
fn same_word(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// Apply a validated patch to the file's object, leaving every key it does not
/// name exactly as it was.
fn apply(obj: &mut Map<String, Value>, mut patch: SettingsPatch) -> Result<(), String> {
    let words = patch.learned_words.take();
    for (key, value) in [
        (DEFAULT_FORMAT, patch.default_format.take()),
        (LAST_PLAY, patch.last_play.take()),
    ] {
        match value {
            Some(Some(value)) => {
                obj.insert(key.to_string(), Value::String(value));
            }
            Some(None) => {
                obj.remove(key);
            }
            None => {}
        }
    }
    // The value fields serialize under the model's own camelCase names, so no
    // key is spelled twice; `skip_serializing_if` leaves out what was not sent.
    if let Value::Object(values) = serde_json::to_value(&patch).map_err(|e| e.to_string())? {
        obj.extend(values);
    }
    if let Some(words) = words {
        let mut list = from_object(obj).learned_words;
        for word in &words.add {
            let word = word.trim();
            if !list.iter().any(|w| same_word(w, word)) {
                list.push(word.to_string());
            }
        }
        for word in &words.remove {
            list.retain(|w| !same_word(w, word.trim()));
        }
        list.sort_by_key(|w| w.to_lowercase());
        if list.is_empty() {
            obj.remove(LEARNED_WORDS);
        } else {
            obj.insert(LEARNED_WORDS.to_string(), Value::from(list));
        }
    }
    Ok(())
}

/// Read, change and write the file as one step, under the process-wide lock.
///
/// A file that exists but cannot be read is NOT written over: an I/O error that
/// passes would otherwise cost the writer their bookmark to a hiccup. A file
/// that reads but is not a JSON object — a hand edit gone wrong — is set aside
/// as `settings.json.unreadable` before a fresh one is written, so its bytes
/// are still there for whoever needs them.
fn modify_at<T>(
    path: &Path,
    change: impl FnOnce(&mut Map<String, Value>) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let (mut obj, unreadable) = match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(Value::Object(map)) => (map, false),
            _ => (Map::new(), true),
        },
        Err(e) if e.kind() == ErrorKind::NotFound => (Map::new(), false),
        Err(e) => return Err(format!("settings.json could not be read: {e}")),
    };
    let out = change(&mut obj)?;
    if unreadable {
        let aside = path.with_extension("json.unreadable");
        fs::rename(path, &aside).map_err(|e| e.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(&Value::Object(obj)).map_err(|e| e.to_string())?;
    crate::store::write_atomic(path, &bytes).map_err(|e| e.to_string())?;
    Ok(out)
}

fn update_at(path: &Path, patch: SettingsPatch) -> Result<Settings, String> {
    validate(&patch)?;
    modify_at(path, |obj| {
        apply(obj, patch)?;
        Ok(from_object(obj))
    })
}

fn remember_vault_at(path: &Path, vault: String, bookmark: Option<String>) -> Result<(), String> {
    modify_at(path, |obj| {
        let stored_path = obj
            .get(LAST_VAULT)
            .and_then(Value::as_str)
            .map(str::to_string);
        let stored_bookmark = obj
            .get(LAST_VAULT_BOOKMARK)
            .and_then(Value::as_str)
            .map(str::to_string);
        match bookmark_to_keep(
            stored_path.as_deref(),
            stored_bookmark,
            &vault,
            bookmark,
            grant_reaches,
        ) {
            Some(keep) => {
                obj.insert(LAST_VAULT_BOOKMARK.to_string(), Value::String(keep));
            }
            None => {
                obj.remove(LAST_VAULT_BOOKMARK);
            }
        }
        obj.insert(LAST_VAULT.to_string(), Value::String(vault));
        Ok(())
    })
}

/// The settings as stored, for Rust-side readers (the updater's switch, the
/// analytics switch). The command form is `get_settings`.
pub fn current(app: &AppHandle) -> Settings {
    let (obj, unreadable) = settings_path(app)
        .map(|p| read_object_or_unreadable(&p))
        .unwrap_or_default();
    let mut settings = from_object(&obj);
    // Consent that cannot be read is not consent: a writer who switched
    // reports off, and whose settings file then broke, would otherwise launch
    // with them on again.
    if unreadable {
        settings.share_analytics = false;
    }
    settings
}

/// Alpha's key, for alpha's checks and downloads only (updates.rs); `None`
/// when this copy holds none.
pub fn update_track_key(app: &AppHandle) -> Option<String> {
    let obj = read_object(&settings_path(app)?);
    obj.get(UPDATE_TRACK_KEY)
        .and_then(Value::as_str)
        .filter(|k| valid_track_key(k))
        .map(str::to_string)
}

/// Every preference, with its default where the writer has not chosen.
#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Settings {
    current(&app)
}

/// Apply a partial patch: validated, written atomically, and answered with the
/// settings as they now stand. Nothing is written when any part is invalid.
#[tauri::command]
pub async fn update_settings(app: AppHandle, patch: SettingsPatch) -> Result<Settings, String> {
    let path = settings_path(&app).ok_or("the app has no settings directory")?;
    // Off acts before the file is written, so a disk that refuses the write
    // cannot leave reports on for the rest of this launch. On
    // waits for the file: a switch that could not be kept is not thrown.
    if patch.share_analytics == Some(false) {
        crate::telemetry::switched_off(&app);
    }
    #[cfg(all(desktop, feature = "updater"))]
    let track_before = patch.update_track.map(|_| current(&app).update_track);
    #[cfg(all(desktop, feature = "updater"))]
    let key_changed = patch
        .update_track_key
        .as_ref()
        .is_some_and(|key| update_track_key(&app).as_ref() != Some(key));
    let settings = update_at(&path, patch)?;
    // The reports switch acts the moment it moves (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3).
    crate::telemetry::settings_changed(&app, &settings);
    // And a change of track asks the new one at once, as does a new key on
    // alpha, which a failed check may have been waiting for.
    #[cfg(all(desktop, feature = "updater"))]
    if track_before.is_some_and(|before| before != settings.update_track)
        || (key_changed && settings.update_track == UpdateTrack::Alpha)
    {
        crate::updates::track_changed(&app);
    }
    Ok(settings)
}

/// The absolute path of the last vault opened, if any (null on first run or any
/// read error).
#[tauri::command]
pub async fn get_last_vault(app: AppHandle) -> Option<String> {
    last_vault_path(&app)
}

/// The stored path, for Rust-side callers (the command form is `get_last_vault`).
pub fn last_vault_path(app: &AppHandle) -> Option<String> {
    let obj = read_object(&settings_path(app)?);
    obj.get(LAST_VAULT)
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// The stored bookmark for the last vault, if one was needed.
pub fn last_vault_bookmark(app: &AppHandle) -> Option<String> {
    let obj = read_object(&settings_path(app)?);
    obj.get(LAST_VAULT_BOOKMARK)
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// Remember the last vault opened. A failed durable grant is returned and
/// retained for the folder-access UI; the open folder remains usable.
///
/// A folder inside the Plays folder remembered now is the Plays screen's answer
/// to a Plays folder chosen one level too high (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). The panel granted
/// the folder around it, and under the App Sandbox that grant reaches this one
/// only while the app runs. So it gets a bookmark of its own here, which follows
/// it if it moves. Where none can be made (iOS mints its bookmarks in the picker,
/// not here), the grant for the folder around it is kept instead, and
/// `vault_reopen_last` opens this folder inside the one that grant reopens. The
/// page calls this only once the folder has listed.
#[tauri::command]
pub async fn set_last_vault(
    app: AppHandle,
    authority: tauri::State<'_, crate::authority::Authority>,
    handle: String,
) -> Result<(), String> {
    let path = authority.resolve(&handle)?.to_string_lossy().into_owned();
    #[cfg(not(target_os = "macos"))]
    let bookmark = bookmark_below(
        last_vault_path(&app).as_deref(),
        &path,
        crate::scope::bookmark,
    );
    #[cfg(target_os = "macos")]
    let bookmark = crate::scope::bookmark(&path);
    #[cfg(target_os = "macos")]
    let problem = bookmark.is_none().then(|| "Proscenium could not make a bookmark for this folder. Choose it again to retain access.".into());
    #[cfg(not(target_os = "macos"))]
    let problem = None;
    crate::folder_access::retain(&app, path, bookmark, problem)
}

/// A fresh bookmark for `new_path` when it is a folder inside the stored one,
/// minted while the stored folder's grant still reaches it. None otherwise, and
/// `remember_vault` keeps or drops the stored bookmark by its own rule.
#[cfg(any(not(target_os = "macos"), test))]
fn bookmark_below(
    stored_path: Option<&str>,
    new_path: &str,
    mint: impl Fn(&str) -> Option<String>,
) -> Option<String> {
    if stored_path.is_some_and(|stored| folder_inside(new_path, stored)) {
        mint(new_path)
    } else {
        None
    }
}

/// `child` is a folder strictly inside `parent`, however either is spelled.
fn folder_inside(child: &str, parent: &str) -> bool {
    matches!(
        (std::fs::canonicalize(child), std::fs::canonicalize(parent)),
        (Ok(c), Ok(p)) if c != p && c.starts_with(&p)
    )
}

/// The stored folder's grant still opens `new_path`: the same folder, or a
/// folder inside it (see `reopen_path`).
fn grant_reaches(stored: &str, new_path: &str) -> bool {
    same_folder(stored, new_path) || folder_inside(new_path, stored)
}

/// The folder to reopen once the stored bookmark has resolved to `bookmarked`:
/// the remembered Plays folder when it sits inside that folder, kept on the
/// grant of the folder around it (`set_last_vault`), or else the folder the
/// bookmark names.
pub fn reopen_path(bookmarked: String, stored: Option<String>) -> String {
    match stored {
        Some(path) if folder_inside(&path, &bookmarked) => path,
        _ => bookmarked,
    }
}

/// Remember the last vault along with the bookmark that re-grants access to it
/// (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
///
/// On every platform, not just iOS: under App Sandbox a path is not permission
/// on macOS either, so a folder the writer picked is unreadable next launch
/// without the bookmark. The bookmark is the durable identity and the path is
/// only a hint; a folder inside our own container needs no bookmark at all.
///
/// A `None` bookmark **preserves** whatever is stored rather than clearing it:
/// several callers know the path and not the grant, and none of them should
/// wipe a perfectly good one — but only for the SAME folder, or a folder inside
/// it. A bookmark for the folder the writer just left is not a good one:
/// `vault_reopen_last` resolves the bookmark before the path, so keeping it
/// reopened the old Plays folder on the next launch after the writer chose
/// iCloud Drive, or a play's folder opened from Finder. A folder inside the
/// bookmarked one is different: the grant reaches it, and `reopen_path` opens
/// it there.
pub fn remember_vault(
    app: &AppHandle,
    path: String,
    bookmark: Option<String>,
) -> Result<(), String> {
    let file = settings_path(app).ok_or("The settings folder could not be located")?;
    remember_vault_at(&file, path, bookmark).map_err(|e| e.to_string())
}

/// Which bookmark to store beside `new_path`: a fresh one when given, the stored
/// one when it is the same folder, and none for a different folder.
fn bookmark_to_keep(
    stored_path: Option<&str>,
    stored_bookmark: Option<String>,
    new_path: &str,
    new_bookmark: Option<String>,
    same: impl Fn(&str, &str) -> bool,
) -> Option<String> {
    new_bookmark
        .or_else(|| stored_bookmark.filter(|_| stored_path.is_some_and(|p| same(p, new_path))))
}

/// The same folder on disk, however it is spelled: the vault root arrives
/// canonicalized, which need not match the picker's spelling of it character
/// for character. Dropping a grant over a spelling would lose the folder on
/// the next sandboxed launch — "my plays disappeared".
fn same_folder(a: &str, b: &str) -> bool {
    a == b
        || matches!(
            (std::fs::canonicalize(a), std::fs::canonicalize(b)),
            (Ok(x), Ok(y)) if x == y
        )
}

/// Settings › General › Reveal in Finder. The folder shown is the stored
/// `lastVault` — the Plays folder, since entering a play never changes it — so
/// the webview names no path and this cannot be pointed anywhere else.
#[cfg(desktop)]
#[tauri::command]
pub async fn reveal_plays_folder(app: AppHandle) -> Result<(), String> {
    let path = last_vault_path(&app).ok_or("no Plays folder has been chosen")?;
    if !Path::new(&path).is_dir() {
        return Err("the Plays folder is not where it was".to_string());
    }
    #[cfg(feature = "selftest")]
    if crate::selftest::record_reveal(("open", Path::new(&path))) {
        return Ok(());
    }
    os_open(&path)
}

/// Settings › Formats › Open Formats Folder: `<app config>/formats`, where
/// `formats.rs` reads user formats from. Created first, so the button never
/// opens onto nothing on a Mac that has no formats of its own yet.
#[cfg(desktop)]
#[tauri::command]
pub async fn open_formats_folder(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("formats");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    os_open(&dir.to_string_lossy())
}

/// The license the About section names, in the writer's own browser. A fixed
/// address: the webview hands over nothing to open.
#[cfg(desktop)]
#[tauri::command]
pub async fn open_license() -> Result<(), String> {
    os_open(crate::telemetry::allowlist::LICENSE)
}

#[cfg(desktop)]
fn os_open(target: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(target)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Mobile has no Finder to open anything in; the frontend hides these through
/// `capabilities().canReveal`, so only a stale UI reaches them.
#[cfg(mobile)]
#[tauri::command]
pub async fn reveal_plays_folder(_app: AppHandle) -> Result<(), String> {
    Err("this platform has no file manager".to_string())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn open_formats_folder(_app: AppHandle) -> Result<(), String> {
    Err("this platform has no file manager".to_string())
}

#[cfg(mobile)]
#[tauri::command]
pub async fn open_license() -> Result<(), String> {
    Err("this platform cannot open a browser from here".to_string())
}

/// What a sponsorship pays for, in the writer's browser (Settings › About ›
/// The Program). A fixed address: the webview hands over nothing to open.
#[tauri::command]
pub async fn open_support() -> Result<(), String> {
    #[cfg(desktop)]
    {
        os_open(crate::telemetry::allowlist::SUPPORT)
    }
    #[cfg(mobile)]
    {
        Err("this platform cannot open a browser from here".to_string())
    }
}

/// The complete public field-and-reason table, in the writer's browser.
#[tauri::command]
pub async fn open_privacy() -> Result<(), String> {
    #[cfg(desktop)]
    {
        os_open(crate::telemetry::allowlist::PRIVACY)
    }
    #[cfg(mobile)]
    {
        Err("this platform cannot open a browser from here".to_string())
    }
}

/// Version and architecture for Settings › About.
#[tauri::command]
pub async fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: crate::version::whole(&app),
        arch: std::env::consts::ARCH,
        channel: crate::telemetry::channel(),
    }
}

/// The unsaved-work beacon for the installer: a tiny state file
/// the install script reads before touching the bundle, so an update never
/// lands while the writer has un-flushed words. Writes are atomic and an
/// update waits for an acknowledged write; unreadable means unsafe.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BufferState {
    dirty: bool,
    pid: u32,
    updated_at: String,
}

fn buffer_state_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("buffer-state.json"))
}

pub fn write_buffer_state(app: &AppHandle, dirty: bool) -> Result<(), String> {
    let file = buffer_state_file(app).ok_or("The save state could not be located")?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let state = BufferState {
        dirty,
        pid: std::process::id(),
        updated_at: chrono::Utc::now().to_rfc3339(),
    };
    let json = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    crate::vault::write_atomic(&file, &json).map_err(|e| e.to_string())
}

/// Frontend hook: the workspace reports whether unsaved edits exist.
#[tauri::command]
pub async fn set_buffer_state(app: AppHandle, dirty: bool) -> Result<(), String> {
    write_buffer_state(&app, dirty)
}

/// What the beacon last said: some words are not on disk. The quit gate
/// (quit.rs) waits longer for a page that has some.
#[cfg(desktop)]
pub fn words_at_risk(app: &AppHandle) -> bool {
    buffer_state_file(app)
        .and_then(|file| fs::read(file).ok())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|beacon| beacon.get("dirty").and_then(Value::as_bool))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests;
