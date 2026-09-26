// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "./parse";
import { serialize } from "./serialize";
import { extractScenes } from "./scenes";
import type { BlockNode } from "./model";

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
