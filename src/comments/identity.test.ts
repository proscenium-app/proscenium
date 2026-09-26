// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { playExtensions } from "../editor/schema";
import { collectPmComments, commentIdsAfter } from "./plugin";

it("docs/app/writing/comments.md#COMM-32: identical comment text keeps distinct identities through position changes and deletion", () => {
  const schema = getSchema(playExtensions);
  const note = () => schema.nodes.note.create(null, schema.text("same words"));
  const doc = schema.nodes.doc.create(null, [schema.nodes.action.create(null, [schema.text("Before "), note(), schema.text(" between "), note()])]);
  const entries = collectPmComments(doc);
  expect(entries[0].id).not.toBe(entries[1].id);
  const state = EditorState.create({ schema, doc });
  const inserted = state.tr.insertText("New words ", 1);
  const moved = commentIdsAfter(inserted, entries);
  expect(moved.get(entries[0].pos + 10)).toBe(entries[0].id);
  expect(moved.get(entries[1].pos + 10)).toBe(entries[1].id);
  const edited = state.tr.insertText("different ", entries[0].pos + 1);
  expect(commentIdsAfter(edited, entries).get(entries[0].pos)).toBe(entries[0].id);
  const removed = state.tr.delete(entries[0].pos, entries[0].pos + doc.nodeAt(entries[0].pos)!.nodeSize);
  expect([...commentIdsAfter(removed, entries).values()]).toEqual([entries[1].id]);
});
