// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A comment is script text, so "does it persist?" is a question about the
 * SAVE PATH, not about a comment store — there isn't one (docs/app/writing/comments.md
 * docs/app/writing/comments.md#COMM-D2). This walks the whole path a typed comment takes to disk and back:
 * editor doc → model (bridge) → `.fountain` bytes → parse → collect.
 *
 * Resolving is the only thing that removes a comment, and it removes it from
 * the file the same way deleting a word does — the trail is the history ring
 * and the ledger, not a tombstone in the text (docs/app/writing/comments.md#COMM-D5).
 */
import { describe, expect, it } from "bun:test";
import { parse, serialize, type Doc } from "../fountain";
import { fromEditorDoc } from "../editor/bridge";
import { collectComments } from "./model";

/** What the editor hands the bridge after a comment is typed into a line. */
const edited: Doc = {
  type: "doc",
  content: [
    { type: "sceneHeading", content: [{ type: "text", text: "SCENE 1" }] },
    {
      type: "action",
      content: [
        { type: "text", text: "She turns off the tap. " },
        { type: "note", content: [{ type: "text", text: "Robin: too long?" }] },
      ],
    },
    {
      type: "action",
      content: [{ type: "note", content: [{ type: "text", text: "todo: land the arrival" }] }],
    },
  ],
};

describe("comments persist", () => {
  const text = serialize({ frontMatter: {}, doc: fromEditorDoc(edited) });

  it("writes into the .fountain as a Fountain note, in place", () => {
    expect(text).toContain("She turns off the tap. [[Robin: too long?]]");
    expect(text).toContain("[[todo: land the arrival]]");
  });

  it("comes back on the next open, attribution and all", () => {
    const reopened = collectComments(parse(text).doc);
    expect(reopened.map((c) => c.text)).toEqual(["Robin: too long?", "todo: land the arrival"]);
    expect(reopened[0].parsed.author).toBe("Robin");
    expect(reopened[0].scene).toBe("SCENE 1");
    expect(reopened[1].parsed.todo).toBe(true);
    expect(reopened[1].standalone).toBe(true);
  });

  it("survives a second round trip byte for byte", () => {
    expect(serialize({ frontMatter: {}, doc: parse(text).doc })).toBe(text);
  });
});
