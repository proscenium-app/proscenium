// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
use super::*;
fn draft() -> Draft { Draft { message: "I wish the binder remembered its width".into(), ..Draft::default() } }
#[test]
fn draft_lives_in_app_data_and_keeps_id_on_retry_and_relaunch() {
    let tmp = tempfile::tempdir().unwrap(); let app_data = tmp.path().join("AppData"); let plays = tmp.path().join("Plays");
    std::fs::create_dir_all(&plays).unwrap();
    let first = keep(&app_data, draft(), true).unwrap();
    let restored = read(&app_data).unwrap().unwrap();
    assert_eq!(restored.draft, draft()); assert_eq!(first.id, restored.id);
    assert_eq!(keep(&app_data, draft(), true).unwrap().id, first.id);
    assert_eq!(std::fs::read_dir(&plays).unwrap().count(), 0);
    assert!(uuid::Uuid::parse_str(first.id.as_ref().unwrap()).is_ok());
    let mut edited = draft(); edited.message.push('!');
    assert_ne!(keep(&app_data, edited, true).unwrap().id, first.id);
    keep(&app_data, Draft::default(), false).unwrap(); assert!(read(&app_data).unwrap().is_none());
}
#[test]
fn only_the_selected_fields_cross_the_wire_and_details_never_enter_the_draft() {
    let tmp = tempfile::tempdir().unwrap(); let mut d = draft();
    let saved = keep(tmp.path(), d.clone(), true).unwrap();
    let value = serde_json::to_value(message(&saved, Some("private details")).unwrap()).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 2); assert!(value.get("email").is_none()); assert!(value.get("details").is_none());
    d.email = " writer@example.org ".into(); d.include_details = true;
    let saved = keep(tmp.path(), d, true).unwrap();
    let value = serde_json::to_value(message(&saved, Some("reviewed details")).unwrap()).unwrap();
    assert_eq!(value["email"], "writer@example.org"); assert_eq!(value["details"], "reviewed details");
    assert!(!String::from_utf8(std::fs::read(tmp.path().join(FILE)).unwrap()).unwrap().contains("reviewed details"));
}
#[test]
fn unicode_is_counted_as_seen_and_never_truncated() {
    let tmp = tempfile::tempdir().unwrap(); let mut d = draft(); d.message = "👩🏽‍💻".repeat(10_000);
    let saved = keep(tmp.path(), d.clone(), true).unwrap(); assert!(message(&saved, None).is_ok());
    d.message.push('!'); let saved = keep(tmp.path(), d.clone(), true).unwrap(); assert!(message(&saved, None).is_err());
    assert_eq!(read(tmp.path()).unwrap().unwrap().draft.message, d.message);
}
#[test]
fn lost_answer_retries_the_same_body_and_requires_a_matching_receipt() {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap(); let address = format!("http://{}", listener.local_addr().unwrap());
    let tmp = tempfile::tempdir().unwrap(); let first = keep(tmp.path(), draft(), true).unwrap(); let id = first.id.clone().unwrap();
    let server = std::thread::spawn(move || {
        let mut received = Vec::new();
        for attempt in 0..3 {
            let (mut stream, _) = listener.accept().unwrap(); let mut reader = BufReader::new(stream.try_clone().unwrap()); let mut length = 0;
            loop { let mut line = String::new(); reader.read_line(&mut line).unwrap(); if line == "\r\n" { break; }
                assert!(!line.to_lowercase().starts_with("user-agent:")); assert!(!line.to_lowercase().starts_with("cookie:"));
                if let Some(v) = line.to_lowercase().strip_prefix("content-length:") { length = v.trim().parse().unwrap(); }
            }
            let mut bytes = vec![0; length]; reader.read_exact(&mut bytes).unwrap(); received.push(bytes);
            if attempt == 0 { continue; } // Stored remotely, answer lost.
            let body = serde_json::json!({ "id": if attempt == 1 { "wrong-id" } else { &id } }).to_string();
            write!(stream, "HTTP/1.1 201 Created\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        }
        assert_eq!(received[0], received[1]); assert_eq!(received[1], received[2]);
    });
    tauri::async_runtime::block_on(async {
        for attempt in 0..3 {
            let saved = keep(tmp.path(), draft(), true).unwrap(); let body = message(&saved, None).unwrap();
            let result = deliver(&address, &body).await;
            if attempt < 2 { assert!(result.is_err()); assert!(read(tmp.path()).unwrap().is_some()); }
            else { result.unwrap(); remove(tmp.path()).unwrap(); }
        }
    });
    server.join().unwrap(); assert!(read(tmp.path()).unwrap().is_none());
}
/// The live proof (docs/app/preferences-and-help/feedback.md#FEED-D10), run by hand and never by the gates: the
/// app's own client, in whatever profile the test is built with, sends one
/// message to the production list, then repeats it as a lost-answer Try Again
/// would. The writer's address comes from the environment.
/// `PROSCENIUM_FEEDBACK_LIVE=<writer address> cargo test --release
/// live_feedback_reaches_the_list -- --ignored --nocapture`, then check the
/// printed id with `edge-wrangler.mjs query feedback-receipts` (services/edge/README.md).
#[test]
#[ignore = "sends one real message to feedback.proscenium.ink; see services/edge/README.md"]
fn live_feedback_reaches_the_list() {
    let email = std::env::var("PROSCENIUM_FEEDBACK_LIVE").expect("the writer's address for the reply check");
    let tmp = tempfile::tempdir().unwrap();
    let mut d = draft(); d.email = email; d.include_details = true;
    let saved = keep(tmp.path(), d, true).unwrap();
    let details = "Live proof of the native feedback client; no diagnostics were gathered.";
    let body = message(&saved, Some(details)).unwrap();
    tauri::async_runtime::block_on(async {
        deliver(crate::telemetry::allowlist::FEEDBACK, &body).await.expect("a matching 201 receipt");
        deliver(crate::telemetry::allowlist::FEEDBACK, &body).await.expect("the same receipt for a repeat");
    });
    println!("submission id: {}", body.id);
}
