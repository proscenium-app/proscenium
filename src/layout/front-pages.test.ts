// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pages before the script, laid out by one loop for every page
 * (src/layout/front-pages.ts, `layoutFrontPages` in src/layout/engine.ts),
 * print exactly what the four hand-written sheets printed before them: the
 * same lines, rows, positions, styles, ids and roles, sheet for sheet. The
 * layout they replaced is kept below, as it stood on main at cf814ea9, and
 * every front matter is laid out both ways: the sample plays, the cases each
 * rule was written for, and a sweep of generated front matters, under all
 * seven built-in formats with their sheets separate and inline.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { builtinFormats } from "../format";
import { charAdvanceIn, charsPerLine } from "../format/metrics";
import {
  linePitchIn,
  maxLinesPerPage,
  pageSizeIn,
  textBlockWidthIn,
  type ElementAlign,
  type FormatSpec,
} from "../format/spec";
import { parse } from "../fountain";
import type { FrontMatter } from "../fountain/model";
import {
  layoutFrontPages,
  paginateFrontMatter,
  wrapText,
  type FrontMatterLine,
  type FrontSheetKind,
  type StyleRun,
} from "./engine";
import { frontPagesOf, PRODUCTION_NOTES_HEADING } from "./front-pages";
import { openingParagraphs } from "./opening-prose";

/** A sheet as the old layout made one: only ever one of the four kinds. */
interface FrontMatterPage {
  kind: FrontSheetKind;
  lines: FrontMatterLine[];
}

/**
 * The layout this file holds the new one to: main's `layoutFrontMatter` at
 * cf814ea9, copied unchanged. Not app code: nothing outside this test runs it.
 */
function layoutFrontMatter(
  fm: FrontMatter | null | undefined,
  spec: FormatSpec,
): FrontMatterPage[] {
  if (!fm) return [];
  const policy = spec.frontMatter;
  const width = textBlockWidthIn(spec);
  const cpl = charsPerLine(spec, width);
  const capacity = Math.max(1, maxLinesPerPage(spec));
  const pages: FrontMatterPage[] = [];
  let current: FrontMatterPage;
  let row = 0;
  const start = (kind: FrontSheetKind, at = policy.sectionTopRows) => {
    current = { kind, lines: [] };
    pages.push(current);
    row = Math.min(capacity - 1, Math.max(0, at));
  };
  const linesFor = (text: string) =>
    wrapText(text, cpl).map((line) => text.slice(line.start, line.end).replace(/ +$/, ""));
  const paragraph = (
    text: string,
    id: string,
    role: FrontMatterLine["role"] = "paragraph",
    align: ElementAlign = "left",
    fontStyle = policy.bodyFontStyle,
    gap = 0,
    keepWithNext = false,
    runs: StyleRun[] = [],
  ) => {
    if (!text.trim()) return;
    const lines = linesFor(text);
    const top = Math.min(capacity - 1, policy.sectionTopRows);
    const want = lines.length + (keepWithNext ? policy.headingGapRows + 1 : 0);
    // A short entry travels whole; an entry larger than a page splits. Never
    // create an empty sheet just to honor an impossible oversized gap.
    if (current.lines.length && row + gap + want > capacity && want <= capacity - top)
      start(current.kind);
    else if (current.lines.length) row += gap;
    let first = true;
    for (const wrapped of wrapText(text, cpl)) {
      const lineText = text.slice(wrapped.start, wrapped.end).replace(/ +$/, "");
      if (row + 1 > capacity && current.lines.length) start(current.kind);
      row = Math.min(row, capacity - 1);
      const textWidth = lineText.length * charAdvanceIn(spec);
      const xIn =
        align === "center"
          ? Math.max(0, (width - textWidth) / 2)
          : align === "right"
            ? Math.max(0, width - textWidth)
            : 0;
      const clipped = runs
        .filter((r) => r.end > wrapped.start && r.start < wrapped.start + lineText.length)
        .map((r) => ({
          ...r,
          start: Math.max(0, r.start - wrapped.start),
          end: Math.min(lineText.length, r.end - wrapped.start),
        }));
      current.lines.push({
        text: lineText,
        row,
        xIn,
        fontStyle,
        align,
        paragraphId: id,
        role,
        ...(clipped.length ? { runs: clipped } : {}),
        ...(first ? { source: { text, runs, gapRows: gap } } : {}),
      });
      first = false;
      row += 1;
    }
  };
  const prose = (value: string, kind: FrontSheetKind, separate: boolean) => {
    if (!value.trim()) return;
    if (separate)
      start(
        kind,
        kind === "title"
          ? (pageSizeIn(spec).heightIn * policy.titleTopFraction - spec.page.margins.top) /
              linePitchIn(spec)
          : policy.sectionTopRows,
      );
    for (const [i, p] of openingParagraphs(value).entries()) {
      paragraph(
        p.text,
        `${kind}-prose-${i}`,
        p.heading ? "heading" : "paragraph",
        p.align,
        p.heading ? policy.headingFontStyle : policy.bodyFontStyle,
        i ? policy.fieldGapRows : 0,
        p.heading,
        p.runs,
      );
    }
  };
  /**
   * The production notes, after every other opening page, so they are the
   * last thing read before the script. They start a sheet of their own under
   * a heading the format sets as it sets CHARACTERS; inline, they close the
   * compact opening (docs/app/formatting/formats-and-layout.md#FMT-160). Each
   * paragraph's id keeps its place among the notes' paragraphs, which is how a
   * double-click finds it in the editor
   * (docs/app/formatting/formats-and-layout.md#FMT-161).
   */
  const productionNotes = (separate: boolean) => {
    const notes = (fm.productionNotes?.trim() ? openingParagraphs(fm.productionNotes) : [])
      .map((p, index) => ({ ...p, index }))
      .filter((p) => p.text.trim());
    if (!notes.length) return;
    if (separate) start("production");
    paragraph(
      PRODUCTION_NOTES_HEADING,
      "production-heading",
      "heading",
      separate ? "center" : "left",
      policy.headingFontStyle,
      policy.fieldGapRows,
      true,
    );
    notes.forEach((p, i) =>
      paragraph(
        p.text,
        `production-prose-${p.index}`,
        p.heading ? "heading" : "paragraph",
        p.align,
        p.heading ? policy.headingFontStyle : policy.bodyFontStyle,
        i ? policy.fieldGapRows : policy.headingGapRows,
        p.heading,
        p.runs,
      ),
    );
  };
  if (policy.placement === "inline") {
    start("title");
    if (fm.titlePage !== undefined) prose(fm.titlePage, "title", false);
    else {
      paragraph(fm.title?.toUpperCase() ?? "", "title", "heading", "left", policy.titleFontStyle);
      const credit = fm.credit ?? (fm.authors?.length ? "by" : "");
      paragraph(
        [credit, fm.authors?.join(", ")].filter(Boolean).join(" "),
        "authors",
        "paragraph",
        "left",
        policy.bodyFontStyle,
        policy.titleGapRows,
      );
      paragraph(fm.draftDate ?? "", "draft-date");
      for (const [i, text] of (fm.contact ?? []).entries()) paragraph(text, `contact-${i}`);
    }
    if (fm.openingNotesBeforeCharacters && fm.openingNotes !== undefined)
      prose(fm.openingNotes, "setting", false);
    if (fm.charactersPage !== undefined) prose(fm.charactersPage, "characters", false);
    else if (fm.characters?.length) {
      const cast = fm.characters
        .map((c) => (c.description ? `${c.name} (${c.description})` : c.name))
        .join(", ");
      paragraph(
        `Characters: ${cast}`,
        "characters",
        "paragraph",
        "left",
        policy.bodyFontStyle,
        policy.fieldGapRows,
      );
    }
    if (fm.openingNotes !== undefined) {
      if (!fm.openingNotesBeforeCharacters) prose(fm.openingNotes, "setting", false);
    } else
      for (const [label, value] of [
        ["Setting", fm.setting],
        ["Time", fm.time],
        ["Place", fm.place],
      ] as const) {
        if (value?.trim()) paragraph(`${label}: ${value}`, label);
      }
    productionNotes(false);
    return pages.filter((page) => page.lines.length);
  }
  if (fm.titlePage !== undefined) prose(fm.titlePage, "title", true);
  else if (fm.title?.trim()) {
    const titleTop =
      (pageSizeIn(spec).heightIn * policy.titleTopFraction - spec.page.margins.top) /
      linePitchIn(spec);
    start("title", titleTop);
    paragraph(fm.title.toUpperCase(), "title", "heading", "center", policy.titleFontStyle);
    paragraph(
      fm.credit ?? (fm.authors?.length ? "by" : ""),
      "credit",
      "paragraph",
      "center",
      policy.bodyFontStyle,
      policy.titleGapRows,
    );
    paragraph(
      fm.authors?.join(", ") ?? "",
      "authors",
      "paragraph",
      "center",
      policy.bodyFontStyle,
      policy.titleGapRows,
    );
    const contact: { text: string; id: string; gap: number }[] = [];
    let blanks = 0;
    (fm.contact ?? []).forEach((text, i) => {
      if (text.trim()) {
        contact.push({ text, id: `contact-${i}`, gap: blanks });
        blanks = 0;
      } else blanks++;
    });
    if (fm.draftDate)
      contact.push({
        text: fm.draftDate,
        id: "draft-date",
        gap: contact.length ? blanks + policy.fieldGapRows : 0,
      });
    const height = contact.reduce(
      (sum, item) => sum + (item.text.trim() ? linesFor(item.text).length : 0) + item.gap,
      0,
    );
    if (height) {
      row = Math.max(
        row + policy.titleContactGapRows,
        capacity - policy.contactBottomRows - height,
      );
      for (const item of contact)
        paragraph(
          item.text,
          item.id,
          "paragraph",
          policy.contactAlign,
          policy.bodyFontStyle,
          item.gap,
        );
    }
  }
  if (fm.openingNotesBeforeCharacters && fm.openingNotes !== undefined)
    prose(fm.openingNotes, "setting", true);
  if (fm.charactersPage !== undefined) prose(fm.charactersPage, "characters", true);
  else if (fm.characters?.length) {
    start("characters");
    paragraph(
      "CHARACTERS",
      "characters-heading",
      "heading",
      "center",
      policy.headingFontStyle,
      0,
      true,
    );
    fm.characters.forEach((character, i) => {
      const text = character.description
        ? `${character.name.toUpperCase()} — ${character.description}`
        : character.name.toUpperCase();
      paragraph(
        text,
        `cast-${i}`,
        "cast",
        "left",
        policy.bodyFontStyle,
        i ? policy.castGapRows : policy.headingGapRows,
      );
    });
  }
  const fields = [
    ["SETTING", fm.setting],
    ["TIME", fm.time],
    ["PLACE", fm.place],
  ] as const;
  if (fm.openingNotes !== undefined) {
    if (!fm.openingNotesBeforeCharacters) prose(fm.openingNotes, "setting", true);
  } else if (fields.some(([, value]) => value?.trim())) {
    start("setting");
    for (const [label, value] of fields) {
      if (!value?.trim()) continue;
      paragraph(
        label,
        `${label}-heading`,
        "heading",
        "left",
        policy.headingFontStyle,
        policy.fieldGapRows,
        true,
      );
      paragraph(value, label, "paragraph", "left", policy.bodyFontStyle);
    }
  }
  productionNotes(true);
  return pages.filter((page) => page.lines.length);
}

/** Each built-in format, as shipped and with its placement turned the other way. */
const specs: FormatSpec[] = builtinFormats().flatMap((spec) => [
  spec,
  {
    ...spec,
    frontMatter: {
      ...spec.frontMatter,
      placement: spec.frontMatter.placement === "inline" ? "separate-pages" : "inline",
    },
  },
]);

const now = (fm: FrontMatter | null | undefined, spec: FormatSpec) =>
  layoutFrontPages(frontPagesOf(fm, spec.frontMatter), spec);

function sameEverywhere(fm: FrontMatter | null | undefined, what: string) {
  for (const spec of specs) {
    const was = layoutFrontMatter(fm, spec);
    const is = now(fm, spec);
    if (!Bun.deepEquals(is, was, true))
      expect({ what, format: spec.id, placement: spec.frontMatter.placement, sheets: is }).toEqual({
        what,
        format: spec.id,
        placement: spec.frontMatter.placement,
        sheets: was,
      });
  }
}

/** Every .fountain under a folder of the repository. */
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

/** A small deterministic generator, so a failing case can be found again. */
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

describe("every page before the script is laid out by one loop", () => {
  it("as the sheets were for the sample plays and the fixtures", () => {
    const files = [
      ...scripts("sample-vault"),
      ...scripts("sample-outside"),
      ...scripts("scripts/store"),
    ];
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) sameEverywhere(parse(readFileSync(file, "utf8")).frontMatter, file);
  });

  it("for nothing, an empty front matter, and a title alone", () => {
    sameEverywhere(null, "null");
    sameEverywhere(undefined, "undefined");
    sameEverywhere({}, "empty");
    sameEverywhere({ title: "Play" }, "a title alone");
    sameEverywhere({ title: "   ", authors: ["A. Writer"] }, "authors with no title");
  });

  it("for each rule a sheet was written for", () => {
    const cast = Array.from({ length: 70 }, (_, i) => ({
      name: `PERSON ${i}`,
      description:
        i % 3 ? "a long description of who they are and what the play needs of them" : "",
    }));
    const cases: [string, FrontMatter][] = [
      ["a cast that runs to several sheets", { title: "Big Cast", characters: cast }],
      [
        "a title too long for a page",
        { title: "word ".repeat(600), authors: ["A. Writer"], contact: ["a@example.com"] },
      ],
      [
        "contact with blank lines, then a date",
        {
          title: "Play",
          contact: ["", "", "Agent Name", "", "agent@example.com"],
          draftDate: "June 2026",
        },
      ],
      ["a draft date and no contact", { title: "Play", draftDate: "2026-06-18" }],
      ["a credit and no author", { title: "Play", credit: "adapted from the novel" }],
      ["a title page written freely", { title: "Ignored", titlePage: "# Mine\n\nBy me" }],
      ["a title page written empty", { title: "Ignored", titlePage: "" }],
      [
        "a Characters page written empty over a cast",
        { title: "Play", charactersPage: "", characters: [{ name: "MARA" }] },
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
        { title: "Play", setting: "A kitchen.", time: "  ", place: "The coast." },
      ],
      [
        "production notes with a list and an empty paragraph",
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
    for (const [what, fm] of cases) sameEverywhere(fm, what);
  });

  it("for 800 generated front matters", () => {
    const next = generator(20261115);
    for (let i = 0; i < 800; i++) sameEverywhere(next(), `generated #${i}`);
  });

  it("and the public layout is the same pages", () => {
    const fm: FrontMatter = {
      title: "Play",
      characters: [{ name: "MARA" }],
      productionNotes: "Notes.",
    };
    for (const spec of specs)
      expect(paginateFrontMatter(fm, spec)).toEqual(
        spec.frontMatter.placement === "inline" ? [] : now(fm, spec),
      );
  });

  it("keeps the production notes' heading where the engine's consumers read it", () => {
    expect(PRODUCTION_NOTES_HEADING).toBe("PRODUCTION NOTES");
  });
});
