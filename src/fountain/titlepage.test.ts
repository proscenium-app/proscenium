// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { parse } from "./parse";
import { serialize } from "./serialize";
import { serializeTitlePage, splitTitlePage } from "./titlepage";
import type { BlockNode, CharacterEntry, FrontMatter, ParsedScript } from "./model";

const SCRIPT = "\n\nA room.\n";
const read = (page: string) => splitTitlePage(`${page}${SCRIPT}`).frontMatter;

/**
 * The page reads as this, the save after writes these lines, and from there
 * the title page is at rest: read back the same, and saved as the same bytes.
 */
function expectRead(page: string, frontMatter: FrontMatter, saved: string) {
  expect(read(page)).toEqual(frontMatter);
  expect(serializeTitlePage(frontMatter)).toBe(saved);
  expect(read(saved)).toEqual(frontMatter);
  expect(serializeTitlePage(read(saved))).toBe(saved);
}

/**
 * A title page that names a key twice is read as all it was given
 * (docs/engineering/fountain-model.md#EDIT-190). Each entry's value went to its
 * field as it was read, so a later entry of the same key took the place of the
 * one before: `Author: One` over `Author: Two` read as Two alone, and the next
 * save wrote the script without One. A title page typed by hand, or written by
 * another tool, can hold such a pair; the app writes each key once.
 */
describe("a title page that names a key twice keeps all it was given", () => {
  it("the reported cases: two authors, and an unknown key twice", () => {
    const authors = "Title: Play\nAuthor: One\nAuthor: Two\n\nA room.\n";
    expect(parse(authors).frontMatter).toEqual({ title: "Play", authors: ["One", "Two"] });
    const saved = "Title: Play\nAuthors:\n    One\n    Two\n\nA room.\n";
    expect(serialize(parse(authors))).toBe(saved);
    expect(parse(saved)).toEqual(parse(authors));
    expect(serialize(parse(saved))).toBe(saved);
    // With Windows line endings too.
    expect(parse(authors.replaceAll("\n", "\r\n"))).toEqual(parse(authors));

    const notes = "Title: Play\nNotes: first\nNotes: second\n\nA room.\n";
    expect(parse(notes).frontMatter).toEqual({ title: "Play", _extra: { Notes: "first\nsecond" } });
    const kept = "Title: Play\nNotes:\n    first\n    second\n\nA room.\n";
    expect(serialize(parse(notes))).toBe(kept);
    expect(parse(kept)).toEqual(parse(notes));
    expect(serialize(parse(kept))).toBe(kept);
  });

  it("a list holds the values of every entry, in the order they stand", () => {
    expectRead(
      "Author: One\nAuthor: Two\nAuthor: Three",
      { authors: ["One", "Two", "Three"] },
      "Authors:\n    One\n    Two\n    Three",
    );
    // `Author` and `Authors` name one field, so one of each is the key twice.
    expectRead(
      "Author: One\nAuthors:\n    Two\n    Three",
      { authors: ["One", "Two", "Three"] },
      "Authors:\n    One\n    Two\n    Three",
    );
    expectRead(
      "Authors:\n    One\n    Two\nTitle: Play\nAUTHOR: Three",
      { authors: ["One", "Two", "Three"], title: "Play" },
      "Title: Play\nAuthors:\n    One\n    Two\n    Three",
    );
    expectRead(
      "Title: Play\nContact:\n    1 Main St.\nContact: a@example.com",
      { title: "Play", contact: ["1 Main St.", "a@example.com"] },
      "Title: Play\nContact:\n    1 Main St.\n    a@example.com",
    );
    expectRead(
      "Characters:\n    MARA — 40s\nTitle: Play\nCharacters:\n    JONAH\n    A VOICE - offstage",
      {
        characters: [
          { name: "MARA", description: "40s" },
          { name: "JONAH" },
          { name: "A VOICE", description: "offstage" },
        ],
        title: "Play",
      },
      "Title: Play\nCharacters:\n    MARA — 40s\n    JONAH\n    A VOICE — offstage",
    );
  });

  it("a text field holds the lines of every entry", () => {
    const fields: [string, keyof FrontMatter, string][] = [
      ["Title", "title", "Title"],
      ["Credit", "credit", "Credit"],
      ["Source", "source", "Source"],
      ["Draft date", "draftDate", "Draft date"],
      ["Date", "draftDate", "Draft date"],
      ["Setting", "setting", "Setting"],
      ["Time", "time", "Time"],
      ["Place", "place", "Place"],
    ];
    for (const [key, field, canonical] of fields) {
      expectRead(
        `${key}: one\n${key}: two`,
        { [field]: "one\ntwo" },
        `${canonical}:\n    one\n    two`,
      );
      expectRead(
        `${key}:\n    one\n    two\n${key.toUpperCase()}: three`,
        { [field]: "one\ntwo\nthree" },
        `${canonical}:\n    one\n    two\n    three`,
      );
      // An entry with nothing after it adds nothing. Named last, it took the value away.
      expectRead(`${key}: one\n${key}:`, { [field]: "one" }, `${canonical}: one`);
      expectRead(`${key}:\n${key}: one\n${key}:`, { [field]: "one" }, `${canonical}: one`);
      expectRead(`${key}:\n${key}:`, { [field]: "" }, `${canonical}: `);
    }
    // `Date` and `Draft date` name one field.
    expectRead(
      "Title: Play\nDate: 1 May\nDraft date: 2 May",
      { title: "Play", draftDate: "1 May\n2 May" },
      "Title: Play\nDraft date:\n    1 May\n    2 May",
    );
  });

  it("an unknown key holds the lines of every entry, under the key as it was written", () => {
    expectRead(
      "Title: Play\nNotes: first\nCopyright: (c) me\nNotes:\n    second\n    third",
      { title: "Play", _extra: { Notes: "first\nsecond\nthird", Copyright: "(c) me" } },
      "Title: Play\nNotes:\n    first\n    second\n    third\nCopyright: (c) me",
    );
    expectRead(
      "Title: Play\nSomething: else\nSomething: more",
      { title: "Play", _extra: { Something: "else\nmore" } },
      "Title: Play\nSomething:\n    else\n    more",
    );
    expectRead(
      "Title: Play\nNotes:\nNotes: first\nNotes:",
      { title: "Play", _extra: { Notes: "first" } },
      "Title: Play\nNotes: first",
    );
    // A key that is also the name of something every object has.
    expectRead(
      "Title: Play\nconstructor: a\nconstructor: b\ntoString: c",
      { title: "Play", _extra: { constructor: "a\nb", toString: "c" } },
      "Title: Play\nconstructor:\n    a\n    b\ntoString: c",
    );
    // Two spellings of a key were two keys, both kept and both written. They still are.
    expectRead(
      "Title: Play\nNotes: a\nnotes: b",
      { title: "Play", _extra: { Notes: "a", notes: "b" } },
      "Title: Play\nNotes: a\nnotes: b",
    );
  });

  it("a page's text is one whole: the last that reads is the page, and the others are kept", () => {
    const pages: [string, keyof FrontMatter][] = [
      ["Title Page Text", "titlePage"],
      ["Characters Page Text", "charactersPage"],
      ["Opening Notes", "openingNotes"],
    ];
    for (const [key, field] of pages) {
      const one = JSON.stringify("# One\n\n  indented");
      const two = JSON.stringify("# Two\n\nBy me");
      // The two are not joined: joined, neither would read, and the play would have no such page.
      expectRead(
        `Title: Play\n${key}: ${one}\n${key}: ${two}`,
        { title: "Play", [field]: "# Two\n\nBy me", _extra: { [key]: one } },
        `Title: Play\n${key}: ${one}\n${key}: ${two}`,
      );
      expectRead(
        `Title: Play\n${key}: ${one}\n${key}: "three"\n${key}: ${two}`,
        { title: "Play", [field]: "# Two\n\nBy me", _extra: { [key]: `${one}\n"three"` } },
        `Title: Play\n${key}:\n    ${one}\n    "three"\n${key}: ${two}`,
      );
      // Another spelling of the key is kept under that spelling.
      expectRead(
        `Title: Play\n${key.toLowerCase()}: ${one}\n${key}: ${two}`,
        { title: "Play", [field]: "# Two\n\nBy me", _extra: { [key.toLowerCase()]: one } },
        `Title: Play\n${key.toLowerCase()}: ${one}\n${key}: ${two}`,
      );
      // An entry that is no page's text was kept, before the page or after it, and is.
      for (const lines of [
        `${key}: ${one}\n${key}: not text`,
        `${key}: not text\n${key}: ${one}`,
      ]) {
        expectRead(
          `Title: Play\n${lines}`,
          { title: "Play", [field]: "# One\n\n  indented", _extra: { [key]: "not text" } },
          `Title: Play\n${key}: not text\n${key}: ${one}`,
        );
      }
      // Kept in the order they stand, whatever stands between them.
      expectRead(
        `Title: Play\n${key}: ${one}\n${key}: 12\nNotes: a draft\n${key}: ${two}\n${key}:`,
        {
          title: "Play",
          [field]: "# Two\n\nBy me",
          _extra: { [key]: `${one}\n12`, Notes: "a draft" },
        },
        `Title: Play\n${key}:\n    ${one}\n    12\nNotes: a draft\n${key}: ${two}`,
      );
    }
  });

  it("and so is the flag for which opening page comes first", () => {
    expectRead(
      "Title: Play\nOpening Notes First: true\nOpening Notes First: false",
      {
        title: "Play",
        openingNotesBeforeCharacters: false,
        _extra: { "Opening Notes First": "true" },
      },
      "Title: Play\nOpening Notes First: true\nOpening Notes First: false",
    );
    expectRead(
      "Title: Play\nOpening Notes First: true\nOpening Notes First: maybe",
      {
        title: "Play",
        openingNotesBeforeCharacters: true,
        _extra: { "Opening Notes First": "maybe" },
      },
      "Title: Play\nOpening Notes First: maybe\nOpening Notes First: true",
    );
  });

  it("a page kept beside its field is the page once the field is taken away", () => {
    // The app can leave a page's text out, to print the title page from its
    // fields. The copy kept is still in the script, and is read as the page.
    const two = read('Title: Play\nTitle Page Text: "# One"\nTitle Page Text: "# Two"');
    const saved = serializeTitlePage({ ...two, titlePage: undefined });
    expect(saved).toBe('Title: Play\nTitle Page Text: "# One"');
    expect(read(saved)).toEqual({ title: "Play", titlePage: "# One" });
  });

  it("reads a title page that names each key once as it always did", () => {
    const pages: [string, FrontMatter, string][] = [
      [
        [
          "Title: The Weight of Water",
          "Credit: a play by",
          "Author: A. Playwright",
          "Draft date: 2026-06-18",
          "Contact:",
          "    playwright@example.com",
          "Setting: A coastal kitchen.",
          "Time: The last night of winter.",
          "Characters:",
          "    MARA — a hydrologist, 40s",
          "    JONAH — her brother, 30s",
        ].join("\n"),
        {
          title: "The Weight of Water",
          credit: "a play by",
          authors: ["A. Playwright"],
          draftDate: "2026-06-18",
          contact: ["playwright@example.com"],
          setting: "A coastal kitchen.",
          time: "The last night of winter.",
          characters: [
            { name: "MARA", description: "a hydrologist, 40s" },
            { name: "JONAH", description: "her brother, 30s" },
          ],
        },
        "",
      ],
      [
        "Title:\n    X\n    Y\nAuthors:\n    A\n    B\nCopyright: (c) me\nSomething: else",
        { title: "X\nY", authors: ["A", "B"], _extra: { Copyright: "(c) me", Something: "else" } },
        "",
      ],
      [
        'Title: Play\nNotes: a draft\nTitle Page Text: "# Play\\n\\nBy me"\nCharacters Page Text: "**A**"\nOpening Notes: "Anywhere."\nOpening Notes First: true',
        {
          title: "Play",
          _extra: { Notes: "a draft" },
          titlePage: "# Play\n\nBy me",
          charactersPage: "**A**",
          openingNotes: "Anywhere.",
          openingNotesBeforeCharacters: true,
        },
        "",
      ],
      // A house key that is not its value is kept as an unknown key is.
      [
        "Title: Play\nOpening Notes: not text\nOpening Notes First: maybe",
        { title: "Play", _extra: { "Opening Notes": "not text", "Opening Notes First": "maybe" } },
        "",
      ],
      ["Title: Play\nOpening Notes: 12", { title: "Play", _extra: { "Opening Notes": "12" } }, ""],
      // A key with nothing after it: an empty text, an unknown key of no lines.
      ["Title:\nNotes:", { title: "", _extra: { Notes: "" } }, "Title: \nNotes: "],
      // And a list of none, read as it always was. Its lines were not written
      // back, and are (docs/engineering/fountain-model.md#EDIT-192).
      [
        "Title: Play\nAuthor:\nContact:\nCharacters:",
        { title: "Play", authors: [], contact: [], characters: [] },
        "",
      ],
    ];
    for (const [page, frontMatter, saved] of pages) {
      // Saved as the lines it was read from, unless the third says otherwise.
      expectRead(page, frontMatter, saved || page);
    }
  });

  /**
   * Generated title pages, the same on every run. Each is made as entries, so
   * what it should read as is worked out from the entries here, field by field,
   * and not by the reader.
   */
  it("holds for generated title pages, and none that names each key once reads differently", () => {
    type Kind = "text" | "list" | "cast" | "unknown" | "page" | "flag";
    interface Key {
      display: string;
      kind: Kind;
      /** The field it is read into: two keys with one field are one key. An unknown key's is itself. */
      field: string;
    }
    interface Made {
      key: Key;
      values: string[];
      /** A page's text or the flag, where the lines are one; undefined where they are not. */
      whole?: string | boolean;
    }
    const key = (display: string, kind: Kind, field = display): Key => ({ display, kind, field });
    const TEXT = [
      key("Title", "text", "title"),
      key("TITLE", "text", "title"),
      key("Credit", "text", "credit"),
      key("Source", "text", "source"),
      key("Draft date", "text", "draftDate"),
      key("Date", "text", "draftDate"),
      key("Setting", "text", "setting"),
      key("Time", "text", "time"),
      key("Place", "text", "place"),
    ];
    const KEYS = [
      ...TEXT,
      key("Author", "list", "authors"),
      key("Authors", "list", "authors"),
      key("Contact", "list", "contact"),
      key("Characters", "cast", "characters"),
      key("Notes", "unknown"),
      key("notes", "unknown"),
      key("Copyright", "unknown"),
      key("Something", "unknown"),
      key("constructor", "unknown"),
      key("Title Page Text", "page", "titlePage"),
      key("title page text", "page", "titlePage"),
      key("Characters Page Text", "page", "charactersPage"),
      key("Opening Notes", "page", "openingNotes"),
      key("Opening Notes First", "flag", "openingNotesBeforeCharacters"),
    ];

    let state = 20261008;
    const roll = (below: number) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return Math.floor((state / 0x100000000) * below);
    };
    const pick = <T>(from: readonly T[]): T => from[roll(from.length)];
    let words = 0;
    /** A word no other line of the page holds, so a lost line is a missing word. */
    const word = () => `w${++words}`;

    function make(k: Key, valued = false): Made {
      if (k.kind === "page") {
        const text = (whole: string): Made => ({ key: k, values: [JSON.stringify(whole)], whole });
        return pick<() => Made>([
          () => text(word()),
          () => text(`${word()}\n\n  ${word()}`),
          () => ({ key: k, values: [word()] }),
          () => ({ key: k, values: [`"${word()}`] }),
          () => ({ key: k, values: [JSON.stringify(word()), JSON.stringify(word())] }),
          () => ({ key: k, values: [] }),
        ])();
      }
      if (k.kind === "flag") {
        return pick<() => Made>([
          () => ({ key: k, values: ["true"], whole: true }),
          () => ({ key: k, values: ["false"], whole: false }),
          () => ({ key: k, values: [word()] }),
          () => ({ key: k, values: [] }),
        ])();
      }
      const count = valued ? 1 + roll(2) : roll(4);
      const line = () => (k.kind === "cast" && roll(2) ? `${word()} — ${word()}` : word());
      return { key: k, values: Array.from({ length: count }, line) };
    }

    /** The entry as lines: its first value on the key's line or under it, behind any indent the reader takes. */
    function lines(e: Made): string {
      const [first, ...rest] = e.values;
      const indent = pick(["    ", "\t", "   ", "      "]);
      if (first === undefined) return `${e.key.display}:`;
      const under = (roll(2) ? rest : e.values).map((v) => indent + v);
      const head =
        under.length === e.values.length ? `${e.key.display}:` : `${e.key.display}: ${first}`;
      return [head, ...under].join("\n");
    }

    const cast = (line: string): CharacterEntry => {
      const [name, description] = line.split(" — ");
      return description ? { name, description } : { name };
    };

    function reading(entries: Made[]): FrontMatter {
      const fm: Record<string, unknown> = {};
      const named = (field: string) => entries.filter((e) => e.key.field === field);
      const fields = [...new Set(entries.map((e) => e.key.field))];
      // Which entry of a whole-valued key is its field: the last that is one.
      const field = new Map<string, Made>();
      for (const e of entries) if (e.whole !== undefined) field.set(e.key.field, e);
      for (const name of fields) {
        const all = named(name).flatMap((e) => e.values);
        const kind = named(name)[0].key.kind;
        if (kind === "text") fm[name] = all.join("\n");
        if (kind === "list") fm[name] = all;
        if (kind === "cast") fm[name] = all.map(cast);
        if (field.has(name)) fm[name] = field.get(name)?.whole;
      }
      const unknown = entries.filter((e) =>
        e.key.kind === "unknown"
          ? true
          : e.whole === undefined
            ? isWhole(e)
            : field.get(e.key.field) !== e,
      );
      const extra: Record<string, string> = {};
      for (const e of unknown) {
        const all = unknown.filter((u) => u.key.display === e.key.display).flatMap((u) => u.values);
        extra[e.key.display] = all.join("\n");
      }
      if (unknown.length) fm._extra = extra;
      return fm as FrontMatter;
    }
    const isWhole = (e: Made) => e.key.kind === "page" || e.key.kind === "flag";

    let once = 0;
    let twice = 0;
    for (let n = 0; n < 4000; n++) {
      words = 0;
      // One key the reader knows, with a value, so the save is a title page too.
      const entries = [make(pick(TEXT), true)];
      // One page in three is made of keys that all differ. In the others, one
      // entry in three is of a key the page already names, in any spelling.
      const fresh = roll(3) === 0;
      for (let more = roll(7); more > 0; more--) {
        const named = pick(entries).key.field;
        const k =
          !fresh && roll(3) === 0 ? pick(KEYS.filter((o) => o.field === named)) : pick(KEYS);
        if (fresh && entries.some((e) => e.key.field === k.field)) continue;
        entries.splice(roll(entries.length + 1), 0, make(k));
      }
      const page = entries.map(lines).join("\n");
      const again = entries.some(
        (e, i) => entries.findIndex((o) => o.key.field === e.key.field) < i,
      );
      if (again) twice += 1;
      else once += 1;

      const frontMatter = read(page);
      expect(frontMatter).toEqual(reading(entries));
      // No word of the title page is missing from what was read.
      const held = JSON.stringify(frontMatter);
      for (let w = 1; w <= words; w++) expect(held).toMatch(new RegExp(`w${w}\\b`));
      // The save after reads back the same, and is the same bytes from then on.
      const saved = serializeTitlePage(frontMatter);
      expect(read(saved)).toEqual(frontMatter);
      expect(serializeTitlePage(read(saved))).toBe(saved);
      // And the script under it is the script.
      expect(splitTitlePage(`${page}${SCRIPT}`).body).toBe("A room.\n");
    }
    expect(once).toBeGreaterThan(1000);
    expect(twice).toBeGreaterThan(1000);
  });
});

/**
 * What the serializer writes as a title page is one to the reader
 * (docs/engineering/fountain-model.md#EDIT-192). The reader takes a file's
 * first block for a title page only when it holds a key it knows, so that a
 * first line of the script like `Foo: bar` stays the script's
 * (docs/engineering/fountain-model.md#EDIT-184). A front matter of unknown
 * keys alone, `Format: stage`, was written as that line, and on the reopen the
 * line was a stage direction at the top of the script. A title page got there
 * by itself from a list key with nothing after it over an unknown key: the
 * list of none was not written.
 */
describe("a title page is written as one the reader takes", () => {
  const action = (text: string): BlockNode => ({
    type: "action",
    content: [{ type: "text", text }],
  });
  const script = (frontMatter: FrontMatter, ...lines: string[]): ParsedScript => ({
    frontMatter,
    doc: { type: "doc", content: lines.map(action) },
  });

  it("the reported cases: a list of none over an unknown key, and unknown keys alone", () => {
    const typed = "Author:\nFormat: stage\n\nA room.\n";
    const held = script({ authors: [], _extra: { Format: "stage" } }, "A room.");
    expect(parse(typed)).toEqual(held);
    // At rest as it was typed. The save was `Format: stage` over the script,
    // and the reading after it a stage direction `Format: stage`.
    expect(serialize(parse(typed))).toBe(typed);
    expect(parse(typed.replaceAll("\n", "\r\n"))).toEqual(held);

    // The same front matter with no list in it, as the app can leave one.
    const unknown = script({ _extra: { Format: "stage" } }, "A room.");
    expect(serialize(unknown)).toBe(typed);
    expect(parse(serialize(unknown))).toEqual(held);
    expect(serialize(parse(serialize(unknown)))).toBe(typed);
    // With no script under it.
    expect(serialize(script({ _extra: { Format: "stage" } }))).toBe("Author:\nFormat: stage\n");
    expect(parse("Author:\nFormat: stage\n")).toEqual(
      script({ authors: [], _extra: { Format: "stage" } }),
    );
  });

  it("a list key with nothing after it keeps its line", () => {
    // The key as typed, its field, the key as written, and the field and its lines with one value.
    const lists: [string, keyof FrontMatter, string, unknown, string][] = [
      ["Author", "authors", "Author", ["One"], "Author: One"],
      ["Authors", "authors", "Author", ["One"], "Author: One"],
      ["AUTHOR", "authors", "Author", ["One"], "Author: One"],
      ["Contact", "contact", "Contact", ["One"], "Contact:\n    One"],
      ["contact", "contact", "Contact", ["One"], "Contact:\n    One"],
      ["Characters", "characters", "Characters", [{ name: "One" }], "Characters:\n    One"],
    ];
    for (const [key, field, canonical, one, valued] of lists) {
      // Alone it is the whole title page, and was no title page after a save.
      expectRead(`${key}:`, { [field]: [] }, `${canonical}:`);
      expectRead(`${key}:  \t`, { [field]: [] }, `${canonical}:`);
      // Over an unknown key and under one: the key the reader knows is kept.
      const extra = { _extra: { Format: "stage" } };
      expectRead(
        `${key}:\nFormat: stage`,
        { [field]: [], ...extra },
        `${canonical}:\nFormat: stage`,
      );
      expectRead(
        `Format: stage\n${key}:`,
        { [field]: [], ...extra },
        `${canonical}:\nFormat: stage`,
      );
      // Named twice with nothing either time, it is one list of none.
      expectRead(`${key}:\n${key}:`, { [field]: [] }, `${canonical}:`);
      // And beside a value it adds nothing, as before.
      expectRead(`${key}:\n${key}: One\n${key}:`, { [field]: one }, valued);
    }
    // `Author` and `Authors` name one field: neither with a value is `Author:`.
    expectRead("Author:\nAuthors:", { authors: [] }, "Author:");
    // No key is put over a page that holds one the reader knows.
    expectRead(
      "Contact:\nFormat: stage",
      { contact: [], _extra: { Format: "stage" } },
      "Contact:\nFormat: stage",
    );
    // Each list of none stands where the list stands among the fields.
    const page = [
      "Title: Play",
      "Credit: by",
      "Author:",
      "Source: a book",
      "Draft date: 1 May",
      "Contact:",
      "Setting: A room.",
      "Time: Now.",
      "Place: Here.",
      "Characters:",
      "Format: stage",
      'Opening Notes: "Anywhere."',
    ].join("\n");
    expectRead(
      page,
      {
        title: "Play",
        credit: "by",
        authors: [],
        source: "a book",
        draftDate: "1 May",
        contact: [],
        setting: "A room.",
        time: "Now.",
        place: "Here.",
        characters: [],
        _extra: { Format: "stage" },
        openingNotes: "Anywhere.",
      },
      page,
    );
    // Through the whole script, and at rest from the first reading.
    for (const typed of [
      "Author:\n\nA room.\n",
      "Title: Play\nAuthor:\nContact:\nCharacters:\n\nA room.\n",
      "Characters:\nLanguage: en\nFormat: stage\n\nMARA\nHello.\n",
    ]) {
      expect(serialize(parse(typed))).toBe(typed);
    }
  });

  it("unknown keys alone are written under a key the reader knows", () => {
    // The app's two ways there: the cast list emptied in the cast view, and
    // the characters page given back to the list. Either takes out the last
    // field the reader knew.
    const cast = read("Characters:\n    MARA\nFormat: stage\nLanguage: en");
    expect(cast).toEqual({
      characters: [{ name: "MARA" }],
      _extra: { Format: "stage", Language: "en" },
    });
    const { characters: _cast, ...emptied } = cast;
    expectRead(
      "Author:\nFormat: stage\nLanguage: en",
      { authors: [], ...emptied },
      "Author:\nFormat: stage\nLanguage: en",
    );
    expect(serializeTitlePage(emptied)).toBe("Author:\nFormat: stage\nLanguage: en");
    expect(serializeTitlePage({ ...cast, characters: undefined })).toBe(
      "Author:\nFormat: stage\nLanguage: en",
    );
    const page = read('Format: stage\nCharacters Page Text: "**MARA**"');
    expect(page).toEqual({ charactersPage: "**MARA**", _extra: { Format: "stage" } });
    expect(serializeTitlePage({ ...page, charactersPage: undefined })).toBe(
      "Author:\nFormat: stage",
    );

    const unknown: Record<string, string>[] = [
      { Format: "stage" },
      { Format: "stage", Language: "en", Episode: "3" },
      // A key with nothing after it, with lines under it, with a colon in its value.
      { Format: "" },
      { Format: "stage\nscreen" },
      { "Foo Bar 2": "x: y" },
      // A key that is also the name of something every object has.
      { constructor: "a" },
    ];
    for (const _extra of unknown) {
      const held = script({ _extra }, "A room.", "She waits.");
      const saved = serialize(held);
      expect(saved.startsWith("Author:\n")).toBe(true);
      // Every line of the title page is in the title page, and none in the script.
      const back = parse(saved);
      expect(back).toEqual(script({ authors: [], _extra }, "A room.", "She waits."));
      // And at rest from that save.
      expect(serialize(back)).toBe(saved);
    }
  });

  it("no key is written where the reader takes the page without one", () => {
    // Any field the reader knows beside the unknown key.
    const known: FrontMatter[] = [
      { title: "Play" },
      { title: "" },
      { credit: "by" },
      { authors: ["One"] },
      { authors: ["One", "Two"] },
      { source: "a book" },
      { draftDate: "1 May" },
      { contact: ["a@example.com"] },
      { contact: [] },
      { setting: "A room." },
      { time: "Now." },
      { place: "Here." },
      { characters: [{ name: "MARA" }] },
      { characters: [] },
      { titlePage: "# Play" },
      { charactersPage: "**MARA**" },
      { openingNotes: "" },
      { openingNotesBeforeCharacters: false },
    ];
    for (const fields of known) {
      const frontMatter = { ...fields, _extra: { Format: "stage" } };
      const saved = serializeTitlePage(frontMatter);
      expect(saved).not.toMatch(/^Author:$/m);
      expect(read(saved)).toEqual(frontMatter);
      expect(serializeTitlePage(read(saved))).toBe(saved);
    }
    // A key the reader knows and keeps with the unknown ones, in any spelling,
    // and a house key whose lines are not its value.
    const kept: [string, string][] = [
      ["Notes", "a draft"],
      ["NOTES", "a draft"],
      ["Copyright", "(c) me"],
      ["Revision", "2"],
      ["Revisions", "blue"],
      ["Opening Notes", "not text"],
      ["Opening Notes First", "maybe"],
      ["Title Page Text", "12"],
      ["characters page text", "not text"],
    ];
    for (const [key, value] of kept) {
      expectRead(
        `Format: stage\n${key}: ${value}`,
        { _extra: { Format: "stage", [key]: value } },
        `Format: stage\n${key}: ${value}`,
      );
    }
    // Nothing to write is no title page, and no key makes one.
    for (const empty of [{}, { _extra: {} }, { atRise: "The kitchen." }] as FrontMatter[]) {
      expect(serializeTitlePage(empty)).toBe("");
      expect(serialize(script(empty, "A room."))).toBe("A room.\n");
    }
  });

  it("the script's first line is still the script's", () => {
    // The bytes an unknown key alone was written as are a stage direction, and
    // stay one: nothing on the line says a title page was meant, and a script
    // at rest is read and written as it was.
    for (const line of [
      "Format: stage",
      "Foo: bar",
      "Format:",
      "Format:\n    stage",
      "Format: stage\nLanguage: en",
    ]) {
      const typed = `${line}\n\nA room.\n`;
      expect(parse(typed)).toEqual(script({}, line, "A room."));
      expect(serialize(parse(typed))).toBe(typed);
    }
  });

  it("and under a title page of unknown keys the script is the script", () => {
    // Whatever its first line looks like: a key of the house's, a standard
    // key, the unknown key itself, the key the page was written under.
    for (const line of ["Time: now.", "Title: X", "Format: stage", "Author:", "AUTHOR: Me"]) {
      const held = script({ _extra: { Format: "stage" } }, line, "A room.");
      const back = parse(serialize(held));
      expect(back).toEqual(script({ authors: [], _extra: { Format: "stage" } }, line, "A room."));
      expect(serialize(back)).toBe(serialize(held));
    }
  });

  /** Generated front matters and title pages, the same on every run. */
  it("holds for generated front matters, and for title pages whose known keys have nothing after them", () => {
    let state = 20261009;
    const roll = (below: number) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return Math.floor((state / 0x100000000) * below);
    };
    const pick = <T>(from: readonly T[]): T => from[roll(from.length)];
    let words = 0;
    /** A word no other line holds, so a line that left the title page is a missing word. */
    const word = () => `w${++words}`;

    /** Keys the reader does not know, and ones it knows and keeps with them. */
    const UNKNOWN = ["Format", "Language", "Episode", "Foo Bar 2", "constructor", "format"];
    const KEPT = ["Notes", "COPYRIGHT", "Revision", "Opening Notes", "Title Page Text"];
    const TEXT = ["title", "credit", "source", "draftDate", "setting", "time", "place"] as const;
    const LISTS = ["authors", "contact"] as const;
    const PAGES = ["titlePage", "charactersPage", "openingNotes"] as const;

    const text = () => pick([() => word(), () => `${word()}\n${word()}`, () => ""])();
    const several = () => Array.from({ length: roll(3) }, word);

    /**
     * A front matter as the app can hold one: each field there or not, a list
     * of one, several or none, and unknown keys. `known`: it holds a field or
     * a kept key the reader takes a title page by.
     */
    function made(): { frontMatter: FrontMatter; known: boolean } {
      const fm: Record<string, unknown> = {};
      // Two in three hold no field at all, so unknown keys stand alone often.
      const bare = roll(3) > 0;
      const some = () => !bare && roll(4) === 0;
      for (const field of TEXT) if (some()) fm[field] = text();
      for (const field of LISTS) if (some()) fm[field] = several();
      if (some()) {
        fm.characters = several().map((name) =>
          roll(2) ? { name, description: word() } : { name },
        );
      }
      const page = () => pick([() => word(), () => `${word()}\n\n  ${word()}`, () => ""])();
      for (const field of PAGES) if (some()) fm[field] = page();
      if (some()) fm.openingNotesBeforeCharacters = roll(2) === 0;
      let known = Object.keys(fm).length > 0;
      const extra: Record<string, string> = {};
      for (let n = roll(4); n > 0; n--) {
        const key = pick(UNKNOWN);
        if (!Object.keys(extra).includes(key)) extra[key] = text();
      }
      if (roll(8) === 0) {
        extra[pick(KEPT)] = word();
        known = true;
      }
      if (Object.keys(extra).length) fm._extra = extra;
      return { frontMatter: fm as FrontMatter, known };
    }

    let alone = 0;
    let withOne = 0;
    for (let n = 0; n < 4000; n++) {
      words = 0;
      const { frontMatter, known } = made();
      const saved = serialize(script(frontMatter, "A room.", "She waits."));
      if (!Object.keys(frontMatter).length) {
        expect(saved).toBe("A room.\n\nShe waits.\n");
        continue;
      }
      // The key is written exactly where the page holds none the reader knows.
      expect(saved.startsWith("Author:\n") && frontMatter.authors === undefined).toBe(!known);
      if (known) withOne += 1;
      else alone += 1;
      // Read back whole, but for the list of none where the key was written.
      const back = parse(saved);
      expect(back).toEqual(
        script(known ? frontMatter : { authors: [], ...frontMatter }, "A room.", "She waits."),
      );
      // No word of the title page is missing from it, and none is in the script.
      const held = JSON.stringify(back.frontMatter);
      for (let w = 1; w <= words; w++) expect(held).toMatch(new RegExp(`w${w}\\b`));
      // At rest from that save.
      expect(serialize(back)).toBe(saved);
    }
    expect(alone).toBeGreaterThan(1000);
    expect(withOne).toBeGreaterThan(1000);

    // Title pages as they are typed: a list key or two with nothing after it,
    // among unknown keys, and now and then a key with a value.
    const LIST_KEYS = ["Author", "Authors", "AUTHOR", "Contact", "contact", "Characters"];
    let noValue = 0;
    for (let n = 0; n < 4000; n++) {
      words = 0;
      const entries: string[] = [];
      for (let more = 1 + roll(2); more > 0; more--) {
        const key = pick(LIST_KEYS);
        entries.push(roll(6) === 0 ? `${key}: ${word()}` : `${key}:${pick(["", " ", "\t"])}`);
      }
      for (let more = roll(4); more > 0; more--) {
        const line = pick([
          () => `${pick(UNKNOWN)}: ${word()}`,
          () => `${pick(UNKNOWN)}:\n    ${word()}\n    ${word()}`,
          () => `${pick(UNKNOWN)}:`,
        ])();
        entries.splice(roll(entries.length + 1), 0, line);
      }
      const page = entries.join("\n");
      const typed = `${page}\n\nA room.\n\nShe waits.\n`;
      const first = parse(typed);
      expect(first.doc).toEqual(script({}, "A room.", "She waits.").doc);
      const held = JSON.stringify(first.frontMatter);
      for (let w = 1; w <= words; w++) expect(held).toMatch(new RegExp(`w${w}\\b`));
      const lists = [
        first.frontMatter.authors,
        first.frontMatter.contact,
        first.frontMatter.characters,
      ];
      if (lists.every((list) => !list?.length)) noValue += 1;
      // The save reads back as the page did, and is the same bytes from then on.
      const saved = serialize(first);
      expect(parse(saved)).toEqual(first);
      expect(serialize(parse(saved))).toBe(saved);
    }
    expect(noValue).toBeGreaterThan(2000);
  });
});
