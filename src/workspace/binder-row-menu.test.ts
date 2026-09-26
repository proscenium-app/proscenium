// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { rowMenuEntries } from "./BinderView";
import type { BinderItem } from "./play-file";

const document: BinderItem = {
  id: "d1",
  type: "document",
  title: "Notes",
  path: "Notes.md",
} as BinderItem;
const folder: BinderItem = {
  id: "f1",
  type: "folder",
  title: "Research",
  children: [],
} as unknown as BinderItem;

const entries = (item: BinderItem) =>
  rowMenuEntries(
    item,
    { onDelete: () => {}, onDuplicate: () => {}, onReveal: () => {}, onOpenInNewPane: () => {} },
    {
      create: () => {},
      rename: () => {},
      move: () => {},
    },
  );
const labelled = (item: BinderItem) =>
  entries(item).flatMap((e) =>
    "label" in e ? [[e.label, "shortcut" in e ? e.shortcut : undefined] as const] : [],
  );

describe("the binder's row menu", () => {
  test("says F2 beside Rename, the key that renames; Return opens the row", () => {
    // The menu said ⏎ for Rename while the binder's own handler opened the row
    // on ⏎ and renamed on F2 (onKeyDown in BinderView.tsx).
    for (const item of [document, folder]) {
      const rename = labelled(item).find(([label]) => label === "Rename");
      expect(rename?.[1]).toBe("F2");
      expect(labelled(item).some(([, shortcut]) => shortcut === "⏎")).toBe(false);
    }
  });
  test("a document opens in a new pane and duplicates; a folder does neither", () => {
    expect(labelled(document).map(([label]) => label)).toEqual([
      "Open in New Pane",
      "New",
      "Rename",
      "Move…",
      "Duplicate",
      "Reveal in Finder",
      "Move to Trash",
    ]);
    expect(labelled(folder).map(([label]) => label)).toEqual([
      "New",
      "Rename",
      "Move…",
      "Reveal in Finder",
      "Move to Trash",
    ]);
  });
  test("the shortcuts it shows are the binder's own keys", () => {
    const shown = Object.fromEntries(
      labelled(document)
        .filter(([, s]) => s)
        .map(([l, s]) => [l, s]),
    );
    expect(shown).toEqual({ Rename: "F2", Duplicate: "⌘D", "Move to Trash": "⌘⌫" });
  });
});
