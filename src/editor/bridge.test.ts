// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { parse, serialize, type Doc } from "../fountain";
import { fromEditorDoc, toEditorDoc } from "./bridge";

/** The break node exists only inside the editor, so the model types don't
 *  know it — read inline content untyped when a break is expected. */
const inline = (doc: Doc, i = 0): unknown[] => doc.content[i].content as unknown[];

const model = (text: string): Doc => ({
  type: "doc",
  content: [{ type: "dialogue", content: [{ type: "text", text }] }],
});

describe("editor line-break bridge", () => {
  it("turns newlines into break nodes and back", () => {
    const doc = model("One.\n\nTwo.");
    expect(inline(toEditorDoc(doc))).toEqual([
      { type: "text", text: "One." },
      { type: "lineBreak" },
      { type: "lineBreak" },
      { type: "text", text: "Two." },
    ]);
    expect(fromEditorDoc(toEditorDoc(doc))).toEqual(doc);
  });

  it("round-trips a break at the very end of a block (the case that broke)", () => {
    const doc = model("One.\n\n");
    expect(inline(toEditorDoc(doc))).toEqual([
      { type: "text", text: "One." },
      { type: "lineBreak" },
      { type: "lineBreak" },
    ]);
    expect(fromEditorDoc(toEditorDoc(doc))).toEqual(doc);
  });

  it("keeps marks on both sides of a break", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        {
          type: "dialogue",
          content: [{ type: "text", text: "One.\nTwo.", marks: [{ type: "em" }] }],
        },
      ],
    };
    const editor = toEditorDoc(doc);
    expect(inline(editor)).toEqual([
      { type: "text", text: "One.", marks: [{ type: "em" }] },
      { type: "lineBreak" },
      { type: "text", text: "Two.", marks: [{ type: "em" }] },
    ]);
    // Marked runs stay separate rather than merging across the break.
    expect(fromEditorDoc(editor)).toEqual({
      type: "doc",
      content: [
        {
          type: "dialogue",
          content: [
            { type: "text", text: "One.", marks: [{ type: "em" }] },
            { type: "text", text: "\n" },
            { type: "text", text: "Two.", marks: [{ type: "em" }] },
          ],
        },
      ],
    });
  });

  it("leaves blocks without content (and inline notes) intact", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        { type: "pageBreak" },
        {
          type: "action",
          content: [
            { type: "text", text: "She waits " },
            { type: "note", content: [{ type: "text", text: "beat\nlong" }] },
          ],
        },
      ],
    };
    expect(fromEditorDoc(toEditorDoc(doc))).toEqual(doc);
    const note = inline(toEditorDoc(doc), 1)[1];
    expect(note).toEqual({
      type: "note",
      content: [
        { type: "text", text: "beat" },
        { type: "lineBreak" },
        { type: "text", text: "long" },
      ],
    });
  });

  it("merges adjacent unmarked runs so the model keeps one text node", () => {
    const editorDoc = {
      type: "doc",
      content: [
        {
          type: "dialogue",
          content: [
            { type: "text", text: "One." },
            { type: "lineBreak" },
            { type: "text", text: "Two." },
          ],
        },
      ],
    };
    expect(fromEditorDoc(editorDoc as Doc)).toEqual(model("One.\nTwo."));
  });
});

/** A cue and the speech under it. */
const cue = (text: string, attrs?: Record<string, unknown>): Doc => ({
  type: "doc",
  content: [
    { type: "character", ...(attrs ? { attrs } : {}), content: [{ type: "text", text }] },
    { type: "dialogue", content: [{ type: "text", text: "Hello." }] },
  ],
});

const blockText = (doc: Doc, i = 0): string =>
  (doc.content[i].content ?? []).map((n) => (n.type === "text" ? n.text : "")).join("");

describe("a cue's extension is text in the editor (docs/engineering/fountain-model.md#EDIT-124)", () => {
  it("puts the extension the file holds on the page, not in an attribute", () => {
    const editor = toEditorDoc(cue("EDDA", { extension: "(V.O.)" }));
    expect(blockText(editor)).toBe("EDDA (V.O.)");
    expect(editor.content[0].attrs?.extension).toBeUndefined();
  });

  it("splits it back out, so the model is what the parser reads", () => {
    const { doc } = parse("EDDA (V.O.)\nHello.\n");
    expect(fromEditorDoc(toEditorDoc(doc))).toEqual(doc);
  });

  it("reads a typed cue the way the parser reads the file", () => {
    for (const typed of ["EDDA (V.O.)", "EDDA(V.O.)", "EDDA  (V.O.)"]) {
      const back = fromEditorDoc(cue(typed));
      expect(blockText(back)).toBe("EDDA");
      expect(back.content[0].attrs?.extension).toBe("(V.O.)");
    }
  });

  it("writes what the page shows: no doubled extension, no hidden one carried", () => {
    const { frontMatter, doc } = parse("EDDA (V.O.)\nI kept the light.\n\nTOMAS (O.S.)\nOnly me.\n");
    const page = toEditorDoc(doc);
    expect(blockText(page, 0)).toBe("EDDA (V.O.)");
    // The writer renames TOMAS and deletes his extension, on the page.
    page.content[2].content = [{ type: "text", text: "MARA" }];
    const out = serialize({ frontMatter, doc: fromEditorDoc(page) });
    expect(out).toContain("EDDA (V.O.)\nI kept the light.");
    expect(out).not.toContain("(V.O.) (V.O.)");
    expect(out).toContain("MARA\nOnly me.");
    expect(out).not.toContain("(O.S.)");
  });

  it("round-trips every cue shape through the editor unchanged", () => {
    const text = [
      "EDDA (V.O.)", "One.", "",
      "HANS (on the radio)", "Two.", "",
      "EDDA (V.O.) (CONT'D)", "Three.", "",
      "BRICK", "Four.", "",
      "STEEL (O.S.) ^", "Five.", "",
    ].join("\n");
    const script = parse(text);
    const through = serialize({ frontMatter: script.frontMatter, doc: fromEditorDoc(toEditorDoc(script.doc)) });
    expect(through).toBe(serialize(script));
    expect(through).toContain("HANS (on the radio)\n");
    expect(through).toContain("STEEL (O.S.) ^\n");
  });

  it("leaves a bracket with no name in front of it as typed", () => {
    const back = fromEditorDoc(cue("(V.O.)"));
    expect(blockText(back)).toBe("(V.O.)");
    expect(back.content[0].attrs?.extension).toBeUndefined();
  });
});
