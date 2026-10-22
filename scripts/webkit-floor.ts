// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The oldest WebKit Proscenium promises to run in, declared ONCE.
 *
 * The webview is the system's WebKit, so the macOS floor IS the engine floor:
 * a Mac on Sonoma 14.0 that never took a Safari update renders the app with
 * Safari 17.0's engine. Three places used to state a floor and disagreed
 * — the plist said 10.13, the binary 11.0, the site 14 — so the
 * number lives in exactly one: `bundle.macOS.minimumSystemVersion` in
 * tauri.conf.json, which is also what Finder enforces. Vite's build target and
 * `check:webkit-floor` both derive from it here, so raising the floor is one
 * edit and lowering it cannot leave the CSS check behind.
 */
import tauri from "../src-tauri/tauri.conf.json";

/**
 * Each macOS release and the Safari it shipped with. A release that is not in
 * this table has no known engine, and the floor refuses to guess.
 */
export const SAFARI_FOR_MACOS: Readonly<Record<number, number>> = {
  14: 17,
  15: 18,
  26: 26,
};

export interface WebkitFloor {
  /** `minimumSystemVersion`, e.g. "14.0". */
  macos: string;
  /** The Safari major that macOS release shipped with, e.g. 17 (meaning 17.0). */
  safari: number;
  /** The same floor as an esbuild/Vite target, e.g. "safari17". */
  esbuildTarget: string;
}

/**
 * The oldest WebView2 Proscenium promises to run in on Windows, by its Chromium
 * version (WebView2 is numbered as Edge is, and Edge as Chromium):
 * docs/engineering/release-engineering.md#REL-127.
 *
 * On Windows 10 22H2 and Windows 11 the webview is WebView2's Evergreen
 * runtime, which Microsoft updates by itself, a new major version every few
 * weeks, and keeps updating on Windows 10 22H2 until at least October 2028;
 * the installer gives a PC without one the current runtime. So no Windows
 * release fixes the engine the way a macOS release fixes Safari's, and the
 * floor is a runtime that has stopped updating: 131, which GitHub's
 * windows-2022 image still carried in September 2026, about two years behind
 * the current one and well past the two versions an administrator's policy
 * can hold WebView2 back. The page is clean far below it: as on Safari,
 * `color-mix()` (Chromium 111) is what binds first.
 *
 * It is not given to Tauri as `minimumWebview2Version`: the installer would
 * then update an older runtime itself, which asks for an administrator, and
 * the direct download never does.
 */
export const WEBVIEW2_FLOOR = 131;

export function webkitFloor(): WebkitFloor {
  const macos = tauri.bundle.macOS.minimumSystemVersion;
  const major = Number(macos.split(".")[0]);
  const safari = SAFARI_FOR_MACOS[major];
  if (!safari) {
    throw new Error(
      `webkit floor: macOS ${macos} has no entry in SAFARI_FOR_MACOS (scripts/webkit-floor.ts)`,
    );
  }
  return { macos, safari, esbuildTarget: `safari${safari}` };
}
