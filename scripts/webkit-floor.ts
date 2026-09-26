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
