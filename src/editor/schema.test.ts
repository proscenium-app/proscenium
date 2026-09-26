// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { playExtensions } from "./schema";
import { parse, serialize } from "../fountain";
import type { Doc } from "../fountain";

// Headless ProseMirror schema — no DOM needed (getSchema builds it from the
// extension definitions). This is the contract between the editor and the
// Fountain engine: the schema must accept everything the parser emits.
const schema = getSchema(playExtensions);

function throughSchema(doc: Doc): Doc {
  // nodeFromJSON throws if a node type, attr, or mark is unknown, or if content
  // violates the schema — so this alone proves the schema accepts the doc.
  return schema.nodeFromJSON(doc).toJSON() as Doc;
}

const SAMPLE = join(
  import.meta.dir,
  "../../sample-vault/The Weight of Water/The Weight of Water.fountain",
);

// One document exercising every node type and all three marks.
const ALL_ELEMENTS = [
  "# ACT ONE",
  "",
  "## SCENE 1",
  "",
  "### A beat",
  "",
  "INT. KITCHEN - NIGHT #1A#",
  "",
  "= The leak begins.",
  "",
  "She enters [[beat]] and *waits*, then **freezes**, then _listens_.",
  "",
  "MARA (O.S.)",
  "Hello?",
  "",
  "JONAH ^",
  "(softly)",
  "Hi.",
  "",
  "~la la la",
  "",
  "> CUT TO:",
  "",
  "> THE END <",
  "",
  "/* a cut line */",
  "",
  "===",
].join("\n");

describe("editor schema ↔ fountain model", () => {
  it("accepts the sample doc and serializes identically through the schema", () => {
    const { frontMatter, doc } = parse(readFileSync(SAMPLE, "utf8"));
    const back = throughSchema(doc);
    expect(serialize({ frontMatter, doc: back })).toBe(serialize({ frontMatter, doc }));
  });

  it("accepts every node type and mark without dropping content", () => {
    const { frontMatter, doc } = parse(ALL_ELEMENTS);
    const back = throughSchema(doc);

    const types = (d: Doc) => d.content.map((b) => b.type);
    expect(types(back)).toEqual(types(doc));

    // Every schema node type our parser can emit is present here.
    const present = new Set<string>(types(doc));
    for (const t of [
      "act",
      "scene",
      "sceneHeading",
      "action",
      "character",
      "parenthetical",
      "dialogue",
      "transition",
      "lyric",
      "centered",
      "synopsis",
      "pageBreak",
      "boneyard",
    ]) {
      expect(present.has(t)).toBe(true);
    }

    // Serialization survives the round-trip through the editor schema.
    expect(serialize({ frontMatter, doc: back })).toBe(serialize({ frontMatter, doc }));
  });

  it("carries scene number, character extension, and dual attrs", () => {
    const { doc } = parse(ALL_ELEMENTS);
    const back = throughSchema(doc);
    const heading = back.content.find((b) => b.type === "sceneHeading");
    expect(heading?.attrs?.sceneNumber).toBe("1A");
    const chars = back.content.filter((b) => b.type === "character");
    expect(chars[0].attrs?.extension).toBe("(O.S.)");
    expect(chars[1].attrs?.dual).toBe(true);
  });

  it("preserves the boneyard text node through the schema", () => {
    const { doc } = parse("Visible.\n\n/* hidden */\n\nEnd.");
    const back = throughSchema(doc);
    const bone = back.content.find((b) => b.type === "boneyard");
    expect(bone?.content?.[0]).toEqual({ type: "text", text: " hidden " });
  });

  /**
   * ProseMirror reaches for the document's default block type whenever it needs
   * a block nobody named — every paragraph after the first in a plain-text
   * paste, `clearNodes`, lifting an empty block. That type is simply the first
   * one the content expression allows, i.e. registration order.
   *
   * With `Act` registered first, pasting three paragraphs of stage directions
   * made ACT HEADINGS of two of them, and auto-caps (which uppercases acts) then
   * destroyed the writer's own casing. A stage direction is what an unlabelled
   * block should be, so Action leads the block list.
   */
  it("defaults an unnamed block to action, not act", () => {
    expect(schema.nodes.doc.contentMatch.defaultType?.name).toBe("action");
  });
});
