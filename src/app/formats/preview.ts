// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the designer's preview says about the engine's pages, beyond drawing
 * them: which lines a change moved, and each page in words.
 *
 * Both are read off `LayoutResult` — the pages the engine laid out — and never
 * off the DOM, so the flag on a moved line and the sentence a screen reader
 * hears describe the same page the PDF would print.
 */
import type { BlockType } from "../../fountain/model";
import { linePitchIn, type FormatSpec } from "../../format";
import type { LayoutLine, LayoutPage, LayoutResult } from "../../layout";
import { ELEMENT_LABELS } from "./draft";

/**
 * A line's identity across two layouts of the same script: the block it came
 * from and where in that block it starts. A re-printed cue has no block, so it
 * is known by its page. A line whose wrap changed has a new identity — which is
 * right, because it is a new line.
 */
export function lineKey(line: LayoutLine, pageNumber: number): string {
  return line.kind === "contd" ? `contd@${pageNumber}` : `${line.sourceIndex}:${line.start}`;
}

interface Placement {
  page: number;
  /** Inches from the paper's top-left corner, so a margin change moves a line too. */
  x: number;
  y: number;
}

function placements(layout: LayoutResult, spec: FormatSpec): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const pitch = linePitchIn(spec);
  const { left, top } = spec.page.margins;
  for (const page of layout.pages) {
    for (const line of page.lines) {
      out.set(lineKey(line, page.pageNumber), {
        page: page.pageNumber,
        x: left + line.xIn,
        y: top + line.row * pitch,
      });
    }
  }
  return out;
}

export interface Moves {
  /** Keys (`lineKey`) of the lines that are somewhere new on paper. */
  lines: Set<string>;
  /** The elements those lines belong to, in the order the script meets them. */
  elements: BlockType[];
}

/** The lines `after` placed differently from `before` — nothing when there is no before. */
export function movedLines(
  before: { layout: LayoutResult; spec: FormatSpec } | null,
  after: { layout: LayoutResult; spec: FormatSpec },
): Moves {
  const lines = new Set<string>();
  const elements: BlockType[] = [];
  if (!before) return { lines, elements };
  const was = placements(before.layout, before.spec);
  const now = placements(after.layout, after.spec);
  for (const page of after.layout.pages) {
    for (const line of page.lines) {
      const key = lineKey(line, page.pageNumber);
      const a = was.get(key);
      const b = now.get(key)!;
      const moved = !a || a.page !== b.page || Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6;
      if (!moved) continue;
      lines.add(key);
      if (!elements.includes(line.type)) elements.push(line.type);
    }
  }
  return { lines, elements };
}

function label(type: BlockType): string {
  return (ELEMENT_LABELS as Partial<Record<BlockType, string>>)[type] ?? type;
}

function inches(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} ${rounded === 1 ? "inch" : "inches"}`;
}

function slotsInWords(slots: NonNullable<LayoutPage["header"]>): string {
  return (["left", "center", "right"] as const)
    .filter((slot) => slots[slot])
    .map((slot) => `${slot}: ${slots[slot]}`)
    .join(", ");
}

/**
 * One page in words — its text alternative. Where each element sits is what a
 * format decides, so that is what it says: "Page 2 of 4. Header right: 2.
 * Character at 4 inches from the left edge. Dialogue at 1.5 inches…"
 */
export function describePage(page: LayoutPage, total: number, spec: FormatSpec): string {
  const parts = [`Page ${page.pageNumber} of ${total}`];
  if (page.intro?.length) parts.push("Opening title and script details");
  if (page.header) parts.push(`Header ${slotsInWords(page.header)}`);
  const first = new Map<BlockType, LayoutLine>();
  for (const line of page.lines) if (line.text && !first.has(line.type)) first.set(line.type, line);
  for (const [type, line] of first) {
    const el = spec.elements[type];
    if (el.align === "center") parts.push(`${label(type)} centered`);
    else if (el.align === "right") parts.push(`${label(type)} right-aligned`);
    else parts.push(`${label(type)} at ${inches(spec.page.margins.left + line.xIn)} from the left edge`);
  }
  if (page.breakBefore?.contd) parts.push(`Continues ${page.breakBefore.contd}`);
  if (page.footer) parts.push(`Footer ${slotsInWords(page.footer)}`);
  return `${parts.join(". ")}.`;
}

/** What a change did, for the announcer: "Character and Dialogue moved. 5 pages." */
export function describeMoves(moves: Moves, pageCount: number, pagesBefore: number | null): string {
  const pages =
    pagesBefore !== null && pagesBefore !== pageCount
      ? `${pageCount} pages, was ${pagesBefore}.`
      : `${pageCount} ${pageCount === 1 ? "page" : "pages"}.`;
  if (moves.lines.size === 0) return `Nothing moved. ${pages}`;
  const names = moves.elements.map(label);
  const what =
    names.length > 4
      ? "Most of the page moved."
      : `${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`} moved.`;
  return `${what} ${pages}`;
}
