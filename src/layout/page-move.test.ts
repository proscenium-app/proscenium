// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A block of a page stands where its writer put it
 * (docs/app/formatting/formats-and-layout.md#FMT-182): what a page's file says
 * of a place and reads back, where the one paginator sets each block for it,
 * and that a move rewrites the file so the moved block stands where it was
 * asked to and every other block where it did.
 */
import { describe, expect, it } from "bun:test";
import { builtinFormats } from "../format";
import { charAdvanceIn } from "../format/metrics";
import type { FormatSpec } from "../format/spec";
import { parse } from "../fountain";
import type { FrontMatter } from "../fountain/model";
import { toDoc, toMarkdown } from "../markdown/doc";
import { layoutFrontPages, paginateDoc, type FrontMatterPage } from "./engine";
import { pagesAsFountain } from "./fountain-with-pages";
import { TITLE_PAGE_FILE, pageBlockAt, pageFromFile, writePageFile } from "./page-files";
import { movePageBlock, pageSpots, shownDetails, stepPageBlock, type PageSpots } from "./page-move";

const dg = builtinFormats().find((spec) => spec.id === "dg-modern")!;
const FM: FrontMatter = {
  title: "Hay Fever",
  authors: ["Noël Coward"],
  contact: ["Agent Name", "1 Example Street"],
  draftDate: "Draft 3",
};

const sheets = (text: string, spec: FormatSpec = dg, fm: FrontMatter = FM): FrontMatterPage[] =>
  layoutFrontPages([pageFromFile("page", "p", text, fm, spec.frontMatter)], spec);

/** Each printed line of a page's first sheet: its words, its row, and the cell it starts at. */
function lines(text: string, spec: FormatSpec = dg, fm: FrontMatter = FM) {
  const advance = charAdvanceIn(spec);
  return (sheets(text, spec, fm)[0]?.lines ?? []).map((line) => ({
    text: line.text,
    row: Math.round(line.row * 100) / 100,
    cell: Math.round(line.xIn / advance),
  }));
}

const page = (...body: string[]) => writePageFile({ layout: "top" }, body.join("\n\n"));
const titled = (...body: string[]) => writePageFile({ layout: "title" }, body.join("\n\n"));

/** Where each block stands, by its place among the page's blocks. */
const where = (spots: PageSpots) =>
  spots.spots.map((spot) => `${spot.index} ${spot.band} ${Math.round(spot.row * 100) / 100}`);

describe("a place in a page's file", () => {
  it("is read from the line above its block and written back as it was", () => {
    const body = [
      "<!-- proscenium:place rows=3 -->",
      "# TITLE",
      "<!-- proscenium:place beside cell=40 -->",
      "A line at a cell",
      "<!-- proscenium:place rows=2 -->",
      "<!-- proscenium:align=right -->",
      "At the right",
      "",
    ].join("\n\n");
    const doc = toDoc(body, { pageFile: true });
    expect(doc.content?.map((node) => node.attrs)).toEqual([
      { level: 1, placeRows: 3 },
      { placeCell: 40, placeBeside: true },
      { textAlign: "right", placeRows: 2 },
    ]);
    expect(toMarkdown(doc, { emptyLines: true, blankRows: true })).toBe(body.trim() + "\n");
  });

  it("keeps a blank row between two lines, and nothing for the blank rows at the page's end", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "B" }] },
        { type: "paragraph" },
      ],
    };
    const written = toMarkdown(doc, { emptyLines: true, blankRows: true });
    expect(written).toBe("A\n\n<!-- proscenium:line -->\n\n<!-- proscenium:line -->\n\nB\n");
    expect(toDoc(written, { pageFile: true }).content).toHaveLength(4);
    // A scaffold's line waiting for words at the left was never a row of the page.
    expect(toMarkdown(doc, { emptyLines: true })).toBe("A\n\nB\n");
    // Any other document writes nothing for an empty line, as it always has.
    expect(toMarkdown(doc)).toBe("A\n\nB\n");
  });

  it("holds the head's mark as a block of its own, above the foot's", () => {
    const body =
      "Top\n\n<!-- proscenium:head -->\n\nMiddle\n\n<!-- proscenium:foot -->\n\nBottom\n";
    const doc = toDoc(body, { pageFile: true });
    expect(doc.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "head",
      "paragraph",
      "foot",
      "paragraph",
    ]);
    expect(toMarkdown(doc, { emptyLines: true, blankRows: true })).toBe(body);
    // A second head mark, or one under the foot, is the text it is.
    const twice = toDoc(`${body}\n<!-- proscenium:head -->\n`, { pageFile: true });
    expect(twice.content?.filter((node) => node.type === "head")).toHaveLength(1);
    // The page view opens the editor at the block a printed paragraph is.
    const file = writePageFile({ layout: "title" }, body);
    expect(pageBlockAt(file, "p-0")).toBe(0);
    expect(pageBlockAt(file, "p-1")).toBe(2);
    expect(pageBlockAt(file, "p-2")).toBe(4);
  });
});

describe("where the paginator sets a placed block", () => {
  it("prints a blank row a writer left, with the gap any line has", () => {
    expect(lines(page("A", "B"))).toEqual([
      { text: "A", row: 2, cell: 0 },
      { text: "B", row: 4, cell: 0 },
    ]);
    expect(lines(page("A", "<!-- proscenium:line -->", "B"))).toEqual([
      { text: "A", row: 2, cell: 0 },
      { text: "B", row: 6, cell: 0 },
    ]);
    // A page of blank rows alone prints nothing.
    expect(sheets(page("<!-- proscenium:line -->", "<!-- proscenium:line=center -->"))).toEqual([]);
  });

  it("puts a block's rows above it in place of the format's gap", () => {
    expect(lines(page("A", "<!-- proscenium:place rows=0 -->", "B")).map((l) => l.row)).toEqual([
      2, 3,
    ]);
    expect(lines(page("A", "<!-- proscenium:place rows=6 -->", "B")).map((l) => l.row)).toEqual([
      2, 9,
    ]);
    // The first block's rows push the page's first line down.
    expect(lines(page("<!-- proscenium:place rows=4 -->", "A"))[0]).toEqual({
      text: "A",
      row: 6,
      cell: 0,
    });
  });

  it("starts a block's lines at its cell, pulled in when it would run off the sheet", () => {
    expect(lines(page("<!-- proscenium:place cell=20 -->", "One  \nTwo"))).toEqual([
      { text: "One", row: 2, cell: 20 },
      { text: "Two", row: 3, cell: 20 },
    ]);
    expect(lines(page("<!-- proscenium:place cell=58 -->", "Twelve cells"))[0]?.cell).toBe(48);
  });

  it("stands a block beside the one before it, and under it when their words would meet", () => {
    const beside = page(
      "Agent Name  \n1 Example Street",
      "<!-- proscenium:place beside -->",
      "<!-- proscenium:align=right -->",
      "Draft 3",
      "After",
    );
    expect(lines(beside)).toEqual([
      { text: "Agent Name", row: 2, cell: 0 },
      { text: "1 Example Street", row: 3, cell: 0 },
      { text: "Draft 3", row: 2, cell: 53 },
      // What follows starts under the taller of the two.
      { text: "After", row: 5, cell: 0 },
    ]);
    const lower = beside.replace("place beside", "place beside rows=1");
    expect(lines(lower)[2]).toEqual({ text: "Draft 3", row: 3, cell: 53 });
    const meets = page("A long line of the page", "<!-- proscenium:place beside -->", "Under it");
    expect(lines(meets).map((l) => l.row)).toEqual([2, 4]);
  });

  it("sets a page's head from the top of the sheet and leaves its own first line where it was", () => {
    const plain = lines(TITLE_PAGE_FILE);
    const headed = TITLE_PAGE_FILE.replace(
      "<!-- proscenium:align=center -->\n\n# {TITLE}",
      "<!-- proscenium:align=right -->\n\nA note\n\n<!-- proscenium:head -->\n\n<!-- proscenium:align=center -->\n\n# {TITLE}",
    );
    expect(lines(headed)).toEqual([{ text: "A note", row: 0, cell: 54 }, ...plain]);
  });

  it("sets any page's foot at the bottom of its sheet", () => {
    const rows = lines(page("Words", "<!-- proscenium:foot -->", "At the bottom"));
    expect(rows).toEqual([
      { text: "Words", row: 2, cell: 0 },
      { text: "At the bottom", row: 44, cell: 0 },
    ]);
  });

  it("gives up rows a writer left, the last first, before a page runs on to a second sheet", () => {
    const roomy = page(
      "A",
      "<!-- proscenium:place rows=20 -->",
      "B",
      "<!-- proscenium:place rows=30 -->",
      "C",
    );
    // 45 rows: A at 2, B at 23, and C would be at 54. Its rows give way first.
    expect(sheets(roomy)).toHaveLength(1);
    expect(lines(roomy)).toEqual([
      { text: "A", row: 2, cell: 0 },
      { text: "B", row: 23, cell: 0 },
      { text: "C", row: 44, cell: 0 },
    ]);
    // A page too long for one sheet whatever is given up keeps every row.
    const long = page(
      ...Array.from({ length: 30 }, (_, i) => `Line ${i}`),
      "<!-- proscenium:place rows=5 -->",
      "Last",
    );
    const laid = sheets(long);
    expect(laid).toHaveLength(2);
    const last = laid[1]!.lines[laid[1]!.lines.length - 1]!;
    const before = laid[1]!.lines[laid[1]!.lines.length - 2]!;
    expect(last.row - before.row).toBe(6);
  });

  it("flows the pages of a format whose opening runs in with the script", () => {
    const inline = builtinFormats().find((spec) => spec.frontMatter.placement === "inline");
    if (!inline) return;
    const text = page(
      "Top",
      "<!-- proscenium:head -->",
      "A",
      "<!-- proscenium:place beside cell=30 -->",
      "B",
    );
    const result = paginateDoc(parse("MARA\nA line.\n").doc, inline, {
      frontMatter: { ...FM, pages: [{ id: "p", name: "Page", text }] },
    });
    expect(result.pages[0]?.intro?.map((line) => line.text)).toEqual(["Top", "A", "B"]);
  });
});

describe("moving a block of a page", () => {
  const shown = shownDetails(FM);
  const start = pageSpots(TITLE_PAGE_FILE, shown, dg);
  // The title page's blocks, as its editor holds them: the foot's rule is the fifth.
  const [TITLE, CREDIT, AUTHOR, CONTACT, DATE] = [0, 2, 3, 5, 6];

  it("reads where each block of the title page stands", () => {
    expect(start.grid).toEqual({ rows: 45, cells: 60, mainTop: 13 + 1 / 3, bottom: 45 });
    // The title, the subtitle's prompt, the credit and the author; the contact and the date.
    expect(where(start)).toEqual([
      "0 main 13.33",
      "1 main 15.33",
      "2 main 17.33",
      "3 main 19.33",
      "5 foot 41",
      "6 foot 44",
    ]);
    expect(start.spots.every((spot) => spot.movable)).toBe(true);
  });

  it("moves a line down a row and leaves every other where it was", () => {
    const moved = stepPageBlock(TITLE_PAGE_FILE, shown, dg, AUTHOR, "down")!;
    expect(moved.text).toContain(
      "<!-- proscenium:place rows=2 -->\n\n<!-- proscenium:align=center -->\n\n{author}",
    );
    expect(where(pageSpots(moved.text, shown, dg))).toEqual([
      "0 main 13.33",
      "1 main 15.33",
      "2 main 17.33",
      "3 main 20.33",
      "5 foot 41",
      "6 foot 44",
    ]);
    // Back up a row, and the file says nothing of a place again.
    expect(stepPageBlock(moved.text, shown, dg, AUTHOR, "up")!.text).toBe(TITLE_PAGE_FILE);
  });

  it("holds the line under a moved one where it stood", () => {
    const moved = stepPageBlock(TITLE_PAGE_FILE, shown, dg, CREDIT, "up")!;
    expect(where(pageSpots(moved.text, shown, dg))).toEqual([
      "0 main 13.33",
      "1 main 15.33",
      "2 main 16.33",
      "3 main 19.33",
      "5 foot 41",
      "6 foot 44",
    ]);
  });

  it("steps over the line in its way, and the file's order follows the sheet's", () => {
    // The credit, two rows down: the author's row is taken, so it goes past it.
    const one = stepPageBlock(TITLE_PAGE_FILE, shown, dg, CREDIT, "down")!;
    const two = stepPageBlock(one.text, shown, dg, one.index, "down")!;
    expect(two.index).toBe(AUTHOR);
    expect(where(pageSpots(two.text, shown, dg))).toEqual([
      "0 main 13.33",
      "1 main 15.33",
      "2 main 19.33",
      "3 main 20.33",
      "5 foot 41",
      "6 foot 44",
    ]);
    expect(two.text.indexOf("{author}")).toBeLessThan(two.text.indexOf("{credit}"));
  });

  it("puts a line above the page's first at the head of the sheet", () => {
    const moved = movePageBlock(TITLE_PAGE_FILE, shown, dg, DATE, { row: 0, cell: 59 })!;
    expect(moved).toMatchObject({ index: 0, band: "head", row: 0 });
    expect(moved.text).toContain(
      "<!-- proscenium:align=right -->\n\n{draftDate}\n\n<!-- proscenium:head -->",
    );
    const now = pageSpots(moved.text, shown, dg);
    // The title is still a third of the way down, and the contact where it was.
    expect(where(now)).toEqual([
      "0 head 0",
      "2 main 13.33",
      "3 main 15.33",
      "4 main 17.33",
      "5 main 19.33",
      "7 foot 41",
      "8 foot 44",
    ]);
    // Brought back under the author, the head and its mark are gone.
    const back = movePageBlock(moved.text, shown, dg, 0, { row: 21.33, align: "center" })!;
    expect(back.text).not.toContain("proscenium:head");
  });

  it("stands a line beside another at the foot", () => {
    const moved = movePageBlock(TITLE_PAGE_FILE, shown, dg, DATE, { row: 41, cell: 59 })!;
    expect(moved).toMatchObject({ band: "foot", row: 41 });
    expect(moved.text).toContain(
      "<!-- proscenium:place beside -->\n\n<!-- proscenium:align=right -->\n\n{draftDate}",
    );
    expect(lines(moved.text).slice(-3)).toEqual([
      { text: "Agent Name", row: 41, cell: 0 },
      { text: "1 Example Street", row: 42, cell: 0 },
      { text: "Draft 3", row: 41, cell: 53 },
    ]);
  });

  it("refuses a place where another block's words are", () => {
    // The date, left where it is across the sheet, on the contact's own rows.
    expect(movePageBlock(TITLE_PAGE_FILE, shown, dg, DATE, { row: 41 })).toBeNull();
    expect(movePageBlock(TITLE_PAGE_FILE, shown, dg, DATE, { row: 60 })).toBeNull();
    expect(movePageBlock(TITLE_PAGE_FILE, shown, dg, 9, { row: 3 })).toBeNull();
  });

  it("keeps a foot block in the foot as it goes up, holding the rest where it was", () => {
    const moved = stepPageBlock(TITLE_PAGE_FILE, shown, dg, CONTACT, "up")!;
    expect(moved).toMatchObject({ band: "foot", row: 40 });
    expect(where(pageSpots(moved.text, shown, dg))).toEqual([
      "0 main 13.33",
      "1 main 15.33",
      "2 main 17.33",
      "3 main 19.33",
      "5 foot 40",
      "6 foot 44",
    ]);
    // The last line of the foot, moved up, leaves the bottom row blank under it.
    const date = stepPageBlock(TITLE_PAGE_FILE, shown, dg, DATE, "up")!;
    expect(date).toMatchObject({ band: "foot", row: 43 });
    expect(lines(date.text).pop()).toEqual({ text: "Draft 3", row: 43, cell: 0 });
    expect(lines(date.text).find((line) => line.text === "Agent Name")?.row).toBe(41);
  });

  it("moves a line across the sheet a cell at a time, and sets it at an edge it reaches", () => {
    const right = stepPageBlock(TITLE_PAGE_FILE, shown, dg, TITLE, "right")!;
    expect(right.text).toContain("<!-- proscenium:place cell=26 -->\n\n# {TITLE}");
    expect(right.cell).toBe(26);
    const left = movePageBlock(right.text, shown, dg, 0, { row: right.row, cell: 0 })!;
    expect(left.text).toContain("\n\n# {TITLE}");
    expect(left.text).not.toContain("proscenium:place");
    expect(lines(left.text)[0]).toEqual({ text: "HAY FEVER", row: 13.33, cell: 0 });
    const edge = movePageBlock(right.text, shown, dg, 0, { row: right.row, cell: 55 })!;
    expect(edge.text).toContain("<!-- proscenium:align=right -->\n\n# {TITLE}");
    expect(stepPageBlock(edge.text, shown, dg, 0, "right")).toBeNull();
  });

  it("moves a line whose detail is not written yet, as the page shows it", () => {
    const bare = shownDetails({ title: "Hay Fever" });
    const moved = stepPageBlock(TITLE_PAGE_FILE, bare, dg, AUTHOR, "down")!;
    expect(moved.text).toContain("<!-- proscenium:place rows=2 -->");
    // Printed, a detail with no words is still no line at all.
    expect(lines(moved.text, dg, { title: "Hay Fever" })).toEqual([
      { text: "HAY FEVER", row: 13.33, cell: 26 },
    ]);
  });

  it("does not move a block of a list, or anything in a format with no sheet for the page", () => {
    const listed = page("Heading", "- one\n- two");
    expect(pageSpots(listed, shown, dg).spots.map((spot) => spot.movable)).toEqual([true, false]);
    expect(stepPageBlock(listed, shown, dg, 1, "down")).toBeNull();
    const inline = builtinFormats().find((spec) => spec.frontMatter.placement === "inline");
    if (inline) expect(stepPageBlock(TITLE_PAGE_FILE, shown, inline, 2, "down")).toBeNull();
  });

  it("keeps its shape in another format, to the rows that format's sheet has", () => {
    const moved = movePageBlock(TITLE_PAGE_FILE, shown, dg, AUTHOR, { row: 30.33 })!;
    for (const spec of builtinFormats().filter((s) => s.frontMatter.placement !== "inline")) {
      const laid = sheets(moved.text, spec);
      expect(laid).toHaveLength(1);
      expect(laid[0]!.lines.map((line) => line.text)).toEqual([
        "HAY FEVER",
        "by",
        "Noël Coward",
        "Agent Name",
        "1 Example Street",
        "Draft 3",
      ]);
    }
  });
});

describe("a placed block in a file for another app", () => {
  it("goes to a Fountain file as a line in the sheet's order, and never as a mark", () => {
    const text = titled(
      "<!-- proscenium:align=right -->",
      "A note",
      "<!-- proscenium:head -->",
      "<!-- proscenium:place rows=3 cell=10 -->",
      "Words",
      "<!-- proscenium:line -->",
      "<!-- proscenium:place beside -->",
      "More",
    );
    const fountain = pagesAsFountain([{ id: "p", name: "Page", text }], FM);
    expect(fountain).not.toContain("proscenium:");
    expect(fountain.indexOf("A note")).toBeLessThan(fountain.indexOf("Words"));
    expect(fountain.indexOf("Words")).toBeLessThan(fountain.indexOf("More"));
  });
});
