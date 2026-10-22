// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a comment is about (docs/app/writing/comments.md#COMM-D13): two marker
 * notes in the script, a mark in the editor, and the way from one to the other
 * and back. The proof that matters is the round trip: a script the app wrote
 * comes back from the editor byte for byte, and a marker the app did not write
 * comes back as it was.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { fromEditorDoc, toEditorDoc } from "../editor/bridge";
import { playExtensions } from "../editor/schema";
import { parse, serialize, type Doc } from "../fountain";
import { collectComments, rangeMarker } from "./model";
import { collectPmComments } from "./plugin";
import { COMMENT_RANGE, COMMENT_RANGE_END, dropRangeMarkers, liveRangeIds } from "./ranges";

const schema = getSchema(playExtensions);

const model = (text: string): Doc => parse(text).doc;
const written = (doc: Doc): string => serialize({ frontMatter: {}, doc });
/** Script text through the editor's document and back to script text. */
const throughEditor = (text: string): string => {
  const editor = schema.nodeFromJSON(toEditorDoc(model(text)));
  return written(fromEditorDoc(editor.toJSON() as Doc));
};
/** Each comment on the page with the text its highlight paints. */
const highlights = (text: string): [string, string | null][] => {
  const doc = schema.nodeFromJSON(toEditorDoc(model(text)));
  return collectPmComments(doc)
    .filter((entry) => entry.root === entry.pos)
    .map((entry) => [
      entry.text,
      entry.anchorFrom === null || entry.anchorTo === null
        ? null
        : words(doc, entry.anchorFrom, entry.anchorTo),
    ]);
};
/** The script's own words in a stretch: a comment inside it is not among them. */
function words(doc: PMNode, from: number, to: number): string {
  const lines: string[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === "note") return false;
    if (node.isTextblock) lines.push("");
    else if (node.isText) {
      const text = node.text ?? "";
      lines[lines.length - 1] += text.slice(Math.max(0, from - pos), Math.max(0, to - pos));
    } else if (node.type.name === "lineBreak") lines[lines.length - 1] += "\n";
    return true;
  });
  return lines.join(" / ");
}

describe("the range marker", () => {
  it("is a note of one brace, with or without a number, and nothing else", () => {
    expect(rangeMarker("{")).toEqual({ side: "open", label: "" });
    expect(rangeMarker("}")).toEqual({ side: "close", label: "" });
    expect(rangeMarker("{12")).toEqual({ side: "open", label: "12" });
    expect(rangeMarker("}12")).toEqual({ side: "close", label: "12" });
    for (const text of [" {", "{ ", "{}", "{a", "{{", "", "too long?", "{12345"]) {
      expect(rangeMarker(text)).toBeNull();
    }
  });
});

describe("a range in the script and in the editor", () => {
  const line = "She pauses [[{]]at the door[[}]][[Robin: too long?]] and turns.\n";

  it("is a mark on the words and one on their comment, and no note, in the editor", () => {
    const [block] = toEditorDoc(model(line)).content;
    expect(block.content).toEqual([
      { type: "text", text: "She pauses " },
      { type: "text", text: "at the door", marks: [{ type: COMMENT_RANGE, attrs: { id: "r1" } }] },
      {
        type: "note",
        content: [{ type: "text", text: "Robin: too long?" }],
        marks: [{ type: COMMENT_RANGE_END, attrs: { id: "r1" } }],
      },
      { type: "text", text: " and turns." },
    ] as never);
  });

  it("paints the text between the markers and nothing more", () => {
    expect(highlights(line)).toEqual([["Robin: too long?", "at the door"]]);
  });

  it("still paints the phrase before a comment that has no range", () => {
    expect(highlights("One thing. She pauses at the door[[too long?]] and turns.\n")).toEqual([
      ["too long?", "She pauses at the door"],
    ]);
  });

  it("is one comment to every reader of the script, markers and all", () => {
    const comments = collectComments(model(line));
    expect(comments.map((c) => c.text)).toEqual(["Robin: too long?"]);
    const answered = collectComments(model(line.replace("?]]", "?]][[Sam: no]]")));
    expect(answered.map((c) => [c.text, c.thread])).toEqual([
      ["Robin: too long?", 0],
      ["Sam: no", 0],
    ]);
  });

  const scripts: Record<string, string> = {
    "a phrase in a line": line,
    "a whole line": "[[{]]She pauses at the door.[[}]][[too long?]]\n",
    "a line in capitals": "![[{]]BLACKOUT.[[}]][[EARNED?]]\n",
    "words in a speech": "MARA\nThe pipe's been [[{]]crying[[}]][[weeping?]] all night.\n",
    "a whole speech": "MARA\n[[{]]The pipe's been crying all night.[[}]][[keep]]\n",
    "the second line of a speech": "MARA\nOne.\n[[{]]Two.[[}]][[which?]]\n",
    "a parenthetical": "MARA\n([[{]]half asleep[[}]][[cut]])\nYou and that pipe.\n",
    "across a line break": "She [[{]]waits.\nShe goes[[}]][[both?]] on.\n",
    "from one line into the next": "She [[{]]waits.\n\nHe goes[[}]][[both?]] on.\n",
    "from one speech into the next": [
      "MARA",
      "You [[{]]weren't supposed to come.",
      "",
      "JONAH",
      "I know[[}]][[too neat]] that.",
      "",
    ].join("\n"),
    "a comment with replies": "She [[{]]pauses[[}]][[too long?]][[no]] there.\n",
    "a stretch inside a stretch": "[[{]]She [[{]]pauses[[}]][[word]] at the door[[}]][[line]].\n",
    "two stretches from one word": "[[{]][[{]]She pauses[[}]][[two]] at the door[[}]][[all]].\n",
    "two stretches that overlap":
      "[[{1]]She [[{]]pauses[[}1]][[first]] at the door[[}]][[second]].\n",
    "a transition": "> [[{]]Lights fade.[[}]][[how fast?]]\n",
    "centred text": "> [[{]]THE END[[}]][[is it?]] <\n",
    "a lyric": "~[[{]]O the water[[}]][[tune?]]\n",
    "a synopsis": "= [[{]]They argue.[[}]][[about?]]\n",
    "bold inside a stretch": "She [[{]]pauses **at** the door[[}]][[too long?]] and turns.\n",
    "a stretch inside bold": "She **pauses **[[{]]**at**[[}]][[this]]** the** door.\n",
  };
  for (const [name, text] of Object.entries(scripts)) {
    it(`comes back from the editor as it was written: ${name}`, () => {
      // The script is what the app writes: reading and writing it changes nothing.
      expect(written(model(text))).toBe(text);
      expect(throughEditor(text)).toBe(text);
    });
  }

  it("keeps each stretch its own comment's, however they sit", () => {
    expect(highlights(scripts["a stretch inside a stretch"])).toEqual([
      ["word", "pauses"],
      ["line", "She pauses at the door"],
    ]);
    expect(highlights(scripts["two stretches that overlap"])).toEqual([
      ["first", "She pauses"],
      ["second", "pauses at the door"],
    ]);
    expect(highlights(scripts["from one speech into the next"])).toEqual([
      ["too neat", "weren't supposed to come. / JONAH / I know"],
    ]);
  });

  const strays: Record<string, string> = {
    "a start with no end": "She [[{]]pauses at the door[[too long?]] and turns.\n",
    "an end with no start": "She pauses at the door[[}]][[too long?]] and turns.\n",
    "an end with no comment after it": "She [[{]]pauses[[}]] at the door[[too long?]].\n",
    "nothing between the two": "She pauses[[{]][[}]][[too long?]] at the door.\n",
    "a start that is not before a word": "She pauses[[{]][[an aside]] at the door[[}]][[c]].\n",
    "a stretch that ends in a cue": "[[{]]She waits.\n\n@MARA[[}]][[who?]]\nYes.\n",
    "a stretch that begins in a heading": ".[[{]]THE KITCHEN\n\nShe waits[[}]][[where?]] there.\n",
  };
  for (const [name, text] of Object.entries(strays)) {
    it(`leaves markers it would not have written as they are: ${name}`, () => {
      const editor = toEditorDoc(model(text));
      expect(JSON.stringify(editor)).not.toContain(COMMENT_RANGE);
      expect(written(fromEditorDoc(schema.nodeFromJSON(editor).toJSON() as Doc))).toBe(
        written(model(text)),
      );
      // Neither marker is a comment, on the page or to a reader of the script.
      const doc = schema.nodeFromJSON(editor);
      expect(collectPmComments(doc).every((entry) => !rangeMarker(entry.text))).toBe(true);
      expect(collectComments(model(text)).every((entry) => !rangeMarker(entry.text))).toBe(true);
    });
  }

  it("gives a stretch around a stray marker a number, so it is read back as written", () => {
    // A `{` somebody left inside the stretch would close this one's `}`.
    const editor = toEditorDoc(model("She [[{]]pauses at the door[[}]][[too long?]] and turns.\n"));
    const [block] = editor.content;
    const content = [...(block.content ?? [])];
    content.splice(2, 0, {
      type: "note",
      content: [{ type: "text", text: "{" }],
    });
    // The stray sits between the marked words and their comment.
    const text = written(fromEditorDoc({ ...editor, content: [{ ...block, content }] } as Doc));
    expect(text).toBe("She [[{1]]pauses at the door[[{]][[}1]][[too long?]] and turns.\n");
    expect(highlights(text)).toEqual([["too long?", "pauses at the door"]]);
    expect(throughEditor(text)).toBe(text);
  });

  it("names the ranges as the page does when asked to", () => {
    const text = "[[{]]One[[}]][[a]] and [[{]]two[[}]][[b]].\n";
    const first = toEditorDoc(model(text));
    expect(liveRangeIds(first)).toEqual(["r1", "r2"]);
    const renamed = toEditorDoc(model(text), ["n7", "r1"]);
    expect(liveRangeIds(renamed)).toEqual(["n7", "r1"]);
    // One more range than the page had: a name the page does not use.
    expect(liveRangeIds(toEditorDoc(model(text), ["r1"]))).toEqual(["r1", "r2"]);
    expect(liveRangeIds(toEditorDoc(model(text), ["r2"]))).toEqual(["r2", "r1"]);
  });

  it("is not there at all to a comparison of two versions", () => {
    const plain = "She pauses at the door[[Robin: too long?]] and turns.\n";
    expect(written(dropRangeMarkers(model(line)))).toBe(plain);
    expect(dropRangeMarkers(model(plain))).toEqual(model(plain));
    // The words on either side of a marker are one run again.
    expect(dropRangeMarkers(model(line)).content[0].content?.[0]).toEqual({
      type: "text",
      text: "She pauses at the door",
    });
  });
});
