// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Moving a block of a page to another place on its sheet
 * (docs/app/formatting/formats-and-layout.md#FMT-182).
 *
 * A page is still lines in order, and a place is never a loose position on the
 * paper: it is written as the blank rows above a block, the cell its lines
 * start at, and whether it stands beside the block before it (`Place`,
 * src/markdown/page-fields.ts). So a move rewrites the page's file: the block
 * goes where the sheet's reading order now has it, takes the rows and the cell
 * that put it where it was dropped, and every block whose neighbour changed
 * takes the rows that keep it where it was.
 *
 * Nothing here trusts its own arithmetic. A move is written, laid out by the
 * one paginator, and kept only when the block stands where it was asked to and
 * every other block of the page stands where it did; otherwise there is no
 * move. Two blocks never print over each other, since the paginator would put
 * the second under the first and the check would see it.
 */
import type { FrontMatter } from "../fountain/model";
import type { FormatSpec } from "../format/spec";
import { charsPerLine } from "../format/metrics";
import { maxLinesPerPage, textBlockWidthIn } from "../format/spec";
import { toDoc, toMarkdown, type Node } from "../markdown/doc";
import { FIELD_PROMPT } from "../markdown/page-fields";
import { placeFrontPage, type PlacedSpan } from "./engine";
import { pageFromFile, readPageFile, writePageFile } from "./page-files";

export type PageBand = "head" | "main" | "foot";

/** Where one block of a page stands on its first sheet. */
export interface PageSpot {
  /** Which of the page's top-level blocks it is, as its editor holds them. */
  index: number;
  band: PageBand;
  /** Its first row, from the top of the text block. */
  row: number;
  /** The rows it takes. */
  height: number;
  /** The cell its leftmost line starts at, and the cells its longest line takes. */
  cell: number;
  width: number;
  /** Each of its printed lines. */
  lines: PlacedSpan[];
  /** A blank row. */
  blank: boolean;
  /** A paragraph or a heading on the page's first sheet: what can be moved. */
  movable: boolean;
}

/** The sheet a page's blocks stand on, in rows and cells of the format. */
export interface PageGrid {
  /** Rows of the text block. */
  rows: number;
  /** Cells across the text block. */
  cells: number;
  /** The row the page's own first line stands on. */
  mainTop: number;
  /** The row under the last row a foot can take. */
  bottom: number;
}

export interface PageSpots {
  grid: PageGrid;
  spots: PageSpot[];
  /** How many sheets the page prints on. */
  sheets: number;
}

/**
 * A play's details with a prompt in each that has none: the page as its
 * editor shows it, where a field with nothing in it is still a line to fill
 * in (docs/app/formatting/formats-and-layout.md#FMT-180). A move is worked
 * out on that page, since that is the page being looked at.
 */
export function shownDetails(fm: FrontMatter | null | undefined): FrontMatter {
  const has = (text: string | undefined) => !!text?.trim();
  return {
    ...fm,
    title: has(fm?.title) ? fm!.title : FIELD_PROMPT.title,
    subtitle: has(fm?.subtitle) ? fm!.subtitle : FIELD_PROMPT.subtitle,
    credit: has(fm?.credit) ? fm!.credit : fm?.authors?.length ? "by" : FIELD_PROMPT.credit,
    authors: fm?.authors?.some(has) ? fm.authors : [FIELD_PROMPT.author],
    contact: fm?.contact?.some(has) ? fm.contact : [FIELD_PROMPT.contact],
    draftDate: has(fm?.draftDate) ? fm!.draftDate : FIELD_PROMPT.draftDate,
    version: has(fm?.version) ? fm!.version : FIELD_PROMPT.version,
    source: has(fm?.source) ? fm!.source : FIELD_PROMPT.source,
    contents: fm?.contents?.some(has) ? fm.contents : [FIELD_PROMPT.contents],
  };
}

interface Read extends PageSpots {
  file: ReturnType<typeof readPageFile>;
  nodes: Node[];
  bandOf: (index: number) => PageBand;
}

const PLACE_ATTRS = ["placeRows", "placeCell", "placeBeside"] as const;

function gridOf(spec: FormatSpec, mainTop: number): PageGrid {
  const rows = Math.max(1, maxLinesPerPage(spec));
  return {
    rows,
    cells: charsPerLine(spec, textBlockWidthIn(spec)),
    mainTop,
    bottom: rows - spec.frontMatter.contactBottomRows,
  };
}

function read(text: string, fm: FrontMatter, spec: FormatSpec): Read {
  const file = readPageFile(text);
  const nodes = file.body.trim() ? (toDoc(file.body, { pageFile: true }).content ?? []) : [];
  const headAt = nodes.findIndex((node) => node.type === "head");
  const footAt = nodes.findIndex((node) => node.type === "foot");
  const bandOf = (index: number): PageBand =>
    footAt >= 0 && index > footAt ? "foot" : headAt >= 0 && index < headAt ? "head" : "main";
  const from = { head: 0, main: headAt + 1, foot: footAt + 1 };
  const laid = placeFrontPage(pageFromFile("page", "p", text, fm, spec.frontMatter), spec);
  const spots = new Map<number, PageSpot>();
  for (const block of laid.placed) {
    if (block.top === undefined) continue;
    const index = from[block.band] + block.top;
    const node = nodes[index];
    if (!node) continue;
    const rows = block.lines.map((line) => line.row);
    const last = block.blank ? block.row : Math.max(block.row, ...rows);
    const cell = block.lines.length ? Math.min(...block.lines.map((line) => line.from)) : 0;
    const right = block.lines.length ? Math.max(...block.lines.map((line) => line.to)) : 0;
    const known = spots.get(index);
    if (known) {
      // A list is one block of the editor's and a paragraph an item.
      const under = Math.max(known.row + known.height, last + 1);
      known.lines.push(...block.lines);
      known.cell = Math.min(known.cell, cell);
      known.width = Math.max(known.cell + known.width, right) - known.cell;
      known.height = under - known.row;
      continue;
    }
    spots.set(index, {
      index,
      band: block.band,
      row: block.row,
      height: last + 1 - block.row,
      cell,
      width: right - cell,
      lines: [...block.lines],
      blank: block.blank,
      movable: block.sheet === 0 && (node.type === "paragraph" || node.type === "heading"),
    });
  }
  return {
    file,
    nodes,
    bandOf,
    grid: gridOf(spec, laid.mainTop),
    spots: [...spots.values()].sort((a, b) => a.index - b.index),
    sheets: laid.sheets.filter((sheet) => sheet.lines.length).length,
  };
}

/** Where each block of a page stands, for the page's own editor. `fm` is the page as shown (`shownDetails`). */
export function pageSpots(text: string, fm: FrontMatter, spec: FormatSpec): PageSpots {
  const { grid, spots, sheets } = read(text, fm, spec);
  return { grid, spots, sheets };
}

/** Where to put a block: its first row, and where across the sheet, when that changes too. */
export interface MoveTo {
  /** The row its first line should stand on; the nearest the page has is taken. */
  row: number;
  /** The cell its lines should start at. At the sheet's left it is set left, at its right, right. */
  cell?: number;
  /** Set it so instead, wherever `cell` says. */
  align?: "left" | "center" | "right";
}

export interface Moved {
  /** The page's file, rewritten. */
  text: string;
  /** Which of its top-level blocks the moved one now is. */
  index: number;
  band: PageBand;
  row: number;
  cell: number;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

function without(
  node: { attrs?: Record<string, unknown> },
  keys: readonly string[],
): Record<string, unknown> {
  const attrs = { ...(node.attrs ?? {}) };
  for (const key of keys) delete attrs[key];
  return attrs;
}

function withAttrs(node: Node, attrs: Record<string, unknown>): Node {
  const { attrs: _old, ...rest } = node;
  return Object.keys(attrs).length ? { ...rest, attrs } : rest;
}

/** One block being arranged: where it must stand, and the node that holds it. */
interface Item {
  origin: number;
  node: Node;
  row: number;
  height: number;
  cell: number;
  blank: boolean;
  settable: boolean;
  /** Nodes that print nothing and follow it in the file. */
  riders: Node[];
}

/**
 * The block at `index` moved to `to`, or null when it cannot stand there: the
 * place is off the sheet, another block's words are in the way, or the page
 * would no longer keep its other blocks where they are.
 */
export function movePageBlock(
  text: string,
  fm: FrontMatter,
  spec: FormatSpec,
  index: number,
  to: MoveTo,
): Moved | null {
  const page = read(text, fm, spec);
  const self = page.spots.find((spot) => spot.index === index);
  if (!self?.movable || spec.frontMatter.placement === "inline") return null;
  const { grid } = page;
  const others = page.spots.filter((spot) => spot.index !== index);
  const of = (band: PageBand) => others.filter((spot) => spot.band === band);
  const under = (spots: PageSpot[]) => Math.max(0, ...spots.map((spot) => spot.row + spot.height));
  const hasFoot = page.nodes.some((node) => node.type === "foot");

  // The band the place is in, and the nearest row of that band.
  const footWords = of("foot").filter((spot) => !spot.blank);
  const footTop = footWords.length ? Math.min(...footWords.map((spot) => spot.row)) : null;
  let band: PageBand;
  let row: number;
  if (grid.mainTop >= 1 && to.row < grid.mainTop - 0.5) {
    band = "head";
    row = Math.max(0, Math.min(Math.round(to.row), Math.ceil(grid.mainTop) - 1));
  } else if (
    hasFoot &&
    // A block of the foot stays in it anywhere under the page's own blocks;
    // another joins it from the foot's first words down.
    (self.band === "foot"
      ? to.row >= under(of("main")) - 0.01
      : footTop !== null && to.row >= footTop - 0.5)
  ) {
    band = "foot";
    row = grid.bottom - Math.round(grid.bottom - to.row);
    row = Math.min(row, grid.bottom - self.height);
  } else {
    band = "main";
    const ref = of("main")[0]?.row ?? (self.band === "main" ? self.row : grid.mainTop);
    row = ref + Math.round(to.row - ref);
    while (row < grid.mainTop - 0.01) row += 1;
  }
  if (row < 0 || row + self.height > grid.rows + 0.01) return null;

  // Where across the sheet: left alone, set by an alignment, or at a cell.
  const node = page.nodes[index]!;
  let attrs = without(node, PLACE_ATTRS);
  let cell: number | undefined =
    typeof node.attrs?.placeCell === "number" ? node.attrs.placeCell : undefined;
  if (to.align || to.cell !== undefined) {
    const at = Math.round(to.cell ?? 0);
    const align = to.align ?? (at <= 0 ? "left" : at + self.width >= grid.cells ? "right" : null);
    attrs = without({ attrs }, ["textAlign"]);
    cell = undefined;
    if (align === "center" || align === "right") attrs.textAlign = align;
    else if (align === null) cell = at;
  }

  // Every block of the page, by band, with the place it must have.
  const riders = new Map<number | PageBand, Node[]>();
  const items: Record<PageBand, Item[]> = { head: [], main: [], foot: [] };
  let lead: number | null = null;
  page.nodes.forEach((each, i) => {
    if (each.type === "head" || each.type === "foot") {
      lead = null;
      return;
    }
    const spot = i === index ? self : others.find((other) => other.index === i);
    if (!spot) {
      // It prints nothing: it stays behind the block it followed, or leads its band.
      const key = lead !== null && page.bandOf(lead) === page.bandOf(i) ? lead : page.bandOf(i);
      riders.set(key, [...(riders.get(key) ?? []), each]);
      return;
    }
    const moved = i === index;
    const settable = each.type === "paragraph" || each.type === "heading";
    items[moved ? band : spot.band].push({
      origin: i,
      node: moved ? withAttrs(each, attrs) : each,
      row: moved ? row : spot.row,
      height: spot.height,
      cell: moved ? (cell ?? (attrs.textAlign ? grid.cells : 0)) : spot.cell,
      blank: spot.blank,
      settable,
      riders: [],
    });
    lead = i;
  });
  for (const list of Object.values(items))
    for (const item of list) item.riders = riders.get(item.origin) ?? [];

  // A foot stands on the sheet's last rows: what holds it up from them is a
  // blank row at its end, written again for where the foot now ends.
  const foot = items.foot.sort((a, b) => a.row - b.row || a.cell - b.cell);
  while (foot.length && foot[foot.length - 1]!.blank && foot[foot.length - 1]!.origin !== index)
    foot.pop();
  const footUnder = Math.max(0, ...foot.map((item) => item.row + item.height));
  const spacer =
    foot.length && grid.bottom - footUnder >= 1
      ? [{ type: "paragraph", attrs: { placeRows: Math.round(grid.bottom - footUnder) - 1 } }]
      : [];

  /** A band's blocks in the order the sheet reads them, each with the rows that put it there. */
  const arrange = (list: Item[], start: number, loose: ReadonlySet<number>): Node[] => {
    const out: Node[] = [];
    let floor = start;
    let before: Item | null = null;
    for (const item of [...list].sort((a, b) => a.row - b.row || a.cell - b.cell)) {
      let made = item.node;
      if (item.settable) {
        const place: Record<string, unknown> = {};
        if (before && item.row < floor - 0.01) {
          place.placeBeside = true;
          const down = Math.round(item.row - before.row);
          if (down > 0) place.placeRows = down;
        } else if (!loose.has(item.origin))
          place.placeRows = Math.max(0, Math.round(item.row - floor));
        const kept = without(item.node, ["placeRows", "placeBeside"]);
        if (item.origin === index) {
          delete kept.placeCell;
          if (cell !== undefined) place.placeCell = cell;
        }
        made = withAttrs(item.node, { ...kept, ...place });
      }
      out.push(made, ...item.riders);
      floor = Math.max(floor, item.row + item.height);
      before = item;
    }
    return out;
  };
  const write = (loose: ReadonlySet<number>) => {
    const head = arrange(items.head, 0, loose);
    const headUnder = Math.max(0, ...items.head.map((item) => item.row + item.height));
    const main = arrange(items.main, Math.max(grid.mainTop, headUnder), loose);
    const footNodes = arrange(foot, foot[0]?.row ?? 0, loose);
    const content = [
      ...(riders.get("head") ?? []),
      ...head,
      ...(head.length ? [{ type: "head" }] : []),
      ...(riders.get("main") ?? []),
      ...main,
      ...(footNodes.length || riders.get("foot")?.length
        ? [{ type: "foot" }, ...(riders.get("foot") ?? []), ...footNodes, ...spacer]
        : []),
    ];
    return writePageFile(
      { layout: page.file.layout, exports: page.file.exports },
      toMarkdown({ type: "doc", content }, { emptyLines: true, blankRows: true }),
    );
  };

  /** The written page, when it prints the move and nothing else: where the moved block now is. */
  const holds = (written: string): Moved | null => {
    const now = read(written, fm, spec);
    if (now.sheets > Math.max(1, page.sheets)) return null;
    // The blocks in their new order, against where each had to be.
    const want = [...items.head, ...items.main, ...foot];
    const got = now.spots.filter((spot) => !(spot.band === "foot" && spot.blank));
    const wanted = want.filter((item) => !(foot.includes(item) && item.blank));
    if (got.length !== wanted.length) return null;
    const order = [...wanted].sort((a, b) => {
      const bandsApart = bandRank(a, items) - bandRank(b, items);
      return bandsApart || a.row - b.row || a.cell - b.cell;
    });
    let found: Moved | null = null;
    for (const [i, item] of order.entries()) {
      const spot = got[i]!;
      if (!near(spot.row, item.row)) return null;
      if (item.origin === index)
        found = {
          text: written,
          index: spot.index,
          band: spot.band,
          row: spot.row,
          cell: spot.cell,
        };
      else if (!near(spot.cell, item.cell)) return null;
    }
    return found;
  };

  // Every block told its rows; then each that the format's own gap would put
  // in the same place is left to it, so a file says only what a writer did.
  let best = holds(write(new Set()));
  if (!best) return null;
  const loose = new Set<number>();
  for (const item of [...items.head, ...items.main, ...foot]) {
    if (!item.settable) continue;
    loose.add(item.origin);
    const tried = holds(write(loose));
    if (tried) best = tried;
    else loose.delete(item.origin);
  }
  // A place the block already has is no move.
  if (near(best.row, self.row) && near(best.cell, self.cell) && best.band === self.band)
    return null;
  return best;
}

function bandRank(item: Item, items: Record<PageBand, Item[]>): number {
  return items.head.includes(item) ? 0 : items.main.includes(item) ? 1 : 2;
}

export type MoveStep = "up" | "down" | "left" | "right";

/**
 * The block at `index` moved one step: a row up or down, a cell left or
 * right. Where another block's words are in the way it goes on to the next
 * place past them, as a line moved by the keys steps over the line under it.
 */
export function stepPageBlock(
  text: string,
  fm: FrontMatter,
  spec: FormatSpec,
  index: number,
  step: MoveStep,
): Moved | null {
  const { grid, spots } = read(text, fm, spec);
  const self = spots.find((spot) => spot.index === index);
  if (!self?.movable) return null;
  if (step === "up" || step === "down") {
    const way = step === "up" ? -1 : 1;
    for (let by = 1; by <= grid.rows; by++) {
      const row = self.row + way * by;
      if (row < -0.5 || row > grid.rows) break;
      const moved = movePageBlock(text, fm, spec, index, { row });
      if (moved && !near(moved.row, self.row)) return moved;
    }
    return null;
  }
  const way = step === "left" ? -1 : 1;
  const from = way < 0 ? Math.ceil(self.cell - 0.01) : Math.floor(self.cell + 0.01);
  for (let by = 1; by <= grid.cells; by++) {
    const cell = from + way * by;
    if (cell < 0 || cell + self.width > grid.cells) break;
    const moved = movePageBlock(text, fm, spec, index, { row: self.row, cell });
    if (moved && !near(moved.cell, self.cell)) return moved;
  }
  return null;
}
