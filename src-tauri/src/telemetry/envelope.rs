// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//! Sentry SDK protocol types, with no SDK client or automatic integrations.
use sentry_types::protocol::v7::{Envelope, Event, Exception, Frame, Level, Stacktrace};
use super::{crash::CrashRecord, events::CrashKind};

pub fn encode(record: &CrashRecord) -> Option<Vec<u8>> {
    if !record.valid() { return None; }
    let at = chrono::DateTime::parse_from_rfc3339(&record.at).ok()?.with_timezone(&chrono::Utc);
    let midnight = at.date_naive().and_hms_opt(0, 0, 0)?.and_utc();
    let native = record.kind == CrashKind::RustPanic;
    let frames: Vec<_> = record.frames.iter().map(|frame| Frame {
        module: Some(if native { "native" } else { "webview" }.into()), function: frame.function.clone(),
        lineno: frame.lineno, colno: frame.colno, ..Default::default()
    }).collect();
    let event = Event {
        event_id: record.id.parse().ok()?, level: Level::Fatal,
        release: Some(record.version.clone().into()), platform: if native { "native" } else { "javascript" }.into(),
        timestamp: midnight.into(),
        tags: [("app_platform".into(), "darwin".into()), ("arch".into(), record.arch.clone()), ("os".into(), record.os.clone())].into(),
        exception: vec![Exception { ty: record.name.clone(), stacktrace: Stacktrace::from_frames_reversed(frames), ..Default::default() }].into(),
        ..Default::default()
    };
    let mut envelope = Envelope::new(); envelope.add_item(event);
    let mut bytes = Vec::new(); envelope.to_writer(&mut bytes).ok()?;
    (bytes.len() <= 64 * 1024).then_some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_sdk_envelope_has_only_the_published_keys() {
        let mut record = super::super::crash::make_record(CrashKind::JsError, "TypeError", vec![super::super::crash::Frame { function: None, lineno: Some(1), colno: Some(234) }], "1.0.0", "15.6.1", "aarch64", chrono::DateTime::parse_from_rfc3339("2026-09-18T12:34:56Z").unwrap().with_timezone(&chrono::Utc));
        record.id = "f17cbfa4-3761-44e4-b4cf-ff6c2537960f".into();
        let raw = encode(&record).unwrap(); let text = String::from_utf8(raw).unwrap();
        let lines: Vec<_> = text.lines().collect(); assert_eq!(lines.len(), 3);
        let event: serde_json::Value = serde_json::from_str(lines[2]).unwrap();
        let keys: Vec<_> = event.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["event_id", "exception", "level", "platform", "release", "tags", "timestamp"]);
        assert_eq!(event["timestamp"].as_f64().unwrap() % 86400.0, 0.0);
        assert_eq!(event["exception"]["values"][0], serde_json::json!({"type":"TypeError", "stacktrace":{"frames":[{"module":"webview","lineno":1,"colno":234}]}}));
        let item: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(item, serde_json::json!({"type":"event","length":lines[2].len()}));
        let fixture = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../services/edge/test/fixtures/crash.envelope");
        assert_eq!(std::fs::read_to_string(fixture).unwrap(), text, "the Worker tests consume the real SDK envelope");
    }
}
