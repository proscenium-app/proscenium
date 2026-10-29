// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The cue autocomplete in a cue that has a comment on it
 * (docs/app/writing/comments.md#COMM-67): the name it completes is the cue's
 * own text, and the comment is still there afterwards. Headless: the plugin's
 * state function over an EditorState, no view.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { fromEditorDoc, toEditorDoc } from "./bridge";
import { characterAutocompleteKey, nextState } from "./character-autocomplete";
import { playExtensions } from "./schema";
import { parse, serialize, type Doc } from "../fountain";

const schema = getSchema(playExtensions);

/** The script on the page, the caret `offset` into the content of block `index`. */
function at(fountain: string, index: number, offset: number): EditorState {
  const doc = schema.nodeFromJSON(toEditorDoc(parse(fountain).doc));
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const state = EditorState.create({ schema, doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, pos + 1 + offset)));
}

type Popup = NonNullable<ReturnType<typeof characterAutocompleteKey.getState>>;

const idle = (cast: string[]): Popup => ({
  cast,
  active: false,
  items: [],
  index: 0,
  from: 0,
  to: 0,
  query: "",
  dismissed: false,
  navigated: false,
});

const popup = (state: EditorState, cast: string[] = []) => nextState(state.tr, idle(cast), state);

/** Enter on the highlighted name, as `accept` does it, and the script that makes. */
function taken(state: EditorState, st: Popup): string {
  const tr = state.tr.insertText(st.items[st.index], st.from, st.to);
  return serialize({ frontMatter: {}, doc: fromEditorDoc(state.apply(tr).doc.toJSON() as Doc) });
}

const SPOKEN = ["MARGARET", "Stay.", "", "@MARA[[Robin: rename?]]", "No.", ""].join("\n");

describe("the cue autocomplete beside a comment", () => {
  it("offers names for the letters typed, not for the comment's words", () => {
    const state = at(`${SPOKEN}\n@MAR[[Sam: who?]]\nYes.\n`, 4, 3);
    const st = popup(state);
    expect(st.query).toBe("MAR");
    // The cues above are MARGARET and MARA: the comment on MARA is in neither.
    expect(st.items).toEqual(["MARA", "MARGARET"]);
    expect(state.doc.textBetween(st.from, st.to)).toBe("MAR");
  });

  it("takes a name and leaves the comment where it was", () => {
    const state = at(`${SPOKEN}\n@MAR[[Sam: who?]]\nYes.\n`, 4, 3);
    const st = popup(state);
    expect(taken(state, { ...st, index: 1 })).toBe(`${SPOKEN}\n@MARGARET[[Sam: who?]]\nYes.\n`);
  });

  it("counts the caret in the name's letters when it stands past the comment", () => {
    // `MAR`, the comment, and the caret at the end of the line.
    const source = `${SPOKEN}\n@MAR[[Sam: who?]]\nYes.\n`;
    const end = schema.nodeFromJSON(toEditorDoc(parse(source).doc)).child(4).content.size;
    const st = popup(at(source, 4, end));
    expect(st.active).toBe(true);
    expect(st.query).toBe("MAR");
  });

  it("stands down inside the extension, wherever the comment is", () => {
    const source = "MARGARET\nStay.\n\n@MAR[[Sam: who?]] (O.S.)\nYes.\n";
    const cue = schema.nodeFromJSON(toEditorDoc(parse(source).doc)).child(2);
    expect(popup(at(source, 2, cue.content.size)).active).toBe(false);
    expect(popup(at(source, 2, 3)).active).toBe(true);
  });

  it("offers nothing for a name with a comment inside it: taking one would take the comment", () => {
    const state = at("MARGARET\nStay.\n\n@MA[[Sam: who?]]R\nYes.\n", 2, 2);
    const st = popup(state);
    expect(st.query).toBe("MAR");
    expect(st.active).toBe(false);
  });

  it("puts a name in a cue that holds only a comment at the caret", () => {
    const source = "MARGARET\nStay.\n\n@[[Sam: who speaks?]]\nYes.\n";
    const before = at(source, 2, 0);
    const first = popup(before);
    expect(first.active).toBe(true);
    expect(first.items[0]).toBe("MARGARET");
    expect(taken(before, first)).toBe("MARGARET\nStay.\n\n@MARGARET[[Sam: who speaks?]]\nYes.\n");
    const cue = before.doc.child(2);
    const after = at(source, 2, cue.content.size);
    expect(taken(after, popup(after))).toBe(
      "MARGARET\nStay.\n\n@[[Sam: who speaks?]]MARGARET\nYes.\n",
    );
  });

  it("is what it was in a cue with no comment", () => {
    const state = at("MARGARET\nStay.\n\nMAR\nYes.\n", 2, 3);
    const st = popup(state, ["Marcus"]);
    expect(st.items).toEqual(["MARCUS", "MARGARET"]);
    expect([st.from, st.to]).toEqual([state.selection.from - 3, state.selection.from]);
  });
});
