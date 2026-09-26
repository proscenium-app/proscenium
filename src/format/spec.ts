// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Declarative script-format specs (docs/app/formatting/formats-and-layout.md#SCHEMA-D100 is the schema reference).
 *
 * A FormatSpec is one complete description of how a script lays out on the
 * page: page geometry, type, per-element treatment, pagination policy. The
 * renderer and the pagination engine consume a *resolved* spec and hold no
 * layout constants of their own — if a renderer needs a number, it comes from
 * here. Projects reference a spec by id only (`settings.houseStyle`), never by
 * value, so switching formats re-renders with zero document changes.
 *
 * Units: margins/indents/widths/header positions in inches; type size in
 * points; lineHeight as a multiple of the size; spacingBefore/After in blank
 * lines (multiples of the line pitch); letterSpacing in em. The gap between
 * two blocks collapses to max(prev.spacingAfter, next.spacingBefore).
 */
import type { BlockType } from "../fountain/model";

export type PageSizeName = "letter" | "a4";
export type ElementAlign = "left" | "center" | "right";
export type ElementTransform = "none" | "uppercase";
export type ElementFontStyle = "regular" | "italic" | "bold" | "bold-italic";
export type HeaderFooterSlot = "left" | "center" | "right";

/** Fully-resolved per-element treatment (every field concrete after validation). */
export interface ElementFormat {
  /** Column start, inches from the LEFT TEXT MARGIN (not the paper edge). */
  indentFromMargin: number;
  /** Column width cap in inches; "full" = from the indent to the right margin. */
  maxWidth: number | "full";
  align: ElementAlign;
  textTransform: ElementTransform;
  fontStyle: ElementFontStyle;
  /** Tracking in em, included in wrapping and text advance (0 = none). */
  letterSpacing: number;
  /** Blank lines above (collapses against the previous block's spacingAfter). */
  spacingBefore: number;
  /** Blank lines below (collapses against the next block's spacingBefore). */
  spacingAfter: number;
  /** Never the last block on a page; travels with what follows it. */
  keepWithNext: boolean;
  /** Render literal parens around the content (the model stays clean text). */
  parenWrap: boolean;
  /** Put a following block beside this one when their columns do not overlap. */
  besideNext: boolean;
  /** A one-line parenthetical runs into following dialogue with one space. */
  runInNext: boolean;
  /** Optional column start when this block has no preceding beside-next block. */
  standaloneIndentFromMargin: number | null;
  /** Printed cue punctuation, never written into the document. */
  suffix: string;
  underline: boolean;
  startsNewPage: boolean;
  /** Zero gap between consecutive blocks of the same type (lyric stanzas). */
  tightStack: boolean;
  /** When false the element never reaches pagination or print (synopsis). */
  print: boolean;
}

export interface PageMargins {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PageSpec {
  size: PageSizeName;
  margins: PageMargins;
}

export interface TypeSpec {
  family: string;
  /** Points. */
  size: number;
  /** Multiple of `size`; 12pt × 1.0 = 6 lines per inch. */
  lineHeight: number;
}

export interface HeaderFooterSpec {
  /** Slot → template string; tokens are HEADER_TOKENS, e.g. `{actRoman}-{sceneNumber}-{page}`. */
  content: Partial<Record<HeaderFooterSlot, string>>;
  /** Inches from the paper edge (top edge for headers, bottom for footers). */
  position: number;
  suppressOnFirstPage: boolean;
}

export interface PaginationRules {
  /** Appended to the re-printed cue when a speech splits across pages. */
  continuedMarker: string;
  repeatCharacterOnSplit: boolean;
  minDialogueLinesBeforeBreak: number;
  minDialogueLinesAfterBreak: number;
  minActionLinesEitherSide: number;
}

/** Side-by-side simultaneous speech (Fountain `^`). */
export interface DualDialogueSpec {
  /** Horizontal gap between the two half-columns, inches. */
  gutterIn: number;
}

export interface FormatSpec {
  id: string;
  name: string;
  page: PageSpec;
  type: TypeSpec;
  header: HeaderFooterSpec;
  footer: HeaderFooterSpec;
  elements: Record<BlockType, ElementFormat>;
  pagination: PaginationRules;
  dualDialogue: DualDialogueSpec;
  frontMatter: FrontMatterSpec;
}

/** Front sheets or a compact opening on the first numbered script page.
 * Gaps are blank rows. Overflow always continues on another sheet. */
export interface FrontMatterSpec {
  placement: "separate-pages" | "inline";
  inlineGapRows: number;
  titleTopFraction: number;
  titleGapRows: number;
  titleContactGapRows: number;
  sectionTopRows: number;
  headingGapRows: number;
  castGapRows: number;
  fieldGapRows: number;
  contactBottomRows: number;
  titleFontStyle: ElementFontStyle;
  headingFontStyle: ElementFontStyle;
  bodyFontStyle: ElementFontStyle;
  contactAlign: ElementAlign;
}

export const PAGE_SIZES: Record<PageSizeName, { widthIn: number; heightIn: number }> = {
  letter: { widthIn: 8.5, heightIn: 11 },
  a4: { widthIn: 8.27, heightIn: 11.69 },
};

/**
 * What a header or footer slot can print (docs/app/formatting/formats-and-layout.md#FMT-101):
 * the page number, the act and scene numbers, the title-page fields, and the
 * act and scene headings as written.
 */
export const HEADER_TOKENS = [
  "page",
  "actNumber",
  "actRoman",
  "sceneNumber",
  "title",
  "author",
  "draftDate",
  "act",
  "scene",
] as const;
export type HeaderToken = (typeof HEADER_TOKENS)[number];

/** Block types a format file MUST style — the printed play body. */
export const REQUIRED_FORMAT_ELEMENTS = [
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
] as const satisfies readonly BlockType[];

/**
 * Block types a format file may omit; an absent entry gets these presets on
 * top of the element defaults (they are editor-visible but never print).
 */
export const OPTIONAL_FORMAT_ELEMENT_PRESETS = {
  synopsis: { print: false, fontStyle: "italic" },
  pageBreak: { print: false, startsNewPage: true },
  boneyard: { print: false, fontStyle: "italic" },
} as const satisfies Partial<Record<BlockType, Partial<ElementFormat>>>;

export const FORMAT_ELEMENT_KEYS = [
  ...REQUIRED_FORMAT_ELEMENTS,
  "synopsis",
  "pageBreak",
  "boneyard",
] as const satisfies readonly BlockType[];

type UncoveredBlockType = Exclude<BlockType, (typeof FORMAT_ELEMENT_KEYS)[number]>;
/**
 * Compile-time exhaustiveness guard: when the fountain model gains a block
 * type this assignment stops compiling — add the new key to
 * FORMAT_ELEMENT_KEYS and decide its treatment in every shipped format.
 */
export const FORMAT_KEYS_COVER_MODEL: UncoveredBlockType extends never ? true : never = true;

/* Geometry helpers — the single source of truth the renderer, the pagination
 * engine, and the tests all derive page arithmetic from. */

export function pageSizeIn(spec: FormatSpec): { widthIn: number; heightIn: number } {
  return PAGE_SIZES[spec.page.size];
}

/** Width of the text block (margin to margin), inches. dg-modern: 6.0". */
export function textBlockWidthIn(spec: FormatSpec): number {
  const { widthIn } = pageSizeIn(spec);
  return widthIn - spec.page.margins.left - spec.page.margins.right;
}

/** Height of the text block, inches. dg-modern: 9.0". */
export function textBlockHeightIn(spec: FormatSpec): number {
  const { heightIn } = pageSizeIn(spec);
  return heightIn - spec.page.margins.top - spec.page.margins.bottom;
}

/** Vertical advance of one line, inches. dg-modern: 12pt × 1.2 = 1/5". */
export function linePitchIn(spec: FormatSpec): number {
  return (spec.type.size * spec.type.lineHeight) / 72;
}

/** Whole lines that fit in the text block. dg-modern: 54. */
export function maxLinesPerPage(spec: FormatSpec): number {
  return Math.floor(textBlockHeightIn(spec) / linePitchIn(spec) + 1e-9);
}

/**
 * An element's column: offset from the text-block left edge and usable width,
 * inches. Resolves indentFromMargin + maxWidth against the block width so the
 * renderer and the engine can never disagree about where text may sit.
 */
export function elementColumnIn(
  spec: FormatSpec,
  type: BlockType,
  standalone = false,
): { leftIn: number; widthIn: number } {
  const el = spec.elements[type];
  const block = textBlockWidthIn(spec);
  const leftIn = Math.min(standalone ? el.standaloneIndentFromMargin ?? el.indentFromMargin : el.indentFromMargin, block);
  const remaining = block - leftIn;
  const widthIn = el.maxWidth === "full" ? remaining : Math.min(el.maxWidth, remaining);
  return { leftIn, widthIn };
}

/**
 * The two half-columns of a dual-dialogue pair, inches from the text-block
 * left edge. Inside a half, elements use the half's FULL width with their own
 * alignment — indentFromMargin/maxWidth are full-measure concepts and are
 * deliberately not applied (Dramatists Guild dual layout centers each cue
 * over its own half).
 */
export function dualColumnsIn(spec: FormatSpec): {
  left: { leftIn: number; widthIn: number };
  right: { leftIn: number; widthIn: number };
} {
  const block = textBlockWidthIn(spec);
  const gutter = Math.min(spec.dualDialogue.gutterIn, block / 2);
  const half = (block - gutter) / 2;
  return {
    left: { leftIn: 0, widthIn: half },
    right: { leftIn: half + gutter, widthIn: half },
  };
}
