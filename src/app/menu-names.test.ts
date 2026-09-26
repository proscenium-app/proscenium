// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The menu bar (src-tauri/src/menu.rs) and the page's menus name the same
 * things the same way. The two live in different languages, so this reads
 * both sources: a sheet had two names, Edit Title Page… in the menu bar and
 * Edit Opening Pages… in the script-name menu, and nothing said so.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const menuBar = readFileSync(new URL("../../src-tauri/src/menu.rs", import.meta.url), "utf8");
const toolbar = readFileSync(new URL("./Toolbar.tsx", import.meta.url), "utf8");
const plays = readFileSync(new URL("./VaultScreen.tsx", import.meta.url), "utf8");

/** The label of a menu-bar item, from its `(id, label, accelerator)` row. */
const barItem = (id: string) => {
  const row = new RegExp(`\\("${id}",\\s*"([^"]+)",\\s*(None|Some\\("([^"]+)"\\))\\)`).exec(
    menuBar,
  );
  if (!row) throw new Error(`menu.rs has no item ${id}`);
  return { label: row[1], accelerator: row[3] ?? null };
};

describe("one name for one thing, in the menu bar and the page", () => {
  test("the opening pages sheet is Edit Opening Pages… in both menus", () => {
    const inPage = /id: "opening-pages", label: "([^"]+)"/.exec(toolbar)?.[1];
    expect(inPage).toBe("Edit Opening Pages…");
    expect(barItem("title-page").label).toBe(inPage!);
  });
  test("New Play… is ⌘N in the menu bar, as the Plays screen's New Play menu shows", () => {
    expect(barItem("new-play").accelerator).toBe("CmdOrCtrl+N");
    expect(/label: "Blank Play", shortcut: "⌘N"/.test(plays)).toBe(true);
  });
  test("Export PDF… is one item with one chord", () => {
    expect(barItem("export-pdf")).toEqual({
      label: "Export PDF…",
      accelerator: "CmdOrCtrl+Shift+E",
    });
    expect(
      /label: a\.exporting \? "Exporting…" : "Export PDF…",\s*shortcut: "⌘⇧E"/.test(toolbar),
    ).toBe(true);
  });
});
