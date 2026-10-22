// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, mock } from "bun:test";
import type { BinderItem } from "../workspace";

// syncAppearances writes through the vault, so the storage barrel is a map here.
const store = new Map<string, string>();
const hashOf = (s: string) => `h${s.length}:${s.slice(-8)}`;
mock.module("../storage", () => ({
  vault: {
    async exists(rel: string) {
      return store.has(rel);
    },
    async read(rel: string) {
      const content = store.get(rel)!;
      return { content, hash: hashOf(content) };
    },
    async write(rel: string, content: string) {
      store.set(rel, content);
      return { status: "ok", hash: hashOf(content) };
    },
  },
}));

const { castSheetFor, castSheets, isCastSheet } = await import("./cast-sheets");
const { syncAppearances } = await import("./appearances-sync");

/** A play that put its first draft's character sheets away in an archive folder. */
const binder: BinderItem[] = [
  { id: "script", type: "script", path: "The Weight of Water.fountain" },
  {
    id: "chars",
    type: "folder",
    path: "Characters",
    children: [
      { id: "mara", type: "character", path: "Characters/Mara.md" },
      {
        id: "leads",
        type: "folder",
        path: "Characters/Leads",
        children: [{ id: "jonah", type: "character", path: "Characters/Leads/Jonah.md" }],
      },
      { id: "cast-notes", type: "document", path: "Characters/Casting.md" },
    ],
  },
  {
    id: "archive",
    type: "folder",
    path: "Archive",
    children: [
      {
        id: "old",
        type: "folder",
        path: "Archive/First draft",
        children: [
          {
            id: "old-chars",
            type: "folder",
            path: "Archive/First draft/Characters",
            children: [
              { id: "old-ruth", type: "character", path: "Archive/First draft/Characters/Ruth.md" },
              { id: "old-mara", type: "character", path: "Archive/First draft/Characters/mara.md" },
            ],
          },
        ],
      },
    ],
  },
  { id: "loose", type: "character", path: "Ezra.md" },
];

describe("the sheets the cast binds to (docs/app/organizing/workspace-model.md#WORK-84)", () => {
  it("are the character sheets under the Characters folder, at any depth", () => {
    expect(castSheets(binder).map((it) => it.id)).toEqual(["mara", "jonah"]);
  });

  it("leave out a sheet filed away with an old draft, even in a folder named Characters", () => {
    const old = {
      id: "old-ruth",
      type: "character",
      path: "Archive/First draft/Characters/Ruth.md",
    } as const;
    expect(isCastSheet(old)).toBe(false);
    expect(castSheetFor(binder, "RUTH")).toBeNull();
  });

  it("leave out a sheet loose at the play's root, and a document in the folder", () => {
    expect(castSheetFor(binder, "EZRA")).toBeNull();
    expect(isCastSheet({ id: "x", type: "document", path: "Characters/Casting.md" })).toBe(false);
  });

  it("find the current sheet over an archived one of the same name", () => {
    expect(castSheetFor(binder, "Mara")?.id).toBe("mara");
    expect(castSheetFor(binder, " jonah ")?.id).toBe("jonah");
  });

  it("match the folder the way the disk does, whatever its case", () => {
    expect(isCastSheet({ id: "x", type: "character", path: "characters/Tobias.md" })).toBe(true);
  });

  it("are the only sheets Appearances keeps current", async () => {
    const sheet = "---\ntype: character\n---\n\n## Appearances\n\n_Old list._\n";
    store.clear();
    store.set("Characters/Mara.md", sheet);
    store.set("Archive/First draft/Characters/mara.md", sheet);
    const appearances = new Map([["MARA", [{ ordinal: 1, label: "Sc 1" }]]]);

    const out = await syncAppearances({ binder, appearances });

    expect(out.written).toEqual(["Characters/Mara.md"]);
    expect(store.get("Characters/Mara.md")).toContain("- Sc 1");
    // The archived sheet says what it said when it was put away.
    expect(store.get("Archive/First draft/Characters/mara.md")).toBe(sheet);
  });
});
