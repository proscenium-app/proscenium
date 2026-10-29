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
    const { frontMatter, doc } = parse(
      "EDDA (V.O.)\nI kept the light.\n\nTOMAS (O.S.)\nOnly me.\n",
    );
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
      "EDDA (V.O.)",
      "One.",
      "",
      "HANS (on the radio)",
      "Two.",
      "",
      "EDDA (V.O.) (CONT'D)",
      "Three.",
      "",
      "BRICK",
      "Four.",
      "",
      "STEEL (O.S.) ^",
      "Five.",
      "",
    ].join("\n");
    const script = parse(text);
    const through = serialize({
      frontMatter: script.frontMatter,
      doc: fromEditorDoc(toEditorDoc(script.doc)),
    });
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

/**
 * A cue with a comment on it, saved and read back onto the page
 * (docs/engineering/fountain-model.md#EDIT-174). The page is compared with a
 * script read again when one changes on disk, and only what differs is
 * replaced, so a comment that came back one character from where it stood
 * would be an edit nobody made.
 */
describe("a cue with a comment comes back onto the page as it left", () => {
  const text = (t: string) => ({ type: "text" as const, text: t });
  const note = (t: string) => ({ type: "note" as const, content: [text(t)] });
  const comment = note("Robin: (too formal?)");
  const speech = { type: "dialogue" as const, content: [text("Hello.")] };

  const pages: Record<string, [ReturnType<typeof text | typeof note>[], string]> = {
    "after the name": [[text("MARA"), comment], "@MARA[[Robin: (too formal?)]]"],
    "after the extension": [[text("MARA (V.O.)"), comment], "@MARA (V.O.)[[Robin: (too formal?)]]"],
    "between the name and the extension": [
      [text("MARA"), comment, text(" (V.O.)")],
      "@MARA[[Robin: (too formal?)]] (V.O.)",
    ],
    "inside the extension": [
      [text("MARA (V."), comment, text("O.)")],
      "@MARA (V.[[Robin: (too formal?)]]O.)",
    ],
    "before the name": [[comment, text("MARA (V.O.)")], "@[[Robin: (too formal?)]]MARA (V.O.)"],
    "alone before a bracket": [[comment, text(" (V.O.)")], "@[[Robin: (too formal?)]] (V.O.)"],
    "with a reply, and a second extension": [
      [text("MARA (V.O.)"), comment, note("Sam: keep"), text(" (CONT'D)")],
      "@MARA (V.O.)[[Robin: (too formal?)]][[Sam: keep]] (CONT'D)",
    ],
  };

  for (const [name, [content, line]] of Object.entries(pages)) {
    it(`a comment ${name}`, () => {
      const page: Doc = { type: "doc", content: [{ type: "character", content }, speech] };
      const saved = serialize({ frontMatter: {}, doc: fromEditorDoc(page) });
      expect(saved).toBe(`${line}\nHello.\n`);
      const read = parse(saved).doc;
      expect(read.content.map((b) => b.type)).toEqual(["character", "dialogue"]);
      expect(toEditorDoc(read)).toEqual(page);
    });
  }

  it("keeps one space between a name and its bracket, whichever side of the comment it was", () => {
    // `MARA `, the comment, `(V.O.)`: the space is the one the page prints
    // between a name and its extension, and a name that kept it printed two.
    const typed: Doc = {
      type: "doc",
      content: [{ type: "character", content: [text("MARA "), comment, text("(V.O.)")] }, speech],
    };
    const model = fromEditorDoc(typed);
    expect(model.content[0]).toEqual({
      type: "character",
      attrs: { extension: "(V.O.)" },
      content: [text("MARA"), comment],
    });
    const saved = serialize({ frontMatter: {}, doc: model });
    expect(saved).toBe("@MARA[[Robin: (too formal?)]] (V.O.)\nHello.\n");
    expect(parse(saved).doc).toEqual(model);
    const page = toEditorDoc(parse(saved).doc);
    expect(blockText(page)).toBe("MARA (V.O.)");
    expect(blockText(typed)).toBe("MARA (V.O.)");
    // And from there it is the page it is.
    expect(
      toEditorDoc(parse(serialize({ frontMatter: {}, doc: fromEditorDoc(page) })).doc),
    ).toEqual(page);
  });

  it("keeps a line break inside the comment, and the cue on one line", () => {
    const page = {
      type: "doc",
      content: [
        {
          type: "character",
          content: [
            text("MARA (V.O.)"),
            {
              type: "note",
              content: [text("Robin: rename?"), { type: "lineBreak" }, text("or cut")],
            },
          ],
        },
        speech,
      ],
    } as unknown as Doc;
    const saved = serialize({ frontMatter: {}, doc: fromEditorDoc(page) });
    expect(saved).toBe("@MARA (V.O.)[[Robin: rename?\nor cut]]\nHello.\n");
    expect(toEditorDoc(parse(saved).doc)).toEqual(page);
  });
});

/**
 * A cue with no speech under it (docs/engineering/fountain-model.md#EDIT-175).
 * It was a stage direction on the page that came back. Now the page that comes
 * back holds the cue as the writer left it, its extension still text, and an
 * empty speech under it: the file says a cue over a speech with no words yet.
 */
describe("a cue with no speech under it comes back onto the page as a cue", () => {
  const text = (t: string) => ({ type: "text" as const, text: t });
  const direction = { type: "action" as const, content: [text("She waits.")] };
  const noSpeechYet = { type: "dialogue" as const, content: [] };

  it("in the middle of a script and at its end", () => {
    for (const typed of ["MARA", "MARA (V.O.)"]) {
      const lone = { type: "character" as const, content: [text(typed)] };
      const page: Doc = { type: "doc", content: [lone, direction] };
      const saved = serialize({ frontMatter: {}, doc: fromEditorDoc(page) });
      expect(saved).toBe(`${typed}\n  \n\nShe waits.\n`);
      expect(toEditorDoc(parse(saved).doc).content).toEqual([lone, noSpeechYet, direction]);

      const last: Doc = { type: "doc", content: [direction, lone] };
      const end = serialize({ frontMatter: {}, doc: fromEditorDoc(last) });
      expect(end).toBe(`She waits.\n\n${typed}\n  \n`);
      expect(toEditorDoc(parse(end).doc).content).toEqual([direction, lone, noSpeechYet]);
    }
  });

  it("and from there the page and the script stay as they are", () => {
    const page: Doc = {
      type: "doc",
      content: [{ type: "character", content: [text("MARA (V.O.)")] }, noSpeechYet, direction],
    };
    const saved = serialize({ frontMatter: {}, doc: fromEditorDoc(page) });
    expect(saved).toBe("MARA (V.O.)\n  \n\nShe waits.\n");
    expect(toEditorDoc(parse(saved).doc)).toEqual(page);
  });
});

/**
 * A cue that holds lower case (docs/app/writing/editor-ux.md#EDIT-176). The
 * page says such a cue keeps its case with `forced`, which is what auto-caps
 * reads; the script says it with the letters themselves. Read back, the page
 * is the page that was saved, whole, so a script changed on disk replaces
 * nothing on a cue nobody changed.
 */
describe("a cue in mixed case comes back onto the page keeping its case", () => {
  const text = (t: string) => ({ type: "text" as const, text: t });
  const note = (t: string) => ({ type: "note" as const, content: [text(t)] });
  const comment = note("Robin: (who is this?)");
  const speech = { type: "dialogue" as const, content: [text("Hello.")] };
  const forced = { forced: true };

  type Inline = ReturnType<typeof text | typeof note>;
  const pages: Record<string, [Record<string, unknown>, Inline[], string]> = {
    "alone on its line": [forced, [text("McTeague")], "@McTeague"],
    "with an extension": [forced, [text("McTeague (V.O.)")], "@McTeague (V.O.)"],
    "in capitals, its extension in lower case": [
      forced,
      [text("HANS (on the radio)")],
      "HANS (on the radio)",
    ],
    "as the right-hand cue of a pair": [
      { ...forced, dual: true },
      [text("McTeague")],
      "@McTeague ^",
    ],
    "with a comment after its name": [
      forced,
      [text("McTeague"), comment],
      "@McTeague[[Robin: (who is this?)]]",
    ],
    "with a comment between its name and its extension": [
      forced,
      [text("McTeague"), comment, text(" (V.O.)")],
      "@McTeague[[Robin: (who is this?)]] (V.O.)",
    ],
    "with a comment after its extension": [
      forced,
      [text("McTeague (V.O.)"), comment],
      "@McTeague (V.O.)[[Robin: (who is this?)]]",
    ],
  };

  for (const [name, [attrs, content, line]] of Object.entries(pages)) {
    it(name, () => {
      const before = attrs.dual
        ? [{ type: "character" as const, content: [text("MARA")] }, speech]
        : [];
      const page: Doc = {
        type: "doc",
        content: [...before, { type: "character", attrs, content }, speech],
      };
      const saved = serialize({ frontMatter: {}, doc: fromEditorDoc(page) });
      expect(saved).toBe(`${attrs.dual ? "MARA\nHello.\n\n" : ""}${line}\nHello.\n`);
      expect(toEditorDoc(parse(saved).doc)).toEqual(page);
    });
  }

  it("with no speech under it", () => {
    const page: Doc = {
      type: "doc",
      content: [
        { type: "character", attrs: forced, content: [text("McTeague (V.O.)")] },
        { type: "dialogue", content: [] },
      ],
    };
    const saved = serialize({ frontMatter: {}, doc: fromEditorDoc(page) });
    expect(saved).toBe("@McTeague (V.O.)\n  \n");
    expect(toEditorDoc(parse(saved).doc)).toEqual(page);
  });

  it("says nothing of a cue in capitals, with a comment in lower case on it or without", () => {
    for (const script of [
      "MARA\nHello.\n",
      "MARA (V.O.)\nHello.\n",
      "@MARA[[Robin: (who is this?)]]\nHello.\n",
      "@MARA[[Robin: (who is this?)]] (V.O.)\nHello.\n",
    ]) {
      expect(toEditorDoc(parse(script).doc).content[0].attrs).toBeUndefined();
    }
  });

  it("goes out as the page holds it, and the script is written from the letters", () => {
    // What the page says goes out with the model, and comes back in with it.
    const { doc } = parse("@McTeague (V.O.)\nHello.\n");
    const out = fromEditorDoc(toEditorDoc(doc));
    expect(out.content[0]).toEqual({
      type: "character",
      attrs: { forced: true, extension: "(V.O.)" },
      content: [text("McTeague")],
    });
    expect(serialize({ frontMatter: {}, doc: out })).toBe("@McTeague (V.O.)\nHello.\n");
    expect(toEditorDoc(out)).toEqual(toEditorDoc(doc));

    // A cue the writer typed `@` on stays theirs in capitals, for as long as
    // the page lives. The script cannot say so, and does not.
    const typed: Doc = {
      type: "doc",
      content: [{ type: "character", attrs: forced, content: [text("NASA")] }, speech],
    };
    expect(toEditorDoc(fromEditorDoc(typed))).toEqual(typed);
    const saved = serialize({ frontMatter: {}, doc: fromEditorDoc(typed) });
    expect(saved).toBe("NASA\nHello.\n");
    expect(toEditorDoc(parse(saved).doc).content[0].attrs).toBeUndefined();
  });
});
