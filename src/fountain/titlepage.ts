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

function mapEntries(entries: Entry[]): FrontMatter {
  const fm: FrontMatter = {};
  const extra: Record<string, string> = {};
  for (const e of entries) {
    const joined = e.values.join("\n");
    switch (e.key) {
      case "title":
        fm.title = joined;
        break;
      case "credit":
        fm.credit = joined;
        break;
      case "author":
      case "authors":
        fm.authors = e.values.slice();
        break;
      case "source":
        fm.source = joined;
        break;
      case "draft date":
      case "date":
        fm.draftDate = joined;
        break;
      case "contact":
        fm.contact = e.values.slice();
        break;
      case "setting":
        fm.setting = joined;
        break;
      case "time":
        fm.time = joined;
        break;
      case "place":
        fm.place = joined;
        break;
      case "characters":
        fm.characters = e.values.map(parseCharacterLine);
        break;
      case "title page text":
      case "characters page text":
      case "opening notes": {
        // One JSON string preserves blank lines and indentation within Fountain's title page.
        try {
          const value: unknown = JSON.parse(joined);
          if (typeof value !== "string") throw new Error("Not page text");
          if (e.key === "title page text") fm.titlePage = value;
          else if (e.key === "characters page text") fm.charactersPage = value;
          else fm.openingNotes = value;
        } catch {
          extra[e.display] = joined;
        }
        break;
      }
      case "opening notes first":
        if (joined === "true" || joined === "false")
          fm.openingNotesBeforeCharacters = joined === "true";
        else extra[e.display] = joined;
        break;
      default:
        // standard-but-unmodeled (notes/copyright/revision) and unknown keys
        extra[e.display] = joined;
    }
  }
  if (Object.keys(extra).length) fm._extra = extra;
  return fm;
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
  if (!lines.length || INDENT_RE.test(lines[0]) || !KEY_RE.test(lines[0])) {
    return { frontMatter: {}, body: source };
  }

  // The title page is terminated by the first blank line.
  let end = 0;
  while (end < lines.length && lines[end].trim() !== "") end += 1;
  const entries = parseEntries(lines.slice(0, end));

  // Guard against a stray "Foo: bar" first line that isn't really a title page.
  if (!entries.some((e) => RECOGNIZED.has(e.key))) {
    return { frontMatter: {}, body: source };
  }

  const frontMatter = mapEntries(entries);
  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { frontMatter, body };
}

function field(key: string, values: string[], indented: boolean): string {
  if (!indented && values.length === 1) return `${key}: ${values[0]}`;
  return `${key}:\n` + values.map((v) => "    " + v).join("\n");
}

/** Serialize front matter to a canonical Fountain title page (no trailing blank line). */
export function serializeTitlePage(fm: FrontMatter): string {
  const out: string[] = [];

  if (fm.title != null) out.push(field("Title", splitLines(fm.title), false));
  if (fm.credit != null) out.push(field("Credit", splitLines(fm.credit), false));
  if (fm.authors && fm.authors.length) {
    out.push(
      fm.authors.length === 1
        ? field("Author", fm.authors, false)
        : field("Authors", fm.authors, true),
    );
  }
  if (fm.source != null) out.push(field("Source", splitLines(fm.source), false));
  if (fm.draftDate != null) {
    out.push(field("Draft date", splitLines(fm.draftDate), false));
  }
  if (fm.contact && fm.contact.length) {
    out.push(field("Contact", fm.contact, true));
  }
  if (fm.setting != null) {
    out.push(field("Setting", splitLines(fm.setting), false));
  }
  if (fm.time != null) out.push(field("Time", splitLines(fm.time), false));
  if (fm.place != null) out.push(field("Place", splitLines(fm.place), false));
  if (fm.characters && fm.characters.length) {
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

function splitLines(value: string): string[] {
  return value.split("\n");
}

export function hasFrontMatter(fm: FrontMatter): boolean {
  return serializeTitlePage(fm).length > 0;
}
