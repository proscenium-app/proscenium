// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Bounded daily-count batches to our service. No key, identifier or event timestamp.

use std::collections::VecDeque;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::{json, Map, Value};

use super::allowlist;
use super::events::{Channel, Event};

/// Events held while they cannot be sent.
pub const HELD: usize = 100;
/// Events in one request.
pub const BATCH: usize = 25;
/// Events expire after seven days, even if the Mac stays open offline.
pub const OLDEST: chrono::TimeDelta = chrono::TimeDelta::days(7);

/// What every event carries besides its own properties.
#[derive(Debug, Clone)]
pub struct Context {
    pub app_version: String,
    pub os_name: &'static str,
    pub os_version: String,
    /// `aarch64` or `x86_64`: the slice of the universal binary running.
    pub arch: &'static str,
    pub channel: Channel,
}

/// An event waiting to be sent.
#[derive(Debug, Clone)]
pub struct Pending {
    pub event: Event,
    pub at: DateTime<Utc>,
}

#[derive(Debug, Default)]
pub struct Queue {
    items: VecDeque<Pending>,
}

impl Queue {
    pub fn push(&mut self, pending: Pending) {
        while self.items.len() >= HELD {
            self.items.pop_front();
        }
        self.items.push_back(pending);
    }

    /// The next batch to send, oldest first, after dropping what is too old.
    pub fn take_batch(&mut self, now: DateTime<Utc>) -> Vec<Pending> {
        self.items.retain(|p| now - p.at < OLDEST);
        let n = self.items.len().min(BATCH);
        self.items.drain(..n).collect()
    }

    /// A batch that could not be sent, back at the front, still within [`HELD`].
    pub fn put_back(&mut self, batch: Vec<Pending>) {
        for pending in batch.into_iter().rev() {
            self.items.push_front(pending);
        }
        while self.items.len() > HELD {
            self.items.pop_front();
        }
    }

    pub fn clear(&mut self) {
        self.items.clear();
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.items.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}

/// OS granularity is major/minor only; full local diagnostics stay local.
pub fn os_version(full: &str) -> String {
    full.split('.').take(2).collect::<Vec<_>>().join(".")
}

/// Batch dimensions once; events carry only their closed name and properties.
pub fn body(batch: &[Pending], context: &Context) -> String {
    let events: Vec<Value> = batch
        .iter()
        .map(|pending| {
            let props: Map<String, Value> = pending
                .event
                .props()
                .into_iter()
                .map(|(key, value)| (key.to_string(), Value::String(value)))
                .collect();
            json!({ "name": pending.event.name(), "props": props })
        })
        .collect();
    json!({ "version": context.app_version, "platform": "darwin", "arch": context.arch,
        "os": os_version(&context.os_version), "channel": context.channel.as_str(), "events": events }).to_string()
}

/// How a request went.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Sent,
    /// No network, a timeout, or the server's own trouble: worth holding.
    Wait,
    /// The service refused fields it cannot accept.
    Refused,
}

pub struct Client {
    endpoint: String,
    crash_endpoint: String,
    http: reqwest::Client,
}

impl Client {
    pub fn of_this_build() -> Option<Self> {
        (option_env!("PROSCENIUM_REPORTS") == Some("1") && !cfg!(debug_assertions))
            .then(Self::new)
            .flatten()
    }

    pub fn new() -> Option<Self> {
        if !allowlist::may_contact(allowlist::REPORTS_EVENTS)
            || !allowlist::may_contact(allowlist::CRASH_ENVELOPE)
        {
            return None;
        }
        Self::to(
            allowlist::REPORTS_EVENTS.to_string(),
            allowlist::CRASH_ENVELOPE.to_string(),
        )
    }

    /// Tests use loopback servers; production endpoints come only from the allowlist.
    pub(super) fn to(endpoint: String, crash_endpoint: String) -> Option<Self> {
        // reqwest is built without a crypto provider of its own; ring is the one
        // the updater installs too, so whichever asks first, both agree.
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let http = reqwest::Client::builder()
            // A redirect would send to a destination outside the reviewed protocol.
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .ok()?;
        Some(Client {
            endpoint,
            crash_endpoint,
            http,
        })
    }

    pub async fn send(&self, body: String, timeout: Duration) -> Outcome {
        self.post(
            &self.endpoint,
            "application/json",
            body.into_bytes(),
            timeout,
        )
        .await
    }

    pub async fn send_crash(&self, body: Vec<u8>, timeout: Duration) -> Outcome {
        self.post(
            &self.crash_endpoint,
            "application/x-sentry-envelope",
            body,
            timeout,
        )
        .await
    }

    async fn post(
        &self,
        endpoint: &str,
        content_type: &str,
        body: Vec<u8>,
        timeout: Duration,
    ) -> Outcome {
        let request = self
            .http
            .post(endpoint)
            .header("Content-Type", content_type)
            .timeout(timeout)
            .body(body);
        match request.send().await {
            Ok(response) if response.status().is_success() => Outcome::Sent,
            Ok(response)
                if response.status().is_server_error() || response.status().as_u16() == 429 =>
            {
                Outcome::Wait
            }
            Ok(_) => Outcome::Refused,
            Err(_) => Outcome::Wait,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::events::{Channel, ErrorCode, PlaysBucket};
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    fn context() -> Context {
        Context {
            app_version: "1.0.0".into(),
            os_name: "macOS",
            os_version: "15.6.1".into(),
            arch: "aarch64",
            channel: Channel::DeveloperId,
        }
    }

    fn pending(event: Event, at: DateTime<Utc>) -> Pending {
        Pending { event, at }
    }

    /// The live proof for usage counts, run by hand and never by the gates: one
    /// `app_launched` through the app's own client to reports.proscenium.ink.
    /// It adds one to that day's count, which Status records as a proof.
    /// `PROSCENIUM_REPORTS_LIVE=<admitted version> cargo test --release
    /// live_usage_counts_reach_the_service -- --ignored`
    #[test]
    #[ignore = "adds one app_launched to the production counts; see services/edge/README.md"]
    fn live_usage_counts_reach_the_service() {
        let version =
            std::env::var("PROSCENIUM_REPORTS_LIVE").expect("an admitted release version");
        let context = Context {
            app_version: version,
            os_name: "macOS",
            os_version: "26.6".into(),
            arch: "aarch64",
            channel: Channel::DeveloperId,
        };
        let client = Client::new().expect("the allowlisted client");
        let batch = [pending(Event::AppLaunched, Utc::now())];
        assert_eq!(
            tauri::async_runtime::block_on(
                client.send(body(&batch, &context), Duration::from_secs(30))
            ),
            Outcome::Sent
        );
    }

    #[test]
    fn the_batch_has_only_the_published_dimensions_and_closed_events() {
        let batch = [pending(
            Event::PlayOpened {
                plays: PlaysBucket::of(4),
            },
            Utc::now(),
        )];
        let sent: Value = serde_json::from_str(&body(&batch, &context())).unwrap();
        assert_eq!(
            sent,
            json!({"version":"1.0.0","platform":"darwin","arch":"aarch64","os":"15.6",
            "channel":"developer-id","events":[{"name":"play_opened","props":{"plays":"2-5"}}]})
        );
    }

    #[test]
    fn the_queue_holds_a_hundred_and_nothing_stale() {
        let now = Utc::now();
        let mut queue = Queue::default();
        for _ in 0..130 {
            queue.push(pending(Event::FormatSaved, now));
        }
        assert_eq!(queue.len(), HELD);

        // Batches of 25, oldest first.
        let mut queue = Queue::default();
        queue.push(pending(
            Event::ErrorShown {
                code: ErrorCode::Save,
            },
            now - chrono::TimeDelta::days(8),
        ));
        queue.push(pending(
            Event::AppLaunched,
            now - chrono::TimeDelta::minutes(5),
        ));
        for _ in 0..30 {
            queue.push(pending(Event::FormatSaved, now));
        }
        let batch = queue.take_batch(now);
        assert_eq!(batch.len(), BATCH);
        assert_eq!(
            batch[0].event.name(),
            "app_launched",
            "the eight-day-old event was dropped"
        );
        assert_eq!(queue.len(), 6);

        // A failed batch goes back in front, and the total stays within HELD.
        for _ in 0..90 {
            queue.push(pending(Event::FormatSaved, now));
        }
        queue.put_back(batch);
        assert_eq!(queue.len(), HELD);
        queue.clear();
        assert!(queue.is_empty());
    }

    /// A one-request server on this machine: answers `status` and hands back
    /// what it was sent.
    fn server(status: u16) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/events", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = v.trim().parse().unwrap();
                }
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let mut stream = stream;
            write!(
                stream,
                "HTTP/1.1 {status} X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            format!("{head}{}", String::from_utf8(body).unwrap())
        });
        (url, handle)
    }

    fn send_to(url: String, body: &str) -> Outcome {
        let client = Client::to(url.clone(), url).unwrap();
        tauri::async_runtime::block_on(client.send(body.to_string(), Duration::from_secs(5)))
    }

    #[test]
    fn a_request_carries_no_identifier_or_key() {
        let (url, answered) = server(200);
        assert_eq!(send_to(url, "[]"), Outcome::Sent);
        let request = answered.join().unwrap();
        let lower = request.to_ascii_lowercase();
        assert!(
            request.starts_with("POST /v1/events HTTP/1.1\r\n"),
            "{request}"
        );
        for header in [
            "app-key:",
            "user-agent:",
            "cookie:",
            "referer:",
            "accept-language:",
        ] {
            assert!(!lower.contains(header), "sent {header}\n{request}");
        }
        assert!(request.ends_with("\r\n\r\n[]"));
    }

    #[test]
    fn what_fails_is_held_or_dropped_by_why() {
        let (url, answered) = server(503);
        assert_eq!(send_to(url, "[]"), Outcome::Wait);
        answered.join().unwrap();

        let (url, answered) = server(400);
        assert_eq!(send_to(url, "[]"), Outcome::Refused);
        answered.join().unwrap();

        // Nobody listening: no network, as far as the client can tell.
        let closed = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        assert_eq!(
            send_to(format!("http://{closed}/v1/events"), "[]"),
            Outcome::Wait
        );
    }

    #[test]
    fn the_client_asks_only_the_listed_endpoint() {
        assert!(allowlist::may_contact(allowlist::REPORTS_EVENTS));
        let client = Client::new().unwrap();
        assert_eq!(client.endpoint, allowlist::REPORTS_EVENTS);
    }
}
