// swift-tools-version:5.3
// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "tauri-plugin-vault-picker",
    platforms: [
        .macOS(.v10_13),
        // v14, not v13: `UTType.folder` — the type the folder picker is opened
        // with — is iOS 14+. This also matches the app target's own 14.0 floor.
        .iOS(.v14),
    ],
    products: [
        // Products define the executables and libraries a package produces, and make them visible to other packages.
        .library(
            name: "tauri-plugin-vault-picker",
            type: .static,
            targets: ["tauri-plugin-vault-picker"]),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        // Targets are the basic building blocks of a package. A target can define a module or a test suite.
        // Targets can depend on other targets in this package, and on products in packages this package depends on.
        .target(
            name: "tauri-plugin-vault-picker",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)
