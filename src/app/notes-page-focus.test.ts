// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { builtinFormats } from "../format";
import { paginateFrontMatter } from "../layout";
import { toDoc } from "../markdown/doc";
import { notesBlock, openingNotesText, printsProse } from "./FrontPageEditor";

const spec = builtinFormats().find((s) => s.id === "dg-modern")!;

/**
 * A double-click on a notes page in page view opens Opening Pages with the
 * caret in the block that printed the line hit
 * (docs/app/formatting/formats-and-layout.md#FMT-161). The printed page's
 * paragraph ids come from the engine; the blocks are the editor's document,
 * which is the same Markdown read by the same reader.
 */
describe("a printed line of a notes page finds its block in the editor", () => {
  const notes =
    "## Casting\n\nSix actors play every role.\n\n- A slash (/) marks an overlap.\n- Brackets mark what is not said.\n\nPlayed without an interval.";

  it("production notes: each printed paragraph, its heading and a click between lines", () => {
    const fm = { productionNotes: notes };
    const lines = paginateFrontMatter(fm, spec).flatMap((page) => page.lines);
    const blocks = toDoc(notes).content ?? [];
    const hit = (text: string) =>
      notesBlock("production", lines.find((l) => l.text === text)!.paragraphId, notes, fm);
    expect(blocks[hit("Casting")].type).toBe("heading");
    expect(hit("Six actors play every role.")).toBe(1);
    // Both items of the list are its block.
    expect(hit("• A slash (/) marks an overlap.")).toBe(2);
    expect(hit("• Brackets mark what is not said.")).toBe(2);
    expect(blocks[2].type).toBe("bulletList");
    expect(hit("Played without an interval.")).toBe(3);
    // The page's own heading, a click between lines, and an id of the other page: the top.
    expect(hit("PRODUCTION NOTES")).toBe(0);
    expect(notesBlock("production", null, notes, fm)).toBe(0);
    expect(notesBlock("production", "setting-prose-3", notes, fm)).toBe(0);
    // A paragraph past the end of the text, as a stale page could name, is the top too.
    expect(notesBlock("production", "production-prose-40", notes, fm)).toBe(0);
  });

  it("opening notes written as prose", () => {
    const fm = { openingNotes: "For my mother.\n\n## Time\n\nThe last night of winter." };
    const text = openingNotesText(fm);
    const lines = paginateFrontMatter(fm, spec).flatMap((page) => page.lines);
    const at = (t: string) => lines.find((l) => l.text === t)!.paragraphId;
    expect(notesBlock("setting", at("For my mother."), text, fm)).toBe(0);
    expect(notesBlock("setting", at("Time"), text, fm)).toBe(1);
    expect(notesBlock("setting", at("The last night of winter."), text, fm)).toBe(2);
  });

  it("opening notes still printed from the Setting, Time and Place fields", () => {
    // No Setting: the editor opens on Time's heading and text, then Place's.
    const fm = { time: "Winter.", place: "A kitchen.\nAnd the yard." };
    const text = openingNotesText(fm);
    const blocks = toDoc(text).content ?? [];
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "heading", "paragraph"]);
    const lines = paginateFrontMatter(fm, spec).flatMap((page) => page.lines);
    const at = (t: string) => lines.find((l) => l.text === t)!.paragraphId;
    expect(notesBlock("setting", at("TIME"), text, fm)).toBe(0);
    expect(notesBlock("setting", at("Winter."), text, fm)).toBe(1);
    expect(notesBlock("setting", at("PLACE"), text, fm)).toBe(2);
    expect(notesBlock("setting", at("And the yard."), text, fm)).toBe(3);
  });
});

describe("notes with no word to print are no page", () => {
  it("is false for nothing, white space and empty paragraphs, true for a word", () => {
    for (const markdown of [undefined, "", "   ", "\n\n\n", "  \n\n \n"])
      expect(printsProse(markdown)).toBe(false);
    for (const markdown of ["x", "## Casting", "- an item", "**Bold.**"])
      expect(printsProse(markdown)).toBe(true);
  });
});
