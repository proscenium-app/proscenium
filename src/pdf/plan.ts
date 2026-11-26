// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The export plan: *what* goes in the file, decided before anything is drawn.
 *
 * Two things are chosen here — which of the engine's pages to print, and which
 * unnumbered sheets stand before and after them (the pages before the script,
 * and the pages after it: docs/app/formatting/formats-and-layout.md#FMT-174) —
 * so the export dialog's preview and the PDF renderer answer those questions
 * from one place. The preview does
 * not load pdf-lib: this module uses the pure layout engine and is imported
 * by path rather than through `src/pdf/index.ts`.
 *
 * Page numbers here are always the PRINTED page numbers the reader sees in the
 * header — the same `LayoutPage.pageNumber` the engine assigned. Exporting a
 * slice therefore keeps each page's own number (send a director pages 12–20 and
 * they are still numbered 12–20), and the unnumbered sheets stay uncounted.
 */
import type { FrontMatter } from "../fountain";
import {
  paginateBackMatter,
  paginateFrontMatter,
  type FrontMatterPage,
  type FrontSheetKind,
  type LayoutPage,
  type LayoutResult,
  type StyleRun,
} from "../layout";
import type { FormatSpec } from "../format";

/* ------------------------------------------------------------------ */
/* Front matter                                                         */
/* ------------------------------------------------------------------ */

/** A page's kind, which an export ticks and names its sheets by: one of the
 * four the front matter's fields and texts print, or a page file's own. A page
 * after the script is always a page file's own, so one list of kinds holds the
 * sheets chosen on both sides of the script. */
export type FrontSheet = string;

/** What each of the four kinds of unnumbered sheet is called where a writer chooses it. */
export const FRONT_SHEET_LABEL: Record<FrontSheetKind, string> = {
  title: "Title page",
  characters: "Characters page",
  setting: "Opening notes",
  production: "Production notes",
};

/** The same sheets, named under a thumbnail. */
const FRONT_SHEET_SHORT: Record<FrontSheetKind, string> = {
  title: "Title",
  characters: "Characters",
  setting: "Notes",
  production: "Production",
};

/**
 * What a page is called where a writer chooses it, and under its thumbnail: a
 * page file by its own name, which is both; one of the four by the names above.
 */
export function frontSheetLabel(page: { kind: FrontSheet; label?: string }): {
  label: string;
  short: string;
} {
  if (page.label) return { label: page.label, short: page.label };
  const kind = page.kind as FrontSheetKind;
  return {
    label: FRONT_SHEET_LABEL[kind] ?? page.kind,
    short: FRONT_SHEET_SHORT[kind] ?? page.kind,
  };
}

/**
 * Which unnumbered sheets this play has, in the order the file holds them: the
 * front-matter sheets in standard American stage order, then the sheets of the
 * pages after the script. The renderer draws exactly these; the dialog names
 * exactly these.
 */
export function frontSheetsFor(fm: FrontMatter | null | undefined, spec: FormatSpec): FrontSheet[] {
  return [...paginateFrontMatter(fm, spec), ...paginateBackMatter(fm, spec)].map(
    (page) => page.kind,
  );
}

/** The kinds a run of front sheets holds, once each, in the order they print.
 * A cast list long enough to continue is still one choice. */
export function frontKindsOf(pages: readonly { kind: FrontSheet }[]): FrontSheet[] {
  return [...new Set(pages.map((page) => page.kind))];
}

/**
 * Keep the sheets of the chosen kinds. `null` keeps every one — which is what
 * the renderer draws when nobody has chosen.
 */
export function selectFrontMatter<T extends { kind: FrontSheet }>(
  pages: readonly T[],
  kinds: readonly FrontSheet[] | null | undefined,
): T[] {
  if (!kinds) return [...pages];
  const want = new Set(kinds);
  return pages.filter((page) => want.has(page.kind));
}

/**
 * The unnumbered sheets an export starts with, until the writer chooses. Before
 * the script: every one for a script that starts at page 1, none for an
 * excerpt that starts later. After it, the mirror: every one for a script that
 * runs to its last page, none for an excerpt that stops sooner. And none on
 * either side for sides, whose page 1 already says whose they are. Any of them
 * can still be ticked on for any export (a cover and a cast list on an
 * audition packet of sides is the usual case).
 */
export function defaultFrontSheets(
  available: readonly FrontSheet[],
  opts: {
    sides: boolean;
    startsAtPageOne: boolean;
    /** Pages whose own file says `export: false` (docs/app/formatting/formats-and-layout.md#FMT-169). */
    leftOut?: ReadonlySet<FrontSheet>;
    /** Which of `available` are pages after the script; omitted, none is. */
    back?: ReadonlySet<FrontSheet>;
    /** Whether the export holds the script's last page; read for the pages after the script alone. */
    endsAtLastPage?: boolean;
  },
): FrontSheet[] {
  if (opts.sides) return [];
  return available.filter(
    (kind) =>
      (opts.back?.has(kind) ? !!opts.endsAtLastPage : opts.startsAtPageOne) &&
      !opts.leftOut?.has(kind),
  );
}

/* ------------------------------------------------------------------ */
/* The file, sheet by sheet                                             */
/* ------------------------------------------------------------------ */

interface SheetBase {
  /** Stable across plans: `front-<n>`, `page-<number>` or `back-<n>`. */
  key: string;
  /** Position among every sheet the file COULD hold. */
  order: number;
  /** What a writer calls it: "Title page", "Page 12". */
  label: string;
  /** Under a thumbnail: "Title", "12". */
  short: string;
}

/**
 * One sheet of the file — an unnumbered sheet, or one of the engine's pages.
 * An unnumbered sheet is `front` on either side of the script, drawn, ticked
 * and named the same way; one that stands after the script's pages says so
 * (`back`).
 */
export type PlannedSheet =
  | (SheetBase & { kind: "front"; front: FrontMatterPage; back?: true })
  | (SheetBase & { kind: "page"; page: LayoutPage });

export interface SheetPlan {
  /** Every sheet the file could hold, in file order: the dialog's rail. */
  all: PlannedSheet[];
  /** The sheets the file WILL hold, in file order: the preview, and the PDF. */
  chosen: PlannedSheet[];
}

/** Each front sheet's names: "Title page" / "Title", and "Characters page 2" /
 * "Characters 2" when a kind runs to more than one sheet. */
function frontSheetNames(
  front: readonly { kind: FrontSheet; label?: string }[],
): { label: string; short: string }[] {
  const perKind = new Map<FrontSheet, number>();
  for (const page of front) perKind.set(page.kind, (perKind.get(page.kind) ?? 0) + 1);
  const seen = new Map<FrontSheet, number>();
  return front.map((page) => {
    const nth = (seen.get(page.kind) ?? 0) + 1;
    seen.set(page.kind, nth);
    const suffix = (perKind.get(page.kind) ?? 0) > 1 ? ` ${nth}` : "";
    const names = frontSheetLabel(page);
    return { label: names.label + suffix, short: names.short + suffix };
  });
}

/** One run of a PDF's page labels: from sheet `index` on, `prefix` and then,
 * when `start` is set, a decimal number counting up from it. */
export interface PageLabelRange {
  index: number;
  prefix?: string;
  start?: number;
}

/**
 * The page labels a PDF viewer shows in its sidebar and "Go to page", so they
 * read what the script pages print, not each sheet's position in the file
 * (docs/app/formatting/formats-and-layout.md#FMT-159). Without them a title
 * page made every script page one higher in the viewer than on the paper and
 * in the editor. Front sheets are named, never numbered; script pages carry
 * their printed number, and a gap in an excerpt starts a new run at the page
 * after it. The sheets after the script are named as the front sheets are,
 * each a run of its own, so the last script page's count never runs on into
 * them.
 */
export function pageLabelRanges(
  front: readonly { kind: FrontSheet; label?: string }[],
  pages: readonly { pageNumber: number }[],
  back: readonly { kind: FrontSheet; label?: string }[] = [],
): PageLabelRange[] {
  const ranges: PageLabelRange[] = frontSheetNames(front).map((name, index) => ({
    index,
    prefix: name.short,
  }));
  pages.forEach((page, i) => {
    if (i > 0 && page.pageNumber === pages[i - 1].pageNumber + 1) return;
    ranges.push({ index: front.length + i, start: page.pageNumber });
  });
  frontSheetNames(back).forEach((name, i) => {
    ranges.push({ index: front.length + pages.length + i, prefix: name.short });
  });
  return ranges;
}

/**
 * Lay out what an export holds as one sequence of sheets — front matter first,
 * then pages, then the sheets of the pages after the script — and mark which
 * of them are going. The preview draws `chosen` and nothing else, so a sheet
 * it shows is a sheet the file has.
 *
 * `frontKinds` holds the kinds chosen on both sides of the script: a page
 * after it is a kind of its own, as a page file before it is.
 *
 * `pages` is null when the range can't be read. Then there is no file to
 * make, so nothing is going — not even the unnumbered sheets — and the dialog
 * says why instead of previewing a guess.
 */
export function planSheets(args: {
  front: readonly FrontMatterPage[];
  layout: LayoutResult;
  /** The sheets after the script's last page; omitted, there are none. */
  back?: readonly FrontMatterPage[];
  frontKinds: readonly FrontSheet[];
  pages: readonly number[] | null;
}): SheetPlan {
  const all: PlannedSheet[] = [];
  const names = frontSheetNames(args.front);
  args.front.forEach((front, i) => {
    all.push({ kind: "front", key: `front-${i}`, order: all.length, front, ...names[i] });
  });
  for (const page of args.layout.pages) {
    all.push({
      kind: "page",
      key: `page-${page.pageNumber}`,
      order: all.length,
      page,
      label: `Page ${page.pageNumber}`,
      short: `${page.pageNumber}`,
    });
  }
  const back = args.back ?? [];
  const backNames = frontSheetNames(back);
  back.forEach((front, i) => {
    all.push({
      kind: "front",
      back: true,
      key: `back-${i}`,
      order: all.length,
      front,
      ...backNames[i],
    });
  });
  if (args.pages === null) return { all, chosen: [] };
  const kinds = new Set(args.frontKinds);
  const pages = new Set(args.pages);
  const chosen = all.filter((sheet) =>
    sheet.kind === "front" ? kinds.has(sheet.front.kind) : pages.has(sheet.page.pageNumber),
  );
  return { all, chosen };
}

/**
 * Where the preview is, in words. "Page 7 of 42" while the file is simply the
 * script from page 1; once unnumbered sheets (before the script or after it)
 * or an excerpt part the printed number from the position, both:
 * "Page 12 · sheet 3 of 11", "Title page · sheet 1 of 11".
 */
export function pagerText(chosen: readonly PlannedSheet[], index: number): string {
  const sheet = chosen[index];
  if (!sheet) return "No pages";
  const plain = chosen.every((s, i) => s.kind === "page" && s.page.pageNumber === i + 1);
  return plain
    ? `Page ${index + 1} of ${chosen.length}`
    : `${sheet.label} · sheet ${index + 1} of ${chosen.length}`;
}

/**
 * The sheet to keep showing after the chosen set changed: the same one if it
 * is still going, else the next going sheet after where it was, else the last.
 * Unticking the page you are reading should not throw you back to page 1.
 */
export function resolveFocus(plan: SheetPlan, key: string | null): number {
  if (!plan.chosen.length) return -1;
  if (key === null) return 0;
  const at = plan.chosen.findIndex((sheet) => sheet.key === key);
  if (at >= 0) return at;
  const was = plan.all.find((sheet) => sheet.key === key)?.order;
  if (was === undefined) return 0;
  const next = plan.chosen.findIndex((sheet) => sheet.order > was);
  return next >= 0 ? next : plan.chosen.length - 1;
}

/* ------------------------------------------------------------------ */
/* Page ranges                                                          */
/* ------------------------------------------------------------------ */

export interface PageSelection {
  /** Printed page numbers to include — ascending, unique, always in script
   * order however the field was typed. Empty when the text can't be honoured. */
  pages: number[];
  /** The whole script (the field was left empty, or names every page). */
  all: boolean;
  /** Why the text can't be honoured, in words a writer can act on. */
  error: string | null;
}

/** A dash a writer might actually type — hyphen, en, em, or minus. */
const DASH = "[-‐‑–—−]";
const SINGLE = new RegExp(`^(\\d+)$`);
const RANGE = new RegExp(`^(\\d*)\\s*${DASH}\\s*(\\d*)$`);

function allPages(total: number): number[] {
  return Array.from({ length: total }, (_, i) => i + 1);
}

/**
 * Read a page-range field — "1-5, 8, 11-" and the obvious variants, with an
 * open end meaning "to the last page". Empty means the whole script.
 *
 * Forgiving where forgiveness is unambiguous (any separator, a reversed range,
 * duplicates, "all"), strict where it isn't: a page the script doesn't have is
 * an error rather than a silent clamp, because silently exporting fewer pages
 * than you asked for is the failure a writer only notices at the theatre.
 */
export function parsePageRange(input: string, total: number): PageSelection {
  const text = input.trim();
  if (total <= 0) {
    return { pages: [], all: false, error: "There are no pages to export yet." };
  }
  if (!text || text.toLowerCase() === "all") {
    return { pages: allPages(total), all: true, error: null };
  }

  const bad = (error: string): PageSelection => ({ pages: [], all: false, error });
  const chosen = new Set<number>();

  for (const token of text.split(/[,;\s]+/).filter(Boolean)) {
    const single = SINGLE.exec(token);
    const range = RANGE.exec(token);
    let from: number;
    let to: number;

    if (single) {
      from = to = Number(single[1]);
    } else if (range && (range[1] || range[2])) {
      from = range[1] ? Number(range[1]) : 1;
      to = range[2] ? Number(range[2]) : total;
      if (from > to) [from, to] = [to, from]; // a backwards range is a typo, not a puzzle
    } else {
      return bad(`Can't read "${token}" — pages look like 1-5, 8, 11-13.`);
    }

    if (from < 1) return bad("Pages start at 1.");
    const over = to > total ? to : from > total ? from : 0;
    if (over) {
      return bad(
        `The script is ${total} ${total === 1 ? "page" : "pages"} long — there is no page ${over}.`,
      );
    }
    for (let p = from; p <= to; p++) chosen.add(p);
  }

  const pages = [...chosen].sort((a, b) => a - b);
  if (!pages.length) return bad("Name at least one page, or clear the field for all of them.");
  return { pages, all: pages.length === total, error: null };
}

/**
 * The inverse: a set of page numbers as the shortest field text that means it.
 * Every page gives "" — the empty field is how "all" is spelled, so ticking the
 * last missing page returns the dialog to its resting state.
 */
export function formatPageRange(pages: number[], total: number): string {
  const sorted = [...new Set(pages)].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  if (!sorted.length || sorted.length === total) return "";
  return collapse(sorted).join(", ");
}

/** Ascending page numbers as the runs they form: [1,2,3,8] → ["1-3", "8"]. */
function collapse(sorted: number[]): string[] {
  const parts: string[] = [];
  let start = sorted[0];
  let prev = start;
  const flush = () => parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  for (const p of sorted.slice(1)) {
    if (p === prev + 1) {
      prev = p;
      continue;
    }
    flush();
    start = prev = p;
  }
  flush();
  return parts;
}

/**
 * A selection named for a file name — "pages 12-20", "page 7". Whether the
 * selection is worth naming at all is the caller's call (a whole-script export
 * passes no pages and keeps the plain title).
 */
export function pageRangeLabel(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (!sorted.length) return "";
  return `${sorted.length === 1 ? "page" : "pages"} ${collapse(sorted).join(",")}`;
}

/**
 * Narrow a layout to the chosen printed pages. Nothing is re-flowed: the pages
 * that survive are byte-for-byte the pages the editor is showing, headers and
 * numbering included, which is the whole point of having one paginator.
 */
export function selectPages(
  layout: LayoutResult,
  pages: number[] | null | undefined,
): LayoutResult {
  if (!pages) return layout;
  const want = new Set(pages);
  return { ...layout, pages: layout.pages.filter((p) => want.has(p.pageNumber)) };
}

/* ------------------------------------------------------------------ */
/* Styled runs                                                          */
/* ------------------------------------------------------------------ */

export interface StyleSegment {
  text: string;
  /** Offset in the line's print text — the x cell this segment starts at. */
  start: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/**
 * Split a laid-out line at its style-run boundaries. Marks are additive over
 * the element's base style (bold dialogue inside an italic element stays both).
 * The PDF renderer and the export preview both draw from this, so a preview
 * can't show emphasis the file won't have.
 */
export function styleSegments(
  text: string,
  runs: StyleRun[],
  base: { bold: boolean; italic: boolean },
): StyleSegment[] {
  const cuts = new Set<number>([0, text.length]);
  for (const run of runs) {
    if (run.start < text.length) cuts.add(Math.max(0, run.start));
    if (run.end > 0) cuts.add(Math.min(text.length, run.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: StyleSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const segment = text.slice(from, to);
    if (!segment) continue;
    const active = runs.filter((r) => r.start <= from && to <= r.end);
    out.push({
      text: segment,
      start: from,
      bold: base.bold || active.some((run) => run.bold),
      italic: base.italic || active.some((run) => run.italic),
      underline: active.some((run) => run.underline),
    });
  }
  return out;
}
