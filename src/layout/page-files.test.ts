// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pages before the script written as Markdown files (src/layout/page-files.ts):
 * the file's header and fields, and, above all, that today's front matter
 * written out as files prints exactly what it prints now. Every sample play
 * and fixture, the cases each sheet's rules were written for, and a sweep of
 * generated front matters are laid out from their fields and texts and again
 * from the files `legacyPageFiles` writes for them, under every built-in
 * format that prints the pages on sheets of their own, and the two must put
 * the same words on the same rows at the same places, in the same type: what
 * the PDF and the preview draw (`styleSegments`).
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { builtinFormats } from "../format";
import type { FormatSpec } from "../format/spec";
import { parse } from "../fountain";
import type { FrontMatter } from "../fountain/model";
import { frontSheetLabel, styleSegments } from "../pdf/plan";
import { layoutFrontPages, paginateDoc, paginateFrontMatter, type FrontMatterPage } from "./engine";
import { frontPagesOf } from "./front-pages";
import {
  FOOT_MARK,
  TITLE_PAGE_FILE,
  fillFields,
  legacyPageFiles,
  pageFromFile,
  readPageFile,
  writePageFile,
} from "./page-files";

const sheetFormats: FormatSpec[] = builtinFormats().filter(
  (spec) => spec.frontMatter.placement === "separate-pages",
);
const dg = builtinFormats().find((spec) => spec.id === "dg-modern")!;

/** What a sheet prints: each line's row, place and words, and the type of each word. */
function printed(sheets: FrontMatterPage[]) {
  return sheets.map((sheet) => ({
    kind: sheet.kind,
    lines: sheet.lines.map((line) => ({
      row: line.row,
      x: Math.round(line.xIn * 1e6) / 1e6,
      text: line.text,
      type: styleSegments(line.text, line.runs ?? [], {
        bold: line.fontStyle === "bold" || line.fontStyle === "bold-italic",
        italic: line.fontStyle === "italic" || line.fontStyle === "bold-italic",
      })
        .map((s) => `${s.bold ? "b" : ""}${s.italic ? "i" : ""}:${s.text}`)
        .join("|"),
    })),
  }));
}

const fromFields = (fm: FrontMatter | null | undefined, spec: FormatSpec) =>
  layoutFrontPages(frontPagesOf(fm, spec.frontMatter), spec);
const fromFiles = (fm: FrontMatter | null | undefined, spec: FormatSpec) =>
  layoutFrontPages(
    legacyPageFiles(fm).map((file, i) =>
      pageFromFile(file.kind, `page-${i}`, file.text, fm ?? {}, spec.frontMatter),
    ),
    spec,
  );

function printsTheSame(fm: FrontMatter | null | undefined, what: string) {
  for (const spec of sheetFormats) {
    const was = printed(fromFields(fm, spec));
    const is = printed(fromFiles(fm, spec));
    if (!Bun.deepEquals(is, was))
      expect({ what, format: spec.id, sheets: is }).toEqual({ what, format: spec.id, sheets: was });
  }
}

function scripts(dir: string): string[] {
  const root = join(import.meta.dir, "../..", dir);
  const out: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".fountain")) out.push(path);
    }
  };
  walk(root);
  return out;
}

/** The same deterministic front matters as front-pages.test.ts's sweep, by another seed. */
function generator(seed: number) {
  let s = seed;
  const r = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const words =
    "the of water kitchen winter brother hydrologist light house sea stair rain coat tap drip night long very a an and her his doubling interval overlap slash bracket".split(
      " ",
    );
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const sentence = (n: number) => Array.from({ length: n }, () => pick(words)).join(" ");
  const count = (n: number) => Math.floor(r() * n);
  const markdown = () =>
    Array.from({ length: 1 + count(6) }, () => {
      const k = r();
      if (k < 0.12) return `## ${sentence(2)}`;
      if (k < 0.2) return `# ${sentence(3)}`;
      if (k < 0.32) return `- ${sentence(4)}\n- ${sentence(7 + count(20))}`;
      if (k < 0.4) return `1. ${sentence(3)}\n2. ${sentence(9)}`;
      if (k < 0.5) return `<!-- proscenium:align=center -->\n${sentence(5)}`;
      if (k < 0.58) return `<!-- proscenium:align=right -->\n${sentence(4)}`;
      if (k < 0.7) return `**${sentence(1).toUpperCase()}** — ${sentence(6)}`;
      if (k < 0.78) return `*${sentence(4)}* and ${sentence(30)}`;
      if (k < 0.82) return "";
      return sentence(3 + count(60));
    }).join("\n\n");
  return (): FrontMatter => {
    const fm: FrontMatter = {};
    if (r() < 0.85) fm.title = r() < 0.1 ? sentence(40) : sentence(1 + count(4));
    if (r() < 0.5) fm.credit = pick(["a play by", "by", "a new play by", ""]);
    if (r() < 0.8) fm.authors = Array.from({ length: 1 + count(3) }, () => sentence(2));
    if (r() < 0.7)
      fm.contact = Array.from({ length: count(6) }, () => (r() < 0.2 ? "" : sentence(3)));
    if (r() < 0.6) fm.draftDate = pick(["2026-06-18", "June 18, 2026", "Draft 3\nJune 2026", " "]);
    if (r() < 0.6)
      fm.characters = Array.from({ length: count(40) }, (_, i) => ({
        name: `${sentence(1).toUpperCase()} ${i}`,
        ...(r() < 0.8 ? { description: sentence(2 + count(25)) } : {}),
      }));
    if (r() < 0.3) fm.charactersPage = r() < 0.15 ? "" : markdown();
    if (r() < 0.25) fm.titlePage = r() < 0.15 ? "  " : markdown();
    if (r() < 0.4) fm.openingNotes = r() < 0.15 ? "" : markdown();
    if (r() < 0.5) fm.openingNotesBeforeCharacters = r() < 0.5;
    if (r() < 0.3) fm.setting = sentence(1 + count(30));
    if (r() < 0.3) fm.time = r() < 0.2 ? " " : sentence(3);
    if (r() < 0.2) fm.place = sentence(4);
    if (r() < 0.35) fm.productionNotes = r() < 0.15 ? "\n\n" : markdown();
    return fm;
  };
}

describe("a page file", () => {
  it("reads its header, and is a page from the section top without one", () => {
    expect(readPageFile("Words.")).toEqual({ layout: "top", exports: true, body: "Words." });
    expect(readPageFile("---\nlayout: title\nexport: false\n---\n\n# Play\n")).toEqual({
      layout: "title",
      exports: false,
      body: "# Play\n",
    });
    expect(readPageFile("---\r\nlayout: third\r\n---\r\nWords.").layout).toBe("third");
    expect(readPageFile("---\nlayout: sideways\n---\nWords.").layout).toBe("top");
  });

  it("writes a header only when it says something", () => {
    expect(writePageFile({ layout: "top" }, "Words.\n\n")).toBe("Words.\n");
    expect(writePageFile({ layout: "title", exports: false }, "# {TITLE}")).toBe(
      "---\nlayout: title\nexport: false\n---\n\n# {TITLE}\n",
    );
    const file = writePageFile({ layout: "third", exports: false }, "Words.");
    expect(readPageFile(file)).toEqual({ layout: "third", exports: false, body: "Words.\n" });
  });

  it("fills its fields from the play's details, and moves emphasis with them", () => {
    const fm: FrontMatter = { title: "Water", authors: ["A. Writer", "B. Writer"] };
    expect(fillFields("{TITLE}, {credit} {author}", [], fm).text).toBe(
      "WATER, by A. Writer, B. Writer",
    );
    // "Draft of {title}" with the field in italic, and the words after it bold.
    const filled = fillFields(
      "Draft of {title} now",
      [
        { start: 0, end: 9, bold: false, italic: false, underline: false },
        { start: 9, end: 16, bold: false, italic: true, underline: false },
        { start: 16, end: 20, bold: true, italic: false, underline: false },
      ],
      fm,
    );
    expect(filled.text).toBe("Draft of Water now");
    expect(filled.runs.map((r) => filled.text.slice(r.start, r.end))).toEqual([
      "Draft of ",
      "Water",
      " now",
    ]);
    expect(fillFields("{unknown} {source}", [], { source: "a story by C." }).text).toBe(
      "{unknown} a story by C.",
    );
  });

  it("lays a title page out with its title in the title style and its foot at the bottom", () => {
    const fm: FrontMatter = {
      title: "Water",
      authors: ["A. Writer"],
      contact: ["a@example.com", "", "Agent"],
      draftDate: "June 2026",
    };
    const page = pageFromFile("title", "t", TITLE_PAGE_FILE, fm, dg.frontMatter);
    expect(page.top).toBe("title");
    expect(page.blocks.map((b) => [b.text, b.fontStyle, b.titleStyle ?? false])).toEqual([
      ["WATER", dg.frontMatter.titleFontStyle, true],
      ["by", dg.frontMatter.bodyFontStyle, false],
      ["A. Writer", dg.frontMatter.bodyFontStyle, false],
    ]);
    expect(page.foot.map((b) => [b.text, b.gap, b.align])).toEqual([
      ["a@example.com", 0, dg.frontMatter.contactAlign],
      ["Agent", 1, dg.frontMatter.contactAlign],
      ["June 2026", dg.frontMatter.fieldGapRows, dg.frontMatter.contactAlign],
    ]);
    const [sheet] = layoutFrontPages([page], dg);
    const foot = sheet!.lines.filter((l) => l.text === "June 2026");
    expect(foot[0]!.row).toBeGreaterThan(sheet!.lines.find((l) => l.text === "A. Writer")!.row + 2);
    expect(TITLE_PAGE_FILE).toContain(FOOT_MARK);
  });
});

describe("today's front matter written as page files prints what it prints now", () => {
  it("for the sample plays and the fixtures", () => {
    const files = [
      ...scripts("sample-vault"),
      ...scripts("sample-outside"),
      ...scripts("scripts/store"),
    ];
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) printsTheSame(parse(readFileSync(file, "utf8")).frontMatter, file);
  });

  it("for the case each sheet's rules were written for", () => {
    const cast = Array.from({ length: 70 }, (_, i) => ({
      name: `Person ${i}`,
      description: i % 3 ? "who they are, *and* what_the play needs of them" : "",
    }));
    const cases: [string, FrontMatter][] = [
      ["nothing", {}],
      ["a title alone", { title: "Play" }],
      [
        "a cast over several sheets, with Markdown in its words",
        { title: "Big Cast", characters: cast },
      ],
      [
        "a title too long for a page",
        { title: "word ".repeat(600), authors: ["A. Writer"], contact: ["a@example.com"] },
      ],
      [
        "contact with blank lines at both ends, then a date",
        {
          title: "Play",
          contact: ["", "", "Agent Name", "", "agent@example.com", "", ""],
          draftDate: "June 2026",
        },
      ],
      ["a draft date and no contact", { title: "Play", draftDate: "Draft 2\n2026-06-18" }],
      ["a credit and no author", { title: "Play", credit: "adapted from the novel" }],
      ["a title of two lines", { title: "The Long\nName", authors: ["A. Writer"] }],
      ["a title page written freely", { title: "Ignored", titlePage: "# Mine\n\nBy me" }],
      [
        "a Characters page written freely",
        { characters: [{ name: "MARA" }], charactersPage: "**MARA**, forties." },
      ],
      [
        "opening notes before Characters",
        {
          title: "Play",
          characters: [{ name: "MARA", description: "a hydrologist" }],
          openingNotes: "## Setting\n\nA kitchen.",
          openingNotesBeforeCharacters: true,
        },
      ],
      [
        "the old Setting, Time and Place fields",
        { title: "Play", setting: "A kitchen.\nThe sea beyond.", time: "  ", place: "The coast." },
      ],
      [
        "production notes with a list and empty paragraphs",
        {
          productionNotes:
            "## Casting\n\nSix actors.\n\n\n\n- A slash marks an overlap.\n- Brackets are unspoken.\n\nNo interval.",
        },
      ],
      ["production notes of white space", { title: "Play", productionNotes: "\n \n" }],
      [
        "everything at once",
        {
          title: "The Weight of Water",
          credit: "a play by",
          authors: ["A. Playwright", "B. Playwright"],
          contact: ["playwright@example.com", "(555) 010-0199"],
          draftDate: "2026-06-18",
          characters: [
            { name: "MARA", description: "a hydrologist, 40s" },
            { name: "JONAH", description: "her brother, 30s" },
          ],
          setting: "A coastal kitchen, and the rooms of memory around it.",
          time: "The last night of winter.",
          productionNotes: "A slash ( / ) marks where the next speaker begins.",
        },
      ],
    ];
    for (const [what, fm] of cases) printsTheSame(fm, what);
  });

  it("for 800 generated front matters", () => {
    const next = generator(20261116);
    for (let i = 0; i < 800; i++) printsTheSame(next(), `generated #${i}`);
  });

  it("writes no file for a page the play does not print", () => {
    expect(legacyPageFiles(null)).toEqual([]);
    expect(legacyPageFiles({ titlePage: "", charactersPage: "", openingNotes: "" })).toEqual([]);
    expect(legacyPageFiles({ authors: ["A. Writer"], productionNotes: "\n\n" })).toEqual([]);
    expect(
      legacyPageFiles({
        title: "Play",
        characters: [{ name: "MARA" }],
        setting: "A kitchen.",
        productionNotes: "Notes.",
      }).map((f) => [f.kind, f.name]),
    ).toEqual([
      ["title", "Title Page"],
      ["characters", "Characters"],
      ["setting", "Setting"],
      ["production", "Production Notes"],
    ]);
  });
});

describe("a play whose pages are files", () => {
  const fm: FrontMatter = {
    title: "The Weight of Water",
    authors: ["A. Playwright"],
    contact: ["playwright@example.com"],
    characters: [{ name: "MARA", description: "a hydrologist, 40s" }],
    setting: "A coastal kitchen.",
    productionNotes: "Six actors play every role.",
  };
  const asFiles = (front: FrontMatter): FrontMatter => ({
    ...front,
    pages: legacyPageFiles(front).map((file, i) => ({
      id: `p${i}`,
      name: file.name,
      text: file.text,
    })),
  });
  /** Each sheet's rows and words, whatever its kind is called. */
  const words = (sheets: FrontMatterPage[]) => printed(sheets).map((sheet) => sheet.lines);

  it("prints its files, through the same layout, as the fields and texts printed", () => {
    for (const spec of sheetFormats)
      expect(words(paginateFrontMatter(asFiles(fm), spec))).toEqual(
        words(paginateFrontMatter(fm, spec)),
      );
  });

  it("prints them in the folder's order, named by their files, the title page as the title page", () => {
    const front = asFiles(fm);
    const reordered: FrontMatter = {
      ...front,
      pages: [front.pages![2]!, front.pages![0]!, { id: "d", name: "Dedication", text: "For M." }],
    };
    const sheets = paginateFrontMatter(reordered, dg);
    expect(sheets.map((s) => [s.kind, s.label])).toEqual([
      ["page:p2", "Setting"],
      ["title", "Title Page"],
      ["page:d", "Dedication"],
    ]);
    expect(sheets.map((s) => frontSheetLabel(s).label)).toEqual([
      "Setting",
      "Title Page",
      "Dedication",
    ]);
    // A play with no page files is named as it always was.
    expect(paginateFrontMatter(fm, dg).map((s) => frontSheetLabel(s).label)).toEqual([
      "Title page",
      "Characters page",
      "Opening notes",
      "Production notes",
    ]);
  });

  it("flows them as one opening in an inline format, the format's gap between pages", () => {
    const sketch = builtinFormats().find((spec) => spec.frontMatter.placement === "inline")!;
    const pages = layoutFrontPages(
      [
        pageFromFile("a", "a", "First page.", {}, sketch.frontMatter),
        pageFromFile("b", "b", "Second page.", {}, sketch.frontMatter),
      ],
      sketch,
    );
    expect(pages.map((p) => p.kind)).toEqual(["a", "b"]);
    const front: FrontMatter = {
      pages: [
        { id: "a", name: "One", text: "First page." },
        { id: "b", name: "Two", text: "Second page." },
      ],
    };
    // No sheets of their own: the opening is the first numbered page's, from the same pages.
    expect(paginateFrontMatter(front, sketch)).toEqual([]);
    const result = paginateDoc(
      {
        type: "doc",
        content: [{ type: "action", content: [{ type: "text", text: "Lights up." }] }],
      },
      sketch,
      { frontMatter: front },
    );
    const intro = result.pages[0]!.intro ?? [];
    expect(intro.map((line) => line.text)).toEqual(["First page.", "Second page."]);
    expect(intro[1]!.row - intro[0]!.row).toBe(1 + sketch.frontMatter.fieldGapRows);
  });
});
