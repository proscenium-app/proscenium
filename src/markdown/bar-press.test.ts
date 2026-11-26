// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// docs/app/organizing/workspace-model.md#WORK-51: a finger's press on the format
// bar leaves the caret where it was.
import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { movesHeldCaret } from "./bar-press";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
  marks: { strong: { toDOM: () => ["strong", 0] } },
});

/** "Shopping" then "eggs", the caret at the end of "eggs" (15). */
function state() {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("Shopping")]),
    schema.node("paragraph", null, [schema.text("eggs")]),
  ]);
  return EditorState.create({ doc, selection: TextSelection.create(doc, 15) });
}

describe("a press on the format bar", () => {
  test("refuses the caret put at the document's start", () => {
    const at = state();
    const held = { kept: at.selection, doc: at.doc };
    expect(movesHeldCaret(held, at.tr.setSelection(TextSelection.create(at.doc, 1)))).toBe(true);
  });

  test("refuses the caret put anywhere else", () => {
    const at = state();
    const held = { kept: at.selection, doc: at.doc };
    expect(movesHeldCaret(held, at.tr.setSelection(TextSelection.create(at.doc, 5)))).toBe(true);
  });

  test("lets the caret be set where it already is", () => {
    const at = state();
    const held = { kept: at.selection, doc: at.doc };
    expect(movesHeldCaret(held, at.tr.setSelection(TextSelection.create(at.doc, 15)))).toBe(false);
  });

  test("lets the bar's commands change the words", () => {
    const at = state();
    const held = { kept: at.selection, doc: at.doc };
    expect(movesHeldCaret(held, at.tr.insertText("!", 15))).toBe(false);
    expect(movesHeldCaret(held, at.tr.addMark(11, 15, schema.marks.strong.create()))).toBe(false);
  });

  test("lets a format waiting for the next word be set", () => {
    const at = state();
    const held = { kept: at.selection, doc: at.doc };
    expect(movesHeldCaret(held, at.tr.addStoredMark(schema.marks.strong.create()))).toBe(false);
  });

  test("lets the caret go once the words changed since the press began", () => {
    const at = state();
    const held = { kept: at.selection, doc: at.doc };
    const typed = at.apply(at.tr.insertText("!", 15));
    expect(movesHeldCaret(held, typed.tr.setSelection(TextSelection.create(typed.doc, 1)))).toBe(
      false,
    );
  });

  test("holds nothing with no press under way", () => {
    const at = state();
    expect(movesHeldCaret(undefined, at.tr.setSelection(TextSelection.create(at.doc, 1)))).toBe(
      false,
    );
  });
});
