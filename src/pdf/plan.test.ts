// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { builtinFormats } from "../format";

import { paginateFrontMatter, type FrontMatterPage, type LayoutPage, type LayoutResult, type StyleRun } from "../layout";
import {
  defaultFrontSheets,
  formatPageRange,
  frontKindsOf,
  frontSheetsFor,
  pageRangeLabel,
  pagerText,
  parsePageRange,
  planSheets,
  resolveFocus,
  selectFrontMatter,
  selectPages,
  styleSegments,
} from "./plan";

function layoutOf(count: number): LayoutResult {
  const pages: LayoutPage[] = Array.from({ length: count }, (_, i) => ({
    pageNumber: i + 1,
    header: i === 0 ? null : { right: `${i + 1}.` },
    footer: null,
    lines: [],
    usedRows: 0,
    fillRows: 0,
  }));
  return { pages, maxRows: 55 };
}

describe("parsePageRange", () => {
  it("reads the whole script from an empty field", () => {
    expect(parsePageRange("", 4)).toEqual({ pages: [1, 2, 3, 4], all: true, error: null });
    expect(parsePageRange("  ", 2).all).toBe(true);
    expect(parsePageRange("All", 2).all).toBe(true);
  });

  it("reads singles, ranges, and a mix of separators", () => {
    expect(parsePageRange("1-3, 8", 10).pages).toEqual([1, 2, 3, 8]);
    expect(parsePageRange("2 4  7", 10).pages).toEqual([2, 4, 7]);
    expect(parsePageRange("5", 10).pages).toEqual([5]);
  });

  it("takes an open end as 'to the last page', and an open start as 'from the first'", () => {
    expect(parsePageRange("8-", 10).pages).toEqual([8, 9, 10]);
    expect(parsePageRange("-3", 10).pages).toEqual([1, 2, 3]);
  });

  it("accepts the dashes a writer's keyboard actually produces", () => {
    expect(parsePageRange("2–4", 10).pages).toEqual([2, 3, 4]); // en dash
    expect(parsePageRange("2—4", 10).pages).toEqual([2, 3, 4]); // em dash
  });

  it("normalises reversed ranges, duplicates, and order", () => {
    expect(parsePageRange("5-3", 10).pages).toEqual([3, 4, 5]);
    expect(parsePageRange("7, 2, 7", 10).pages).toEqual([2, 7]);
  });

  it("flags a page the script does not have rather than clamping it", () => {
    const over = parsePageRange("8-12", 10);
    expect(over.pages).toEqual([]);
    expect(over.error).toContain("no page 12");
    expect(parsePageRange("0", 10).error).toBe("Pages start at 1.");
    expect(parsePageRange("2, banana", 10).error).toContain("banana");
  });

  it("says so when there is nothing to export", () => {
    expect(parsePageRange("", 0).error).toContain("no pages");
  });

  it("marks a selection that happens to name every page as 'all'", () => {
    expect(parsePageRange("1-4", 4).all).toBe(true);
    expect(parsePageRange("1-3", 4).all).toBe(false);
  });
});

describe("formatPageRange", () => {
  it("collapses runs and leaves singles alone", () => {
    expect(formatPageRange([1, 2, 3, 8, 11, 12, 13], 20)).toBe("1-3, 8, 11-13");
    expect(formatPageRange([4], 20)).toBe("4");
  });

  it("spells 'every page' as the empty field, so the dialog returns to rest", () => {
    expect(formatPageRange([1, 2, 3], 3)).toBe("");
    expect(formatPageRange([], 3)).toBe("");
  });

  it("round-trips through the parser", () => {
    const pages = parsePageRange("11-13, 2", 20).pages;
    expect(parsePageRange(formatPageRange(pages, 20), 20).pages).toEqual(pages);
  });

  it("labels a slice for a file name", () => {
    expect(pageRangeLabel([12, 13, 14])).toBe("pages 12-14");
    expect(pageRangeLabel([7])).toBe("page 7");
    expect(pageRangeLabel([2, 1, 9])).toBe("pages 1-2,9");
    expect(pageRangeLabel([])).toBe("");
  });
});

describe("selectPages", () => {
  it("keeps the chosen pages, with their own numbering", () => {
    const out = selectPages(layoutOf(10), [3, 4, 5]);
    expect(out.pages.map((p) => p.pageNumber)).toEqual([3, 4, 5]);
    expect(out.pages[0].header).toEqual({ right: "3." });
    expect(out.maxRows).toBe(55);
  });

  it("passes the layout straight through when nothing is selected", () => {
    const full = layoutOf(3);
    expect(selectPages(full, null)).toBe(full);
  });
});

describe("frontSheetsFor", () => {
  const spec = builtinFormats()[0];
  it("lists the sheets the renderer will draw, in stage order", () => {
    expect(
      frontSheetsFor({
        title: "Tideline",
        characters: [{ name: "Mara" }],
        setting: "A kitchen.",
      }, spec),
    ).toEqual(["title", "characters", "setting"]);
    expect(frontSheetsFor({ title: "Tideline" }, spec)).toEqual(["title"]);
    expect(frontSheetsFor({ title: "Tideline", time: "Winter." }, spec)).toEqual(["title", "setting"]);
    expect(frontSheetsFor(null, spec)).toEqual([]);
  });
});

describe("front sheet choice", () => {
  const spec = builtinFormats()[0];
  const cast = Array.from({ length: 40 }, (_, i) => ({ name: `Actor ${i + 1}`, description: "a person in this play" }));
  const long = paginateFrontMatter({ title: "Tideline", characters: cast, setting: "A kitchen." }, spec);

  it("names each kind once, however many sheets it runs to", () => {
    expect(long.filter((page) => page.kind === "characters").length).toBeGreaterThan(1);
    expect(frontKindsOf(long)).toEqual(["title", "characters", "setting"]);
    expect(frontKindsOf([])).toEqual([]);
  });

  it("keeps every sheet of a chosen kind, in stage order, and all of them when nobody chose", () => {
    const castOnly = selectFrontMatter(long, ["characters"]);
    expect(castOnly.length).toBe(long.filter((page) => page.kind === "characters").length);
    expect(castOnly.every((page) => page.kind === "characters")).toBe(true);
    // The order is the play's, not the order the ticks were given in.
    expect(frontKindsOf(selectFrontMatter(long, ["setting", "title"]))).toEqual(["title", "setting"]);
    expect(selectFrontMatter(long, null)).toEqual(long);
    expect(selectFrontMatter(long, [])).toEqual([]);
  });

  it("starts a script from page 1 with every sheet, and an excerpt or sides with none", () => {
    const all = ["title", "characters"] as const;
    expect(defaultFrontSheets(all, { sides: false, startsAtPageOne: true })).toEqual(["title", "characters"]);
    expect(defaultFrontSheets(all, { sides: false, startsAtPageOne: false })).toEqual([]);
    expect(defaultFrontSheets(all, { sides: true, startsAtPageOne: true })).toEqual([]);
  });
});

describe("planSheets", () => {
  const front: FrontMatterPage[] = [
    { kind: "title", lines: [] },
    { kind: "characters", lines: [] },
    { kind: "characters", lines: [] },
  ];

  it("lays the file out as front sheets then pages, and chooses only what is going", () => {
    const plan = planSheets({ front, layout: layoutOf(20), frontKinds: ["title"], pages: [12, 13] });
    expect(plan.all.map((s) => s.key)).toEqual([
      "front-0", "front-1", "front-2",
      ...Array.from({ length: 20 }, (_, i) => `page-${i + 1}`),
    ]);
    expect(plan.chosen.map((s) => s.label)).toEqual(["Title page", "Page 12", "Page 13"]);
    expect(plan.all.map((s) => s.order)).toEqual(plan.all.map((_, i) => i));
  });

  it("numbers a kind's sheets only when it runs to more than one", () => {
    const plan = planSheets({ front, layout: layoutOf(1), frontKinds: ["title", "characters"], pages: [1] });
    expect(plan.chosen.map((s) => [s.label, s.short])).toEqual([
      ["Title page", "Title"],
      ["Characters page 1", "Characters 1"],
      ["Characters page 2", "Characters 2"],
      ["Page 1", "1"],
    ]);
  });

  it("chooses nothing — front sheets included — while the range can't be read", () => {
    const plan = planSheets({ front, layout: layoutOf(3), frontKinds: ["title"], pages: null });
    expect(plan.all.length).toBe(6);
    expect(plan.chosen).toEqual([]);
  });
});

describe("pagerText", () => {
  const plan = (frontKinds: ("title" | "characters")[], pages: number[], total = 10) =>
    planSheets({ front: [{ kind: "title", lines: [] }], layout: layoutOf(total), frontKinds, pages }).chosen;

  it("reads as the plain page count while the file is the script from page 1", () => {
    expect(pagerText(plan([], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 6)).toBe("Page 7 of 10");
    expect(pagerText(plan([], [1, 2, 3]), 2)).toBe("Page 3 of 3");
  });

  it("gives the printed number and the place in the file once the two part", () => {
    expect(pagerText(plan([], [12, 13, 14], 20), 0)).toBe("Page 12 · sheet 1 of 3");
    expect(pagerText(plan(["title"], [1, 2]), 0)).toBe("Title page · sheet 1 of 3");
    expect(pagerText(plan(["title"], [1, 2]), 2)).toBe("Page 2 · sheet 3 of 3");
  });

  it("says there is nothing when nothing is going", () => {
    expect(pagerText([], -1)).toBe("No pages");
  });
});

describe("resolveFocus", () => {
  const layout = layoutOf(10);
  const withPages = (pages: number[] | null) => planSheets({ front: [], layout, frontKinds: [], pages });

  it("stays on the sheet being read while it is still going, wherever it moved to", () => {
    expect(resolveFocus(withPages([4, 5, 6]), "page-5")).toBe(1);
    expect(resolveFocus(withPages([5, 6]), "page-5")).toBe(0);
  });

  it("moves to the next going sheet when the one being read is left out, else the last", () => {
    expect(resolveFocus(withPages([2, 3, 7, 8]), "page-5")).toBe(2);
    expect(resolveFocus(withPages([1, 2, 3]), "page-9")).toBe(2);
  });

  it("starts at the top with nothing chosen yet, or a key from another plan", () => {
    expect(resolveFocus(withPages([3, 4]), null)).toBe(0);
    expect(resolveFocus(withPages([3, 4]), "front-7")).toBe(0);
    expect(resolveFocus(withPages(null), "page-3")).toBe(-1);
  });
});

describe("styleSegments", () => {
  const base = { bold: false, italic: false };
  const run = (start: number, end: number, marks: Partial<StyleRun> = {}): StyleRun => ({
    start,
    end,
    bold: false,
    italic: false,
    underline: false,
    ...marks,
  });

  it("returns one segment when nothing is marked", () => {
    expect(styleSegments("plain", [], base)).toEqual([
      { text: "plain", start: 0, bold: false, italic: false, underline: false },
    ]);
  });

  it("splits at run boundaries and reports each segment's cell", () => {
    const segs = styleSegments("one two", [run(4, 7, { italic: true })], base);
    expect(segs.map((s) => [s.text, s.start, s.italic])).toEqual([
      ["one ", 0, false],
      ["two", 4, true],
    ]);
  });

  it("adds marks to the element's base style rather than replacing it", () => {
    const segs = styleSegments("cue", [run(0, 3, { italic: true })], {
      bold: true,
      italic: false,
    });
    expect(segs[0]).toMatchObject({ bold: true, italic: true });
  });

  it("keeps inline emphasis underneath an element-wide underline", () => {
    const segs = styleSegments("Scene One", [
      run(0, 9, { underline: true }),
      run(6, 9, { bold: true, italic: true }),
    ], base);
    expect(segs).toEqual([
      { text: "Scene ", start: 0, bold: false, italic: false, underline: true },
      { text: "One", start: 6, bold: true, italic: true, underline: true },
    ]);
  });
});
