// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Find over a real document: the part find-core.test.ts cannot reach, which is
 * whether the ProseMirror index marks a comment's text as a comment at the
 * positions a replace would actually edit. Headless — the schema and an
 * EditorState, no DOM.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { fromEditorDoc, toEditorDoc } from "./bridge";
import { DEFAULT_FIND_OPTIONS, findMatches, partitionForReplace } from "./find-core";
import { searchBlocks, speakersInDoc } from "./find";
import { playExtensions } from "./schema";
import { parse, serialize, type Doc } from "../fountain";

const schema = getSchema(playExtensions);

function stateOf(fountain: string): EditorState {
  const doc = schema.nodeFromJSON(toEditorDoc(parse(fountain).doc));
  return EditorState.create({ schema, doc });
}

/** Replace All, as the command does it: back to front, replaceable matches only. */
function replaceAll(state: EditorState, query: string, text: string): string {
  const matches = findMatches(searchBlocks(state.doc), query, DEFAULT_FIND_OPTIONS);
  const { replaceable } = partitionForReplace(matches);
  const tr = state.tr;
  for (let i = replaceable.length - 1; i >= 0; i--) {
    tr.insertText(text, replaceable[i].from, replaceable[i].to);
  }
  const next = state.apply(tr);
  return serialize({ frontMatter: {}, doc: fromEditorDoc(next.doc.toJSON() as Doc) });
}

const SCRIPT = [
  "INT. KITCHEN - NIGHT",
  "",
  "A tap drips into the water. [[Sam: is the water too on the nose?]]",
  "",
  "MARA",
  "The water again. [[todo: water, or rain?]]",
  "",
].join("\n");

describe("find: comments in a real document", () => {
  it("indexes a comment's text as a comment, at its real positions", () => {
    const state = stateOf(SCRIPT);
    const matches = findMatches(searchBlocks(state.doc), "water", DEFAULT_FIND_OPTIONS);
    expect(matches.map((m) => m.inNote)).toEqual([false, true, false, true]);
    for (const m of matches) {
      expect(state.doc.textBetween(m.from, m.to).toLowerCase()).toBe("water");
    }
  });

  it("Replace All rewrites the script and leaves every comment as it was", () => {
    const out = replaceAll(stateOf(SCRIPT), "water", "rain");
    expect(out).toContain("A tap drips into the rain. [[Sam: is the water too on the nose?]]");
    expect(out).toContain("The rain again. [[todo: water, or rain?]]");
  });

  it("never touches a scene anchor, which is a note too", () => {
    const anchored = "INT. KITCHEN - NIGHT [[id:01J9ZS1AAAAAAAAAAAAAAAAAA1]]\n\nThe id card.\n";
    const state = stateOf(anchored);
    const { replaceable, noteMatches } = partitionForReplace(
      findMatches(searchBlocks(state.doc), "id", DEFAULT_FIND_OPTIONS),
    );
    expect(noteMatches).toHaveLength(1);
    expect(replaceable).toHaveLength(1);
    expect(replaceAll(state, "id", "ID")).toContain("[[id:01J9ZS1AAAAAAAAAAAAAAAAAA1]]");
  });
});

/** Who speaks is the cue's own text (docs/app/writing/comments.md#COMM-67). */
describe("find: a cue with a comment on it", () => {
  const NOTED = [
    "@MARA[[Robin: rename Mara?]]",
    "The water again.",
    "",
    "@JONAH (O.S.)[[Sam: louder]]",
    "Is it water?",
    "",
  ].join("\n");

  it("names the speaker without the comment's words", () => {
    const state = stateOf(NOTED);
    expect(speakersInDoc(state.doc)).toEqual(["JONAH", "MARA"]);
    expect(searchBlocks(state.doc).map((b) => [b.type, b.speaker])).toEqual([
      ["character", "MARA"],
      ["dialogue", "MARA"],
      ["character", "JONAH"],
      ["dialogue", "JONAH"],
    ]);
  });

  it("finds her speeches under her name, and the comment as a comment", () => {
    const state = stateOf(NOTED);
    const hers = findMatches(searchBlocks(state.doc), "water", {
      ...DEFAULT_FIND_OPTIONS,
      scope: { kind: "speaker", name: "MARA" },
    });
    expect(hers.map((m) => [m.blockType, m.speaker])).toEqual([["dialogue", "MARA"]]);
    const named = findMatches(searchBlocks(state.doc), "mara", DEFAULT_FIND_OPTIONS);
    expect(named.map((m) => [m.blockType, m.inNote])).toEqual([
      ["character", false],
      ["character", true],
    ]);
    // Neither is replaced: one is a rename, the other a comment.
    expect(replaceAll(state, "mara", "EDDA")).toBe(NOTED);
  });
});
