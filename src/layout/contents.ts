// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A play's contents: its acts and scenes, each with the page it starts on
 * (docs/app/formatting/formats-and-layout.md#FMT-179). A page shows them
 * through a field, `{contents}`, as it shows the play's details through
 * theirs, so they follow the script: nothing is typed, and nothing goes stale.
 *
 * The rows are text on the script's own grid, a name and its page with a row
 * of leader dots between, every row the same width. So they print the same
 * in the page view, a PDF, a word processor's file and a Fountain file, none
 * of which needs to know what a table of contents is. They stop two cells
 * short of the text block's right edge: a row that filled the block to its
 * last cell is the one a word processor's own wrapping would break.
 *
 * A name is the heading as the format prints it, so an act the writer called
 * "ACT ONE: THE FLOOD" is listed by that name. Scenes are the script's scene
 * lines, or its scene headings when it has none (as the Outline counts
 * them); under an act they stand two cells in. A blank row parts one act
 * from the next.
 *
 * The page is the number of the script's page the heading's first line is
 * on. Where a format's opening runs in with the first numbered page, the
 * contents are part of what the script is paginated around, so the script is
 * paginated with rows of the same count standing in for them: a row is one
 * line whatever its number.
 */
import type { Doc } from "../fountain/model";
import { charsPerLine } from "../format/metrics";
import { textBlockWidthIn, type FormatSpec } from "../format/spec";
import { blocksFromDoc, paginate, type LayoutBlock, type LayoutMeta } from "./engine";

/** The cells left clear at the right of the text block. */
const SLACK = 2;
/** How far a scene stands in under its act. */
const INDENT = 2;

/** One act or scene of the play, by the block of the script that heads it. */
export interface ContentsEntry {
  /** 0 for an act, or a scene of a play with no acts; 1 for a scene under an act. */
  level: 0 | 1;
  label: string;
  /** The block's place in the script (`LayoutBlock.sourceIndex`). */
  index: number;
  act: boolean;
}

/** The width of a row of the contents, in cells. */
export function contentsWidth(spec: FormatSpec): number {
  return Math.max(24, charsPerLine(spec, textBlockWidthIn(spec)) - SLACK);
}

/** The play's acts and scenes, in order, named as the format prints them. */
export function contentsEntries(blocks: readonly LayoutBlock[]): ContentsEntry[] {
  const sceneType = blocks.some((b) => b.type === "scene") ? "scene" : "sceneHeading";
  const acts = blocks.some((b) => b.type === "act");
  const out: ContentsEntry[] = [];
  let scene = 0;
  for (const block of blocks) {
    if (block.type === "act") {
      scene = 0;
      out.push({
        level: 0,
        label: block.text.trim() || "Act",
        index: block.sourceIndex,
        act: true,
      });
    } else if (block.type === sceneType) {
      scene += 1;
      out.push({
        level: acts ? 1 : 0,
        label: block.text.trim() || `Scene ${scene}`,
        index: block.sourceIndex,
        act: false,
      });
    }
  }
  return out;
}

/** A name broken at its spaces into lines of `room` cells; a word longer than that is cut. */
function wrap(label: string, room: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > room) {
      if (line) lines.push(line);
      lines.push(rest.slice(0, room));
      rest = rest.slice(room);
      line = "";
    }
    if (!line) line = rest;
    else if (line.length + 1 + rest.length <= room) line += ` ${rest}`;
    else {
      lines.push(line);
      line = rest;
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/**
 * The contents as lines of text: each entry's name, leader dots on every
 * other cell so that they stand under one another down the page, and its
 * page at the right. A long name runs on to a second line, which carries the
 * page. An entry with no page (the rows that stand in while the script is
 * paginated) is its name alone. A blank line stands before every act but the
 * first.
 */
export function contentsLines(
  entries: readonly ContentsEntry[],
  pageOf: (entry: ContentsEntry) => number | null,
  width: number,
  /** Whether an act carries its page: off, an act is its name alone, over its scenes. */
  actPages = true,
): string[] {
  const out: string[] = [];
  entries.forEach((entry, i) => {
    if (entry.act && i > 0) out.push("");
    const lead = " ".repeat(entry.level * INDENT);
    const page = entry.act && !actPages ? null : pageOf(entry);
    const tail = page === null ? "" : ` ${page}`;
    // Room for the name on the row that carries the page: the page, and at
    // least two leader dots before it.
    const room = Math.max(8, width - lead.length - tail.length - 4);
    const names = wrap(entry.label, room);
    names.forEach((name, n) => {
      let row = `${lead}${n ? " ".repeat(INDENT) : ""}${name}`;
      if (n === names.length - 1 && tail) {
        row += " ";
        while (row.length < width - tail.length) row += row.length % 2 ? "." : " ";
        row += tail;
      }
      out.push(row);
    });
  });
  return out;
}

/**
 * The play's contents for a format: every act and scene with the page it
 * starts on, as the lines a page's `{contents}` prints, and the same with no
 * page beside an act, as `{contents acts=plain}` prints them
 * (docs/app/formatting/formats-and-layout.md#FMT-184): an act's page is its
 * first scene's whenever that scene opens it. Both from one pagination of the
 * script. Empty for a script with no act and no scene.
 */
export function contentsBothFor(
  doc: Doc | null,
  spec: FormatSpec,
  meta: LayoutMeta = {},
): { lines: string[]; plainActs: string[] } {
  if (!doc) return { lines: [], plainActs: [] };
  const blocks = blocksFromDoc(doc, spec);
  const entries = contentsEntries(blocks);
  if (!entries.length) return { lines: [], plainActs: [] };
  const width = contentsWidth(spec);
  // The rows that stand in: the same count of lines, whatever the numbers.
  const standIn = contentsLines(entries, () => null, width);
  const layout = paginate(blocks, spec, {
    ...meta,
    ...(meta.frontMatter ? { frontMatter: { ...meta.frontMatter, contents: standIn } } : {}),
  });
  const firstOn = new Map<number, number>();
  for (const page of layout.pages)
    for (const line of page.lines)
      if (line.sourceIndex >= 0 && !firstOn.has(line.sourceIndex))
        firstOn.set(line.sourceIndex, page.pageNumber);
  const pageOf = (entry: ContentsEntry) => firstOn.get(entry.index) ?? null;
  return {
    lines: contentsLines(entries, pageOf, width),
    plainActs: contentsLines(entries, pageOf, width, false),
  };
}

/** The play's contents for a format, every act and scene with its page. */
export function contentsFor(doc: Doc | null, spec: FormatSpec, meta: LayoutMeta = {}): string[] {
  return contentsBothFor(doc, spec, meta).lines;
}

/** Whether any page of the play lists its contents, so that they are worth working out. */
export function listsContents(pages: readonly { text: string }[] | null | undefined): boolean {
  return (pages ?? []).some((page) => /\{contents[ }]/.test(page.text));
}

/** Whether any page of the play lists everyone who speaks (`{cast}`). */
export function listsCast(pages: readonly { text: string }[] | null | undefined): boolean {
  return (pages ?? []).some((page) => /\{cast[ }]/.test(page.text));
}
