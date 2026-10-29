// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { Fountain, Lexer, rules } from "fountain-js";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateFormatSpec } from "../format/validate";
import { paginateDoc } from "../layout/engine";
import { serializeInline } from "./inline";
import { parse } from "./parse";
import { serialize } from "./serialize";
import { extractScenes } from "./scenes";
import { splitTitlePage } from "./titlepage";
import type { BlockNode, BlockType, FrontMatter, InlineNode } from "./model";

const SAMPLE = join(
  import.meta.dir,
  "../../sample-vault/The Weight of Water/The Weight of Water.fountain",
);
const sampleText = readFileSync(SAMPLE, "utf8");

/** The whole round-trip contract, applied to one source string. */
function expectRoundTripStable(input: string) {
  const doc1 = parse(input);
  const s1 = serialize(doc1);
  // Rule 2 — textual idempotency: re-serializing canonical form is a no-op.
  const s2 = serialize(parse(s1));
  expect(s2).toBe(s1);
  // Rule 1 — semantic round-trip: no node, attr, mark, or text changes.
  expect(parse(s1)).toEqual(doc1);
  // Rule 3 — clean output: it re-parses without throwing.
  expect(() => parse(s1)).not.toThrow();
}

describe("sample-vault fixture", () => {
  it("is already in canonical form (byte-stable round-trip)", () => {
    expect(serialize(parse(sampleText))).toBe(sampleText);
  });

  it("satisfies the full round-trip contract", () => {
    expectRoundTripStable(sampleText);
  });

  it("parses the title page (standard + house custom keys)", () => {
    const { frontMatter } = parse(sampleText);
    expect(frontMatter.title).toBe("The Weight of Water");
    expect(frontMatter.credit).toBe("a play by");
    expect(frontMatter.authors).toEqual(["A. Playwright"]);
    expect(frontMatter.draftDate).toBe("2026-06-18");
    expect(frontMatter.contact).toEqual(["playwright@example.com"]);
    expect(frontMatter.setting).toBe("A coastal kitchen, and the rooms of memory around it.");
    expect(frontMatter.time).toBe("The last night of winter.");
    expect(frontMatter.characters).toEqual([
      { name: "MARA", description: "a hydrologist, 40s" },
      { name: "JONAH", description: "her brother, 30s" },
    ]);
  });

  it("maps acts/scenes to Sections and finds synopses", () => {
    const { doc } = parse(sampleText);
    const acts = doc.content.filter((b) => b.type === "act");
    const scenes = doc.content.filter((b) => b.type === "scene");
    expect(acts.length).toBe(2);
    expect(scenes.length).toBe(3);

    const extracted = extractScenes(doc);
    expect(extracted.length).toBe(3);
    expect(extracted[0]).toMatchObject({
      ordinal: 0,
      act: "ACT ONE",
      heading: "SCENE 1",
      synopsis: "Mara, alone before dawn, can't stop the dripping. Jonah arrives uninvited.",
    });
    expect(extracted[2].act).toBe("ACT TWO");
  });

  it("has no element-type drift after a round-trip", () => {
    const before = parse(sampleText).doc.content.map((b: BlockNode) => b.type);
    const after = parse(serialize(parse(sampleText))).doc.content.map((b: BlockNode) => b.type);
    expect(after).toEqual(before);
  });
});

describe("edge-case corpus (full element set)", () => {
  const fixtures: Record<string, string> = {
    "dual dialogue": ["MARA", "Stay.", "", "JONAH ^", "I can't."].join("\n"),

    "emphasis: bold / italic / underline / combos": [
      "She said it was *important*, even **urgent**, and ***unmissable***.",
      "",
      "MARA",
      "It's _underlined_ and _*both*_ now.",
    ].join("\n"),

    "inline note": "She pauses [[is this too long?]] at the door.",

    "block note": ["Before.", "", "[[ a standalone thought ]]", "", "After."].join("\n"),

    "two notes on a line of their own": [
      "Before.",
      "",
      "[[a thought]][[an answer]]",
      "",
      "End.",
    ].join("\n"),

    "two notes on a line, in capitals": ["Before.", "", "[[CUT THIS]][[NO]]", "", "End."].join(
      "\n",
    ),

    "a word between two notes on a line": ["Before.", "", "[[one]] and [[two]]", "", "End."].join(
      "\n",
    ),

    "boneyard is preserved": ["Visible.", "", "/* hidden cut */", "", "End."].join("\n"),

    lyrics: ["MARA", "~Row, row, row your boat", "~Gently down the stream"].join("\n"),

    centered: "> THE END <",

    "natural transition": ["She leaves.", "", "CUT TO:"].join("\n"),

    "forced transition": ["She leaves.", "", "> BLACKOUT."].join("\n"),

    "scene heading with number": [
      "# ACT ONE",
      "",
      "## SCENE 1",
      "",
      "INT. KITCHEN - NIGHT #1A#",
      "",
      "Water everywhere.",
    ].join("\n"),

    "forced scene heading (stage locale)": [
      "## SCENE 1",
      "",
      ".A kitchen, before dawn",
      "",
      "Quiet.",
    ].join("\n"),

    "forced character (mixed case)": ["@McTEAGUE", "Aye."].join("\n"),

    "character with extension": ["MARA (O.S.)", "Where are you?"].join("\n"),

    "page break": ["One.", "", "===", "", "Two."].join("\n"),

    "all-caps action is forced": ["MARA", "Hello.", "", "!THE LIGHTS DIM."].join("\n"),

    "nested section becomes a sub-scene": [
      "# ACT ONE",
      "",
      "## SCENE 1",
      "",
      "### A beat",
      "",
      "Something small.",
    ].join("\n"),
  };

  for (const [name, src] of Object.entries(fixtures)) {
    it(`round-trips: ${name}`, () => {
      expectRoundTripStable(src);
    });
  }

  it("preserves boneyard content verbatim", () => {
    const { doc } = parse(["A.", "", "/* secret */", "", "B."].join("\n"));
    const bone = doc.content.find((b) => b.type === "boneyard");
    expect(bone).toBeDefined();
    expect(bone!.content).toEqual([{ type: "text", text: " secret " }]);
    expect(serialize({ frontMatter: {}, doc })).toContain("/* secret */");
  });

  it("marks the right cue of a dual pair", () => {
    const { doc } = parse(["MARA", "Stay.", "", "JONAH ^", "I can't."].join("\n"));
    const chars = doc.content.filter((b) => b.type === "character");
    expect(chars[0].attrs?.dual).toBeUndefined();
    expect(chars[1].attrs?.dual).toBe(true);
  });

  // A speech the writer spaced out: line breaks AND blank lines inside one
  // block. The blank line must serialize as Fountain's two-space line, or the
  // next parse ends the speech there and demotes the rest to action.
  it("keeps a spaced-out speech in one dialogue block", () => {
    const spaced = ["MARA", "It's colder than I remember.", "  ", "I keep listening.", ""].join(
      "\n",
    );
    expectRoundTripStable(spaced);
    const { doc } = parse(spaced);
    expect(doc.content.map((b) => b.type)).toEqual(["character", "dialogue"]);
    expect(doc.content[1].content).toEqual([
      { type: "text", text: "It's colder than I remember.\n\nI keep listening." },
    ]);
    // And a blank line authored in the model (Shift+Enter twice) survives too.
    const built = serialize({
      frontMatter: {},
      doc: {
        type: "doc",
        content: [
          { type: "character", content: [{ type: "text", text: "MARA" }] },
          { type: "dialogue", content: [{ type: "text", text: "One.\n\nTwo." }] },
        ],
      },
    });
    expect(built).toBe("MARA\nOne.\n  \nTwo.\n");
    expect(parse(built).doc.content.map((b) => b.type)).toEqual(["character", "dialogue"]);
  });

  it("distinguishes block note from inline note", () => {
    const block = parse("[[ standalone ]]").doc.content[0];
    expect(block.type).toBe("action");
    expect(block.content?.[0].type).toBe("note");

    const inlineDoc = parse("She waits [[beat]] then speaks.").doc.content[0];
    expect(inlineDoc.type).toBe("action");
    const noteCount = inlineDoc.content?.filter((n) => n.type === "note").length;
    expect(noteCount).toBe(1);
  });

  it("reads a line of several notes as several, not as one holding the rest", () => {
    // The tokenizer's rule for a note line runs from the first `[[` to the
    // last `]]`: two notes came back as one whose text was `a]][[b`, and a
    // word between two notes was hidden inside it.
    const pair = parse("[[a thought]][[an answer]]").doc.content[0];
    expect(pair.content).toEqual([
      { type: "note", content: [{ type: "text", text: "a thought" }] },
      { type: "note", content: [{ type: "text", text: "an answer" }] },
    ]);
    const spoken = parse("[[one]] and [[two]]").doc.content[0];
    expect(spoken.content?.map((n) => (n.type === "text" ? n.text : "note"))).toEqual([
      "note",
      " and ",
      "note",
    ]);
  });
});

describe("fountain.io spec's own examples", () => {
  // Canonical snippets reproduced from the Fountain syntax spec (fountain.io).
  const spec: Record<string, string> = {
    "scene heading": "EXT. BRICK'S POOL - DAY",

    "character + dialogue": ["STEEL", "The man's a myth!"].join("\n"),

    "dual dialogue (Brick & Steel)": [
      "BRICK",
      "Screw retirement.",
      "",
      "STEEL ^",
      "Screw retirement.",
    ].join("\n"),

    transition: ["Jack begins to argue vociferously.", "", "CUT TO:"].join("\n"),

    lyrics: "~Willy Wonka! Willy Wonka! The amazing chocolatier",

    centered: "> THE END <",

    "sections and synopses": ["# Act", "", "= Set up the characters.", "", "## Sequence"].join(
      "\n",
    ),

    "inline note (wait for the phone)": [
      "His hand is an inch from the receiver when the phone RINGS.  [[ wait for the phone to ring ]]",
    ].join("\n"),

    boneyard: [
      "Murtaugh, springing hell bent for leather.",
      "",
      "/*",
      "Murtaugh, screaming, dives through the air.",
      "*/",
      "",
      "And we're back.",
    ].join("\n"),
  };

  for (const [name, src] of Object.entries(spec)) {
    it(`round-trips: ${name}`, () => {
      expectRoundTripStable(src);
    });
  }
});

describe("docs/app/keeping-work/storage-and-file-format.md#STOR-107 — never break on bad input", () => {
  const nasties = [
    "",
    "\n\n\n",
    "\x00\x01 garbage �",
    "[[ unclosed note",
    "*unbalanced **emphasis",
    "/* unterminated boneyard",
    "Title: orphan with no body\n",
  ];
  for (const input of nasties) {
    it(`does not throw: ${JSON.stringify(input.slice(0, 20))}`, () => {
      expect(() => serialize(parse(input))).not.toThrow();
    });
  }
});

/**
 * Shift+Enter's output has to survive a save and reload unchanged, or the
 * script quietly restructures itself under the writer. It makes a single line
 * break inside the block, in every element that holds more than one line.
 */
describe("Shift+Enter shapes are stable on disk", () => {
  it("a broken stage direction stays ONE action block", () => {
    const src = "She crosses.\nShe opens it.\n";
    expectRoundTripStable(src);
    expect(parse(src).doc.content.map((b) => b.type)).toEqual(["action"]);
  });

  it("a broken speech stays ONE dialogue block", () => {
    const src = "MARA\nOne.\nTwo.\n";
    expectRoundTripStable(src);
    expect(parse(src).doc.content.map((b) => b.type)).toEqual(["character", "dialogue"]);
  });

  it("an ALL-CAPS direction with a break is forced, so it can't become a cue", () => {
    // Without the `!`, "LIGHTS UP." followed by a line would re-parse as a
    // character cue with the rest as their dialogue.
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "action" as const,
          content: [{ type: "text" as const, text: "LIGHTS UP.\nShe is alone." }],
        },
      ],
    };
    const text = serialize({ frontMatter: {}, doc });
    expect(text).toBe("!LIGHTS UP.\nShe is alone.\n");
    expect(parse(text).doc.content.map((b) => b.type)).toEqual(["action"]);
    expectRoundTripStable(text);
  });

  /** The blank-line shapes the format still supports — from Enter, or a hand-edit. */
  it("a blank line between directions is two action blocks", () => {
    const src = "She crosses.\n\nShe opens it.\n";
    expectRoundTripStable(src);
    expect(parse(src).doc.content.map((b) => b.type)).toEqual(["action", "action"]);
  });

  it("a blank line inside a speech needs Fountain's two-space line to survive", () => {
    expectRoundTripStable("MARA\nOne.\n  \nTwo.\n");
    // A bare empty line instead would end the speech and demote the rest:
    expect(parse("MARA\nOne.\n\nTwo.\n").doc.content.map((b) => b.type)).toEqual([
      "character",
      "dialogue",
      "action",
    ]);
  });
});

/**
 * A comment on a name (docs/engineering/fountain-model.md#EDIT-174). Each
 * block is built as the editor hands it over, written, and read back: every
 * block keeps its type, nothing in it changes, and the text written is the
 * text written again.
 */
const text = (t: string): InlineNode => ({ type: "text", text: t });
const note = (t: string): InlineNode => ({ type: "note", content: [text(t)] });

/** Blocks as the editor hands them over, written and read back unchanged. */
function written(blocks: BlockNode[]): string {
  const doc = { type: "doc" as const, content: blocks };
  const source = serialize({ frontMatter: {}, doc });
  const read = parse(source);
  expect(read.doc.content.map((b) => b.type)).toEqual(blocks.map((b) => b.type));
  expect(read.doc).toEqual(doc);
  expect(serialize(read)).toBe(source);
  return source;
}

describe("a comment in a cue or a heading survives a save and a reopen", () => {
  const cue = (content: InlineNode[], attrs?: Record<string, unknown>): BlockNode => ({
    type: "character",
    ...(attrs ? { attrs } : {}),
    content,
  });
  const speech = (t: string): BlockNode => ({ type: "dialogue", content: [text(t)] });
  const comment = note("Robin: rename?");

  it("the reported case: MARA, a comment, and her speech", () => {
    expect(written([cue([text("MARA"), comment]), speech("Hello.")])).toBe(
      "@MARA[[Robin: rename?]]\nHello.\n",
    );
  });

  const cues: Record<string, [BlockNode, string]> = {
    "after the name": [cue([text("MARA"), comment]), "@MARA[[Robin: rename?]]"],
    "before the name": [cue([comment, text("MARA")]), "@[[Robin: rename?]]MARA"],
    "inside the name": [cue([text("MA"), comment, text("RA")]), "@MA[[Robin: rename?]]RA"],
    "after a space": [cue([text("MARA "), comment]), "@MARA [[Robin: rename?]]"],
    "between the name and its extension": [
      cue([text("MARA"), comment], { extension: "(V.O.)" }),
      "@MARA[[Robin: rename?]] (V.O.)",
    ],
    "after the extension, where the editor leaves it in the text": [
      cue([text("MARA (V.O.)"), comment]),
      "@MARA (V.O.)[[Robin: rename?]]",
    ],
    "inside the extension": [
      cue([text("MARA (V."), comment, text("O.)")]),
      "@MARA (V.[[Robin: rename?]]O.)",
    ],
    "before a bracket with no name in front of it": [
      cue([comment, text(" (V.O.)")]),
      "@[[Robin: rename?]] (V.O.)",
    ],
    "with parentheses in it": [
      cue([text("MARA"), note("Robin: (too formal?)")]),
      "@MARA[[Robin: (too formal?)]]",
    ],
    "with parentheses in it, and an extension": [
      cue([text("MARA"), note("Robin: (too formal?)")], { extension: "(O.S.)" }),
      "@MARA[[Robin: (too formal?)]] (O.S.)",
    ],
    "with a caret in it": [cue([text("MARA"), note("x^2?")]), "@MARA[[x^2?]]"],
    "with a line break in it": [
      cue([text("MARA"), note("Robin: rename?\nor cut her")]),
      "@MARA[[Robin: rename?\nor cut her]]",
    ],
    "in capitals": [cue([text("MARA"), note("CUT")]), "@MARA[[CUT]]"],
    "with a reply": [
      cue([text("MARA"), comment, note("Sam: no")]),
      "@MARA[[Robin: rename?]][[Sam: no]]",
    ],
    "on a name in mixed case": [cue([text("McTEAGUE"), comment]), "@McTEAGUE[[Robin: rename?]]"],
    "on an emphasised name": [
      cue([{ type: "text", text: "MARA", marks: [{ type: "em" }] }, comment]),
      "@*MARA*[[Robin: rename?]]",
    ],
    "alone, with no name yet": [cue([comment]), "@[[Robin: rename?]]"],
  };

  for (const [name, [block, line]] of Object.entries(cues)) {
    it(`a cue with a comment ${name}`, () => {
      expect(written([block, speech("Hello.")])).toBe(`${line}\nHello.\n`);
    });
  }

  it("a dual cue with a comment, with and without an extension", () => {
    const left = [cue([text("BRICK")]), speech("Stay.")];
    expect(written([...left, cue([text("STEEL"), comment], { dual: true }), speech("No.")])).toBe(
      "BRICK\nStay.\n\n@STEEL[[Robin: rename?]] ^\nNo.\n",
    );
    expect(
      written([
        ...left,
        cue([text("STEEL"), note("Robin: (louder)")], { dual: true, extension: "(O.S.)" }),
        speech("No."),
      ]),
    ).toBe("BRICK\nStay.\n\n@STEEL[[Robin: (louder)]] (O.S.) ^\nNo.\n");
    expect(
      written([...left, cue([text("STEEL (O.S.)"), comment], { dual: true }), speech("No.")]),
    ).toBe("BRICK\nStay.\n\n@STEEL (O.S.)[[Robin: rename?]] ^\nNo.\n");
  });

  it("a cue with a comment over a speech that has no words yet", () => {
    expect(written([cue([text("MARA"), comment]), { type: "dialogue", content: [] }])).toBe(
      "@MARA[[Robin: rename?]]\n  \n",
    );
  });

  it("a cue with a comment, a parenthetical under it, and action around it", () => {
    written([
      { type: "action", content: [text("She waits.")] },
      cue([text("MARA (V.O.)"), note("Robin: (too formal?)\nsecond line")]),
      { type: "parenthetical", content: [text("quietly")] },
      speech("Hello."),
      { type: "action", content: [text("She goes.")] },
    ]);
  });

  const headings: Record<string, [BlockNode, string]> = {
    "an act": [{ type: "act", content: [text("ACT ONE"), comment] }, "# ACT ONE[[Robin: rename?]]"],
    "a scene, mid-title": [
      { type: "scene", content: [text("SCENE "), comment, text("1")] },
      "## SCENE [[Robin: rename?]]1",
    ],
    "a nested scene": [
      { type: "scene", attrs: { level: 3 }, content: [comment, text("A beat")] },
      "### [[Robin: rename?]]A beat",
    ],
    "a scene heading": [
      { type: "sceneHeading", content: [text("INT. KITCHEN"), comment, text(" - NIGHT")] },
      "INT. KITCHEN[[Robin: rename?]] - NIGHT",
    ],
    "a numbered scene heading": [
      {
        type: "sceneHeading",
        attrs: { sceneNumber: "1A" },
        content: [text("INT. KITCHEN - NIGHT"), comment],
      },
      "INT. KITCHEN - NIGHT[[Robin: rename?]] #1A#",
    ],
    "a scene heading that opens with the comment": [
      { type: "sceneHeading", content: [comment, text("INT. KITCHEN - NIGHT")] },
      ".[[Robin: rename?]]INT. KITCHEN - NIGHT",
    ],
    "a stage locale": [
      { type: "sceneHeading", content: [text("A kitchen, before dawn"), note("Robin: (where?)")] },
      ".A kitchen, before dawn[[Robin: (where?)]]",
    ],
  };

  for (const [name, [block, line]] of Object.entries(headings)) {
    it(`${name} with a comment`, () => {
      expect(written([block, { type: "action", content: [text("Quiet.")] }])).toBe(
        `${line}\n\nQuiet.\n`,
      );
    });
  }

  it("a heading whose comment holds a line break stays one heading", () => {
    const broken = note("Robin: rename?\nor cut it");
    const source = written([
      { type: "act", content: [text("ACT ONE"), broken] },
      { type: "scene", content: [text("SCENE "), broken, text("1")] },
      {
        type: "sceneHeading",
        attrs: { sceneNumber: "1A" },
        content: [text("INT. KITCHEN"), broken, text(" - NIGHT"), note("Sam: keep")],
      },
      { type: "action", content: [text("Quiet.")] },
      { type: "sceneHeading", content: [text("A kitchen"), broken] },
      { type: "action", content: [text("Quieter.")] },
    ]);
    expect(source).toContain("# ACT ONE[[Robin: rename?\nor cut it]]\n\n");
    expect(source).toContain("INT. KITCHEN[[Robin: rename?\nor cut it]] - NIGHT[[Sam: keep]] #1A#");
  });

  it("reads a forced cue someone else wrote, wherever its notes stand", () => {
    const types = (source: string) => parse(source).doc.content.map((b) => b.type);
    // After the caret, and between the space and the bracket: not where the
    // app writes a note, and a cue all the same.
    const dual = parse("BRICK\nStay.\n\n@STEEL ^[[louder]]\nNo.\n").doc.content[2];
    expect(dual).toEqual(cue([text("STEEL "), note("louder")], { dual: true }));
    const spaced = parse("@MARA [[louder]](V.O.)\nHello.\n").doc.content[0];
    expect(spaced).toEqual(cue([text("MARA"), note("louder")], { extension: "(V.O.)" }));
    expect(types("  @MARA[[a (b)]]\nHello.\n")).toEqual(["character", "dialogue"]);
    for (const source of [
      "BRICK\nStay.\n\n@STEEL ^[[louder]]\nNo.\n",
      "@MARA [[louder]](V.O.)\nHello.\n",
    ]) {
      expectRoundTripStable(source);
    }
  });

  it("leaves a line that is no cue exactly as it was written", () => {
    // No speech under it, a caret in the name, a bracket the tokenizer will
    // not have: each was a stage direction before, and is the same one now.
    for (const source of [
      "@MARA[[Robin: rename?]]\n",
      "@MARA[[Robin: rename?]]\n\nShe waits.\n",
      "@MA^RA[[Robin: (rename)?]]\nHello.\n",
      "@MARA (V.O.) again[[Robin: rename?\nor cut]]\nHello.\n",
    ]) {
      const first = parse(source).doc.content[0];
      expect(first.type).toBe("action");
      const line = source.split("\n\n")[0].replace(/\n$/, "");
      expect(serialize({ frontMatter: {}, doc: { type: "doc", content: [first] } })).toBe(
        `!${line}\n`,
      );
      expectRoundTripStable(source);
    }
  });

  it("reads a cue with no @ as it always did", () => {
    // In capitals throughout, it is a cue; with a note in lower case it may
    // as well be a stage direction, and scripts on disk read as they did.
    expect(parse("MARA[[CUT]]\nHello.\n").doc.content.map((b) => b.type)).toEqual([
      "character",
      "dialogue",
    ]);
    expect(parse("MARA[[Robin: rename?]]\nHello.\n").doc.content.map((b) => b.type)).toEqual([
      "action",
    ]);
    expectRoundTripStable("MARA[[CUT]]\nHello.\n");
    expectRoundTripStable("MARA[[Robin: rename?]]\nHello.\n");
  });

  it("takes an escaped bracket and an unclosed one for the text they are", () => {
    expect(parse("@MARA\\[[not a note]]\nHello.\n").doc.content[0]).toEqual(
      cue([text("MARA[[not a note]]")]),
    );
    expect(parse("@MARA[[unclosed\nHello.\n").doc.content[0]).toEqual(
      cue([text("MARA[[unclosed")]),
    );
    expectRoundTripStable("@MARA\\[[not a note]]\nHello.\n");
    expectRoundTripStable("@MARA[[unclosed\nHello.\n");
  });

  it("keeps a script that already holds the tag's character", () => {
    const source = "@MARA[[Robin: (rename)?]]\nHello 0 there.\n";
    expect(parse(source).doc.content).toEqual([
      cue([text("MARA"), note("Robin: (rename)?")]),
      speech("Hello 0 there."),
    ]);
    expectRoundTripStable(source);
  });
});

/**
 * A cue with no speech under it (docs/engineering/fountain-model.md#EDIT-175).
 *
 * To a Fountain reader a line is a cue only with a line directly under it. A
 * `character` block followed by anything but a speech was written over a blank
 * line, so it came back as a stage direction and the next save wrote `!MARA`;
 * one in mixed case came back as a direction reading `@Ivo`. The writer makes
 * such a cue by changing the element of the line under it, by deleting that
 * line, or by setting a line to Character and going elsewhere.
 *
 * It is written as a cue over a speech with no words yet, Fountain's two-space
 * line, and that is what it reads back as: the cue as it was, and an empty
 * speech under it.
 */
describe("a cue with no speech under it survives a save and a reopen", () => {
  const text = (t: string): InlineNode => ({ type: "text", text: t });
  const note = (t: string): InlineNode => ({ type: "note", content: [text(t)] });
  const block = (type: BlockNode["type"], t: string): BlockNode => ({ type, content: [text(t)] });
  const cue = (name: string, attrs?: Record<string, unknown>): BlockNode => ({
    type: "character",
    ...(attrs ? { attrs } : {}),
    content: [text(name)],
  });
  const noSpeechYet: BlockNode = { type: "dialogue", content: [] };
  const before = block("action", "A room.");
  const after = block("action", "She waits.");
  const script = (...content: BlockNode[]) =>
    serialize({ frontMatter: {}, doc: { type: "doc", content } });
  const reopened = (source: string) => parse(source).doc.content;

  /** Each cue, and the line it is written as. */
  const cues: [string, BlockNode, string][] = [
    ["in capitals", cue("MARA"), "MARA"],
    ["in mixed case", cue("Ivo"), "@Ivo"],
    ["in capitals, with an extension", cue("MARA", { extension: "(O.S.)" }), "MARA (O.S.)"],
    ["in mixed case, with an extension", cue("Ivo", { extension: "(V.O.)" }), "@Ivo (V.O.)"],
  ];

  for (const [what, lone, line] of cues) {
    it(`${what}, with the script going on under it`, () => {
      const source = script(before, lone, after);
      expect(source).toBe(`A room.\n\n${line}\n  \n\nShe waits.\n`);
      expect(reopened(source)).toEqual([before, lone, noSpeechYet, after]);
      // The save after the reopen: the same bytes, and no `!` on the cue.
      expect(serialize(parse(source))).toBe(source);
      expectRoundTripStable(source);
    });

    it(`${what}, as the last line of the script`, () => {
      const source = script(before, lone);
      expect(source).toBe(`A room.\n\n${line}\n  \n`);
      expect(reopened(source)).toEqual([before, lone, noSpeechYet]);
      expect(serialize(parse(source))).toBe(source);
      expectRoundTripStable(source);
    });
  }

  it("as the right-hand cue of a dual pair, in each of those shapes", () => {
    const left = [cue("MARA"), block("dialogue", "Stay.")];
    const rights: [BlockNode, string][] = [
      [cue("JONAH", { dual: true }), "JONAH ^"],
      [cue("Jonah", { dual: true }), "@Jonah ^"],
      [cue("JONAH", { extension: "(O.S.)", dual: true }), "JONAH (O.S.) ^"],
      [cue("Jonah", { extension: "(O.S.)", dual: true }), "@Jonah (O.S.) ^"],
    ];
    for (const [right, line] of rights) {
      const mid = script(...left, right, after);
      expect(mid).toBe(`MARA\nStay.\n\n${line}\n  \n\nShe waits.\n`);
      expect(reopened(mid)).toEqual([...left, right, noSpeechYet, after]);
      expectRoundTripStable(mid);

      const last = script(...left, right);
      expect(last).toBe(`MARA\nStay.\n\n${line}\n  \n`);
      expect(reopened(last)).toEqual([...left, right, noSpeechYet]);
      expectRoundTripStable(last);
    }
  });

  it("when both cues of a dual pair have none, and when two cues stand in a row", () => {
    const right = cue("JONAH", { dual: true });
    const pair = script(cue("MARA"), right, after);
    expect(pair).toBe("MARA\n  \n\nJONAH ^\n  \n\nShe waits.\n");
    expect(reopened(pair)).toEqual([cue("MARA"), noSpeechYet, right, noSpeechYet, after]);
    expectRoundTripStable(pair);

    const row = script(cue("MARA"), cue("Ivo"), cue("JONAH"), block("dialogue", "Hello."));
    expect(row).toBe("MARA\n  \n\n@Ivo\n  \n\nJONAH\nHello.\n");
    expect(reopened(row)).toEqual([
      cue("MARA"),
      noSpeechYet,
      cue("Ivo"),
      noSpeechYet,
      cue("JONAH"),
      block("dialogue", "Hello."),
    ]);
    expectRoundTripStable(row);
  });

  it("whatever element stands under it", () => {
    const followers: BlockNode[] = [
      block("scene", "SCENE 2"),
      block("act", "ACT TWO"),
      block("sceneHeading", "A kitchen, before dawn"),
      block("transition", "BLACKOUT."),
      block("centered", "THE END"),
      block("synopsis", "She does not answer."),
      { type: "pageBreak" },
      { type: "boneyard", content: [text(" a cut ")] },
      { type: "action", content: [note("Robin: who answers?")] },
      block("action", "THE LIGHTS DIM."),
    ];
    for (const next of followers) {
      for (const [, lone] of cues) {
        const source = script(lone, next);
        expect(reopened(source)).toEqual([lone, noSpeechYet, next]);
        expectRoundTripStable(source);
      }
    }
  });

  it("is the same script as a cue over a speech with no words yet", () => {
    for (const [, lone] of cues) {
      expect(script(lone)).toBe(script(lone, noSpeechYet));
      expect(script(before, lone, after)).toBe(script(before, lone, noSpeechYet, after));
    }
  });

  it("with a comment on it, and with a comment and no name", () => {
    // A cue that holds a note is forced (docs/engineering/fountain-model.md#EDIT-174),
    // and a forced line alone came back as a stage direction with the `@` in
    // its text.
    const noted: BlockNode = { type: "character", content: [text("MARA"), note("Robin: rename?")] };
    const source = script(noted, after);
    expect(source).toBe("@MARA[[Robin: rename?]]\n  \n\nShe waits.\n");
    expect(reopened(source)).toEqual([noted, noSpeechYet, after]);
    expectRoundTripStable(source);

    const broken: BlockNode = {
      type: "character",
      attrs: { dual: true },
      content: [text("JONAH (O.S.)"), note("Robin: louder?\nor cut")],
    };
    const dual = script(cue("MARA"), block("dialogue", "Stay."), broken);
    expect(dual).toBe("MARA\nStay.\n\n@JONAH (O.S.)[[Robin: louder?\nor cut]] ^\n  \n");
    expect(reopened(dual)).toEqual([cue("MARA"), block("dialogue", "Stay."), broken, noSpeechYet]);
    expectRoundTripStable(dual);

    const unnamed: BlockNode = { type: "character", content: [note("Robin: who speaks?")] };
    const nameless = script(before, unnamed, after);
    expect(nameless).toBe("A room.\n\n@[[Robin: who speaks?]]\n  \n\nShe waits.\n");
    expect(reopened(nameless)).toEqual([before, unnamed, noSpeechYet, after]);
    expectRoundTripStable(nameless);
  });

  it("leaves an empty cue the empty line it was", () => {
    const source = script(before, { type: "character", content: [] }, after);
    expect(source).not.toMatch(/^ {2}$/m);
    expect(reopened(source)).toEqual([before, after]);
  });

  it("reads a line that stands alone in a file as it always did", () => {
    // A cue in a file has a line under it: that is Fountain's rule, and the
    // reading of every script on disk. A script saved before this holds its
    // lone cue over a blank line, where nothing tells it from a direction in
    // capitals, so it is not guessed at; the forced one reads with its `@`.
    expect(reopened("MARA\n\nShe waits.\n")).toEqual([block("action", "MARA"), after]);
    expect(reopened("@Ivo\n\nShe waits.\n")).toEqual([block("action", "@Ivo"), after]);
    expectRoundTripStable("MARA\n\nShe waits.\n");
    expectRoundTripStable("@Ivo\n\nShe waits.\n");
  });
});

/**
 * A sung speech (docs/engineering/fountain-model.md#EDIT-175): a lyric is one
 * of the three things that can stand directly under a cue. It was written with
 * a blank line between, which made its cue a lone one and so a stage direction.
 * Written directly under the cue, as Fountain has it, it met a fault in the
 * tokenizer, which throws on a speech that opens with a sung line: the whole
 * script came back as one stage direction.
 */
describe("a sung speech keeps its cue", () => {
  const text = (t: string): InlineNode => ({ type: "text", text: t });
  const block = (type: BlockNode["type"], t: string): BlockNode => ({ type, content: [text(t)] });
  const cue = (name: string, attrs?: Record<string, unknown>): BlockNode => ({
    type: "character",
    ...(attrs ? { attrs } : {}),
    content: [text(name)],
  });
  const song = block("lyric", "Row the boat\nGently now");
  const script = (...content: BlockNode[]) =>
    serialize({ frontMatter: {}, doc: { type: "doc", content } });
  const reopened = (source: string) => parse(source).doc.content;

  it("a song is written directly under its cue and read back", () => {
    const singers: [BlockNode, string][] = [
      [cue("MARA"), "MARA"],
      [cue("Ivo"), "@Ivo"],
      [cue("MARA", { extension: "(O.S.)" }), "MARA (O.S.)"],
    ];
    for (const [singer, line] of singers) {
      const source = script(block("action", "A room."), singer, song, block("action", "Quiet."));
      expect(source).toBe(`A room.\n\n${line}\n~Row the boat\n~Gently now\n\nQuiet.\n`);
      expect(reopened(source)).toEqual([
        block("action", "A room."),
        singer,
        song,
        block("action", "Quiet."),
      ]);
      expectRoundTripStable(source);
    }

    const right = cue("JONAH", { dual: true });
    const duet = script(cue("MARA"), song, right, song);
    expect(duet).toBe("MARA\n~Row the boat\n~Gently now\n\nJONAH ^\n~Row the boat\n~Gently now\n");
    expect(reopened(duet)).toEqual([cue("MARA"), song, right, song]);
    expectRoundTripStable(duet);
  });

  it("a cue with a comment on it over a song", () => {
    const noted: BlockNode = {
      type: "character",
      content: [text("MARA"), { type: "note", content: [text("Robin: rename?")] }],
    };
    const source = script(noted, song);
    expect(source).toBe("@MARA[[Robin: rename?]]\n~Row the boat\n~Gently now\n");
    expect(reopened(source)).toEqual([noted, song]);
    expectRoundTripStable(source);
  });

  it("a script someone else wrote reads past its first sung speech", () => {
    // Before, the tokenizer's throw left one `action` block holding all of it.
    const source = "A room.\n\nMARA\n~Row the boat\n~Gently now\n\nShe stops.\n";
    expect(reopened(source)).toEqual([
      block("action", "A room."),
      cue("MARA"),
      song,
      block("action", "She stops."),
    ]);
    expectRoundTripStable(source);
  });

  it("a lyric lower in a speech, and a verse of its own, read as they did", () => {
    const types = (source: string) => reopened(source).map((b) => b.type);
    expect(types("MARA\n(singing)\n~Row the boat\n")).toEqual([
      "character",
      "parenthetical",
      "lyric",
    ]);
    expect(types("MARA\nListen.\n~Row the boat\n")).toEqual(["character", "dialogue", "lyric"]);
    expect(types("MARA\n  \n~Row the boat\n")).toEqual(["character", "dialogue", "lyric"]);
    // Two verses under a cue stay two: the second is a block of its own.
    const verses = script(cue("MARA"), block("lyric", "Row"), block("lyric", "Gently"));
    expect(verses).toBe("MARA\n~Row\n\n~Gently\n");
    expect(reopened(verses)).toEqual([
      cue("MARA"),
      block("lyric", "Row"),
      block("lyric", "Gently"),
    ]);
  });

  it("leaves a block that is no speech exactly as it was written", () => {
    // A first line the tokenizer takes for no cue, over a sung one: the line
    // that stood between them while it read is gone again.
    for (const source of ["She sings:\n~La la\n", "~ not sung\n~La la\n"]) {
      expect(reopened(source)).toEqual([block("action", source.trimEnd())]);
      expectRoundTripStable(source);
    }
    expect(serialize(parse("She sings:\n~La la\n"))).toBe("She sings:\n~La la\n");
  });

  it("keeps a script that already holds the stand-in line's own characters", () => {
    const mark = String.fromCharCode(0xe001);
    const source = `MARA\n~Row ${mark}SUNG${mark} the boat\n`;
    expect(reopened(source)).toEqual([
      cue("MARA"),
      block("lyric", `Row ${mark}SUNG${mark} the boat`),
    ]);
    expectRoundTripStable(source);
  });
});

/**
 * A cue's name (docs/engineering/fountain-model.md#EDIT-179). The tokenizer
 * reads what a line is from the name on it: a number is no cue to it, nor is a
 * name that opens with another element's mark, nor one that ends as a
 * transition does. Each was written as it stood and came back as a stage
 * direction, its speech run into the same block. Behind an `@` each is a cue.
 *
 * So the serializer forces the lines the tokenizer would refuse as they stand
 * and take forced, and no others: an `@` on a name that needs none would
 * rewrite every script on its next save. What the tokenizer would refuse is
 * asked of its own rule here, not of a list.
 */
describe("a cue keeps its name, whatever the name is", () => {
  const text = (t: string): InlineNode => ({ type: "text", text: t });
  const note = (t: string): InlineNode => ({ type: "note", content: [text(t)] });
  const block = (type: BlockNode["type"], t: string): BlockNode => ({ type, content: [text(t)] });
  const cue = (name: string | InlineNode[], attrs?: Record<string, unknown>): BlockNode => ({
    type: "character",
    ...(attrs ? { attrs } : {}),
    content: typeof name === "string" ? [text(name)] : name,
  });
  const speech = block("dialogue", "Hello.");
  const noSpeechYet: BlockNode = { type: "dialogue", content: [] };
  const before = block("action", "A room.");
  const after = block("action", "She waits.");
  const left = [cue("BRICK"), block("dialogue", "Stay.")];
  const script = (...content: BlockNode[]) =>
    serialize({ frontMatter: {}, doc: { type: "doc", content } });
  const reopened = (source: string) => parse(source).doc.content;

  /**
   * The tokenizer's answer, from its own rule: is this line, with a line under
   * it, a cue as it stands? A line that opens with `@` is a cue to it and not
   * this one: the `@` is the forcing mark, and is gone from the name.
   */
  const aCueAsItStands = (line: string) =>
    rules.dialogue.test(`${line}\nHello.`) && !/^\s*@/.test(line);

  /** What a cue's line holds after the name. */
  const shapes: [Record<string, unknown> | undefined, string][] = [
    [undefined, ""],
    [{ extension: "(V.O.)" }, " (V.O.)"],
    [{ dual: true }, " ^"],
    [{ extension: "(V.O.)", dual: true }, " (V.O.) ^"],
  ];

  /**
   * One name in each shape, over a speech and with none. Every time, the line
   * has an `@` exactly when the tokenizer would not take it without, the cue
   * comes back the block it was, and the save after writes the same bytes.
   * Returns the four lines written.
   */
  function survives(name: string | InlineNode[]): string[] {
    return shapes.map(([attrs, ending]) => {
      const named = cue(name, attrs);
      const bare = serializeInline(named.content ?? []) + ending;
      const line = aCueAsItStands(bare) ? bare : `@${bare}`;
      const lead = attrs?.dual ? left : [before];
      const head = attrs?.dual ? "BRICK\nStay." : "A room.";

      const spoken = script(...lead, named, speech, after);
      expect(spoken).toBe(`${head}\n\n${line}\nHello.\n\nShe waits.\n`);
      expect(reopened(spoken)).toEqual([...lead, named, speech, after]);
      expect(serialize(parse(spoken))).toBe(spoken);

      const lone = script(...lead, named, after);
      expect(lone).toBe(`${head}\n\n${line}\n  \n\nShe waits.\n`);
      expect(reopened(lone)).toEqual([...lead, named, noSpeechYet, after]);
      expect(serialize(parse(lone))).toBe(lone);
      return line;
    });
  }

  /** Each kind of name the tokenizer refuses with no `@`. */
  const refused: [string, string][] = [
    ["a number", "2"],
    ["a longer number", "007"],
    ["numbers with spaces between them", "1 2 3"],
    ["a name that opens with #", "#2 FAN"],
    ["a name that opens with a full stop", ".38"],
    ["an ellipsis", "..."],
    ["a name that opens with !", "!KUNG"],
    ["a name that opens with >", "> BLACKOUT"],
    ["a name that opens with ~", "~TILDE"],
    ["a name that opens with =", "= EQUALS"],
    ["a page break's three", "==="],
    ["a name that opens with @", "@HOME"],
    ["a name that ends in TO:", "OTTO:"],
    ["a name that ends in OUT.", "SCOUT."],
    ["a name that ends in BLACK.", "MR. BLACK."],
  ];

  for (const [what, name] of refused) {
    it(`${what}: ${name}`, () => {
      const spoken = script(cue(name), speech);
      expect(spoken).toBe(`@${name}\nHello.\n`);
      expect(reopened(spoken)).toEqual([cue(name), speech]);
      // With no speech, in the middle of a script and as its last line
      // (docs/engineering/fountain-model.md#EDIT-175).
      const last = script(before, cue(name));
      expect(last).toBe(`A room.\n\n@${name}\n  \n`);
      expect(reopened(last)).toEqual([before, cue(name), noSpeechYet]);
      expectRoundTripStable(spoken);
      expectRoundTripStable(last);
      expect(survives(name)[0]).toBe(`@${name}`);
    });
  }

  it("a number in bold, in italics and underlined", () => {
    const marked = (...marks: string[]): InlineNode[] => [
      { type: "text", text: "2", marks: marks.map((type) => ({ type })) } as InlineNode,
    ];
    expect(survives(marked("strong"))[0]).toBe("@**2**");
    expect(survives(marked("em"))[0]).toBe("@*2*");
    expect(survives(marked("underline"))[0]).toBe("@_2_");
    // A star or an underscore of the name's own is escaped, and is no number.
    expect(survives("*")[0]).toBe("\\*");
    expect(survives("_2_")[0]).toBe("\\_2\\_");
  });

  it("a name another rule would read first: a heading, a transition, a centered line", () => {
    // The tokenizer tries these three before it tries a cue, and each wants
    // its line alone in a block. A cue has a line under it, so none of them
    // takes it: a heading's opening is a cue as it stands, and the other two
    // are refused by the cue's own rule and taken behind an `@`.
    expect(survives("INT. HOUSE")).toEqual([
      "INT. HOUSE",
      "INT. HOUSE (V.O.)",
      "INT. HOUSE ^",
      "INT. HOUSE (V.O.) ^",
    ]);
    expect(survives("EXT. YARD")[0]).toBe("EXT. YARD");
    expect(survives("CUT TO:")).toEqual([
      "@CUT TO:",
      "@CUT TO: (V.O.)",
      "@CUT TO: ^",
      "@CUT TO: (V.O.) ^",
    ]);
    expect(survives("FADE OUT.")[0]).toBe("@FADE OUT.");
    expect(survives("CUT TO BLACK.")[0]).toBe("@CUT TO BLACK.");
    expect(survives("> THE END <")[0]).toBe("@> THE END <");
    // Over a line that is centered too, the two were one centered block.
    const centered = script(cue("> THE END <"), block("dialogue", "> AGAIN <"));
    expect(centered).toBe("@> THE END <\n> AGAIN <\n");
    expect(reopened(centered)).toEqual([cue("> THE END <"), block("dialogue", "> AGAIN <")]);
    expectRoundTripStable(centered);
  });

  it("every other name: an @ exactly where the tokenizer would not take the line without", () => {
    const names = [
      ...["MARA", "MAN 2", "2ND MAN", "GUARD #1", "DR. OKAFOR", "MR. BLACK", "WAY OUT"],
      ...["MARA!", "MARA?", "MARA:", "O'NEIL", "MARA & JONAH", "MARA/JONAH", "100%", "M-1"],
      ...["EST. 1999", "I/E CAR", "INT./EXT. CAR", "NOTES:", "TO:", "X TO:", "OUT.", "BLACK."],
      ...["ÉLODIE", "٢", "名前", "—", "/*", "[[", "]]", "\\@HOME", "@", "@@", "* *", "2 *"],
    ];
    // Every printable character that is not a lower-case letter, a bracket or
    // a caret, where it can stand in a name.
    for (let code = 33; code < 127; code++) {
      const c = String.fromCharCode(code);
      if (/[a-z^()]/.test(c)) continue;
      names.push(c, `${c}A`, `${c} A`, `A${c}`, `A ${c}`, `A${c}B`, `${c}${c}`, `${c}2`, `2${c}`);
    }
    let forced = 0;
    for (const name of new Set(names)) {
      forced += survives(name).filter((line) => line.startsWith("@")).length;
    }
    // Both answers were met: the sweep is no proof if it only ever saw one.
    expect(forced).toBeGreaterThan(100);
    expect(forced).toBeLessThan(names.length);
  });

  it("leaves a name that needs no @ without one", () => {
    const plain = ["MARA", "MAN 2", "2ND MAN", "GUARD #1", "DR. OKAFOR", "MR. BLACK", "WAY OUT"];
    for (const name of [...plain, "MARA!", "A.", "A #", "2A", "A2", "ÉLODIE", "100%", "٢"]) {
      for (const line of survives(name)) expect(line.startsWith("@")).toBe(false);
    }
    // The tokenizer judges the whole line. With an extension or a `^` after
    // them it takes some names it refuses alone, and those lines get none.
    expect(survives("SCOUT.")).toEqual(["@SCOUT.", "SCOUT. (V.O.)", "SCOUT. ^", "SCOUT. (V.O.) ^"]);
    expect(survives("2")).toEqual(["@2", "@2 (V.O.)", "@2 ^", "2 (V.O.) ^"]);
  });

  it("with lower case in it, with a comment on it, and over a song", () => {
    // Forced already, for its lower case or its note: one `@`, never two.
    expect(survives("#2 Fan")[0]).toBe("@#2 Fan");
    expect(survives("@home")[0]).toBe("@@home");
    for (const name of ["#2 FAN", "2", "@HOME", "OTTO:"]) {
      const noted = cue([text(name), note("Robin: who is this?")]);
      const source = script(before, noted, speech);
      expect(source).toBe(`A room.\n\n@${name}[[Robin: who is this?]]\nHello.\n`);
      expect(reopened(source)).toEqual([before, noted, speech]);
      expectRoundTripStable(source);
    }
    const song = block("lyric", "Row the boat\nGently now");
    const sung = script(cue("#2 FAN"), song, cue("2", { dual: true }), song);
    expect(sung).toBe("@#2 FAN\n~Row the boat\n~Gently now\n\n@2 ^\n~Row the boat\n~Gently now\n");
    expect(reopened(sung)).toEqual([cue("#2 FAN"), song, cue("2", { dual: true }), song]);
    expectRoundTripStable(sung);
  });

  it("cannot keep a name with a caret in it, or a bracket that is not its extension", () => {
    // The limit. The tokenizer has no cue, forced or not, whose name holds
    // `^`, `(` or `)`, so an `@` could not help and none is written: the line
    // comes back a stage direction that reads as it did.
    for (const name of ["#2 (FAN) CLUB", "2^3", "2 (OLD) AGAIN", ".38 ^ .45"]) {
      const source = script(cue(name), speech);
      expect(source).toBe(`${name}\nHello.\n`);
      expect(reopened(source)).toEqual([block("action", `${name}\nHello.`)]);
    }
    // A caret at the end of a name is the dual mark to it, forced or not.
    expect(script(cue("2^"), speech)).toBe("2^\nHello.\n");
    // A cue with no name is left the line it was.
    expect(script(...left, cue(" ", { dual: true }), speech)).not.toContain("@");
    expect(script(...left, cue([], { dual: true }), speech)).not.toContain("@");
  });

  it("reads a line with no @ as it always did", () => {
    // The reading did not move: a script written elsewhere with `2` over a
    // speech opens as the stage direction it was, and stays one.
    for (const source of ["2\nHello.\n", "#2 FAN\nHello.\n", "CUT TO:\nHello.\n"]) {
      expect(reopened(source).map((b) => b.type)).toEqual(["action"]);
      expectRoundTripStable(source);
    }
    expect(reopened("@2\nHello.\n")).toEqual([cue("2"), speech]);
    expect(reopened("@#2 FAN (V.O.) ^\nHello.\n")).toEqual([
      cue("#2 FAN", { extension: "(V.O.)", dual: true }),
      speech,
    ]);
  });
});

/**
 * A comment that holds a line break (docs/engineering/fountain-model.md#EDIT-180).
 * The composer makes one whenever Enter is pressed in a comment. Each block is
 * built as the editor hands it over, written, and read back: every block keeps
 * its type, nothing in it changes, and the text written is the text written
 * again.
 */
describe("a comment that holds a line break leaves its line what it was", () => {
  const line = (type: BlockType, ...content: InlineNode[]): BlockNode => ({ type, content });
  const mara = line("character", text("MARA"));
  const types = (source: string) => parse(source).doc.content.map((b) => b.type);
  const broken = note("Sam: one\ntwo");

  it("the reported cases: each line is read as what it is", () => {
    const reported: [string, BlockType[]][] = [
      ["> BLACKOUT.[[a\nb]]\n", ["transition"]],
      ["> THE END[[a\nb]] <\n", ["centered"]],
      ["= A synopsis[[a\nb]]\n", ["synopsis"]],
      ["MARA\n(quietly[[a\nb]])\nHello.\n", ["character", "parenthetical", "dialogue"]],
      ["MARA\nHello [[a\n(b)\nc]] there.\n", ["character", "dialogue"]],
    ];
    for (const [source, kinds] of reported) {
      expect(types(source)).toEqual(kinds);
      expect(serialize(parse(source))).toBe(source);
      expectRoundTripStable(source);
    }
    // The comment is whole, and the speech is the words around it.
    expect(parse("MARA\nHello [[a\n(b)\nc]] there.\n").doc.content[1]).toEqual(
      line("dialogue", text("Hello "), note("a\n(b)\nc"), text(" there.")),
    );
    expect(parse("MARA\n(quietly[[a\nb]])\nHello.\n").doc.content[1]).toEqual(
      line("parenthetical", text("quietly"), note("a\nb")),
    );
  });

  const lines: Record<string, [BlockNode[], string]> = {
    "a transition": [
      [line("transition", text("BLACKOUT."), broken)],
      "> BLACKOUT.[[Sam: one\ntwo]]",
    ],
    "a transition that ends in TO:": [
      [line("transition", text("CUT TO:"), broken)],
      "> CUT TO:[[Sam: one\ntwo]]",
    ],
    "a transition that ends in TO:, in front of it": [
      [line("transition", broken, text("CUT TO:"))],
      "> [[Sam: one\ntwo]]CUT TO:",
    ],
    "a transition that ends in TO:, inside it": [
      [line("transition", text("CUT "), broken, text("TO:"))],
      "> CUT [[Sam: one\ntwo]]TO:",
    ],
    "a centered line": [
      [line("centered", text("THE END"), broken)],
      "> THE END[[Sam: one\ntwo]] <",
    ],
    "a centered line, in front of it": [
      [line("centered", broken, text("THE END"))],
      "> [[Sam: one\ntwo]]THE END <",
    ],
    "a synopsis": [[line("synopsis", text("A synopsis"), broken)], "= A synopsis[[Sam: one\ntwo]]"],
    "a parenthetical": [
      [mara, line("parenthetical", text("quietly"), broken), line("dialogue", text("Hello."))],
      "MARA\n(quietly[[Sam: one\ntwo]])\nHello.",
    ],
    "a parenthetical, in front of it": [
      [mara, line("parenthetical", broken, text("quietly")), line("dialogue", text("Hello."))],
      "MARA\n([[Sam: one\ntwo]]quietly)\nHello.",
    ],
    "a parenthetical that ends the speech": [
      [mara, line("dialogue", text("Hello.")), line("parenthetical", text("quietly"), broken)],
      "MARA\nHello.\n(quietly[[Sam: one\ntwo]])",
    ],
    "a speech": [
      [mara, line("dialogue", text("Hello "), broken, text(" there."))],
      "MARA\nHello [[Sam: one\ntwo]] there.",
    ],
    "a speech that opens with it": [
      [mara, line("dialogue", broken, text("Hello there."))],
      "MARA\n[[Sam: one\ntwo]]Hello there.",
    ],
    "a speech that is the comment and no words": [
      [mara, line("dialogue", broken)],
      "MARA\n[[Sam: one\ntwo]]",
    ],
    "the second line of a speech": [
      [mara, line("dialogue", text("One.\nTwo "), broken, text(" three.\nFour."))],
      "MARA\nOne.\nTwo [[Sam: one\ntwo]] three.\nFour.",
    ],
    "a speech under a parenthetical": [
      [mara, line("parenthetical", text("quietly")), line("dialogue", text("Hello "), broken)],
      "MARA\n(quietly)\nHello [[Sam: one\ntwo]]",
    ],
    "a stage direction": [
      [line("action", text("She waits. "), broken)],
      "She waits. [[Sam: one\ntwo]]",
    ],
    "a stage direction that opens with it": [
      [line("action", broken, text(" She waits."))],
      "[[Sam: one\ntwo]] She waits.",
    ],
    "a stage direction of two lines": [
      [line("action", text("She waits. "), broken, text("\nShe goes."))],
      "She waits. [[Sam: one\ntwo]]\nShe goes.",
    ],
    "a line of its own": [[line("action", broken)], "[[Sam: one\ntwo]]"],
    "a line of its own, with a reply": [
      [line("action", broken, note("Robin: yes"))],
      "[[Sam: one\ntwo]][[Robin: yes]]",
    ],
    // Every line of a lyric is written with its `~`, the comment's own too.
    "a lyric": [[line("lyric", text("La la"), broken, text(" la"))], "~La la[[Sam: one\n~two]] la"],
    "the second line of a lyric": [
      [line("lyric", text("La la\nLa "), broken, text(" la"))],
      "~La la\n~La [[Sam: one\n~two]] la",
    ],
    // A sung speech stands directly under its cue
    // (docs/engineering/fountain-model.md#EDIT-175).
    "a lyric under its cue": [
      [mara, line("lyric", text("La la"), broken, text(" la"))],
      "MARA\n~La la[[Sam: one\n~two]] la",
    ],
    "a lyric under its cue, in front of it": [
      [mara, line("lyric", broken, text("La la"))],
      "MARA\n~[[Sam: one\n~two]]La la",
    ],
  };

  for (const [name, [blocks, source]] of Object.entries(lines)) {
    it(`on ${name}`, () => {
      const around = [line("action", text("Before.")), ...blocks, line("action", text("After."))];
      expect(written(around)).toBe(`Before.\n\n${source}\n\nAfter.\n`);
    });
  }

  /** One of each line a comment can stand on, the comment on it. */
  const everyLine = (comment: InlineNode): BlockNode[] => [
    line("act", text("ACT ONE"), comment),
    line("scene", text("SCENE 1"), comment),
    line("sceneHeading", text("INT. KITCHEN"), comment),
    line("synopsis", text("A synopsis"), comment),
    line("action", text("She waits. "), comment),
    line("action", comment),
    line("character", text("MARA"), comment),
    line("parenthetical", text("quietly"), comment),
    line("dialogue", text("Hello "), comment, text(" there.")),
    line("lyric", text("La la"), comment, text(" la")),
    line("transition", text("BLACKOUT."), comment),
    line("transition", comment, text("CUT TO:")),
    line("centered", text("THE END"), comment),
  ];

  // What the tokenizer does to a line of script, it did to a comment's lines:
  // read one in brackets as a parenthetical, one in capitals as a cue, took a
  // `!` or a `~` off the front, turned a tab into spaces, trimmed the ends.
  const seconds: Record<string, string> = {
    "is in brackets": "a\n(b)\nc",
    "is in capitals, like the first": "SAM: ONE\nTWO",
    "ends in TO:": "CUT\nTO:",
    "opens with !": "Sam: one\n!two",
    "opens with ~": "Sam: one\n~two",
    "opens with > and ends with <": "Sam: one\n> two <",
    "opens with #": "Sam: one\n# two",
    "opens with =": "Sam: one\n= two",
    "opens with . or @": "Sam: one\n.two\n@THREE\nfour",
    "is indented, with spaces after it": "Sam: one\n   two  ",
    "opens with a tab": "Sam: one\n\ttwo",
    "is two spaces": "Sam: one\n  \ntwo",
    "is not there yet": "Sam: one\n",
    "follows an empty first": "\nSam: one",
  };

  for (const [name, comment] of Object.entries(seconds)) {
    it(`whatever line it is on, when its second line ${name}`, () => {
      written(everyLine(note(comment)));
    });
  }

  it("a line of its own in capitals is no cue, and is not forced", () => {
    expect(written([line("action", note("SAM: ONE\nTWO"))])).toBe("[[SAM: ONE\nTWO]]\n");
  });

  it("a stage direction is forced by the line it is, not by where a comment breaks", () => {
    // The line ends in `TO:` past the comment: one line to the next reader,
    // and a transition unless it is forced.
    expect(written([line("action", text("She walks "), broken, text(" over TO:"))])).toBe(
      "!She walks [[Sam: one\ntwo]] over TO:\n",
    );
    // In capitals to the end of the line, the comment's second line too.
    expect(
      written([line("action", text("WAIT "), note("SAM: ONE\nTWO"), text("\nShe goes."))]),
    ).toBe("!WAIT [[SAM: ONE\nTWO]]\nShe goes.\n");
    // Capitals as far as the break only: the line has lower case in it.
    expect(
      written([line("action", text("WAIT "), note("SAM: ONE\ntwo"), text("\nShe goes."))]),
    ).toBe("WAIT [[SAM: ONE\ntwo]]\nShe goes.\n");
  });

  it("a transition that holds a comment is forced, wherever the comment stands", () => {
    // `CUT [[A]]TO:` is no transition to the tokenizer, which wants a space
    // before `TO:`; in capitals it passed for a natural one and was written so.
    expect(written([line("transition", text("CUT "), note("A"), text("TO:"))])).toBe(
      "> CUT [[A]]TO:\n",
    );
    expect(written([line("transition", note("FIX"), text("CUT TO:"))])).toBe("> [[FIX]]CUT TO:\n");
    expect(written([line("transition", text("CUT TO:"))])).toBe("CUT TO:\n");
    // One written before this, with no mark, is the transition it was.
    expect(parse("[[FIX]]CUT TO:\n").doc.content).toEqual([
      line("transition", note("FIX"), text("CUT TO:")),
    ]);
  });

  it("a line that ends in TO: is what its mark says", () => {
    // The tokenizer takes any line of its own that ends in ` TO:` for a
    // transition and hands back the whole of it, mark and all
    // (docs/engineering/fountain-model.md#EDIT-181). A comment's line break
    // used to keep such a line out of that rule by making it two.
    const ending: [BlockType, string, string][] = [
      ["transition", "Smash cut TO:", "> Smash cut TO:"],
      // A mark that is the transition's own text is kept, and the transition
      // is forced: with no `>` in front, `#1 TO:` is a section.
      ["transition", "> x TO:", "> > x TO:"],
      ["transition", "#1 CUT TO:", "> #1 CUT TO:"],
      ["transition", "!CUT TO:", "> !CUT TO:"],
      ["action", "He points TO:", "!He points TO:"],
      ["act", "BACK TO:", "# BACK TO:"],
      ["scene", "Back TO:", "## Back TO:"],
      ["synopsis", "We go back TO:", "= We go back TO:"],
      ["lyric", "La la TO:", "~La la TO:"],
    ];
    for (const [type, words, source] of ending) {
      expect(written([line(type, text(words))])).toBe(`${source}\n`);
      const at = words.lastIndexOf(" ");
      written([line(type, text(words.slice(0, at)), broken, text(words.slice(at)))]);
    }
    // Every save used to put another `> ` in front of this one.
    expect(serialize(parse("> > Smash cut TO:\n"))).toBe("> > Smash cut TO:\n");
    expect(types("### Deeper TO:\n")).toEqual(["scene"]);
    // With no mark, the ending is all there is to go by.
    expect(types("She walks back TO:\n")).toEqual(["transition"]);
    // The tokenizer wants words and a space before `TO:`. A transition with
    // neither was written with no mark, and came back a stage direction.
    expect(written([line("transition", text("TO:"))])).toBe("> TO:\n");
    expect(written([line("transition", text("CUT-TO:"))])).toBe("> CUT-TO:\n");
    expect(written([line("transition", text("SMASH CUT TO:"))])).toBe("SMASH CUT TO:\n");
  });

  it("reads a line with no forcing mark as it reads the same comment on one line", () => {
    // In capitals throughout it is a cue; with lower case anywhere in the
    // comment it may as well be a stage direction
    // (docs/engineering/fountain-model.md#EDIT-174). The break in the comment
    // used to decide it, and cut the comment in two.
    expect(parse("MARA[[CUT\nTHIS]]\nHello.\n").doc.content).toEqual([
      line("character", text("MARA"), note("CUT\nTHIS")),
      line("dialogue", text("Hello.")),
    ]);
    expect(types("MARA[[CUT THIS]]\nHello.\n")).toEqual(["character", "dialogue"]);
    expect(types("MARA[[ROBIN:\nrename?]]\nHello.\n")).toEqual(["action"]);
    expect(types("MARA[[ROBIN: rename?]]\nHello.\n")).toEqual(["action"]);
    expect(types("LIGHTS UP.[[check\nwith LD]]\nShe enters.\n")).toEqual(["action"]);
    expect(types("[[CUT\nTHIS]]CUT TO:\n")).toEqual(["transition"]);
    // A forced cue with nothing under it is the stage direction it was.
    expect(types("@MARA[[a\nb]]\n")).toEqual(["action"]);
    for (const source of [
      "MARA[[CUT\nTHIS]]\nHello.\n",
      "MARA[[ROBIN:\nrename?]]\nHello.\n",
      "LIGHTS UP.[[check\nwith LD]]\nShe enters.\n",
      "@MARA[[a\nb]]\n",
    ]) {
      expectRoundTripStable(source);
    }
  });

  it("reads a lyric's comment with or without the ~ on its later lines", () => {
    const sung = (comment: string) => [line("lyric", text("La la"), note(comment), text(" la"))];
    // As the app writes it, and as it wrote it before this.
    expect(parse("~La la[[Sam: one\n~two]] la\n").doc.content).toEqual(sung("Sam: one\ntwo"));
    // As a hand writes it.
    expect(parse("~La la[[Sam: one\ntwo]] la\n").doc.content).toEqual(sung("Sam: one\ntwo"));
    // A `~` that is the comment's own is written after the lyric's.
    expect(written(sung("Sam: one\n~two"))).toBe("~La la[[Sam: one\n~~two]] la\n");
    // Only a lyric's lines carry one: in a speech the `~` is the comment's.
    expect(parse("MARA\nHello [[Sam: one\n~two]] there.\n").doc.content[1]).toEqual(
      line("dialogue", text("Hello "), note("Sam: one\n~two"), text(" there.")),
    );
    // And a comment's `~` line under a cue is no song: the speech is spoken.
    expect(parse("MARA\n[[Sam: one\n~two]]Hello.\n").doc.content).toEqual([
      mara,
      line("dialogue", note("Sam: one\n~two"), text("Hello.")),
    ]);
  });

  it("a cue with a comment of two lines and no speech is still the cue", () => {
    // It is written over Fountain's two-space line, and reads back as the cue
    // and an empty speech (docs/engineering/fountain-model.md#EDIT-175). The
    // comment's second line is not the line under it.
    const doc = { type: "doc" as const, content: [line("character", text("MARA"), broken)] };
    const source = serialize({ frontMatter: {}, doc });
    expect(source).toBe("@MARA[[Sam: one\ntwo]]\n  \n");
    expect(parse(source).doc.content).toEqual([
      line("character", text("MARA"), broken),
      { type: "dialogue", content: [] },
    ]);
    expectRoundTripStable(source);
  });

  it("writes a blank line in a comment as two spaces, and keeps a line of two", () => {
    // A blank line ends a block, the comment and its line with it. The
    // composer makes none; one that gets in is written the way Fountain
    // keeps a block going.
    for (const [blank, source] of [
      ["Sam: one\n\ntwo", "She waits. [[Sam: one\n  \ntwo]]\n"],
      ["Sam: one\n \n\t\ntwo", "She waits. [[Sam: one\n  \n  \ntwo]]\n"],
    ]) {
      const doc = {
        type: "doc" as const,
        content: [line("action", text("She waits. "), note(blank))],
      };
      expect(serialize({ frontMatter: {}, doc })).toBe(source);
      expectRoundTripStable(source);
    }
    const blanks = { type: "doc" as const, content: everyLine(note("Sam: one\n\ntwo")) };
    const kept = { type: "doc" as const, content: everyLine(note("Sam: one\n  \ntwo")) };
    expect(parse(serialize({ frontMatter: {}, doc: blanks })).doc).toEqual(kept);
    // From another tool, which writes the two spaces itself: the comment
    // used to lose them here, and the line was cut on the save after.
    expect(parse("She waits. [[one\n  \ntwo]]\n").doc.content).toEqual([
      line("action", text("She waits. "), note("one\n  \ntwo")),
    ]);
    // A bare blank line is still the end of the block, and of any note.
    expect(types("She waits. [[one\n\ntwo]]\n")).toEqual(["action", "action"]);
  });

  it("keeps < and > in a comment on a centered line", () => {
    // A centered line's text is read with every one of them stripped.
    expect(written([line("centered", text("THE END"), note("a > b < c"))])).toBe(
      "> THE END[[a > b < c]] <\n",
    );
    expect(written([line("centered", note("<-\n->"), text("THE END"))])).toBe(
      "> [[<-\n->]]THE END <\n",
    );
  });

  it("keeps a comment's own characters on a line of its own", () => {
    // Read for emphasis, the comment lost its asterisks and underscores on
    // the next save. A comment of two lines never was, and now is one line
    // to the tokenizer, so both are read as the words they are.
    for (const comment of ["Sam: *really* snake_case_name", "Sam: *really*\nsnake_case_name"]) {
      expect(written([line("action", note(comment))])).toBe(`[[${comment}]]\n`);
    }
  });

  it("takes an escaped bracket and an unclosed one for the text they are", () => {
    expect(parse("She waits. \\[[not\na note]]\n").doc.content).toEqual([
      line("action", text("She waits. [[not\na note]]")),
    ]);
    expect(parse("She waits. [[unclosed\nmore.\n").doc.content).toEqual([
      line("action", text("She waits. [[unclosed\nmore.")),
    ]);
    expectRoundTripStable("She waits. \\[[not\na note]]\n");
    expectRoundTripStable("She waits. [[unclosed\nmore.\n");
  });

  it("keeps a script that already holds the tag's character", () => {
    const source = "She waits \uE0030\uE003. [[Sam: one\ntwo]]\n";
    expect(parse(source).doc.content).toEqual([
      line("action", text("She waits \uE0030\uE003. "), broken),
    ]);
    expectRoundTripStable(source);
  });
});

/**
 * The lines of a speech (docs/engineering/fountain-model.md#EDIT-183).
 *
 * In the script a speech is one block of lines under its cue, and a blank line
 * ends it. A dialogue or a parenthetical that followed a lyric was written
 * after one, and came back as a stage direction. An empty lyric was written
 * `~` and an empty parenthetical `()`, which are neither to any Fountain
 * reader: they came back as lines reading `~` and `()`. So did a sung line
 * with a space in front of it, `~ Row`.
 */
describe("every line of a speech is what it was after a save and a reopen", () => {
  const text = (t: string): InlineNode => ({ type: "text", text: t });
  const em = (t: string): InlineNode => ({ type: "text", text: t, marks: [{ type: "em" }] });
  const note = (t: string): InlineNode => ({ type: "note", content: [text(t)] });
  const block = (type: BlockNode["type"], t: string): BlockNode => ({ type, content: [text(t)] });
  const empty = (type: BlockNode["type"]): BlockNode => ({ type, content: [] });
  const cue = (name: string, attrs?: Record<string, unknown>): BlockNode => ({
    type: "character",
    ...(attrs ? { attrs } : {}),
    content: [text(name)],
  });
  const mara = cue("MARA");
  const row = block("lyric", "Row");
  const gently = block("lyric", "Gently");
  const spoken = block("dialogue", "Spoken.");
  const noSpeechYet = empty("dialogue");
  const before = block("action", "A room.");
  const after = block("action", "She waits.");
  const script = (...content: BlockNode[]) =>
    serialize({ frontMatter: {}, doc: { type: "doc", content } });
  const reopened = (source: string) => parse(source).doc.content;

  /**
   * The script these blocks are saved as. They are read back as `want`, which
   * is the blocks themselves unless the rule says otherwise, and the save after
   * the reopen writes the same bytes.
   */
  function saved(blocks: BlockNode[], want: BlockNode[] = blocks): string {
    const source = script(...blocks);
    expect(reopened(source)).toEqual(want);
    expect(serialize(parse(source))).toBe(source);
    return source;
  }

  it("a spoken or a bracketed line after a sung one stays in its speech", () => {
    const singers: [BlockNode, string][] = [
      [mara, "MARA"],
      [cue("Ivo"), "@Ivo"],
      [cue("MARA", { extension: "(O.S.)" }), "MARA (O.S.)"],
      [
        { type: "character", content: [text("MARA"), note("Robin: rename?")] },
        "@MARA[[Robin: rename?]]",
      ],
    ];
    for (const [singer, line] of singers) {
      expect(saved([before, singer, row, spoken, after])).toBe(
        `A room.\n\n${line}\n~Row\nSpoken.\n\nShe waits.\n`,
      );
    }
    const beat = block("parenthetical", "beat");
    expect(saved([mara, row, beat])).toBe("MARA\n~Row\n(beat)\n");
    expect(saved([mara, row, beat, spoken])).toBe("MARA\n~Row\n(beat)\nSpoken.\n");
    expect(saved([mara, block("dialogue", "One."), row, block("dialogue", "Two.")])).toBe(
      "MARA\nOne.\n~Row\nTwo.\n",
    );
    expect(saved([mara, block("parenthetical", "singing"), row, beat, spoken, after])).toBe(
      "MARA\n(singing)\n~Row\n(beat)\nSpoken.\n\nShe waits.\n",
    );
    // A speech with no words yet, where a writer stops after a song.
    expect(saved([mara, row, noSpeechYet])).toBe("MARA\n~Row\n  \n");
    // The song after the last spoken line needs no cue, and stands as before.
    expect(saved([mara, row, spoken, gently, block("lyric", "Merrily"), after])).toBe(
      "MARA\n~Row\nSpoken.\n\n~Gently\n\n~Merrily\n\nShe waits.\n",
    );
  });

  it("on each side of a dual pair", () => {
    const right = cue("JONAH", { dual: true });
    expect(saved([mara, row, spoken, right, row, gently, block("parenthetical", "beat")])).toBe(
      "MARA\n~Row\nSpoken.\n\nJONAH ^\n~Row\n  \n~Gently\n(beat)\n",
    );
  });

  it("two verses in one speech stay two, parted by the empty line", () => {
    expect(saved([mara, row, gently, spoken])).toBe("MARA\n~Row\n  \n~Gently\nSpoken.\n");
    const verse = block("lyric", "Row\nRow again");
    expect(
      saved([mara, verse, gently, block("lyric", "Merrily"), block("parenthetical", "beat")]),
    ).toBe("MARA\n~Row\n~Row again\n  \n~Gently\n  \n~Merrily\n(beat)\n");
  });

  it("because two verses are not one verse of two lines on every format's page", () => {
    // Written with nothing between them, two verses are read back as one: the
    // tokenizer runs sung lines that touch together, as it does spoken ones.
    // Spoken lines print the same either way. A format that sets a row
    // between its verses does not print these the same.
    const formats = join(import.meta.dir, "../../formats");
    const rows = (file: string, ...content: BlockNode[]) => {
      const valid = validateFormatSpec(JSON.parse(readFileSync(join(formats, file), "utf8")));
      if (!valid.ok) throw new Error(`${file}: ${valid.errors.join("; ")}`);
      return paginateDoc({ type: "doc", content }, valid.spec).pages[0].lines.map((l) => l.row);
    };
    const shipped = readdirSync(formats).filter((file) => file.endsWith(".json"));
    const apart = shipped.filter(
      (file) =>
        `${rows(file, mara, row, gently, spoken)}` !==
        `${rows(file, mara, block("lyric", "Row\nGently"), spoken)}`,
    );
    expect(shipped.length).toBeGreaterThan(0);
    expect(apart.length).toBeGreaterThan(0);
    for (const file of shipped) {
      const one = block("dialogue", "One.");
      expect(rows(file, mara, one, spoken)).toEqual(
        rows(file, mara, block("dialogue", "One.\nSpoken.")),
      );
    }
  });

  it("a song that ends its speech is written as it always was", () => {
    // Nothing after it needs the cue, so each verse stands after a blank line
    // as before: a script at rest is the same bytes on its next save.
    expect(saved([mara, spoken, row, gently])).toBe("MARA\nSpoken.\n\n~Row\n\n~Gently\n");
    expect(saved([mara, row, gently])).toBe("MARA\n~Row\n\n~Gently\n");
    for (const source of [
      "MARA\nSpoken.\n\n~Row\n",
      "MARA\n(singing)\n\n~Row\n\n~Gently\n",
      "MARA\n~Row\n\n~Gently\n",
      "A room.\n\nMARA\nOne.\n\n~Row\n~Row again\n\n~Gently\n\nShe waits.\n",
      "~Row\n\n~Gently\n",
    ]) {
      expect(serialize(parse(source))).toBe(source);
      expectRoundTripStable(source);
    }
  });

  it("a lyric with no cue over it takes no line into its block", () => {
    // `~Row` directly over `Spoken.` with no cue is one stage direction to the
    // tokenizer, so the two are not written that way.
    expect(reopened("~Row\nSpoken.\n")).toEqual([block("action", "~Row\nSpoken.")]);
    expect(script(before, row, spoken)).toBe("A room.\n\n~Row\n\nSpoken.\n");
    expect(script(empty("character"), row, spoken)).toBe("\n~Row\n\nSpoken.\n");
    expect(reopened(script(before, row, spoken))[1]).toEqual(row);
    expect(reopened(script(empty("character"), row, spoken))[0]).toEqual(row);
  });

  it("an empty lyric is not written", () => {
    const none = empty("lyric");
    // Standing alone, and where Return in a song leaves a writer.
    expect(saved([before, row, none, after], [before, row, after])).toBe(
      "A room.\n\n~Row\n\nShe waits.\n",
    );
    expect(saved([mara, row, gently, none], [mara, row, gently])).toBe("MARA\n~Row\n\n~Gently\n");
    expect(saved([mara, row, none, spoken], [mara, row, spoken])).toBe("MARA\n~Row\nSpoken.\n");
    expect(saved([mara, row, none, gently, spoken], [mara, row, gently, spoken])).toBe(
      "MARA\n~Row\n  \n~Gently\nSpoken.\n",
    );
    // Directly under a cue it leaves a cue with no speech
    // (docs/engineering/fountain-model.md#EDIT-175).
    expect(saved([mara, none, after], [mara, noSpeechYet, after])).toBe("MARA\n  \n\nShe waits.\n");
    expect(saved([mara, none], [mara, noSpeechYet])).toBe(script(mara));
  });

  it("an empty parenthetical is not written", () => {
    const none = empty("parenthetical");
    const hello = block("dialogue", "Hello.");
    expect(saved([mara, none], [mara, noSpeechYet])).toBe("MARA\n  \n");
    expect(saved([mara, none, hello], [mara, hello])).toBe("MARA\nHello.\n");
    expect(saved([mara, hello, none, row], [mara, hello, row])).toBe("MARA\nHello.\n\n~Row\n");
    expect(saved([before, none, after], [before, after])).toBe("A room.\n\nShe waits.\n");
    // One that holds a space, or a comment and no words, is a line.
    expect(saved([mara, block("parenthetical", " "), hello])).toBe("MARA\n( )\nHello.\n");
    expect(saved([mara, { type: "parenthetical", content: [note("Robin: cut?")] }, hello])).toBe(
      "MARA\n([[Robin: cut?]])\nHello.\n",
    );
  });

  it("a sung line is written without the space in front of it", () => {
    expect(saved([mara, block("lyric", " Row")], [mara, row])).toBe("MARA\n~Row\n");
    expect(saved([mara, block("lyric", " Row"), spoken], [mara, row, spoken])).toBe(
      "MARA\n~Row\nSpoken.\n",
    );
    expect(
      saved([before, block("lyric", "  Row\n Gently")], [before, block("lyric", "Row\nGently")]),
    ).toBe("A room.\n\n~Row\n~Gently\n");
    // A lyric of spaces has no words, and is not written.
    expect(saved([before, block("lyric", "  "), after], [before, after])).toBe(
      "A room.\n\nShe waits.\n",
    );
    // Emphasis that opens with a space is written behind its mark, as it was.
    expect(saved([mara, { type: "lyric", content: [em(" Row")] }])).toBe("MARA\n~* Row*\n");
    expect(
      saved(
        [mara, { type: "lyric", content: [text("  "), em("Row")] }],
        [mara, { type: "lyric", content: [em("Row")] }],
      ),
    ).toBe("MARA\n~*Row*\n");
  });

  it("an empty line in a lyric parts two verses", () => {
    expect(
      saved([mara, block("lyric", "Row\n\nGently"), spoken], [mara, row, gently, spoken]),
    ).toBe("MARA\n~Row\n  \n~Gently\nSpoken.\n");
    expect(saved([before, block("lyric", "\nRow\n \n\nGently\n")], [before, row, gently])).toBe(
      "A room.\n\n~Row\n\n~Gently\n",
    );
    // Emphasis that ran over the empty line closes in one verse and opens in the next.
    const sung = (t: string): BlockNode => ({ type: "lyric", content: [em(t)] });
    expect(
      saved([mara, sung("Row\n\nGently"), spoken], [mara, sung("Row"), sung("Gently"), spoken]),
    ).toBe("MARA\n~*Row*\n  \n~*Gently*\nSpoken.\n");
    // A verse with no empty line in it is written as it always was.
    expect(saved([mara, sung("Row\nGently")])).toBe("MARA\n~*Row\n~Gently*\n");
    // A comment's line break is the comment's, and ends no line of the verse.
    const noted: BlockNode = { type: "lyric", content: [text("Row"), note("Robin: one\ntwo")] };
    expect(saved([mara, noted, spoken])).toBe("MARA\n~Row[[Robin: one\n~two]]\nSpoken.\n");
  });

  it("reads the empty line between two sung lines as the break, and elsewhere as it did", () => {
    const beat = block("parenthetical", "beat");
    const read: [string, BlockNode[]][] = [
      ["MARA\n~Row\n  \n~Gently\n", [mara, row, gently]],
      ["MARA\n~Row\n  \n  \n~Gently\nSpoken.\n", [mara, row, gently, spoken]],
      [
        "MARA\n(beat)\n~Row\n~Row again\n  \n~Gently\n(beat)\nSpoken.\n",
        [mara, beat, block("lyric", "Row\nRow again"), gently, beat, spoken],
      ],
      // Under a cue, at the end of a speech and beside a line that is not
      // sung, it is the speech with no words that it was.
      ["MARA\n  \n~Row\n", [mara, noSpeechYet, row]],
      ["MARA\n~Row\n  \n", [mara, row, noSpeechYet]],
      ["MARA\n~Row\n  \n(beat)\n~Gently\n", [mara, row, noSpeechYet, beat, gently]],
      [
        "MARA\nOne.\n  \n~Row\n  \nTwo.\n",
        [mara, block("dialogue", "One.\n"), row, block("dialogue", "\nTwo.")],
      ],
    ];
    for (const [source, blocks] of read) {
      expect(reopened(source)).toEqual(blocks);
      expectRoundTripStable(source);
    }
    // So a speech with no words between two sung lines is not written: there
    // the empty line is the break, however many of them a writer left.
    expect(saved([mara, row, noSpeechYet, gently], [mara, row, gently])).toBe(
      "MARA\n~Row\n\n~Gently\n",
    );
    expect(
      saved([mara, row, noSpeechYet, noSpeechYet, gently, spoken], [mara, row, gently, spoken]),
    ).toBe("MARA\n~Row\n  \n~Gently\nSpoken.\n");
    // With a comment on it, it is a line.
    const asked: BlockNode = { type: "dialogue", content: [note("Robin: a line here?")] };
    expect(saved([mara, row, asked, gently, spoken])).toBe(
      "MARA\n~Row\n[[Robin: a line here?]]\n~Gently\nSpoken.\n",
    );
  });

  it("reads a line already in a script as it always did", () => {
    // What an earlier save left behind is not guessed at: a `~` or a `()` on a
    // line of its own may be a writer's.
    const left: [string, BlockNode[]][] = [
      ["MARA\n~Row\n\n!~\n", [mara, row, block("action", "~")]],
      ["MARA\n()\nHello.\n", [mara, block("dialogue", "()\nHello.")]],
      ["MARA\n~ Row\n", [mara, block("dialogue", "~ Row")]],
      // A line that stood after a song, once it has been saved after a blank
      // line: nothing in the script says it was ever spoken.
      ["MARA\n~Row\n\nSpoken.\n", [mara, row, block("action", "Spoken.")]],
    ];
    for (const [source, blocks] of left) {
      expect(reopened(source)).toEqual(blocks);
      expect(serialize(parse(source))).toBe(source);
    }
  });

  it("holds for every speech of up to four such blocks", () => {
    const kinds: ((i: number) => BlockNode)[] = [
      () => mara,
      (i) => block("parenthetical", `beat${i}`),
      () => empty("parenthetical"),
      (i) => block("dialogue", `Spoken${i}.`),
      () => empty("dialogue"),
      (i) => block("lyric", `Row${i}`),
      (i) => block("lyric", `Row${i}\nGently${i}`),
      () => empty("lyric"),
      (i) => block("lyric", ` Row${i}`),
      (i) => block("lyric", `Row${i}\n\nGently${i}`),
      (i) => block("action", `She waits ${i}.`),
    ];
    const words = (b: BlockNode) =>
      (b.content ?? []).map((n) => ("text" in n ? n.text : "")).join("");
    const inSpeech = new Set(["parenthetical", "dialogue", "lyric"]);
    /** Every parenthetical and dialogue has a cue over its speech. */
    const cued = (model: BlockNode[]) => {
      let under = false;
      return model.every((b) => {
        if (b.type === "character") under = true;
        else if (!inSpeech.has(b.type)) under = false;
        return b.type === "lyric" || !inSpeech.has(b.type) || under;
      });
    };
    const wrong: string[] = [];
    let tried = 0;
    const walk = (model: BlockNode[]) => {
      if (model.length && cued(model)) {
        tried++;
        const source = script(...model);
        const read = reopened(source);
        const faults: string[] = [];
        if (serialize(parse(source)) !== source) faults.push("the next save differs");
        // Every line with words is in a block of the type it had.
        for (const b of model) {
          for (const line of words(b).split("\n")) {
            if (!line.trim()) continue;
            const kept = read.some(
              (r) => r.type === b.type && words(r).split("\n").includes(line.trim()),
            );
            if (!kept) faults.push(`${b.type} ${JSON.stringify(line)} is gone`);
          }
        }
        // Nothing has become a stage direction, and no mark is left as text.
        const directions = (blocks: BlockNode[]) =>
          blocks.filter((b) => b.type === "action").length;
        if (directions(read) !== directions(model)) faults.push("a line became a direction");
        if (read.some((r) => /~|\(\)|^ /m.test(words(r)))) faults.push("a stray character");
        if (faults.length) wrong.push(`${JSON.stringify(source)}: ${faults.join(", ")}`);
      }
      if (model.length < 4) for (const kind of kinds) walk([...model, kind(model.length)]);
    };
    walk([]);
    expect(tried).toBe(4328);
    expect(wrong).toEqual([]);
  });
});

/**
 * The top of a script (docs/engineering/fountain-model.md#EDIT-184).
 *
 * A title page is `Key: value` lines at the top of a file, and two readers
 * looked for one. Ours (titlepage.ts) takes a file's first block when its
 * first line is a key and the block holds a key it knows. The tokenizer had a
 * rule of its own, for a standard key with a value, and was handed the script
 * after our title page was off it. So a script's first line that looked like a
 * key went into the front matter where no title page stood above it, and was
 * dropped where one did.
 *
 * `serialize` forces the first line a reader would take and no other, and
 * `parse` asks no reader but ours for a title page. What each reader would
 * take is asked of its own rule here, not of a list.
 */
describe("the first line of a script stays in the script", () => {
  const text = (t: string): InlineNode => ({ type: "text", text: t });
  const note = (t: string): InlineNode => ({ type: "note", content: [text(t)] });
  const block = (type: BlockType, t: string, attrs?: Record<string, unknown>): BlockNode => ({
    type,
    ...(attrs ? { attrs } : {}),
    content: t ? [text(t)] : [],
  });
  const cue = (name: string, attrs?: Record<string, unknown>) => block("character", name, attrs);
  const hello = block("dialogue", "Hello.");
  const room = block("action", "A room.");
  const noSpeechYet = block("dialogue", "");
  const TITLE_PAGE = "Title: Play\n\n";
  const titlePages: FrontMatter[] = [{}, { title: "Play" }];
  const script = (frontMatter: FrontMatter, content: BlockNode[]) =>
    serialize({ frontMatter, doc: { type: "doc", content } });
  const words = (b: BlockNode) =>
    (b.content ?? []).map((n) => ("text" in n ? n.text : "")).join("");

  /** Would a reader take a title page off the top of these lines? Each is asked itself. */
  const oursTakes = (lines: string) => splitTitlePage(lines).body !== lines;
  const tokenizerTakes = (lines: string) => Lexer.tokenizeTitlePage(lines).length > 0;

  /**
   * These blocks at the top of a script, saved with no title page and under
   * one, and read back. Each time the front matter is the one written, the
   * blocks come back as `want` (themselves, unless said), and the save after
   * the reopen writes the same bytes. Returns the script written each time,
   * without its title page.
   */
  function opens(blocks: BlockNode[], want: BlockNode[] = blocks): [string, string] {
    const [top, below] = titlePages.map((frontMatter) => {
      const source = script(frontMatter, blocks);
      const read = parse(source);
      expect(read.frontMatter).toEqual(frontMatter);
      expect(read.doc.content).toEqual(want);
      expect(serialize(read)).toBe(source);
      return frontMatter.title ? source.slice(TITLE_PAGE.length) : source;
    });
    return [top, below];
  }

  /**
   * The same, held to the readers' own rules. Lower in a script nobody looks
   * for a title page, so the blocks are written after another and read back
   * from there. At the top they come back as the same blocks and are written
   * as the same lines, but for one mark in front of the first: there exactly
   * when a reader would take the unmarked lines for a title page. Returns how
   * many of the two scripts were marked.
   */
  function asLower(blocks: BlockNode[]): number {
    const under = script({}, [room, ...blocks]);
    const bare = under.slice("A room.\n\n".length);
    const want = parse(under).doc.content.slice(1);
    const taken = [tokenizerTakes(bare) || oursTakes(bare), tokenizerTakes(bare)];
    opens(blocks, want).forEach((body, i) => {
      if (!taken[i]) return expect(body).toBe(bare);
      expect(body).not.toBe(bare);
      expect(body.replace(/[!@]|> /, "")).toBe(bare);
      expect(tokenizerTakes(body) || oursTakes(body)).toBe(false);
    });
    return taken.filter(Boolean).length;
  }

  it("the reported cases: a stage direction and a cue, with no title page and under one", () => {
    // With no title page our own reader took the line: `Time` is a key it knows.
    expect(opens([block("action", "Time: now."), room])).toEqual([
      "!Time: now.\n\nA room.\n",
      "Time: now.\n\nA room.\n",
    ]);
    expect(opens([cue("TIME:"), hello])).toEqual(["@TIME:\nHello.\n", "TIME:\nHello.\n"]);
    expect(opens([cue("NOTES:"), hello])).toEqual(["@NOTES:\nHello.\n", "NOTES:\nHello.\n"]);
    // Under a title page the tokenizer took a standard key with a value, and
    // the line was in neither the front matter nor the script.
    for (const line of ["Title: X", "Notes: buy milk"]) {
      const marked = `!${line}\n\nA room.\n`;
      expect(opens([block("action", line), room])).toEqual([marked, marked]);
    }
    expect(opens([cue("TITLE: X"), hello])).toEqual(["@TITLE: X\nHello.\n", "@TITLE: X\nHello.\n"]);
  });

  it("every kind of block that can stand first", () => {
    const lines = ["Time: now.", "TIME: NOW", "Title: X", "TITLE: X", "Notes: buy milk"];
    const kinds: BlockType[] = [
      ...(["act", "scene", "sceneHeading", "action", "character", "dialogue"] as const),
      ...(["transition", "lyric", "centered", "synopsis", "boneyard"] as const),
    ];
    const marked = new Set<BlockType>();
    for (const kind of kinds) {
      for (const line of [...lines, "NOTES:", "TIME:", "TITLE: BACK TO:"]) {
        // A line of speech with no cue is read as a stage direction, and one
        // in capitals gets a direction's `!` on the save after, wherever it
        // stands: not this rule's.
        if (kind === "dialogue" && !/[a-z]/.test(line)) continue;
        const first = block(kind, line);
        const blocks = kind === "character" ? [first, hello, room] : [first, room];
        if (asLower(blocks)) marked.add(kind);
        // Whatever it is read as, its words are in the script.
        for (const frontMatter of titlePages) {
          const read = parse(script(frontMatter, blocks)).doc.content;
          expect(read.some((b) => words(b).includes(line))).toBe(true);
        }
      }
    }
    // The four that are written with no mark of their own. Every other kind
    // opens with one (`#`, `.`, `~`, `>`, `=`, `/*`) and is no key, and so
    // does a parenthetical, with its bracket.
    expect([...marked]).toEqual(["action", "character", "dialogue", "transition"]);
    for (const frontMatter of titlePages) {
      const bracketed = parse(script(frontMatter, [block("parenthetical", "Title: X"), room]));
      expect(bracketed.frontMatter).toEqual(frontMatter);
      expect(bracketed.doc.content).toEqual([block("action", "(Title: X)"), room]);
    }
    // A stage direction and a cue keep their type, shown above. A transition
    // does. A line of speech with no cue over it is a stage direction to any
    // reader, wherever it stands, and is marked as one.
    expect(opens([block("transition", "TITLE: BACK TO:"), room])[0]).toBe(
      "> TITLE: BACK TO:\n\nA room.\n",
    );
    expect(
      opens([block("dialogue", "Time: now."), room], [block("action", "Time: now."), room]),
    ).toEqual(["!Time: now.\n\nA room.\n", "Time: now.\n\nA room.\n"]);
  });

  it("every key either reader knows, in each way a first line can hold it", () => {
    // The tokenizer's keys: Fountain's own, and `draft date` with no space.
    const standard = [
      ...["Title", "Credit", "Author", "Authors", "Source", "Notes", "Draft date", "Date"],
      ...["Contact", "Copyright", "Revision", "Revisions", "Draftdate"],
    ];
    // Ours beside them: the house's.
    const house = [
      ...["Setting", "Time", "Place", "Characters", "Title Page Text"],
      ...["Characters Page Text", "Opening Notes", "Opening Notes First"],
    ];
    const neither = ["She said", "At rise", "Scene", "Lights", "Note", "Dated", "A title"];
    let marked = 0;
    let tried = 0;
    for (const key of [...standard, ...house, ...neither]) {
      const caps = key.toUpperCase();
      // With a value on the line: the tokenizer's under a title page too,
      // ours with none, and a key neither knows never.
      const withValue = asLower([block("action", `${key}: a value`), room]);
      expect(withValue).toBe(standard.includes(key) ? 2 : house.includes(key) ? 1 : 0);
      const shapes: BlockNode[][] = [
        [block("action", `${key.toLowerCase()}: a value`), room],
        [block("action", `${key}:`), room],
        [block("action", `${key}:\n    a value\n    and another`), room],
        [block("action", `${key}: a value\nand a second line`), room],
        [block("action", `Dear all: hello\n${key}: later`), room],
        [block("action", `Hello there\n${key}: later`), room],
        [block("action", ` ${key}: a value`), room],
        [block("action", `    ${key}: a value`), room],
        [block("dialogue", `${key}: a value`), room],
        [block("transition", `${caps}: BACK TO:`), room],
        [cue(`${caps}:`), hello, room],
        [cue(`${caps}: X`), hello, room],
        [cue(`${caps}:`), room],
        [cue(`${caps}: X`), room],
        [cue(`${caps}:`), block("parenthetical", "low"), hello],
        [cue(`${caps}: X`), block("lyric", "La la"), room],
        [cue("MARA:"), block("dialogue", `${key}: a value`), room],
      ];
      for (const blocks of shapes) marked += asLower(blocks);
      tried += shapes.length * 2;
    }
    // Both answers were met: the sweep is no proof if it only ever saw one.
    expect(tried).toBe(952);
    expect(marked).toBeGreaterThan(300);
    expect(marked).toBeLessThan(tried - 300);
  });

  it("a cue in every shape", () => {
    const shapes: [BlockNode[], string, BlockNode[]?][] = [
      [[cue("TITLE: X", { extension: "(V.O.)" }), hello], "@TITLE: X (V.O.)\nHello.\n"],
      [[cue("TITLE: X", { dual: true }), hello], "@TITLE: X ^\nHello.\n"],
      [[cue("TITLE: X"), block("parenthetical", "low"), hello], "@TITLE: X\n(low)\nHello.\n"],
      // Under a title page this one made the tokenizer throw, and the whole
      // script came back as one stage direction.
      [[cue("TITLE: X"), block("lyric", "La la"), room], "@TITLE: X\n~La la\n\nA room.\n"],
      // With no speech (docs/engineering/fountain-model.md#EDIT-175).
      [[cue("TITLE: X"), room], "@TITLE: X\n  \n\nA room.\n", [cue("TITLE: X"), noSpeechYet, room]],
    ];
    for (const [blocks, written, want] of shapes) {
      expect(opens(blocks, want)).toEqual([written, written]);
    }
    // Forced already, for its lower case or its comment: one `@`, never two.
    expect(opens([cue("Title: X"), hello])[0]).toBe("@Title: X\nHello.\n");
    const noted: BlockNode = { type: "character", content: [text("TITLE: X"), note("who?")] };
    expect(opens([noted, hello])[0]).toBe("@TITLE: X[[who?]]\nHello.\n");
    // The tokenizer takes no cue with a bracket in its name, with an `@` or
    // without (docs/engineering/fountain-model.md#EDIT-179). Such a line is a
    // stage direction wherever it stands, and at the top it is marked as one:
    // behind an `@` the mark would come back in its text.
    const direction = [block("action", "TITLE: A(B)C\nHello."), room];
    expect(parse(script({}, [room, cue("TITLE: A(B)C"), hello, room])).doc.content).toEqual([
      room,
      ...direction,
    ]);
    const limit = "!TITLE: A(B)C\nHello.\n\nA room.\n";
    expect(opens([cue("TITLE: A(B)C"), hello, room], direction)).toEqual([limit, limit]);
  });

  it("with nothing but empty lines in front of it", () => {
    const stays = [block("action", "Title: X"), room];
    // An empty stage direction and an empty cue are written as empty lines,
    // which the tokenizer's rule reads past. An empty lyric and an empty
    // parenthetical are not written (docs/engineering/fountain-model.md#EDIT-183).
    const inFront: [BlockNode, string][] = [
      [block("action", ""), "\n\n!Title: X\n\nA room.\n"],
      [cue(""), "\n\n!Title: X\n\nA room.\n"],
      [block("lyric", ""), "!Title: X\n\nA room.\n"],
      [block("parenthetical", ""), "!Title: X\n\nA room.\n"],
    ];
    for (const [nothing, written] of inFront) {
      for (const frontMatter of titlePages) {
        const source = script(frontMatter, [nothing, ...stays]);
        expect(source).toBe((frontMatter.title ? TITLE_PAGE : "") + written);
        const read = parse(source);
        expect(read.frontMatter).toEqual(frontMatter);
        expect(read.doc.content).toEqual(stays);
        // The empty line is not read back, and from there the script is at rest.
        const saved = serialize(read);
        expect(saved).toBe(`${frontMatter.title ? TITLE_PAGE : ""}!Title: X\n\nA room.\n`);
        expectRoundTripStable(saved);
      }
    }
    // Our reader wants its key on the file's first line, so behind an empty
    // line a key of the house's is safe from it, and gets no mark. The empty
    // line is not read back, and the save after has the key at the top: that
    // is the save that marks it. Before, that save wrote the line bare, and
    // the reopen after it took the line.
    const behind = script({}, [block("action", ""), block("action", "Time: now."), room]);
    expect(behind).toBe("\n\nTime: now.\n\nA room.\n");
    expect(parse(behind)).toEqual({
      frontMatter: {},
      doc: { type: "doc", content: [block("action", "Time: now."), room] },
    });
    expect(serialize(parse(behind))).toBe("!Time: now.\n\nA room.\n");
    expectRoundTripStable(behind);
    // Behind a line that is something, the key is not the first line, and is
    // written as it always was.
    const somethings: BlockNode[] = [
      block("boneyard", " cut "),
      { type: "action", content: [note("a thought")] },
      block("scene", "SCENE 1"),
      room,
    ];
    for (const something of somethings) {
      for (const body of opens([something, ...stays])) expect(body).toContain("\n\nTitle: X\n");
    }
  });

  it("with white space in front of the key", () => {
    // The tokenizer's rule reads past it. The mark goes directly in front of
    // the key: the tokenizer takes a `!` off behind white space, and leaves
    // one that has a space after it in the line.
    for (const space of [" ", "  ", "    "]) {
      const marked = `${space}!Title: X\n\nA room.\n`;
      expect(opens([block("action", `${space}Title: X`), room])).toEqual([marked, marked]);
    }
    // Ours wants its key at the start of the line, so one of its own is safe.
    expect(asLower([block("action", " Time: now."), room])).toBe(0);
    // A tab is four spaces once read, as in any stage direction.
    const tabbed = script({}, [block("action", "\tTitle: X\n\tand on"), room]);
    expect(tabbed).toBe("\t!Title: X\n\tand on\n\nA room.\n");
    expect(parse(tabbed)).toEqual({
      frontMatter: {},
      doc: { type: "doc", content: [block("action", "    Title: X\n    and on"), room] },
    });
  });

  it("leaves a first line no reader would take as it was", () => {
    const plain = [
      ...["She said: go.", "AT RISE: The kitchen at night.", "Scene: a kitchen", "Lights up."],
      ...["Hello there\nTime: later", "Titled: X", "The title: X", "12: noon", "Time now."],
    ];
    for (const line of plain) expect(asLower([block("action", line), room])).toBe(0);
    for (const name of ["MARA", "MARA:", "DATED:", "THE TIME:", "SCENE: A KITCHEN"]) {
      expect(asLower([cue(name), hello, room])).toBe(0);
    }
    // A heading that opens as a location does is no key either reader knows.
    expect(asLower([block("sceneHeading", "INT HOUSE: NIGHT"), room])).toBe(0);
    // Under a title page our own reader does not look again, so the house's
    // keys stand there as they always did, and so does a standard key with
    // nothing after it: no script at rest is rewritten.
    const under = (blocks: BlockNode[]) => {
      const source = script({ title: "Play" }, blocks);
      expect(parse(source).doc.content).toEqual(blocks);
      expect(serialize(parse(source))).toBe(source);
      return source.slice(TITLE_PAGE.length);
    };
    for (const line of ["Setting: A kitchen.", "Time: now.", "Place: here.", "Characters: two"]) {
      expect(under([block("action", line), room])).toBe(`${line}\n\nA room.\n`);
    }
    for (const name of ["TIME:", "SETTING:", "NOTES:", "TITLE:"]) {
      expect(under([cue(name), hello, room])).toBe(`${name}\nHello.\n\nA room.\n`);
    }
    // The tokenizer's rule for looking is wider than what it takes. A value
    // on the line under the key that opens as a key itself, it leaves, and
    // the whole block with it: such a script was at rest, and still is.
    for (const lines of ["Notes:\n    a: b", "Title:\n    BACK TO:", "Date:\n    Act One: night"]) {
      expect(rules.title_page.test(lines)).toBe(true);
      expect(tokenizerTakes(lines)).toBe(false);
      expect(under([block("action", lines), room])).toBe(`${lines}\n\nA room.\n`);
    }
  });

  it("reads a real title page as it always did", () => {
    const pages: [string, FrontMatter, BlockType[]][] = [
      [
        "Title: X\nAuthor: Y\n\nINT. HOUSE - DAY\n",
        { title: "X", authors: ["Y"] },
        ["sceneHeading"],
      ],
      [
        // The Fountain syntax page's own example.
        [
          "Title: _**BRICK & STEEL**_",
          "Credit: Written by",
          "Author: Stu Maschwitz",
          "Source: Story by KTM",
          "Draft date: 1/20/2012",
          "Contact:",
          "    Next Level Productions",
          "    1588 Mission Dr.",
          "",
          "EXT. BRICK'S PATIO - DAY",
          "",
        ].join("\n"),
        {
          title: "_**BRICK & STEEL**_",
          credit: "Written by",
          authors: ["Stu Maschwitz"],
          source: "Story by KTM",
          draftDate: "1/20/2012",
          contact: ["Next Level Productions", "1588 Mission Dr."],
        },
        ["sceneHeading"],
      ],
      [
        "Title:\n    X\n    Y\nAuthor: Z\nCopyright: (c) me\nSomething: else\n\nA room.\n",
        { title: "X\nY", authors: ["Z"], _extra: { Copyright: "(c) me", Something: "else" } },
        ["action"],
      ],
      [
        "Setting: A kitchen.\nTime: Night.\nPlace: Here.\nCharacters:\n    MARA — 40s\n    JONAH\n\n# ACT ONE\n",
        {
          setting: "A kitchen.",
          time: "Night.",
          place: "Here.",
          characters: [{ name: "MARA", description: "40s" }, { name: "JONAH" }],
        },
        ["act"],
      ],
      ["Draft date: 6/23/2012\n\nINT. HOUSE - DAY\n", { draftDate: "6/23/2012" }, ["sceneHeading"]],
      ["Notes: a draft\n\nA room.\n", { _extra: { Notes: "a draft" } }, ["action"]],
      ["Title: X\n", { title: "X" }, []],
      // A key no reader knows is no title page, and never was.
      ["Foo: bar\n\nA room.\n", {}, ["action", "action"]],
    ];
    for (const [source, frontMatter, kinds] of pages) {
      const read = parse(source);
      expect(read.frontMatter).toEqual(frontMatter);
      expect(read.doc.content.map((b) => b.type)).toEqual(kinds);
      expect(serialize(read)).toBe(source);
      // With Windows line endings too.
      expect(parse(source.replaceAll("\n", "\r\n"))).toEqual(read);
    }
    // A script saved before this rule with a key of ours as its first line
    // and no mark has the bytes of a title page, and is read as one: nothing
    // on the line says a writer meant a stage direction.
    expect(parse("Time: now.\n\nA room.\n")).toEqual({
      frontMatter: { time: "now." },
      doc: { type: "doc", content: [room] },
    });
    expect(serialize(parse("Time: now.\n\nA room.\n"))).toBe("Time: now.\n\nA room.\n");
  });

  it("reads what follows a title page as the script, whatever it looks like", () => {
    // Scripts written elsewhere, or by this app before the rule. Each of these
    // lines was in neither the front matter nor the script.
    const heading = block("sceneHeading", "INT. HOUSE - DAY");
    const followed: [string, BlockNode[], string][] = [
      ["Author: Y", [block("action", "Author: Y")], "!Author: Y"],
      ["Notes: a draft", [block("action", "Notes: a draft")], "!Notes: a draft"],
      [
        "Notes:\n    a draft\n    of two lines",
        [block("action", "Notes:\n    a draft\n    of two lines")],
        "!Notes:\n    a draft\n    of two lines",
      ],
      ["TITLE: Y\nHello.", [cue("TITLE: Y"), hello], "@TITLE: Y\nHello."],
      // This one came back as the whole script in one stage direction.
      ["TITLE: Y\n~La la", [cue("TITLE: Y"), block("lyric", "La la")], "@TITLE: Y\n~La la"],
      ["DATE: BACK TO:", [block("transition", "DATE: BACK TO:")], "> DATE: BACK TO:"],
    ];
    for (const [lines, blocks, saved] of followed) {
      const source = `Title: X\n\n${lines}\n\nINT. HOUSE - DAY\n`;
      for (const written of [source, source.replaceAll("\n", "\r\n")]) {
        const read = parse(written);
        expect(read.frontMatter).toEqual({ title: "X" });
        expect(read.doc.content).toEqual([...blocks, heading]);
        // The save after marks the line, for a reader that would still take it.
        expect(serialize(read)).toBe(`Title: X\n\n${saved}\n\nINT. HOUSE - DAY\n`);
        expectRoundTripStable(written);
      }
    }
    // More blank lines between the two change nothing.
    expect(parse("Title: X\n\n\n\nNotes: a draft\n\nA room.\n").doc.content).toEqual([
      block("action", "Notes: a draft"),
      room,
    ]);
  });

  it("asks no reader but ours for a title page", () => {
    // What our reader does not take is the script. The tokenizer's rule read
    // past white space and knew a key ours does not; what it took was in
    // neither the front matter nor the script. Each comes back as lines of
    // the script, and the save after marks the first.
    const kept: [string, string, string][] = [
      ["\n\nTitle: X\nAuthor: Y\n\nA room.\n", "Title: X\nAuthor: Y", "!Title: X\nAuthor: Y"],
      ["\nTitle: X\n\nA room.\n", "Title: X", "!Title: X"],
      [" Title: X\nAuthor: Y\n\nA room.\n", " Title: X\nAuthor: Y", " !Title: X\nAuthor: Y"],
      ["Draftdate: today\n\nA room.\n", "Draftdate: today", "!Draftdate: today"],
    ];
    for (const [source, lines, saved] of kept) {
      const read = parse(source);
      expect(read).toEqual({
        frontMatter: {},
        doc: { type: "doc", content: [block("action", lines), room] },
      });
      expect(serialize(read)).toBe(`${saved}\n\nA room.\n`);
      expectRoundTripStable(source);
    }
  });

  it("has the tokenizer read every script as it did", () => {
    // `parse` calls the tokenizer's script half. Asked for a whole script, the
    // tokenizer runs the same half over whatever its title-page rule leaves,
    // which is everything where the rule finds none: the same tokens.
    const bodies = [
      splitTitlePage(sampleText).body,
      "MARA\nStay.\n\nJONAH ^\nI can't.\n",
      "# ACT ONE\n\n## SCENE 1\n\nINT. KITCHEN - NIGHT #1A#\n\n= A synopsis.\n\nShe waits.\n\nCUT TO:\n",
      "MARA\n(low)\n~Row, row\n~Gently\nSpoken.\n\n> THE END <\n\n===\n\n[[a thought]]\n",
      "Time: now.\n\nA room.\n",
      // Its rule for looking matches these two, and it takes nothing.
      "Notes:\n    a: b\n\nA room.\n",
      "Title:\n    BACK TO:\n\nMARA\nHello.\n",
      "",
    ];
    for (const body of bodies) {
      expect(tokenizerTakes(body)).toBe(false);
      expect(Lexer.tokenizeScript(body)).toEqual(new Fountain().parse(body, true).tokens);
    }
    // Where the rule does find one, the whole script's tokens open with it.
    const taken = new Fountain().parse("Notes: buy milk\n\nA room.\n", true).tokens;
    expect(taken.map((t) => [t.type, t.is_title])).toEqual([
      ["notes", true],
      ["action", undefined],
    ]);
    expect(Lexer.tokenizeScript("Notes: buy milk\n\nA room.\n").map((t) => t.type)).toEqual([
      "action",
      "action",
    ]);
  });
});

/**
 * A line's own marks (docs/engineering/fountain-model.md#EDIT-185,
 * docs/engineering/fountain-model.md#EDIT-186 and
 * docs/engineering/fountain-model.md#EDIT-187). Three blocks came back as
 * something else, or with something else in them. A stage direction that
 * opened with a space and had to be forced came back with the `!` in its
 * text, and gained another on every save. One whose first line held no
 * letter, over a second line, came back as a character and a speech. A
 * centered line lost every `<` and `>` it held, and a transition that ended
 * in `<` came back centered.
 */
describe("a stage direction, a centered line and a transition keep their type and their text", () => {
  const line = (type: BlockType, ...content: InlineNode[]): BlockNode => ({ type, content });
  const em = (t: string): InlineNode => ({ type: "text", text: t, marks: [{ type: "em" }] });
  const reopened = (source: string) => parse(source).doc.content;
  const types = (source: string) => reopened(source).map((b) => b.type);
  /** The block written, read back as it was and written the same again: its line in the script. */
  const one = (type: BlockType, ...content: InlineNode[]) => written([line(type, ...content)]);
  /** A seeded sweep: the same lines on every run. */
  const dice = (seed: number) => {
    let state = seed;
    return <T>(from: readonly T[]): T => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return from[Math.floor((state / 0x100000000) * from.length)];
    };
  };

  it("the reported case: an indented stage direction in capitals is the same on every save", () => {
    let source = "    FADE\n";
    for (let save = 0; save < 3; save++) {
      expect(reopened(source)).toEqual([line("action", text("    FADE"))]);
      source = serialize(parse(source));
      expect(source).toBe("!    FADE\n");
    }
    // A tab that opens a stage direction is four spaces to the tokenizer, as
    // it always was, and from there the same.
    expect(reopened("\tFADE\n")).toEqual([line("action", text("    FADE"))]);
    expect(serialize(parse(serialize(parse("\tFADE\n"))))).toBe("!    FADE\n");
  });

  it("a forced stage direction keeps its indent, and gains nothing", () => {
    const forced: [string, string][] = [
      ["    FADE", "!    FADE"],
      [" INT. HOUSE", "! INT. HOUSE"],
      ["  He points TO:", "!  He points TO:"],
      [" .hidden", "! .hidden"],
      [" > not a transition", "! > not a transition"],
      ["  !bang", "!  !bang"],
      [" FADE\n  OUT", "! FADE\n  OUT"],
      ["  CUT\nShe waits.", "!  CUT\nShe waits."],
    ];
    for (const [words, source] of forced) {
      expect(one("action", text(words))).toBe(`${source}\n`);
    }
    // With a comment on it, of one line or two.
    expect(one("action", text("  FADE "), note("SAM: ONE\nTWO"))).toBe(
      "!  FADE [[SAM: ONE\nTWO]]\n",
    );
    // Between other blocks, and under a cue that has no speech.
    expect(
      written([
        line("action", text("Before.")),
        line("action", text("    FADE")),
        line("character", text("MARA")),
        line("dialogue", text("Hello.")),
        line("action", text("  LIGHTS OUT.")),
      ]),
    ).toBe("Before.\n\n!    FADE\n\nMARA\nHello.\n\n!  LIGHTS OUT.\n");
  });

  it("reads the ! that opens a block as its mark, whatever follows it", () => {
    expect(reopened("!    FADE\n")).toEqual([line("action", text("    FADE"))]);
    expect(reopened("! She waits.\n")).toEqual([line("action", text(" She waits."))]);
    // The tokenizer takes a line of its own that ends in ` TO:` for a
    // transition, and trims it (docs/engineering/fountain-model.md#EDIT-181).
    expect(reopened("!  He points TO:\n")).toEqual([line("action", text("  He points TO:"))]);
    expect(reopened("!  FADE\nShe waits.\n")).toEqual([line("action", text("  FADE\nShe waits."))]);
    // After a boneyard, which parts two blocks.
    expect(reopened("/* cut */\n!  FADE\n")).toEqual([
      line("boneyard", text(" cut ")),
      line("action", text("  FADE")),
    ]);
  });

  it("reads every other ! as it always did", () => {
    const asItWas: [string, BlockNode[]][] = [
      // Saved twice before this: the second `!` is the direction's own by now.
      ["!!    FADE\n", [line("action", text("!    FADE"))]],
      // On a later line of a stage direction, where the tokenizer leaves it.
      ["She waits.\n! bang\n", [line("action", text("She waits.\n! bang"))]],
      // Behind an indent, which the serializer never writes in front of a mark.
      ["  ! x\n", [line("action", text("  ! x"))]],
      // With nothing after it on its line but white space.
      ["! \n", [line("action", text("! "))]],
      ["!   \nShe waits.\n", [line("action", text("!   \nShe waits."))]],
      // In a speech.
      ["MARA\n! what\n", [line("character", text("MARA")), line("dialogue", text("! what"))]],
      // With no space after it.
      ["!FADE\n", [line("action", text("FADE"))]],
    ];
    for (const [source, blocks] of asItWas) {
      expect(reopened(source)).toEqual(blocks);
      expectRoundTripStable(source);
    }
    expect(serialize(parse("!!    FADE\n"))).toBe("!!    FADE\n");
  });

  it("a line of a stage direction that opens with a ! of its own keeps it", () => {
    // The tokenizer takes one `!` off the front of every line of a stage
    // direction, unless a space follows it.
    const own: [string, string][] = [
      ["She waits.\n!bang", "She waits.\n!!bang"],
      ["She waits.\n  !bang", "She waits.\n  !!bang"],
      ["She waits.\n!!bang", "She waits.\n!!!bang"],
      ["She waits.\n!! bang", "She waits.\n!!! bang"],
      ["She waits.\n! bang", "She waits.\n! bang"],
      ["FADE\n!bang", "!FADE\n!!bang"],
      ["!a\n!b\n!c", "!!a\n!!b\n!!c"],
      ["!", "!!"],
      ["! bang", "!! bang"],
    ];
    for (const [words, source] of own) {
      expect(one("action", text(words))).toBe(`${source}\n`);
    }
    // A comment's own line is not the block's, and is written as it stands.
    expect(one("action", text("She waits. "), note("Sam: one\n!two"))).toBe(
      "She waits. [[Sam: one\n!two]]\n",
    );
    // Every save used to take one off.
    expect(serialize(parse("She waits.\n!!bang\n"))).toBe("She waits.\n!!bang\n");
  });

  it("a first line with no lower case, over another line, is forced: a letter in it or not", () => {
    const first = [
      "1984.",
      "…",
      "—",
      "12:00.",
      "?!",
      "* * *",
      "$5.",
      "1.",
      "2 + 2 = 4.",
      "<",
      // No letter the tokenizer knows for lower case.
      "她等着。",
      "Привет.",
      "É",
      // A name in capitals and a bracket in lower case is a cue with an extension.
      "PAUSE (a long one)",
    ];
    for (const words of first) {
      const source = one("action", text(`${words}\nShe waits.`));
      expect(source.startsWith("!")).toBe(true);
      // With no mark it is a character and a speech, which is what it was.
      expect(types(source.slice(1))).toEqual(["character", "dialogue"]);
    }
    expect(one("action", text("1984.\nShe waits."))).toBe("!1984.\nShe waits.\n");
    expect(one("action", text("* * *\nShe waits."))).toBe("!\\* \\* \\*\nShe waits.\n");
    // Over Fountain's empty line, a sung line or a bracketed one.
    expect(one("action", text("1984.\n(beat)"))).toBe("!1984.\n(beat)\n");
    expect(one("action", text("—\n~la"))).toBe("!—\n~la\n");
    // With a comment on it: in capitals it is still a cue, in lower case none.
    expect(one("action", text("1984."), note("FIX"), text("\nShe waits."))).toBe(
      "!1984.[[FIX]]\nShe waits.\n",
    );
    expect(one("action", text("1984."), note("fix"), text("\nShe waits."))).toBe(
      "1984.[[fix]]\nShe waits.\n",
    );
  });

  it("and is written with no mark wherever the tokenizer takes it for a stage direction", () => {
    const plain = [
      // Nothing under it: a line alone is no cue.
      "1984.",
      "…",
      "她等着。",
      "12:00.",
      // Digits, spaces, `*` and `_` alone are no cue to the tokenizer.
      "1984\nShe waits.",
      "12 34\nShe waits.",
      // Lower case.
      "She waits.\nShe goes.",
      "1984, and she waits.\nShe goes.",
    ];
    for (const words of plain) {
      expect(one("action", text(words))).toBe(`${words}\n`);
    }
  });

  it("a stage direction is forced wherever the tokenizer would read its line as another element", () => {
    // A slug behind an indent or an emphasis mark is a scene heading to it.
    expect(one("action", text(" int. house"))).toBe("! int. house\n");
    expect(one("action", em("int. house"))).toBe("!*int. house*\n");
    expect(one("action", em("Ext. the yard"), text(", later"))).toBe("!*Ext. the yard*, later\n");
    // Only alone in its block: over another line it is a stage direction, and
    // was written so.
    expect(one("action", text(" int. house\nmore"))).toBe(" int. house\nmore\n");
    // A mark behind a no-break space, which the tokenizer looks past.
    expect(one("action", text("\u00A0.hidden"))).toBe("!\u00A0.hidden\n");
    expect(one("action", text("\u00A0> x"))).toBe("!\u00A0> x\n");
    expect(one("action", text("\u00A0= x"))).toBe("!\u00A0= x\n");
    expect(one("action", text("\u00A0!x"))).toBe("\u00A0!!x\n");
    expect(one("action", text("\u00A0...and then"))).toBe("\u00A0...and then\n");
  });

  it("never forces a stage direction that is read as one without", () => {
    // Every stage direction comes back the block it was. And a `!` is written
    // only where the older tests ask for one, or where the block with no mark
    // is not read back as that stage direction: a script that was read as it
    // was written is written the same.
    const pieces = [
      "FADE",
      "She waits.",
      "INT. HOUSE",
      "int. house",
      "CUT TO:",
      " TO:",
      "1984.",
      "12",
      "…",
      "—",
      "(beat)",
      "(V.O.)",
      "*",
      "_",
      "!",
      "<",
      ">",
      ".",
      "@",
      "~",
      "=",
      "#",
      "É",
      "я",
      "a",
      "B",
      "^",
      "OUT.",
      "\\",
      " ",
    ];
    const opens = ["", "", "", " ", "    ", "\u00A0"];
    const olderTests = (words: string) => {
      const first = words.split("\n", 1)[0];
      return (
        /^[ \t]*[.>@~=#!]/.test(words) ||
        (/[A-Z]/.test(first) && !/[a-z]/.test(first)) ||
        /^(?:(?:int|i)\.?\/(?:ext|e)|int|ext|est)[. ]/i.test(first) ||
        /\bTO:\s*$/.test(first)
      );
    };
    const roll = dice(184);
    let tried = 0;
    let forced = 0;
    for (let i = 0; i < 4000; i++) {
      const lines: string[] = [];
      for (let l = roll([1, 1, 2, 3]); l > 0; l--) {
        let words = roll(opens);
        for (let w = roll([1, 2, 3]); w > 0; w--) words += roll(pieces);
        lines.push(words);
      }
      // What no rule here is about: an empty line, and white space at a line's end.
      if (lines.some((l) => !l.trim() || /\s$/.test(l))) continue;
      tried++;
      const block = line("action", text(lines.join("\n")));
      const source = one("action", text(lines.join("\n")));
      const bare = `${serializeInline(block.content ?? [])}\n`;
      if (source === bare) continue;
      // Written differently: either an older test forced it, or it had to be.
      if (olderTests(bare.slice(0, -1))) continue;
      forced++;
      expect(reopened(bare)).not.toEqual([block]);
    }
    expect(tried).toBeGreaterThan(3000);
    expect(forced).toBeGreaterThan(100);
  });

  it("a centered line keeps its own < and >", () => {
    const centered: [string, string][] = [
      ["a < b", "> a < b <"],
      ["a > b", "> a > b <"],
      ["a<b", "> a<b <"],
      ["<<<", "> <<< <"],
      ["x <", "> x < <"],
      ["> x", "> > x <"],
      ["<- THE END ->", "> <- THE END -> <"],
      ["THE END", "> THE END <"],
      // A backslash in front of the line's closing mark is the text's own.
      ["x \\", "> x \\\\ <"],
    ];
    for (const [words, source] of centered) {
      expect(one("centered", text(words))).toBe(`${source}\n`);
    }
    expect(one("centered", text("a "), em("< b >"), text(" c"))).toBe("> a *< b >* c <\n");
    // The comment's too, and its line break.
    expect(one("centered", text("a < b"), note("c > d\n< e"))).toBe("> a < b[[c > d\n< e]] <\n");
    // Between other blocks.
    expect(
      written([
        line("action", text("Before.")),
        line("centered", text("a < b")),
        line("action", text("After.")),
      ]),
    ).toBe("Before.\n\n> a < b <\n\nAfter.\n");
  });

  it("reads a centered line already in a script with the marks it holds", () => {
    // Written by the app before this, and read back as `ab`.
    expect(reopened("> a < b <\n")).toEqual([line("centered", text("a < b"))]);
    expect(serialize(parse("> a < b <\n"))).toBe("> a < b <\n");
    expect(reopened(">a<b<\n")).toEqual([line("centered", text("a<b"))]);
    // The line's own marks are its first `>` and its last `<`, with the white
    // space the tokenizer trims around them.
    expect(reopened(" >  THE END  <  \n")).toEqual([line("centered", text("THE END"))]);
    // Two centered lines in one block, as another tool may write them.
    expect(reopened("> a < b <\n> c > d <\n")).toEqual([line("centered", text("a < b\nc > d"))]);
    // What is no centered line is read as it was: a line in a speech, and a
    // line that is one of a stage direction's.
    expect(reopened("MARA\n> a < b <\n")).toEqual([
      line("character", text("MARA")),
      line("dialogue", text("> a < b <")),
    ]);
    expect(reopened("> a < b <\nmore\n")).toEqual([line("action", text("> a < b <\nmore"))]);
    expect(types("> THE END <\n")).toEqual(["centered"]);
    expect(types("> BLACKOUT.\n")).toEqual(["transition"]);
    expect(reopened("> a < b\n")).toEqual([line("transition", text("a < b"))]);
  });

  it("a centered block of two lines is written with each line between its marks", () => {
    // Another tool writes two centered lines one under the other, and they
    // are read as one block. Written with the marks around the block, the
    // second line had none and the block came back a stage direction.
    const stacked = "> THE END <\n> of act one <\n";
    expect(reopened(stacked)).toEqual([line("centered", text("THE END\nof act one"))]);
    expect(serialize(parse(stacked))).toBe(stacked);
    expect(one("centered", text("THE END\nof act one"))).toBe(stacked);
    expect(one("centered", text("a < b\nc > d"))).toBe("> a < b <\n> c > d <\n");
    // Emphasis runs over the break, as it does in a stage direction.
    expect(one("centered", em("THE END\nof act one"))).toBe("> *THE END <\n> of act one* <\n");
    // A comment's line break is the comment's, and no line of the block.
    expect(one("centered", text("THE END"), note("Sam: one\ntwo"), text("\nof act one"))).toBe(
      "> THE END[[Sam: one\ntwo]] <\n> of act one <\n",
    );
  });

  it("a transition that ends in < stays a transition", () => {
    const transitions: [string, string][] = [
      ["FADE <", "> FADE \\<"],
      ["FADE<", "> FADE\\<"],
      ["<", "> \\<"],
      ["a < b <", "> a < b \\<"],
      // Only the one that would close a centered line.
      ["a < b", "> a < b"],
      ["< FADE", "> < FADE"],
      ["FADE >", "> FADE >"],
      // A backslash of its own in front of it is written as every backslash is.
      ["FADE \\<", "> FADE \\\\\\<"],
    ];
    for (const [words, source] of transitions) {
      expect(one("transition", text(words))).toBe(`${source}\n`);
    }
    expect(one("transition", note("Sam: one\ntwo"), text("FADE <"))).toBe(
      "> [[Sam: one\ntwo]]FADE \\<\n",
    );
    // In emphasis or past a comment the line does not end in `<`, and none is needed.
    expect(one("transition", em("FADE <"))).toBe("> *FADE <*\n");
    expect(one("transition", text("FADE <"), note("fix"))).toBe("> FADE <[[fix]]\n");
    // A line already in a script is the centered line it was read as.
    expect(reopened("> FADE <\n")).toEqual([line("centered", text("FADE"))]);
    expectRoundTripStable("> FADE <\n");
  });

  it("a transition that opens as a scene heading does is forced", () => {
    // A scene heading is the first thing the tokenizer looks for, and it
    // looks at how the line opens: in capitals to `TO:` these were written
    // with no mark, and came back headings.
    expect(one("transition", text("INT. HOUSE - CUT TO:"))).toBe("> INT. HOUSE - CUT TO:\n");
    expect(one("transition", text("EXT. CUT TO:"))).toBe("> EXT. CUT TO:\n");
    expect(one("transition", text("I/E CUT TO:"))).toBe("> I/E CUT TO:\n");
    // What only begins with the same letters is no heading, and needs none.
    expect(one("transition", text("INTERCUT TO:"))).toBe("INTERCUT TO:\n");
    expect(one("transition", text("SMASH CUT TO:"))).toBe("SMASH CUT TO:\n");
  });

  it("holds for every centered line and transition of one line", () => {
    const pieces = [
      "FADE",
      "She waits.",
      "INT. HOUSE",
      "CUT TO:",
      " TO:",
      "1984.",
      "…",
      "<",
      ">",
      " < ",
      " > ",
      "a<b",
      "\\",
      "*",
      "_",
      "!",
      ".",
      "@",
      "~",
      "=",
      "#",
      "É",
      "x",
      "OUT.",
      "BLACK.",
      "(beat)",
    ];
    const roll = dice(186);
    let tried = 0;
    for (let i = 0; i < 4000; i++) {
      let words = "";
      for (let w = roll([1, 2, 3, 4]); w > 0; w--) words += roll(pieces);
      // The tokenizer trims both: white space at an end is no rule's here.
      if (!words.trim() || words !== words.trim()) continue;
      tried++;
      one(roll(["centered", "transition"] as const), text(words));
    }
    expect(tried).toBeGreaterThan(3000);
  });

  it("keeps a script that already holds the tag's character", () => {
    const source = "> a \uE0041\uE004 < b <\n\n!  FADE \uE0040\uE004\n";
    expect(reopened(source)).toEqual([
      line("centered", text("a \uE0041\uE004 < b")),
      line("action", text("  FADE \uE0040\uE004")),
    ]);
    expectRoundTripStable(source);
  });
});

/**
 * White space at the top of a script
 * (docs/engineering/fountain-model.md#EDIT-188). A first line of white space
 * over an empty line took the block under it out of the script, and the same
 * script read differently on its next reading: the tokenizer's rule for blank
 * lines takes a first line alone, and keeps its place between calls.
 */
describe("white space at the top of a script takes no block with it", () => {
  const line = (type: BlockType, ...content: InlineNode[]): BlockNode => ({ type, content });
  const reopened = (source: string) => parse(source).doc.content;
  const waits = line("action", text("She waits."));
  const goes = line("action", text("He goes."));
  const cut = line("boneyard", text(" cut "));
  const TITLE_PAGE = "Title: Play\n\n";
  /** A line of white space. None is two spaces, which is Fountain's empty line of a speech. */
  const SPACE = [" ", "   ", "\t", " "];
  /** One to three lines over a script, at least one of them white space. */
  const tops: string[] = [];
  for (const a of [...SPACE, ""]) {
    for (const b of [...SPACE, "", null]) {
      for (const c of [...SPACE, "", null]) {
        const lines = [a, b, c].filter((l) => l !== null);
        if (b === null && c !== null) continue;
        if (lines.some((l) => l)) tops.push(lines.map((l) => `${l}\n`).join(""));
      }
    }
  }
  /** Where the tokenizer's rule for blank lines was left, which the next call starts from. */
  const PLACES = [0, 1, 2, 3, 7, 40, 100000];
  /** The script read from each place: the same every time, and the place left where it starts. */
  function fromEveryPlace(source: string) {
    rules.blank_lines.lastIndex = 0;
    const want = parse(source);
    for (const place of PLACES) {
      rules.blank_lines.lastIndex = place;
      expect(parse(source)).toEqual(want);
      expect(rules.blank_lines.lastIndex).toBe(0);
    }
    return want;
  }

  it("the reported case: a first line of one space, and the block is there on every call", () => {
    const source = " \n\nShe waits.\n";
    rules.blank_lines.lastIndex = 0;
    for (let call = 0; call < 12; call++) expect(reopened(source)).toEqual([waits]);
    expect(serialize(parse(source))).toBe("She waits.\n");
  });

  it("the same under a title page", () => {
    const source = "Title: X\n\n \n\nShe waits.\n\nHe goes.\n";
    rules.blank_lines.lastIndex = 0;
    for (let call = 0; call < 12; call++) {
      const read = parse(source);
      expect(read.frontMatter).toEqual({ title: "X" });
      expect(read.doc.content).toEqual([waits, goes]);
    }
    expect(serialize(parse(source))).toBe("Title: X\n\nShe waits.\n\nHe goes.\n");
  });

  it("reads a script as it reads the same script with no white space over it", () => {
    const scripts = [
      "She waits.\n",
      "She waits.\nHe goes.\n\nA room.\n",
      "    She waits.\n",
      "!    FADE\n",
      "MARA\nHello.\n\nHe goes.\n",
      "MARA\n(quietly)\nHello.\n\nIVO ^\nGoodbye.\n",
      "MARA\n  \n",
      "@McArdle\n~La la la\n",
      "INT. HOUSE - DAY\n\nShe waits.\n",
      "# ACT ONE\n\n## Scene 1\n\nShe waits.\n",
      "= She waits here.\n",
      "CUT TO:\n\nShe waits.\n",
      "> BLACKOUT.\n",
      "> THE END <\n",
      "~La la la\n\nShe waits.\n",
      "[[a note]]\n\nShe waits.\n",
      "[[a note\n\nover a gap]] She waits.\n",
      "===\n\nShe waits.\n",
      "/* cut */\n\nShe waits.\n",
    ];
    expect(tops.length).toBe(152);
    for (const titlePage of ["", TITLE_PAGE]) {
      for (const script of scripts) {
        rules.blank_lines.lastIndex = 0;
        const want = parse(titlePage + script);
        expect(want.doc.content.length).toBeGreaterThan(0);
        for (const top of tops) {
          // Twice: the second reading started from where the first left the tokenizer.
          expect(parse(titlePage + top + script)).toEqual(want);
          expect(parse(titlePage + top + script)).toEqual(want);
        }
      }
    }
  });

  it("keeps a boneyard that opens the script behind white space", () => {
    for (const titlePage of ["", TITLE_PAGE]) {
      for (let call = 0; call < 4; call++) {
        expect(reopened(`${titlePage} /* cut */\n\nShe waits.\n`)).toEqual([cut, waits]);
        expect(reopened(`${titlePage}\t/* cut */ She waits.\n`)).toEqual([
          cut,
          line("action", text(" She waits.")),
        ]);
        expect(reopened(`${titlePage} \n\n/* cut */\n\nShe waits.\n`)).toEqual([cut, waits]);
        expect(reopened(`${titlePage} /* cut */`)).toEqual([cut]);
      }
    }
  });

  it("reads a first paragraph of spaces as no block, and every block under it", () => {
    const under: BlockNode[][] = [
      [waits],
      [waits, goes],
      [line("action", text("    FADE"))],
      [line("action", text("Time: now."))],
      [line("character", text("MARA")), line("dialogue", text("Hello."))],
      [line("character", text("MARA")), line("dialogue")],
      [line("character", text("MARA")), line("lyric", text("La la la"))],
      [line("act", text("ACT ONE")), line("scene", text("Scene 1")), waits],
      [line("sceneHeading", text("INT. HOUSE - DAY")), waits],
      [line("synopsis", text("She waits here."))],
      [line("transition", text("CUT TO:")), waits],
      [line("transition", text("Blackout."))],
      [line("centered", text("THE END"))],
      [line("lyric", text("La la la")), waits],
      [line("action", note("a note")), waits],
      [{ type: "pageBreak" }, waits],
      [cut, waits],
    ];
    for (const frontMatter of [{}, { title: "Play" }]) {
      for (const space of [...SPACE, "    ", " \t "]) {
        for (const blocks of under) {
          const content = [line("action", text(space)), ...blocks];
          const source = serialize({ frontMatter, doc: { type: "doc", content } });
          // The paragraph is written as an empty line
          // (docs/engineering/fountain-model.md#EDIT-189). Before that rule it
          // was written as typed, which is how a script comes to hold the line.
          const title = frontMatter.title ? TITLE_PAGE : "";
          expect(source.startsWith(`${title}\n\n`)).toBe(true);
          const asTyped = `${title}${space}${source.slice(title.length)}`;
          for (const written of [source, asTyped]) {
            const read = fromEveryPlace(written);
            expect(read.frontMatter).toEqual(frontMatter);
            expect(read.doc.content).toEqual(blocks);
            // The save after is the script with no such paragraph, and is at rest.
            const saved = serialize(read);
            expect(parse(saved)).toEqual(read);
            expect(serialize(parse(saved))).toBe(saved);
          }
        }
      }
    }
    expect(
      serialize({
        frontMatter: {},
        doc: { type: "doc", content: [line("action", text(" ")), waits] },
      }),
    ).toBe("\n\nShe waits.\n");
  });

  it("reads the same wherever the tokenizer was left, and leaves it where it starts", () => {
    const empty = line("dialogue");
    const mara = line("character", text("MARA"));
    for (const [source, want] of [
      [" \n\nShe waits.\n", [waits]],
      [" \n \nShe waits.\n", [waits]],
      ["\t\n\n\nShe waits.\n\nHe goes.\n", [waits, goes]],
      ["Title: X\n\n \n\nShe waits.\n\nHe goes.\n", [waits, goes]],
      [" \n\nMARA\n  \n", [mara, empty]],
      [" \n\nMARA\n  \n\nHe goes.\n", [mara, empty, goes]],
      // A script of white space and nothing else was no blocks, then a stage
      // direction of one space, then no blocks.
      ["", []],
      [" ", []],
      [" \n", []],
      [" \n ", []],
      [" \n\n", []],
      ["﻿\n \n", []],
      ["Title: X\n\n\n\t\n   \n", []],
    ] as [string, BlockNode[]][]) {
      expect(fromEveryPlace(source).doc.content).toEqual(want);
    }
    // And a script with no white space over it, after one that has.
    parse(" \n\nShe waits.\n");
    expect(parse(sampleText)).toEqual(fromEveryPlace(sampleText));
  });

  it("leaves white space lower in a script, and a first line that is Fountain's two spaces, as they were", () => {
    const room = line("action", text("A room."));
    rules.blank_lines.lastIndex = 0;
    for (const space of SPACE) {
      expect(reopened(`A room.\n\n${space}\n\nShe waits.\n`)).toEqual([room, waits]);
      expect(reopened(`A room.\n${space}\nShe waits.\n`)).toEqual([room, waits]);
      // Directly over the first block, with no empty line between, it took nothing.
      expect(reopened(`${space}\nShe waits.\n`)).toEqual([waits]);
    }
    expect(reopened("\n\nShe waits.\n")).toEqual([waits]);
    expect(reopened("\nShe waits.\n")).toEqual([waits]);
    expect(reopened("\n \nShe waits.\n")).toEqual([waits]);
    expect(reopened("  \n\nShe waits.\n")).toEqual([waits]);
    expect(reopened("Title: X\n\n  \n\nShe waits.\n")).toEqual([waits]);
  });

  it("a sweep: no generated script loses a word to its white space, or reads two ways", () => {
    let state = 20261008;
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const roll = <T>(from: readonly T[]): T => from[Math.floor(rand() * from.length)];
    const blanks = ["", "", "", ...SPACE, " \t ", "    ", "﻿"];
    const lines = [
      "She waits.",
      "He goes out.",
      "MARA",
      "IVO (O.S.)",
      "@McArdle",
      "MARA ^",
      "Hello there.",
      "(quietly)",
      "~La la la",
      "INT. HOUSE - DAY",
      ".a forced heading",
      "# ACT ONE",
      "## Scene one",
      "= A synopsis here",
      "CUT TO:",
      "> BLACKOUT.",
      "> THE END <",
      "[[a note]]",
      "[[one]][[two]]",
      "===",
      "!  FADE",
      "    indented",
      "/* cut */",
      " /* cut behind a space */",
      "/* cut */ and after",
      "A [[note\n\nwith a gap]] here",
      "1984.",
    ];
    /** The script with no line of white space over its first line that holds something. */
    const withoutTop = (source: string) => {
      const rest = source.split("\n");
      while (rest.length > 1 && !rest[0].trim()) rest.shift();
      return rest.join("\n");
    };
    const said = (read: unknown) => JSON.stringify(read).toLowerCase();
    let tried = 0;
    let opened = 0;
    while (tried < 4000) {
      const script: string[] = [];
      if (rand() < 0.6) for (let n = roll([1, 2, 3]); n > 0; n--) script.push(roll(blanks));
      for (let n = roll([1, 2, 3, 4, 5, 6]); n > 0; n--) {
        script.push(rand() < 0.3 ? roll(blanks) : roll(lines));
      }
      // Two spaces over a line are a speech's empty line, and no white space of this rule's.
      const body = `${script.join("\n")}\n`;
      const source = (rand() < 0.25 ? TITLE_PAGE : "") + body;
      tried++;
      const read = fromEveryPlace(source);
      for (const word of body.match(/\p{L}{3,}/gu) ?? []) {
        expect(said(read)).toContain(word.toLowerCase());
      }
      const bare = withoutTop(body);
      if (bare === body) continue;
      opened++;
      expect(read.doc).toEqual(parse(source.slice(0, source.length - body.length) + bare).doc);
    }
    expect(opened).toBeGreaterThan(1500);
  });
});

/**
 * No line of white space is written above a script's first words
 * (docs/engineering/fountain-model.md#EDIT-189). The reader takes no block
 * with such a line any more (docs/engineering/fountain-model.md#EDIT-188). A
 * reader that still has the fault does: a version of this app from before
 * that rule, and any other built on the tokenizer. So a first paragraph of
 * spaces is written as the empty line an empty one is, which every reader
 * reads past. The tokenizer is asked itself here, as that reader asks it.
 */
describe("no line of white space is written above a script's first words", () => {
  const block = (type: BlockType, t: string): BlockNode => ({ type, content: t ? [text(t)] : [] });
  const hello = block("action", "Hello there.");
  const room = block("action", "A room.");
  const mara = block("character", "MARA");
  const speech = block("dialogue", "Hello.");
  const TITLE_PAGE = "Title: Play\n\n";
  /** With no title page, and under one. */
  const tops: [string, FrontMatter][] = [
    ["", {}],
    [TITLE_PAGE, { title: "Play" }],
  ];
  const script = (frontMatter: FrontMatter, content: BlockNode[]) =>
    serialize({ frontMatter, doc: { type: "doc", content } });
  const doc = (frontMatter: FrontMatter, content: BlockNode[]) => ({
    frontMatter,
    doc: { type: "doc" as const, content },
  });

  /** The script, read from wherever the tokenizer's rule for blank lines was left: the same each time. */
  function reopened(source: string) {
    rules.blank_lines.lastIndex = 0;
    const read = parse(source);
    for (const left of [1, 2, 3, 4]) {
      rules.blank_lines.lastIndex = left;
      expect(parse(source)).toEqual(read);
      expect(rules.blank_lines.lastIndex).toBe(0);
    }
    return read;
  }

  /**
   * What the tokenizer makes of a script it is handed as it stands, which is
   * how a reader with the fault hands it over: our title page off, and
   * nothing in front.
   */
  function tokenizerReads(body: string): string[] {
    rules.blank_lines.lastIndex = 0;
    const kinds = Lexer.tokenizeScript(body).map((t) => t.type);
    rules.blank_lines.lastIndex = 0;
    return kinds.filter((kind) => !kind.startsWith("dialogue_"));
  }

  /** A seeded sweep: the same models on every run. */
  const dice = (seed: number) => {
    let state = seed;
    return <T>(from: readonly T[]): T => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return from[Math.floor((state / 0x100000000) * from.length)];
    };
  };

  it("a first block of white space is written as an empty line", () => {
    const whites = [" ", "   ", "\t", " \t", "\u00A0", "\u3000", "\uFEFF"];
    for (const [title, frontMatter] of tops) {
      for (const white of whites) {
        // A stage direction, or a cue with white space for a name.
        for (const first of [block("action", white), block("character", white)]) {
          for (const rest of [
            [hello, room],
            [mara, speech, room],
          ]) {
            const source = script(frontMatter, [first, ...rest]);
            expect(source).toBe(`${title}\n\n${script({}, rest)}`);
            expect(reopened(source)).toEqual(doc(frontMatter, rest));
            // A line of white space is not read back, at the top or lower in
            // a script, and from there the script is at rest.
            expect(serialize(parse(source))).toBe(script(frontMatter, rest));
            expectRoundTripStable(source);
          }
        }
      }
      // A spoken line of white space the serializer does not write as
      // Fountain's empty line: any but spaces and tabs.
      expect(script(frontMatter, [block("dialogue", "\u00A0"), hello, room])).toBe(
        `${title}\n\nHello there.\n\nA room.\n`,
      );
      // Behind a block that is not written
      // (docs/engineering/fountain-model.md#EDIT-183).
      expect(script(frontMatter, [block("lyric", ""), block("action", "   "), hello])).toBe(
        `${title}\n\nHello there.\n`,
      );
      // Behind an empty line. Under a title page the reader takes the empty
      // lines off the top of the script, and the white space was its first line.
      const behind = script(frontMatter, [block("action", ""), block("action", "   "), hello]);
      expect(behind).toBe(`${title}\n\n\n\nHello there.\n`);
      expect(reopened(behind)).toEqual(doc(frontMatter, [hello]));
      // Two of them, and white space of two lines.
      expect(script(frontMatter, [block("action", " "), block("action", "\t"), hello])).toBe(
        `${title}\n\n\n\nHello there.\n`,
      );
      expect(script(frontMatter, [block("action", " \n "), hello])).toBe(
        `${title}\n\n\nHello there.\n`,
      );
      // A script of nothing else.
      expect(script(frontMatter, [block("action", "   ")])).toBe(
        frontMatter.title ? "Title: Play\n" : "\n",
      );
    }
  });

  it("and so are the white lines one block holds above its words", () => {
    const one = block("action", "In one block.");
    const above: [string, string][] = [
      // The fault took the block itself: a white line, a blank one, its words.
      ["   \n\nIn one block.", "\n\nIn one block."],
      [" \n \nIn one block.", "\n\nIn one block."],
      ["\t\n\n\nIn one block.", "\n\n\nIn one block."],
      // Directly over its words the white line took nothing, and is a blank line too.
      ["   \nIn one block.", "\nIn one block."],
    ];
    for (const [words, lines] of above) {
      for (const [title, frontMatter] of tops) {
        const source = script(frontMatter, [block("action", words), room]);
        expect(source).toBe(`${title}${lines}\n\nA room.\n`);
        expect(reopened(source)).toEqual(doc(frontMatter, [one, room]));
        expectRoundTripStable(source);
      }
    }
  });

  it("writes every other first line as it did", () => {
    const asItWas: [BlockNode[], string][] = [
      // An empty first line, which no reader has a fault with.
      [[block("action", ""), hello], "\n\nHello there.\n"],
      [[block("character", ""), hello], "\n\nHello there.\n"],
      // Fountain's empty line under a cue. Where it would be the first line it
      // opens a block, and is written empty too
      // (docs/engineering/fountain-model.md#EDIT-191, pinned below).
      [[mara, hello], "MARA\n  \n\nHello there.\n"],
      // An indent on a line that holds words is the line's.
      [[block("action", "    She waits."), hello], "    She waits.\n\nHello there.\n"],
      [[block("action", "\tShe waits."), hello], "\tShe waits.\n\nHello there.\n"],
      [[block("action", "    LIGHTS UP."), hello], "!    LIGHTS UP.\n\nHello there.\n"],
      // Lower in a script a line of white space is written as it was, and read as a blank one.
      [[room, block("action", "   "), hello], "A room.\n\n   \n\nHello there.\n"],
      [[room, block("character", "\t"), hello], "A room.\n\n\t\n\nHello there.\n"],
    ];
    for (const [blocks, lines] of asItWas) {
      for (const [title, frontMatter] of tops) {
        const source = script(frontMatter, blocks);
        expect(source).toBe(`${title}${lines}`);
        expectRoundTripStable(source);
      }
    }
    // Each is read with every block after its first line in place.
    expect(reopened("  \n\n   \n\nHello there.\n").doc.content).toEqual([hello]);
    expect(reopened("A room.\n\n\t\n\nHello there.\n").doc.content).toEqual([room, hello]);
  });

  it("a reader that still has the fault loses nothing of what is written", () => {
    // The fault is the tokenizer's, and still there: handed the script as a
    // first paragraph of spaces was written, it has no first block.
    expect(tokenizerReads("   \n\nHello there.\n\nA room.\n")).toEqual(["spaces", "action"]);
    expect(tokenizerReads("\n\nHello there.\n\nA room.\n")).toEqual(["action", "action"]);
    const whites = ["", " ", "   ", "\t", "\u00A0", "\uFEFF", " \n ", "\n", " \n\n "];
    const rests: [BlockNode[], string[]][] = [
      [
        [hello, room],
        ["action", "action"],
      ],
      [
        [mara, speech, room],
        ["character", "dialogue", "action"],
      ],
      [
        [block("sceneHeading", "INT. ROOM - DAY"), room],
        ["scene_heading", "action"],
      ],
      [
        [block("scene", "SCENE 1"), room],
        ["section", "action"],
      ],
    ];
    let held = 0;
    for (const [, frontMatter] of tops) {
      for (const [rest, kinds] of rests) {
        for (const first of whites) {
          for (const second of [null, ...whites]) {
            for (const type of ["action", "character"] as const) {
              const white = [first, second].filter((w) => w !== null).map((w) => block(type, w));
              const source = script(frontMatter, [...white, ...rest]);
              // The script under its title page, with the empty lines our reader takes off it.
              expect(tokenizerReads(splitTitlePage(source).body)).toEqual(kinds);
              expect(parse(source).doc.content).toEqual(rest);
              held++;
            }
          }
        }
      }
    }
    expect(held).toBe(1440);
  });

  it("holds for generated models, each read at the top as it is lower in a script", () => {
    const kinds: BlockType[] = [
      ...(["action", "action", "character", "dialogue", "parenthetical", "lyric"] as const),
      ...(["transition", "centered", "sceneHeading", "scene", "act", "synopsis"] as const),
    ];
    const words = [
      ...[
        "",
        " ",
        "  ",
        "   ",
        "\t",
        "\u00A0",
        " \n ",
        "   \n\nIn one block.",
        " \n \nIn one block.",
      ],
      ...["Hello there.", "MARA", "Hello.", "Time: now.", "    LIGHTS UP.", "FADE", "La la"],
      ...["She waits.\nShe goes.", "  \nUnder.", "\n\nAfter two.", " x", "x "],
    ];
    const white = ["", " ", "  ", "   ", "\t", "\u00A0", "\uFEFF", " \n "];
    const roll = dice(189);
    let emptyFirst = 0;
    for (let i = 0; i < 1500; i++) {
      const content: BlockNode[] = [];
      for (let n = roll([1, 1, 2]); n > 0; n--) {
        content.push(
          block(roll(["action", "action", "character", "dialogue"] as const), roll(white)),
        );
      }
      for (let n = roll([1, 2, 3, 4]); n > 0; n--) content.push(block(roll(kinds), roll(words)));
      for (const [, frontMatter] of tops) {
        const source = script(frontMatter, content);
        const lines = source.slice(frontMatter.title ? TITLE_PAGE.length : 0).split("\n");
        // The first line that is not empty, which under a title page is the
        // first the reader has: it holds something. Fountain's empty line is
        // no first line either (docs/engineering/fountain-model.md#EDIT-191).
        const first = lines.find((line) => line !== "") ?? "";
        expect(first === "" || first.trim() !== "").toBe(true);
        const lower = parse(script(frontMatter, [room, ...content])).doc.content.slice(1);
        expect(reopened(source).doc.content).toEqual(lower);
        if (lines[0] === "") emptyFirst++;
      }
    }
    expect(emptyFirst).toBeGreaterThan(500);
  });

  // The reading is docs/engineering/fountain-model.md#EDIT-188's, pinned
  // above. Two more of what it reads, which the writer's rule leans on.
  it("the reader takes for white space every character the tokenizer does, with either line ending", () => {
    const whites = [
      ...[" ", "    ", "\t", " \t ", "\u00A0", "\f", "\v", "\u3000", "\u2028"],
      // A byte-order mark is white space to the tokenizer, alone on the line or with more.
      ...["\uFEFF", "\uFEFF  ", "\uFEFF\t"],
    ];
    for (const white of whites) {
      rules.blank_lines.lastIndex = 0;
      expect(rules.blank_lines.test(`${white}\n`)).toBe(true);
      for (const [title, frontMatter] of tops) {
        for (const under of ["Hello there.", "MARA\nHello."]) {
          const blocks = under === "Hello there." ? [hello, room] : [mara, speech, room];
          const source = `${title}${white}\n\n${under}\n\nA room.\n`;
          expect(reopened(source)).toEqual(doc(frontMatter, blocks));
          expect(reopened(source.replaceAll("\n", "\r\n"))).toEqual(doc(frontMatter, blocks));
        }
      }
    }
    // What is no white space to it is a line of the script, as it was.
    expect(reopened("\u200B\n\nHello there.\n").doc.content).toEqual([
      block("action", "\u200B"),
      hello,
    ]);
  });

  it("and Fountain's two-space line is white space there too, in each mix with the rest", () => {
    // At the top of a script it opens the first block, and is a blank line
    // (docs/engineering/fountain-model.md#EDIT-191). Over a line it was a cue
    // with no name, and that line its speech.
    const mixes = [
      "  \n\nHello there.\n\nA room.\n",
      "  \nHello there.\n\nA room.\n",
      "   \n  \nHello there.\n\nA room.\n",
      "\n  \nHello there.\n\nA room.\n",
      "  \n   \nHello there.\n\nA room.\n",
      "  \n   \n\nHello there.\n\nA room.\n",
      "  \n\n   \n\nHello there.\n\nA room.\n",
      "  \n  \nHello there.\n\nA room.\n",
      // Behind a line of white space and a blank one, where the block it
      // opens was lost.
      "   \n\n  \nHello there.\n\nA room.\n",
    ];
    for (const source of mixes) {
      for (const [title, frontMatter] of tops) {
        expect(reopened(`${title}${source}`)).toEqual(doc(frontMatter, [hello, room]));
      }
    }
  });
});

/**
 * Fountain's two-space line opens no block
 * (docs/engineering/fountain-model.md#EDIT-191). The line is an empty one that
 * keeps its block going. With no line of the block over it there is none to
 * keep, and it is a blank line: the block under it reads as it does with
 * nothing over it. It was a character with no name, and the rest of the block
 * its speech, because the word the reader holds the line as is in capitals.
 */
describe("Fountain's two-space line opens no block", () => {
  const block = (type: BlockType, t: string): BlockNode => ({ type, content: t ? [text(t)] : [] });
  const room = block("action", "A room.");
  const waits = block("action", "She waits.");
  const goes = block("action", "He goes.");
  const mara = block("character", "MARA");
  const hello = block("dialogue", "Hello.");
  const TITLE_PAGE = "Title: Play\n\n";
  /** A line that ends inside itself, to a regexp: the reader's hold found two spaces beside one. */
  const SEPARATOR = String.fromCharCode(0x2028);
  const NO_BREAK = String.fromCharCode(0xa0);
  const script = (frontMatter: FrontMatter, content: BlockNode[]) =>
    serialize({ frontMatter, doc: { type: "doc", content } });
  const nameless = (blocks: BlockNode[]) =>
    blocks.filter((b) => b.type === "character" && !b.content?.length).length;

  /** The script, read from wherever the tokenizer's rule for blank lines was left: the same each time. */
  function reopened(source: string): BlockNode[] {
    rules.blank_lines.lastIndex = 0;
    const read = parse(source);
    for (const left of [1, 2, 3, 7, 100000]) {
      rules.blank_lines.lastIndex = left;
      expect(parse(source)).toEqual(read);
      expect(rules.blank_lines.lastIndex).toBe(0);
    }
    return read.doc.content;
  }

  /**
   * The script with every two-space line that has no line of a block over it
   * made empty. Written here, a line at a time, and not the reader's: for a
   * script in which no note or boneyard runs over a line break.
   */
  function withNoneOver(source: string): string {
    let over = false;
    const lines = source.split("\n").map((each) => {
      if (each.trim()) over = true;
      else if (each !== "  ") over = false;
      else if (!over) return "";
      return each;
    });
    return lines.join("\n");
  }

  /**
   * The kinds a version of this app from before the rule got from the
   * tokenizer: the script behind a line break, each two-space line held as a
   * word in capitals, and a line of its own between a block's first line and
   * a sung second (docs/engineering/fountain-model.md#EDIT-175). A cue that
   * is the held word and nothing more is the character with no name.
   */
  function asItWasRead(body: string): string[] {
    const word = "HELD-LINE";
    const lines = body.replace(/^ {2}$/gm, word).split("\n");
    const shown = lines.flatMap((each, i) => {
      const opens = i === 0 || !lines[i - 1].trim();
      const sung = (at: number) => /^~(?! )./.test((lines[at] ?? "").trim());
      return opens && each.trim() && !sung(i) && sung(i + 1) ? [each, "STAND-IN"] : [each];
    });
    rules.blank_lines.lastIndex = 0;
    const tokens = Lexer.tokenizeScript(`\n${shown.join("\n")}`);
    rules.blank_lines.lastIndex = 0;
    return tokens.map((t) => (t.type === "character" && t.text === word ? "no name" : t.type));
  }

  /** A seeded sweep: the same scripts on every run. */
  const dice = (seed: number) => {
    let state = seed;
    return <T>(from: readonly T[]): T => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return from[Math.floor((state / 0x100000000) * from.length)];
    };
  };

  it("the reported cases: the block under the line, and no character with no name", () => {
    const reported: [string, BlockNode[], string][] = [
      ["A room.\n\n  \nShe waits.\n", [room, waits], "A room.\n\nShe waits.\n"],
      ["A room.\n\n  \nMARA\nHello.\n", [room, mara, hello], "A room.\n\nMARA\nHello.\n"],
      ["  \nShe waits.\n", [waits], "She waits.\n"],
      ["  \nMARA\nHello.\n", [mara, hello], "MARA\nHello.\n"],
    ];
    for (const [source, blocks, saved] of reported) {
      for (let call = 0; call < 12; call++) expect(reopened(source)).toEqual(blocks);
      // The save after the first reading is the script at rest. It took two
      // more readings to get there, each a different document.
      expect(serialize(parse(source))).toBe(saved);
      expectRoundTripStable(saved);
      expect(reopened(saved)).toEqual(blocks);
    }
    // Under a title page the script's first line is its top.
    const under = parse(`${TITLE_PAGE}  \nShe waits.\n`);
    expect(under.frontMatter).toEqual({ title: "Play" });
    expect(under.doc.content).toEqual([waits]);
    // What the reading was: the held word over a line is a cue to the tokenizer.
    expect(asItWasRead("A room.\n\n  \nShe waits.\n")).toEqual([
      "action",
      "dialogue_begin",
      "no name",
      "dialogue",
      "dialogue_end",
    ]);
  });

  /** One to four lines over a block, a two-space line among them and none that holds anything. */
  const OVER = [
    "  ",
    "  \n  ",
    "  \n  \n  ",
    "   \n  ",
    "  \n   ",
    "  \n   \n  ",
    "\n  ",
    "\t\n  \n \n  ",
    `${NO_BREAK}\n  `,
    // Two spaces beside a line separator: one line of white space, which the
    // reader's hold took the two spaces out of.
    `${SEPARATOR}  `,
    `  ${SEPARATOR}`,
    `  \n${SEPARATOR}  `,
  ];
  /** A block of every kind, each as it stands in a script. */
  const UNDER = [
    "She waits.",
    "She waits.\nShe goes.",
    "    Indented.\n\tAnd tabbed.",
    "LIGHTS UP.",
    "!LIGHTS UP.",
    "! Spaced.",
    "MARA\nHello.",
    "MARA\n(beat)\nHello.",
    "MARA (O.S.)\nHello.",
    "MARA ^\nHello.",
    "@Ivo\nHello.",
    "@Ivo [[too formal?]]\nHello.",
    "MARA\n  ",
    "MARA\n  \nAfter a pause.",
    "MARA\n~La la\n  \n~La la la",
    "~La la",
    "~La la\n~La la la",
    "(beat)\nHello.",
    "INT. ROOM - DAY",
    ".THE YARD",
    "# ACT ONE",
    "## Scene 1",
    "= She leaves.",
    "CUT TO:",
    "> FADE OUT",
    "> THE END <",
    "===",
    "[[a note]]",
    "[[a note\nof two lines]]",
    "A line [[with\n  \na note]] in it.",
    "/* cut */",
    "Time: now.",
    "Title: X",
  ];

  it("a block of every kind reads as it does with an empty line over it", () => {
    let read = 0;
    for (const over of OVER) {
      const empty = over
        .split("\n")
        .map((each) => (/^ {2}$/m.test(each) ? "" : each))
        .join("\n");
      for (const under of UNDER) {
        for (const above of ["", TITLE_PAGE, "A room.\n\n", `${TITLE_PAGE}A room.\n\n`]) {
          const source = `${above}${over}\n${under}\n\nHe goes.\n`;
          const blocks = reopened(source);
          expect(blocks).toEqual(reopened(`${above}${empty}\n${under}\n\nHe goes.\n`));
          expect(nameless(blocks)).toBe(0);
          // Lower in a script the empty lines are nothing either.
          if (above.endsWith("A room.\n\n")) {
            expect(blocks).toEqual(reopened(`${above}${under}\n\nHe goes.\n`));
          }
          expect(blocks[blocks.length - 1]).toEqual(goes);
          read++;
        }
      }
    }
    expect(read).toBe(OVER.length * UNDER.length * 4);
  });

  it("reads the line inside a block as it did", () => {
    const empty = block("dialogue", "");
    const inside: [string, BlockNode[]][] = [
      // Under a cue: a speech with no words yet
      // (docs/engineering/fountain-model.md#EDIT-175).
      ["MARA\n  \n\nHe goes.\n", [mara, empty, goes]],
      ["A room.\n\nMARA\n  \n", [room, mara, empty]],
      ["A room.\n\nMARA\n  ", [room, mara, empty]],
      ["@Ivo\n  \n\nHe goes.\n", [block("character", "Ivo"), empty, goes]],
      // In a speech, an empty line that does not end it
      // (docs/app/writing/editor-ux.md#EDIT-43).
      ["MARA\nHello.\n  \nAnd again.\n", [mara, block("dialogue", "Hello.\n\nAnd again.")]],
      ["MARA\n  \nAfter a pause.\n", [mara, block("dialogue", "\nAfter a pause.")]],
      ["MARA\n  \n  \nAfter two.\n", [mara, block("dialogue", "\n\nAfter two.")]],
      ["MARA\n(beat)\n  \n", [mara, block("parenthetical", "beat"), empty]],
      // Between two verses (docs/engineering/fountain-model.md#EDIT-183).
      [
        "MARA\n~La la\n  \n~La la la\n",
        [mara, block("lyric", "La la"), block("lyric", "La la la")],
      ],
      // In a stage direction, an empty line of it.
      ["A room.\n  \nShe waits.\n", [block("action", "A room.\n\nShe waits.")]],
      // In a note and in a boneyard it is theirs.
      [
        "[[a note\n  \nof three lines]]\n",
        [{ type: "action", content: [note("a note\n  \nof three lines")] }],
      ],
      ["A room.\n\n/* a\n\n  \nb */\n", [room, block("boneyard", " a\n\n  \nb ")]],
      // Alone in its block it was white space and is.
      ["A room.\n\n  \n\nHe goes.\n", [room, goes]],
      ["A room.\n\n  \n", [room]],
      ["  \n\nHe goes.\n", [goes]],
      ["  ", []],
    ];
    for (const [source, blocks] of inside) {
      expect(reopened(source)).toEqual(blocks);
      expect(reopened(`${TITLE_PAGE}${source}`)).toEqual(blocks);
    }
  });

  it("two or more of them alone in a block are white space, as one is", () => {
    // The first was a character with no name, and the rest a speech of empty lines.
    expect(asItWasRead("A room.\n\n  \n  \n\nHe goes.\n")).toContain("no name");
    for (const alone of ["  \n  ", "  \n  \n  ", "  \n  \n  \n  "]) {
      expect(reopened(`A room.\n\n${alone}\n\nHe goes.\n`)).toEqual([room, goes]);
      expect(reopened(`${alone}\n\nHe goes.\n`)).toEqual([goes]);
      expect(reopened(`${TITLE_PAGE}${alone}\n\nHe goes.\n`)).toEqual([goes]);
      expect(reopened(`A room.\n\n${alone}\n`)).toEqual([room]);
      expect(reopened(alone)).toEqual([]);
    }
  });

  it("is written as an empty line", () => {
    const written: [BlockNode[], string, BlockNode[]][] = [
      // A speech with no words and no cue over it, then another line of speech.
      [
        [room, block("dialogue", ""), block("dialogue", "She waits.")],
        "A room.\n\n\nShe waits.\n",
        [room, waits],
      ],
      [
        [room, block("dialogue", " \t"), block("dialogue", "She waits.")],
        "A room.\n\n\nShe waits.\n",
        [room, waits],
      ],
      // A stage direction whose first line is two spaces.
      [[room, block("action", "  \nShe waits.")], "A room.\n\n\nShe waits.\n", [room, waits]],
      [[room, block("action", "  \n  \nShe waits.")], "A room.\n\n\n\nShe waits.\n", [room, waits]],
      // A cue with no name is an empty line, and the speech under it opens the block.
      [
        [room, block("character", ""), block("dialogue", ""), block("dialogue", "She waits.")],
        "A room.\n\n\n\nShe waits.\n",
        [room, waits],
      ],
      [
        [room, block("character", ""), block("dialogue", "\nShe waits.")],
        "A room.\n\n\n\nShe waits.\n",
        [room, waits],
      ],
      // A speech in which white space ends the block: the line after opens one.
      [
        [room, block("dialogue", `a\n${NO_BREAK}\n\nb`)],
        `A room.\n\na\n${NO_BREAK}\n\nb\n`,
        [room, block("action", "a"), block("action", "b")],
      ],
      // Over a bracketed line and over a sung one.
      [
        [room, block("dialogue", ""), block("parenthetical", "beat"), hello],
        "A room.\n\n\n(beat)\nHello.\n",
        [room, block("action", "(beat)\nHello.")],
      ],
      [
        [room, block("dialogue", ""), block("lyric", "La la")],
        "A room.\n\n\n\n~La la\n",
        [room, block("lyric", "La la")],
      ],
      // Alone in its block, where it was white space to every reading.
      [[room, block("dialogue", ""), goes], "A room.\n\n\n\nHe goes.\n", [room, goes]],
      [[room, block("action", "  "), goes], "A room.\n\n\n\nHe goes.\n", [room, goes]],
      [[room, block("dialogue", "")], "A room.\n", [room]],
    ];
    for (const [blocks, lines, back] of written) {
      for (const [title, frontMatter] of [
        ["", {}],
        [TITLE_PAGE, { title: "Play" }],
      ] as [string, FrontMatter][]) {
        const source = script(frontMatter, blocks);
        expect(source).toBe(`${title}${lines}`);
        expect(reopened(source)).toEqual(back);
        // A version from before the rule reads no character with no name in it.
        expect(asItWasRead(splitTitlePage(source).body)).not.toContain("no name");
        // The line is not read back, and from there the script is at rest.
        expectRoundTripStable(serialize(parse(source)));
      }
    }
    // What was written, and how it was read.
    expect(asItWasRead("A room.\n\n  \nShe waits.\n")).toContain("no name");
    // Between two boneyards the line is the script's, and theirs are their own.
    const between = [
      block("boneyard", " one\n\n  \n"),
      block("dialogue", ""),
      block("boneyard", "\n  \ntwo "),
    ];
    expect(script({}, [room, ...between])).toBe(
      "A room.\n\n/* one\n\n  \n*/\n\n\n\n/*\n  \ntwo */\n",
    );
    expect(reopened(script({}, [room, ...between]))).toEqual([room, between[0], between[2]]);
  });

  it("and at the top of a script, where it is the first line", () => {
    const hi = block("action", "Hello there.");
    const top: [BlockNode[], string][] = [
      [[block("action", "  "), hi], "\n\nHello there.\n"],
      [[block("dialogue", ""), hi], "\n\nHello there.\n"],
      [[block("dialogue", "   "), hi], "\n\nHello there.\n"],
      [[block("dialogue", ""), block("dialogue", "She waits.")], "\nShe waits.\n"],
      [[block("action", "  \nShe waits.")], "\nShe waits.\n"],
      // With white space of another kind under it, or over it.
      [[block("action", "  "), block("action", "   "), hi], "\n\n\n\nHello there.\n"],
      [[block("action", "   "), block("action", "  "), hi], "\n\n\n\nHello there.\n"],
      [[block("action", "  \n \n  \nShe waits.")], "\n\n\nShe waits.\n"],
    ];
    for (const [blocks, lines] of top) {
      for (const [title, frontMatter] of [
        ["", {}],
        [TITLE_PAGE, { title: "Play" }],
      ] as [string, FrontMatter][]) {
        const source = script(frontMatter, blocks);
        expect(source).toBe(`${title}${lines}`);
        expect(nameless(reopened(source))).toBe(0);
        // The tokenizer, handed the script as it stands, has every block of it
        // (docs/engineering/fountain-model.md#EDIT-189).
        rules.blank_lines.lastIndex = 0;
        const kinds = Lexer.tokenizeScript(splitTitlePage(source).body).map((t) => t.type);
        rules.blank_lines.lastIndex = 0;
        expect(kinds).toEqual(["action"]);
      }
    }
  });

  it("writes the line as it did wherever a line of its block stands over it", () => {
    const sung = (t: string) => block("lyric", t);
    const kept: [BlockNode[], string][] = [
      // A cue with no speech, and one over a speech with no words
      // (docs/engineering/fountain-model.md#EDIT-175).
      [[mara], "MARA\n  \n"],
      [[mara, block("dialogue", "")], "MARA\n  \n"],
      [[room, mara, block("dialogue", ""), goes], "A room.\n\nMARA\n  \n\nHe goes.\n"],
      [[mara, block("dialogue", "\nAfter a pause.")], "MARA\n  \nAfter a pause.\n"],
      [[mara, block("dialogue", "Hello.\n\nAnd again.")], "MARA\nHello.\n  \nAnd again.\n"],
      [[mara, block("parenthetical", "beat"), block("dialogue", "")], "MARA\n(beat)\n  \n"],
      // Two verses in a speech's block
      // (docs/engineering/fountain-model.md#EDIT-183).
      [[mara, sung("La la"), sung("La la la"), hello], "MARA\n~La la\n  \n~La la la\nHello.\n"],
      // A line of speech with no cue over it, and an empty line in it.
      [[room, block("dialogue", "Hello.\n\nAnd again.")], "A room.\n\nHello.\n  \nAnd again.\n"],
      // A stage direction typed with the line in it.
      [[room, block("action", "Up.\n  \nDown.")], "A room.\n\nUp.\n  \nDown.\n"],
      // A note's own empty line, and a boneyard's own lines.
      [
        [room, { type: "action", content: [text("See "), note("one\n\ntwo")] }],
        "A room.\n\nSee [[one\n  \ntwo]]\n",
      ],
      [
        [room, { type: "action", content: [note(`one\n${NO_BREAK}\n\ntwo`)] }],
        "A room.\n\n[[one\n  \n  \ntwo]]\n",
      ],
      [[room, block("boneyard", " a\n\n  \nb ")], "A room.\n\n/* a\n\n  \nb */\n"],
      [[block("boneyard", "\n\n  \nMARA\n  \n\n"), room], "/*\n\n  \nMARA\n  \n\n*/\n\nA room.\n"],
      [
        [room, block("boneyard", " one "), block("boneyard", "\n  \ntwo ")],
        "A room.\n\n/* one */\n\n/*\n  \ntwo */\n",
      ],
    ];
    for (const [blocks, lines] of kept) {
      for (const [title, frontMatter] of [
        ["", {}],
        [TITLE_PAGE, { title: "Play" }],
      ] as [string, FrontMatter][]) {
        expect(script(frontMatter, blocks)).toBe(`${title}${lines}`);
      }
    }
    // The sample play holds no such line, and is the bytes it was.
    expect(serialize(parse(sampleText))).toBe(sampleText);
  });

  it("a first speech with no words over a line like a title page's key is a stage direction", () => {
    // The first-line mark goes on the line a reader would take for a title
    // page (docs/engineering/fountain-model.md#EDIT-184). Behind two spaces
    // the pair was a character with no name over a speech reading `!Title: X`.
    const key = block("action", "Title: X");
    for (const first of [" ", "", "  "]) {
      const source = script({}, [block("dialogue", first), block("dialogue", "Title: X")]);
      expect(source).toBe("\n!Title: X\n");
      expect(reopened(source)).toEqual([key]);
      expect(serialize(parse(source))).toBe("!Title: X\n");
      expectRoundTripStable("!Title: X\n");
    }
    // A script written before the rule holds the two spaces.
    const before = parse("  \n!Title: X\n");
    expect(before.frontMatter).toEqual({});
    expect(before.doc.content).toEqual([key]);
    expect(reopened("  \nTitle: X\n")).toEqual([key]);
    // Under a title page the tokenizer alone is asked, and it knows the key.
    const under = script({ title: "Play" }, [block("dialogue", ""), block("dialogue", "Title: X")]);
    expect(under).toBe(`${TITLE_PAGE}\n!Title: X\n`);
    expect(parse(under)).toEqual({
      frontMatter: { title: "Play" },
      doc: { type: "doc", content: [key] },
    });
  });

  it("a sweep: no generated script reads a character with no name, and each reads as it does with the lines empty", () => {
    const roll = dice(190);
    const white = ["", "", "", "  ", "  ", "  ", " ", "   ", "\t"];
    const lines = [
      ...["She waits.", "He goes out.", "MARA", "IVO", "MARA (O.S.)", "@Ivo", "(beat)", "Hello."],
      ...["~La la", "INT. ROOM - DAY", ".THE YARD", "# ACT ONE", "= She leaves.", "CUT TO:"],
      ...[
        "> THE END <",
        "===",
        "[[a note]]",
        "!LIGHTS UP.",
        "! Spaced.",
        "    Indented.",
        "Time: now.",
      ],
    ];
    let opened = 0;
    let inside = 0;
    for (let i = 0; i < 4000; i++) {
      const parts: string[] = [];
      for (let n = roll([0, 0, 1, 2]); n > 0; n--) parts.push(roll(white));
      for (let n = roll([1, 2, 3, 4, 5, 6]); n > 0; n--) {
        parts.push(roll(lines));
        for (let k = roll([0, 0, 1, 1, 2, 3]); k > 0; k--) parts.push(roll(white));
      }
      const source = `${roll(["", "", TITLE_PAGE])}${parts.join("\n")}\n`;
      const empty = withNoneOver(source);
      if (empty !== source) opened++;
      if (/^ {2}$/m.test(empty)) inside++;
      const read = parse(source);
      expect(nameless(read.doc.content)).toBe(0);
      expect(read).toEqual(parse(empty));
      expect(reopened(source)).toEqual(read.doc.content);
      // What is saved holds no such line, for a version from before the rule
      // or for this one.
      const saved = serialize(read);
      expect(withNoneOver(saved)).toBe(saved);
      expect(asItWasRead(splitTitlePage(saved).body)).not.toContain("no name");
    }
    // The sweep holds the line where it opens a block and where it stands in one.
    expect(opened).toBeGreaterThan(1500);
    expect(inside).toBeGreaterThan(1000);
  });

  it("holds for generated models: none is written with the line over a block", () => {
    const roll = dice(1900);
    const kinds: BlockType[] = [
      ...(["action", "action", "action", "character", "dialogue", "dialogue", "dialogue"] as const),
      ...([
        "parenthetical",
        "lyric",
        "transition",
        "centered",
        "sceneHeading",
        "scene",
        "act",
      ] as const),
      ...(["synopsis", "pageBreak"] as const),
    ];
    const words = [
      ...["", "", " ", "  ", "  ", "   ", "\t", NO_BREAK, " \n ", "  \n  "],
      ...["She waits.", "Hello.", "MARA", "IVO", "Title: X", "Time: now.", "LIGHTS UP.", "La la"],
      ...["  \nShe waits.", "  \nMARA\nHello.", "\nShe waits.", " \nShe waits.", "  \n  \nUnder."],
      ...[
        "Up.\n  \nDown.",
        "Up.\n\nDown.",
        "Up.\n \n  \nDown.",
        `a\n${NO_BREAK}\n\nb`,
        "x\n",
        "x\n  ",
      ],
      ...["  \n.HEAD", "  \n# act", "  \n! bang", "INT. ROOM", "FADE", "(beat)"],
    ];
    let changed = 0;
    for (let i = 0; i < 3000; i++) {
      const content: BlockNode[] = [];
      for (let n = roll([1, 2, 3, 4, 5]); n > 0; n--) {
        const type = roll(kinds);
        content.push(type === "pageBreak" ? { type } : block(type, roll(words)));
      }
      const frontMatter: FrontMatter = roll([{}, {}, { title: "Play" }]);
      const source = script(frontMatter, content);
      // No note or boneyard in these models, so the lines are the script's.
      expect(withNoneOver(source)).toBe(source);
      const body = splitTitlePage(source).body;
      expect(asItWasRead(body).filter((kind) => kind === "no name")).toEqual([]);
      const read = reopened(source);
      // A cue with no name is read only from a forcing mark with none after
      // it, which is another line's rule.
      if (nameless(read)) expect(body).toMatch(/^[^\S\n]*@[^\S\n]*(?:\(.*\))?[^\S\n]*$/m);
      if (
        content.some((b) =>
          /^ {2}$/m.test(b.content?.map((n) => (n.type === "text" ? n.text : "")).join("") ?? ""),
        )
      ) {
        changed++;
      }
    }
    expect(changed).toBeGreaterThan(1000);
  });
});

it("keeps freely written opening pages and their formatting across a script save", () => {
  const parsed = parse("Title: My Play\n\n# ACT ONE\n\n## Scene 1\n\nA room.\n");
  parsed.frontMatter = {
    ...parsed.frontMatter,
    titlePage: "# Title\n\nBy me\n",
    charactersPage: "**A**\n\nA person, with a colon: and a slash \\",
    openingNotes: "<!-- proscenium:align=right -->\n\n# Time & place\n\nAnywhere.\n\nAny time.",
    openingNotesBeforeCharacters: true,
  };
  const source = serialize(parsed);
  const again = parse(source);
  expect(again.frontMatter).toEqual(parsed.frontMatter);
  expect(serialize(again)).toBe(source);
  expect(again.doc).toEqual(parsed.doc);
});

it("retains an empty speech and its cue on every reopen, including retained practice", () => {
  for (const cue of ["IVO", "@Ivo", "IVO (O.S.)"]) {
    const source = `## SCENE 1\n\nMARA\nA line.\n\n${cue}\n  \n`;
    const expected = parse(source);
    expect(expected.doc.content.map((b) => b.type)).toEqual([
      "scene",
      "character",
      "dialogue",
      "character",
      "dialogue",
    ]);
    expect(expected.doc.content[expected.doc.content.length - 1]?.content).toEqual([]);
    for (let attempt = 0; attempt < 12; attempt++) {
      expect(parse(source)).toEqual(expected);
      expect(parse(serialize(expected))).toEqual(expected);
    }
  }
  expect(parse("  \n\nA room.\n").doc.content).toEqual([
    { type: "action", content: [{ type: "text", text: "A room." }] },
  ]);
  const literal = "MARA\nThe mark EMPTY-SPEECH stays.\n  \nAnd so does this.\n";
  expectRoundTripStable(literal);
  expect(serialize(parse(literal))).toContain("EMPTY-SPEECH");
});
