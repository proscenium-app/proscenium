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
  // rustfmt puts a row too long for one line on several, with a trailing comma.
  const row = new RegExp(
    `\\(\\s*"${id}",\\s*"([^"]+)",\\s*(None|Some\\("([^"]+)"\\)),?\\s*\\)`,
  ).exec(menuBar);
  if (!row) throw new Error(`menu.rs has no item ${id}`);
  return { label: row[1], accelerator: row[3] ?? null };
};

describe("one name for one thing, in the menu bar and the page", () => {
  test("Add Page… and Play Details… are one name each in both menus", () => {
    const gallery = /id: "add-front-page", label: "([^"]+)"/.exec(toolbar)?.[1];
    expect(gallery).toBe("Add Page…");
    expect(barItem("title-page").label).toBe(gallery!);
    const details = /id: "play-details", label: "([^"]+)"/.exec(toolbar)?.[1];
    expect(details).toBe("Play Details…");
    expect(barItem("play-details").label).toBe(details!);
  });
  test("Capitalize Character Names in Directions… is one name in both menus", () => {
    const inPage = /id: "cast-names",\s*label: "([^"]+)"/.exec(toolbar)?.[1];
    expect(inPage).toBe("Capitalize Character Names in Directions…");
    expect(barItem("cast-names").label).toBe(inPage!);
  });
  test("New Play… is ⌘N in the menu bar, as the Plays screen's New Play menu shows", () => {
    expect(barItem("new-play").accelerator).toBe("CmdOrCtrl+N");
    expect(/label: "Blank Play", shortcut: "⌘N"/.test(plays)).toBe(true);
  });
  test("Export Fountain… is one name in both menus, after Export .odt…", () => {
    // docs/app/formatting/formats-and-layout.md#FMT-171
    const inPage = /id: "export-fountain",\s*label: "([^"]+)"/.exec(toolbar)?.[1];
    expect(inPage).toBe("Export Fountain…");
    expect(barItem("export-fountain").label).toBe(inPage!);
    expect(barItem("export-fountain").accelerator).toBeNull();
    // Directly after it: no other item stands between the two in either menu.
    const between = (text: string, first: string, second: string) => {
      const from = text.indexOf(first);
      const to = text.indexOf(second);
      expect(from).toBeGreaterThan(-1);
      expect(to).toBeGreaterThan(from);
      return text.slice(from + first.length, to);
    };
    expect(between(menuBar, '("export-odt"', '("export-fountain"')).not.toContain('("');
    expect(between(toolbar, 'id: "export-odt"', 'id: "export-fountain"')).not.toContain("id:");
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
