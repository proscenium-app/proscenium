// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page before the script edited where it stands
 * (docs/app/formatting/formats-and-layout.md#FMT-165): the text each page's
 * editor opens on, and what its edits write into the front matter.
 */
import { describe, expect, it } from "bun:test";
import { builtinFormats } from "../format";
import type { FrontMatter } from "../fountain";
import { paginateFrontMatter } from "../layout";
import { toDoc } from "../markdown/doc";
import { blockAt, frontPagePatch, frontPageText } from "./FrontSheetEditor";

/**
 * A double-click on the Characters sheet opens its editor at the block that
 * printed the line hit (docs/app/formatting/formats-and-layout.md#FMT-165).
 * The engine names an edited page's lines by their place among its printed
 * paragraphs, and a list prints one per item: a line under a list used to
 * open the editor as many blocks further down as the list had items, less one.
 */
describe("a double-click on the Characters page finds its block", () => {
  const spec = builtinFormats().find((s) => s.id === "dg-modern")!;
  const written =
    "# Characters\n\n**MARA** — a hydrologist, 40s\n\n**JONAH** — her brother, 30s\n\n" +
    "- MARA doubles as the neighbour.\n- JONAH is heard offstage.\n\n" +
    "Any role may be played by an actor of any race.\n\nNinety minutes, without an interval.";

  it("on a page the writer edited, below a list as above it", () => {
    const fm: FrontMatter = { charactersPage: written };
    const lines = paginateFrontMatter(fm, spec).flatMap((page) => page.lines);
    const blocks = toDoc(written).content ?? [];
    const hit = (start: string) =>
      blockAt("characters", lines.find((l) => l.text.startsWith(start))!.paragraphId, written, fm);
    expect(blocks[hit("Characters")].type).toBe("heading");
    expect(hit("MARA —")).toBe(1);
    expect(hit("JONAH —")).toBe(2);
    expect(blocks[3].type).toBe("bulletList");
    expect(hit("• MARA doubles")).toBe(3);
    expect(hit("• JONAH is heard")).toBe(3);
    expect(hit("Any role")).toBe(4);
    expect(hit("Ninety minutes")).toBe(5);
    // A click between lines, or an id this page never printed: the top.
    expect(blockAt("characters", null, written, fm)).toBe(0);
    expect(blockAt("characters", "characters-prose-40", written, fm)).toBe(0);
  });

  it("on a page made from the cast list: its heading, then a line each", () => {
    const fm: FrontMatter = {
      characters: [
        { name: "MARA", description: "a hydrologist, 40s" },
        { name: "JONAH", description: "her brother, 30s" },
      ],
    };
    const text = frontPageText("characters", fm);
    expect(blockAt("characters", "cast-0", text, fm)).toBe(1);
    expect(blockAt("characters", "cast-1", text, fm)).toBe(2);
    expect(blockAt("characters", "characters-heading", text, fm)).toBe(0);
  });
});

const fm: FrontMatter = {
  characters: [
    { name: "MARA", description: "a hydrologist, 40s" },
    { name: "JONAH", description: "her brother, 30s" },
  ],
  setting: "A kitchen.",
  productionNotes: "Six actors play every role.",
};

describe("a page edited on the page", () => {
  it("opens on the page as it prints", () => {
    expect(frontPageText("characters", fm)).toContain("**MARA** — a hydrologist, 40s");
    expect(frontPageText("characters", { ...fm, charactersPage: "My own page" })).toBe(
      "My own page",
    );
    expect(frontPageText("setting", fm)).toContain("A kitchen.");
    expect(frontPageText("production", fm)).toBe("Six actors play every role.");
    expect(frontPageText("production", {})).toBe("");
  });

  it("writes the Characters page as the writer's own", () => {
    expect(frontPagePatch("characters", "Mine")).toEqual({ charactersPage: "Mine" });
  });

  it("writes the opening notes, and drops the old fields that seeded them", () => {
    expect(frontPagePatch("setting", "## Setting\n\nA kitchen.")).toEqual({
      openingNotes: "## Setting\n\nA kitchen.",
      setting: undefined,
      time: undefined,
      place: undefined,
    });
  });

  it("keeps no production notes with no word to print", () => {
    expect(frontPagePatch("production", "Doubling.")).toEqual({ productionNotes: "Doubling." });
    expect(frontPagePatch("production", "  \n")).toEqual({ productionNotes: undefined });
  });
});
