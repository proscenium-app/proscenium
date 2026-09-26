// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FormatSpec → format file: what the format designer saves and exports.
 *
 * The inverse of `validateFormatSpec`, and held to it: for every spec,
 * `validateFormatSpec(formatFileObject(spec))` resolves to the same spec
 * (serialize.test.ts runs every built-in through it).
 *
 * - **Compact.** An element field at its default is left out, as the built-ins
 *   leave it out, so a file a theatre receives, or a writer contributes to
 *   `formats/`, says what the format decides rather than restating the schema.
 *   Every printed element keeps its key even when it changes nothing, because
 *   validation requires one; a non-printing element that matches its preset is
 *   left out entirely.
 * - **Stable.** Keys come out in the schema's order (docs/app/formatting/formats-and-layout.md#SCHEMA-D100), so two
 *   saves of the same format are the same bytes and a diff shows only changes.
 */
import {
  FORMAT_ELEMENT_KEYS,
  OPTIONAL_FORMAT_ELEMENT_PRESETS,
  REQUIRED_FORMAT_ELEMENTS,
  type ElementFormat,
  type FormatSpec,
  type HeaderFooterSpec,
} from "./spec";
import { DEFAULT_ELEMENT } from "./validate";

const ELEMENT_FIELD_ORDER = Object.keys(DEFAULT_ELEMENT) as (keyof ElementFormat)[];

function headerFooter(hf: HeaderFooterSpec): Record<string, unknown> {
  const content: Record<string, string> = {};
  for (const slot of ["left", "center", "right"] as const) {
    if (hf.content[slot] !== undefined && hf.content[slot] !== "")
      content[slot] = hf.content[slot]!;
  }
  return { content, position: hf.position, suppressOnFirstPage: hf.suppressOnFirstPage };
}

/** The fields of `el` that differ from `base`, in schema order. */
function elementDelta(el: ElementFormat, base: ElementFormat): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ELEMENT_FIELD_ORDER) {
    if (el[key] !== base[key]) out[key] = el[key];
  }
  return out;
}

/** The format as the plain object a format file holds. */
export function formatFileObject(spec: FormatSpec): Record<string, unknown> {
  const elements: Record<string, unknown> = {};
  const required = new Set<string>(REQUIRED_FORMAT_ELEMENTS);
  for (const key of FORMAT_ELEMENT_KEYS) {
    const preset = (
      OPTIONAL_FORMAT_ELEMENT_PRESETS as Partial<Record<string, Partial<ElementFormat>>>
    )[key];
    const delta = elementDelta(spec.elements[key], { ...DEFAULT_ELEMENT, ...preset });
    if (required.has(key) || Object.keys(delta).length > 0) elements[key] = delta;
  }
  const m = spec.page.margins;
  return {
    id: spec.id,
    name: spec.name,
    page: {
      size: spec.page.size,
      margins: { left: m.left, top: m.top, right: m.right, bottom: m.bottom },
    },
    type: { family: spec.type.family, size: spec.type.size, lineHeight: spec.type.lineHeight },
    header: headerFooter(spec.header),
    footer: headerFooter(spec.footer),
    elements,
    pagination: {
      continuedMarker: spec.pagination.continuedMarker,
      repeatCharacterOnSplit: spec.pagination.repeatCharacterOnSplit,
      minDialogueLinesBeforeBreak: spec.pagination.minDialogueLinesBeforeBreak,
      minDialogueLinesAfterBreak: spec.pagination.minDialogueLinesAfterBreak,
      minActionLinesEitherSide: spec.pagination.minActionLinesEitherSide,
    },
    dualDialogue: { gutterIn: spec.dualDialogue.gutterIn },
    frontMatter: { ...spec.frontMatter },
  };
}

/** The format file's text: two-space JSON and a final newline, like the built-ins. */
export function formatFileText(spec: FormatSpec): string {
  return `${JSON.stringify(formatFileObject(spec), null, 2)}\n`;
}

/**
 * A format id from its name: lowercase ASCII letters, digits and hyphens, as
 * validation requires ("Dramatists Guild — Modern" → "dramatists-guild-modern").
 * Accents are folded rather than dropped ("Théâtre" → "theatre"). Empty when
 * the name has nothing an id can be made of, which the designer reports.
 */
export function formatIdFromName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}
