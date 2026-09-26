// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Font metrics the layout pipeline shares. The engine, the generated editor
 * CSS, and the PDF renderer must all derive character geometry from the SAME
 * numbers or page breaks would disagree between surfaces.
 *
 * The bundled Courier Prime faces advance 1228/2048 em (just shy of 0.6).
 * That one metric makes wrapping deterministic
 * (a column's capacity is a whole number of characters), which is what lets
 * the DOM (`ch`-unit columns), the engine (greedy wrap), and the PDF agree
 * exactly. Non-monospace formats would need a real shaping pass — out of
 * scope until a format asks for one.
 */
import { type FormatSpec } from "./spec";

/** Exact advance in each bundled Courier Prime face, verified against font bytes. */
export const MONO_ADVANCE_EM = 1228 / 2048;

/** Advance width of one character at the spec's type size, in inches. */
export function charAdvanceIn(spec: FormatSpec, letterSpacing = 0): number {
  return ((MONO_ADVANCE_EM + letterSpacing) * spec.type.size) / 72;
}

/** Convert a horizontal length in inches to character cells (`ch` units). */
export function inchesToCh(spec: FormatSpec, inches: number): number {
  return inches / charAdvanceIn(spec);
}

/** Whole characters that fit in a column of the given width. */
export function charsPerLine(spec: FormatSpec, columnWidthIn: number, letterSpacing = 0): number {
  return Math.max(1, Math.floor(columnWidthIn / charAdvanceIn(spec, letterSpacing) + 1e-9));
}
