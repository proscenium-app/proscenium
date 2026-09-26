// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! What an analytics event can say (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3).
//!
//! **A closed set.** Every event is a variant of [`Event`], and every property
//! is an enum or a value checked here, so nothing a writer typed — a title, a
//! character's name, a path, a count exact enough to recognise a play — has a
//! type it could travel in. The page asks for events through [`PageEvent`],
//! which is closed the same way and refuses a field it does not know.
//!
//! App version, macOS version and architecture come with every event
//! (client.rs adds them); what each event adds of its own is [`Event::props`].

use serde::{Deserialize, Serialize};

/// Where this copy came from, which is also what updates it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// The download, signed with the Developer ID, updated by the app itself.
    DeveloperId,
    /// The Mac App Store's build, updated by the store.
    AppStore,
    /// Built on this Mac by `bun run app:install`, updated by nothing: an
    /// updater there would replace it with the next alpha.
    Local,
}

impl Channel {
    /// Only a download build carries the updater (Cargo.toml `updater`), and a
    /// local build says so with its own feature.
    pub fn of_this_build() -> Self {
        if cfg!(feature = "local") {
            Channel::Local
        } else if cfg!(feature = "updater") {
            Channel::DeveloperId
        } else {
            Channel::AppStore
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Channel::DeveloperId => "developer-id",
            Channel::AppStore => "app-store",
            Channel::Local => "local",
        }
    }
}

/// How many plays the Plays folder holds, never the number itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaysBucket {
    One,
    TwoToFive,
    SixToTwenty,
    TwentyOneOrMore,
}

impl PlaysBucket {
    /// A play opened from outside the Plays folder counts as the one.
    pub fn of(plays: u32) -> Self {
        match plays {
            0..=1 => PlaysBucket::One,
            2..=5 => PlaysBucket::TwoToFive,
            6..=20 => PlaysBucket::SixToTwenty,
            _ => PlaysBucket::TwentyOneOrMore,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            PlaysBucket::One => "1",
            PlaysBucket::TwoToFive => "2-5",
            PlaysBucket::SixToTwenty => "6-20",
            PlaysBucket::TwentyOneOrMore => "21+",
        }
    }
}

/// The places a writer works, as `surface_shown` names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Surface {
    Script,
    Board,
    Outline,
    Cast,
    Changes,
    FormatDesigner,
}

impl Surface {
    pub fn as_str(self) -> &'static str {
        match self {
            Surface::Script => "script",
            Surface::Board => "board",
            Surface::Outline => "outline",
            Surface::Cast => "cast",
            Surface::Changes => "changes",
            Surface::FormatDesigner => "format-designer",
        }
    }
}

/// What a PDF export printed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportKind {
    Whole,
    Range,
    Sides,
}

impl ExportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ExportKind::Whole => "whole",
            ExportKind::Range => "range",
            ExportKind::Sides => "sides",
        }
    }
}

/// The formats Proscenium ships, by id (formats/*.json; a test holds the two
/// lists together). Only these ids are ever sent.
pub const BUILT_IN_FORMATS: &[&str] = &[
    "dg-modern",
    "stage-us-modern",
    "stage-uk",
    "samuel-french",
    "dg-traditional",
    "dg-musical",
    "sketch-comedy",
];

/// A format as an event may name it: a built-in by its id, and every format a
/// writer made — whatever they called it — as `user`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormatRef {
    BuiltIn(&'static str),
    User,
}

impl FormatRef {
    /// The page says `user` for a writer's own format, including one that
    /// overrides a built-in's id; an id not on the built-in list is `user` here
    /// whatever the page said.
    pub fn from_page(id: &str) -> Self {
        BUILT_IN_FORMATS
            .iter()
            .find(|built_in| **built_in == id)
            .map_or(FormatRef::User, |built_in| FormatRef::BuiltIn(built_in))
    }

    pub fn as_str(self) -> &'static str {
        match self {
            FormatRef::BuiltIn(id) => id,
            FormatRef::User => "user",
        }
    }
}

/// A release version, `major.minor.patch` in digits and nothing else.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version(String);

impl Version {
    pub fn parse(v: &str) -> Option<Self> {
        let parts: Vec<&str> = v.split('.').collect();
        let digits = |p: &&str| {
            !p.is_empty()
                && p.len() <= 4
                && (p.len() == 1 || !p.starts_with('0'))
                && p.bytes().all(|b| b.is_ascii_digit())
        };
        (parts.len() == 3 && parts.iter().all(digits)).then(|| Version(v.to_string()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// How a crash was noticed (crash.rs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrashKind {
    RustPanic,
    JsError,
}

impl CrashKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CrashKind::RustPanic => "rust_panic",
            CrashKind::JsError => "js_error",
        }
    }
}

/// Declares the error codes once: the enum, its every value, and its spelling.
macro_rules! error_codes {
    ($($variant:ident => $code:literal: $what:literal,)*) => {
        /// The errors the app shows, by stable code (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5).
        /// `src/diagnostics/error-codes.ts` holds the same list, and its test
        /// reads this one.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        pub enum ErrorCode {
            $(#[doc = $what] #[serde(rename = $code)] $variant,)*
        }

        impl ErrorCode {
            #[cfg(test)]
            pub const ALL: &'static [ErrorCode] = &[$(ErrorCode::$variant,)*];

            pub fn as_str(self) -> &'static str {
                match self {
                    $(ErrorCode::$variant => $code,)*
                }
            }

            pub fn parse(code: &str) -> Option<Self> {
                match code {
                    $($code => Some(ErrorCode::$variant),)*
                    _ => None,
                }
            }
        }
    };
}

error_codes! {
    Boot => "E-BOOT": "The app could not start, and said so on screen.",
    FolderOpen => "E-FOLDER-OPEN": "A Plays folder could not be opened.",
    FolderRefused => "E-FOLDER-REFUSED": "A folder the app will not keep plays in: a play, inside a play, or kept by two sync services.",
    FolderAccess => "E-FOLDER-ACCESS": "A folder grant could not be renewed or saved for the next launch.",
    Icloud => "E-ICLOUD": "iCloud Drive is not available.",
    PlayOpen => "E-PLAY-OPEN": "A play could not be opened.",
    PlayMissing => "E-PLAY-MISSING": "A play is not in the Plays folder any more.",
    PlayCreate => "E-PLAY-CREATE": "A new play could not be made.",
    Save => "E-SAVE": "Words could not be saved.",
    SaveLocked => "E-SAVE-LOCKED": "Words could not be saved: the file, or its folder, is locked in Finder.",
    SavePermission => "E-SAVE-PERMISSION": "Words could not be saved: the Mac's user may not change the folder.",
    SaveNotAllowed => "E-SAVE-NOT-ALLOWED": "Words could not be saved: macOS refused, as it does for a view-only shared folder, a privacy setting or the sandbox.",
    SaveDiskFull => "E-SAVE-DISK-FULL": "Words could not be saved: the disk is full.",
    SaveReadOnly => "E-SAVE-READ-ONLY": "Words could not be saved: the disk is read-only.",
    SaveFolderGone => "E-SAVE-FOLDER-GONE": "Words could not be saved: the play's folder is not there.",
    SaveUnreachable => "E-SAVE-UNREACHABLE": "Words could not be saved: the disk or network drive did not respond.",
    ChangedOnDisk => "E-CHANGED-ON-DISK": "A file changed on disk underneath an edit.",
    Versions => "E-VERSIONS": "Versions could not keep or read a version.",
    Binder => "E-BINDER": "A change to the binder could not be made.",
    ActionStale => "E-ACTION-STALE": "An action arrived after the script or play it was for had closed, so nothing changed.",
    VaultRead => "E-VAULT-READ": "A file could not be read or found.",
    VaultPermission => "E-VAULT-PERMISSION": "macOS refused access to a file or folder.",
    ExportPdf => "E-EXPORT-PDF": "A PDF could not be exported.",
    ExportFont => "E-EXPORT-FONT": "The fonts a PDF embeds could not be loaded.",
    Print => "E-PRINT": "A script could not be printed.",
    FormatRead => "E-FORMAT-READ": "A format file could not be read.",
    FormatImport => "E-FORMAT-IMPORT": "A format could not be imported.",
    FormatExport => "E-FORMAT-EXPORT": "A format could not be exported.",
    FormatSave => "E-FORMAT-SAVE": "A format could not be saved.",
    FormatTrash => "E-FORMAT-TRASH": "A format could not be moved to the Trash, or put back.",
    FormatsFolder => "E-FORMATS-FOLDER": "The Formats folder could not be opened.",
    Reveal => "E-REVEAL": "Finder could not show a folder.",
    FinderOpen => "E-FINDER-OPEN": "Something opened from Finder could not be opened.",
    UpdateRestart => "E-UPDATE-RESTART": "An update could not restart the app.",
    Watch => "E-WATCH": "The play folder could not be watched for changes made outside.",
    Workspace => "E-WORKSPACE": "Any other error while working in a play.",
    Other => "E-OTHER": "An error the app showed without a code of its own.",
}

/// Every event Proscenium can send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    AppLaunched,
    PlayOpened { plays: PlaysBucket },
    SurfaceShown { surface: Surface },
    PdfExported { kind: ExportKind, format: FormatRef },
    FormatSaved,
    UpdateInstalled { from: Version, to: Version },
    ErrorShown { code: ErrorCode },
}

impl Event {
    pub fn name(&self) -> &'static str {
        match self {
            Event::AppLaunched => "app_launched",
            Event::PlayOpened { .. } => "play_opened",
            Event::SurfaceShown { .. } => "surface_shown",
            Event::PdfExported { .. } => "pdf_exported",
            Event::FormatSaved => "format_saved",
            Event::UpdateInstalled { .. } => "update_installed",
            Event::ErrorShown { .. } => "error_shown",
        }
    }

    /// The event's own properties, before the ones every event carries.
    pub fn props(&self) -> Vec<(&'static str, String)> {
        match self {
            Event::AppLaunched => vec![],
            Event::PlayOpened { plays } => vec![("plays", plays.as_str().into())],
            Event::SurfaceShown { surface } => vec![("surface", surface.as_str().into())],
            Event::PdfExported { kind, format } => {
                vec![
                    ("kind", kind.as_str().into()),
                    ("format", format.as_str().into()),
                ]
            }
            Event::FormatSaved => vec![],
            Event::UpdateInstalled { from, to } => {
                vec![("from", from.as_str().into()), ("to", to.as_str().into())]
            }
            Event::ErrorShown { code } => vec![("code", code.as_str().into())],
        }
    }
}

/// What the page may ask to be recorded: the events only the page sees happen.
/// The rest — launch, update, crash — are Rust's own.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(
    tag = "name",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PageEvent {
    /// A play opened, with the Plays folder's count — bucketed here, before
    /// anything is queued.
    PlayOpened {
        plays_in_folder: u32,
    },
    SurfaceShown {
        surface: Surface,
    },
    /// `format`: a built-in id, or `user`.
    PdfExported {
        kind: ExportKind,
        format: String,
    },
    /// Braces, not a unit variant: serde lets a unit variant carry any fields.
    FormatSaved {},
    /// Also kept in the local log of error codes, whatever the switch says.
    ErrorShown {
        code: ErrorCode,
    },
}

impl From<PageEvent> for Event {
    fn from(page: PageEvent) -> Self {
        match page {
            PageEvent::PlayOpened { plays_in_folder } => Event::PlayOpened {
                plays: PlaysBucket::of(plays_in_folder),
            },
            PageEvent::SurfaceShown { surface } => Event::SurfaceShown { surface },
            PageEvent::PdfExported { kind, format } => Event::PdfExported {
                kind,
                format: FormatRef::from_page(&format),
            },
            PageEvent::FormatSaved {} => Event::FormatSaved,
            PageEvent::ErrorShown { code } => Event::ErrorShown { code },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn one_of_each() -> Vec<Event> {
        vec![
            Event::AppLaunched,
            Event::PlayOpened {
                plays: PlaysBucket::of(3),
            },
            Event::SurfaceShown {
                surface: Surface::FormatDesigner,
            },
            Event::PdfExported {
                kind: ExportKind::Sides,
                format: FormatRef::User,
            },
            Event::FormatSaved,
            Event::UpdateInstalled {
                from: Version::parse("0.9.1").unwrap(),
                to: Version::parse("1.0.0").unwrap(),
            },
            Event::ErrorShown {
                code: ErrorCode::ExportFont,
            },
        ]
    }

    #[test]
    fn every_event_carries_exactly_its_documented_properties() {
        let documented: Vec<(&str, &[&str])> = vec![
            ("app_launched", &[]),
            ("play_opened", &["plays"]),
            ("surface_shown", &["surface"]),
            ("pdf_exported", &["kind", "format"]),
            ("format_saved", &[]),
            ("update_installed", &["from", "to"]),
            ("error_shown", &["code"]),
        ];
        let events = one_of_each();
        assert_eq!(events.len(), documented.len());
        for (event, (name, keys)) in events.iter().zip(&documented) {
            assert_eq!(event.name(), *name);
            let props: Vec<&str> = event.props().iter().map(|(k, _)| *k).collect();
            assert_eq!(props, *keys, "{name}");
        }
        let values: Vec<(&str, String)> = events.iter().flat_map(Event::props).collect();
        assert_eq!(
            values,
            [
                ("plays", "2-5"),
                ("surface", "format-designer"),
                ("kind", "sides"),
                ("format", "user"),
                ("from", "0.9.1"),
                ("to", "1.0.0"),
                ("code", "E-EXPORT-FONT"),
            ]
            .map(|(k, v)| (k, v.to_string()))
        );
    }

    /// The spec's table of events is the list shipped: an event added here and
    /// not there is an event nobody agreed to send.
    #[test]
    fn the_spec_lists_the_same_events() {
        let spec = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../docs/app/keeping-work/privacy-and-telemetry.md"),
        )
        .unwrap();
        let listed: BTreeSet<String> = spec
            .lines()
            .filter_map(|line| {
                line.trim_start()
                    .strip_prefix("| `")?
                    .split('`')
                    .next()
                    .map(str::to_string)
            })
            .collect();
        let shipped: BTreeSet<String> =
            one_of_each().iter().map(|e| e.name().to_string()).collect();
        assert_eq!(listed, shipped);
    }

    #[test]
    fn worker_choices_and_the_public_table_match_the_native_contract() {
        use serde_json::{json, Value};
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let worker: Value = serde_json::from_str(
            &std::fs::read_to_string(root.join("services/edge/events.json")).unwrap(),
        )
        .unwrap();
        let mut formats: Vec<_> = BUILT_IN_FORMATS.iter().map(|s| s.to_string()).collect();
        formats.push("user".into());
        let expected = json!({
            "app_launched": {},
            "play_opened": {"plays": ([PlaysBucket::One, PlaysBucket::TwoToFive, PlaysBucket::SixToTwenty, PlaysBucket::TwentyOneOrMore].map(PlaysBucket::as_str))},
            "surface_shown": {"surface": ([Surface::Script, Surface::Board, Surface::Outline, Surface::Cast, Surface::Changes, Surface::FormatDesigner].map(Surface::as_str))},
            "pdf_exported": {"kind": ([ExportKind::Whole, ExportKind::Range, ExportKind::Sides].map(ExportKind::as_str)), "format": formats},
            "format_saved": {}, "update_installed": {"from":["$released-version"], "to":["$released-version"]},
            "error_shown": {"code": ErrorCode::ALL.iter().map(|c| c.as_str()).collect::<Vec<_>>()}
        });
        assert_eq!(worker.as_object().unwrap().len(), one_of_each().len());
        for event in one_of_each() {
            let name = event.name();
            assert_eq!(worker[name]["props"], expected[name], "{name}");
            let why = worker[name]["why"]
                .as_str()
                .expect("every event needs its reason");
            assert!(!why.trim().is_empty());
            let spec = std::fs::read_to_string(
                root.join("docs/app/keeping-work/privacy-and-telemetry.md"),
            )
            .unwrap();
            let public = spec.split("<a id=\"PRIV-D7\"></a>").nth(1).unwrap();
            let row = public
                .lines()
                .find(|line| line.starts_with(&format!("| `{name}` |")))
                .expect("event appears in public table");
            assert!(row.contains(why), "public reason for {name}");
            for (key, choices) in worker[name]["props"].as_object().unwrap() {
                assert!(row.contains(&format!("`{key}`")));
                for choice in choices.as_array().unwrap() {
                    let value = choice.as_str().unwrap();
                    if value != "$released-version" {
                        assert!(row.contains(&format!("`{value}`")), "{name}/{key}/{value}");
                    }
                }
            }
        }
        let kinds: Vec<String> = serde_json::from_str(
            &std::fs::read_to_string(root.join("services/edge/crash-kinds.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(kinds, super::super::crash::ERROR_NAMES);
    }

    #[test]
    fn plays_are_counted_in_buckets() {
        let bucket = |n| PlaysBucket::of(n).as_str();
        assert_eq!([0, 1].map(bucket), ["1", "1"]);
        assert_eq!([2, 3, 5].map(bucket), ["2-5"; 3]);
        assert_eq!([6, 20].map(bucket), ["6-20"; 2]);
        assert_eq!([21, 400, u32::MAX].map(bucket), ["21+"; 3]);
    }

    #[test]
    fn the_page_can_ask_for_nothing_outside_the_list() {
        let parse = |json: &str| serde_json::from_str::<PageEvent>(json);
        assert_eq!(
            Event::from(parse(r#"{"name":"play_opened","playsInFolder":7}"#).unwrap()),
            Event::PlayOpened {
                plays: PlaysBucket::SixToTwenty
            }
        );
        assert_eq!(
            Event::from(parse(r#"{"name":"format_saved"}"#).unwrap()),
            Event::FormatSaved
        );
        assert_eq!(
            Event::from(parse(r#"{"name":"error_shown","code":"E-SAVE"}"#).unwrap()),
            Event::ErrorShown {
                code: ErrorCode::Save
            }
        );
        // A writer's own format goes as `user`, whatever it is called.
        assert_eq!(
            Event::from(
                parse(r#"{"name":"pdf_exported","kind":"range","format":"hamlet-house-style"}"#)
                    .unwrap()
            ),
            Event::PdfExported {
                kind: ExportKind::Range,
                format: FormatRef::User
            }
        );
        for refused in [
            r#"{"name":"play_opened","playsInFolder":3,"title":"Hamlet"}"#,
            r#"{"name":"surface_shown","surface":"Hamlet"}"#,
            r#"{"name":"error_shown","code":"could not open /Users/writer/Plays"}"#,
            r#"{"name":"format_saved","name2":"x"}"#,
            r#"{"name":"app_launched","channel":"developer-id"}"#,
            r#"{"name":"crash_reported","kind":"js_error","location":"x"}"#,
            r#"{"name":"anything"}"#,
            r#"{"playsInFolder":3}"#,
        ] {
            assert!(parse(refused).is_err(), "accepted {refused}");
        }
    }

    #[test]
    fn the_built_in_list_is_the_formats_folder() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../formats");
        let mut shipped: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| {
                let path = entry.ok()?.path();
                (path.extension()? == "json").then_some(path)
            })
            .map(|path| {
                let spec: serde_json::Value =
                    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
                spec["id"].as_str().unwrap().to_string()
            })
            .collect();
        shipped.sort();
        let mut listed: Vec<String> = BUILT_IN_FORMATS.iter().map(|s| s.to_string()).collect();
        listed.sort();
        assert_eq!(shipped, listed);
    }

    #[test]
    fn error_codes_are_stable_spellings() {
        let mut seen = BTreeSet::new();
        for code in ErrorCode::ALL {
            let s = code.as_str();
            assert!(
                s.starts_with("E-")
                    && s[2..]
                        .split('-')
                        .all(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_uppercase())),
                "{s}"
            );
            assert!(seen.insert(s), "{s} twice");
            assert_eq!(ErrorCode::parse(s), Some(*code));
            assert_eq!(serde_json::to_value(code).unwrap(), serde_json::json!(s));
        }
    }

    #[test]
    fn versions_are_digits_only() {
        assert!(Version::parse("1.0.0").is_some());
        for bad in [
            "",
            "1.0",
            "1.0.0-rc.1",
            "v1.0.0",
            "1.0.0 ",
            "/Users/a/1.0.0",
        ] {
            assert!(Version::parse(bad).is_none(), "{bad:?}");
        }
    }
}
