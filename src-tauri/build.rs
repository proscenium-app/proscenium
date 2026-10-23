// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=PROSCENIUM_REPORTS");
    // Whether this build sends reports (telemetry/client.rs), as one cfg that
    // both its behaviour and its mark in the binary read: scripts/check-bundle.mjs
    // `--reports` reads the mark, so a release's privacy answers and its binary
    // cannot part.
    println!("cargo:rustc-check-cfg=cfg(proscenium_reports)");
    if env::var("PROSCENIUM_REPORTS").as_deref() == Ok("1") {
        println!("cargo:rustc-cfg=proscenium_reports");
    }
    // A Windows track build's whole version (version.rs).
    println!("cargo:rerun-if-env-changed=PROSCENIUM_VERSION");
    // The Mac's self-test runs in the page, with these inside the app; the
    // Windows test build is driven from outside and embeds neither.
    if env::var_os("CARGO_FEATURE_SELFTEST").is_some()
        && env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
    {
        selftest_assets();
    }
    tauri_build::build();
}

/// What a `selftest` build embeds (src/selftest.rs), so the test app is whole on
/// its own — copy it to a borrowed Intel Mac and it runs, with no checkout:
///
/// - sample-vault/, as a table of (relative path, bytes)
/// - sample-outside/, the files a check opens from outside the Plays folder, the same way
/// - the in-page harness scripts/build-app.mjs bundled from
///   scripts/selftest/harness.mjs
///
/// Nothing here runs for any other build.
fn selftest_assets() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    for (folder, table) in [
        ("sample-vault", "selftest_vault.rs"),
        ("sample-outside", "selftest_outside.rs"),
    ] {
        let dir = manifest
            .join("..")
            .join(folder)
            .canonicalize()
            .unwrap_or_else(|_| panic!("selftest: {folder}/ is missing"));
        println!("cargo:rerun-if-changed={}", dir.display());
        let mut files = Vec::new();
        collect(&dir, &dir, &mut files);
        files.sort();
        let mut text = String::from("&[\n");
        for (rel, abs) in &files {
            text.push_str(&format!("    ({rel:?}, include_bytes!({abs:?})),\n"));
        }
        text.push_str("]\n");
        fs::write(out.join(table), text)
            .unwrap_or_else(|_| panic!("selftest: write the table of {folder}/"));
    }

    println!("cargo:rerun-if-env-changed=PROSCENIUM_SELFTEST_HARNESS");
    let harness = env::var_os("PROSCENIUM_SELFTEST_HARNESS")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest.join("target/selftest/harness.js"));
    if !harness.is_file() {
        panic!(
            "selftest: no harness at {} — build a self-test app with `node scripts/build-app.mjs --selftest`, \
             which bundles it first",
            harness.display()
        );
    }
    println!("cargo:rerun-if-changed={}", harness.display());
    println!(
        "cargo:rustc-env=PROSCENIUM_SELFTEST_HARNESS={}",
        harness.display()
    );
}

/// Every file under `dir`, skipping dotfiles (a `.DS_Store` is not the fixture).
fn collect(root: &Path, dir: &Path, files: &mut Vec<(String, String)>) {
    for entry in fs::read_dir(dir).expect("selftest: read a sample folder") {
        let path = entry.expect("selftest: read a sample folder").path();
        if path
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with('.'))
        {
            continue;
        }
        if path.is_dir() {
            collect(root, &path, files);
        } else {
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            files.push((rel, path.to_string_lossy().to_string()));
        }
    }
}
