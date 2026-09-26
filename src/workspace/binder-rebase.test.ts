// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { reconcileDelta, restoreSubtree } from "./binder-rebase";
import type { BinderItem, PlayFile } from "./play-file";

const a: BinderItem = { id: "A", type: "script", path: "A.fountain" };
const b: BinderItem = { id: "B", type: "script", path: "B.fountain" };
const notes = { scenes: [], orphans: [], unique: "B's newer notes" };
const play = (binder: BinderItem[]): PlayFile => ({ kind: "proscenium/play", schemaVersion: 1,
  id: "PLAY", created: "today", modified: "today", generator: { app: "Proscenium", version: "1" },
  settings: {}, binder, scripts: { B: notes } });

test("docs/app/keeping-work/storage-and-file-format.md#STOR-90: undo inserts only the deleted row and leaves later notes and order intact", () => {
  const fresh = play([{ id: "folder", type: "folder", path: "Notes", children: [b] }]);
  const restored = restoreSubtree(fresh, a, null, 0, { A: { scenes: [], orphans: [] } });
  expect(restored.binder.map((row) => row.id)).toEqual(["A", "folder"]);
  expect(restored.binder[1].children).toEqual([b]);
  expect(restored.scripts.B).toEqual(notes);
  expect(fresh.binder).toHaveLength(1);
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-90: undo refuses an occupied identity or path and a removed parent", () => {
  expect(() => restoreSubtree(play([a]), a, null, 0, {})).toThrow();
  expect(() => restoreSubtree(play([{ ...b, path: "a.fountain" }]), a, null, 0, {})).toThrow();
  expect(() => restoreSubtree(play([b]), a, "missing", 0, {})).toThrow();
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-90: reconciliation retains a concurrent addition and replays only its own removal", () => {
  const doc: BinderItem = { id: "doc", type: "document", path: "gone.md" };
  expect(reconcileDelta([a, doc], [a], [b, a, doc])).toEqual([b, a]);
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-90: a newly discovered folder can receive a known item without replacing other rows", () => {
  const moved = { ...a, path: "Drafts/A.fountain" };
  const folder: BinderItem = { id: "folder", type: "folder", path: "Drafts", children: [moved] };
  const out = reconcileDelta([a], [folder], [b, a]);
  expect(out).toEqual([folder, b]);
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-90: removing an old folder plan never takes a newly added child", () => {
  const empty: BinderItem = { id: "folder", type: "folder", path: "Drafts", children: [] };
  expect(() => reconcileDelta([empty], [], [{ ...empty, children: [b] }])).toThrow();
});
