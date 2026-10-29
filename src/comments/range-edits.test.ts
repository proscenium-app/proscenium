// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A comment's range on the page (docs/app/writing/comments.md#COMM-D13): made
 * from a selection, kept through the edits a writer makes around it, and gone
 * with its comment. Each case ends at the script it would save, because the
 * script is where a range has to be right.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { fromEditorDoc, toEditorDoc } from "../editor/bridge";
import { playExtensions } from "../editor/schema";
import { parse, serialize, type Doc } from "../fountain";
import { takeCommentOut } from "./actions";
import {
  clearDeadRanges,
  collectPmComments,
  commentPlace,
  insertComment,
  ownPastedRanges,
} from "./plugin";
import { COMMENT_RANGE } from "./ranges";

const schema = getSchema(playExtensions);

const open = (text: string): EditorState =>
  EditorState.create({ schema, doc: schema.nodeFromJSON(toEditorDoc(parse(text).doc)) });
const script = (state: EditorState): string =>
  serialize({ frontMatter: {}, doc: fromEditorDoc(state.doc.toJSON() as Doc) });

/** Where `needle` begins (or ends) in the script's own words; it lies in one run. */
function at(doc: PMNode, needle: string, edge: "start" | "end" = "start"): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0 || node.type.name === "note") return false;
    const i = node.isText ? (node.text ?? "").indexOf(needle) : -1;
    if (i >= 0) found = pos + i + (edge === "end" ? needle.length : 0);
    return true;
  });
  if (found < 0) throw new Error(`"${needle}" is not in the script`);
  return found;
}

const select = (state: EditorState, from: number, to: number): EditorState =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));

/** ⌘⌥M on the selection, as the command makes it. */
function comment(state: EditorState): EditorState {
  const to = commentPlace(state);
  if (to === null) throw new Error("a comment cannot stand there");
  const tr = state.tr;
  insertComment(state, tr, to);
  return state.apply(tr);
}

/** An edit, then the upkeep the plugin appends to it. */
function edit(state: EditorState, make: (tr: Transaction) => void): EditorState {
  const tr = state.tr;
  make(tr);
  const next = state.apply(tr);
  const upkeep = clearDeadRanges(next);
  return upkeep ? next.apply(upkeep) : next;
}

const noteAt = (state: EditorState, text: string): { pos: number; size: number } => {
  const entry = collectPmComments(state.doc).find((e) => e.text === text);
  if (!entry) throw new Error(`no comment "${text}"`);
  return { pos: entry.pos, size: entry.end - entry.pos };
};

const marksLeft = (state: EditorState): boolean =>
  JSON.stringify(state.doc.toJSON()).includes(COMMENT_RANGE);

describe("a comment made on a selection", () => {
  const line = "She pauses at the door and turns.\n";

  it("is about the words selected, and says so in the script", () => {
    const state = open(line);
    const made = comment(select(state, at(state.doc, "at the"), at(state.doc, "door", "end")));
    expect(script(made)).toBe("She pauses [[{]]at the door[[}]][[comment]] and turns.\n");
  });

  it("is a comment at a point when nothing is selected", () => {
    const state = open(line);
    const caret = at(state.doc, "door", "end");
    expect(script(comment(select(state, caret, caret)))).toBe(
      "She pauses at the door[[comment]] and turns.\n",
    );
  });

  it("stands at the end of the last line selected, not in front of the next", () => {
    const state = open("She waits.\n\nMARA\nYou came.\n");
    // Whole lines selected: the selection ends where the cue begins.
    const made = comment(select(state, at(state.doc, "She"), at(state.doc, "MARA")));
    expect(script(made)).toBe("[[{]]She waits.[[}]][[comment]]\n\nMARA\nYou came.\n");
  });

  it("runs from one line into the next", () => {
    const state = open("She waits.\n\nHe goes on.\n");
    const made = comment(select(state, at(state.doc, "waits"), at(state.doc, "goes", "end")));
    expect(script(made)).toBe("She [[{]]waits.\n\nHe goes[[}]][[comment]] on.\n");
  });

  it("begins after a cue it was started in: a cue is a name, and holds no marker", () => {
    const state = open("MARA\nYou weren't supposed to come.\n");
    const made = comment(select(state, at(state.doc, "MARA"), at(state.doc, "supposed", "end")));
    expect(script(made)).toBe("MARA\n[[{]]You weren't supposed[[}]][[comment]] to come.\n");
  });

  it("has no range when it lands in a cue", () => {
    const state = open("She waits.\n\nMARA\nYou came.\n");
    const made = comment(select(state, at(state.doc, "waits"), at(state.doc, "MARA", "end")));
    expect(script(made)).not.toContain("{");
    expect(marksLeft(made)).toBe(false);
  });

  it("leaves a comment already inside the selection out of what it is about", () => {
    const state = open("She pauses[[one]] at the door and turns.\n");
    const made = comment(select(state, at(state.doc, "She"), at(state.doc, "door", "end")));
    expect(script(made)).toBe("[[{]]She pauses[[one]] at the door[[}]][[comment]] and turns.\n");
  });

  it("keeps its own words when it overlaps a comment that is there", () => {
    const state = open("She pauses [[{]]at the door[[}]][[first]] and turns.\n");
    const made = comment(select(state, at(state.doc, "She"), at(state.doc, "at the", "end")));
    const text = script(made);
    expect(text).toBe(
      "[[{1]]She pauses [[{]]at the[[}1]][[comment]] door[[}]][[first]] and turns.\n",
    );
    // Read back, each comment is about what it was made on.
    const again = open(text);
    const about = collectPmComments(again.doc).map((e) => [
      e.text,
      again.doc.textBetween(e.anchorFrom ?? 0, e.anchorTo ?? 0).replace("comment", ""),
    ]);
    expect(about).toEqual([
      ["comment", "She pauses at the"],
      ["first", "at the door"],
    ]);
  });
});

describe("a range through the writer's edits", () => {
  const line = "She pauses [[{]]at the door[[}]][[Robin: too long?]] and turns.\n";

  it("takes in the words typed over all of it", () => {
    const state = open(line);
    const from = at(state.doc, "at the door");
    const next = edit(state, (tr) => tr.insertText("on the stair", from, from + 11));
    expect(script(next)).toBe("She pauses [[{]]on the stair[[}]][[Robin: too long?]] and turns.\n");
  });

  it("takes in a word typed at its end, and not one typed after its comment", () => {
    const state = open(line);
    const end = at(state.doc, "door", "end");
    expect(script(edit(state, (tr) => tr.insertText("way", end)))).toBe(
      "She pauses [[{]]at the doorway[[}]][[Robin: too long?]] and turns.\n",
    );
    const note = noteAt(state, "Robin: too long?");
    expect(script(edit(state, (tr) => tr.insertText(" there", note.pos + note.size)))).toBe(
      "She pauses [[{]]at the door[[}]][[Robin: too long?]] there and turns.\n",
    );
  });

  it("leaves a word typed in front of it outside", () => {
    const state = open(line);
    expect(script(edit(state, (tr) => tr.insertText("long ", at(state.doc, "at the door"))))).toBe(
      "She pauses long [[{]]at the door[[}]][[Robin: too long?]] and turns.\n",
    );
  });

  it("begins at what is left when its first words are deleted", () => {
    const state = open(line);
    const next = edit(state, (tr) =>
      tr.delete(at(state.doc, "pauses"), at(state.doc, "at the ", "end")),
    );
    expect(script(next)).toBe("She [[{]]door[[}]][[Robin: too long?]] and turns.\n");
  });

  it("runs across the lines when the line is split inside it", () => {
    const state = open(line);
    const next = edit(state, (tr) => tr.split(at(state.doc, "at the ", "end")));
    expect(script(next)).toBe(
      "She pauses [[{]]at the \n\ndoor[[}]][[Robin: too long?]] and turns.\n",
    );
  });

  it("is gone with its comment, and leaves nothing in the script or on the page", () => {
    const state = open(line);
    const note = noteAt(state, "Robin: too long?");
    const next = edit(state, (tr) => tr.delete(note.pos, note.pos + note.size));
    expect(script(next)).toBe("She pauses at the door and turns.\n");
    expect(marksLeft(next)).toBe(false);
    expect(next.doc.toJSON()).toEqual(open("She pauses at the door and turns.\n").doc.toJSON());
  });

  it("is gone when every word of it is deleted, and the comment stays", () => {
    const state = open(line);
    const from = at(state.doc, "at the door");
    const next = edit(state, (tr) => tr.delete(from, from + 11));
    expect(script(next)).toBe("She pauses [[Robin: too long?]] and turns.\n");
    expect(marksLeft(next)).toBe(false);
  });

  it("goes to the first reply when its comment is taken out alone", () => {
    const state = open("She [[{]]pauses[[}]][[too long?]][[no]] there.\n");
    const [root, reply] = collectPmComments(state.doc);
    const next = edit(state, (tr) => takeCommentOut(tr, root.pos, reply.pos));
    expect(script(next)).toBe("She [[{]]pauses[[}]][[no]] there.\n");
  });

  it("is a second range when it is copied with its comment, and plain words without it", () => {
    const state = open(line);
    const note = noteAt(state, "Robin: too long?");
    const from = at(state.doc, "at the door");
    const ids = (slice: Slice) => {
      const found = new Set<string>();
      slice.content.descendants((node) => {
        for (const mark of node.marks) {
          if (mark.type.name.startsWith(COMMENT_RANGE)) found.add(mark.attrs.id as string);
        }
      });
      return [...found];
    };
    const whole = state.doc.slice(from, note.pos + note.size);
    expect(ids(whole)).toEqual(["r1"]);
    const pasted = ownPastedRanges(whole);
    expect(ids(pasted)).toHaveLength(1);
    expect(ids(pasted)).not.toEqual(["r1"]);
    // Pasted at the end of the line, it is a comment about its own copy.
    const end = at(state.doc, "turns.", "end");
    const next = edit(state, (tr) => tr.replace(end, end, pasted));
    expect(script(next)).toBe(
      "She pauses [[{]]at the door[[}]][[Robin: too long?]] and turns.[[{]]at the door[[}]][[Robin: too long?]]\n",
    );
    const words = state.doc.slice(from, from + 6);
    expect(ids(ownPastedRanges(words))).toEqual([]);
    const plain = open("She waits.\n").doc.slice(1, 4);
    expect(ownPastedRanges(plain)).toBe(plain);
  });
});
