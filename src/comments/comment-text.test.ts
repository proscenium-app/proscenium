// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A comment that holds a line break reads with it on the page, as it does in
 * the script (docs/app/writing/comments.md#COMM-73), and the composer writes
 * no blank line into one (docs/app/writing/comments.md#COMM-74). Headless: the
 * schema, no DOM.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { Slice, type Node as PMNode } from "@tiptap/pm/model";
import { fromEditorDoc, toEditorDoc } from "../editor/bridge";
import { playExtensions } from "../editor/schema";
import { parse, serialize, type Doc } from "../fountain";
import { commentContent, commentDraft } from "./actions";
import { collectComments } from "./model";
import { commentText } from "./own-text";
import { collectPmComments, commentThreads } from "./plugin";

const schema = getSchema(playExtensions);
const page = (text: string): PMNode => schema.nodeFromJSON(toEditorDoc(parse(text).doc));
const script = (doc: PMNode) =>
  serialize({ frontMatter: {}, doc: fromEditorDoc(doc.toJSON() as Doc) });

/** A comment of two lines on every kind of line, and one with a reply. */
const SCRIPT = [
  "# ACT ONE[[Robin: one act?\nor two]]",
  "",
  "INT. KITCHEN[[todo: which\nkitchen]] - NIGHT",
  "",
  "= She comes home.[[Sam: too\nplain]]",
  "",
  "A tap drips. [[Sam: one\ntwo]][[Robin: three\nfour]]",
  "",
  "[[Sam: a line\nof its own]]",
  "",
  "@MARA (V.O.)[[Robin: rename?\nor cut]]",
  "(quietly[[Sam: a\n(b)\nc]])",
  "The water [[Sam: again\n~again]] again.",
  "",
  "~La la[[Sam: sung\n~twice]] la",
  "",
  "> BLACKOUT.[[Sam: or\nfade]]",
  "",
  "> THE END[[Sam: is\nit]] <",
  "",
].join("\n");

describe("a comment that holds a line break, on the page", () => {
  it("reads with its line breaks once the script is opened again", () => {
    const [entry] = collectPmComments(page("She waits. [[Sam: one\ntwo]]\n"));
    expect(entry.text).toBe("Sam: one\ntwo");
    expect(entry.parsed).toEqual({ author: "Sam", todo: false, body: "one\ntwo" });
  });

  it("reads the script and the page alike, whatever line it is on", () => {
    const read = collectComments(parse(SCRIPT).doc).map((c) => c.text);
    const shown = collectPmComments(page(SCRIPT)).map((e) => e.text);
    expect(shown).toEqual(read);
    expect(shown).toEqual([
      "Robin: one act?\nor two",
      "todo: which\nkitchen",
      "Sam: too\nplain",
      "Sam: one\ntwo",
      "Robin: three\nfour",
      "Sam: a line\nof its own",
      "Robin: rename?\nor cut",
      "Sam: a\n(b)\nc",
      "Sam: again\n~again",
      "Sam: sung\ntwice",
      "Sam: or\nfade",
      "Sam: is\nit",
    ]);
    // The reply answers the comment, with a line break in each.
    const threads = commentThreads(collectPmComments(page(SCRIPT)));
    expect(threads[3].replies.map((r) => r.text)).toEqual(["Robin: three\nfour"]);
  });

  it("comes back from the page as the script it was", () => {
    expect(script(page(SCRIPT))).toBe(SCRIPT);
  });

  it("is its text and its line breaks, however the page holds them", () => {
    const note = (...content: PMNode[]) => schema.nodes.note.create(null, content);
    const br = () => schema.nodes.lineBreak.create();
    expect(commentText(note(schema.text("one"), br(), schema.text("two")))).toBe("one\ntwo");
    expect(commentText(note(schema.text("one"), br()))).toBe("one\n");
    expect(commentText(note(schema.text("one\ntwo")))).toBe("one\ntwo");
    expect(commentText(note())).toBe("");
  });

  it("is not machinery for the want of the line break it holds", () => {
    // `{` and `}` alone are a range's markers. With a line break in them they
    // are comments, on the page as in the script, and stay as they were read.
    const source = "She [[{\n]]waits[[}\n]][[Sam: here]] a while.\n";
    expect(collectPmComments(page(source)).map((e) => e.text)).toEqual(["{\n", "}\n", "Sam: here"]);
    expect(collectComments(parse(source).doc).map((c) => c.text)).toEqual([
      "{\n",
      "}\n",
      "Sam: here",
    ]);
    expect(script(page(source))).toBe(source);
  });
});

describe("a comment saved from its field", () => {
  const typed = (text: string) => schema.nodes.note.create(null, commentContent(schema, text));
  const line = (...content: PMNode[]) =>
    schema.nodes.doc.create(null, [schema.nodes.action.create(null, content)]);

  it("is on the page as the script will be read back", () => {
    const reopened = page("She waits. [[Sam: one\ntwo]]\n").child(0).child(1);
    expect(typed("Sam: one\ntwo").eq(reopened)).toBe(true);
    expect(typed("Sam: one").eq(page("She waits. [[Sam: one]]\n").child(0).child(1))).toBe(true);
  });

  it("goes to the script with its line breaks", () => {
    const doc = line(schema.text("She waits. "), typed("Sam: one\ntwo\nthree"));
    expect(script(doc)).toBe("She waits. [[Sam: one\ntwo\nthree]]\n");
    expect(collectPmComments(doc)[0].text).toBe("Sam: one\ntwo\nthree");
  });

  it("saves the same script when an edit changes nothing", () => {
    // The field opens on the comment's text and saves what it holds. Opened
    // on the lines run together, it wrote them so.
    const before = page(SCRIPT);
    let after = before;
    for (const entry of collectPmComments(before).reverse()) {
      const draft = commentContent(schema, commentDraft(entry.text));
      after = after.replace(entry.pos + 1, entry.end - 1, new Slice(draft, 0, 0));
    }
    expect(script(after)).toBe(SCRIPT);
    expect(after.eq(before)).toBe(true);
  });

  it("holds no blank line, and a line of spaces is one", () => {
    expect(commentDraft("one\n\ntwo")).toBe("one\ntwo");
    expect(commentDraft("one\n \n\t\n\ntwo")).toBe("one\ntwo");
    expect(commentDraft("\n one\ntwo \n\n")).toBe("one\ntwo");
    expect(commentDraft("one\n  two")).toBe("one\n  two");
  });
});
