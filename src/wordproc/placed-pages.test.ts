// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page whose writer put its blocks where they wanted them
 * (docs/app/formatting/formats-and-layout.md#FMT-182), in a word processor's
 * file: a block at a cell is a paragraph indented by it, the rows a writer
 * left are space before the paragraph under them, and two blocks side by side
 * are a paragraph for each row they take, each block's words at a tab stop.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser, type Element } from "@xmldom/xmldom";
import { unzipSync } from "fflate";
import dgModernRaw from "../../formats/dg-modern.json";
import { parse } from "../fountain";
import { validateFormatSpec } from "../format/validate";
import type { FontFaces } from "./fonts";
import { buildDocument, writeScriptDocument } from "./index";
import type { WpInput, WpParagraph } from "./model";

function ttf(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../pdf/fonts/${name}`, import.meta.url))),
  );
}

const FONTS: FontFaces = {
  regular: ttf("CourierPrime-Regular.ttf"),
  bold: ttf("CourierPrime-Bold.ttf"),
  italic: ttf("CourierPrime-Italic.ttf"),
  boldItalic: ttf("CourierPrime-BoldItalic.ttf"),
};

const DG = (() => {
  const v = validateFormatSpec(dgModernRaw);
  if (!v.ok) throw new Error(v.errors.join("\n"));
  return v.spec;
})();

const PAGE = [
  "---",
  "layout: title",
  "---",
  "",
  "<!-- proscenium:align=right -->",
  "",
  "Draft 3",
  "",
  "<!-- proscenium:head -->",
  "",
  "<!-- proscenium:align=center -->",
  "",
  "# {TITLE}",
  "",
  "<!-- proscenium:place rows=4 cell=20 -->",
  "",
  "A line at a cell",
  "",
  "<!-- proscenium:foot -->",
  "",
  "Agent Name  ",
  "1 Example Street",
  "",
  "<!-- proscenium:place beside rows=1 -->",
  "",
  "<!-- proscenium:align=right -->",
  "",
  "**First** draft",
  "",
].join("\n");

function input(): WpInput {
  const { doc, frontMatter } = parse("Title: The Tide Table\n\nMARA\nMorning.\n");
  return {
    doc,
    spec: DG,
    meta: {
      title: frontMatter.title ?? "Untitled",
      author: "",
      frontMatter: { ...frontMatter, pages: [{ id: "title", name: "Title Page", text: PAGE }] },
    },
    language: "en-US",
  };
}

const wordsOf = (p: WpParagraph) =>
  p.inlines.map((i) => (i.kind === "text" ? i.text : i.kind === "tab" ? "\t" : "\n")).join("");

function xmlOf(parts: Record<string, Uint8Array>, path: string): Element {
  const part = parts[path];
  if (!part) throw new Error(`no ${path} in the package`);
  let failed = "";
  const root = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") failed = message;
    },
  }).parseFromString(new TextDecoder().decode(part), "application/xml").documentElement;
  if (failed || !root) throw new Error(`${path} is not well-formed: ${failed}`);
  return root as unknown as Element;
}

const all = (node: Element, name: string): Element[] => [
  ...(node.getElementsByTagName(name) as unknown as Element[]),
];

describe("a page whose blocks were placed, for a word processor", () => {
  const front = buildDocument(input()).sections[0]!;
  const paragraphs = front.items.flatMap((item) => (item.kind === "p" ? [item] : []));

  it("writes each block at its rows, a block at a cell indented by it", () => {
    expect(paragraphs.map(wordsOf)).toEqual([
      "Draft 3",
      "THE TIDE TABLE",
      "A line at a cell",
      "Agent Name",
      "1 Example Street\tFirst draft",
    ]);
    // The head from the top of the sheet; the title a third of the paper down.
    expect(paragraphs[0]).toMatchObject({ align: "right" });
    expect(paragraphs[0]!.spaceBeforeRows).toBeUndefined();
    expect(paragraphs[1]!.spaceBeforeRows).toBeCloseTo(12 + 1 / 3, 5);
    // Four rows the writer left, and the cell as an indent from the text block's left.
    expect(paragraphs[2]).toMatchObject({ align: "left" });
    expect(paragraphs[2]!.spaceBeforeRows).toBeCloseTo(4, 5);
    expect(paragraphs[2]!.indentIn).toBeCloseTo(2, 2);
  });

  it("writes two blocks side by side a row at a time, each at a tab stop", () => {
    const [first, second] = paragraphs.slice(3);
    expect(first!.tabs).toBeUndefined();
    expect(second!.inlines.map((i) => i.kind)).toEqual(["text", "tab", "text", "text"]);
    expect(second!.inlines[2]).toMatchObject({ text: "First", bold: true });
    expect(second!.tabs).toHaveLength(1);
    expect(second!.tabs![0]!.kind).toBe("right");
    expect(second!.tabs![0]!.atIn).toBeCloseTo(6, 1);
    // The second row follows the first with no space between.
    expect(second!.spaceBeforeRows).toBeUndefined();
  });

  it("a .docx says the indent and the tab stop, and is well formed", () => {
    const docx = unzipSync(writeScriptDocument("docx", input(), FONTS));
    const body = xmlOf(docx, "word/document.xml");
    const stops = all(body, "w:tab").filter((tab) => tab.getAttribute("w:pos"));
    expect(stops.map((tab) => tab.getAttribute("w:val"))).toEqual(["right"]);
    // Twenty cells of the format's type: a hair under two inches, in twips.
    const indents = all(body, "w:ind").map((ind) => Number(ind.getAttribute("w:left")));
    expect(indents.some((left) => Math.abs(left - 2880) <= 4)).toBe(true);
  });

  it("an .odt says them in the paragraphs' own styles", () => {
    const odt = unzipSync(writeScriptDocument("odt", input(), FONTS));
    const content = xmlOf(odt, "content.xml");
    const stops = all(content, "style:tab-stop");
    expect(stops.map((stop) => stop.getAttribute("style:type"))).toEqual(["right"]);
    expect(all(content, "text:tab")).toHaveLength(1);
    expect(
      all(content, "style:paragraph-properties").some(
        (props) =>
          Math.abs(Number.parseFloat(props.getAttribute("fo:margin-left") ?? "0") - 2) < 0.01,
      ),
    ).toBe(true);
  });

  it("an .rtf says them on the paragraphs", () => {
    const rtf = new TextDecoder().decode(writeScriptDocument("rtf", input(), null));
    expect(rtf).toMatch(/\\li28\d\d\\ri0[^\n]* A line at a cell\\par/);
    expect(rtf).toMatch(/\\tqr\\tx86\d\d[^\n]* 1 Example Street\\tab \{\\b First\} draft/);
  });
});
