// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Diagnostics a writer controls (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5): the plain text
//! Help › Copy Diagnostics puts on the clipboard, and Send Feedback includes
//! only when the writer chooses it.
//!
//! **What it says:** the version and channel, the architecture and macOS
//! version, the accent, the formats in use (a writer's own as `user`), the
//! switches, what keeps the Plays folder (iCloud Drive, Dropbox, Syncthing, this
//! Mac…), the last 20 error codes with their times, and the crash files. **What
//! it never says:** a path, a play's name, a format's name, a learned word — the
//! gathering reads `settings.json` and picks out switches, and the test below
//! puts a play at a known path to hold it to that.
//!
//! Nothing here sends anything. The writer reads the text wherever they paste
//! it, or reviews it in Send Feedback before choosing to include it.

use std::path::Path;

use serde_json::{Map, Value};

use super::crash::{self, CrashRecord};
use super::errors::{self, Entry};
use super::events::{Channel, FormatRef};
use crate::settings::{self, OpenAtLaunch, Settings, UpdateTrack};

/// Error codes shown, newest first.
const ERRORS_SHOWN: usize = 20;

pub struct Facts {
    pub version: String,
    pub channel: Channel,
    pub arch: &'static str,
    pub os: String,
    pub settings: Settings,
    pub formats_in_use: Vec<FormatRef>,
    /// The ids of what keeps the Plays folder (providers.rs) — empty for a
    /// folder on this Mac only — or None before one is chosen.
    pub plays_folder: Option<Vec<String>>,
    /// Whether this distribution build enables automatic reports.
    pub can_send: bool,
    pub errors: Vec<Entry>,
    pub crashes: Vec<CrashRecord>,
}

/// Where the facts are read from.
pub struct Sources<'a> {
    /// Holds `settings.json`.
    pub config_dir: &'a Path,
    /// Holds `crashes/` and `error-codes.json`.
    pub data_dir: &'a Path,
    pub home: &'a Path,
    pub is_icloud_item: &'a dyn Fn(&Path) -> bool,
    /// Format ids, as the page has them. Only built-in ids survive.
    pub formats_in_use: &'a [String],
    pub version: &'a str,
    pub channel: Channel,
    pub arch: &'static str,
    pub os: &'a str,
    pub can_send: bool,
}

pub fn gather(sources: &Sources) -> Facts {
    let object: Map<String, Value> = std::fs::read(sources.config_dir.join("settings.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let plays_folder = object.get("lastVault").and_then(Value::as_str).map(|path| {
        crate::providers::detect(
            Path::new(path),
            &crate::providers::Environment {
                home: sources.home.to_path_buf(),
                is_icloud_item: sources.is_icloud_item,
            },
        )
    });
    let mut formats_in_use: Vec<FormatRef> = Vec::new();
    for id in sources.formats_in_use {
        let format = FormatRef::from_page(id);
        if !formats_in_use.contains(&format) {
            formats_in_use.push(format);
        }
    }
    let mut shown = errors::read(&sources.data_dir.join(super::ERROR_LOG));
    shown.reverse();
    shown.truncate(ERRORS_SHOWN);
    Facts {
        version: sources.version.to_string(),
        channel: sources.channel,
        arch: sources.arch,
        os: sources.os.to_string(),
        settings: settings::from_object(&object),
        formats_in_use,
        plays_folder,
        can_send: sources.can_send,
        errors: shown,
        crashes: crash::read_all(&sources.data_dir.join(super::CRASH_DIR))
            .into_iter()
            .map(|(_, record)| record)
            .collect(),
    }
}

/// A provider id in the words a writer knows it by. Anything unrecognised is
/// "another sync service" rather than its own name.
fn provider_name(id: &str) -> &'static str {
    match id {
        "icloud" => "iCloud Drive",
        "dropbox" => "Dropbox",
        "onedrive" => "OneDrive",
        "google-drive" => "Google Drive",
        "box" => "Box",
        "syncthing" => "Syncthing",
        _ => "another sync service",
    }
}

fn arch_name(arch: &str) -> &'static str {
    match arch {
        "aarch64" => "Apple silicon",
        "x86_64" => "Intel",
        _ => "another architecture",
    }
}

fn on_off(on: bool) -> &'static str {
    if on {
        "on"
    } else {
        "off"
    }
}

/// `2026-09-13T19:20:31Z` as `2026-09-13 19:20:31 UTC`.
fn when(at: &str) -> String {
    match at.strip_suffix('Z') {
        Some(t) => format!("{} UTC", t.replacen('T', " ", 1)),
        None => at.to_string(),
    }
}

pub fn text(facts: &Facts) -> String {
    let s = &facts.settings;
    let mut out = String::new();
    let mut line = |label: &str, value: String| out.push_str(&format!("{label:<14}{value}\n"));
    line("Proscenium", format!("{} ({})", facts.version, facts.channel.as_str()));
    line("Mac", format!("{}, {} ({})", facts.os, arch_name(facts.arch), facts.arch));
    line("Accent", s.accent.clone());
    let formats: Vec<&str> = facts.formats_in_use.iter().map(|f| f.as_str()).collect();
    line("Formats", if formats.is_empty() { "none open".into() } else { formats.join(", ") });
    line(
        "New plays in",
        s.default_format.as_deref().map_or("the default format", |id| FormatRef::from_page(id).as_str()).into(),
    );
    line(
        "Plays folder",
        match &facts.plays_folder {
            None => "not chosen yet".into(),
            Some(ids) if ids.is_empty() => "on this Mac only".into(),
            Some(ids) => ids.iter().map(|id| provider_name(id)).collect::<Vec<_>>().join(" and "),
        },
    );
    line(
        "Settings",
        [
            format!("spell check {}", on_off(s.spellcheck)),
            format!("page map {}", on_off(s.running_time_strip)),
            format!(
                "opens to {}",
                match s.open_at_launch {
                    OpenAtLaunch::Plays => "the Plays screen",
                    OpenAtLaunch::LastPlay => "where the writer left off",
                }
            ),
            format!("automatic update checks {}", on_off(s.check_for_updates)),
            match s.update_track {
                UpdateTrack::Stable => "stable track",
                UpdateTrack::Beta => "beta track",
                UpdateTrack::Alpha => "alpha track",
            }
            .into(),
        ]
        .join(" · "),
    );
    line(
        "Reports",
        if !s.share_analytics {
            "usage and crash reports off".into()
        } else if facts.can_send {
            "usage and crash reports on".into()
        } else {
            "usage and crash reports on, but this build has reports disabled and sends nothing".into()
        },
    );

    out.push_str("\nRecent errors, newest first\n");
    if facts.errors.is_empty() {
        out.push_str("  none\n");
    }
    for entry in &facts.errors {
        let times = if entry.count > 1 { format!(" ×{}", entry.count) } else { String::new() };
        out.push_str(&format!("  {}  {}{times}\n", when(&entry.at), entry.code));
    }

    out.push_str("\nCrashes on this Mac\n");
    if facts.crashes.is_empty() {
        out.push_str("  none\n");
    }
    for record in &facts.crashes {
        out.push_str(&format!(
            "  {}  {}  {} stack frames  in {}\n",
            when(&record.at),
            record.kind.as_str(),
            record.frames.len(),
            record.version
        ));
    }
    out
}

/// Put `text` on the general pasteboard.
#[cfg(target_os = "macos")]
pub fn copy_to_clipboard(text: &str) -> Result<(), String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    // SAFETY: an AppKit constant, read and never written.
    let kind = unsafe { NSPasteboardTypeString };
    if pasteboard.setString_forType(&NSString::from_str(text), kind) {
        Ok(())
    } else {
        Err("the clipboard would not take the diagnostics".into())
    }
}

#[cfg(not(target_os = "macos"))]
pub fn copy_to_clipboard(_text: &str) -> Result<(), String> {
    Err("this platform has no clipboard Proscenium can write to yet".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::events::{CrashKind, ErrorCode};
    use std::fs;

    /// A Mac with a play at a known place in iCloud Drive, a writer's own
    /// format, a learned name, an error and a crash — every kind of thing a
    /// careless line could leak.
    #[test]
    fn diagnostics_name_no_play_no_path_and_no_word() {
        let tmp = tempfile::tempdir().unwrap();
        // Detection compares real paths, and a temp dir's is under /private.
        let root = tmp.path().canonicalize().unwrap();
        let home = root.join("home-alexandra");
        let plays = home.join("Library/Mobile Documents/com~apple~CloudDocs/Writing/Stageworks");
        fs::create_dir_all(plays.join("Hamlet")).unwrap();
        fs::write(plays.join("Hamlet/Hamlet.proscenium"), "{}").unwrap();
        let config = root.join("config");
        let data = root.join("data");
        fs::create_dir_all(&config).unwrap();
        fs::write(
            config.join("settings.json"),
            serde_json::json!({
                "lastVault": plays.to_string_lossy(),
                "lastVaultBookmark": "Ym9va21hcms=",
                "lastPlay": "Hamlet",
                "openAtLaunch": "lastPlay",
                "learnedWords": ["Ophelia", "Rosencrantz"],
                "defaultFormat": "hamlet-house-style",
                "accent": "velvet",
                "shareAnalytics": false,
            })
            .to_string(),
        )
        .unwrap();
        errors::append(&data.join(super::super::ERROR_LOG), ErrorCode::PlayOpen, chrono::Utc::now()).unwrap();
        let record = crash::make_record(CrashKind::RustPanic, "RustPanic", vec![crash::Frame { function: Some("proscenium_lib::vault::save".into()), lineno: Some(120), colno: None }], "0.9.1", "15.6", "aarch64", chrono::Utc::now());
        crash::write(&data.join(super::super::CRASH_DIR), &record).unwrap();

        let formats = ["dg-modern".to_string(), "hamlet-house-style".to_string()];
        let facts = gather(&Sources {
            config_dir: &config,
            data_dir: &data,
            home: &home,
            is_icloud_item: &|_| false,
            formats_in_use: &formats,
            version: "1.0.0",
            channel: Channel::DeveloperId,
            arch: "aarch64",
            os: "macOS 15.6.1",
            can_send: true,
        });
        let text = text(&facts);

        for said in [
            "1.0.0 (developer-id)",
            "macOS 15.6.1, Apple silicon (aarch64)",
            "velvet",
            "dg-modern, user",
            "New plays in  user",
            "iCloud Drive",
            "opens to where the writer left off",
            "usage and crash reports off",
            "E-PLAY-OPEN",
            "rust_panic  1 stack frames  in 0.9.1",
        ] {
            assert!(text.contains(said), "diagnostics do not say {said:?}:\n{text}");
        }
        let root = root.to_string_lossy().to_string();
        let temp = tmp.path().to_string_lossy().to_string();
        for leak in [
            root.as_str(),
            temp.as_str(),
            "/Users",
            "home-alexandra",
            "Mobile Documents",
            "CloudDocs",
            "Writing",
            "Stageworks",
            "Hamlet",
            "hamlet",
            "Ophelia",
            "Rosencrantz",
            "Ym9va21hcms",
            ".proscenium",
        ] {
            assert!(!text.contains(leak), "diagnostics hold {leak:?}:\n{text}");
        }

    }

    #[test]
    fn nothing_chosen_and_nothing_wrong_reads_plainly() {
        let tmp = tempfile::tempdir().unwrap();
        let facts = gather(&Sources {
            config_dir: tmp.path(),
            data_dir: tmp.path(),
            home: tmp.path(),
            is_icloud_item: &|_| false,
            formats_in_use: &[],
            version: "1.0.0",
            channel: Channel::AppStore,
            arch: "x86_64",
            os: "macOS 14.7",
            can_send: false,
        });
        let text = text(&facts);
        for said in [
            "(app-store)",
            "Intel (x86_64)",
            "gilt",
            "none open",
            "the default format",
            "not chosen yet",
            "reports disabled and sends nothing",
            "Recent errors, newest first\n  none",
            "Crashes on this Mac\n  none",
        ] {
            assert!(text.contains(said), "{said:?}:\n{text}");
        }
    }

}
