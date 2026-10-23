// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A reply is a comment directly after another (docs/app/writing/comments.md#COMM-50): the
 * editor's side of that rule, and the path a reply takes to the file and back.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { playExtensions } from "../editor/schema";
import { fromEditorDoc } from "../editor/bridge";
import { parse, serialize, type Doc } from "../fountain";
import { collectComments } from "./model";
import { collectPmComments, commentThreads } from "./plugin";

const schema = getSchema(playExtensions);
const note = (text: string) => schema.nodes.note.create(null, schema.text(text));
const action = (...content: Parameters<typeof schema.nodes.action.create>[1][]) =>
  schema.nodes.doc.create(null, [schema.nodes.action.create(null, content.flat() as never)]);

describe("threads in the editor", () => {
  it("groups a comment with the comments directly after it", () => {
    const doc = action(
      schema.text("She pauses "),
      note("Robin: too long?"),
      note("Sam: no"),
      schema.text(" at the door. "),
      note("another matter"),
    );
    const entries = collectPmComments(doc);
    const threads = commentThreads(entries);
    expect(threads.map((t) => [t.root.text, t.replies.map((r) => r.text)])).toEqual([
      ["Robin: too long?", ["Sam: no"]],
      ["another matter", []],
    ]);
    // Where the next reply goes: just past the last comment of the thread.
    expect(threads[0].end).toBe(entries[1].end);
    expect(doc.nodeAt(threads[0].end)?.text).toBe(" at the door. ");
  });

  it("paints the phrase once, for the comment: a reply is about what its comment is about", () => {
    const [comment, reply] = collectPmComments(
      action(schema.text("She pauses "), note("too long?"), schema.text(" "), note("no")),
    );
    expect(reply.root).toBe(comment.pos);
    expect(comment.anchorFrom).not.toBeNull();
    expect(reply.anchorFrom).toBeNull();
  });

  it("reads a line break between two comments as white space, as the script's newline is", () => {
    const entries = collectPmComments(
      action(note("a thought"), schema.nodes.lineBreak.create(), note("agreed")),
    );
    expect(commentThreads(entries)).toHaveLength(1);
  });

  it("ends the conversation at a word", () => {
    const entries = collectPmComments(action(note("one"), schema.text(" and "), note("two")));
    expect(commentThreads(entries)).toHaveLength(2);
  });
});

describe("a reply persists", () => {
  /** What the editor hands the bridge after a comment is answered. */
  const answered: Doc = {
    type: "doc",
    content: [
      {
        type: "action",
        content: [
          { type: "text", text: "She turns off the tap. " },
          { type: "note", content: [{ type: "text", text: "Robin: too long?" }] },
          { type: "note", content: [{ type: "text", text: "Sam: it earns it" }] },
        ],
      },
      {
        type: "action",
        content: [
          { type: "note", content: [{ type: "text", text: "TODO: LAND THE ARRIVAL" }] },
          { type: "note", content: [{ type: "text", text: "ROBIN: DONE" }] },
        ],
      },
    ],
  };
  const text = serialize({ frontMatter: {}, doc: fromEditorDoc(answered) });

  it("writes each reply as a Fountain note directly after its comment", () => {
    expect(text).toContain("She turns off the tap. [[Robin: too long?]][[Sam: it earns it]]");
    // A line of nothing but comments is never forced to action: no `!` in the file.
    expect(text).toContain("\n[[TODO: LAND THE ARRIVAL]][[ROBIN: DONE]]");
  });

  it("comes back as the same conversations", () => {
    const reopened = collectComments(parse(text).doc);
    expect(reopened.map((c) => [c.text, c.thread])).toEqual([
      ["Robin: too long?", 0],
      ["Sam: it earns it", 0],
      ["TODO: LAND THE ARRIVAL", 2],
      ["ROBIN: DONE", 2],
    ]);
    expect(reopened[2].standalone && reopened[3].standalone).toBe(true);
  });

  it("survives a second round trip byte for byte", () => {
    expect(serialize({ frontMatter: {}, doc: parse(text).doc })).toBe(text);
  });
});
