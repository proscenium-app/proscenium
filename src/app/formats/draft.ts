// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The format designer's working copy of a format.
 *
 * A `FormatDraft` is a FormatSpec with every number held as the TEXT in its
 * field. A spec cannot hold "1." or "" — and a writer typing 1.25 passes
 * through both — so the draft keeps what was typed, and `checkDraft` turns it
 * into a spec through `validateFormatSpec`, the same validation a hand-written
 * file gets. Nothing here re-implements a rule: an invalid value is whatever
 * validate.ts says it is, reported at the field it came from.
 *
 * The round trip the spec asks for — designer state → JSON → validate → the
 * same state — is `draftFromSpec(checkDraft(d).spec) = d` for any draft made
 * from a spec (draft.test.ts, over every built-in).
 */
import type { BlockType } from "../../fountain/model";
import {
  FORMAT_ELEMENT_KEYS,
  REQUIRED_FORMAT_ELEMENTS,
  validateFormatSpec,
  type ElementAlign,
  type ElementFontStyle,
  type ElementFormat,
  type ElementTransform,
  type FormatSpec,
  type HeaderFooterSpec,
  type PageSizeName,
} from "../../format";

/** The printed elements, named the way the element bar names them. */
export const ELEMENT_LABELS: Record<(typeof REQUIRED_FORMAT_ELEMENTS)[number], string> = {
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
};

export interface SlotsDraft {
  left: string;
  center: string;
  right: string;
  /** Inches from the paper edge: the top for a header, the bottom for a footer. */
  position: string;
  suppressOnFirstPage: boolean;
}

export interface ElementDraft {
  indentFromMargin: string;
  /** True for "full" — from the indent to the right margin. */
  fullWidth: boolean;
  /** The cap in inches, when `fullWidth` is off. */
  maxWidth: string;
  align: ElementAlign;
  textTransform: ElementTransform;
  fontStyle: ElementFontStyle;
  letterSpacing: string;
  spacingBefore: string;
  spacingAfter: string;
  keepWithNext: boolean;
  parenWrap: boolean;
  besideNext: boolean;
  runInNext: boolean;
  standaloneIndentFromMargin: number | null;
  suffix: string;
  underline: boolean;
  startsNewPage: boolean;
  tightStack: boolean;
  print: boolean;
}

export interface FormatDraft {
  id: string;
  name: string;
  page: {
    size: PageSizeName;
    margins: { left: string; top: string; right: string; bottom: string };
  };
  type: { family: string; size: string; lineHeight: string };
  header: SlotsDraft;
  footer: SlotsDraft;
  elements: Record<BlockType, ElementDraft>;
  pagination: {
    continuedMarker: string;
    repeatCharacterOnSplit: boolean;
    minDialogueLinesBeforeBreak: string;
    minDialogueLinesAfterBreak: string;
    minActionLinesEitherSide: string;
  };
  dualDialogue: { gutterIn: string };
  frontMatter: FormatSpec["frontMatter"];
}

/** A number as a field shows it: no float noise, no trailing zeros. */
function text(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

function slotsFromSpec(hf: HeaderFooterSpec): SlotsDraft {
  return {
    left: hf.content.left ?? "",
    center: hf.content.center ?? "",
    right: hf.content.right ?? "",
    position: text(hf.position),
    suppressOnFirstPage: hf.suppressOnFirstPage,
  };
}

function elementFromSpec(el: ElementFormat): ElementDraft {
  return {
    indentFromMargin: text(el.indentFromMargin),
    fullWidth: el.maxWidth === "full",
    maxWidth: el.maxWidth === "full" ? "" : text(el.maxWidth),
    align: el.align,
    textTransform: el.textTransform,
    fontStyle: el.fontStyle,
    letterSpacing: text(el.letterSpacing),
    spacingBefore: text(el.spacingBefore),
    spacingAfter: text(el.spacingAfter),
    keepWithNext: el.keepWithNext,
    parenWrap: el.parenWrap,
    besideNext: el.besideNext,
    runInNext: el.runInNext,
    standaloneIndentFromMargin: el.standaloneIndentFromMargin,
    suffix: el.suffix,
    underline: el.underline,
    startsNewPage: el.startsNewPage,
    tightStack: el.tightStack,
    print: el.print,
  };
}

export function draftFromSpec(spec: FormatSpec): FormatDraft {
  const m = spec.page.margins;
  const elements = {} as Record<BlockType, ElementDraft>;
  for (const key of FORMAT_ELEMENT_KEYS) elements[key] = elementFromSpec(spec.elements[key]);
  return {
    id: spec.id,
    name: spec.name,
    page: {
      size: spec.page.size,
      margins: {
        left: text(m.left),
        top: text(m.top),
        right: text(m.right),
        bottom: text(m.bottom),
      },
    },
    type: {
      family: spec.type.family,
      size: text(spec.type.size),
      lineHeight: text(spec.type.lineHeight),
    },
    header: slotsFromSpec(spec.header),
    footer: slotsFromSpec(spec.footer),
    elements,
    pagination: {
      continuedMarker: spec.pagination.continuedMarker,
      repeatCharacterOnSplit: spec.pagination.repeatCharacterOnSplit,
      minDialogueLinesBeforeBreak: text(spec.pagination.minDialogueLinesBeforeBreak),
      minDialogueLinesAfterBreak: text(spec.pagination.minDialogueLinesAfterBreak),
      minActionLinesEitherSide: text(spec.pagination.minActionLinesEitherSide),
    },
    dualDialogue: { gutterIn: text(spec.dualDialogue.gutterIn) },
    frontMatter: { ...spec.frontMatter },
  };
}

/**
 * A field's text as validation should see it: a number when it is one, the
 * text itself when it is not — so validate.ts, not this file, says it is wrong.
 */
function num(value: string): number | string {
  const trimmed = value.trim();
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return value;
  return Number(trimmed);
}

function slotsToRaw(slots: SlotsDraft): Record<string, unknown> {
  const content: Record<string, string> = {};
  for (const slot of ["left", "center", "right"] as const)
    if (slots[slot]) content[slot] = slots[slot];
  return { content, position: num(slots.position), suppressOnFirstPage: slots.suppressOnFirstPage };
}

/** The draft as the JSON a format file would hold. */
export function draftToRaw(draft: FormatDraft): Record<string, unknown> {
  const elements: Record<string, unknown> = {};
  for (const key of FORMAT_ELEMENT_KEYS) {
    const el = draft.elements[key];
    elements[key] = {
      indentFromMargin: num(el.indentFromMargin),
      maxWidth: el.fullWidth ? "full" : num(el.maxWidth),
      align: el.align,
      textTransform: el.textTransform,
      fontStyle: el.fontStyle,
      letterSpacing: num(el.letterSpacing),
      spacingBefore: num(el.spacingBefore),
      spacingAfter: num(el.spacingAfter),
      keepWithNext: el.keepWithNext,
      parenWrap: el.parenWrap,
      besideNext: el.besideNext,
      runInNext: el.runInNext,
      standaloneIndentFromMargin: el.standaloneIndentFromMargin,
      suffix: el.suffix,
      underline: el.underline,
      startsNewPage: el.startsNewPage,
      tightStack: el.tightStack,
      print: el.print,
    };
  }
  const m = draft.page.margins;
  return {
    // An unsaved format has no id yet; validation still needs one to accept it.
    id: draft.id || "unsaved",
    name: draft.name,
    page: {
      size: draft.page.size,
      margins: { left: num(m.left), top: num(m.top), right: num(m.right), bottom: num(m.bottom) },
    },
    type: {
      family: draft.type.family,
      size: num(draft.type.size),
      lineHeight: num(draft.type.lineHeight),
    },
    header: slotsToRaw(draft.header),
    footer: slotsToRaw(draft.footer),
    elements,
    pagination: {
      continuedMarker: draft.pagination.continuedMarker,
      repeatCharacterOnSplit: draft.pagination.repeatCharacterOnSplit,
      minDialogueLinesBeforeBreak: num(draft.pagination.minDialogueLinesBeforeBreak),
      minDialogueLinesAfterBreak: num(draft.pagination.minDialogueLinesAfterBreak),
      minActionLinesEitherSide: num(draft.pagination.minActionLinesEitherSide),
    },
    dualDialogue: { gutterIn: num(draft.dualDialogue.gutterIn) },
    frontMatter: { ...draft.frontMatter },
  };
}

/**
 * Validation's message in a writer's words. The path is already the field, so
 * "expected a number, got string" can simply ask for a number.
 */
function plain(message: string): string {
  if (/^expected a number/.test(message)) return "Enter a number.";
  if (/^expected an integer/.test(message)) return "Enter a whole number.";
  const min = message.match(/^must be ≥ ([\d.]+)/);
  if (min) return `Enter ${min[1]} or more.`;
  const token = message.match(/^unknown token (\{[^}]*\})/);
  if (token)
    return `${token[1]} can’t be printed. Use Insert to add a page, act or scene number, the title, author or draft date.`;
  if (/left \+ right margins/.test(message))
    return "The left and right margins leave no room for text.";
  if (/top \+ bottom margins/.test(message))
    return "The top and bottom margins leave no room for text.";
  return message.charAt(0).toUpperCase() + message.slice(1);
}

export interface DraftCheck {
  /** The format, when every field is valid; null while anything is not. */
  spec: FormatSpec | null;
  /** Field path (`elements.character.indentFromMargin`) → what is wrong, in plain words. */
  errors: Map<string, string>;
}

export function checkDraft(draft: FormatDraft): DraftCheck {
  const errors = new Map<string, string>();
  if (!draft.name.trim()) errors.set("name", "Give the format a name.");
  const result = validateFormatSpec(draftToRaw(draft));
  if (!result.ok) {
    for (const line of result.errors) {
      const at = line.indexOf(": ");
      const path = at === -1 ? "format" : line.slice(0, at);
      const message = at === -1 ? line : line.slice(at + 2);
      // Header and footer tokens are reported on the slot; the path already is.
      if (!errors.has(path)) errors.set(path, plain(message));
    }
    return { spec: null, errors };
  }
  if (errors.size) return { spec: null, errors };
  return { spec: { ...result.spec, id: draft.id, name: draft.name.trim() }, errors };
}

/* ── What changed, in words ─────────────────────────────────────────────── */

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The parts of a format that differ between two drafts, named as the designer
 * names them — so closing with unsaved work says WHAT would be lost ("the
 * margins, Character and the header") rather than only that something would.
 */
export function changedParts(from: FormatDraft, to: FormatDraft): string[] {
  const out: string[] = [];
  if (from.name !== to.name) out.push("the name");
  if (from.page.size !== to.page.size) out.push("the page size");
  if (!same(from.page.margins, to.page.margins)) out.push("the margins");
  if (!same(from.type, to.type)) out.push("the type");
  if (!same(from.header, to.header)) out.push("the header");
  if (!same(from.footer, to.footer)) out.push("the footer");
  for (const key of REQUIRED_FORMAT_ELEMENTS) {
    if (!same(from.elements[key], to.elements[key])) out.push(ELEMENT_LABELS[key]);
  }
  if (!same(from.pagination, to.pagination)) out.push("page breaks");
  if (!same(from.dualDialogue, to.dualDialogue)) out.push("dual dialogue");
  return out;
}

/** "a", "a and b", "a, b and c". */
export function listInWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
