// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The play's details as a writer types them, and as the script's title page
 * keeps them (docs/app/formatting/formats-and-layout.md#FMT-169): one reading
 * for Play Details… and for a field edited where it stands on a page
 * (docs/app/formatting/formats-and-layout.md#FMT-176), so a name typed in
 * either place is the same author.
 */
import type { FrontMatter } from "../fountain";
import type { FieldName } from "../markdown/page-fields";

/** A detail of the play that a page's field shows. */
export type Detail = "title" | "credit" | "authors" | "contact" | "draftDate" | "source";
export type Details = Pick<FrontMatter, Detail>;

/** Every detail, in the order Play Details… lists them. */
export const DETAILS: readonly Detail[] = [
  "title",
  "credit",
  "authors",
  "contact",
  "draftDate",
  "source",
];

/** The detail each field of a page shows. */
export const DETAIL_OF: Record<FieldName, Detail> = {
  title: "title",
  TITLE: "title",
  credit: "credit",
  author: "authors",
  contact: "contact",
  draftDate: "draftDate",
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

/** What a writer is told each detail is, where one is edited by itself. */
export const DETAIL_HELP: Record<Detail, { label: string; placeholder?: string; help: string }> = {
  title: {
    label: "Title",
    help: "The play's title, on every page, header and file that shows it.",
  },
  credit: {
    label: "Credit",
    placeholder: "a play by",
    help: "The line between the title and the author.",
  },
  authors: {
    label: "Author",
    placeholder: "Your name",
    help: "Separate co-writers with commas. Headers and the file's properties show it too, and an anonymous copy leaves it out.",
  },
  contact: {
    label: "Contact",
    placeholder: "One line a row: an address, an agent, an email",
    help: "An anonymous copy leaves it out.",
  },
  draftDate: {
    label: "Draft date",
    help: "As you want it printed.",
  },
  source: {
    label: "Source",
    placeholder: "based on…",
    help: "What the play is based on, if anything.",
  },
};
