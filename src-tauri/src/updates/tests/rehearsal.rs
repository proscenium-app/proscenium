// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//! Headless proof against wrangler dev and release.mjs --rehearse. No window,
//! no live app or vault. All loopback exceptions exist only in this test module.
use super::*;

#[test]
#[ignore = "needs wrangler dev and release.mjs --rehearse; see services/edge/README.md"]
fn worker_and_unreachable_primary_both_install_a_verified_release() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let directory = std::path::PathBuf::from(
        std::env::var("PROSCENIUM_UPDATE_REHEARSAL").expect("artifact directory"),
    );
    let key = std::fs::read_to_string(directory.join("rehearsal.pub")).unwrap();
    let build: serde_json::Value =
        serde_json::from_slice(&std::fs::read(directory.join("build.json")).unwrap()).unwrap();
    assert_eq!(build["rehearsal"], true);
    let version = build["version"].as_str().unwrap();
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.package_info_mut().version = "0.0.0".parse().unwrap();
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": key.trim(), "dangerousInsecureTransportProtocol": true,
            "endpoints": ["http://127.0.0.1:8787/v1/darwin/aarch64/0.0.0"]
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    // The closed socket proves unreachability, without changing this Mac's DNS or firewall.
    let socket = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let unreachable = format!("http://{}/not-running", socket.local_addr().unwrap());
    drop(socket);
    for (name, endpoints, expected_port) in [
        (
            "worker",
            vec![
                "http://127.0.0.1:8787/v1/darwin/aarch64/0.0.0".to_string(),
                "http://127.0.0.1:8791/fallback/latest.json".to_string(),
            ],
            8787,
        ),
        (
            "fallback",
            vec![
                unreachable,
                "http://127.0.0.1:8791/fallback/latest.json".to_string(),
            ],
            8791,
        ),
    ] {
        let bundle = dir.path().join(format!("{name}.app"));
        std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
        std::fs::write(bundle.join("Contents/MacOS/proscenium"), b"old bundle").unwrap();
        // The mock executable path must look like a bundle to the pinned plugin.
        // metadata() uses current_exe; Tauri's plugin accepts a test executable outside .app too.
        tauri::async_runtime::block_on(async {
            let endpoints = endpoints
                .iter()
                .map(|s| reqwest::Url::parse(s).unwrap())
                .collect::<Vec<_>>();
            let update = metadata(
                app.handle(),
                &endpoints,
                "14.6",
                None,
                &semver::Version::new(0, 0, 0),
            )
            .await
            .unwrap()
            .expect("newer release");
            assert_eq!(update.version, version);
            assert_eq!(update.download_url.port(), Some(expected_port));
            let response = reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap()
                .get(update.download_url.clone())
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap();
            let bytes = download::verified_body(response, &update.signature, key.trim(), |_, _| {})
                .await
                .unwrap();
            install::install(&bundle, &bytes, "org.habiby.proscenium", version, "0.0.0").unwrap();
            let plist = plist::Value::from_file(bundle.join("Contents/Info.plist")).unwrap();
            assert_eq!(
                plist.as_dictionary().unwrap()["CFBundleShortVersionString"].as_string(),
                Some(version)
            );
            assert!(
                std::fs::metadata(bundle.join("Contents/MacOS/proscenium"))
                    .unwrap()
                    .len()
                    > 1_000_000
            );
        });
    }
}
