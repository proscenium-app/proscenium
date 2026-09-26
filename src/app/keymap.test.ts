// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shortcut overlay is generated from `keymap.ts`, so the only way it can
 * lie is if the editor stops binding something the table still advertises.
 * This reads the extension's own keyboard shortcuts and checks every mirrored
 * entry against them.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { SHORTCUTS } from "./keymap";
import { LEADER_ELEMENTS } from "../editor/leader-key";

const entrySource = ["../editor/element-entry.ts", "../editor/spellcheck.ts"]
  .map((f) => readFileSync(new URL(f, import.meta.url), "utf8"))
  .join("\n");

describe("keymap table", () => {
  it("every mirrored binding is still bound by the editor", () => {
    const mirrored = SHORTCUTS.filter((s) => s.binding);
    expect(mirrored.length).toBeGreaterThan(10);
    for (const s of mirrored) {
      expect(entrySource).toContain(`"${s.binding}"`);
    }
  });

  it("every element with a ⌘⌥ key is listed under Elements", () => {
    // The leader menu (`;`) and the ⌘⌥ keys reach the same elements by two
    // routes. Anything reachable by a chord has to appear in the sheet; the
    // leader-only ones (= synopsis, n note, > centered) are taught by the menu
    // itself, which draws its own key badges.
    const listed = SHORTCUTS.filter((s) => s.group === "Elements").map((s) =>
      s.what.toLowerCase().replace(/\s+/g, ""),
    );
    const chorded = Object.values(LEADER_ELEMENTS).filter(
      (n) => !["synopsis", "note", "centered"].includes(n),
    );
    for (const name of chorded) {
      expect(listed).toContain(name.toLowerCase());
    }
  });

  it("no two rows claim the same keys", () => {
    const keys = SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
