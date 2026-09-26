// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Pathless stack records. Neither the panic payload nor a symbol's filename is read.
use super::events::{CrashKind, Version};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const KEPT: usize = 20;
pub const MAX_FRAMES: usize = 64;
const MAX_FILE: u64 = 64 * 1024;
const PAGE_ERRORS_PER_LAUNCH: usize = 10;
pub const ERROR_NAMES: &[&str] = &[
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "EvalError",
    "URIError",
    "AggregateError",
    "InternalError",
    "UnhandledRejection",
    "PageError",
    "AbortError",
    "DataCloneError",
    "InvalidStateError",
    "NotFoundError",
    "NotAllowedError",
    "NotSupportedError",
    "SecurityError",
    "QuotaExceededError",
    "NetworkError",
    "TimeoutError",
    "InvalidCharacterError",
    "HierarchyRequestError",
    "IndexSizeError",
];
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Frame {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lineno: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colno: Option<u64>,
}
/// Page IPC accepts numbers only, never a URL, filename or arbitrary function name.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PageFrame {
    pub lineno: u64,
    pub colno: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CrashRecord {
    pub id: String,
    pub kind: CrashKind,
    pub name: String,
    pub version: String,
    pub os: String,
    pub arch: String,
    pub frames: Vec<Frame>,
    /// Local time only. The envelope rounds to the UTC day.
    pub at: String,
}
struct Target {
    dir: PathBuf,
    version: String,
    os: String,
    arch: String,
}
static TARGET: Mutex<Option<Target>> = Mutex::new(None);
static PAGE_SEEN: Mutex<Option<HashSet<String>>> = Mutex::new(None);
fn number(v: u64) -> bool {
    (1..=10_000_000).contains(&v)
}
fn symbol_allowed(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 256
        && s.contains("::")
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_:<>, &[](){}#;!?=-".contains(&c))
}
fn os_allowed(s: &str) -> bool {
    let parts: Vec<_> = s.split('.').collect();
    parts.len() == 2
        && parts[0]
            .parse::<u32>()
            .is_ok_and(|n| (14..=99).contains(&n))
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 2
                && (p.len() == 1 || !p.starts_with('0'))
                && p.bytes().all(|c| c.is_ascii_digit())
        })
}
impl CrashRecord {
    pub fn valid(&self) -> bool {
        uuid::Uuid::parse_str(&self.id).is_ok_and(|id| {
            id.get_version_num() == 4
                && id.get_variant() == uuid::Variant::RFC4122
                && id.to_string() == self.id
        }) && Version::parse(&self.version).is_some()
            && os_allowed(&self.os)
            && ["aarch64", "x86_64"].contains(&self.arch.as_str())
            && DateTime::parse_from_rfc3339(&self.at).is_ok()
            && match self.kind {
                CrashKind::RustPanic => self.name == "RustPanic",
                CrashKind::JsError => ERROR_NAMES.contains(&self.name.as_str()),
            }
            && !self.frames.is_empty()
            && self.frames.len() <= MAX_FRAMES
            && self.frames.iter().all(|f| {
                f.function.as_ref().map_or(true, |s| {
                    self.kind == CrashKind::RustPanic && symbol_allowed(s)
                }) && f.lineno.map_or(true, number)
                    && f.colno.map_or(true, number)
                    && (f.function.is_some() || f.lineno.is_some())
            })
    }
    pub fn recent(&self, now: DateTime<Utc>) -> bool {
        self.valid()
            && DateTime::parse_from_rfc3339(&self.at).is_ok_and(|at| {
                let age = now.signed_duration_since(at);
                age >= chrono::TimeDelta::zero() && age < super::client::OLDEST
            })
    }
}
pub fn set_target(dir: PathBuf, version: String, os: String, arch: String) {
    if let Ok(mut target) = TARGET.lock() {
        *target = Some(Target {
            dir,
            version,
            os,
            arch,
        });
    }
}
fn native_frames() -> Vec<Frame> {
    let mut frames = Vec::new();
    backtrace::trace(|frame| {
        backtrace::resolve_frame(frame, |symbol| {
            if frames.len() >= MAX_FRAMES {
                return;
            }
            let function = symbol
                .name()
                .map(|name| name.to_string())
                .filter(|s| symbol_allowed(s));
            // No filename(), address(), registers, memory or panic message.
            let lineno = symbol.lineno().map(u64::from).filter(|n| number(*n));
            let colno = symbol.colno().map(u64::from).filter(|n| number(*n));
            if function.is_some() || lineno.is_some() {
                frames.push(Frame {
                    function,
                    lineno,
                    colno,
                });
            }
        });
        frames.len() < MAX_FRAMES
    });
    frames
}
pub fn install_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Ok(target) = TARGET.try_lock() {
            if let Some(t) = target.as_ref() {
                let record = make_record(
                    CrashKind::RustPanic,
                    "RustPanic",
                    native_frames(),
                    &t.version,
                    &t.os,
                    &t.arch,
                    Utc::now(),
                );
                let _ = write(&t.dir, &record);
            }
        }
        previous(info);
    }));
}
pub fn make_record(
    kind: CrashKind,
    name: &str,
    frames: Vec<Frame>,
    version: &str,
    os: &str,
    arch: &str,
    at: DateTime<Utc>,
) -> CrashRecord {
    CrashRecord {
        id: uuid::Uuid::new_v4().to_string(),
        kind,
        name: name.to_string(),
        frames,
        version: version.to_string(),
        os: super::client::os_version(os),
        arch: arch.to_string(),
        at: at.to_rfc3339_opts(SecondsFormat::Secs, true),
    }
}
pub fn write_page_error(
    dir: &Path,
    name: &str,
    frames: Vec<PageFrame>,
    context: &super::client::Context,
) -> io::Result<Option<PathBuf>> {
    let name = if ERROR_NAMES.contains(&name) {
        name
    } else {
        "Error"
    };
    let frames: Vec<Frame> = frames
        .into_iter()
        .take(MAX_FRAMES)
        .filter(|f| number(f.lineno) && number(f.colno))
        .map(|f| Frame {
            function: None,
            lineno: Some(f.lineno),
            colno: Some(f.colno),
        })
        .collect();
    if frames.is_empty() {
        return Ok(None);
    }
    let key = serde_json::to_string(&(name, &frames)).map_err(io::Error::other)?;
    {
        let mut seen = PAGE_SEEN.lock().unwrap_or_else(|p| p.into_inner());
        let seen = seen.get_or_insert_with(HashSet::new);
        if seen.contains(&key) || seen.len() >= PAGE_ERRORS_PER_LAUNCH {
            return Ok(None);
        }
        seen.insert(key);
    }
    write(
        dir,
        &make_record(
            CrashKind::JsError,
            name,
            frames,
            &context.app_version,
            &context.os_version,
            context.arch,
            Utc::now(),
        ),
    )
    .map(Some)
}
pub fn write(dir: &Path, record: &CrashRecord) -> io::Result<PathBuf> {
    if !record.valid() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Invalid stack record",
        ));
    }
    fs::create_dir_all(dir)?;
    let path = dir.join(format!("{}-{}.json", record.at.replace(':', ""), record.id));
    // A panic may interrupt this write. A torn record is skipped on the next launch.
    fs::write(&path, serde_json::to_vec(record).map_err(io::Error::other)?)?;
    let files = files(dir);
    for old in files.iter().take(files.len().saturating_sub(KEPT)) {
        let _ = fs::remove_file(old);
    }
    Ok(path)
}
fn files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<_> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    files
}
pub fn read_all(dir: &Path) -> Vec<(PathBuf, CrashRecord)> {
    files(dir)
        .into_iter()
        .rev()
        .take(KEPT)
        .filter_map(|path| {
            if fs::metadata(&path).ok()?.len() > MAX_FILE {
                return None;
            }
            use std::io::Read;
            let mut bytes = Vec::new();
            fs::File::open(&path)
                .ok()?
                .take(MAX_FILE + 1)
                .read_to_end(&mut bytes)
                .ok()?;
            if bytes.len() as u64 > MAX_FILE {
                return None;
            }
            let record: CrashRecord = serde_json::from_slice(&bytes).ok()?;
            record.valid().then_some((path, record))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn sample(at: DateTime<Utc>) -> CrashRecord {
        make_record(
            CrashKind::RustPanic,
            "RustPanic",
            vec![Frame {
                function: Some("proscenium_lib::vault::save".into()),
                lineno: Some(120),
                colno: None,
            }],
            "1.0.0",
            "15.6",
            "aarch64",
            at,
        )
    }
    #[test]
    fn the_panic_hook_keeps_stack_symbols_without_message_or_paths() {
        let dir = tempfile::tempdir().unwrap();
        set_target(
            dir.path().to_owned(),
            "1.0.0".into(),
            "15.6".into(),
            "aarch64".into(),
        );
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        install_hook();
        let outcome = std::panic::catch_unwind(|| {
            panic!("could not write /Users/synthetic/Plays/Secret.fountain")
        });
        let _ = std::panic::take_hook();
        std::panic::set_hook(previous);
        *TARGET.lock().unwrap() = None;
        assert!(outcome.is_err());
        let records = read_all(dir.path());
        assert!(!records.is_empty());
        let raw = serde_json::to_string(&records[0].1).unwrap();
        for forbidden in [
            "could not write",
            "/Users",
            "synthetic",
            "Secret",
            ".fountain",
            ".rs",
            "\"filename\"",
            "\"abs_path\"",
            "\"message\"",
        ] {
            assert!(!raw.contains(forbidden), "{forbidden}");
        }
        assert!(records[0].1.frames.iter().any(|f| f
            .function
            .as_ref()
            .is_some_and(|s| s.contains("the_panic_hook"))));
    }
    #[test]
    fn local_files_are_bounded_and_revalidated_before_any_payload() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        for i in 0..25 {
            write(dir.path(), &sample(now + chrono::TimeDelta::seconds(i))).unwrap();
        }
        assert_eq!(read_all(dir.path()).len(), KEPT);
        let mut bad = sample(now);
        bad.frames[0].function = Some("/Users/synthetic/Secret".into());
        assert!(write(dir.path(), &bad).is_err());
        let mut json = serde_json::to_value(sample(now)).unwrap();
        json["message"] = "Secret".into();
        fs::write(
            dir.path().join("zz-invalid.json"),
            serde_json::to_vec(&json).unwrap(),
        )
        .unwrap();
        assert!(!read_all(dir.path())
            .iter()
            .any(|(p, _)| p.ends_with("zz-invalid.json")));
        assert!(!sample(now - chrono::TimeDelta::days(8)).recent(now));
        assert!(!sample(now + chrono::TimeDelta::days(1)).recent(now));
        assert!(sample(now).recent(now));
    }
    /// The live proof for crash reports (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D4), run by
    /// hand and never by the gates. A real panic goes through the app's own
    /// hook, is encoded as its SDK envelope and sent to reports.proscenium.ink,
    /// which forwards it to Sentry. The panic message names a play the report
    /// must never carry; check the event in Sentry by the printed id.
    /// `PROSCENIUM_CRASH_LIVE=<admitted version> cargo test --release
    /// live_crash_report_reaches_sentry -- --ignored --nocapture`
    #[test]
    #[ignore = "sends one real crash report to reports.proscenium.ink; see services/edge/README.md"]
    fn live_crash_report_reaches_sentry() {
        let version = std::env::var("PROSCENIUM_CRASH_LIVE").expect("an admitted release version");
        let dir = tempfile::tempdir().unwrap();
        set_target(
            dir.path().to_owned(),
            version,
            "26.6".into(),
            std::env::consts::ARCH.into(),
        );
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        install_hook();
        let outcome = std::panic::catch_unwind(|| {
            panic!("could not write /Users/synthetic/Plays/Live Proof.fountain")
        });
        let _ = std::panic::take_hook();
        std::panic::set_hook(previous);
        *TARGET.lock().unwrap() = None;
        assert!(outcome.is_err());
        let (_, record) = read_all(dir.path())
            .into_iter()
            .next()
            .expect("the hook wrote a record");
        let envelope = super::super::envelope::encode(&record).expect("an envelope");
        let text = String::from_utf8(envelope.clone()).unwrap();
        for forbidden in [
            "could not write",
            "/Users",
            "synthetic",
            "Live Proof",
            ".fountain",
            ".rs\"",
            "\"message\"",
            "\"user\"",
        ] {
            assert!(!text.contains(forbidden), "{forbidden}");
        }
        let client = super::super::client::Client::new().expect("the allowlisted client");
        let sent = tauri::async_runtime::block_on(
            client.send_crash(envelope, std::time::Duration::from_secs(30)),
        );
        assert_eq!(sent, super::super::client::Outcome::Sent);
        println!(
            "event id: {} ({} frames)",
            record.id.replace('-', ""),
            record.frames.len()
        );
    }
    #[test]
    fn frames_have_no_place_for_text_from_the_page() {
        assert!(
            serde_json::from_str::<PageFrame>(r#"{"lineno":1,"colno":2,"function":"Secret"}"#)
                .is_err()
        );
        let mut r = sample(Utc::now());
        r.kind = CrashKind::JsError;
        r.name = "TypeError".into();
        assert!(!r.valid());
        r.frames[0].function = None;
        assert!(r.valid());
        r.name = "Ophelia".into();
        assert!(!r.valid());
        r.name = "Error".into();
        r.frames.clear();
        assert!(!r.valid());
    }
}
