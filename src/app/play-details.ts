// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The play's details as a writer types them, and as the script's title page
 * keeps them (docs/app/formatting/formats-and-layout.md#FMT-169): the one
 * reading of a field written where it stands on a page
 * (docs/app/formatting/formats-and-layout.md#FMT-180), so a name typed on any
 * page is the same author.
 *
 * They are details, and not only words on the title page, because other
 * things show them: a header or footer prints the title, the author or the
 * draft date, a file's properties name the title and the author, and an
 * anonymous copy leaves the author and the contact out. The credit and the
 * source print where their fields stand and nowhere else; they are kept as
 * details so that any app that reads a Fountain title page finds them.
 */
import type { FrontMatter } from "../fountain";
import type { FieldName } from "../markdown/page-fields";

/** A detail of the play that a page's field shows. */
export type Detail =
  | "title"
  | "subtitle"
  | "credit"
  | "authors"
  | "contact"
  | "draftDate"
  | "version"
  | "source";
export type Details = Pick<FrontMatter, Detail>;

/** Every detail, in the order a title page prints them. */
export const DETAILS: readonly Detail[] = [
  "title",
  "subtitle",
  "credit",
  "authors",
  "contact",
  "draftDate",
  "version",
  "source",
];

/**
 * The detail each field of a page shows. A field that is not a detail (the
 * contents and the cast, which follow the script) is not here, and is not
 * written by hand.
 */
export const DETAIL_OF: Partial<Record<FieldName, Detail>> = {
  title: "title",
  TITLE: "title",
  subtitle: "subtitle",
  credit: "credit",
  author: "authors",
  contact: "contact",
  draftDate: "draftDate",
  version: "version",
  source: "source",
};

function list(text: string, by: string): string[] {
  return text
    .split(by)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A detail as the writer edits it: authors on one line with commas, contact one line a row. */
export function detailText(fm: FrontMatter, detail: Detail): string {
  switch (detail) {
    case "authors":
      return (fm.authors ?? []).join(", ");
    case "contact":
      return (fm.contact ?? []).join("\n");
    default:
      return fm[detail] ?? "";
  }
}

/** What the writer typed, as the title page keeps it: nothing at all is no key. */
export function detailValue<D extends Detail>(detail: D, text: string): Details[D] {
  if (detail === "authors") {
    const authors = list(text, ",");
    return (authors.length ? authors : undefined) as Details[D];
  }
  if (detail === "contact") {
    const contact = list(text, "\n");
    return (contact.length ? contact : undefined) as Details[D];
  }
  return (text.trim() || undefined) as Details[D];
}

/** Whether the play holds this detail as `text` already. */
export function sameDetail(fm: FrontMatter, detail: Detail, text: string): boolean {
  return JSON.stringify(detailValue(detail, text)) === JSON.stringify(fm[detail]);
}

/**
 * What a writer is told a detail is while the caret is in its field: what
 * else shows it, which is why it is a detail of the play and not only words
 * on this page.
 */
export const DETAIL_HELP: Record<Detail, { help: string }> = {
  title: {
    help: "Also in headers and the file's properties.",
  },
  subtitle: {
    help: "A line under the title. Left empty, it prints nothing.",
  },
  credit: {
    help: "The line between the title and the author.",
  },
  authors: {
    help: "Also in headers. An anonymous copy leaves it out.",
  },
  contact: {
    help: "An anonymous copy leaves it out.",
  },
  draftDate: {
    help: "Printed as you write it.",
  },
  version: {
    help: "Also in a header or footer, from Play Version… in the document menu.",
  },
  source: {
    help: "What the play is based on.",
  },
};
