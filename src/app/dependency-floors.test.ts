// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

function atLeast(actual: string, minimum: string): boolean {
  if (!/^\d+\.\d+\.\d+$/.test(actual)) return false;
  const a = actual.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

test("A1 dependency triage: Tiptap stays aligned on a patched release", () => {
  const raw = readFileSync(new URL("../../bun.lock", import.meta.url), "utf8");
  const lock = ts.parseConfigFileTextToJson("bun.lock", raw).config as { packages: Record<string, [string, ...unknown[]]> };
  const versions = Object.entries(lock.packages).filter(([name]) => name.startsWith("@tiptap/"))
    .map(([, value]) => value[0].split("@").pop()!);
  expect(versions.length).toBeGreaterThan(5);
  expect(new Set(versions).size).toBe(1);
  for (const version of versions) expect(atLeast(version, "3.30.5")).toBe(true);
  // ProseMirror compares its node/fragment classes by identity. A nested old
  // copy can crash editing even when the Tiptap versions themselves match.
  for (const name of ["prosemirror-model", "prosemirror-view"]) {
    const copies = Object.keys(lock.packages).filter((key) => key === name || key.endsWith(`/${name}`));
    expect(copies).toEqual([name]);
  }
});

test("A1 dependency triage: every locked Rust dependency is above the reviewed advisory floor", () => {
  const lock = readFileSync(new URL("../../src-tauri/Cargo.lock", import.meta.url), "utf8");
  for (const [name, minimum] of [["rustls", "0.23.45"], ["quick-xml", "0.41.0"], ["anyhow", "1.0.103"]]) {
    const versions = [...lock.matchAll(new RegExp(`name = "${name}"\\nversion = "([^"]+)"`, "g"))].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) expect(atLeast(version, minimum)).toBe(true);
  }
});
