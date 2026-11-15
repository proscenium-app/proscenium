// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An update that arrives with a click keeps the click
 * (docs/app/writing/editor-ux.md#EDIT-211). The page's own part, a real
 * click under a real redraw in every engine, is smoke's "zoom · a click or a
 * drag lands on the line under the pointer".
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { byPointer, carryPending, POINTER_SELECTION_MS } from "./pending-selection";
import { playExtensions } from "../editor/schema";

const schema = getSchema(playExtensions);
const line = (type: string, text: string) => schema.node(type, null, [schema.text(text)]);

/** CHARLIE, (to you), a speech, a direction: the screen the fault was seen on. */
function script() {
  const doc = schema.node("doc", null, [
    line("character", "CHARLIE"),
    line("parenthetical", "to you"),
    line("dialogue", "They call me the sad one."),
    line("action", "She sits."),
  ]);
  const starts: number[] = [];
  doc.forEach((_node, offset) => {
    starts.push(offset + 1);
  });
  return { doc, starts };
}

/** The state with the caret in the parenthetical, where it was before the click. */
function inParenthetical() {
  const { doc, starts } = script();
  const state = EditorState.create({ doc });
  const caret = starts[1] + 3;
  return {
    state: state.apply(state.tr.setSelection(TextSelection.create(doc, caret))),
    starts,
    caret,
  };
}

/** The block a position is in. */
const blockAt = (state: EditorState, pos: number) => state.doc.resolve(pos).parent.type.name;

describe("an update arriving with a click (docs/app/writing/editor-ux.md#EDIT-211)", () => {
  it("keeps the click: a redraw with the speech clicked leaves the caret in the speech", () => {
    const { state, starts } = inParenthetical();
    const clicked = starts[2] + 5;
    // A redraw: decorations only, built on the state from before the click.
    const tr = carryPending(state.tr.setMeta("redraw", true), { anchor: clicked, head: clicked });
    const next = state.apply(tr);
    expect(blockAt(next, next.selection.from)).toBe("dialogue");
    expect(next.selection.from).toBe(clicked);
  });

  it("keeps a drag: the highlighted words stay highlighted, in either direction", () => {
    const { state, starts } = inParenthetical();
    for (const [anchor, head] of [
      [starts[2] + 2, starts[2] + 10],
      [starts[3] + 4, starts[2] + 1],
    ]) {
      const next = state.apply(carryPending(state.tr, { anchor, head }));
      expect([next.selection.anchor, next.selection.head]).toEqual([anchor, head]);
    }
  });

  it("follows the click through an edit that arrives with it", () => {
    const { state, starts } = inParenthetical();
    const clicked = starts[2] + 5;
    // Two letters added at the cue: everything after it moves on by two.
    const tr = carryPending(state.tr.insertText("XX", starts[0]), {
      anchor: clicked,
      head: clicked,
    });
    const next = state.apply(tr);
    expect(next.selection.from).toBe(clicked + 2);
    expect(next.doc.textBetween(next.selection.from, next.selection.from + 4)).toBe("call");
  });

  it("leaves a command's own selection alone", () => {
    const { state, starts } = inParenthetical();
    const chosen = starts[3] + 1;
    const tr = carryPending(state.tr.setSelection(TextSelection.create(state.doc, chosen)), {
      anchor: starts[2] + 5,
      head: starts[2] + 5,
    });
    expect(state.apply(tr).selection.from).toBe(chosen);
  });

  it("changes nothing with nothing pending, or nothing new", () => {
    const { state, caret } = inParenthetical();
    expect(carryPending(state.tr, null).selectionSet).toBe(false);
    expect(carryPending(state.tr, { anchor: caret, head: caret }).selectionSet).toBe(false);
  });

  it("ignores a position outside the document or between blocks", () => {
    const { state, starts, caret } = inParenthetical();
    for (const pending of [
      { anchor: -1, head: 3 },
      { anchor: 3, head: state.doc.content.size + 4 },
      { anchor: starts[2] - 1, head: starts[2] - 1 },
    ]) {
      const next = state.apply(carryPending(state.tr, pending));
      expect(next.selection.from).toBe(caret);
    }
  });
});

describe("only a pointer's selection is carried (docs/app/writing/editor-ux.md#EDIT-211)", () => {
  it("a press or a lift just before makes the browser's selection a pointer's", () => {
    expect(byPointer(1000, 1000)).toBe(true);
    expect(byPointer(1000, 1000 + POINTER_SELECTION_MS)).toBe(true);
  });

  it("with no pointer just before, the browser's caret is not carried", () => {
    // A focus by the app's own call: the browser's caret at the very start.
    expect(byPointer(Number.NEGATIVE_INFINITY, 5000)).toBe(false);
    expect(byPointer(1000, 1001 + POINTER_SELECTION_MS)).toBe(false);
    expect(byPointer(2000, 1000)).toBe(false);
  });
});
