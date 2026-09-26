// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ellipsis floor. Headless: the normalization is a pure function of the
 * editor state, so it needs the schema and no DOM.
 *
 * Why a floor and not just the input rule: the rule only fires for text arriving
 * through `handleTextInput`, and macOS smart substitution doesn't come that way
 * — it rewrites the contenteditable DOM directly, so the document and the screen
 * disagree until ProseMirror re-syncs. On a monospace grid that disagreement is
 * visible: three cells become one, then snap back.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { ellipsisTr } from "./input-rules";
import { playExtensions } from "./schema";

const schema = getSchema(playExtensions);

function stateOf(content: unknown[]): EditorState {
  return EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content }) });
}

const text = (state: EditorState) => {
  const out: string[] = [];
  state.doc.forEach((n) => out.push(n.textContent));
  return out;
};

/** Apply the floor once, the way the plugin's appendTransaction does. */
function normalized(content: unknown[]): EditorState {
  const state = stateOf(content);
  const tr = ellipsisTr(state);
  return tr ? state.apply(tr) : state;
}

describe("the ellipsis floor", () => {
  it("turns the glyph into three dots wherever it sits", () => {
    const after = normalized([
      { type: "action", content: [{ type: "text", text: "She waits… and waits…" }] },
    ]);
    expect(text(after)).toEqual(["She waits... and waits..."]);
  });

  it("is a no-op when there is no glyph (so it can't loop)", () => {
    const state = stateOf([
      { type: "action", content: [{ type: "text", text: "She waits... and waits..." }] },
    ]);
    expect(ellipsisTr(state)).toBeNull();
    // …and the transaction it produces is itself clean, which is what makes the
    // plugin terminate: appendTransaction re-runs and finds nothing.
    const once = normalized([{ type: "action", content: [{ type: "text", text: "…" }] }]);
    expect(ellipsisTr(once)).toBeNull();
  });

  it("fixes several glyphs across several blocks, positions intact", () => {
    const after = normalized([
      { type: "action", content: [{ type: "text", text: "…one… two…" }] },
      { type: "character", content: [{ type: "text", text: "MARA" }] },
      { type: "dialogue", content: [{ type: "text", text: "three… four" }] },
    ]);
    expect(text(after)).toEqual(["...one... two...", "MARA", "three... four"]);
  });

  it("carries the marks, so a glyph inside emphasis stays emphasized", () => {
    const after = normalized([
      {
        type: "action",
        content: [
          { type: "text", text: "plain " },
          { type: "text", marks: [{ type: "em" }], text: "soft…" },
        ],
      },
    ]);
    expect(text(after)).toEqual(["plain soft..."]);
    const block = after.doc.child(0);
    const last = block.child(block.childCount - 1);
    expect(last.text).toBe("soft...");
    expect(last.marks.map((m) => m.type.name)).toEqual(["em"]);
  });

  /** Omitted content is verbatim; the format doesn't govern what's inside it. */
  it("leaves a boneyard alone", () => {
    const after = normalized([
      { type: "boneyard", content: [{ type: "text", text: "cut this…" }] },
      { type: "action", content: [{ type: "text", text: "keep this…" }] },
    ]);
    expect(text(after)).toEqual(["cut this…", "keep this..."]);
  });
});
