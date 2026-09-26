// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The update path, run as the app runs it on every `cargo test`: the pinned
//! updater's check against a manifest, the signature verified against the
//! key, and the installer's check against this copy's version, through the
//! one function `fetch` calls ([`take_offer`]), and then the install into a
//! scratch bundle. Only the transport is swapped, for loopback, which the
//! allowlist refuses; nothing here touches a real app, vault or network.
//!
//! It exists because every copy built from 2026-09-23 refused every update:
//! the installer's check compared the offer with itself, and each part had a
//! test of its own that passed (f8b7da7). Here the parts run together.
//!
//! The fixtures are three small signed archives and the public half of a
//! throwaway updater key, whose private half was deleted once they were
//! signed: `fixtures/Proscenium_<version>.app.tar.gz(.sig)`.
use super::*;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};

const ID: &str = "org.habiby.proscenium";

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src/updates/tests/fixtures")
}

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixtures().join(name)).unwrap()
}

fn pubkey() -> String {
    // The key file as `tauri signer generate` writes it: base64 of minisign's public key.
    String::from_utf8(fixture("test-updater.pub")).unwrap().trim().to_string()
}

/// A loopback server: `/manifest` answers `manifest`, `/archive` answers `archive`.
fn serve(manifest: impl Fn(u16) -> Option<serde_json::Value> + Send + 'static, archive: Vec<u8>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request = String::new();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            if reader.read_line(&mut request).is_err() {
                continue;
            }
            // Drain the headers.
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
                line.clear();
            }
            let path = request.split_whitespace().nth(1).unwrap_or("");
            let (status, body) = match path {
                "/manifest" => match manifest(port) {
                    Some(value) => ("200 OK", serde_json::to_vec(&value).unwrap()),
                    None => ("204 No Content", Vec::new()),
                },
                "/archive" => ("200 OK", archive.clone()),
                _ => ("404 Not Found", Vec::new()),
            };
            let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
            let _ = stream.write_all(&body);
        }
    });
    port
}

/// The manifest the service answers for `version`, signed by `signature`.
fn offer(version: &str, signature: &str) -> impl Fn(u16) -> Option<serde_json::Value> + Send + 'static {
    let (version, signature) = (version.to_string(), signature.to_string());
    move |port| {
        let platform = serde_json::json!({ "signature": signature, "url": format!("http://127.0.0.1:{port}/archive") });
        Some(serde_json::json!({
            "version": version,
            "pub_date": "2026-09-26T12:00:00Z",
            "platforms": { "darwin-aarch64": platform.clone(), "darwin-x86_64": platform },
        }))
    }
}

/// download.rs's verification over loopback: the body is bounded and its
/// signature checked exactly as the app's own transport does.
struct Loopback;

impl Transport for Loopback {
    async fn archive(&self, update: &Update, pubkey: &str, progress: impl FnMut(usize, Option<u64>)) -> Result<Vec<u8>, UpdaterError> {
        let response = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build()?
            .get(update.download_url.clone()).send().await?.error_for_status()?;
        download::verified_body(response, &update.signature, pubkey, progress).await
    }
}

fn app() -> tauri::App<tauri::test::MockRuntime> {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.config_mut().plugins.0.insert("updater".into(), serde_json::json!({
        "pubkey": pubkey(), "dangerousInsecureTransportProtocol": true, "endpoints": []
    }));
    tauri::test::mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(context).unwrap()
}

/// What [`take_offer`] answers, and the progress it reported: the offer's version and bytes so far.
type Taken = (Result<Option<(Update, Vec<u8>)>, UpdaterError>, Vec<(String, u64)>);

/// What a copy on `this` makes of `manifest`, served with `archive`: the offer
/// taken, as `fetch` takes it, and the progress it reported.
fn take(this: &str, manifest: impl Fn(u16) -> Option<serde_json::Value> + Send + 'static, archive: Vec<u8>) -> Taken {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let port = serve(manifest, archive);
    let app = app();
    let endpoint = reqwest::Url::parse(&format!("http://127.0.0.1:{port}/manifest")).unwrap();
    let mut seen = Vec::new();
    let result = tauri::async_runtime::block_on(take_offer(
        app.handle(), &[endpoint], "26.0", None, this, &pubkey(), ID, &Loopback,
        || Ok(()),
        |offered, received, _| seen.push((offered.to_string(), received)),
    ));
    (result, seen)
}

/// The installed bundle's whole version, after installing `bytes` over a copy of `this`.
fn install_over(this: &str, update: &Update, bytes: &[u8]) -> String {
    let dir = tempfile::tempdir().unwrap();
    let bundle = dir.path().join("Proscenium.app");
    std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
    std::fs::write(bundle.join("Contents/MacOS/proscenium"), b"the copy before").unwrap();
    install::install(&bundle, bytes, ID, &update.version, this).unwrap();
    let plist = plist::Value::from_file(bundle.join("Contents/Info.plist")).unwrap();
    let dict = plist.as_dictionary().unwrap();
    dict.get(crate::version::KEY).or(dict.get("CFBundleShortVersionString")).and_then(plist::Value::as_string).unwrap().to_string()
}

#[test]
fn a_newer_version_is_taken_and_installs_on_every_track() {
    for (this, offered) in [
        ("1.0.0", "1.1.0"),                   // stable to stable
        ("1.0.1-alpha.57", "1.0.1-alpha.58"), // alpha to alpha
        ("1.0.0", "1.0.1-alpha.58"),          // stable, switched to alpha
        ("1.0.1-alpha.58", "1.0.1"),          // alpha to the release that supersedes it
        ("0.9.1-alpha.380", "1.1.0"),         // the alpha that could not update
    ] {
        let name = format!("Proscenium_{offered}.app.tar.gz");
        let signature = String::from_utf8(fixture(&format!("{name}.sig"))).unwrap();
        let (result, progress) = take(this, offer(offered, &signature), fixture(&name));
        let (update, bytes) = result
            .unwrap_or_else(|e| panic!("{this} refused {offered}: {e}"))
            .unwrap_or_else(|| panic!("{this} found nothing newer than itself in {offered}"));
        assert_eq!(update.version, offered);
        assert_eq!(bytes, fixture(&name));
        // The page is told the offer's version, never this copy's.
        assert!(progress.iter().all(|(v, _)| v == offered), "{progress:?}");
        assert_eq!(progress.last().map(|(_, n)| *n), Some(bytes.len() as u64));
        assert_eq!(install_over(this, &update, &bytes), offered, "{this} → {offered}");
    }
}

#[test]
fn the_same_or_an_older_version_is_up_to_date() {
    let name = "Proscenium_1.1.0.app.tar.gz";
    let signature = String::from_utf8(fixture(&format!("{name}.sig"))).unwrap();
    for this in ["1.1.0", "1.2.0", "1.1.1-alpha.3"] {
        let (result, progress) = take(this, offer("1.1.0", &signature), fixture(name));
        assert!(matches!(result, Ok(None)), "{this} was offered 1.1.0: {:?}", result.map(|o| o.map(|(u, _)| u.version)));
        assert!(progress.is_empty(), "{this} downloaded an update it should not take");
    }
    // Nothing published: up to date.
    let (result, _) = take("1.0.0", |_| None, Vec::new());
    assert!(matches!(result, Ok(None)));
}

#[test]
fn an_archive_is_refused_unless_it_is_the_signed_offer() {
    let name = "Proscenium_1.1.0.app.tar.gz";
    // Another archive's signature: thrown away, never installed.
    let other = String::from_utf8(fixture("Proscenium_1.0.1.app.tar.gz.sig")).unwrap();
    let (result, _) = take("1.0.0", offer("1.1.0", &other), fixture(name));
    assert!(matches!(result, Err(UpdaterError::Minisign(_))), "{:?}", result.map(|o| o.is_some()));
    // Signed, but not the version the notice names: the installer's check refuses it.
    let alpha = "Proscenium_1.0.1-alpha.58.app.tar.gz";
    let signature = String::from_utf8(fixture(&format!("{alpha}.sig"))).unwrap();
    let (result, _) = take("1.0.0", offer("1.0.1-alpha.59", &signature), fixture(alpha));
    let message = result.map(|o| o.is_some()).unwrap_err().to_string();
    assert!(message.contains("does not match the update notice"), "{message}");
}
