// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Format-file validation: unknown JSON in, resolved FormatSpec out.
 *
 * Strict on purpose — user format files are hand-written, and a silently
 * ignored typo ("indent" for "indentFromMargin", "midle" for "middle") is the
 * worst failure mode. Unknown keys, bad enum values, and malformed numbers are
 * hard errors with path-annotated messages; *absent* optional fields get the
 * documented defaults. All problems in a file are collected, not just the
 * first.
 */
import type { BlockType } from "../fountain/model";
import frontMatterDefaults from "../../formats/defaults/front-matter.json";
import {
  FORMAT_ELEMENT_KEYS,
  HEADER_TOKENS,
  OPTIONAL_FORMAT_ELEMENT_PRESETS,
  PAGE_SIZES,
  REQUIRED_FORMAT_ELEMENTS,
  type DualDialogueSpec,
  type ElementFormat,
  type FormatSpec,
  type FrontMatterSpec,
  type HeaderFooterSpec,
  type PaginationRules,
} from "./spec";

/** What a `type.family` may hold: font names and generic families, comma-separated. */
const FONT_FAMILY = /^[A-Za-z0-9 ,'"._-]+$/;
const COURIER_FALLBACKS = new Set(["courier prime", "courier new", "courier", "monospace"]);

export type FormatValidation =
  | { ok: true; spec: FormatSpec }
  | { ok: false; errors: string[] };

export const DEFAULT_FRONT_MATTER = frontMatterDefaults as FrontMatterSpec;

function checkFrontMatter(c: Check, raw: unknown): FrontMatterSpec {
  const result = { ...DEFAULT_FRONT_MATTER };
  if (raw === undefined) return result;
  const obj = c.record("frontMatter", raw);
  if (!obj) return result;
  c.noUnknownKeys("frontMatter", obj, Object.keys(result));
  for (const key of ["inlineGapRows", "titleTopFraction", "titleGapRows", "titleContactGapRows", "sectionTopRows", "headingGapRows", "castGapRows", "fieldGapRows", "contactBottomRows"] as const) {
    if (key in obj) result[key] = c.number(`frontMatter.${key}`, obj[key], result[key], { min: 0 });
  }
  if (result.titleTopFraction > 1) c.fail("frontMatter.titleTopFraction", "must be between 0 and 1");
  if ("placement" in obj) result.placement = c.oneOf("frontMatter.placement", obj.placement, ["separate-pages", "inline"], result.placement);
  if ("contactAlign" in obj) result.contactAlign = c.oneOf("frontMatter.contactAlign", obj.contactAlign, ["left", "center", "right"], result.contactAlign);
  for (const key of ["titleFontStyle", "headingFontStyle", "bodyFontStyle"] as const) {
    if (key in obj) result[key] = c.oneOf(`frontMatter.${key}`, obj[key], ["regular", "italic", "bold", "bold-italic"], result[key]);
  }
  return result;
}

/** What an element entry resolves to for every field a file leaves out. */
export const DEFAULT_ELEMENT: ElementFormat = {
  indentFromMargin: 0,
  maxWidth: "full",
  align: "left",
  textTransform: "none",
  fontStyle: "regular",
  letterSpacing: 0,
  spacingBefore: 0,
  spacingAfter: 0,
  keepWithNext: false,
  parenWrap: false,
  besideNext: false,
  runInNext: false,
  standaloneIndentFromMargin: null,
  suffix: "",
  underline: false,
  startsNewPage: false,
  tightStack: false,
  print: true,
};

export const DEFAULT_HEADER_FOOTER: Readonly<HeaderFooterSpec> = {
  content: {},
  position: 0.5,
  suppressOnFirstPage: false,
};

export const DEFAULT_PAGINATION: Readonly<PaginationRules> = {
  continuedMarker: " (CONT'D)",
  repeatCharacterOnSplit: true,
  minDialogueLinesBeforeBreak: 2,
  minDialogueLinesAfterBreak: 2,
  minActionLinesEitherSide: 2,
};

export const DEFAULT_DUAL_DIALOGUE: Readonly<DualDialogueSpec> = {
  gutterIn: 0.2,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Collects path-annotated errors; every `take*` returns a fallback on error. */
class Check {
  readonly errors: string[] = [];

  fail(path: string, message: string): void {
    this.errors.push(`${path}: ${message}`);
  }

  record(path: string, v: unknown): Record<string, unknown> | null {
    if (isRecord(v)) return v;
    this.fail(path, `expected an object, got ${v === null ? "null" : typeof v}`);
    return null;
  }

  /** Errors on any key of `obj` not in `allowed` (the typo guard). */
  noUnknownKeys(path: string, obj: Record<string, unknown>, allowed: readonly string[]): void {
    for (const key of Object.keys(obj)) {
      if (!allowed.includes(key)) {
        this.fail(`${path}.${key}`, `unknown key (expected one of: ${allowed.join(", ")})`);
      }
    }
  }

  string(path: string, v: unknown, fallback: string): string {
    // (see FONT_FAMILY for the one string that is also checked for content)
    if (typeof v === "string") return v;
    this.fail(path, `expected a string, got ${typeof v}`);
    return fallback;
  }

  number(
    path: string,
    v: unknown,
    fallback: number,
    opts: { min?: number; integer?: boolean } = {},
  ): number {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.fail(path, `expected a number, got ${typeof v === "number" ? v : typeof v}`);
      return fallback;
    }
    if (opts.integer && !Number.isInteger(v)) {
      this.fail(path, `expected an integer, got ${v}`);
      return fallback;
    }
    if (opts.min !== undefined && v < opts.min) {
      this.fail(path, `must be ≥ ${opts.min}, got ${v}`);
      return fallback;
    }
    return v;
  }

  boolean(path: string, v: unknown, fallback: boolean): boolean {
    if (typeof v === "boolean") return v;
    this.fail(path, `expected true or false, got ${typeof v}`);
    return fallback;
  }

  oneOf<T extends string>(path: string, v: unknown, allowed: readonly T[], fallback: T): T {
    if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
    this.fail(path, `expected one of ${allowed.join(" | ")}, got ${JSON.stringify(v)}`);
    return fallback;
  }
}

function checkElement(c: Check, path: string, raw: unknown, base: ElementFormat): ElementFormat {
  const obj = c.record(path, raw);
  if (!obj) return base;
  c.noUnknownKeys(path, obj, Object.keys(DEFAULT_ELEMENT));
  const el = { ...base };
  if ("indentFromMargin" in obj)
    el.indentFromMargin = c.number(`${path}.indentFromMargin`, obj.indentFromMargin, base.indentFromMargin, { min: 0 });
  if ("maxWidth" in obj) {
    el.maxWidth =
      obj.maxWidth === "full"
        ? "full"
        : c.number(`${path}.maxWidth`, obj.maxWidth, 1, { min: 0.1 });
  }
  if ("align" in obj)
    el.align = c.oneOf(`${path}.align`, obj.align, ["left", "center", "right"], base.align);
  if ("textTransform" in obj)
    el.textTransform = c.oneOf(`${path}.textTransform`, obj.textTransform, ["none", "uppercase"], base.textTransform);
  if ("fontStyle" in obj)
    el.fontStyle = c.oneOf(
      `${path}.fontStyle`,
      obj.fontStyle,
      ["regular", "italic", "bold", "bold-italic"],
      base.fontStyle,
    );
  if ("letterSpacing" in obj)
    el.letterSpacing = c.number(`${path}.letterSpacing`, obj.letterSpacing, base.letterSpacing, { min: 0 });
  if ("spacingBefore" in obj)
    el.spacingBefore = c.number(`${path}.spacingBefore`, obj.spacingBefore, base.spacingBefore, { min: 0 });
  if ("spacingAfter" in obj)
    el.spacingAfter = c.number(`${path}.spacingAfter`, obj.spacingAfter, base.spacingAfter, { min: 0 });
  if ("keepWithNext" in obj)
    el.keepWithNext = c.boolean(`${path}.keepWithNext`, obj.keepWithNext, base.keepWithNext);
  if ("parenWrap" in obj) el.parenWrap = c.boolean(`${path}.parenWrap`, obj.parenWrap, base.parenWrap);
  if ("besideNext" in obj) el.besideNext = c.boolean(`${path}.besideNext`, obj.besideNext, base.besideNext);
  if ("runInNext" in obj) el.runInNext = c.boolean(`${path}.runInNext`, obj.runInNext, base.runInNext);
  if ("standaloneIndentFromMargin" in obj) el.standaloneIndentFromMargin = obj.standaloneIndentFromMargin === null ? null
    : c.number(`${path}.standaloneIndentFromMargin`, obj.standaloneIndentFromMargin, 0, { min: 0 });
  if ("suffix" in obj) {
    el.suffix = c.string(`${path}.suffix`, obj.suffix, base.suffix);
    if (!/^[ :.,;!?-]{0,8}$/.test(el.suffix)) c.fail(`${path}.suffix`, "use up to eight spaces or punctuation characters");
  }
  if ("underline" in obj) el.underline = c.boolean(`${path}.underline`, obj.underline, base.underline);
  if ("startsNewPage" in obj)
    el.startsNewPage = c.boolean(`${path}.startsNewPage`, obj.startsNewPage, base.startsNewPage);
  if ("tightStack" in obj)
    el.tightStack = c.boolean(`${path}.tightStack`, obj.tightStack, base.tightStack);
  if ("print" in obj) el.print = c.boolean(`${path}.print`, obj.print, base.print);
  return el;
}

function checkHeaderFooter(c: Check, path: string, raw: unknown): HeaderFooterSpec {
  if (raw === undefined) return { ...DEFAULT_HEADER_FOOTER, content: {} };
  const obj = c.record(path, raw);
  if (!obj) return { ...DEFAULT_HEADER_FOOTER, content: {} };
  c.noUnknownKeys(path, obj, ["content", "position", "suppressOnFirstPage"]);
  const out: HeaderFooterSpec = { ...DEFAULT_HEADER_FOOTER, content: {} };
  if ("content" in obj) {
    const content = c.record(`${path}.content`, obj.content);
    if (content) {
      c.noUnknownKeys(`${path}.content`, content, ["left", "center", "right"]);
      for (const slot of ["left", "center", "right"] as const) {
        if (!(slot in content)) continue;
        const text = c.string(`${path}.content.${slot}`, content[slot], "");
        for (const [, token] of text.matchAll(/\{([^}]*)\}/g)) {
          if (!(HEADER_TOKENS as readonly string[]).includes(token)) {
            c.fail(
              `${path}.content.${slot}`,
              `unknown token {${token}} (expected: ${HEADER_TOKENS.map((t) => `{${t}}`).join(" ")})`,
            );
          }
        }
        out.content[slot] = text;
      }
    }
  }
  if ("position" in obj) out.position = c.number(`${path}.position`, obj.position, 0.5, { min: 0 });
  if ("suppressOnFirstPage" in obj)
    out.suppressOnFirstPage = c.boolean(
      `${path}.suppressOnFirstPage`,
      obj.suppressOnFirstPage,
      false,
    );
  return out;
}

function checkPagination(c: Check, raw: unknown): PaginationRules {
  if (raw === undefined) return { ...DEFAULT_PAGINATION };
  const obj = c.record("pagination", raw);
  if (!obj) return { ...DEFAULT_PAGINATION };
  c.noUnknownKeys("pagination", obj, Object.keys(DEFAULT_PAGINATION));
  const out = { ...DEFAULT_PAGINATION };
  if ("continuedMarker" in obj)
    out.continuedMarker = c.string("pagination.continuedMarker", obj.continuedMarker, out.continuedMarker);
  if ("repeatCharacterOnSplit" in obj)
    out.repeatCharacterOnSplit = c.boolean(
      "pagination.repeatCharacterOnSplit",
      obj.repeatCharacterOnSplit,
      out.repeatCharacterOnSplit,
    );
  for (const key of [
    "minDialogueLinesBeforeBreak",
    "minDialogueLinesAfterBreak",
    "minActionLinesEitherSide",
  ] as const) {
    if (key in obj) out[key] = c.number(`pagination.${key}`, obj[key], out[key], { min: 1, integer: true });
  }
  return out;
}

function checkDualDialogue(c: Check, raw: unknown): DualDialogueSpec {
  if (raw === undefined) return { ...DEFAULT_DUAL_DIALOGUE };
  const obj = c.record("dualDialogue", raw);
  if (!obj) return { ...DEFAULT_DUAL_DIALOGUE };
  c.noUnknownKeys("dualDialogue", obj, ["gutterIn"]);
  const out = { ...DEFAULT_DUAL_DIALOGUE };
  if ("gutterIn" in obj)
    out.gutterIn = c.number("dualDialogue.gutterIn", obj.gutterIn, out.gutterIn, { min: 0 });
  return out;
}

/** Validate a parsed format file; returns a fully-resolved spec or all errors. */
export function validateFormatSpec(raw: unknown): FormatValidation {
  const c = new Check();
  const obj = c.record("format", raw);
  if (!obj) return { ok: false, errors: c.errors };

  c.noUnknownKeys("format", obj, [
    "id",
    "name",
    "page",
    "type",
    "header",
    "footer",
    "elements",
    "pagination",
    "dualDialogue",
    "frontMatter",
  ]);

  const id = c.string("id", obj.id, "");
  if (id && !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    c.fail("id", `must be lowercase letters/digits/hyphens, got ${JSON.stringify(id)}`);
  }
  const name = c.string("name", obj.name, id);

  // page
  let page: FormatSpec["page"] = { size: "letter", margins: { left: 1.5, top: 1, right: 1, bottom: 1 } };
  {
    const p = c.record("page", obj.page);
    if (p) {
      c.noUnknownKeys("page", p, ["size", "margins"]);
      const size = c.oneOf("page.size", p.size, Object.keys(PAGE_SIZES) as ("letter" | "a4")[], "letter");
      const m = c.record("page.margins", p.margins);
      const margins = { ...page.margins };
      if (m) {
        c.noUnknownKeys("page.margins", m, ["left", "top", "right", "bottom"]);
        for (const side of ["left", "top", "right", "bottom"] as const) {
          margins[side] = c.number(`page.margins.${side}`, m[side], margins[side], { min: 0 });
        }
        const { widthIn, heightIn } = PAGE_SIZES[size];
        if (margins.left + margins.right >= widthIn)
          c.fail("page.margins", "left + right margins consume the whole page width");
        if (margins.top + margins.bottom >= heightIn)
          c.fail("page.margins", "top + bottom margins consume the whole page height");
      }
      page = { size, margins };
    }
  }

  // type
  let type: FormatSpec["type"] = { family: "Courier Prime, Courier New, Courier, monospace", size: 12, lineHeight: 1 };
  {
    const t = c.record("type", obj.type);
    if (t) {
      c.noUnknownKeys("type", t, ["family", "size", "lineHeight"]);
      type = {
        family: c.string("type.family", t.family, type.family),
        size: c.number("type.size", t.size, type.size, { min: 1 }),
        lineHeight: c.number("type.lineHeight", t.lineHeight, type.lineHeight, { min: 0.5 }),
      };
      // Names and generic families, comma-separated, and nothing CSS can read
      // as more than a value: the family goes into a stylesheet verbatim, and
      // a `;` in it once closed the rule and opened another.
      if (!FONT_FAMILY.test(type.family)) {
        c.fail("type.family", "a font family is names separated by commas — letters, digits, spaces, quotes, hyphens and dots only");
      } else {
        const families = type.family.split(",").map((part) => part.trim().replace(/^(['"])(.*)\1$/, "$2").toLowerCase());
        if (families[0] !== "courier prime" || families.some((name) => !COURIER_FALLBACKS.has(name))) {
          c.fail("type.family", "start with Courier Prime, the embedded script face; supported fallbacks are Courier New, Courier and monospace");
        }
      }
    }
  }

  const header = checkHeaderFooter(c, "header", obj.header);
  const footer = checkHeaderFooter(c, "footer", obj.footer);

  // elements
  const elements = {} as Record<BlockType, ElementFormat>;
  {
    const els = c.record("elements", obj.elements);
    if (els) {
      c.noUnknownKeys("elements", els, FORMAT_ELEMENT_KEYS);
      for (const key of REQUIRED_FORMAT_ELEMENTS) {
        if (!(key in els)) c.fail(`elements.${key}`, "missing (every printed element needs an entry)");
      }
      for (const key of FORMAT_ELEMENT_KEYS) {
        const preset = (OPTIONAL_FORMAT_ELEMENT_PRESETS as Partial<Record<BlockType, Partial<ElementFormat>>>)[key];
        const base: ElementFormat = { ...DEFAULT_ELEMENT, ...preset };
        elements[key] = key in els ? checkElement(c, `elements.${key}`, els[key], base) : base;
      }
    }
  }

  const pagination = checkPagination(c, obj.pagination);
  const dualDialogue = checkDualDialogue(c, obj.dualDialogue);
  const frontMatter = checkFrontMatter(c, obj.frontMatter);

  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return {
    ok: true,
    spec: { id, name, page, type, header, footer, elements, pagination, dualDialogue, frontMatter },
  };
}

/** Parse + validate one format file's text (user files; JSON errors included). */
export function parseFormatFile(fileName: string, content: string): FormatValidation {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    return { ok: false, errors: [`${fileName}: not valid JSON — ${(e as Error).message}`] };
  }
  const result = validateFormatSpec(raw);
  if (result.ok) return result;
  return { ok: false, errors: result.errors.map((msg) => `${fileName}: ${msg}`) };
}
