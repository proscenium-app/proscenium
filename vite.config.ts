// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { webkitFloor } from "./scripts/webkit-floor.ts";
import { bakedRoll } from "./scripts/patrons.mjs";

// Tauri expects a fixed dev port and ignores the Rust source tree.
// See cross-platform.md — the frontend carries no platform branches.
export default defineConfig({
  plugins: [react()],
  // Settings › About's program of sponsors (docs/app/preferences-and-help/settings.md#SET-32):
  // a release fetches it before building and names the file here, so the app
  // never asks for it. Every other build has the empty roll.
  define: { __PROSCENIUM_PATRONS__: JSON.stringify(bakedRoll()) },
  // Tauri prints its own progress; don't let Vite wipe it.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust changes are handled by the Tauri CLI, not Vite HMR.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Produce a build the Tauri webview can load from disk.
  build: {
    // The oldest engine the app runs in — the macOS floor's own WebKit — so
    // esbuild lowers syntax and adds the prefixes that engine still needs. It
    // was `es2021`, which names no browser and so prefixed nothing: every
    // `user-select: none` shipped unprefixed, and WebKit has only ever read
    // `-webkit-user-select`. check:webkit-floor checks what esbuild cannot lower.
    target: webkitFloor().esbuildTarget,
    sourcemap: true,
    // The spell dictionary is fetched at runtime (src/spell/dictionary.ts), so
    // both halves must stay real files. en.aff is under the inline threshold
    // and would otherwise become a data: URL — which only ever reaches `fetch`
    // inside a webview, and is a needless thing to depend on there.
    assetsInlineLimit: (filePath) =>
      filePath.endsWith(".aff") || filePath.endsWith(".dic") ? false : undefined,
  },
});
