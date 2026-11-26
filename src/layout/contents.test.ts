// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A play's contents (src/layout/contents.ts,
 * docs/app/formatting/formats-and-layout.md#FMT-179): its acts and scenes,
 * each with the page it starts on, as rows of text every writer of a page
 * prints the same.
 */
import { describe, expect, it } from "bun:test";
import { parse, serialize } from "../fountain";
import type { Doc, FrontMatter } from "../fountain";
import { loadFormatRegistry } from "../format";
import {
  contentsEntries,
  contentsFor,
  contentsLines,
  contentsWidth,
  listsContents,
} from "./contents";
import { blocksFromDoc, layoutFrontPages, paginate } from "./engine";
import { fieldValue, frontPagesFor, writePageFile } from "./page-files";
import { scaffoldById } from "./scaffolds";
import { scenePageMap } from "./scene-pages";
import { buildDocument } from "../wordproc";
import { fountainWithPages } from "./fountain-with-pages";

const registry = await loadFormatRegistry();
const dg = registry.get("dg-modern")!;
const sketch = registry.get("sketch-comedy")!;

/** A script of acts, each with scenes of so many speeches. */
function script(acts: { act: string; scenes: [string, number][] }[]): Doc {
  const content: Doc["content"] = [];
  for (const a of acts) {
    if (a.act) content.push({ type: "act", content: [{ type: "text", text: a.act }] });
    for (const [name, lines] of a.scenes) {
      content.push({ type: "scene", content: [{ type: "text", text: name }] });
      for (let l = 0; l < lines; l++) {
        content.push({ type: "character", content: [{ type: "text", text: "MARA" }] });
        content.push({ type: "dialogue", content: [{ type: "text", text: `Line ${l}.` }] });
      }
    }
  }
  return { type: "doc", content };
}

const two = script([
  {
    act: "ACT ONE",
    scenes: [
      ["Scene 1", 30],
      ["Scene 2: The Kitchen", 30],
    ],
  },
  { act: "ACT TWO", scenes: [["Scene 1", 12]] },
]);

describe("a play's contents", () => {
  it("lists every act and scene in order, a scene two cells in under its act", () => {
    const entries = contentsEntries(blocksFromDoc(two, dg));
    expect(entries.map((e) => [e.level, e.act])).toEqual([
      [0, true],
      [1, false],
      [1, false],
      [0, true],
      [1, false],
    ]);
    // Named as the format prints them: a scene the writer named keeps its name.
    expect(entries[2]?.label.toUpperCase()).toContain("THE KITCHEN");
  });

  it("gives each the page its heading is on, as the Outline counts them", () => {
    const lines = contentsFor(two, dg);
    const pages = scenePageMap(two, dg);
    const numbered = lines.filter(Boolean);
    expect(numbered).toHaveLength(5);
    const pageOf = (line: string) => Number(/ (\d+)$/.exec(line)?.[1]);
    expect(pageOf(numbered[1]!)).toBe(pages.scenes[0]!.firstPage);
    expect(pageOf(numbered[2]!)).toBe(pages.scenes[1]!.firstPage);
    expect(pageOf(numbered[4]!)).toBe(pages.scenes[2]!.firstPage);
    // An act is on the page its own heading is on.
    expect(pageOf(numbered[0]!)).toBe(1);
    expect(pageOf(numbered[3]!)).toBe(pages.scenes[2]!.firstPage);
    expect(pageOf(numbered[4]!)).toBeGreaterThan(1);
  });

  it("sets every row to one width, two cells short of the text block, its dots under one another", () => {
    const width = contentsWidth(dg);
    expect(width).toBe(58);
    const lines = contentsFor(two, dg).filter(Boolean);
    for (const line of lines) expect(line).toHaveLength(width);
    // Leader dots stand on the same cells in every row.
    const dots = (line: string) => [...line].flatMap((c, i) => (c === "." ? [i % 2] : []));
    expect(new Set(lines.flatMap(dots)).size).toBe(1);
    // A name is never run into its dots, nor the dots into the page.
    for (const line of lines) expect(line).toMatch(/\S (?:\. | )+\d+$/);
    expect(lines[1]).toMatch(/^ {2}\S/);
  });

  it("parts one act from the next with a blank row", () => {
    expect(contentsFor(two, dg).map((l) => (l ? "row" : ""))).toEqual([
      "row",
      "row",
      "row",
      "",
      "row",
      "row",
    ]);
  });

  it("runs a long name on to a second line, which carries the page", () => {
    const long = script([
      {
        act: "",
        scenes: [
          ["Scene 1: In which the water comes up through the floor of the kitchen at night", 2],
        ],
      },
    ]);
    const lines = contentsFor(long, dg);
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toMatch(/\d$/);
    expect(lines[1]).toMatch(/^ {2}\S.* 1$/);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(contentsWidth(dg));
  });

  it("lists a play with no acts as its scenes alone, and a script with neither as nothing", () => {
    const flat = script([
      {
        act: "",
        scenes: [
          ["Scene 1", 2],
          ["Scene 2", 2],
        ],
      },
    ]);
    expect(contentsFor(flat, dg).every((line) => /^\S/.test(line))).toBe(true);
    const none: Doc = {
      type: "doc",
      content: [{ type: "action", content: [{ type: "text", text: "A room." }] }],
    };
    expect(contentsFor(none, dg)).toEqual([]);
    expect(contentsFor(null, dg)).toEqual([]);
  });

  it("is the rows without their pages while the script is paginated: as many lines either way", () => {
    const entries = contentsEntries(blocksFromDoc(two, dg));
    const bare = contentsLines(entries, () => null, contentsWidth(dg));
    expect(bare).toHaveLength(contentsFor(two, dg).length);
    expect(bare.join("\n")).not.toContain(" . ");
  });
});

describe("a page that lists the contents", () => {
  const page = scaffoldById("contents")!.text({ speakers: [] });
  const fm = (contents: string[]): FrontMatter => ({
    title: "Water",
    contents,
    pages: [{ id: "c", name: "Contents", text: page }],
  });

  it("prints a line for each row, a blank row where the contents have one", () => {
    const lines = contentsFor(two, dg);
    const [sheet] = layoutFrontPages(frontPagesFor(fm(lines), dg.frontMatter), dg);
    const printed = sheet!.lines.map((l) => l.text);
    expect(printed).toEqual(["CONTENTS", ...lines.filter(Boolean)]);
    // The second act stands a row further down than a scene would.
    const rows = sheet!.lines.map((l) => l.row);
    expect(rows[4]! - rows[3]!).toBe(rows[3]! - rows[2]! + 1);
    expect(fieldValue("contents", fm(lines))).toBe(lines.join("\n"));
  });

  it("prints its heading alone for a script with no act or scene", () => {
    const [sheet] = layoutFrontPages(frontPagesFor(fm([]), dg.frontMatter), dg);
    expect(sheet!.lines.map((l) => l.text)).toEqual(["CONTENTS"]);
  });

  it("is worth working out only for a play with such a page", () => {
    expect(listsContents([{ text: page }])).toBe(true);
    expect(listsContents([{ text: writePageFile({ layout: "top" }, "Words.") }])).toBe(false);
    expect(listsContents(undefined)).toBe(false);
  });

  it("gives the pages of a script whose opening runs in with them, the contents among it", () => {
    // The sketch format sets every page before the script on the first
    // numbered page, so the contents move the script they number.
    const meta = { frontMatter: fm([]) };
    const lines = contentsFor(two, sketch, meta);
    const withThem = { frontMatter: fm(lines) };
    const layout = paginate(blocksFromDoc(two, sketch), sketch, withThem);
    const entries = contentsEntries(blocksFromDoc(two, sketch));
    const firstOn = new Map<number, number>();
    for (const p of layout.pages)
      for (const l of p.lines)
        if (!firstOn.has(l.sourceIndex)) firstOn.set(l.sourceIndex, p.pageNumber);
    expect(lines).toEqual(
      contentsLines(entries, (e) => firstOn.get(e.index) ?? null, contentsWidth(sketch)),
    );
  });

  it("is never written to the script's title page", () => {
    const parsed = parse("Title: Water\n\n# ACT ONE\n\n## Scene 1\n\nMARA\nHello.\n");
    const out = serialize({
      ...parsed,
      frontMatter: { ...parsed.frontMatter, contents: ["ACT ONE . . 1"] },
    });
    expect(out).not.toContain("ACT ONE . .");
    expect(out).not.toMatch(/contents/i);
  });

  it("goes out in a word processor's file and a Fountain file as the same rows", () => {
    const lines = contentsFor(two, dg);
    const frontMatter = fm(lines);
    const model = buildDocument({
      doc: two,
      spec: dg,
      meta: { title: "Water", author: "", frontMatter },
      language: "en-US",
    });
    const written = JSON.stringify(model);
    for (const row of lines.filter(Boolean))
      expect(written).toContain(JSON.stringify(row).slice(1, -1));
    const fountain = fountainWithPages({ frontMatter, doc: two }, frontMatter.pages ?? [], []);
    expect(fountain).toContain(lines[0]!);
    expect(fountain).toContain(lines[lines.length - 1]!.trim());
  });
});
