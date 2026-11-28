// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page's components and their settings
 * (docs/app/formatting/formats-and-layout.md#FMT-183,
 * docs/app/formatting/formats-and-layout.md#FMT-184): what a component's
 * token says of how it is set and reads back, the contents with and without
 * a page beside each act, and the cast, everyone who speaks.
 */
import { describe, expect, it } from "bun:test";
import { builtinFormats } from "../format";
import { parse } from "../fountain";
import { toDoc, toMarkdown } from "../markdown/doc";
import {
  FIELD_TOKEN,
  fieldFace,
  fieldKey,
  fieldShows,
  fieldToken,
  readFieldOptions,
  writeFieldOptions,
} from "../markdown/page-fields";
import { contentsBothFor, contentsFor, listsCast, listsContents } from "./contents";
import { layoutFrontPages } from "./engine";
import { pagesAsFountain } from "./fountain-with-pages";
import { fieldValue, fillFields, frontPagesFor, namedOnPage, writePageFile } from "./page-files";

const dg = builtinFormats().find((spec) => spec.id === "dg-modern")!;

const printed = (text: string, fm: object) =>
  layoutFrontPages(
    frontPagesFor({ ...fm, pages: [{ id: "p", name: "Page", text }] }, dg.frontMatter),
    dg,
  ).flatMap((sheet) => sheet.lines.map((line) => line.text));

const PLAY = [
  "Title: The Tide Table",
  "",
  "# ACT ONE",
  "",
  "## Scene 1",
  "",
  "MARA",
  "Morning.",
  "",
  "## Scene 2",
  "",
  "JONAH",
  "Is it?",
  "",
  "# ACT TWO",
  "",
  "## Scene 1",
  "",
  "MARA",
  "Night.",
  "",
].join("\n");

describe("a component's settings, in its token", () => {
  it("are read after its name and written back in one order", () => {
    expect(readFieldOptions(" acts=plain")).toEqual({ acts: "plain" });
    expect(readFieldOptions("")).toEqual({});
    expect(writeFieldOptions({ scenes: "off", acts: "plain" })).toBe("acts=plain scenes=off");
    expect(fieldToken("contents")).toBe("{contents}");
    expect(fieldToken("contents", "acts=plain")).toBe("{contents acts=plain}");
    expect(fieldKey("contents", " acts=plain ")).toBe("contents acts=plain");
    expect(
      [..."a {contents acts=plain} b {cast} c".matchAll(FIELD_TOKEN)].map((m) => m[0]),
    ).toEqual(["{contents acts=plain}", "{cast}"]);
    // A token that is not a component's is the text it is.
    expect([..."{contents acts} {nothing} {contents =x}".matchAll(FIELD_TOKEN)]).toEqual([]);
  });

  it("stay with the component through the editor's document and back to the file", () => {
    const body = "## CONTENTS\n\n{contents acts=plain}\n";
    const doc = toDoc(body, { pageFile: true });
    expect(doc.content?.[1]?.content?.[0]).toEqual({
      type: "field",
      attrs: { name: "contents", options: "acts=plain" },
    });
    expect(toMarkdown(doc, { emptyLines: true, blankRows: true })).toBe(body);
    // One the app does not know is kept as it is written.
    const other = "{contents later=yes}\n";
    expect(toMarkdown(toDoc(other, { pageFile: true }), { emptyLines: true })).toBe(other);
    // A component as it comes has nothing after its name.
    expect(toDoc("{contents}\n", { pageFile: true }).content?.[0]?.content?.[0]).toEqual({
      type: "field",
      attrs: { name: "contents" },
    });
  });

  it("choose what the component shows where it is written", () => {
    const values = { contents: "ACT ONE . . 1", "contents acts=plain": "ACT ONE" };
    expect(fieldShows("contents", values)).toBe("ACT ONE . . 1");
    expect(fieldShows("contents", values, "acts=plain")).toBe("ACT ONE");
    // The component's own value where none is kept for its settings.
    expect(fieldShows("contents", { contents: "x" }, "acts=plain")).toBe("x");
    expect(fieldFace("contents", values, "acts=plain").label).toBe("Contents: ACT ONE");
  });
});

describe("the contents, with and without a page beside each act", () => {
  const { doc } = parse(PLAY);
  const both = contentsBothFor(doc, dg);

  it("come from one pagination, the same rows either way", () => {
    expect(both.lines).toEqual(contentsFor(doc, dg));
    expect(both.plainActs).toHaveLength(both.lines.length);
    expect(both.lines[0]).toMatch(/^ACT ONE .*\. 1$/);
    expect(both.plainActs[0]).toBe("ACT ONE");
    // A scene keeps its page, and the blank row between acts stands.
    expect(both.plainActs[1]).toBe(both.lines[1]);
    expect(both.plainActs[1]).toMatch(/^ {2}SCENE 1 .*\. 1$/);
    expect(both.plainActs.indexOf("")).toBe(both.lines.indexOf(""));
    expect(both.plainActs).toContain("ACT TWO");
  });

  it("print as the page's component is set", () => {
    const fm = { contents: both.lines, contentsPlainActs: both.plainActs };
    expect(fieldValue("contents", fm, "acts=plain")).toBe(both.plainActs.join("\n"));
    expect(fieldValue("contents", fm)).toBe(both.lines.join("\n"));
    const page = (token: string) => writePageFile({ layout: "top" }, `## CONTENTS\n\n${token}`);
    expect(printed(page("{contents}"), fm)[1]).toMatch(/^ACT ONE .*\. 1$/);
    expect(printed(page("{contents acts=plain}"), fm)[1]).toBe("ACT ONE");
    // Among other words, too.
    expect(
      fillFields("See {contents acts=plain}", [], { ...fm, contentsPlainActs: ["A"] }).text,
    ).toBe("See A");
    expect(listsContents([{ text: page("{contents acts=plain}") }])).toBe(true);
    expect(listsContents([{ text: page("{contents}") }])).toBe(true);
    expect(listsContents([{ text: page("{contentsx}") }])).toBe(false);
  });
});

describe("the cast, everyone who speaks", () => {
  const page = writePageFile(
    { layout: "top" },
    "<!-- proscenium:align=center -->\n\n## CHARACTERS\n\n**{cast}**",
  );

  it("prints a line for each, under one another, with the paragraph's own emphasis", () => {
    const sheet = layoutFrontPages(
      frontPagesFor(
        { cast: ["MARA", "JONAH"], pages: [{ id: "p", name: "Characters", text: page }] },
        dg.frontMatter,
      ),
      dg,
    )[0]!;
    expect(sheet.lines.map((line) => line.text)).toEqual(["CHARACTERS", "MARA", "JONAH"]);
    expect(sheet.lines[2]!.row - sheet.lines[1]!.row).toBe(1);
    expect(sheet.lines[1]!.runs).toEqual([
      { start: 0, end: 4, bold: true, italic: false, underline: false },
    ]);
    // Plain where the page writes it plain.
    const plain = printed(page.replace("**{cast}**", "{cast}"), { cast: ["MARA"] });
    expect(plain).toEqual(["CHARACTERS", "MARA"]);
  });

  it("prints nothing while no one speaks, heading and all", () => {
    expect(printed(page, {})).toEqual([]);
    expect(printed(page, { cast: [] })).toEqual([]);
    expect(pagesAsFountain([{ id: "p", name: "Characters", text: page }], {})).toBe("");
  });

  it("goes to a Fountain file as the names it prints", () => {
    const fountain = pagesAsFountain([{ id: "p", name: "Characters", text: page }], {
      cast: ["MARA", "JONAH"],
    });
    expect(fountain).toContain("> CHARACTERS <");
    expect(fountain).toContain("MARA");
    expect(fountain).not.toContain("{cast}");
  });

  it("names whoever speaks to Cast, and no one who does not", () => {
    expect(listsCast([{ text: page }])).toBe(true);
    expect(namedOnPage("MARA", page, true)).toBe(true);
    expect(namedOnPage("THE GHOST", page, false)).toBe(false);
    // A page written by hand names who it names, speaking or not.
    expect(namedOnPage("MARA", "**MARA**, a hydrologist", false)).toBe(true);
    expect(namedOnPage("JONAH", "**MARA**, a hydrologist", true)).toBe(false);
  });
});
