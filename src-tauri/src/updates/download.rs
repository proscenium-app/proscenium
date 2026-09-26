// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! docs/app/keeping-work/privacy-and-telemetry.md#PRIV-12: bounded archive transport, using the pinned updater's exact
//! minisign verification format. Metadata still uses the plugin's comparator.

use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{redirect::Policy, Client, Response, Url};
use tauri_plugin_updater::{Error, Update};

const MAX_ARCHIVE: usize = 512 * 1024 * 1024;

pub fn allowed(url: &Url) -> bool {
    crate::telemetry::allowlist::update_url_allowed(url)
}

/// A request carrying alpha's key follows no redirect at all: the Worker
/// serves alpha itself, and a key must not be carried to wherever a Location
/// points.
pub fn redirects_for(keyed: bool) -> Policy {
    if keyed {
        Policy::none()
    } else {
        redirects()
    }
}

pub fn redirects() -> Policy {
    Policy::custom(|attempt| {
        if attempt.previous().len() >= 5
            || !crate::telemetry::allowlist::update_redirect_allowed(
                attempt.previous(),
                attempt.url(),
            )
        {
            attempt.error("the update redirected outside its permitted hosts")
        } else {
            attempt.follow()
        }
    })
}

fn refused(message: &str) -> Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message).into()
}

pub async fn archive(
    update: &Update,
    key: &str,
    progress: impl FnMut(usize, Option<u64>),
) -> Result<Vec<u8>, Error> {
    if !allowed(&update.download_url) {
        return Err(refused("the update archive address is not permitted"));
    }
    let keyed = update.headers.contains_key(super::TRACK_KEY_HEADER);
    let response = Client::builder()
        .redirect(redirects_for(keyed))
        .timeout(super::DOWNLOAD_TIMEOUT)
        .build()?
        .get(update.download_url.clone())
        .headers(update.headers.clone())
        .send()
        .await?
        .error_for_status()?;
    // A redirect a keyed request would not follow is not an archive.
    if !response.status().is_success() {
        return Err(refused("the update archive did not answer"));
    }
    verified_body(response, &update.signature, key, progress).await
}

pub(super) async fn verified_body(
    response: Response,
    signature: &str,
    key: &str,
    progress: impl FnMut(usize, Option<u64>),
) -> Result<Vec<u8>, Error> {
    let bytes = body(response, MAX_ARCHIVE, progress).await?;
    verify(&bytes, signature, key)?;
    Ok(bytes)
}

async fn body(
    mut response: Response,
    maximum: usize,
    mut progress: impl FnMut(usize, Option<u64>),
) -> Result<Vec<u8>, Error> {
    let total = response.content_length();
    if total.is_some_and(|n| n > maximum as u64) {
        return Err(refused("the update archive exceeds its size limit"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > maximum.saturating_sub(bytes.len()) {
            return Err(refused("the update archive exceeds its size limit"));
        }
        progress(chunk.len(), total);
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn verify(bytes: &[u8], signature: &str, key: &str) -> Result<(), Error> {
    let decode = |value: &str| -> Result<String, Error> {
        String::from_utf8(STANDARD.decode(value)?)
            .map_err(|_| Error::SignatureUtf8("invalid signing data".into()))
    };
    let key = minisign_verify::PublicKey::decode(&decode(key)?)?;
    let signature = minisign_verify::Signature::decode(&decode(signature)?)?;
    key.verify(bytes, &signature, true)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn transport_stops_at_the_limit_even_without_content_length() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        for response in [
            "HTTP/1.1 200 OK\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n",
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n8\r\n12345678\r\n8\r\nabcdefgh\r\n0\r\n\r\n",
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let _ = stream.read(&mut [0; 1024]);
                stream.write_all(response.as_bytes()).unwrap();
            });
            tauri::async_runtime::block_on(async {
                let response = Client::new().get(format!("http://{address}/")).send().await.unwrap();
                let mut seen = 0;
                assert!(body(response, 10, |n, _| seen += n).await.is_err());
                assert!(seen <= 10);
            });
            server.join().unwrap();
        }
    }

    #[test]
    fn an_unapproved_redirect_never_reaches_its_socket() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = stream.read(&mut [0; 1024]);
            write!(stream, "HTTP/1.1 302 Found\r\nLocation: http://{address}/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            drop(stream);
            std::thread::sleep(std::time::Duration::from_millis(100));
            listener.set_nonblocking(true).unwrap();
            assert_eq!(
                listener.accept().unwrap_err().kind(),
                std::io::ErrorKind::WouldBlock
            );
        });
        tauri::async_runtime::block_on(async {
            assert!(Client::builder()
                .redirect(redirects())
                .build()
                .unwrap()
                .get(format!("http://{address}/"))
                .send()
                .await
                .is_err());
        });
        server.join().unwrap();
        assert!(verify(b"untrusted", "invalid", "invalid").is_err());
    }

    /// Alpha's key never follows a Location anywhere, even one the ordinary
    /// rules would allow: the redirect comes back unfollowed, and nothing
    /// reaches its target.
    #[test]
    fn a_keyed_request_follows_no_redirect() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = stream.read(&mut [0; 1024]);
            write!(stream, "HTTP/1.1 302 Found\r\nLocation: http://{address}/elsewhere\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
            drop(stream);
            std::thread::sleep(std::time::Duration::from_millis(100));
            listener.set_nonblocking(true).unwrap();
            assert_eq!(
                listener.accept().unwrap_err().kind(),
                std::io::ErrorKind::WouldBlock
            );
        });
        tauri::async_runtime::block_on(async {
            let response = Client::builder()
                .redirect(redirects_for(true))
                .build()
                .unwrap()
                .get(format!("http://{address}/"))
                .header(super::super::TRACK_KEY_HEADER, "k".repeat(43))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 302);
        });
        server.join().unwrap();
    }
}
