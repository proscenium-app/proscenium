// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An anonymous copy, for a contest or festival that reads a play without its
 * writer's name (docs/app/formatting/formats-and-layout.md#FMT-143).
 *
 * It belongs to the export, not to the play: the writer's own pages keep
 * their name, and the next copy — for an agent, a director — carries it again
 * without anything to switch back. So nothing here is saved; the export
 * lays out the same play with the identifying title-page fields left out.
 *
 * What the writer typed into the play itself can name them too — a dedication,
 * an opening note, a header a custom format prints — and a copy cannot know
 * which words to cut there. So the dialog looks for the name and contact
 * details on every sheet that is going and says where it found them
 * (docs/app/formatting/formats-and-layout.md#FMT-144).
 */
import type { FrontMatter } from "../fountain";
import type { LayoutMeta } from "../layout";
import type { PlannedSheet } from "./plan";

/**
 * The title page without the writer: no byline, no authors, no contact block.
 * A title page written as prose can't be taken apart safely, so an anonymous
 * copy prints the title alone in its place.
 */
export function anonymousFrontMatter(
  fm: FrontMatter | null | undefined,
  fallbackTitle: string,
): FrontMatter | null {
  if (!fm) return null;
  const {
    authors: _authors,
    credit: _credit,
    contact: _contact,
    titlePage,
    _extra: _unprinted,
    ...rest
  } = fm;
  const title = fm.title?.trim() ? fm.title : titlePage !== undefined ? fallbackTitle : fm.title;
  return { ...rest, ...(title ? { title } : {}) };
}

/** Layout and file metadata for an anonymous copy: no `{author}`, no Author property. */
export function anonymousMeta(meta: LayoutMeta, fallbackTitle: string): LayoutMeta {
  return {
    ...meta,
    author: "",
    frontMatter: anonymousFrontMatter(meta.frontMatter, meta.title || fallbackTitle),
  };
}

const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** What would identify the writer: each author's name, and each contact line. */
export function identityOf(fm: FrontMatter | null | undefined): string[] {
  const found = [...(fm?.authors ?? []), ...(fm?.contact ?? [])]
    .map(normalize)
    .filter((text) => text.length >= 3);
  return [...new Set(found)];
}

function sheetText(sheet: PlannedSheet): string {
  if (sheet.kind === "front") return sheet.front.lines.map((line) => line.text).join(" ");
  const { header, footer, intro, lines } = sheet.page;
  return [
    header?.left,
    header?.center,
    header?.right,
    footer?.left,
    footer?.center,
    footer?.right,
    ...(intro ?? []).map((line) => line.text),
    ...lines.map((line) => line.text),
  ]
    .filter(Boolean)
    .join(" ");
}

/** The sheets, by label, whose printed text still holds the name or a contact line. */
export function sheetsNaming(
  sheets: readonly PlannedSheet[],
  identity: readonly string[],
): string[] {
  if (!identity.length) return [];
  return sheets
    .filter((sheet) => {
      // Lines are joined with a space, so a name wrapped across two lines is still found.
      const text = normalize(sheetText(sheet));
      return identity.some((needle) => text.includes(needle));
    })
    .map((sheet) => sheet.label);
}

/** "page 12", "page 12 and the characters page", "page 3, page 12, page 40 and 2 more". */
export function sheetList(labels: readonly string[]): string {
  const named = labels.map((label) =>
    label.startsWith("Page ") ? label.toLowerCase() : `the ${label.toLowerCase()}`,
  );
  if (named.length <= 3)
    return named.length < 2
      ? (named[0] ?? "")
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `${named.slice(0, 3).join(", ")} and ${named.length - 3} more`;
}
