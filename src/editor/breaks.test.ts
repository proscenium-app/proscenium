// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Breaks and emphasis. Headless: the fences are pure functions of
 * a block, and the page-break transform is a pure function of the editor state,
 * so all of it needs the schema and no DOM.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { canEmphasize, canSoftBreak, pageBreakTr, sigilAfterBreak } from "./breaks";
import { fromEditorDoc } from "./bridge";
import { playExtensions } from "./schema";
import { parse, serialize } from "../fountain";
import type { Doc } from "../fountain";

const schema = getSchema(playExtensions);

const block = (type: string, text = "x") =>
  schema.nodeFromJSON({ type, content: text ? [{ type: "text", text }] : [] });

describe("where a soft break is allowed", () => {
  it("allows the blocks that hold many lines as one element", () => {
    for (const type of ["action", "dialogue", "lyric"]) {
      expect(canSoftBreak(block(type))).toBe(true);
    }
  });

  it("refuses the blocks that are one line by construction", () => {
    for (const type of ["character", "sceneHeading", "transition", "act", "scene"]) {
      expect(canSoftBreak(block(type))).toBe(false);
    }
  });

  /**
   * A design note once called parenthetical "the exclusion the code doesn't justify". This is
   * the justification: the serializer writes a wryly as one `(…)` line, so a
   * break inside emits two lines and NEITHER re-parses as a parenthetical — the
   * second half comes back as the character's dialogue. Admitting it means
   * teaching serialize + parse a multi-line shape first.
   */
  it("refuses parenthetical, and here is what admitting it would cost", () => {
    expect(canSoftBreak(block("parenthetical"))).toBe(false);

    const broken: Doc = {
      type: "doc",
      content: [
        { type: "character", content: [{ type: "text", text: "MARA" }] as never },
        {
          type: "parenthetical",
          content: [
            { type: "text", text: "quietly" },
            { type: "lineBreak" },
            { type: "text", text: "to herself" },
          ] as never,
        },
        { type: "dialogue", content: [{ type: "text", text: "It held." }] as never },
      ],
    };
    const text = serialize({ frontMatter: {}, doc: fromEditorDoc(broken) });
    expect(text).toContain("(quietly\nto herself)");

    // …and the round trip loses the wryly entirely: the parenthetical and the
    // speech come back as ONE dialogue block with the parens as literal text.
    const back = parse(text).doc.content;
    expect(back.map((b) => b.type)).toEqual(["character", "dialogue"]);
    expect(back[1]!.content?.map((c) => ("text" in c ? c.text : "")).join("")).toBe(
      "(quietly\nto herself)\nIt held.",
    );
  });
});

describe("where emphasis belongs", () => {
  it("allows it in prose the writer shapes", () => {
    for (const type of ["action", "dialogue", "parenthetical", "lyric", "centered"]) {
      expect(canEmphasize(block(type))).toBe(true);
    }
  });

  /** A cue is a name; a heading's weight comes from the format spec. */
  it("refuses it in cues, headings, acts, scenes and transitions", () => {
    for (const type of ["character", "sceneHeading", "act", "scene", "transition"]) {
      expect(canEmphasize(block(type))).toBe(false);
    }
  });
});

/** Build a state whose caret sits inside block `i` at `offset`. */
function stateAt(content: unknown[], i: number, offset = 0): EditorState {
  const doc = schema.nodeFromJSON({ type: "doc", content });
  let pos = 1;
  for (let k = 0; k < i; k++) pos += doc.child(k).nodeSize;
  const state = EditorState.create({ schema, doc });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos + offset)));
}

const types = (state: EditorState) => {
  const out: string[] = [];
  state.doc.forEach((n) => out.push(n.type.name));
  return out;
};

describe("the forced page break", () => {
  const para = (type: string, text: string) => ({
    type,
    content: [{ type: "text", text }],
  });

  it("replaces the empty block the caret is on", () => {
    const state = stateAt(
      [para("action", "She waits."), { type: "action" }, para("action", "He does not.")],
      1,
    );
    const tr = pageBreakTr(state)!;
    const next = state.apply(tr);
    expect(types(next)).toEqual(["action", "pageBreak", "action", "action"]);
    // The blank line became the break; the Action after it is where the caret is.
    expect(next.doc.child(2).textContent).toBe("");
    expect(next.selection.$from.parent.type.name).toBe("action");
  });

  it("lands after a block with words in it, never inside one", () => {
    const state = stateAt([para("action", "She crosses to the window.")], 0, 4);
    const next = state.apply(pageBreakTr(state)!);
    expect(types(next)).toEqual(["action", "pageBreak", "action"]);
    // The sentence is intact — no mid-sentence split.
    expect(next.doc.child(0).textContent).toBe("She crosses to the window.");
  });

  it("always leaves a block after it, so the doc never ends on an atom", () => {
    const state = stateAt([para("dialogue", "It held.")], 0, 3);
    const next = state.apply(pageBreakTr(state)!);
    const shape = types(next);
    expect(shape[shape.length - 1]).toBe("action");
  });

  /** The point of the feature: it is the node Fountain's `===` round-trips. */
  it("serializes to `===` and parses back", () => {
    const state = stateAt([para("action", "She waits."), { type: "action" }], 1);
    const next = state.apply(pageBreakTr(state)!);
    const text = serialize({
      frontMatter: {},
      doc: fromEditorDoc(next.doc.toJSON() as Doc),
    });
    expect(text).toContain("===");
    expect(parse(text).doc.content.some((b) => b.type === "pageBreak")).toBe(true);
  });
});

/**
 * A sigil belongs to a line, and Shift+Enter makes lines inside a block
 * (docs/app/writing/editor-ux.md#EDIT-D111): `@` or `!` typed right after a soft break
 * starts the forced element there.
 */
describe("a sigil after a soft break", () => {
  const text = (t: string) => ({ type: "text", text: t });
  const BR = { type: "lineBreak" };

  /** A state holding one block, and the position just after its `n`th child. */
  function afterChild(block: unknown, n: number) {
    const state = EditorState.create({
      schema,
      doc: schema.nodeFromJSON({ type: "doc", content: [block] }),
    });
    let pos = 1;
    for (let k = 0; k <= n; k++) pos += state.doc.child(0).child(k).nodeSize;
    return { state, pos };
  }

  const shape = (state: EditorState) => {
    const out: string[] = [];
    state.doc.forEach((b) => out.push(`${b.type.name}:${b.textContent}`));
    return out;
  };

  it("@ at the end of a speech starts a forced cue on the new line", () => {
    const { state, pos } = afterChild({ type: "dialogue", content: [text("It held."), BR] }, 1);
    const tr = state.tr;
    expect(sigilAfterBreak(tr, pos, "@")).toBe(true);
    const next = state.apply(tr);
    expect(shape(next)).toEqual(["dialogue:It held.", "character:"]);
    expect(next.doc.child(1).attrs.forced).toBe(true);
    expect(next.selection.$from.parent.type.name).toBe("character");
  });

  it("takes only that line: the speech below it stays a speech, and it round-trips", () => {
    const doc = schema.nodeFromJSON({
      type: "doc",
      content: [
        { type: "character", content: [text("MARA")] },
        {
          type: "dialogue",
          content: [text("It held."), BR, text("Sam"), BR, text("Still talking.")],
        },
      ],
    });
    const state = EditorState.create({ schema, doc });
    // Inside the speech, just after its first break.
    const pos = doc.child(0).nodeSize + 1 + "It held.".length + 1;
    const tr = state.tr;
    expect(sigilAfterBreak(tr, pos, "@")).toBe(true);
    const next = state.apply(tr);
    expect(shape(next)).toEqual([
      "character:MARA",
      "dialogue:It held.",
      "character:Sam",
      "dialogue:Still talking.",
    ]);
    // Mixed case survives: a forced cue keeps it, and so does the file.
    const fountain = serialize({ frontMatter: {}, doc: fromEditorDoc(next.doc.toJSON() as Doc) });
    expect(fountain).toContain("@Sam");
    expect(parse(fountain).doc.content.map((b) => b.type)).toEqual([
      "character",
      "dialogue",
      "character",
      "dialogue",
    ]);
  });

  it("! in a stage direction starts a forced Action on the new line", () => {
    const { state, pos } = afterChild(
      { type: "action", content: [text("She waits."), BR, text("He does not.")] },
      1,
    );
    const tr = state.tr;
    expect(sigilAfterBreak(tr, pos, "!")).toBe(true);
    expect(shape(state.apply(tr))).toEqual(["action:She waits.", "action:He does not."]);
  });

  it("drops emphasis a cue cannot hold", () => {
    const { state, pos } = afterChild(
      {
        type: "dialogue",
        content: [text("Well."), BR, { type: "text", text: "Sam", marks: [{ type: "em" }] }],
      },
      1,
    );
    const tr = state.tr;
    sigilAfterBreak(tr, pos, "@");
    const cue = state.apply(tr).doc.child(1);
    expect(cue.type.name).toBe("character");
    expect(cue.firstChild?.marks ?? []).toEqual([]);
  });

  it("declines anywhere but the start of a line, so the character types as itself", () => {
    // Mid-line: "Wow" then `!`.
    const mid = afterChild({ type: "dialogue", content: [text("Wow")] }, 0);
    const tr1 = mid.state.tr;
    expect(sigilAfterBreak(tr1, mid.pos, "!")).toBe(false);
    expect(tr1.steps).toHaveLength(0);
    // After a break, but inside a comment: the note's own lines are not script lines.
    const note = EditorState.create({
      schema,
      doc: schema.nodeFromJSON({
        type: "doc",
        content: [
          {
            type: "action",
            content: [text("Door. "), { type: "note", content: [text("Sam:"), BR, text("x")] }],
          },
        ],
      }),
    });
    // Inside the note, right after its break: 1 (block) + "Door. " (6) + 1 (note) + "Sam:" (4) + BR (1).
    const tr2 = note.tr;
    expect(sigilAfterBreak(tr2, 1 + 6 + 1 + 4 + 1, "@")).toBe(false);
    expect(tr2.steps).toHaveLength(0);
  });
});
