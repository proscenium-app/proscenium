// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Add Page gallery's scaffolds (src/layout/scaffolds.ts): each writes a
 * page file that reads back as it was written and lays out under every
 * built-in format without printing a marker or a field's braces; a characters
 * page names the speakers in the order they enter, as Cast reads names back
 * from a page; and a new page lands where published plays put it.
 */
import { describe, expect, it } from "bun:test";
import { builtinFormats } from "../format";
import type { FrontMatter } from "../fountain/model";
import { openingParagraphs } from "./opening-prose";
import {
  TITLE_PAGE_FILE,
  namesOnPages,
  readPageFile,
  writePageFile,
  type PageLayout,
} from "./page-files";
import {
  SCAFFOLDS,
  SCAFFOLD_PLACES,
  landsAt,
  pageAlready,
  pageName,
  pageSheet,
  retemplate,
  scaffoldById,
  scaffoldOf,
  scaffoldSheet,
  sideOf,
  type Scaffold,
  type ScaffoldId,
} from "./scaffolds";

const ctx = { speakers: ["MARA", "JONAH", "OLD WOMAN"] };
const details: FrontMatter = {
  title: "Water",
  authors: ["A. Writer"],
  contact: ["a@example.com", "", "Agent"],
  draftDate: "June 2026",
};
const dg = builtinFormats().find((spec) => spec.id === "dg-modern")!;
const scaffold = (id: ScaffoldId): Scaffold => scaffoldById(id)!;
const body = (id: ScaffoldId, speakers: readonly string[] = ctx.speakers) =>
  readPageFile(scaffold(id).text({ speakers })).body;
/** A play's pages as the binder lists them: a name, and a layout (a page from the top unless said). */
const pages = (...list: (string | [string, PageLayout])[]) =>
  list.map((page) =>
    typeof page === "string"
      ? { name: page, layout: "top" as const }
      : { name: page[0], layout: page[1] },
  );

describe("the scaffolds", () => {
  it("are listed by where each page goes, before the script or after it, each with a name and a sentence of its own", () => {
    expect(SCAFFOLD_PLACES.map((g) => g.label)).toEqual([
      "Before the script",
      "After the script",
      "Either",
    ]);
    expect(SCAFFOLDS.map((s) => `${s.place}: ${s.name}`)).toEqual([
      "front: Title Page",
      "front: Dedication",
      "front: Epigraph",
      "front: Contents",
      "front: Characters",
      "front: Characters & Setting",
      "front: Setting",
      "front: A Note on the Text",
      "front: Musical Numbers",
      "back: Production Notes",
      "back: Production History",
      "back: Author's Note",
      "back: About the Author",
      "back: Acknowledgments",
      "back: Glossary",
      "either: Blank Page",
    ]);
    // Listed in the groups' own order, so the list reads straight down.
    const order = SCAFFOLD_PLACES.map((g) => g.id);
    expect(SCAFFOLDS.map((s) => order.indexOf(s.place))).toEqual(
      [...SCAFFOLDS.map((s) => order.indexOf(s.place))].sort((a, b) => a - b),
    );
    // A page that goes either way goes before the script until told otherwise.
    expect(sideOf(scaffold("blank"))).toBe("front");
    expect(sideOf(scaffold("glossary"))).toBe("back");
    expect(sideOf(scaffold("dedication"))).toBe("front");
    expect(new Set(SCAFFOLDS.map((s) => s.id)).size).toBe(SCAFFOLDS.length);
    expect(new Set(SCAFFOLDS.map((s) => s.description)).size).toBe(SCAFFOLDS.length);
    for (const s of SCAFFOLDS) expect(s.description).toMatch(/^[A-Z].*\.$/);
  });

  it("each write a page file that reads back as it was written", () => {
    const layouts: Record<string, PageLayout> = {};
    for (const s of SCAFFOLDS)
      for (const speakers of [ctx.speakers, []]) {
        const file = s.text({ speakers });
        const read = readPageFile(file);
        expect(writePageFile(read, read.body)).toBe(file);
        layouts[s.id] = read.layout;
      }
    expect(layouts).toEqual({
      "title-page": "title",
      "characters-setting": "top",
      characters: "top",
      "note-on-text": "top",
      setting: "top",
      dedication: "third",
      epigraph: "third",
      contents: "top",
      "authors-note": "top",
      "production-notes": "top",
      "production-history": "top",
      "musical-numbers": "top",
      "about-the-author": "top",
      acknowledgments: "top",
      glossary: "top",
      blank: "top",
    });
  });

  it("start a title page as the play's fields have always printed it", () => {
    expect(scaffold("title-page").text(ctx)).toBe(TITLE_PAGE_FILE);
  });

  it("leave Production Notes out of an export until it is ticked, and nothing else", () => {
    expect(SCAFFOLDS.filter((s) => !readPageFile(s.text(ctx)).exports).map((s) => s.id)).toEqual([
      "production-notes",
    ]);
  });

  it("head each page with its centered heading and write no words of their own", () => {
    const headings: Record<string, [string, boolean, string][]> = {};
    for (const s of SCAFFOLDS)
      if (s.id !== "title-page")
        headings[s.id] = openingParagraphs(body(s.id, []))
          .filter((p) => p.text)
          .map((p) => [p.text, p.heading, p.align]);
    // A page with no heading has no words at all: a blank page is nothing in
    // its file, and a dedication's and an epigraph's lines are in theirs as
    // how they are set, waiting for words.
    expect(body("blank").trim()).toBe("");
    expect(body("dedication").trim()).toBe("<!-- proscenium:line=center -->");
    expect(body("epigraph").trim()).toBe(
      "<!-- proscenium:line=center -->\n\n<!-- proscenium:line=right -->",
    );
    expect(openingParagraphs(body("dedication")).map((p) => [p.text, p.align])).toEqual([
      ["", "center"],
    ]);
    expect(openingParagraphs(body("epigraph")).map((p) => [p.text, p.align])).toEqual([
      ["", "center"],
      ["", "right"],
    ]);
    expect(headings).toEqual({
      "characters-setting": [
        ["CHARACTERS", true, "center"],
        ["SETTING", true, "center"],
      ],
      characters: [["CHARACTERS", true, "center"]],
      "note-on-text": [["A NOTE ON THE TEXT", true, "center"]],
      setting: [["SETTING", true, "center"]],
      dedication: [],
      epigraph: [],
      // The contents are a field that follows the script, not words of the page's own.
      contents: [
        ["CONTENTS", true, "center"],
        ["{contents}", false, "left"],
      ],
      "authors-note": [["AUTHOR'S NOTE", true, "center"]],
      "production-notes": [["PRODUCTION NOTES", true, "center"]],
      "production-history": [["PRODUCTION HISTORY", true, "center"]],
      "musical-numbers": [["MUSICAL NUMBERS", true, "center"]],
      "about-the-author": [["ABOUT THE AUTHOR", true, "center"]],
      acknowledgments: [["ACKNOWLEDGMENTS", true, "center"]],
      glossary: [["GLOSSARY", true, "center"]],
      blank: [],
    });
  });

  it("list the speakers on a characters page in the order they enter, each once and in bold", () => {
    expect(openingParagraphs(body("characters-setting")).map((p) => [p.text, p.align])).toEqual([
      ["CHARACTERS", "center"],
      ["MARA", "left"],
      ["JONAH", "left"],
      ["OLD WOMAN", "left"],
      ["SETTING", "center"],
    ]);
    const speakers = ["MARA", "  JONAH ", "", "Mara", "STAR*", "_HE_", "1. GUARD"];
    for (const id of ["characters", "characters-setting"] as const) {
      // Cast reads a page's names from its paragraphs that begin in bold.
      expect(namesOnPages([{ id: "p", name: "Characters", text: body(id, speakers) }])).toEqual([
        "MARA",
        "JONAH",
        "STAR*",
        "_HE_",
        "1. GUARD",
      ]);
      for (const p of openingParagraphs(body(id, speakers)).filter((p) => !p.heading))
        expect(p.runs).toEqual([
          { start: 0, end: p.text.length, bold: true, italic: false, underline: false },
        ]);
    }
  });

  it("lay out under every built-in format, printing no marker and no field's braces", () => {
    for (const spec of builtinFormats())
      for (const s of SCAFFOLDS)
        for (const fm of [details, {}, null]) {
          const sheet = scaffoldSheet(s, ctx, fm, spec);
          for (const line of sheet?.lines ?? []) {
            expect(line.text).not.toContain("<!--");
            expect(line.text).not.toMatch(/\{[A-Za-z]+\}/);
          }
        }
  });

  it("draw the page with the play's details in its fields, a page with no words yet with a line of what goes on it, and nothing for a blank page", () => {
    const words = (id: ScaffoldId, fm: FrontMatter = details) =>
      scaffoldSheet(scaffold(id), ctx, fm, dg)?.lines.map((line) => line.text) ?? null;
    expect(words("title-page")).toEqual([
      "WATER",
      "by",
      "A. Writer",
      "a@example.com",
      "Agent",
      "June 2026",
    ]);
    expect(words("characters")).toEqual(["CHARACTERS", "MARA", "JONAH", "OLD WOMAN"]);
    // The picture, never the page: what a dedication's file starts as holds no word.
    expect(words("dedication")).toEqual(["For someone"]);
    expect(words("epigraph")).toEqual(["A line you want before the play", "Its source"]);
    expect(words("blank")).toBeNull();
    const dedication = scaffoldSheet(scaffold("dedication"), ctx, details, dg)!;
    expect(dedication.lines[0]!.align).toBe("center");
    expect(dedication.lines[0]!.row).toBeGreaterThan(dg.frontMatter.sectionTopRows);
    // The play's own pages are not the page being drawn.
    expect(
      words("setting", { ...details, pages: [{ id: "p", name: "Mine", text: "Mine." }] }),
    ).toEqual(["SETTING", "Where and when the play happens"]);
    // A characters page with no one speaking yet is pictured with what goes on it.
    expect(
      scaffoldSheet(scaffold("characters"), { speakers: [] }, details, dg)?.lines.map(
        (l) => l.text,
      ),
    ).toEqual(["CHARACTERS", "Each character, with a few words about them"]);
    const title = scaffoldSheet(scaffold("title-page"), ctx, details, dg)!;
    expect(title.kind).toBe("title");
    expect(title.lines[0]!.row).toBeGreaterThan(dg.frontMatter.sectionTopRows);
  });
});

describe("a new page", () => {
  it("lands first in a play with no pages", () => {
    for (const s of SCAFFOLDS) expect(landsAt(s.id, [])).toBe(0);
  });

  it("lands where published plays put it, among today's pages written as files", () => {
    const play = pages(["Title Page", "title"], "Characters", "Opening Notes", "Production Notes");
    const at = Object.fromEntries(SCAFFOLDS.map((s) => [s.id, landsAt(s.id, play)]));
    expect(at).toEqual({
      "title-page": 1,
      dedication: 1,
      epigraph: 1,
      contents: 1,
      "production-history": 1,
      characters: 2,
      "characters-setting": 2,
      setting: 2,
      "note-on-text": 2,
      "authors-note": 4,
      "production-notes": 4,
      "musical-numbers": 4,
      "about-the-author": 4,
      acknowledgments: 4,
      glossary: 4,
      blank: 4,
    });
  });

  it("is marked when the play has that page already: its title page by its layout, any other by its name", () => {
    const play = [
      { id: "t", name: "Cover", text: writePageFile({ layout: "title" }, "# {TITLE}") },
      { id: "c", name: "characters", text: "## CHARACTERS\n" },
      { id: "n", name: "Opening Notes", text: "Notes.\n" },
    ];
    // The play's title page, whatever its file is called: there is one, and Add Page shows it.
    expect(pageAlready(scaffold("title-page"), play)).toEqual({ id: "t", name: "Cover" });
    expect(pageAlready(scaffold("characters"), play)).toEqual({ id: "c", name: "characters" });
    expect(pageAlready(scaffold("dedication"), play)).toBeNull();
    // A page named as a title page is one, though it is laid out as any page.
    expect(
      pageAlready(scaffold("title-page"), [{ id: "x", name: "Title Page", text: "Words.\n" }]),
    ).toEqual({ id: "x", name: "Title Page" });
    // A blank page is never the page a play "has".
    expect(pageAlready(scaffold("blank"), [{ id: "b", name: "Blank Page", text: "" }])).toBeNull();
    expect(pageAlready(scaffold("title-page"), [])).toBeNull();
  });

  it("lands after the pages convention puts before it, in a submission draft", () => {
    const play = pages(
      ["Title Page", "title"],
      ["Dedication", "third"],
      "Characters & Setting",
      "A Note on the Text",
      "Author's Note",
    );
    expect(landsAt("epigraph", play)).toBe(2);
    expect(landsAt("dedication", play)).toBe(2);
    expect(landsAt("production-history", play)).toBe(2);
    expect(landsAt("characters", play)).toBe(3);
    expect(landsAt("setting", play)).toBe(3);
    expect(landsAt("note-on-text", play)).toBe(4);
    expect(landsAt("musical-numbers", play)).toBe(5);
  });

  it("puts the title page first and the setting after the characters, wherever they were dragged", () => {
    const play = pages("Setting", "Cast of Characters", "Musical Numbers");
    expect(landsAt("title-page", play)).toBe(0);
    expect(landsAt("dedication", play)).toBe(0);
    expect(landsAt("characters", play)).toBe(2);
    expect(landsAt("setting", play)).toBe(2);
    expect(landsAt("note-on-text", play)).toBe(2);
    expect(landsAt("production-notes", play)).toBe(3);
  });

  it("takes a title page written freely, or one by another name, as the title page", () => {
    expect(landsAt("dedication", pages(["Title Page", "third"], "Characters"))).toBe(1);
    expect(landsAt("dedication", pages(["Cover", "title"], "Characters"))).toBe(1);
    expect(landsAt("dedication", pages(["Dedication", "third"], "Characters"))).toBe(1);
  });

  it("lands last from an id no scaffold has, as a blank page", () => {
    expect(landsAt("no-such-page", pages(["Title Page", "title"], "Characters"))).toBe(2);
  });

  it("takes the scaffold's name, or the next number free when a page has it", () => {
    expect(pageName("dedication", [])).toBe("Dedication");
    expect(pageName("characters-setting", ["Characters", "Setting"])).toBe("Characters & Setting");
    expect(pageName("title-page", ["Title Page"])).toBe("Title Page 2");
    expect(pageName("title-page", ["title page", "TITLE PAGE 2 ", "Title Page 4"])).toBe(
      "Title Page 3",
    );
    expect(pageName("no-such-page", ["Blank Page"])).toBe("Blank Page 2");
  });
});

describe("a page takes another template (docs/app/formatting/formats-and-layout.md#FMT-178)", () => {
  const made = (id: ScaffoldId) => ({ name: scaffold(id).name, text: scaffold(id).text(ctx) });
  const file = (text: string) => readPageFile(text);

  it("each scaffold's own page is known as that scaffold's", () => {
    for (const s of SCAFFOLDS)
      expect(scaffoldOf({ name: s.name, text: s.text(ctx) }).id).toBe(s.id);
  });

  it("a page the writer renamed is known by its layout and its headings", () => {
    expect(scaffoldOf({ name: "Front", text: TITLE_PAGE_FILE }).id).toBe("title-page");
    expect(scaffoldOf({ name: "Who", text: scaffold("characters").text(ctx) }).id).toBe(
      "characters",
    );
    expect(
      scaffoldOf({ name: "Who and where", text: scaffold("characters-setting").text(ctx) }).id,
    ).toBe("characters-setting");
    expect(
      scaffoldOf({ name: "For her", text: writePageFile({ layout: "third" }, "For M.") }).id,
    ).toBe("dedication");
    expect(
      scaffoldOf({ name: "Words", text: writePageFile({ layout: "top" }, "Anything.") }).id,
    ).toBe("blank");
  });

  it("a page with no words of the writer's is simply the new template's page", () => {
    const out = retemplate(made("dedication"), scaffold("epigraph"), ctx);
    expect(out).toEqual({ text: scaffold("epigraph").text(ctx), name: "Epigraph", kept: false });
    // A Characters page nobody has written on: its cast was the scaffold's.
    const cast = retemplate(
      { name: "Characters", text: scaffold("characters").text({ speakers: [] }) },
      scaffold("setting"),
      ctx,
    );
    expect(cast.kept).toBe(false);
    expect(cast.text).toBe(scaffold("setting").text(ctx));
  });

  it("the writer's words stay, under the new heading, where the new template sits on its sheet", () => {
    const page = {
      name: "Dedication",
      text: writePageFile(
        { layout: "third" },
        "<!-- proscenium:align=center -->\n\nFor M., who waited.",
      ),
    };
    const out = retemplate(page, scaffold("authors-note"), ctx);
    expect(out.kept).toBe(true);
    expect(out.name).toBe("Author's Note");
    expect(file(out.text).layout).toBe("top");
    const paras = openingParagraphs(file(out.text).body);
    expect(paras.map((p) => p.text)).toEqual(["AUTHOR'S NOTE", "For M., who waited."]);
    // Its line goes back to the format's own alignment: it was centered for the Dedication.
    expect(paras[1]?.align).not.toBe("center");
  });

  it("a blank page with words becomes a Dedication: centered, a third of the way down", () => {
    const page = {
      name: "Blank Page",
      text: writePageFile({ layout: "top" }, "For M.\n\nAnd for J."),
    };
    const out = retemplate(page, scaffold("dedication"), ctx);
    expect(file(out.text).layout).toBe("third");
    expect(openingParagraphs(file(out.text).body).map((p) => [p.text, p.align])).toEqual([
      ["For M.", "center"],
      ["And for J.", "center"],
    ]);
    const epigraph = retemplate(page, scaffold("epigraph"), ctx);
    expect(openingParagraphs(file(epigraph.text).body).map((p) => p.align)).toEqual([
      "center",
      "right",
    ]);
  });

  it("Characters becomes Characters & Setting: one heading for the cast, the words kept, Setting after them", () => {
    const page = {
      name: "Characters",
      text: writePageFile(
        { layout: "top" },
        "<!-- proscenium:align=center -->\n\n## CHARACTERS\n\n**MARA**, a hydrologist\n\n**JONAH**, her brother",
      ),
    };
    const out = retemplate(page, scaffold("characters-setting"), ctx, ["Title Page"]);
    expect(out.name).toBe("Characters & Setting");
    expect(openingParagraphs(file(out.text).body).map((p) => p.text)).toEqual([
      "CHARACTERS",
      "MARA, a hydrologist",
      "JONAH, her brother",
      "SETTING",
    ]);
    expect(namesOnPages([{ id: "c", name: "Characters & Setting", text: out.text }])).toEqual([
      "MARA",
      "JONAH",
    ]);
    // And it is known as that scaffold's from now on.
    expect(scaffoldOf({ name: out.name!, text: out.text }).id).toBe("characters-setting");
  });

  it("a name the writer gave the page is kept; a scaffold's name is numbered past the play's others", () => {
    const words = writePageFile({ layout: "top" }, "Thanks to the company.");
    expect(
      retemplate({ name: "For the Company", text: words }, scaffold("acknowledgments"), ctx).name,
    ).toBeNull();
    expect(
      retemplate({ name: "Blank Page 2", text: words }, scaffold("acknowledgments"), ctx, [
        "Acknowledgments",
      ]).name,
    ).toBe("Acknowledgments 2");
  });

  it("a title page that takes another template leaves its fields behind, and keeps what was written on it", () => {
    const text = TITLE_PAGE_FILE.replace("{author}", "{author}\n\nA play in two floods");
    const out = retemplate({ name: "Title Page", text }, scaffold("note-on-text"), ctx);
    expect(file(out.text).layout).toBe("top");
    expect(file(out.text).body).not.toContain("{");
    expect(openingParagraphs(file(out.text).body).map((p) => p.text)).toEqual([
      "A NOTE ON THE TEXT",
      "A play in two floods",
    ]);
  });

  it("a page becomes the title page with its words under the author and the foot after them", () => {
    const page = {
      name: "Blank Page",
      text: writePageFile({ layout: "top" }, "A play in two floods"),
    };
    const out = retemplate(page, scaffold("title-page"), ctx);
    expect(file(out.text).layout).toBe("title");
    expect(out.name).toBe("Title Page");
    const body = file(out.text).body;
    expect(body.indexOf("{author}")).toBeLessThan(body.indexOf("A play in two floods"));
    expect(body.indexOf("A play in two floods")).toBeLessThan(body.indexOf("{contact}"));
  });

  it("every change lays out in every built-in format, and prints no marker", () => {
    const page = {
      name: "Blank Page",
      text: writePageFile({ layout: "top" }, "Words of the writer's own."),
    };
    for (const spec of builtinFormats())
      for (const to of SCAFFOLDS) {
        const out = retemplate(page, to, ctx);
        const sheet = pageSheet(
          { id: "p", name: out.name ?? page.name, text: out.text },
          details,
          spec,
        );
        const printed = (sheet?.lines ?? []).map((l) => l.text).join("\n");
        expect(printed).toContain("Words of the writer's own.");
        expect(printed).not.toMatch(/proscenium:|\{[A-Za-z]+\}/);
      }
  });
});
