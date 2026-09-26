// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The layout/pagination engine — the single source of truth for where pages
 * break. Pure and DOM-free: (blocks + format spec) → pages of positioned
 * lines. The paginated editor view and the PDF exporter both consume this
 * output, so their page counts can never disagree (the brief's core
 * requirement).
 *
 * Geometry model: a page is a grid of `maxLinesPerPage(spec)` rows, one line
 * pitch each. Blocks wrap greedily on the Courier character grid
 * (format/metrics.ts); vertical gaps are blank rows, collapsing to
 * max(prev.spacingAfter, next.spacingBefore) — exactly what the generated
 * editor CSS produces via margin collapsing.
 *
 * Pagination policy comes entirely from spec.pagination + per-element flags:
 * keepWithNext chains (a cue is never stranded at a page bottom), dialogue
 * splits with a re-printed "CUE (CONT'D)" and min-lines on both sides, action
 * splits with min-lines, acts and pageBreak elements force new pages.
 */
import { trailingExtension } from "../fountain/cue";
import {
  enterHeading,
  fillSlot,
  numberHeadings,
  slotValues,
  START_POSITION,
  type PagePosition,
} from "./furniture";
import { openingParagraphs } from "./opening-prose";
import type { BlockNode, BlockType, Doc, FrontMatter } from "../fountain/model";
import { charAdvanceIn, charsPerLine } from "../format/metrics";
import {
  dualColumnsIn,
  elementColumnIn,
  maxLinesPerPage,
  linePitchIn,
  pageSizeIn,
  textBlockWidthIn,
  type ElementAlign,
  type ElementFontStyle,
  type ElementFormat,
  type FormatSpec,
} from "../format/spec";

export type FrontSheetKind = "title" | "characters" | "setting";

export interface FrontMatterLine {
  text: string;
  runs?: StyleRun[];
  row: number;
  xIn: number;
  fontStyle: ElementFontStyle;
  /** How its paragraph sits across the text block; `xIn` is where this line lands. */
  align: ElementAlign;
  /** One semantic paragraph may span several physical sheets. */
  paragraphId: string;
  role: "heading" | "paragraph" | "cast";
  /**
   * On a paragraph's first line only: its whole text and emphasis, unwrapped,
   * and the blank rows the format puts above it when it follows another, for
   * a writer that flows text rather than drawing lines — the .docx and .odt
   * export (docs/app/formatting/formats-and-layout.md#FMT-150).
   */
  source?: { text: string; runs: StyleRun[]; gapRows: number };
}

export interface FrontMatterPage {
  kind: FrontSheetKind;
  lines: FrontMatterLine[];
}

/** The same character grid and wrapping policy as the script body. Front
 * sheets have their own spacing from the format, remain unnumbered, and may
 * continue across any number of pages. Renderers only draw these positions. */
export function paginateFrontMatter(
  fm: FrontMatter | null | undefined,
  spec: FormatSpec,
): FrontMatterPage[] {
  return spec.frontMatter.placement === "inline" ? [] : layoutFrontMatter(fm, spec);
}

/** Both placements share wrapping, overflow and the source-independent grid. */
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
  return pages.filter((page) => page.lines.length);
}

/** An inline style span over a block's print text. */
export interface StyleRun {
  start: number;
  end: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** Maps a print-text span back to the caller's source coordinates (model
 * offsets for the PDF path, ProseMirror positions for the editor plugin). */
export interface SourceSegment {
  printStart: number;
  srcStart: number;
  len: number;
}

/** One block prepared for layout: print text with decorations applied. */
export interface LayoutBlock {
  type: BlockType;
  sourceIndex: number;
  /** Print text: notes stripped, transform + parens + cue extension applied. */
  text: string;
  runs: StyleRun[];
  srcMap: SourceSegment[];
  /** Bare cue name (character blocks) — the "(CONT'D)" re-print uses this. */
  cueName?: string;
  /** Fountain `^` — this cue opens the RIGHT half of a dual-dialogue pair. */
  dual?: boolean;
}

export interface LayoutLine {
  kind: "text" | "contd";
  type: BlockType;
  /** Source block index; -1 for the synthetic (CONT'D) cue line. */
  sourceIndex: number;
  /** Print-text char range [start, end) this line covers (0/0 for contd). */
  start: number;
  end: number;
  text: string;
  runs: StyleRun[];
  /** Grid row on the page, 0-based from the text-block top. */
  row: number;
  /** Text start, inches from the text-block left edge (alignment applied). */
  xIn: number;
}

export interface HeaderText {
  left?: string;
  center?: string;
  right?: string;
}

/** Where a page begins — the editor's break widgets anchor here. */
export interface PageBreakInfo {
  /** Source index of the block the new page starts in (or with). */
  sourceIndex: number;
  /** Char offset (caller coordinates) when the break splits a block. */
  srcOffset: number | null;
  /** Text of the synthetic re-printed cue, e.g. "MARA (CONT'D)". */
  contd: string | null;
}

export interface LayoutPage {
  /** Printed page number, 1-based. */
  pageNumber: number;
  /** Resolved header slots; null when suppressed (first page) or empty. */
  header: HeaderText | null;
  /**
   * Resolved footer slots, the same way. The schema always had a footer and
   * nothing drew it; it lives in the bottom margin, so it moves no line.
   */
  footer: HeaderText | null;
  /** Compact front matter on numbered pages; it consumes the body row grid. */
  intro?: FrontMatterLine[];
  lines: LayoutLine[];
  usedRows: number;
  /** Blank rows the editor adds below the last line to fill the sheet
   * exactly (the last block's trailing spacing already renders as margin). */
  fillRows: number;
  breakBefore?: PageBreakInfo;
}

export interface LayoutMeta {
  title?: string;
  author?: string;
  frontMatter?: FrontMatter | null;
}

export interface LayoutResult {
  pages: LayoutPage[];
  maxRows: number;
}

/* ------------------------------------------------------------------ */
/* Block preparation                                                    */
/* ------------------------------------------------------------------ */

export interface RawPiece {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Start of this piece in the caller's source coordinates. */
  srcStart: number;
}

/** Length-preserving uppercase, so print↔source offsets stay aligned (the
 * rare expanding case, ß→SS, keeps the original character; the DOM's CSS
 * text-transform may differ by one cell there — an accepted edge). */
function upper(text: string): string {
  let out = "";
  for (const ch of text) {
    const u = ch.toUpperCase();
    out += u.length === ch.length ? u : ch;
  }
  return out;
}

/** The first `n` characters of a block's pieces: a cue's name without its extension. */
function clipPieces(pieces: RawPiece[], n: number): RawPiece[] {
  const out: RawPiece[] = [];
  let used = 0;
  for (const piece of pieces) {
    if (used >= n) break;
    const room = n - used;
    out.push(piece.text.length <= room ? piece : { ...piece, text: piece.text.slice(0, room) });
    used += Math.min(piece.text.length, room);
  }
  return out;
}

/**
 * Assemble one LayoutBlock from extracted inline pieces. Returns null for
 * blocks the format excludes from print (synopsis, boneyard — pageBreak is
 * kept: it carries the forced-break flag).
 */
export function buildLayoutBlock(args: {
  type: BlockType;
  pieces: RawPiece[];
  spec: FormatSpec;
  sourceIndex: number;
  /** Character extension attr, e.g. "(O.S.)" — appended to the print cue. */
  extension?: string | null;
  /** Fountain `^` on a character block. */
  dual?: boolean;
}): LayoutBlock | null {
  const { type, spec, sourceIndex } = args;
  const el = spec.elements[type];
  if (!el.print && type !== "pageBreak") return null;

  // A cue's extension arrives as TEXT from the editor, where the writer can see
  // it (editor/bridge.ts), and as the attribute from a parsed file. Both print
  // the same way: the name takes the format's transform and names the (CONT'D)
  // re-print, and the extension follows it as written.
  let pieces = args.pieces;
  let extension = args.extension ?? null;
  if (type === "character" && !extension) {
    const found = trailingExtension(pieces.map((p) => p.text).join(""));
    if (found && found.at > 0) {
      extension = found.extension;
      pieces = clipPieces(pieces, found.at);
    }
  }

  let text = "";
  const runs: StyleRun[] = [];
  const srcMap: SourceSegment[] = [];
  for (const piece of pieces) {
    if (!piece.text) continue;
    const start = text.length;
    text += piece.text;
    srcMap.push({ printStart: start, srcStart: piece.srcStart, len: piece.text.length });
    if (piece.bold || piece.italic || piece.underline) {
      runs.push({
        start,
        end: text.length,
        bold: !!piece.bold,
        italic: !!piece.italic,
        underline: !!piece.underline,
      });
    }
  }

  if (el.textTransform === "uppercase") text = upper(text);
  const cueName = type === "character" ? text : undefined;
  if (type === "character" && extension) text = `${text} ${extension}`;
  if (el.parenWrap) {
    text = `(${text})`;
    for (const run of runs) {
      run.start += 1;
      run.end += 1;
    }
    for (const seg of srcMap) seg.printStart += 1;
  }
  text += el.suffix;
  if (el.underline)
    runs.push({ start: 0, end: text.length, bold: false, italic: false, underline: true });

  const block: LayoutBlock = { type, sourceIndex, text, runs, srcMap, cueName };
  if (type === "character" && args.dual) block.dual = true;
  return block;
}

/**
 * A block whose only inline content is notes (`[[ ]]` on its own line) prints
 * NOTHING — not even a blank line. Anything less than a full skip would let a
 * comment move a page break (docs/app/writing/comments.md#COMM-D4). A genuinely empty block
 * (no children at all) keeps its line: that is the caret's row while typing.
 */
function isNoteOnlyContent(content: BlockNode["content"]): boolean {
  const nodes = content ?? [];
  return (
    nodes.some((n) => n.type === "note") &&
    !nodes.some((n) => n.type === "text" && n.text.length > 0)
  );
}

/** Prepare a whole document (model JSON) — the PDF path's entry point. */
export function blocksFromDoc(doc: Doc, spec: FormatSpec): LayoutBlock[] {
  const out: LayoutBlock[] = [];
  doc.content.forEach((block: BlockNode, sourceIndex: number) => {
    if (isNoteOnlyContent(block.content)) return;
    const pieces: RawPiece[] = [];
    let srcOffset = 0;
    for (const inline of block.content ?? []) {
      if (inline.type === "text") {
        const marks = inline.marks ?? [];
        pieces.push({
          text: inline.text,
          bold: marks.some((m) => m.type === "strong"),
          italic: marks.some((m) => m.type === "em"),
          underline: marks.some((m) => m.type === "underline"),
          srcStart: srcOffset,
        });
        srcOffset += inline.text.length;
      }
      // Notes ([[ ]]) are print-invisible: skipped, contributing no width.
    }
    const extension =
      block.type === "character" ? ((block.attrs?.extension as string | null) ?? null) : null;
    const built = buildLayoutBlock({
      type: block.type,
      pieces,
      spec,
      sourceIndex,
      extension,
      dual: block.type === "character" && block.attrs?.dual === true,
    });
    if (built) out.push(built);
  });
  return out;
}

/** Map a print-text offset back to the caller's source coordinates. */
export function printOffsetToSrc(block: LayoutBlock, printOffset: number): number | null {
  let best: number | null = null;
  for (const seg of block.srcMap) {
    if (printOffset < seg.printStart) return best ?? seg.srcStart;
    if (printOffset < seg.printStart + seg.len) {
      return seg.srcStart + (printOffset - seg.printStart);
    }
    best = seg.srcStart + seg.len;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Wrapping                                                             */
/* ------------------------------------------------------------------ */

export interface WrappedLine {
  start: number;
  end: number;
}

const BREAK_AFTER = new Set(["-", "–", "—"]); // hyphen, en, em dash

/**
 * Greedy word wrap on a character grid, matching CSS `pre-wrap` +
 * `overflow-wrap: break-word`: breaks at spaces (trailing spaces hang) and
 * after hyphens/dashes; explicit newlines force breaks; a unit longer than
 * the column hard-breaks at the grid edge.
 */
export function wrapText(text: string, cpl: number): WrappedLine[] {
  const lines: WrappedLine[] = [];
  for (const para of splitParagraphs(text)) {
    wrapParagraph(text, para.start, para.end, cpl, lines);
  }
  if (lines.length === 0) lines.push({ start: 0, end: 0 });
  return lines;
}

function splitParagraphs(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      out.push({ start, end: i });
      start = i + 1;
    }
  }
  out.push({ start, end: text.length });
  return out;
}

function wrapParagraph(
  text: string,
  from: number,
  to: number,
  cpl: number,
  lines: WrappedLine[],
): void {
  let lineStart = from;
  let col = 0;
  let i = from;
  while (i < to) {
    if (text[i] === " ") {
      // Spaces always attach to the current line; at a soft break they hang
      // past the column edge the way pre-wrap renders them.
      while (i < to && text[i] === " ") {
        i++;
        col++;
      }
      continue;
    }
    // A breakable unit: non-space chars up to (and including) a dash.
    let unitEnd = i;
    while (unitEnd < to && text[unitEnd] !== " ") {
      unitEnd++;
      if (BREAK_AFTER.has(text[unitEnd - 1])) break;
    }
    const unitLen = unitEnd - i;
    if (col > 0 && col + unitLen > cpl) {
      lines.push({ start: lineStart, end: i });
      lineStart = i;
      col = 0;
    }
    if (unitLen > cpl) {
      // Hard-break an over-long unit at the grid edge.
      let rest = i;
      while (unitEnd - rest > cpl) {
        lines.push({ start: lineStart, end: rest + cpl });
        rest += cpl;
        lineStart = rest;
      }
      col = unitEnd - rest;
      i = unitEnd;
      continue;
    }
    col += unitLen;
    i = unitEnd;
  }
  lines.push({ start: lineStart, end: to });
}

/* ------------------------------------------------------------------ */
/* Pagination                                                           */
/* ------------------------------------------------------------------ */

interface Prepared {
  block: LayoutBlock;
  el: ElementFormat;
  colLeftIn: number;
  colWidthIn: number;
  cpl: number;
  lines: WrappedLine[];
  /** Line index this entry starts at (>0 for a split continuation). */
  fromLine: number;
  besideNext?: boolean;
  firstLineInset?: number;
}

interface Placed {
  prepared: Prepared;
  gapRows: number;
  lineCount: number;
  atRow: number;
}

interface PageBuild {
  intro?: FrontMatterLine[];
  lines: LayoutLine[];
  placed: Placed[];
  rowsUsed: number;
  /** The act and scene in force where the page begins (docs/app/formatting/formats-and-layout.md#FMT-101). */
  at: PagePosition;
  breakBefore?: PageBreakInfo;
  pendingContd: string | null;
}

function isDialogueLike(type: BlockType): boolean {
  return type === "dialogue" || type === "parenthetical" || type === "lyric";
}

/** Fixed adjacent columns, shared with the editor decorations. A long cue
 * wraps in its own column; the following block starts beside its first row. */
export function besidePairs(blocks: LayoutBlock[], spec: FormatSpec): Set<number> {
  const paired = new Set<number>();
  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i],
      next = blocks[i + 1];
    if (!spec.elements[block.type].besideNext || block.dual || next.dual) continue;
    // A dual pair has its own two columns; neither cue borrows the full-page
    // speech column (including the sequential fallback for an oversized pair).
    if (block.type === "character") {
      let end = i + 1;
      while (end < blocks.length && isDialogueLike(blocks[end].type)) end++;
      if (blocks[end]?.type === "character" && blocks[end].dual) continue;
    }
    if (
      !(
        (block.type === "character" && isDialogueLike(next.type)) ||
        (block.type === "act" && next.type === "scene")
      )
    )
      continue;
    const col = elementColumnIn(spec, block.type),
      after = elementColumnIn(spec, next.type);
    if (col.leftIn + col.widthIn <= after.leftIn + 1e-9) paired.add(block.sourceIndex);
  }
  return paired;
}

/** Short directions share a line with speech. A direction filling the whole
 * column retains its own paragraph so long directions remain readable. */
export function runInPairs(blocks: LayoutBlock[], spec: FormatSpec): Set<number> {
  const result = new Set<number>();
  const dual = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== "character" || !blocks[i].dual) continue;
    let start = i - 1;
    while (start >= 0 && isDialogueLike(blocks[start].type)) start--;
    let end = i + 1;
    while (end < blocks.length && isDialogueLike(blocks[end].type)) end++;
    for (let k = Math.max(0, start); k < end; k++) dual.add(blocks[k].sourceIndex);
  }
  for (let i = 0; i < blocks.length - 1; i++) {
    const block = blocks[i],
      next = blocks[i + 1];
    if (
      block.type !== "parenthetical" ||
      next.type !== "dialogue" ||
      !spec.elements.parenthetical.runInNext ||
      dual.has(block.sourceIndex)
    )
      continue;
    const col = elementColumnIn(spec, "dialogue");
    if (
      elementColumnIn(spec, "parenthetical").leftIn !== col.leftIn ||
      spec.elements.parenthetical.letterSpacing !== spec.elements.dialogue.letterSpacing
    )
      continue;
    if (
      !block.text.includes("\n") &&
      block.text.length + 1 < charsPerLine(spec, col.widthIn, spec.elements.dialogue.letterSpacing)
    )
      result.add(block.sourceIndex);
  }
  return result;
}

/** A dual-dialogue pair laid side by side as one unsplittable unit. */
interface DualUnit {
  kind: "dual";
  left: Prepared[];
  right: Prepared[];
  /** Full-measure entries for the taller-than-a-page fallback (sequential). */
  seqFallback: Prepared[];
}

type QueueItem = Prepared | DualUnit;

function isDualUnit(item: QueueItem): item is DualUnit {
  return "kind" in item;
}

/** Vertical rows a chain occupies in its half (lines + collapsed gaps). */
function chainRows(chain: Prepared[]): number {
  let rows = 0;
  let prevAfter = 0;
  let prevType: BlockType | null = null;
  for (const e of chain) {
    const gap =
      rows === 0
        ? 0
        : prevType === e.block.type && e.el.tightStack
          ? 0
          : Math.max(prevAfter, e.el.spacingBefore);
    rows += gap + e.lines.length;
    prevAfter = e.el.spacingAfter;
    prevType = e.block.type;
  }
  return rows;
}

function chainTailAfter(chain: Prepared[]): number {
  return chain.length ? chain[chain.length - 1].el.spacingAfter : 0;
}

/** Lay a prepared document out into pages. */
export function paginate(
  blocks: LayoutBlock[],
  spec: FormatSpec,
  meta: LayoutMeta = {},
): LayoutResult {
  const maxRows = Math.max(1, maxLinesPerPage(spec));
  const rules = spec.pagination;
  const paired = besidePairs(blocks, spec);
  const runIns = runInPairs(blocks, spec);
  const firstLineInsets = new Map(
    blocks.flatMap((block, index) =>
      runIns.has(block.sourceIndex)
        ? [[blocks[index + 1].sourceIndex, block.text.length + 1] as const]
        : [],
    ),
  );
  const besideBodies = new Set(
    blocks
      .filter((_, index) => index > 0 && paired.has(blocks[index - 1].sourceIndex))
      .map((block) => block.sourceIndex),
  );

  const prepareFull = (block: LayoutBlock): Prepared => {
    const col = elementColumnIn(spec, block.type, !besideBodies.has(block.sourceIndex));
    const cpl = charsPerLine(spec, col.widthIn, spec.elements[block.type].letterSpacing);
    const firstLineInset = firstLineInsets.get(block.sourceIndex) ?? 0;
    const lines = firstLineInset
      ? wrapText(" ".repeat(firstLineInset) + block.text, cpl).map((line) => ({
          start: Math.max(0, line.start - firstLineInset),
          end: Math.max(0, line.end - firstLineInset),
        }))
      : wrapText(block.text, cpl);
    return {
      block,
      el: spec.elements[block.type],
      colLeftIn: col.leftIn,
      colWidthIn: col.widthIn,
      cpl,
      lines: block.type === "pageBreak" ? [] : lines,
      fromLine: 0,
      besideNext: paired.has(block.sourceIndex) || runIns.has(block.sourceIndex),
      firstLineInset,
    };
  };
  const prepareHalf = (block: LayoutBlock, half: { leftIn: number; widthIn: number }): Prepared => {
    const cpl = charsPerLine(spec, half.widthIn, spec.elements[block.type].letterSpacing);
    return {
      block,
      el: spec.elements[block.type],
      colLeftIn: half.leftIn,
      colWidthIn: half.widthIn,
      cpl,
      lines: wrapText(block.text, cpl),
      fromLine: 0,
    };
  };

  // A speech chain: the cue plus its consecutive wrylies/dialogue.
  const chainEnd = (from: number): number => {
    let end = from + 1;
    while (end < blocks.length && isDialogueLike(blocks[end].type)) end++;
    return end; // exclusive
  };

  // Pair Fountain `^` cues with the speech chain immediately before them
  // (storage: the model marks only the RIGHT cue; the left partner is the
  // preceding chain). An unpaired `^` lays out sequentially.
  const duo = dualColumnsIn(spec);
  const queue: QueueItem[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "character" && !block.dual) {
      const leftEnd = chainEnd(i);
      const rightCue = blocks[leftEnd];
      if (rightCue && rightCue.type === "character" && rightCue.dual) {
        const rightEnd = chainEnd(leftEnd);
        const leftBlocks = blocks.slice(i, leftEnd);
        const rightBlocks = blocks.slice(leftEnd, rightEnd);
        queue.push({
          kind: "dual",
          left: leftBlocks.map((b) => prepareHalf(b, duo.left)),
          right: rightBlocks.map((b) => prepareHalf(b, duo.right)),
          seqFallback: [...leftBlocks, ...rightBlocks].map(prepareFull),
        });
        i = rightEnd;
        continue;
      }
    }
    queue.push(prepareFull(block));
    i++;
  }

  const pages: LayoutPage[] = [];
  let current: PagePosition = { ...START_POSITION };
  // Numbered once, in source order: a keep-with-next heading can be placed,
  // popped and placed again on the next page.
  const headingNumbers = numberHeadings(blocks);
  let currentCue: string | null = null;
  let lastAfter = 0;
  let lastType: BlockType | null = null;

  let page = openPage();
  function openPage(breakBefore?: PageBreakInfo): PageBuild {
    return {
      lines: [],
      placed: [],
      rowsUsed: 0,
      at: { ...current },
      breakBefore,
      pendingContd: breakBefore?.contd ?? null,
    };
  }

  function lineXIn(entry: Prepared, text: string): number {
    const trimmed = text.replace(/ +$/, "");
    const wIn = trimmed.length * charAdvanceIn(spec, entry.el.letterSpacing);
    if (entry.el.align === "center")
      return entry.colLeftIn + Math.max(0, (entry.colWidthIn - wIn) / 2);
    if (entry.el.align === "right") return entry.colLeftIn + Math.max(0, entry.colWidthIn - wIn);
    return entry.colLeftIn;
  }

  function emitContd(build: PageBuild): void {
    if (!build.pendingContd) return;
    const col = elementColumnIn(spec, "character");
    const el = spec.elements.character;
    const trimmed = build.pendingContd;
    const wIn = trimmed.length * charAdvanceIn(spec, el.letterSpacing);
    let xIn = col.leftIn;
    if (el.align === "center") xIn = col.leftIn + Math.max(0, (col.widthIn - wIn) / 2);
    else if (el.align === "right") xIn = col.leftIn + Math.max(0, col.widthIn - wIn);
    build.lines.push({
      kind: "contd",
      type: "character",
      sourceIndex: -1,
      start: 0,
      end: 0,
      text: trimmed,
      runs: [],
      row: 0,
      xIn,
    });
    build.rowsUsed = 1;
    build.pendingContd = null;
  }

  function clipRuns(block: LayoutBlock, wrapped: WrappedLine): StyleRun[] {
    const runs: StyleRun[] = [];
    for (const run of block.runs) {
      const start = Math.max(run.start, wrapped.start);
      const end = Math.min(run.end, wrapped.end);
      if (start < end) {
        runs.push({ ...run, start: start - wrapped.start, end: end - wrapped.start });
      }
    }
    return runs;
  }

  function placeLines(build: PageBuild, entry: Prepared, count: number, gapRows: number): void {
    emitContd(build);
    const previous = build.placed[build.placed.length - 1];
    const atRow =
      previous?.prepared.besideNext && entry.fromLine === 0
        ? previous.atRow
        : build.rowsUsed + gapRows;
    const { block } = entry;
    for (let i = 0; i < count; i++) {
      const wrapped = entry.lines[entry.fromLine + i];
      const text = block.text.slice(wrapped.start, wrapped.end);
      build.lines.push({
        kind: "text",
        type: block.type,
        sourceIndex: block.sourceIndex,
        start: wrapped.start,
        end: wrapped.end,
        text,
        runs: clipRuns(block, wrapped),
        row: atRow + i,
        xIn:
          lineXIn(entry, text) +
          (entry.fromLine + i === 0
            ? (entry.firstLineInset ?? 0) * charAdvanceIn(spec, entry.el.letterSpacing)
            : 0),
      });
    }
    build.rowsUsed = Math.max(build.rowsUsed, atRow + count);
    build.placed.push({ prepared: entry, gapRows, lineCount: count, atRow });
  }

  /** Both halves of a dual pair from the same base row; the taller side wins. */
  function placeDual(build: PageBuild, unit: DualUnit, gapRows: number, unitRows: number): void {
    emitContd(build);
    const base = build.rowsUsed + gapRows;
    let emitted = 0;
    for (const chain of [unit.left, unit.right]) {
      let row = base;
      let prevAfter = 0;
      let prevType: BlockType | null = null;
      for (const entry of chain) {
        const gap =
          row === base
            ? 0
            : prevType === entry.block.type && entry.el.tightStack
              ? 0
              : Math.max(prevAfter, entry.el.spacingBefore);
        row += gap;
        const { block } = entry;
        entry.lines.forEach((wrapped, lineIdx) => {
          const text = block.text.slice(wrapped.start, wrapped.end);
          build.lines.push({
            kind: "text",
            type: block.type,
            sourceIndex: block.sourceIndex,
            start: wrapped.start,
            end: wrapped.end,
            text,
            runs: clipRuns(block, wrapped),
            row: row + lineIdx,
            xIn: lineXIn(entry, text),
          });
        });
        row += entry.lines.length;
        emitted += entry.lines.length;
        prevAfter = entry.el.spacingAfter;
        prevType = entry.block.type;
      }
    }
    build.rowsUsed = base + unitRows;
    // One synthetic placed entry keeps popKeepChain/trailing-gap math coherent:
    // a completed pair ends in dialogue and never travels with what follows.
    const anchor = unit.left[0] ?? unit.right[0];
    build.placed.push({
      prepared: {
        ...anchor,
        el: {
          ...spec.elements.dialogue,
          keepWithNext: false,
          spacingAfter: Math.max(chainTailAfter(unit.left), chainTailAfter(unit.right)),
        },
      },
      gapRows,
      lineCount: emitted,
      atRow: base,
    });
  }

  /**
   * An act or scene heading has been placed: it is in force from here on, and
   * from the top of the page when nothing but headings came before it there —
   * the page that opens with ACT TWO is in Act Two.
   */
  function placedHeading(block: LayoutBlock): void {
    current = enterHeading(current, block, headingNumbers.get(block.sourceIndex) ?? null);
    const headingsOnly = page.lines.every(
      (line) => line.kind === "text" && (line.type === "act" || line.type === "scene"),
    );
    if (headingsOnly && !page.pendingContd) page.at = { ...current };
  }

  /** One page's header or footer, or null when it is suppressed or says nothing. */
  function resolveSlots(
    hf: FormatSpec["header"],
    pageNumber: number,
    build: PageBuild,
  ): HeaderText | null {
    if (pageNumber === 1 && hf.suppressOnFirstPage) return null;
    const values = slotValues({
      pageNumber,
      at: build.at,
      title: meta.title,
      author: meta.author,
      draftDate: meta.frontMatter?.draftDate,
    });
    const out: HeaderText = {};
    for (const slot of ["left", "center", "right"] as const) {
      const text = fillSlot(hf.content[slot] ?? "", values);
      if (text) out[slot] = text;
    }
    return out.left || out.center || out.right ? out : null;
  }

  function closePage(build: PageBuild, nextBreak?: PageBreakInfo): void {
    const pageNumber = pages.length + 1;
    const header = resolveSlots(spec.header, pageNumber, build);
    const footer = resolveSlots(spec.footer, pageNumber, build);
    const trailingAfter =
      build.placed.length > 0 ? build.placed[build.placed.length - 1].prepared.el.spacingAfter : 0;
    pages.push({
      pageNumber,
      header,
      footer,
      ...(build.intro?.length ? { intro: build.intro } : {}),
      lines: build.lines,
      usedRows: build.rowsUsed,
      fillRows: Math.max(0, maxRows - build.rowsUsed - trailingAfter),
      breakBefore: build.breakBefore,
    });
    lastAfter = 0;
    lastType = null;
    page = openPage(nextBreak);
  }

  /** Pop trailing keep-with-next blocks (cue, wryly, headings) off the page. */
  function popKeepChain(build: PageBuild): Prepared[] {
    const popped: Prepared[] = [];
    while (build.placed.length > 0) {
      const last = build.placed[build.placed.length - 1];
      if (!last.prepared.el.keepWithNext) break;
      build.placed.pop();
      build.lines.splice(build.lines.length - last.lineCount, last.lineCount);
      build.rowsUsed = last.atRow - last.gapRows;
      popped.unshift(last.prepared);
    }
    // Recompute the trailing spacing context for the block now at the end.
    const tail = build.placed[build.placed.length - 1];
    lastAfter = tail
      ? tail.prepared.el.spacingAfter
      : build.intro?.length
        ? spec.frontMatter.inlineGapRows
        : 0;
    lastType = tail ? tail.prepared.block.type : null;
    return popped;
  }

  if (spec.frontMatter.placement === "inline") {
    for (const [index, opening] of layoutFrontMatter(meta.frontMatter, spec).entries()) {
      if (index) closePage(page);
      page.intro = opening.lines;
      page.rowsUsed = opening.lines[opening.lines.length - 1].row + 1;
    }
    if (page.intro?.length) lastAfter = spec.frontMatter.inlineGapRows;
  }

  while (queue.length > 0) {
    const item = queue.shift()!;

    if (isDualUnit(item)) {
      const first = item.left[0] ?? item.right[0];
      const unitRows = Math.max(chainRows(item.left), chainRows(item.right));
      const pageEmpty = page.rowsUsed === 0 && page.lines.length === 0;
      const contdRow = page.pendingContd ? 1 : 0;
      const gap = pageEmpty || page.pendingContd ? 0 : Math.max(lastAfter, first.el.spacingBefore);
      const avail = maxRows - page.rowsUsed - contdRow - gap;
      if (unitRows <= avail) {
        placeDual(page, item, gap, unitRows);
        lastAfter = Math.max(chainTailAfter(item.left), chainTailAfter(item.right));
        lastType = "dialogue";
        currentCue = null;
        continue;
      }
      if (pageEmpty && !page.pendingContd) {
        // Taller than a whole fresh page: pairing is impossible — fall back
        // to sequential full-measure layout (progress guarantee).
        queue.unshift(...item.seqFallback);
        continue;
      }
      // Move the whole pair (with any keep-with-next chain above) to a new page.
      const chain = popKeepChain(page);
      if (chain.length > 0 && page.placed.length === 0) {
        chain[0] = { ...chain[0], el: { ...chain[0].el, keepWithNext: false } };
      }
      queue.unshift(...chain, item);
      const firstBlock = chain[0]?.block ?? first.block;
      closePage(page, { sourceIndex: firstBlock.sourceIndex, srcOffset: null, contd: null });
      continue;
    }

    const entry = item;
    const { block, el } = entry;

    if (block.type === "pageBreak") {
      if (page.rowsUsed > 0 || page.lines.length > 0) {
        closePage(page, { sourceIndex: block.sourceIndex, srcOffset: null, contd: null });
      }
      continue;
    }

    const beside = entry.fromLine === 0 && page.placed[page.placed.length - 1]?.prepared.besideNext;
    const afterAct =
      block.type === "scene" && page.placed[page.placed.length - 1]?.prepared.block.type === "act";
    if (el.startsNewPage && !beside && !afterAct && page.lines.length > 0) {
      closePage(page, { sourceIndex: block.sourceIndex, srcOffset: null, contd: null });
    }

    const remaining = entry.lines.length - entry.fromLine;
    const pageEmpty = page.rowsUsed === 0 && page.lines.length === 0;
    const contdRow = page.pendingContd ? 1 : 0;
    const gap =
      pageEmpty || page.pendingContd || beside
        ? 0
        : lastType === block.type && el.tightStack
          ? 0
          : Math.max(lastAfter, el.spacingBefore);
    const rowStart = beside ? page.placed[page.placed.length - 1].atRow : page.rowsUsed;
    const avail = maxRows - rowStart - contdRow - gap;

    if (remaining <= avail) {
      placeLines(page, entry, remaining, gap);
      lastAfter = el.spacingAfter;
      lastType = block.type;
      if (block.type === "character") currentCue = block.cueName ?? null;
      else if (!isDialogueLike(block.type)) currentCue = null;
      if (block.type === "act" || block.type === "scene") placedHeading(block);
      continue;
    }

    // Doesn't fit whole. Try a legal split.
    const splittable =
      block.type === "dialogue" || block.type === "action" || block.type === "lyric";
    const minBefore =
      block.type === "dialogue"
        ? rules.minDialogueLinesBeforeBreak
        : rules.minActionLinesEitherSide;
    const minAfter =
      block.type === "dialogue" ? rules.minDialogueLinesAfterBreak : rules.minActionLinesEitherSide;
    // A continuation chunk has already satisfied the "before" minimum on an
    // earlier page; only the remainder minimum still binds.
    const effMinBefore = entry.fromLine > 0 ? 1 : minBefore;
    const take = Math.min(avail, remaining - minAfter);

    if (splittable && avail > 0 && take >= effMinBefore) {
      placeLines(page, entry, take, gap);
      const splitLine = entry.lines[entry.fromLine + take];
      const contd =
        block.type === "dialogue" && rules.repeatCharacterOnSplit && currentCue
          ? `${currentCue}${rules.continuedMarker}`
          : null;
      const rest: Prepared = { ...entry, fromLine: entry.fromLine + take };
      queue.unshift(rest);
      closePage(page, {
        sourceIndex: block.sourceIndex,
        srcOffset: printOffsetToSrc(block, splitLine.start),
        contd,
      });
      continue;
    }

    if (pageEmpty && !page.pendingContd) {
      // A block that alone exceeds a fresh page: force-split at the sheet
      // edge (progress guarantee — minimums can't be satisfied).
      const forced = Math.max(1, Math.min(avail, remaining - 1));
      placeLines(page, entry, forced, 0);
      const splitLine = entry.lines[entry.fromLine + forced];
      const contd =
        block.type === "dialogue" && rules.repeatCharacterOnSplit && currentCue
          ? `${currentCue}${rules.continuedMarker}`
          : null;
      queue.unshift({ ...entry, fromLine: entry.fromLine + forced });
      closePage(page, {
        sourceIndex: block.sourceIndex,
        srcOffset: printOffsetToSrc(block, splitLine.start),
        contd,
      });
      continue;
    }

    // Move the block (and any keep-with-next chain above it) to a new page.
    const chain = popKeepChain(page);
    if (chain.length > 0 && page.placed.length === 0) {
      // The chain WAS the whole page (pathological: a page of nothing but
      // keep-with-next blocks). Un-keep its first block so the replay makes
      // progress instead of popping the same chain forever.
      chain[0] = { ...chain[0], el: { ...chain[0].el, keepWithNext: false } };
    }
    queue.unshift(...chain, entry);
    const first = chain[0]?.block ?? block;
    closePage(page, { sourceIndex: first.sourceIndex, srcOffset: null, contd: null });
  }

  closePage(page);
  // Drop a completely empty trailing page (e.g. a doc ending in a pageBreak),
  // but always keep at least one page.
  if (pages.length > 1) {
    const last = pages[pages.length - 1];
    if (last.lines.length === 0 && !last.intro?.length) pages.pop();
  }
  return { pages, maxRows };
}

/** Convenience for the PDF path: document JSON straight to pages. */
export function paginateDoc(doc: Doc, spec: FormatSpec, meta: LayoutMeta = {}): LayoutResult {
  return paginate(blocksFromDoc(doc, spec), spec, meta);
}
