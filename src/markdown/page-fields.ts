// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The fields of a page before the script, as the prose editor shows them.
 *
 * A page file (src/layout/page-files.ts) writes the play's details as tokens,
 * `{title}`, `{TITLE}`, `{credit}`, `{author}`, `{contact}`, `{draftDate}`, `{version}` and
 * `{source}`, which the layout fills in from the script's title page, its
 * acts and scenes as `{contents}`, which the layout fills in from the script, and a
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
  "subtitle",
  "credit",
  "author",
  "contact",
  "draftDate",
  "version",
  "source",
  "contents",
  "cast",
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/**
 * What each field shows, as the layout fills it in. A field missing here has
 * no value. One whose settings change what it shows has a value for each way
 * it can be set, under its name and those settings (`fieldKey`).
 */
export type FieldValues = Partial<Record<string, string>>;

/** The line in a title page's file after which its foot begins. */
export const FOOT_MARK = "<!-- proscenium:foot -->";

/**
 * The line in a page's file under its head: what stands above it is set from
 * the top of the sheet, whatever the page's layout
 * (docs/app/formatting/formats-and-layout.md#FMT-182).
 */
export const HEAD_MARK = "<!-- proscenium:head -->";

/**
 * Where the writer put a block of a page, when that is not where the layout
 * would (docs/app/formatting/formats-and-layout.md#FMT-182): `rows`, the blank
 * rows above it, in place of the format's gap; `cell`, the cell of the text
 * block its lines start at, in place of its alignment; `beside`, that it
 * starts on the first row of the block before it, `rows` under that row.
 */
export interface Place {
  rows?: number;
  cell?: number;
  beside?: true;
}

const PLACE = /^<!-- proscenium:place((?: (?:rows=\d{1,3}|cell=\d{1,3}|beside))+) -->$/;

/** A place as the line a page's file writes above its block; nothing for a block left where the layout puts it. */
export function placeMark(place: Place | undefined): string {
  const keys = [
    place?.beside ? "beside" : "",
    place?.rows !== undefined ? `rows=${place.rows}` : "",
    place?.cell !== undefined ? `cell=${place.cell}` : "",
  ].filter(Boolean);
  return keys.length ? `<!-- proscenium:place ${keys.join(" ")} -->` : "";
}

/** The place a line of a page's file says, or null for any other line. */
export function readPlaceMark(line: string): Place | null {
  const keys = PLACE.exec(line)?.[1];
  if (!keys) return null;
  const place: Place = {};
  for (const key of keys.trim().split(" ")) {
    if (key === "beside") place.beside = true;
    else if (key.startsWith("rows=")) place.rows = Number(key.slice(5));
    else if (key.startsWith("cell=")) place.cell = Number(key.slice(5));
  }
  return place;
}

/** A line with no words, as a page's file keeps it: a blank row of the page, set as its words would be. */
export function emptyLineMark(align: "left" | "center" | "right"): string {
  return align === "left" ? "<!-- proscenium:line -->" : `<!-- proscenium:line=${align} -->`;
}

/** How the empty line a line of a page's file is was set, or null for any other line. */
export function readEmptyLineMark(line: string): "left" | "center" | "right" | null {
  const m = /^<!-- proscenium:line(?:=(center|right))? -->$/.exec(line);
  return m ? ((m[1] as "center" | "right" | undefined) ?? "left") : null;
}

/**
 * A field's settings, as its token writes them after its name:
 * `{contents acts=plain}` (docs/app/formatting/formats-and-layout.md#FMT-184).
 * A field is a component of a page: something the app fills in, which a page
 * can hold anywhere, set as that page wants it. Each setting is a word, an
 * equals sign and a word; a token with none is the component as it comes.
 * One the app does not know is kept as it is written.
 */
export const FIELD_OPTIONS = "((?: [a-zA-Z][a-zA-Z0-9]*=[a-zA-Z0-9-]+)*)";

/**
 * Every field token in a run of text, its name in group 1 and its settings,
 * as written, in group 2. Global: read it with `matchAll`.
 */
export const FIELD_TOKEN = new RegExp(`\\{(${FIELD_NAMES.join("|")})${FIELD_OPTIONS}\\}`, "g");

/** A field's settings read from how they are written: ` acts=plain` is `{ acts: "plain" }`. */
export function readFieldOptions(written: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (written ?? "").trim().split(" ")) {
    const at = pair.indexOf("=");
    if (at > 0) out[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return out;
}

/** A field's settings as they are written, in one order whatever order they were given in. */
export function writeFieldOptions(options: Readonly<Record<string, string>>): string {
  return Object.keys(options)
    .sort()
    .map((key) => `${key}=${options[key]}`)
    .join(" ");
}

/** The name a field's value is kept under: its own, and its settings when it has any. */
export function fieldKey(name: FieldName, options?: string | null): string {
  const written = writeFieldOptions(readFieldOptions(options));
  return written ? `${name} ${written}` : name;
}

export function isFieldName(name: unknown): name is FieldName {
  return typeof name === "string" && (FIELD_NAMES as readonly string[]).includes(name);
}

/** A field as its file writes it, its settings after its name. */
export function fieldToken(name: FieldName, options?: string | null): string {
  return `{${fieldKey(name, options)}}`;
}

/** Each field's name, as the Insert Field menu and a screen reader say it. */
export const FIELD_LABEL: Record<FieldName, string> = {
  title: "Title",
  TITLE: "Title in Capitals",
  subtitle: "Subtitle",
  credit: "Credit",
  author: "Author",
  contact: "Contact",
  draftDate: "Draft Date",
  version: "Version",
  source: "Source",
  contents: "Contents",
  cast: "Cast",
};

/**
 * What a field with no value says in the editor: what goes there, as a prompt
 * to fill it in, never as the page's words
 * (docs/app/formatting/formats-and-layout.md#FMT-180).
 */
export const FIELD_PROMPT: Record<FieldName, string> = {
  title: "Title",
  TITLE: "TITLE",
  subtitle: "Subtitle",
  credit: "Credit",
  author: "Author's name",
  contact: "Contact details",
  draftDate: "Draft date",
  version: "Version",
  source: "Source",
  contents: "The acts and scenes, once the script has them",
  cast: "Everyone who speaks, once someone does",
};

/** The order the Insert Field menu offers them in: the title, then down the page. */
export const FIELD_MENU: readonly FieldName[] = [
  "title",
  "TITLE",
  "subtitle",
  "credit",
  "author",
  "contact",
  "draftDate",
  "version",
  "source",
  "contents",
  "cast",
];

/**
 * The value a field shows. `{TITLE}` is the title in capitals, whichever of the
 * two is given. A field with settings shows the value kept for them, and the
 * field's own where none is.
 */
export function fieldShows(name: FieldName, values: FieldValues, options?: string | null): string {
  if (name === "TITLE") return (values.TITLE ?? values.title ?? "").toUpperCase();
  return values[fieldKey(name, options)] ?? values[name] ?? "";
}

/**
 * The words a field holds while it is written in: its value as the play keeps
 * it. `{TITLE}` is the title as typed, which the page sets in capitals, so a
 * title written there is not kept in capitals everywhere else that shows it.
 */
export function fieldEdits(name: FieldName, values: FieldValues): string {
  if (name === "TITLE") return values.title ?? values.TITLE ?? "";
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

export function fieldFace(
  name: FieldName,
  values: FieldValues,
  options?: string | null,
): FieldFace {
  const value = fieldShows(name, values, options);
  // A value of spaces prints nothing a reader sees, so it shows the name too.
  if (!value.trim())
    return {
      lines: [FIELD_PROMPT[name]],
      empty: true,
      label: `${FIELD_LABEL[name]}: empty`,
    };
  const lines = value.split("\n");
  // A row of the contents is said as its name and its page, never its leader dots.
  const said = lines
    .map((line) =>
      name === "contents" ? line.replace(/[ .]*\. +(\S+)$/, ", page $1").trim() : line.trim(),
    )
    .filter(Boolean);
  return { lines, empty: false, label: `${FIELD_LABEL[name]}: ${said.join(", ")}` };
}
