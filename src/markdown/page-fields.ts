// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The fields of a page before the script, as the prose editor shows them.
 *
 * A page file (src/layout/page-files.ts) writes the play's details as tokens,
 * `{title}`, `{TITLE}`, `{credit}`, `{author}`, `{contact}`, `{draftDate}` and
 * `{source}`, which the layout fills in from the script's title page, and a
 * title page's foot after a line that is `<!-- proscenium:foot -->`. The editor
 * draws a token the way a word processor draws a field: its value where the
 * token stands, one object the caret goes around, and its name, quieter, while
 * it has no value.
 *
 * The names and the mark are the layout's own. They are written again here
 * because the layout reads Markdown through this folder, so this folder cannot
 * read the layout back; page-fields.test.ts holds the two to each other.
 */

/** The fields a page can show, by the word it writes between braces. */
export const FIELD_NAMES = [
  "TITLE",
  "title",
  "credit",
  "author",
  "contact",
  "draftDate",
  "source",
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** What each field shows, as the layout fills it in. A field missing here has no value. */
export type FieldValues = Partial<Record<FieldName, string>>;

/** The line in a title page's file after which its foot begins. */
export const FOOT_MARK = "<!-- proscenium:foot -->";

/** Every field token in a run of text, its name in group 1. Global: read it with `matchAll`. */
export const FIELD_TOKEN = new RegExp(`\\{(${FIELD_NAMES.join("|")})\\}`, "g");

export function isFieldName(name: unknown): name is FieldName {
  return typeof name === "string" && (FIELD_NAMES as readonly string[]).includes(name);
}

/** A field as its file writes it. */
export function fieldToken(name: FieldName): string {
  return `{${name}}`;
}

/** Each field's name, as the Insert Field menu and a screen reader say it. */
export const FIELD_LABEL: Record<FieldName, string> = {
  title: "Title",
  TITLE: "Title in Capitals",
  credit: "Credit",
  author: "Author",
  contact: "Contact",
  draftDate: "Draft Date",
  source: "Source",
};

/**
 * What a field with no value says in the editor: what goes there, as a prompt
 * to fill it in, never as the page's words
 * (docs/app/formatting/formats-and-layout.md#FMT-176).
 */
export const FIELD_PROMPT: Record<FieldName, string> = {
  title: "Title",
  TITLE: "TITLE",
  credit: "Credit",
  author: "Author's name",
  contact: "Contact details",
  draftDate: "Draft date",
  source: "Source",
};

/** The order the Insert Field menu offers them in: the title, then down the page. */
export const FIELD_MENU: readonly FieldName[] = [
  "title",
  "TITLE",
  "credit",
  "author",
  "contact",
  "draftDate",
  "source",
];

/** The value a field shows. `{TITLE}` is the title in capitals, whichever of the two is given. */
export function fieldShows(name: FieldName, values: FieldValues): string {
  if (name === "TITLE") return (values.TITLE ?? values.title ?? "").toUpperCase();
  return values[name] ?? "";
}

/** How a field is drawn, and what a screen reader is told it is. */
export interface FieldFace {
  /** Drawn one under another, as the contact block prints; a blank line is a blank row. */
  lines: string[];
  /** It has no value, so the lines are its prompt, drawn quieter. */
  empty: boolean;
  /** Its accessible name: what the field is, and what it shows. */
  label: string;
}

export function fieldFace(name: FieldName, values: FieldValues): FieldFace {
  const value = fieldShows(name, values);
  // A value of spaces prints nothing a reader sees, so it shows the name too.
  if (!value.trim())
    return {
      lines: [FIELD_PROMPT[name]],
      empty: true,
      label: `${FIELD_LABEL[name]}: empty`,
    };
  const lines = value.split("\n");
  const said = lines.map((line) => line.trim()).filter(Boolean);
  return { lines, empty: false, label: `${FIELD_LABEL[name]}: ${said.join(", ")}` };
}
