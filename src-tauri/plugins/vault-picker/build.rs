// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// No frontend-facing commands: the app's own `vault_pick_folder` is the only
// caller, and it goes through the plugin's Rust API. An empty COMMANDS list
// means there is no permission surface to keep in sync.
const COMMANDS: &[&str] = &[];

fn main() {
    // Tauri hands swift-rs an iOS floor of 13.0 unless this is set
    // (tauri-utils `link_swift_library`), but the app's floor is iPadOS 17.0
    // (docs/engineering/cross-platform.md#PLAT-26) and `UTType.folder` — the
    // type the folder picker opens with — is 14+. Without this the Swift is
    // compiled against a floor the app never ships, as it is for the iOS
    // compile gate, which runs outside Xcode. Inside Xcode's build the app
    // target's own 17.0 is set already. Package.swift declares .iOS(.v17) to
    // match; swift-rs takes the triple from here, not from there, so both are
    // needed.
    if std::env::var_os("IPHONEOS_DEPLOYMENT_TARGET").is_none() {
        std::env::set_var("IPHONEOS_DEPLOYMENT_TARGET", "17.0");
    }

    // `android_path` is deliberately absent — there is no Kotlin side yet
    // (cross-platform.md §Android), and naming a directory that does not exist
    // fails the build.
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
