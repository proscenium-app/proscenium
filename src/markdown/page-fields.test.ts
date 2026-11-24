// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page file through the Markdown bridge (doc.ts, `{ pageFile: true }`): its
 * field tokens are read as `field` nodes and its foot mark as a `foot` node,
 * each written back as exactly what it was read from, while a document that is
 * not a page file reads as it always did. The field names, the foot mark and
 * what each field shows are the layout's (src/layout/page-files.ts).
 */
import { describe, expect, test } from "bun:test";
import type { FrontMatter } from "../fountain/model";
import {
  FIELDS,
  FOOT_MARK as LAYOUT_FOOT_MARK,
  TITLE_PAGE_FILE,
  fieldValue,
  readPageFile,
} from "../layout/page-files";
import { toDoc, toMarkdown, type Node } from "./doc";
import { FIELD_NAMES, FOOT_MARK, fieldFace, fieldShows, type FieldValues } from "./page-fields";

const asPage = (src: string) => toDoc(src, { pageFile: true });
const round = (src: string) => toMarkdown(asPage(src));
const bold = [{ type: "bold" }];
const italic = [{ type: "italic" }];
const field = (name: string, marks?: Node["marks"]): Node => ({
  type: "field",
  attrs: { name },
  ...(marks ? { marks } : {}),
});
const text = (words: string, marks?: Node["marks"]): Node => ({
  type: "text",
  text: words,
  ...(marks ? { marks } : {}),
});
const para = (...content: Node[]): Node => ({ type: "paragraph", content });

const fm: FrontMatter = {
  title: "The Weight of Water",
  authors: ["A. Playwright", "B. Writer"],
  contact: ["12 Pier Road", "", "agent@example.com"],
  draftDate: "Third draft",
};

describe("the layout's own words", () => {
  test("the field names and the foot mark are the layout's", () => {
    expect([...FIELD_NAMES]).toEqual([...FIELDS]);
    expect(FOOT_MARK).toBe(LAYOUT_FOOT_MARK);
  });

  test("each field shows what the page prints for it", () => {
    const values: FieldValues = Object.fromEntries(
      FIELDS.map((name) => [name, fieldValue(name, fm)]),
    );
    for (const name of FIELD_NAMES) expect(fieldShows(name, values)).toBe(fieldValue(name, fm));
    // The credit defaults to "by", as the layout prints it.
    expect(fieldShows("credit", values)).toBe("by");
  });

  test("the title in capitals is the title, given either way", () => {
    expect(fieldShows("TITLE", { title: "The Weight of Water" })).toBe("THE WEIGHT OF WATER");
    expect(fieldShows("TITLE", { TITLE: "THE WEIGHT OF WATER" })).toBe("THE WEIGHT OF WATER");
    expect(fieldShows("TITLE", {})).toBe("");
  });
});

describe("what a field draws, and what a screen reader hears", () => {
  test("its value, each contact line under the last and a blank one a blank row", () => {
    expect(fieldFace("contact", { contact: "12 Pier Road\n\nagent@example.com" })).toEqual({
      lines: ["12 Pier Road", "", "agent@example.com"],
      empty: false,
      label: "Contact: 12 Pier Road, agent@example.com",
    });
    expect(fieldFace("author", { author: "A. Playwright" }).label).toBe("Author: A. Playwright");
  });

  test("with no value, a prompt for what goes there, and the capitals' in capitals", () => {
    expect(fieldFace("draftDate", {})).toEqual({
      lines: ["Draft date"],
      empty: true,
      label: "Draft Date: empty",
    });
    expect(fieldFace("author", {}).lines).toEqual(["Author's name"]);
    expect(fieldFace("contact", {}).lines).toEqual(["Contact details"]);
    expect(fieldFace("TITLE", {}).lines).toEqual(["TITLE"]);
    // Spaces print nothing a reader sees.
    expect(fieldFace("source", { source: "  " }).empty).toBe(true);
  });
});

describe("a page file round-trips", () => {
  test("the title page made from its fields comes back byte for byte", () => {
    const { body } = readPageFile(TITLE_PAGE_FILE);
    expect(round(body)).toBe(body);
    const doc = asPage(body);
    expect(doc.content?.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "foot",
      "paragraph",
      "paragraph",
    ]);
    expect(doc.content?.[0]).toEqual({
      type: "heading",
      attrs: { level: 1, textAlign: "center" },
      content: [field("TITLE")],
    });
    expect(doc.content?.[1]).toEqual({
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [field("credit")],
    });
  });

  test("fields mid-sentence, with bold and italic around them, in a centred paragraph", () => {
    const src = [
      "<!-- proscenium:align=center -->",
      "",
      "Adapted from **{source}** by _{author}_, {draftDate}.",
      "",
      "**written by {author}**",
      "",
    ].join("\n");
    expect(round(src)).toBe(src);
    expect(asPage(src).content?.[0]).toEqual({
      type: "paragraph",
      attrs: { textAlign: "center" },
      content: [
        text("Adapted from "),
        field("source", bold),
        text(" by "),
        field("author", italic),
        text(", "),
        field("draftDate"),
        text("."),
      ],
    });
    expect(asPage(src).content?.[1]).toEqual(
      para(text("written by ", bold), field("author", bold)),
    );
  });

  test("italics that end on a field before a letter still close", () => {
    const doc: Node = {
      type: "doc",
      content: [para(text("a "), field("title", italic), text("s own")), para(field("TITLE"))],
    };
    const file = toMarkdown(doc);
    expect(file).toBe("a *{title}*s own\n\n{TITLE}\n");
    expect(asPage(file)).toEqual(doc);
  });

  test("a field in a heading, in a list, and on either side of a line break", () => {
    const src = "# {TITLE}\n\n- {author}\n- {contact}\n\nSent {draftDate}\nfrom {source}\n";
    expect(round(src)).toBe(src);
    expect(asPage(src).content?.[2]).toEqual(
      para(
        text("Sent "),
        field("draftDate"),
        { type: "hardBreak" },
        text("from "),
        field("source"),
      ),
    );
  });

  test("the foot begins at its line even with no blank line around it, where the layout splits", () => {
    const src = `Third draft\n${FOOT_MARK}\n{contact}\n`;
    const doc = asPage(src);
    expect(doc.content).toEqual([
      para(text("Third draft")),
      { type: "foot" },
      para(field("contact")),
    ]);
    expect(round(src)).toBe(`Third draft\n\n${FOOT_MARK}\n\n{contact}\n`);
    expect(asPage(round(src))).toEqual(doc);
  });

  test("only the first foot mark is the foot; a later one prints as words, and reads as them", () => {
    const src = `{author}\n\n${FOOT_MARK}\n\n{contact}\n\n${FOOT_MARK}\n`;
    const doc = asPage(src);
    expect(doc.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "foot",
      "paragraph",
      "paragraph",
    ]);
    expect(doc.content?.[3]).toEqual(para(text(FOOT_MARK)));
    expect(round(src)).toBe(src);
  });

  test("a token in code is what was typed, and a word that is no field is a word", () => {
    expect(asPage("`{title}` and {director}").content?.[0]).toEqual(
      para(text("{title}", [{ type: "code" }]), text(" and {director}")),
    );
  });

  test("an escaped token is a field, since the layout prints it as one", () => {
    expect(asPage("\\{author\\}").content?.[0]).toEqual(para(field("author")));
  });
});

describe("a document that is not a page file", () => {
  test("keeps a token and the foot mark as the words they are", () => {
    const src = `Ask {title} about it.\n\n${FOOT_MARK}\n`;
    expect(toDoc(src)).toEqual({
      type: "doc",
      content: [para(text("Ask {title} about it.")), para(text(FOOT_MARK))],
    });
    expect(toDoc(src, { pageFile: false })).toEqual(toDoc(src));
    expect(toMarkdown(toDoc(src))).toBe(src);
  });

  test("a foot mark under a line stays that paragraph's second line", () => {
    expect(toDoc(`Draft\n${FOOT_MARK}`).content).toEqual([
      para(text("Draft"), { type: "hardBreak" }, text(FOOT_MARK)),
    ]);
  });
});
