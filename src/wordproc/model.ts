// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The play as a word-processor document, before it is either file — the one
 * model the .docx and .odt writers both serialize
 * (docs/app/formatting/formats-and-layout.md#FMT-D109).
 *
 * Nothing about layout is decided here. What goes in is what the layout
 * engine put on the chosen pages: its lines, merged back into their
 * paragraphs, so an excerpt holds exactly the words of those PDF pages and a
 * whole export holds every printed block. How each element looks is its
 * format entry, turned into a named paragraph style
 * (docs/app/formatting/formats-and-layout.md#FMT-146). Where pages break is
 * left to the word processor, following those styles' rules
 * (docs/app/formatting/formats-and-layout.md#FMT-148).
 *
 * The one thing computed here is the gap above each paragraph, because a word
 * processor adds a paragraph's space after to the next one's space before
 * where the engine takes the larger (docs/app/formatting/formats-and-layout.md#FMT-147).
 * Styles hold only a space before, and a paragraph whose engine gap differs
 * carries its own.
 */
import type { BlockType, Doc, FrontMatter } from "../fountain/model";
import {
  dualColumnsIn,
  elementColumnIn,
  textBlockWidthIn,
  type ElementAlign,
  type ElementFontStyle,
  type FormatSpec,
  type HeaderFooterSlot,
  type HeaderFooterSpec,
} from "../format/spec";
import {
  blocksFromDoc,
  paginate,
  paginateFrontMatter,
  type FrontMatterLine,
  type LayoutBlock,
  type LayoutMeta,
  type LayoutPage,
  type StyleRun,
} from "../layout";
import {
  enterHeading,
  fillSlot,
  numberHeadings,
  slotValues,
  START_POSITION,
  type PagePosition,
} from "../layout/furniture";
import { selectFrontMatter, styleSegments, type FrontSheet } from "../pdf/plan";

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

/** Every block type a paragraph can be, which is every one but a page break. */
export type ElementStyleKey = Exclude<BlockType, "pageBreak">;

/** The paragraph styles a document can hold. */
export type StyleKey =
  | ElementStyleKey
  | "title"
  | "titlePage"
  | "openingHeading"
  | "openingText"
  | "castList"
  | "header"
  | "footer";

/**
 * Each style's name, as the recipient's word processor lists it. The script's
 * elements are named as the element bar names them
 * (docs/app/formatting/formats-and-layout.md#FMT-146); the two a format can
 * choose to print that the bar does not offer take the importer's names.
 */
export const STYLE_NAME: Record<StyleKey, string> = {
  act: "Act",
  scene: "Scene",
  sceneHeading: "Scene Heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
  lyric: "Lyric",
  centered: "Centered Text",
  synopsis: "Scene Summary",
  boneyard: "Omitted Text",
  title: "Title",
  titlePage: "Title Page Text",
  openingHeading: "Opening Heading",
  openingText: "Opening Text",
  castList: "Cast List",
  header: "Header",
  footer: "Footer",
};

const ELEMENT_ORDER: readonly ElementStyleKey[] = [
  "act",
  "scene",
  "sceneHeading",
  "action",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "lyric",
  "centered",
  "synopsis",
  "boneyard",
];

/** What Return starts after each element, the way a writer moves through a scene. */
const NEXT: Record<StyleKey, StyleKey> = {
  act: "scene",
  scene: "action",
  sceneHeading: "action",
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "character",
  transition: "action",
  lyric: "lyric",
  centered: "action",
  synopsis: "action",
  boneyard: "action",
  title: "titlePage",
  titlePage: "titlePage",
  openingHeading: "openingText",
  openingText: "openingText",
  castList: "castList",
  header: "header",
  footer: "footer",
};

/** One paragraph style, in the format's terms: inches, points and blank lines. */
export interface ParagraphStyle {
  key: StyleKey;
  name: string;
  /** Indents from the left and right text margins. */
  leftIn: number;
  rightIn: number;
  align: ElementAlign;
  caps: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** Extra advance per character, points. */
  trackingPt: number;
  /** Blank lines above; the style never holds space below. */
  spaceBeforeRows: number;
  keepWithNext: boolean;
  /** Never split across a page. */
  keepTogether: boolean;
  pageBreakBefore: boolean;
  /** Fewest lines left at a page's foot, and carried to the next page, when it splits. */
  orphans: number;
  widows: number;
  /** Heading level for a reader's navigation, or null. */
  outlineLevel: number | null;
  next: StyleKey;
  /** A header or footer: one line as tall as the type, with the centre and right slots on tab stops. */
  furniture: boolean;
}

function faces(style: ElementFontStyle): { bold: boolean; italic: boolean } {
  return {
    bold: style === "bold" || style === "bold-italic",
    italic: style === "italic" || style === "bold-italic",
  };
}

const PLAIN = {
  leftIn: 0,
  rightIn: 0,
  align: "left" as ElementAlign,
  caps: false,
  underline: false,
  trackingPt: 0,
  spaceBeforeRows: 0,
  keepWithNext: false,
  keepTogether: true,
  pageBreakBefore: false,
  orphans: 0,
  widows: 0,
  outlineLevel: null,
  furniture: false,
};

/** An element's style: its format entry, in a word processor's terms. */
function elementStyle(spec: FormatSpec, key: ElementStyleKey): ParagraphStyle {
  const el = spec.elements[key];
  // Nothing sits beside anything in a word processor
  // (docs/app/formatting/formats-and-layout.md#FMT-149): every element takes
  // the column it has on its own.
  const col = elementColumnIn(spec, key, true);
  const rules = spec.pagination;
  // The elements the engine may split across a page, and the lines it keeps
  // on either side when it does.
  const splits = key === "dialogue" || key === "action" || key === "lyric";
  return {
    key,
    name: STYLE_NAME[key],
    leftIn: col.leftIn,
    rightIn: Math.max(0, textBlockWidthIn(spec) - col.leftIn - col.widthIn),
    align: el.align,
    caps: el.textTransform === "uppercase",
    ...faces(el.fontStyle),
    underline: el.underline,
    trackingPt: el.letterSpacing * spec.type.size,
    // An element that starts a page starts at its top, with nothing above it.
    spaceBeforeRows: el.startsNewPage ? 0 : el.spacingBefore,
    keepWithNext: el.keepWithNext,
    keepTogether: !splits,
    pageBreakBefore: el.startsNewPage,
    orphans: splits
      ? key === "dialogue"
        ? rules.minDialogueLinesBeforeBreak
        : rules.minActionLinesEitherSide
      : 0,
    widows: splits
      ? key === "dialogue"
        ? rules.minDialogueLinesAfterBreak
        : rules.minActionLinesEitherSide
      : 0,
    outlineLevel: key === "act" ? 1 : key === "scene" ? 2 : key === "sceneHeading" ? 3 : null,
    next: NEXT[key],
    furniture: false,
  };
}

/** Every style a document made in this format holds. */
export function documentStyles(spec: FormatSpec): ParagraphStyle[] {
  const policy = spec.frontMatter;
  const front = (key: StyleKey, style: ElementFontStyle, keepWithNext = false): ParagraphStyle => ({
    ...PLAIN,
    key,
    name: STYLE_NAME[key],
    ...faces(style),
    keepWithNext,
    next: NEXT[key],
  });
  return [
    ...ELEMENT_ORDER.filter((key) => spec.elements[key]?.print).map((key) =>
      elementStyle(spec, key),
    ),
    front("title", policy.titleFontStyle),
    front("titlePage", policy.bodyFontStyle),
    front("openingHeading", policy.headingFontStyle, true),
    front("openingText", policy.bodyFontStyle),
    front("castList", policy.bodyFontStyle),
    {
      ...PLAIN,
      key: "header",
      name: STYLE_NAME.header,
      bold: false,
      italic: false,
      next: "header",
      furniture: true,
    },
    {
      ...PLAIN,
      key: "footer",
      name: STYLE_NAME.footer,
      bold: false,
      italic: false,
      next: "footer",
      furniture: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* The document                                                         */
/* ------------------------------------------------------------------ */

export type WpInline =
  | { kind: "text"; text: string; bold: boolean; italic: boolean; underline: boolean }
  | { kind: "break" }
  | { kind: "tab" };

export interface WpParagraph {
  kind: "p";
  style: StyleKey;
  inlines: WpInline[];
  /** Blank lines above it, where they differ from its style's. */
  spaceBeforeRows?: number;
  /** A page break before it, where that differs from its style's. */
  pageBreakBefore?: boolean;
  /** Its alignment, where that differs from its style's (front matter). */
  align?: ElementAlign;
  /**
   * In a dual-dialogue cell, where the half's whole width is its column
   * (docs/app/formatting/formats-and-layout.md#FMT-100), and where nothing
   * keeps with the next paragraph: the row already keeps the pair together,
   * and in a table a reader keeps a row whose paragraph keeps-with-next with
   * the row below — so a scene of pairs would move as one block.
   */
  inCell?: boolean;
}

/** A dual-dialogue pair: one table row of two cells (docs/app/formatting/formats-and-layout.md#FMT-149). */
export interface WpDual {
  kind: "dual";
  left: WpParagraph[];
  right: WpParagraph[];
  pageBreakBefore?: boolean;
}

export type WpItem = WpParagraph | WpDual;

/**
 * A header or footer's three slots in one section. Each is its text around
 * page-number fields: a field goes between each pair of strings, so `["", "."]`
 * prints `12.` on page 12.
 */
export type Furniture = Record<HeaderFooterSlot, string[]>;

export const SLOTS: readonly HeaderFooterSlot[] = ["left", "center", "right"];

export interface WpSection {
  kind: "front" | "script";
  /** How it begins: the first begins the document, the rest on a new page or on the same one. */
  begins: "document" | "page" | "continuous";
  /** Page numbers start again at this number here. */
  firstPageNumber?: number;
  /** The first page of the script, where the format may leave the header or footer off. */
  bareFirstPage?: { header: boolean; footer: boolean };
  /** The act and scene in force where the section begins. */
  at: PagePosition;
  header: Furniture | null;
  footer: Furniture | null;
  items: WpItem[];
}

export interface WpDocument {
  spec: FormatSpec;
  /** BCP 47. */
  language: string;
  title: string;
  /** Empty in an anonymous copy. */
  author: string;
  styles: ParagraphStyle[];
  sections: WpSection[];
  /**
   * The header or footer prints the act or scene, so the values change at
   * headings: a section per heading in a .docx, fields set at each heading in
   * an .odt (docs/app/formatting/formats-and-layout.md#FMT-151).
   */
  followsHeadings: boolean;
}

export interface WpInput {
  doc: Doc;
  spec: FormatSpec;
  meta: LayoutMeta;
  /** The opening pages to lay out; omitted uses the meta's. */
  frontMatter?: FrontMatter | null;
  /** The kinds of front sheet to put first; null/omitted puts every one. */
  frontSheets?: readonly FrontSheet[] | null;
  language: string;
  /** Printed page numbers to include; null/omitted is the whole script. */
  pages?: number[] | null;
}

/* ------------------------------------------------------------------ */
/* Building it                                                          */
/* ------------------------------------------------------------------ */

const POSITION_TOKEN = /\{(?:act|scene|actNumber|actRoman|sceneNumber)\}/;
/** Stands in for the page number while the slots are filled, then marks the field. */
const PAGE_MARK = "";

function usesPosition(hf: HeaderFooterSpec): boolean {
  return SLOTS.some((slot) => POSITION_TOKEN.test(hf.content[slot] ?? ""));
}

/** A header or footer's slots where a section begins, or null when it prints nothing. */
function furnitureAt(hf: HeaderFooterSpec, at: PagePosition, meta: LayoutMeta): Furniture | null {
  const values = {
    ...slotValues({
      pageNumber: 0,
      at,
      title: meta.title,
      author: meta.author,
      draftDate: meta.frontMatter?.draftDate,
    }),
    page: PAGE_MARK,
  };
  const out = {} as Furniture;
  let prints = false;
  for (const slot of SLOTS) {
    const filled = fillSlot(hf.content[slot] ?? "", values);
    if (filled) prints = true;
    out[slot] = filled.split(PAGE_MARK);
  }
  return prints ? out : null;
}

/** The same format with capitals and element underlining left to the style. */
function plainSpec(spec: FormatSpec): FormatSpec {
  const elements = { ...spec.elements };
  for (const key of Object.keys(elements) as BlockType[]) {
    elements[key] = { ...elements[key], textTransform: "none", underline: false };
  }
  return { ...spec, elements };
}

function isDialogueLike(type: BlockType): boolean {
  return type === "dialogue" || type === "parenthetical" || type === "lyric";
}

/**
 * Which blocks form a dual-dialogue pair, and on which side — by the rule the
 * paginator pairs them with: a `^` cue's speech is the right half, and the cue
 * and speech just before it the left.
 */
function dualSides(
  blocks: readonly LayoutBlock[],
): Map<number, { pair: number; side: "left" | "right" }> {
  const sides = new Map<number, { pair: number; side: "left" | "right" }>();
  const chainEnd = (from: number) => {
    let end = from + 1;
    while (end < blocks.length && isDialogueLike(blocks[end].type)) end++;
    return end;
  };
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "character" && !block.dual) {
      const leftEnd = chainEnd(i);
      const cue = blocks[leftEnd];
      if (cue?.type === "character" && cue.dual) {
        const rightEnd = chainEnd(leftEnd);
        for (let k = i; k < rightEnd; k++) {
          sides.set(blocks[k].sourceIndex, {
            pair: block.sourceIndex,
            side: k < leftEnd ? "left" : "right",
          });
        }
        i = rightEnd;
        continue;
      }
    }
    i++;
  }
  return sides;
}

/** Text as runs, line breaks and tabs; marks add to the style, never subtract. */
function inlinesOf(text: string, runs: readonly StyleRun[]): WpInline[] {
  const out: WpInline[] = [];
  for (const seg of styleSegments(text, [...runs], { bold: false, italic: false })) {
    for (const part of seg.text.split(/(\n|\t)/)) {
      if (part === "\n") out.push({ kind: "break" });
      else if (part === "\t") out.push({ kind: "tab" });
      else if (part)
        out.push({
          kind: "text",
          text: part,
          bold: seg.bold,
          italic: seg.italic,
          underline: seg.underline,
        });
    }
  }
  return out;
}

function clipRuns(runs: readonly StyleRun[], start: number, end: number): StyleRun[] {
  return runs
    .filter((run) => run.end > start && run.start < end)
    .map((run) => ({
      ...run,
      start: Math.max(run.start, start) - start,
      end: Math.min(run.end, end) - start,
    }));
}

function frontStyle(kind: FrontSheet, line: FrontMatterLine): StyleKey {
  if (line.paragraphId === "title") return "title";
  if (line.role === "heading") return "openingHeading";
  if (line.role === "cast") return "castList";
  return kind === "title" ? "titlePage" : "openingText";
}

/**
 * Front-matter lines as paragraphs, at the engine's rows
 * (docs/app/formatting/formats-and-layout.md#FMT-150). Within a sheet a
 * paragraph's gap is the rows between it and the one above; the first on a
 * new kind of sheet starts a page, as far down it as the engine put it. A
 * sheet the engine continued onto is the word processor's to break, so the
 * paragraph that opens it keeps the gap the format gives it after another.
 */
function frontParagraphs(
  pages: readonly { kind: FrontSheet; lines: readonly FrontMatterLine[] }[],
): WpParagraph[] {
  const out: WpParagraph[] = [];
  let kind: FrontSheet | null = null;
  for (const page of pages) {
    const newKind = page.kind !== kind;
    kind = page.kind;
    let lastRow: number | null = null;
    for (const line of page.lines) {
      if (line.source) {
        const gap =
          lastRow !== null ? line.row - lastRow - 1 : newKind ? line.row : line.source.gapRows;
        out.push({
          kind: "p",
          style: frontStyle(page.kind, line),
          inlines: inlinesOf(line.source.text, line.source.runs),
          align: line.align,
          ...(gap > 0 ? { spaceBeforeRows: gap } : {}),
          ...(lastRow === null && newKind && out.length ? { pageBreakBefore: true } : {}),
        });
      }
      lastRow = line.row;
    }
  }
  return out;
}

/** The chosen pages in runs of consecutive printed numbers: an excerpt of 3–5 and 9 is two runs. */
function runsOf(pages: readonly LayoutPage[]): LayoutPage[][] {
  const runs: LayoutPage[][] = [];
  for (const page of pages) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1].pageNumber + 1 === page.pageNumber) run.push(page);
    else runs.push([page]);
  }
  return runs;
}

export function buildDocument(input: WpInput): WpDocument {
  const { doc, spec } = input;
  const frontMatter = input.frontMatter === undefined ? input.meta.frontMatter : input.frontMatter;
  const meta: LayoutMeta = { ...input.meta, frontMatter };
  // The same blocks and the same call the PDF path makes (paginateDoc), so
  // the chosen pages hold the same words.
  const printed = blocksFromDoc(doc, spec);
  const layout = paginate(printed, spec, meta);
  const want = input.pages ? new Set(input.pages) : null;
  const chosen = layout.pages.filter((page) => !want || want.has(page.pageNumber));
  if (!chosen.length) throw new Error("No pages selected.");

  // The words as typed: the engine's uppercase keeps every string's length,
  // so its line offsets index this text too.
  const plain = new Map(
    blocksFromDoc(doc, plainSpec(spec)).map((block) => [block.sourceIndex, block]),
  );
  const print = new Map(printed.map((block) => [block.sourceIndex, block]));
  for (const [index, block] of print) {
    if (plain.get(index)?.text.length !== block.text.length) {
      throw new Error("The script's printed text and its words do not line up.");
    }
  }
  const sides = dualSides(printed);
  const breaks = printed
    .filter((block) => block.type === "pageBreak")
    .map((block) => block.sourceIndex);

  // Where each heading leaves the play, from the paginator's own numbering.
  const numbers = numberHeadings(printed);
  const after = new Map<number, PagePosition>();
  const headings: { sourceIndex: number; at: PagePosition }[] = [];
  let at: PagePosition = { ...START_POSITION };
  for (const block of printed) {
    if (block.type !== "act" && block.type !== "scene") continue;
    at = enterHeading(at, block, numbers.get(block.sourceIndex) ?? null);
    after.set(block.sourceIndex, at);
    headings.push({ sourceIndex: block.sourceIndex, at });
  }
  const before = (sourceIndex: number): PagePosition =>
    headings.filter((h) => h.sourceIndex < sourceIndex).pop()?.at ?? { ...START_POSITION };

  const followsHeadings = usesPosition(spec.header) || usesPosition(spec.footer);
  const sections: WpSection[] = [];
  const furnish = (section: Omit<WpSection, "header" | "footer">): WpSection => ({
    ...section,
    header: null,
    footer: null,
  });

  const front = frontParagraphs(
    selectFrontMatter(paginateFrontMatter(frontMatter, spec), input.frontSheets),
  );
  if (front.length) {
    sections.push(
      furnish({ kind: "front", begins: "document", at: { ...START_POSITION }, items: front }),
    );
  }

  for (const run of runsOf(chosen)) {
    // What each block contributes on these pages: the span of its print text
    // their lines cover. An excerpt that opens mid-speech keeps the cue the
    // PDF repeats there.
    const spans = new Map<number, { start: number; end: number }>();
    let contd: string | null = null;
    for (const [i, page] of run.entries()) {
      for (const line of page.lines) {
        if (line.kind === "contd") {
          if (i === 0) contd = line.text;
          continue;
        }
        if (!line.text.trim()) continue;
        const span = spans.get(line.sourceIndex);
        if (!span) spans.set(line.sourceIndex, { start: line.start, end: line.end });
        else {
          span.start = Math.min(span.start, line.start);
          span.end = Math.max(span.end, line.end);
        }
      }
    }
    const order = [...spans.keys()].sort((a, b) => a - b);
    const firstPage = run[0].pageNumber;
    const firstIndex = order[0] ?? 0;
    let section = furnish({
      kind: "script",
      begins: sections.length ? "page" : "document",
      firstPageNumber: firstPage,
      ...(firstPage === 1
        ? {
            bareFirstPage: {
              header: spec.header.suppressOnFirstPage,
              footer: spec.footer.suppressOnFirstPage,
            },
          }
        : {}),
      at: before(firstIndex),
      items: [],
    });
    sections.push(section);
    // Whether anything but opening lines and headings is in this section yet:
    // until then, a heading sets where the section's first page begins
    // (docs/app/formatting/formats-and-layout.md#FMT-140).
    let content = false;

    // The inline opening, on the first script page of a format that has one.
    const intro = run
      .filter((page) => page.intro?.length)
      .map((page) => ({ kind: "title" as const, lines: page.intro! }));
    section.items.push(...frontParagraphs(intro));

    const opening = section.items.length > 0;
    let prev: { type: BlockType | null; after: number } | null = opening
      ? { type: null, after: spec.frontMatter.inlineGapRows }
      : null;
    let breakPending = false;

    const paragraph = (
      type: BlockType,
      text: string,
      runs: readonly StyleRun[],
    ): WpParagraph | null => {
      const trimmed = text.replace(/ +$/, "");
      if (!trimmed.trim()) return null;
      return {
        kind: "p",
        style: type as ElementStyleKey,
        inlines: inlinesOf(trimmed, clipRuns(runs, 0, trimmed.length)),
      };
    };
    const spanParagraph = (sourceIndex: number): WpParagraph | null => {
      const block = plain.get(sourceIndex)!;
      const span = spans.get(sourceIndex)!;
      return paragraph(
        block.type,
        block.text.slice(span.start, span.end),
        clipRuns(block.runs, span.start, span.end),
      );
    };
    /**
     * The engine's gap above an element, and whether a page starts with it.
     * After an inline opening (`prev.type` null) the page holds no script line
     * yet, so an element that starts pages starts nothing there.
     */
    const place = (type: BlockType): { gap: number; newPage: boolean } => {
      const el = spec.elements[type];
      if (!prev) return { gap: 0, newPage: false };
      if (breakPending) return { gap: 0, newPage: true };
      if (el.startsNewPage && prev.type !== null && !(type === "scene" && prev.type === "act")) {
        return { gap: 0, newPage: true };
      }
      if (prev.type === type && el.tightStack) return { gap: 0, newPage: false };
      return { gap: Math.max(prev.after, el.spacingBefore), newPage: false };
    };
    const settle = (p: WpParagraph, gap: number, newPage: boolean | null) => {
      const style = spec.elements[p.style as ElementStyleKey];
      const styleGap = style.startsNewPage ? 0 : style.spacingBefore;
      if (gap !== styleGap) p.spaceBeforeRows = gap;
      if (newPage !== null && newPage !== style.startsNewPage) p.pageBreakBefore = newPage;
    };

    const emit = (p: WpParagraph) => {
      const type = p.style as BlockType;
      const { gap, newPage } = place(type);
      // At the top of a run the section's own start is the page break.
      settle(p, gap, prev ? newPage : null);
      section.items.push(p);
      prev = { type, after: spec.elements[type].spacingAfter };
      breakPending = false;
    };

    if (contd) {
      const cue = paragraph("character", contd, []);
      if (cue) {
        emit(cue);
        content = true;
      }
    }

    for (let k = 0; k < order.length; k++) {
      const index = order[k];
      // A page break between two blocks of the run — or, after an inline
      // opening, before the first: the engine closes the opening's page there.
      const previous = order[k - 1];
      const from = previous ?? (opening && !contd ? -1 : undefined);
      if (from !== undefined && breaks.some((b) => b > from && b < index)) breakPending = true;
      const side = sides.get(index);
      if (side) {
        // The whole pair, as the engine places it: one unit, both halves from one row.
        const halves: Record<"left" | "right", number[]> = { left: [], right: [] };
        while (k < order.length && sides.get(order[k])?.pair === side.pair) {
          halves[sides.get(order[k])!.side].push(order[k]);
          k++;
        }
        k--;
        const firstType = plain.get(halves.left[0] ?? halves.right[0])!.type;
        const { gap, newPage } = place(firstType);
        const cell = (indexes: number[]): WpParagraph[] => {
          const out: WpParagraph[] = [];
          let chain: { type: BlockType; after: number } | null = null;
          for (const i of indexes) {
            const p = spanParagraph(i);
            if (!p) continue;
            const type = p.style as BlockType;
            const el = spec.elements[type];
            const inner = !chain
              ? gap
              : chain.type === type && el.tightStack
                ? 0
                : Math.max(chain.after, el.spacingBefore);
            settle(p, inner, null);
            p.inCell = true;
            out.push(p);
            chain = { type, after: el.spacingAfter };
          }
          return out;
        };
        const left = cell(halves.left);
        const right = cell(halves.right);
        if (!left.length && !right.length) continue;
        section.items.push({
          kind: "dual",
          left,
          right,
          ...(prev && newPage ? { pageBreakBefore: true } : {}),
        });
        const tail = (indexes: number[]) => {
          const last = indexes[indexes.length - 1];
          return last === undefined ? 0 : spec.elements[plain.get(last)!.type].spacingAfter;
        };
        prev = { type: "dialogue", after: Math.max(tail(halves.left), tail(halves.right)) };
        breakPending = false;
        content = true;
        continue;
      }

      const p = spanParagraph(index);
      if (!p) continue;
      const type = p.style as BlockType;
      if (followsHeadings && (type === "act" || type === "scene")) {
        const { newPage } = place(type);
        const opensPage = prev ? newPage : true;
        if (content) {
          section = furnish({
            kind: "script",
            begins: opensPage ? "page" : "continuous",
            at: after.get(index)!,
            items: [],
          });
          sections.push(section);
          content = false;
        } else {
          section.at = after.get(index)!;
        }
        emit(p);
        continue;
      }
      emit(p);
      content = true;
    }
  }

  for (const section of sections) {
    if (section.kind !== "script") continue;
    section.header = furnitureAt(spec.header, section.at, meta);
    section.footer = furnitureAt(spec.footer, section.at, meta);
  }

  return {
    spec,
    language: input.language,
    title: meta.title || "Untitled",
    author: meta.author ?? "",
    styles: documentStyles(spec),
    sections,
    followsHeadings,
  };
}

/**
 * Where a header's text top and a footer's text bottom sit, inches from their
 * paper edge (docs/app/formatting/formats-and-layout.md#FMT-147). A word
 * processor pushes the text down by however far a header line reaches past
 * the top margin — and with a page exactly so many rows deep, even a point
 * costs a row on every page. So a line that would reach past its margin sits
 * nearer the edge by the difference, and the text keeps every row the format
 * gives a page; a line that clears it sits where the format says.
 */
export function furniturePositions(spec: FormatSpec): { headerIn: number; footerIn: number } {
  const lineIn = spec.type.size / POINTS_PER_INCH;
  const m = spec.page.margins;
  return {
    headerIn: Math.max(0, Math.min(spec.header.position, m.top - lineIn)),
    footerIn: Math.max(0, Math.min(spec.footer.position, m.bottom - lineIn)),
  };
}

const POINTS_PER_INCH = 72;

/** Where a dual pair's two cells sit: the first cell's width holds the gutter as padding. */
export function dualColumns(spec: FormatSpec): {
  leftIn: number;
  leftWidthIn: number;
  gutterIn: number;
  rightWidthIn: number;
} {
  const duo = dualColumnsIn(spec);
  return {
    leftIn: duo.left.leftIn,
    leftWidthIn: duo.left.widthIn,
    gutterIn: duo.right.leftIn - duo.left.leftIn - duo.left.widthIn,
    rightWidthIn: duo.right.widthIn,
  };
}
