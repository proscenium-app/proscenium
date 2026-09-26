// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=PROSCENIUM_REPORTS");
    if env::var_os("CARGO_FEATURE_SELFTEST").is_some() {
        selftest_assets();
    }
    tauri_build::build();
}

/// What a `selftest` build embeds (src/selftest.rs), so the test app is whole on
/// its own — copy it to a borrowed Intel Mac and it runs, with no checkout:
///
/// - sample-vault/, as a table of (relative path, bytes)
/// - the in-page harness scripts/build-app.mjs bundled from
///   scripts/selftest/harness.mjs
///
/// Nothing here runs for any other build.
fn selftest_assets() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let vault = manifest
        .join("../sample-vault")
        .canonicalize()
        .expect("selftest: sample-vault/ is missing");
    println!("cargo:rerun-if-changed={}", vault.display());

    let mut files = Vec::new();
    collect(&vault, &vault, &mut files);
    files.sort();
    let mut table = String::from("&[\n");
    for (rel, abs) in &files {
        table.push_str(&format!("    ({rel:?}, include_bytes!({abs:?})),\n"));
    }
    table.push_str("]\n");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out.join("selftest_vault.rs"), table).expect("selftest: write the vault table");

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
    println!("cargo:rustc-env=PROSCENIUM_SELFTEST_HARNESS={}", harness.display());
}

/// Every file under `dir`, skipping dotfiles (a `.DS_Store` is not the fixture).
fn collect(root: &Path, dir: &Path, files: &mut Vec<(String, String)>) {
    for entry in fs::read_dir(dir).expect("selftest: read sample-vault/") {
        let path = entry.expect("selftest: read sample-vault/").path();
        if path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
            continue;
        }
        if path.is_dir() {
            collect(root, &path, files);
        } else {
            let rel = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            files.push((rel, path.to_string_lossy().to_string()));
        }
    }
}
