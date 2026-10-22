// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fountain title page ⇄ structured front matter.
 *
 * We own this rather than delegating to fountain-js: its title-page detector
 * only recognizes the standard keys, and our house format adds custom keys
 * (`Setting`, `Time`, `Place`, `Characters`). Unknown keys are preserved
 * verbatim in `_extra` (storage "preserve-unknown-keys"). Doing it here also
 * keeps title-page serialization deterministic, which the round-trip needs.
 * The serializer writes each key once; a title page made elsewhere may name
 * one twice, and is read as all it was given
 * (docs/engineering/fountain-model.md#EDIT-190). What the serializer writes is
 * a title page to the reader: a key with nothing after it keeps its line, and
 * a page of keys the reader does not know is written under one it does
 * (docs/engineering/fountain-model.md#EDIT-192).
 */
import type { CharacterEntry, FrontMatter } from "./model";

const KEY_RE = /^([A-Za-z][A-Za-z0-9 ]*?):[ \t]*(.*)$/;
const INDENT_RE = /^( {3,}|\t)/;

const RECOGNIZED = new Set([
  // standard Fountain title keys
  "title",
  "credit",
  "author",
  "authors",
  "source",
  "notes",
  "draft date",
  "date",
  "contact",
  "copyright",
  "revision",
  "revisions",
  // house custom keys
  "setting",
  "time",
  "place",
  "characters",
  "title page text",
  "characters page text",
  "opening notes",
  "opening notes first",
]);

interface Entry {
  key: string; // normalized: lowercased, single-spaced
  display: string; // original key text
  values: string[]; // dedented value lines
}

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseEntries(lines: string[]): Entry[] {
  const entries: Entry[] = [];
  let current: Entry | null = null;
  for (const line of lines) {
    const indented = INDENT_RE.test(line);
    const m = indented ? null : line.match(KEY_RE);
    if (m) {
      current = { key: normalizeKey(m[1]), display: m[1].trim(), values: [] };
      const inline = m[2].trim();
      if (inline) current.values.push(inline);
      entries.push(current);
    } else if (current) {
      const v = line.replace(INDENT_RE, "").trim();
      if (v) current.values.push(v);
    }
  }
  return entries;
}

function parseCharacterLine(line: string): CharacterEntry {
  const m = line.split(/\s+[—–-]\s+/);
  if (m.length >= 2) {
    return { name: m[0].trim(), description: m.slice(1).join(" — ").trim() };
  }
  return { name: line.trim() };
}

/**
 * The value of a house key that is one whole and not lines: a page's text,
 * written as one JSON string so its blank lines and indentation stand within
 * Fountain's title page, or the flag for which opening page comes first.
 * Undefined where the entry's lines are no such value.
 */
function wholeValue(e: Entry): string | boolean | undefined {
  const joined = e.values.join("\n");
  if (e.key === "opening notes first") {
    return joined === "true" || joined === "false" ? joined === "true" : undefined;
  }
  try {
    const value: unknown = JSON.parse(joined);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A text field with one more entry's lines under the lines it holds. */
function linesUnder(held: string | undefined, e: Entry): string {
  return [...(held ? [held] : []), ...e.values].join("\n");
}

/**
 * Entries → front matter. A key named twice is read as all it was given, never
 * as its last entry alone (docs/engineering/fountain-model.md#EDIT-190): a
 * list holds the values of every entry, a text field and an unknown key the
 * lines of every entry, in the order they stand. A whole value cannot hold
 * two, so its field is the last entry that reads as one, and every other
 * entry of that key is kept with the unknown keys.
 */
function mapEntries(entries: Entry[]): FrontMatter {
  const fm: FrontMatter = {};
  // Unknown keys by the key as written, each with the lines of every entry of that name.
  const extra = new Map<string, string[]>();
  const keep = (e: Entry) => extra.set(e.display, [...(extra.get(e.display) ?? []), ...e.values]);
  // For each whole-valued key, the last of its entries that reads as its value.
  const field = new Map<string, Entry>();
  for (const e of entries) {
    switch (e.key) {
      case "title page text":
      case "characters page text":
      case "opening notes":
      case "opening notes first":
        if (wholeValue(e) !== undefined) field.set(e.key, e);
    }
  }
  for (const e of entries) {
    switch (e.key) {
      case "title":
        fm.title = linesUnder(fm.title, e);
        break;
      case "credit":
        fm.credit = linesUnder(fm.credit, e);
        break;
      case "author":
      case "authors":
        fm.authors = [...(fm.authors ?? []), ...e.values];
        break;
      case "source":
        fm.source = linesUnder(fm.source, e);
        break;
      case "draft date":
      case "date":
        fm.draftDate = linesUnder(fm.draftDate, e);
        break;
      case "contact":
        fm.contact = [...(fm.contact ?? []), ...e.values];
        break;
      case "setting":
        fm.setting = linesUnder(fm.setting, e);
        break;
      case "time":
        fm.time = linesUnder(fm.time, e);
        break;
      case "place":
        fm.place = linesUnder(fm.place, e);
        break;
      case "characters":
        fm.characters = [...(fm.characters ?? []), ...e.values.map(parseCharacterLine)];
        break;
      case "title page text":
      case "characters page text":
      case "opening notes":
      case "opening notes first": {
        const value = field.get(e.key) === e ? wholeValue(e) : undefined;
        if (typeof value === "boolean") fm.openingNotesBeforeCharacters = value;
        else if (value === undefined) keep(e);
        else if (e.key === "title page text") fm.titlePage = value;
        else if (e.key === "characters page text") fm.charactersPage = value;
        else fm.openingNotes = value;
        break;
      }
      default:
        // standard-but-unmodeled (notes/copyright/revision) and unknown keys
        keep(e);
    }
  }
  if (extra.size) {
    fm._extra = Object.fromEntries([...extra].map(([key, lines]) => [key, lines.join("\n")]));
  }
  return fm;
}

/** The title page these lines open with: its entries, and the blank line that ends it. */
function leadingTitlePage(lines: string[]): { entries: Entry[]; end: number } | null {
  if (!lines.length || INDENT_RE.test(lines[0]) || !KEY_RE.test(lines[0])) return null;

  // The title page is terminated by the first blank line.
  let end = 0;
  while (end < lines.length && lines[end].trim() !== "") end += 1;
  const entries = parseEntries(lines.slice(0, end));

  // Guard against a stray "Foo: bar" first line that isn't really a title page.
  return entries.some((e) => RECOGNIZED.has(e.key)) ? { entries, end } : null;
}

/**
 * Split a (LF-normalized) source into front matter and the remaining body.
 * If there is no title page, `frontMatter` is empty and `body` is the source.
 */
export function splitTitlePage(source: string): {
  frontMatter: FrontMatter;
  body: string;
} {
  const lines = source.split("\n");
  const found = leadingTitlePage(lines);
  if (!found) return { frontMatter: {}, body: source };

  const frontMatter = mapEntries(found.entries);
  const body = lines
    .slice(found.end + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { frontMatter, body };
}

/**
 * Would `splitTitlePage` take a title page off the top of this text? The
 * serializer asks it of a script it is about to write where a title page
 * would stand (docs/engineering/fountain-model.md#EDIT-184).
 */
export function opensWithTitlePage(source: string): boolean {
  return leadingTitlePage(source.split("\n")) !== null;
}

/**
 * A key and its values: one on the key's line, several under it. A list of
 * none is the key alone, which is the line it was read from
 * (docs/engineering/fountain-model.md#EDIT-192).
 */
function field(key: string, values: string[], indented: boolean): string {
  if (!values.length) return `${key}:`;
  if (!indented && values.length === 1) return `${key}: ${values[0]}`;
  return `${key}:\n` + values.map((v) => "    " + v).join("\n");
}

/** The front matter as the lines of a title page, each field once. */
function titlePageLines(fm: FrontMatter): string {
  const out: string[] = [];

  if (fm.title != null) out.push(field("Title", splitLines(fm.title), false));
  if (fm.credit != null) out.push(field("Credit", splitLines(fm.credit), false));
  if (fm.authors) {
    out.push(
      fm.authors.length > 1
        ? field("Authors", fm.authors, true)
        : field("Author", fm.authors, false),
    );
  }
  if (fm.source != null) out.push(field("Source", splitLines(fm.source), false));
  if (fm.draftDate != null) {
    out.push(field("Draft date", splitLines(fm.draftDate), false));
  }
  if (fm.contact) out.push(field("Contact", fm.contact, true));
  if (fm.setting != null) {
    out.push(field("Setting", splitLines(fm.setting), false));
  }
  if (fm.time != null) out.push(field("Time", splitLines(fm.time), false));
  if (fm.place != null) out.push(field("Place", splitLines(fm.place), false));
  if (fm.characters) {
    const lines = fm.characters.map((c) =>
      c.description ? `${c.name} — ${c.description}` : c.name,
    );
    out.push(field("Characters", lines, true));
  }
  if (fm._extra) {
    for (const [key, value] of Object.entries(fm._extra)) {
      out.push(field(key, splitLines(value), splitLines(value).length > 1));
    }
  }
  if (fm.titlePage !== undefined)
    out.push(field("Title Page Text", [JSON.stringify(fm.titlePage)], false));
  if (fm.charactersPage !== undefined)
    out.push(field("Characters Page Text", [JSON.stringify(fm.charactersPage)], false));
  if (fm.openingNotes !== undefined)
    out.push(field("Opening Notes", [JSON.stringify(fm.openingNotes)], false));
  if (fm.openingNotesBeforeCharacters !== undefined)
    out.push(field("Opening Notes First", [String(fm.openingNotesBeforeCharacters)], false));

  return out.join("\n");
}

/**
 * Serialize front matter to a canonical Fountain title page (no trailing blank line).
 *
 * The reader takes a file's first block for a title page only when it holds a
 * key it knows, so that a first line of the script like `Foo: bar` stays the
 * script's (docs/engineering/fountain-model.md#EDIT-184). A front matter of
 * unknown keys alone, `Format: stage`, was written as that line, which is the
 * same bytes as a stage direction: on the reopen it was one, at the top of the
 * script. The reading cannot tell the two apart, so the writing differs
 * (docs/engineering/fountain-model.md#EDIT-192). The reader is asked, as it is
 * for the script's first line, and a page it would not take is written with
 * `Author:` and nothing after it on its first line: one of Fountain's standard
 * keys, read back as a list of no authors, which puts nothing on a page.
 *
 * Only a front matter the app has changed gets there. One that was read from
 * a script holds a key the reader knew, and each is written back: a list of
 * none as its key alone (`field`), where its line used to be left out.
 */
export function serializeTitlePage(fm: FrontMatter): string {
  const page = titlePageLines(fm);
  if (!page || opensWithTitlePage(page)) return page;
  return titlePageLines({ ...fm, authors: [] });
}

function splitLines(value: string): string[] {
  return value.split("\n");
}

export function hasFrontMatter(fm: FrontMatter): boolean {
  return serializeTitlePage(fm).length > 0;
}
