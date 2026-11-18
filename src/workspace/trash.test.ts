// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import type { TrashEntry } from "../storage/ipc";
import type { BinderItem, ScriptData } from "./play-file";
import { formatNote, movedTo, noteOf, practiceNote, rowNote, trashTitle, trashWhat } from "./trash";
import type { VaultPlay } from "./vault-plays";

const binder: BinderItem[] = [
  { id: "script", type: "script", path: "Tide.fountain" },
  {
    id: "acts",
    type: "folder",
    path: "Acts",
    children: [
      { id: "one", type: "script", path: "Acts/One.fountain" },
      { id: "notes", type: "document", path: "Acts/Notes.md" },
    ],
  },
];
const cards: ScriptData = { scenes: [], orphans: [] };
const play = { id: "01PLAY", binder, scripts: { script: cards, one: cards } };

/** An entry as Rust lists it, with what a test changes. */
function entry(over: Partial<TrashEntry>): TrashEntry {
  return {
    ring: { kind: "play", playId: "01PLAY" },
    name: "20261104-101500-Notes.md",
    original: "Notes.md",
    rel: "Acts/Notes.md",
    isDir: false,
    isPlay: false,
    deletedMs: 0,
    expiresMs: 0,
    note: null,
    ...over,
  };
}

const plays = [{ id: "01PLAY", dir: "Tide (revised)", title: "Tide (revised)" }] as VaultPlay[];

describe("what a delete says of what it deletes (docs/engineering/cross-platform.md#PLAT-16)", () => {
  test("a binder row's note keeps the row, where it stood, and its scripts' cards", () => {
    const note = noteOf({ note: rowNote(play, "Tide.proscenium", "acts") ?? null });
    expect(note?.title).toBe("Acts");
    expect(note?.kind).toBe("folder");
    expect(note?.play).toEqual({ id: "01PLAY", title: "Tide" });
    expect(note?.row?.parentId).toBeNull();
    expect(note?.row?.index).toBe(1);
    expect(note?.row?.item.children?.map((c) => c.id)).toEqual(["one", "notes"]);
    // The cards of the scripts going with it, and only those.
    expect(Object.keys(note?.row?.scripts ?? {})).toEqual(["one"]);
    const inside = noteOf({ note: rowNote(play, "Tide.proscenium", "notes") ?? null });
    expect(inside?.row?.parentId).toBe("acts");
    expect(inside?.row?.index).toBe(1);
  });

  test("a row that is not there says nothing, and a note that cannot be read is no note", () => {
    expect(rowNote(play, "Tide.proscenium", "gone")).toBeUndefined();
    expect(noteOf({ note: null })).toBeNull();
    expect(noteOf({ note: "{ not json" })).toBeNull();
    expect(noteOf({ note: JSON.stringify({ v: 2, title: "Later" }) })).toBeNull();
    expect(noteOf({ note: JSON.stringify([1]) })).toBeNull();
  });
});

describe("what Proscenium’s Trash says of each entry", () => {
  test("a binder row: what it was, in its play as it is named now", () => {
    const notes = entry({ note: rowNote(play, "Tide.proscenium", "notes") ?? null });
    expect(trashTitle(notes)).toBe("Notes");
    expect(trashWhat(notes, plays)).toBe("A document in “Tide (revised)”");
    // A play no longer listed is named as it was when the delete was made.
    expect(trashWhat(notes, [])).toBe("A document in “Tide”");
    const folder = entry({
      original: "Acts",
      rel: "Acts",
      isDir: true,
      note: rowNote(play, "Tide.proscenium", "acts") ?? null,
    });
    expect(trashWhat(folder, plays)).toBe("A folder in “Tide (revised)”");
  });

  test("one kept with nothing said of it is read by its name", () => {
    expect(trashTitle(entry({ note: null }))).toBe("Notes");
    expect(trashWhat(entry({ note: null }), plays)).toBe("A file in “Tide (revised)”");
    expect(trashWhat(entry({ note: null, isDir: true }), [])).toBe("A folder in a play");
  });

  test("a whole play, practice and a format", () => {
    const whole = entry({
      ring: { kind: "plays" },
      original: "The Lighthouse",
      rel: null,
      isDir: true,
      isPlay: true,
    });
    expect(trashTitle(whole)).toBe("The Lighthouse");
    expect(trashWhat(whole, plays)).toBe("A play");
    const practice = entry({
      ring: { kind: "practice" },
      original: "01J00000000000000000000000",
      isDir: true,
      note: practiceNote(),
    });
    expect(trashTitle(practice)).toBe("Practice Play");
    expect(trashWhat(practice, plays)).toBe("Practice from Help & Tutorials");
    expect(trashTitle({ ...practice, note: null })).toBe("Practice Play");
    const format = entry({
      ring: { kind: "formats" },
      original: "house-style.json",
      note: formatNote("House Style"),
    });
    expect(trashTitle(format)).toBe("House Style");
    expect(trashWhat(format, plays)).toBe("A format");
    expect(trashTitle({ ...format, note: null })).toBe("house-style");
  });
});

test("a row put back under another name takes its children with it", () => {
  const folder = binder[1];
  const moved = movedTo(folder, "Acts", "Acts (put back)");
  expect(moved.path).toBe("Acts (put back)");
  expect(moved.children?.map((c) => c.path)).toEqual([
    "Acts (put back)/One.fountain",
    "Acts (put back)/Notes.md",
  ]);
  expect(moved.children?.map((c) => c.id)).toEqual(["one", "notes"]);
  // A name that only begins like the folder's is not inside it.
  expect(movedTo({ id: "x", type: "document", path: "Actsy.md" }, "Acts", "B").path).toBe(
    "Actsy.md",
  );
});
