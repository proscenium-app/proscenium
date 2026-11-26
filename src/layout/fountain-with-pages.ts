// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * File › Export Fountain… (docs/app/formatting/formats-and-layout.md#FMT-171):
 * a script and its pages before the script as one `.fountain` file that any
 * Fountain app reads, so a script whose pages are files in its Front Matter
 * folder can still leave the folder whole.
 *
 * The file is the script as the app writes it, with the pages between its
 * title page and its first line, in Fountain's own terms: a heading or a
 * centered paragraph as centered text, in capitals for a heading; every other
 * paragraph as a stage direction forced with `!`, so that no reader takes a
 * line in capitals for a character's cue; bold, italic and underline as
 * Fountain's marks; a list's items one line each; a page break after each
 * page; and a note before and after the pages that says what they are. Each
 * page is read as the page view reads it (`openingParagraphs`, `fillFields`),
 * never parsed from its Markdown a second way.
 *
 * The pages after the script (docs/app/formatting/formats-and-layout.md#FMT-174)
 * follow its last line the same way, written by the same rules: each after a
 * page break, between two notes of their own.
 */
import { serializeInline } from "../fountain/inline";
import type {
  FrontMatter,
  FrontPageSource,
  InlineNode,
  MarkType,
  ParsedScript,
} from "../fountain/model";
import { serialize } from "../fountain/serialize";
import { serializeTitlePage } from "../fountain/titlepage";
import type { StyleRun } from "./engine";
import { type OpeningParagraph, openingParagraphs } from "./opening-prose";
import { FIELDS, FOOT_MARK, fillFields, readPageFile } from "./page-files";

/** The note the pages open with: what follows, and where it was written. */
export const PAGES_OPEN =
  "[[Proscenium: the pages before the script, as written in its Front Matter folder]]";
/** The note after the pages, before the script's first line. */
export const PAGES_CLOSE = "[[Proscenium: end of the pages before the script]]";
/** The note the pages after the script open with, after the script's last line. */
export const BACK_PAGES_OPEN =
  "[[Proscenium: the pages after the script, as written in its Back Matter folder]]";
/** The note after the last of them, which ends the file. */
export const BACK_PAGES_CLOSE = "[[Proscenium: end of the pages after the script]]";

/** Any field a page shows (page-files.ts). */
const FIELD = new RegExp(`\\{(?:${FIELDS.join("|")})\\}`, "g");
/** A list item's marker, as `openingParagraphs` writes it before the item's words. */
const LIST_MARKER = /^(?:• |\d+\. )/;
/**
 * A `!` a reader takes off the front of a later line of a stage direction:
 * any but one with a space after it. The line's own is written with a second,
 * which is the one taken (serialize.ts, `TAKEN_MARK`).
 */
const TAKEN_MARK = /^([^\S\n]*)!(?! )/;

/** A paragraph of a page, and the top-level block it came from in its part of the page. */
interface Paragraph {
  p: OpeningParagraph;
  /** Its block, by the part of the page it stands in: a list is one block. */
  block: string;
}

/** A page's paragraphs as the page view prints them: its words, then the words at its foot. */
function paragraphsOf(text: string): Paragraph[] {
  const lines = readPageFile(text).body.split("\n");
  const at = lines.findIndex((line) => line.trim() === FOOT_MARK);
  const part = (markdown: string, area: string): Paragraph[] =>
    openingParagraphs(markdown).map((p) => ({ p, block: `${area}:${p.block}` }));
  if (at < 0) return part(lines.join("\n"), "main");
  return [
    ...part(lines.slice(0, at).join("\n"), "main"),
    ...part(lines.slice(at + 1).join("\n"), "foot"),
  ];
}

/**
 * Whether a page's words are the play's details alone: the title page they
 * make, which the script's Fountain title page already is (`TITLE_PAGE_FILE`).
 */
function onlyFields(paragraphs: readonly Paragraph[]): boolean {
  return paragraphs.every(({ p }) => !p.text.replace(FIELD, "").trim());
}

/** A run's emphasis as the script's marks. */
function marksOf(run: StyleRun | undefined): MarkType[] {
  if (!run) return [];
  return [
    ...(run.bold ? (["strong"] as const) : []),
    ...(run.italic ? (["em"] as const) : []),
    ...(run.underline ? (["underline"] as const) : []),
  ];
}

/**
 * A paragraph's words, its fields filled in, as its lines: each the inline
 * text the script writes, with its emphasis. A heading's in capitals, run by
 * run, so a letter whose capital is longer moves no emphasis.
 */
function linesOf(p: OpeningParagraph, fm: FrontMatter): InlineNode[][] {
  const { text, runs } = fillFields(p.text, p.runs, fm);
  const cuts = [...new Set([0, text.length, ...runs.flatMap((r) => [r.start, r.end])])]
    .filter((at) => at >= 0 && at <= text.length)
    .sort((a, b) => a - b);
  let line: InlineNode[] = [];
  const lines = [line];
  let from = 0;
  for (const to of cuts) {
    const marks = marksOf(runs.find((r) => r.start <= from && r.end >= to));
    text
      .slice(from, to)
      .split("\n")
      .forEach((words, j) => {
        if (j) {
          line = [];
          lines.push(line);
        }
        if (!words) return;
        const written = p.heading ? words.toUpperCase() : words;
        line.push(
          marks.length
            ? { type: "text", text: written, marks: marks.map((type) => ({ type })) }
            : { type: "text", text: written },
        );
      });
    from = to;
  }
  return lines;
}

/** A line with no words: in Fountain, where one block ends and the next begins. */
const isBlank = (line: InlineNode[]) =>
  line.every((node) => node.type === "text" && !node.text.trim());

/**
 * Lines as the blocks a blank line parts them into: a line with no words is
 * written as the blank line between two blocks, so the lines after it are
 * forced again and no reader takes them for something else.
 */
function blocksOf(lines: InlineNode[][]): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of lines) {
    if (!isBlank(line)) block.push(serializeInline(line));
    else if (block.length) {
      blocks.push(block);
      block = [];
    }
  }
  if (block.length) blocks.push(block);
  return blocks;
}

/** Centered text: each line between the marks, as two centered lines in one block are read. */
const centered = (lines: string[]) => lines.map((line) => `> ${line} <`).join("\n");

/**
 * A stage direction forced with `!`, directly before its first character,
 * where every reader takes it; a later line's own `!` written twice.
 */
const forced = (lines: string[]) =>
  lines
    .map((line, i) => (i ? line.replace(TAKEN_MARK, "$1!!") : line.replace(/\S/, "!$&")))
    .join("\n");

/** One page as Fountain blocks: a list's items together, one line each. */
function pageBlocks(paragraphs: readonly Paragraph[], fm: FrontMatter): string[] {
  // Each paragraph's lines, or a whole list's, with how they are written.
  const groups: { lines: InlineNode[][]; center: boolean; list?: string }[] = [];
  for (const { p, block } of paragraphs) {
    const center = p.heading || p.align === "center";
    const last = groups[groups.length - 1];
    // A list item is a paragraph of a list's block, the first of each item
    // with its marker before its words; the rest of the list joins the first.
    const item = !center && (last?.list === block || LIST_MARKER.test(p.text));
    if (item && last?.list === block) last.lines.push(...linesOf(p, fm));
    else groups.push({ lines: linesOf(p, fm), center, ...(item ? { list: block } : {}) });
  }
  return groups.flatMap((group) => blocksOf(group.lines).map(group.center ? centered : forced));
}

/**
 * The pages before the script as the lines a Fountain file holds them in,
 * between the notes that open and close them; empty when no page has words of
 * its own. Every page goes, one unticked for export too: this is the whole
 * play. A page of fields alone is the title page, which the script's title
 * page already is, and is left out.
 */
export function pagesAsFountain(pages: readonly FrontPageSource[], fm: FrontMatter): string {
  const blocks = pages.flatMap((page) => {
    const paragraphs = paragraphsOf(page.text);
    if (onlyFields(paragraphs)) return [];
    const words = pageBlocks(paragraphs, fm);
    return words.length ? [...words, "==="] : [];
  });
  return blocks.length ? [PAGES_OPEN, ...blocks, PAGES_CLOSE].join("\n\n") : "";
}

/**
 * The pages after the script as the lines a Fountain file holds them in,
 * between the notes that open and close them; empty when no page prints a
 * word. Each page follows a page break, so another app starts it on a sheet of
 * its own, the first of them after the script's last page. Every page goes,
 * one unticked for export too, and a page of fields alone goes as what its
 * fields print: none of these is the title page the script's own already is.
 */
export function backPagesAsFountain(pages: readonly FrontPageSource[], fm: FrontMatter): string {
  const blocks = pages.flatMap((page) => {
    const words = pageBlocks(paragraphsOf(page.text), fm);
    return words.length ? ["===", ...words] : [];
  });
  return blocks.length ? [BACK_PAGES_OPEN, ...blocks, BACK_PAGES_CLOSE].join("\n\n") : "";
}

/**
 * The script as one Fountain file with its pages before the script in it
 * (docs/app/formatting/formats-and-layout.md#FMT-171): the script as
 * `serialize` writes it, and the pages between its title page and its first
 * line. `script.frontMatter` gives both the title page and the fields the
 * pages show; `pages` are the pages as the page view draws them
 * (`frontPageList`). The workspace hands it the front matter as the script is
 * written once its pages are files (`withoutPageKeys`), so pages still in the
 * title page's keys go out once, as pages. `backPages` are the pages after
 * the script (`backPageList`), which follow its last line. With no page to
 * write, the script as it is.
 */
export function fountainWithPages(
  script: ParsedScript,
  pages: readonly FrontPageSource[],
  backPages: readonly FrontPageSource[] = [],
): string {
  const written = serialize(script);
  const baked = pagesAsFountain(pages, script.frontMatter);
  const after = backPagesAsFountain(backPages, script.frontMatter);
  if (!baked && !after) return written;
  // `serialize` writes the title page, then the script after a blank line.
  const title = serializeTitlePage(script.frontMatter);
  const body = written.slice(title.length).replace(/^\n+/, "").replace(/\n*$/, "");
  return `${[title, baked, body, after].filter(Boolean).join("\n\n")}\n`;
}
