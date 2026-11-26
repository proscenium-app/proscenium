// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import {
  builtinFormats,
  charAdvanceIn,
  maxLinesPerPage,
  textBlockWidthIn,
  validateFormatSpec,
  formatFileObject,
} from "../format";
import { paginateFrontMatter, PRODUCTION_NOTES_HEADING } from "./engine";
import { openingParagraphs } from "./opening-prose";

const formats = builtinFormats().filter((s) => s.frontMatter.placement === "separate-pages");
const spec = formats[0];

test("docs/app/formatting/formats-and-layout.md#FMT-60: empty front matter makes no sheets; title credit and contact retain their meaning", () => {
  for (const fm of [null, {}, { title: "  " }, { authors: ["A"] }])
    expect(paginateFrontMatter(fm, spec)).toEqual([]);
  const title = paginateFrontMatter(
    {
      title: "Tideline",
      authors: ["A", "B"],
      contact: ["address", "", "phone"],
      draftDate: "July 2026",
    },
    spec,
  );
  expect(title).toHaveLength(1);
  const lines = title[0].lines;
  expect(lines.map((line) => line.text)).toEqual([
    "TIDELINE",
    "by",
    "A, B",
    "address",
    "phone",
    "July 2026",
  ]);
  expect(lines[4].row - lines[3].row).toBe(2);
  expect(lines[5].row - lines[4].row).toBe(1 + spec.frontMatter.fieldGapRows);
  expect(
    paginateFrontMatter({ title: "Tideline", credit: "written by", authors: ["A"] }, spec)[0]
      .lines[1].text,
  ).toBe("written by");
});

test("docs/app/formatting/formats-and-layout.md#FMT-60: forty cast members continue onto another sheet under every built-in", () => {
  for (const spec of formats) {
    const pages = paginateFrontMatter(
      { characters: Array.from({ length: 40 }, (_, i) => ({ name: `Actor ${i + 1}` })) },
      spec,
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.kind === "characters")).toBe(true);
    expect(pages.flatMap((page) => page.lines).filter((line) => line.role === "cast")).toHaveLength(
      40,
    );
    expect(pages[pages.length - 1].lines[pages[pages.length - 1].lines.length - 1].text).toBe(
      "ACTOR 40",
    );
  }
});

test("docs/app/formatting/formats-and-layout.md#FMT-60: long title, contact, cast and setting keep every line inside the shared page bounds", () => {
  for (const spec of formats) {
    const fm = {
      title: "Title ".repeat(300),
      authors: ["Author ".repeat(150)],
      contact: ["long-address@".repeat(140)],
      characters: [{ name: "Mara", description: "Story ".repeat(1200) }],
      setting: "Coast ".repeat(1500),
      time: "Now.",
      place: "Here.",
    };
    const pages = paginateFrontMatter(fm, spec);
    expect(pages.filter((p) => p.kind === "title").length).toBeGreaterThan(1);
    expect(pages.filter((p) => p.kind === "characters").length).toBeGreaterThan(1);
    expect(pages.filter((p) => p.kind === "setting").length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.lines.length).toBeGreaterThan(0);
      let previous = -1;
      for (const line of page.lines) {
        expect(line.row).toBeGreaterThanOrEqual(previous + 1);
        expect(line.row + 1).toBeLessThanOrEqual(maxLinesPerPage(spec));
        expect(line.xIn).toBeGreaterThanOrEqual(0);
        expect(line.xIn + line.text.length * charAdvanceIn(spec)).toBeLessThanOrEqual(
          textBlockWidthIn(spec) + 1e-9,
        );
        previous = line.row;
      }
    }
    const setting = pages
      .flatMap((p) => p.lines)
      .filter((line) => line.paragraphId === "SETTING")
      .map((line) => line.text)
      .join(" ");
    expect(setting.replace(/\s+/g, " ").trim()).toBe(fm.setting.trim());
  }
});

test("docs/app/formatting/formats-and-layout.md#FMT-60: front-sheet spacing comes from the format and survives format serialization", () => {
  const custom = structuredClone(spec);
  custom.frontMatter.sectionTopRows = 5;
  custom.frontMatter.castGapRows = 3;
  custom.frontMatter.headingGapRows = 2;
  const pages = paginateFrontMatter(
    { characters: [{ name: "First" }, { name: "Second" }] },
    custom,
  );
  expect(pages[0].lines.map((line) => line.row)).toEqual([5, 8, 12]);
  const roundtrip = validateFormatSpec(formatFileObject(custom));
  expect(roundtrip.ok && roundtrip.spec.frontMatter).toEqual(custom.frontMatter);
  for (const frontMatter of [
    { castGapRows: -1 },
    { titleTopFraction: 1.2 },
    { headingFontStyle: "huge" },
    { typo: 3 },
  ]) {
    expect(validateFormatSpec({ ...formatFileObject(spec), frontMatter }).ok).toBe(false);
  }
});

test("custom opening pages retain ordering, alignment, marks and every wrapped word", () => {
  const pages = paginateFrontMatter(
    {
      title: "Metadata title",
      titlePage: "<!-- proscenium:align=center -->\n\n# My own title\n\nBy the author",
      characters: [{ name: "Unprinted list entry" }],
      charactersPage: "# The people\n\n**Mara**, _a keeper_.",
      openingNotes: "# Before you begin\n\n" + "A distant shore. ".repeat(150) + "Last word.",
      openingNotesBeforeCharacters: true,
    },
    spec,
  );
  expect(pages[0].kind).toBe("title");
  expect(pages[0].lines[0].text).toBe("My own title");
  expect(pages[0].lines[0].xIn).toBeGreaterThan(0);
  expect(pages[pages.length - 1]?.kind).toBe("characters");
  const all = pages.flatMap((page) => page.lines);
  expect(
    all.some((line) => line.text.includes("Metadata title") || line.text.includes("Unprinted")),
  ).toBe(false);
  expect(all.map((line) => line.text).join(" ")).toContain("Last word.");
  const cast = all.find((line) => line.text.includes("Mara"))!;
  expect(cast.runs?.some((run) => run.bold && cast.text.slice(run.start, run.end) === "Mara")).toBe(
    true,
  );
  expect(
    cast.runs?.some((run) => run.italic && cast.text.slice(run.start, run.end) === "a keeper"),
  ).toBe(true);
  for (const line of all) expect(line.row).toBeLessThan(maxLinesPerPage(spec));
});

test("empty custom pages explicitly omit the generated originals", () => {
  expect(
    paginateFrontMatter(
      {
        title: "Title",
        characters: [{ name: "A" }],
        setting: "A place",
        titlePage: "",
        charactersPage: "",
        openingNotes: "",
      },
      spec,
    ),
  ).toEqual([]);
});

const NOTES =
  "## Casting\n\nSix actors play every role.\n\n- A slash (/) marks an overlap.\n- Brackets mark what is not said.";

test("docs/app/formatting/formats-and-layout.md#FMT-160: production notes print last, on a sheet of their own, under their heading", () => {
  for (const spec of formats) {
    const policy = spec.frontMatter;
    const pages = paginateFrontMatter(
      {
        title: "Tideline",
        characters: [{ name: "Mara" }],
        setting: "A coast.",
        productionNotes: NOTES,
      },
      spec,
    );
    expect(pages.map((page) => page.kind)).toEqual([
      "title",
      "characters",
      "setting",
      "production",
    ]);
    const [heading, ...notes] = pages[3].lines;
    expect(heading).toMatchObject({
      text: PRODUCTION_NOTES_HEADING,
      role: "heading",
      align: "center",
      fontStyle: policy.headingFontStyle,
      row: policy.sectionTopRows,
      paragraphId: "production-heading",
    });
    expect(heading.text).toBe("PRODUCTION NOTES");
    expect(heading.xIn).toBeCloseTo(
      (textBlockWidthIn(spec) - heading.text.length * charAdvanceIn(spec)) / 2,
    );
    expect(notes.map((line) => line.text)).toEqual([
      "Casting",
      "Six actors play every role.",
      "• A slash (/) marks an overlap.",
      "• Brackets mark what is not said.",
    ]);
    expect(notes.map((line) => line.paragraphId)).toEqual(
      [0, 1, 2, 3].map((i) => `production-prose-${i}`),
    );
    // The heading keeps its gap from the format, and each paragraph the field gap.
    expect(notes[0].row - heading.row).toBe(1 + policy.headingGapRows);
    expect(notes[0].role).toBe("heading");
    expect(notes[0].fontStyle).toBe(policy.headingFontStyle);
    expect(notes[1].role).toBe("paragraph");
    expect(notes[1].fontStyle).toBe(policy.bodyFontStyle);
    for (let i = 1; i < notes.length; i++)
      expect(notes[i].row - notes[i - 1].row).toBe(1 + policy.fieldGapRows);
  }
});

test("docs/app/formatting/formats-and-layout.md#FMT-160: production notes stay last when the opening notes come first", () => {
  const pages = paginateFrontMatter(
    {
      title: "Tideline",
      characters: [{ name: "Mara" }],
      openingNotes: "For my mother.",
      openingNotesBeforeCharacters: true,
      productionNotes: "Played without an interval.",
    },
    spec,
  );
  expect(pages.map((page) => page.kind)).toEqual(["title", "setting", "characters", "production"]);
  // With nothing else to print, they are the only sheet.
  expect(
    paginateFrontMatter({ productionNotes: "Played without an interval." }, spec).map((page) =>
      page.lines.map((line) => line.text),
    ),
  ).toEqual([["PRODUCTION NOTES", "Played without an interval."]]);
});

test("docs/app/formatting/formats-and-layout.md#FMT-160: notes with no word to print make no page and no lone heading", () => {
  for (const productionNotes of [undefined, "", "   ", "\n\n\n", "   \n\n  \n"]) {
    const pages = paginateFrontMatter({ title: "Tideline", productionNotes }, spec);
    expect(pages.map((page) => page.kind)).toEqual(["title"]);
    expect(
      pages.flatMap((page) => page.lines).some((line) => line.text === "PRODUCTION NOTES"),
    ).toBe(false);
  }
});

test("docs/app/formatting/formats-and-layout.md#FMT-160: long production notes continue on more unnumbered sheets of their kind", () => {
  for (const spec of formats) {
    const productionNotes =
      "## On the set\n\n" + "The room is bare but for a table. ".repeat(260) + "LAST-WORD";
    const pages = paginateFrontMatter({ title: "Tideline", productionNotes }, spec);
    const sheets = pages.filter((page) => page.kind === "production");
    expect(sheets.length).toBeGreaterThan(1);
    expect(pages.slice(1).every((page) => page.kind === "production")).toBe(true);
    // The heading is printed once, at the top of the first sheet.
    const all = sheets.flatMap((page) => page.lines);
    expect(all.filter((line) => line.text === "PRODUCTION NOTES")).toHaveLength(1);
    expect(sheets[0].lines[0].text).toBe("PRODUCTION NOTES");
    // The subheading travels with the line under it.
    expect(sheets[0].lines[1].text).toBe("On the set");
    expect(all[all.length - 1].text.endsWith("LAST-WORD")).toBe(true);
    for (const page of sheets) {
      let previous = -1;
      for (const line of page.lines) {
        expect(line.row).toBeGreaterThan(previous);
        expect(line.row + 1).toBeLessThanOrEqual(maxLinesPerPage(spec));
        expect(line.xIn + line.text.length * charAdvanceIn(spec)).toBeLessThanOrEqual(
          textBlockWidthIn(spec) + 1e-9,
        );
        previous = line.row;
      }
    }
    const words = all
      .filter((line) => line.paragraphId === "production-prose-1")
      .map((line) => line.text)
      .join(" ");
    expect(words.replace(/\s+/g, " ").trim()).toBe(
      productionNotes.slice(15).replace(/\s+/g, " ").trim(),
    );
  }
});

test("docs/app/formatting/formats-and-layout.md#FMT-161: a printed paragraph knows the block of the text it came from", () => {
  expect(openingParagraphs(NOTES + "\n\nLast.").map((p) => [p.text, p.block])).toEqual([
    ["Casting", 0],
    ["Six actors play every role.", 1],
    ["• A slash (/) marks an overlap.", 2],
    ["• Brackets mark what is not said.", 2],
    ["Last.", 3],
  ]);
  // An alignment comment is part of its paragraph, not a block of its own.
  expect(
    openingParagraphs("<!-- proscenium:align=center -->\n\nCentred\n\nNext").map((p) => [
      p.text,
      p.align,
      p.block,
    ]),
  ).toEqual([
    ["Centred", "center", 0],
    ["Next", "left", 1],
  ]);
});
