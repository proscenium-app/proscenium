// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Export Fountain's file (docs/app/formatting/formats-and-layout.md#FMT-171):
 * the script as it is written, its pages before the script between its title
 * page and its first line, and every word of it read back as it went out.
 */
import { describe, expect, test } from "bun:test";
import { extractScenes, parse, serialize, textContent } from "../fountain";
import type { BlockNode, Doc, FrontMatter, ParsedScript } from "../fountain";
import { withoutPageKeys } from "../workspace/front-folder";
import {
  BACK_PAGES_CLOSE,
  BACK_PAGES_OPEN,
  PAGES_CLOSE,
  PAGES_OPEN,
  backPagesAsFountain,
  fountainWithPages,
  pagesAsFountain,
} from "./fountain-with-pages";
import { TITLE_PAGE_FILE, backPageList, frontPageList } from "./page-files";

/** A script of two acts, a synopsis and speeches, as a writer's would be. */
const BODY = parse(
  [
    "# ACT ONE",
    "",
    "## SCENE 1",
    "",
    "= Mara alone before dawn.",
    "",
    "AT RISE: A kitchen, just before dawn.",
    "",
    "MARA",
    "The pipe's been crying all night.",
    "",
    "# ACT TWO",
    "",
    "## SCENE 1",
    "",
    "JONAH",
    "(from the doorway)",
    "You and that pipe.",
    "",
  ].join("\n"),
).doc;

/** The file as the workspace makes it: the script as it is written once its pages are files. */
function exported(frontMatter: FrontMatter, doc: Doc = BODY): string {
  return fountainWithPages(
    { frontMatter: withoutPageKeys(frontMatter), doc },
    frontPageList(frontMatter),
  );
}

/** A page's file from its lines. */
const file = (...lines: string[]) => `${lines.join("\n")}\n`;

/** A block as it reads: its kind and words, a note in its brackets, a page break as written. */
function said(block: BlockNode | undefined): string {
  if (!block) return "no block";
  if (block.type === "pageBreak") return "===";
  const words = (block.content ?? [])
    .map((node) => (node.type === "note" ? `[[${textContent(node.content)}]]` : node.text))
    .join("");
  return `${block.type}: ${words}`;
}

/**
 * The file read back: the title page's keys and the script's blocks as the
 * script alone reads, the pages before them as notes, centered text, stage
 * directions and page breaks, and the same scenes in the same acts. Returns
 * the blocks the pages read as.
 */
function readBack(out: string, script: ParsedScript): BlockNode[] {
  const alone = parse(serialize(script));
  const read = parse(out);
  expect(read.frontMatter).toEqual(alone.frontMatter);
  const pages = read.doc.content.length - alone.doc.content.length;
  expect(pages).toBeGreaterThan(0);
  expect(read.doc.content.slice(pages)).toEqual(alone.doc.content);
  const before = read.doc.content.slice(0, pages);
  for (const block of before) expect(["action", "centered", "pageBreak"]).toContain(block.type);
  expect(said(before[0])).toBe(`action: ${PAGES_OPEN}`);
  expect(said(before[before.length - 1])).toBe(`action: ${PAGES_CLOSE}`);
  const scenes = (doc: Doc) =>
    extractScenes(doc).map(({ act, heading, synopsis }) => ({ act, heading, synopsis }));
  expect(scenes(read.doc)).toEqual(scenes(alone.doc));
  expect(scenes(read.doc).length).toBe(2);
  return before;
}

/** A play's details, which the title page's keys hold and a page's fields show. */
const DETAILS: FrontMatter = {
  title: "The Tide",
  credit: "a play by",
  authors: ["A. Writer"],
  draftDate: "2026-01-01",
  contact: ["a@example.com", "555 0100"],
};

describe("Export Fountain: one file with the pages before the script in it", () => {
  test("a play whose pages are still its title page's keys: the pages they print, and no key twice", () => {
    const fm: FrontMatter = {
      ...DETAILS,
      characters: [{ name: "Mara", description: "a hydrologist, 40s" }, { name: "Jonah" }],
      openingNotes: "A kitchen by the sea. **Night.**",
      productionNotes: "Two actors double the parts.",
    };
    const out = exported(fm);
    expect(out).toBe(
      file(
        "Title: The Tide",
        "Credit: a play by",
        "Author: A. Writer",
        "Draft date: 2026-01-01",
        "Contact:",
        "    a@example.com",
        "    555 0100",
        "",
        PAGES_OPEN,
        "",
        "> CHARACTERS <",
        "",
        "!MARA — a hydrologist, 40s",
        "",
        "!JONAH",
        "",
        "===",
        "",
        "!A kitchen by the sea. **Night.**",
        "",
        "===",
        "",
        "> PRODUCTION NOTES <",
        "",
        "!Two actors double the parts.",
        "",
        "===",
        "",
        PAGES_CLOSE,
        "",
        serialize({ frontMatter: {}, doc: BODY }).trimEnd(),
      ),
    );
    const pages = readBack(out, { frontMatter: withoutPageKeys(fm), doc: BODY });
    expect(pages.map(said)).toEqual([
      `action: ${PAGES_OPEN}`,
      "centered: CHARACTERS",
      "action: MARA — a hydrologist, 40s",
      "action: JONAH",
      "===",
      "action: A kitchen by the sea. Night.",
      "===",
      "centered: PRODUCTION NOTES",
      "action: Two actors double the parts.",
      "===",
      `action: ${PAGES_CLOSE}`,
    ]);
    // The pages went out as pages, and not again as the app's own keys.
    expect(parse(out).frontMatter.characters).toBeUndefined();
    expect(out).not.toContain("Production Notes Text");
  });

  test("pages written freely in the title page, the opening notes first", () => {
    const fm: FrontMatter = {
      ...DETAILS,
      titlePage: file("<!-- proscenium:align=center -->", "", "# The Tide", "", "by A. Writer"),
      charactersPage: file("## The People", "", "**MARA** — a hydrologist"),
      openingNotes: "The coast.",
      openingNotesBeforeCharacters: true,
      setting: "Not printed: the opening notes replaced it.",
    };
    const out = exported(fm);
    expect(pagesAsFountain(frontPageList(fm), fm)).toBe(
      [
        PAGES_OPEN,
        "> THE TIDE <",
        "!by A. Writer",
        "===",
        "!The coast.",
        "===",
        "> THE PEOPLE <",
        "!**MARA** — a hydrologist",
        "===",
        PAGES_CLOSE,
      ].join("\n\n"),
    );
    for (const key of ["Title Page Text", "Characters Page Text", "Opening Notes", "Setting"])
      expect(out).not.toContain(`${key}:`);
    readBack(out, { frontMatter: withoutPageKeys(fm), doc: BODY });
  });

  test("a play's page files: fields filled, centered and right text, bold names, lists, an unticked page", () => {
    const fm: FrontMatter = {
      title: "The Tide",
      authors: ["A. Writer"],
      contact: ["a@example.com", "555 0100"],
      draftDate: "2026-01-01",
      pages: [
        { id: "title", name: "Title Page", text: TITLE_PAGE_FILE },
        {
          id: "free",
          name: "Title Page Written Freely",
          text: file(
            "---",
            "layout: title",
            "---",
            "",
            "<!-- proscenium:align=center -->",
            "",
            "# {title}",
            "",
            "<!-- proscenium:align=center -->",
            "",
            "A play in two acts by **{author}**",
            "",
            "<!-- proscenium:foot -->",
            "",
            "{contact}",
            "",
            "<!-- proscenium:align=right -->",
            "",
            "Draft of {draftDate}",
          ),
        },
        {
          id: "cast",
          name: "Characters",
          text: file(
            "<!-- proscenium:align=center -->",
            "",
            "## Characters",
            "",
            "**MARA**, a hydrologist",
            "",
            "**JONAH**, her brother",
            "",
            "THE NEIGHBOUR",
          ),
        },
        {
          id: "props",
          name: "Props",
          text: file(
            "---",
            "export: false",
            "---",
            "",
            "## *Props* and things",
            "",
            "- A kettle",
            "- *Two* cups",
            "",
            "1. First",
            "2. Second",
          ),
        },
        {
          id: "text",
          name: "A Note on the Text",
          text: file(
            "# A note on the text",
            "",
            "<!-- proscenium:align=right -->",
            "",
            "*Lines in italics overlap.*",
            "",
            "Wow",
            "!Bang",
            "",
            "A line_with snake_case, \\*stars\\* and [[brackets]]",
          ),
        },
      ],
    };
    const out = fountainWithPages({ frontMatter: fm, doc: BODY }, frontPageList(fm));
    expect(out).toBe(
      file(
        "Title: The Tide",
        "Author: A. Writer",
        "Draft date: 2026-01-01",
        "Contact:",
        "    a@example.com",
        "    555 0100",
        "",
        PAGES_OPEN,
        "",
        // The title page of fields alone is the one above; the one written freely goes.
        "> THE TIDE <",
        "",
        "> A play in two acts by **A. Writer** <",
        "",
        "!a@example.com",
        "555 0100",
        "",
        "!Draft of 2026-01-01",
        "",
        "===",
        "",
        "> CHARACTERS <",
        "",
        "!**MARA**, a hydrologist",
        "",
        "!**JONAH**, her brother",
        "",
        "!THE NEIGHBOUR",
        "",
        "===",
        "",
        // Unticked for export, and still the play's.
        "> *PROPS* AND THINGS <",
        "",
        "!• A kettle",
        "• *Two* cups",
        "",
        "!1. First",
        "2. Second",
        "",
        "===",
        "",
        "> A NOTE ON THE TEXT <",
        "",
        "!*Lines in italics overlap.*",
        "",
        "!Wow",
        "!!Bang",
        "",
        "!A line\\_with snake\\_case, \\*stars\\* and \\[\\[brackets\\]\\]",
        "",
        "===",
        "",
        PAGES_CLOSE,
        "",
        serialize({ frontMatter: {}, doc: BODY }).trimEnd(),
      ),
    );
    const pages = readBack(out, { frontMatter: fm, doc: BODY });
    expect(pages.map(said)).toEqual([
      `action: ${PAGES_OPEN}`,
      "centered: THE TIDE",
      "centered: A play in two acts by A. Writer",
      "action: a@example.com\n555 0100",
      "action: Draft of 2026-01-01",
      "===",
      "centered: CHARACTERS",
      "action: MARA, a hydrologist",
      "action: JONAH, her brother",
      "action: THE NEIGHBOUR",
      "===",
      "centered: PROPS AND THINGS",
      "action: • A kettle\n• Two cups",
      "action: 1. First\n2. Second",
      "===",
      "centered: A NOTE ON THE TEXT",
      "action: Lines in italics overlap.",
      "action: Wow\n!Bang",
      "action: A line_with snake_case, *stars* and [[brackets]]",
      "===",
      `action: ${PAGES_CLOSE}`,
    ]);
    // Emphasis is Fountain's own, and reads back on the same words.
    const cast = pages.find((block) => said(block) === "action: MARA, a hydrologist");
    expect(cast?.content?.[0]).toEqual({ type: "text", text: "MARA", marks: [{ type: "strong" }] });
    const heading = pages.find((block) => said(block) === "centered: PROPS AND THINGS");
    expect(heading?.content?.[0]).toEqual({ type: "text", text: "PROPS", marks: [{ type: "em" }] });
  });

  test("a field is filled as a page shows it: contact lines, a blank one between blocks, none for no value", () => {
    const fm: FrontMatter = {
      title: "The Tide",
      authors: ["A. Writer"],
      contact: ["a@example.com", "", "AGENCY", "555 0100"],
    };
    const page = {
      id: "p",
      name: "Contact",
      text: file("Write to", "", "{contact}", "", "{source}", "", "{credit} {author}"),
    };
    expect(pagesAsFountain([page], fm)).toBe(
      [
        PAGES_OPEN,
        "!Write to",
        "!a@example.com",
        // A line in capitals after a blank one is forced again: no reader takes it for a cue.
        "!AGENCY\n555 0100",
        "!by A. Writer",
        "===",
        PAGES_CLOSE,
      ].join("\n\n"),
    );
  });

  test("a script with no title page opens with its pages, and its first line stays its own", () => {
    const doc: Doc = {
      type: "doc",
      content: [
        {
          type: "action",
          content: [{ type: "text", text: "Title: the first line, no title page" }],
        },
        ...BODY.content,
      ],
    };
    const fm: FrontMatter = {
      pages: [{ id: "d", name: "Dedication", text: file("*For the river.*") }],
    };
    const out = fountainWithPages({ frontMatter: fm, doc }, frontPageList(fm));
    expect(out.startsWith(`${PAGES_OPEN}\n\n!*For the river.*\n\n===\n\n${PAGES_CLOSE}\n\n`)).toBe(
      true,
    );
    const read = parse(out);
    expect(read.frontMatter).toEqual({});
    expect(said(read.doc.content[4])).toBe("action: Title: the first line, no title page");
    expect(read.doc.content.slice(4)).toEqual(
      parse(serialize({ frontMatter: fm, doc })).doc.content,
    );
  });

  test("with no page of words of its own, the file is the script as it is written", () => {
    const pages = [
      { id: "title", name: "Title Page", text: TITLE_PAGE_FILE },
      { id: "blank", name: "Untitled Page", text: "" },
      {
        id: "fields",
        name: "Half Title",
        text: file("---", "layout: third", "---", "", "# {TITLE}"),
      },
    ];
    const fm: FrontMatter = { ...DETAILS, pages };
    expect(fountainWithPages({ frontMatter: fm, doc: BODY }, frontPageList(fm))).toBe(
      serialize({ frontMatter: fm, doc: BODY }),
    );
    // Nor does a play whose title page prints its details alone.
    expect(exported(DETAILS)).toBe(serialize({ frontMatter: DETAILS, doc: BODY }));
    expect(fountainWithPages({ frontMatter: {}, doc: BODY }, [])).toBe(
      serialize({ frontMatter: {}, doc: BODY }),
    );
  });
});

describe("Export Fountain: the pages after the script follow its last line", () => {
  /** The scenes a file reads as: the act each is in, its heading and its summary. */
  const scenesOf = (doc: Doc) =>
    extractScenes(doc).map(({ act, heading, synopsis }) => ({ act, heading, synopsis }));
  const ABOUT = {
    id: "about",
    name: "About the Author",
    text: file(
      "<!-- proscenium:align=center -->",
      "",
      "## About the author",
      "",
      "**{author}** writes by the sea.",
      "",
      "WRITE TO HER",
    ),
  };
  const THANKS = {
    id: "thanks",
    name: "Acknowledgments",
    text: file("---", "export: false", "---", "", "- The lighthouse", "- *Its* keeper"),
  };

  test("each after a page break, between their own notes, written as the pages before are", () => {
    const fm: FrontMatter = { ...DETAILS, backPages: [ABOUT, THANKS] };
    const out = fountainWithPages(
      { frontMatter: fm, doc: BODY },
      frontPageList(fm),
      backPageList(fm),
    );
    const script = serialize({ frontMatter: DETAILS, doc: BODY });
    // The title page holds the play's details and nothing of these pages.
    expect(script).not.toContain("about");
    expect(out).toBe(
      file(
        script.trimEnd(),
        "",
        BACK_PAGES_OPEN,
        "",
        "===",
        "",
        "> ABOUT THE AUTHOR <",
        "",
        "!**A. Writer** writes by the sea.",
        "",
        // A line in capitals is a stage direction, never a cue with no speech.
        "!WRITE TO HER",
        "",
        "===",
        "",
        // Unticked for export, and still the play's.
        "!• The lighthouse",
        "• *Its* keeper",
        "",
        BACK_PAGES_CLOSE,
      ),
    );
    // Read back: the script's blocks as the script alone reads, then the pages.
    const alone = parse(script);
    const read = parse(out);
    expect(read.frontMatter).toEqual(alone.frontMatter);
    expect(read.doc.content.slice(0, alone.doc.content.length)).toEqual(alone.doc.content);
    const after = read.doc.content.slice(alone.doc.content.length);
    for (const block of after) expect(["action", "centered", "pageBreak"]).toContain(block.type);
    expect(after.map(said)).toEqual([
      `action: ${BACK_PAGES_OPEN}`,
      "===",
      "centered: ABOUT THE AUTHOR",
      "action: A. Writer writes by the sea.",
      "action: WRITE TO HER",
      "===",
      "action: • The lighthouse\n• Its keeper",
      `action: ${BACK_PAGES_CLOSE}`,
    ]);
    // The same scenes in the same acts: nothing after the script is taken for one.
    expect(scenesOf(read.doc)).toEqual(scenesOf(alone.doc));
    expect(scenesOf(read.doc).length).toBe(2);
  });

  test("with pages on both sides, the file is the pages, the script, then the pages", () => {
    const fm: FrontMatter = {
      ...DETAILS,
      pages: [{ id: "d", name: "Dedication", text: file("*For the river.*") }],
      backPages: [THANKS],
    };
    const out = fountainWithPages(
      { frontMatter: fm, doc: BODY },
      frontPageList(fm),
      backPageList(fm),
    );
    const title = serialize({ frontMatter: DETAILS, doc: { type: "doc", content: [] } }).trimEnd();
    const body = serialize({ frontMatter: {}, doc: BODY }).trimEnd();
    expect(out).toBe(
      file(
        title,
        "",
        PAGES_OPEN,
        "",
        "!*For the river.*",
        "",
        "===",
        "",
        PAGES_CLOSE,
        "",
        body,
        "",
        BACK_PAGES_OPEN,
        "",
        "===",
        "",
        "!• The lighthouse",
        "• *Its* keeper",
        "",
        BACK_PAGES_CLOSE,
      ),
    );
    const read = parse(out);
    const alone = parse(serialize({ frontMatter: DETAILS, doc: BODY }));
    expect(scenesOf(read.doc)).toEqual(scenesOf(alone.doc));
  });

  test("a page of fields alone goes as what it prints, and a page that prints nothing does not", () => {
    const fm: FrontMatter = { title: "The Tide", contact: ["a@example.com", "555 0100"] };
    const pages = [
      { id: "blank", name: "Untitled Page", text: "" },
      // No source and no draft date: nothing to print.
      { id: "empty", name: "Source", text: file("{source}", "", "{draftDate}") },
      { id: "contact", name: "Contact", text: file("{contact}") },
    ];
    expect(backPagesAsFountain(pages, fm)).toBe(
      [BACK_PAGES_OPEN, "===", "!a@example.com\n555 0100", BACK_PAGES_CLOSE].join("\n\n"),
    );
    // With no page that prints, and with none at all, the file is the script as it is written.
    expect(backPagesAsFountain(pages.slice(0, 2), fm)).toBe("");
    const script = serialize({ frontMatter: fm, doc: BODY });
    expect(fountainWithPages({ frontMatter: fm, doc: BODY }, [], pages.slice(0, 2))).toBe(script);
    expect(fountainWithPages({ frontMatter: fm, doc: BODY }, [], [])).toBe(script);
    expect(fountainWithPages({ frontMatter: fm, doc: BODY }, [])).toBe(script);
  });

  test("a script with no title page and no page before it still ends with its pages", () => {
    const fm: FrontMatter = { backPages: [THANKS] };
    const out = fountainWithPages(
      { frontMatter: fm, doc: BODY },
      frontPageList(fm),
      backPageList(fm),
    );
    const script = serialize({ frontMatter: {}, doc: BODY });
    expect(out.startsWith(script.trimEnd())).toBe(true);
    expect(out.endsWith(`\n\n${BACK_PAGES_CLOSE}\n`)).toBe(true);
    expect(parse(out).frontMatter).toEqual({});
  });
});
