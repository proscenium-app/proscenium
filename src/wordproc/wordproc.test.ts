// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The .docx and .odt export (docs/app/formatting/formats-and-layout.md#FMT-D109):
 * the packages, the styles against the format, pagination
 * rules, headers and their sections or fields, the anonymous copy, the
 * language, and the round trip through the document importer.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DOMParser, type Element } from "@xmldom/xmldom";
import { unzipSync } from "fflate";

import dgModernRaw from "../../formats/dg-modern.json";
import traditionalRaw from "../../formats/dg-traditional.json";
import houseRaw from "../../formats/stage-us-modern.json";
import sketchRaw from "../../formats/sketch-comedy.json";
import ukRaw from "../../formats/stage-uk.json";
import { parse, textContent } from "../fountain";
import type { Doc, FrontMatter } from "../fountain/model";
import type { FormatSpec } from "../format";
import { validateFormatSpec } from "../format/validate";
import { readDocx, readOdt } from "../import/office";
import { EMPTY_CORRECTIONS, makeScript, reviewLines } from "../import/model";
import { anonymousFrontMatter, anonymousMeta } from "../pdf/anonymous";
import { obfuscateFont } from "./docx";
import type { FontFaces } from "./fonts";
import { buildDocument, writeScriptDocument, type DocumentType } from "./index";
import type { WpInput } from "./model";

function ttf(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../pdf/fonts/${name}`, import.meta.url))));
}

const FONTS: FontFaces = {
  regular: ttf("CourierPrime-Regular.ttf"),
  bold: ttf("CourierPrime-Bold.ttf"),
  italic: ttf("CourierPrime-Italic.ttf"),
  boldItalic: ttf("CourierPrime-BoldItalic.ttf"),
};

function spec(raw: unknown): FormatSpec {
  const v = validateFormatSpec(raw);
  if (!v.ok) throw new Error(v.errors.join("\n"));
  return v.spec;
}
const DG = spec(dgModernRaw);
const HOUSE = spec(houseRaw);
const SKETCH = spec(sketchRaw);
const TRADITIONAL = spec(traditionalRaw);
const UK = spec(ukRaw);

/** Every element the export has a style for, and the things it must leave out. */
const PLAY = `Title: The Tide Table
Credit: a play by
Author: Jo Marlowe
Contact: jo@example.com
Draft date: September 2026

# ACT ONE

## SCENE 1

= A synopsis nobody prints.

A kitchen at dawn. The *tap* drips. [[fix the tap cue]]

MARA
The pipe's been **crying** all night.

JONAH (V.O.)
(from the doorway)
You and that _pipe_.

~Row, row, row
~gently down the stream

> BLACKOUT.

>THE END<

/* a cut line */

## SCENE 2

MARA
Left.

JONAH ^
Right.

===

Morning.
`;

function play(text = PLAY): { doc: Doc; frontMatter: FrontMatter } {
  const parsed = parse(text);
  return { doc: parsed.doc, frontMatter: parsed.frontMatter };
}

function input(overrides: Partial<WpInput> = {}, text = PLAY): WpInput {
  const { doc, frontMatter } = play(text);
  return {
    doc,
    spec: DG,
    meta: { title: frontMatter.title ?? "Untitled", author: frontMatter.authors?.join(", ") ?? "", frontMatter },
    language: "en-US",
    ...overrides,
  };
}

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes);
}

function xmlOf(parts: Record<string, Uint8Array>, path: string): Element {
  const part = parts[path];
  if (!part) throw new Error(`no ${path} in the package`);
  let failed = "";
  const root = new DOMParser({ onError: (level, message) => { if (level !== "warning") failed = message; } })
    .parseFromString(new TextDecoder().decode(part), "application/xml").documentElement;
  if (failed || !root) throw new Error(`${path} is not well-formed: ${failed}`);
  return root as unknown as Element;
}

function all(node: Element, name: string): Element[] {
  return [...(node.getElementsByTagName(name) as unknown as Element[])];
}

function attr(node: Element | undefined, name: string): string {
  return node?.getAttribute(name) ?? "";
}

function docxStyle(parts: Record<string, Uint8Array>, name: string): Element {
  const found = all(xmlOf(parts, "word/styles.xml"), "w:style").find(
    (style) => attr(all(style, "w:name")[0], "w:val") === name,
  );
  if (!found) throw new Error(`no ${name} style`);
  return found;
}

function odtStyle(parts: Record<string, Uint8Array>, name: string): Element {
  const found = all(xmlOf(parts, "styles.xml"), "style:style").find((style) => attr(style, "style:display-name") === name);
  if (!found) throw new Error(`no ${name} style`);
  return found;
}

/** A play of `scenes` scenes, each long enough that most start partway down a page. */
function longPlay(acts: number, scenes: number): string {
  let text = "Title: Long\n\n";
  for (let a = 1; a <= acts; a++) {
    text += `# ACT ${["ONE", "TWO", "THREE"][a - 1]}\n\n`;
    for (let s = 1; s <= scenes; s++) {
      text += `## SCENE ${s}\n\n`;
      for (let i = 0; i < 9; i++) text += `MARA\nLine ${a}.${s}.${i}, which runs on long enough to take two lines of the page at the format's width.\n\n`;
    }
  }
  return text;
}

describe("the packages", () => {
  it("docs/app/formatting/formats-and-layout.md#FMT-D109: an .odt starts with its media type, stored, and lists every part it holds", () => {
    const bytes = writeScriptDocument("odt", input(), FONTS);
    // A local header's name starts at byte 30; the method is at byte 8 (0 = stored).
    expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe("mimetype");
    expect(bytes[8] | (bytes[9] << 8)).toBe(0);
    const parts = unzip(bytes);
    expect(new TextDecoder().decode(parts.mimetype)).toBe("application/vnd.oasis.opendocument.text");
    const manifest = all(xmlOf(parts, "META-INF/manifest.xml"), "manifest:file-entry").map((e) => attr(e, "manifest:full-path"));
    for (const path of Object.keys(parts)) {
      if (path === "mimetype" || path.startsWith("META-INF/")) continue;
      expect(manifest).toContain(path);
    }
    for (const path of ["content.xml", "styles.xml", "meta.xml"]) xmlOf(parts, path);
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-D109: a .docx declares every part it holds, and each is well-formed XML", () => {
    const parts = unzip(writeScriptDocument("docx", input(), FONTS));
    const types = xmlOf(parts, "[Content_Types].xml");
    const overrides = all(types, "Override").map((o) => attr(o, "PartName"));
    const defaults = all(types, "Default").map((d) => attr(d, "Extension"));
    for (const path of Object.keys(parts)) {
      const ext = path.split(".").pop()!;
      expect(overrides.includes(`/${path}`) || defaults.includes(ext)).toBe(true);
      if (ext === "xml" || ext === "rels") xmlOf(parts, path);
    }
    const rels = all(xmlOf(parts, "word/_rels/document.xml.rels"), "Relationship").map((r) => attr(r, "Target"));
    for (const target of rels) expect(parts[`word/${target}`]).toBeDefined();
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-153: the same play and choices make the same file", () => {
    for (const type of ["docx", "odt"] as DocumentType[]) {
      expect(writeScriptDocument(type, input(), FONTS)).toEqual(writeScriptDocument(type, input(), FONTS));
    }
  });
});

describe("styles from the format", () => {
  it("docs/app/formatting/formats-and-layout.md#FMT-146: each element is a style named as the element bar names it, with its column, capitals and emphasis", () => {
    const docx = unzip(writeScriptDocument("docx", input({ spec: HOUSE }), FONTS));
    const odt = unzip(writeScriptDocument("odt", input({ spec: HOUSE }), FONTS));
    for (const name of ["Act", "Scene", "Action", "Character", "Parenthetical", "Dialogue", "Transition", "Lyric", "Centered Text"]) {
      docxStyle(docx, name);
      odtStyle(odt, name);
    }
    // House: bold uppercase cues at 4 inches from the paper edge, 2.5 from the margin.
    const cue = docxStyle(docx, "Character");
    expect(attr(all(cue, "w:ind")[0], "w:left")).toBe(String(Math.round(HOUSE.elements.character.indentFromMargin * 1440)));
    expect(all(cue, "w:caps")).toHaveLength(1);
    expect(all(cue, "w:b")).toHaveLength(1);
    const odtCue = odtStyle(odt, "Character");
    expect(attr(all(odtCue, "style:paragraph-properties")[0], "fo:margin-left")).toBe(`${HOUSE.elements.character.indentFromMargin}in`);
    expect(attr(all(odtCue, "style:text-properties")[0], "fo:text-transform")).toBe("uppercase");
    // Capitals are the style's, so the words stay as typed.
    const content = new TextDecoder().decode(odt["content.xml"]);
    expect(content).toContain("Jonah".toUpperCase()); // typed in capitals
    expect(content).not.toContain("THE PIPE'S BEEN");
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-147: page, margins, type and pitch come from the format", () => {
    for (const format of [DG, spec({ ...dgModernRaw, id: "a4-test", page: { size: "a4", margins: { left: 1.25, top: 0.75, right: 0.5, bottom: 1.1 } }, type: { ...dgModernRaw.type, size: 11, lineHeight: 1.25 } })]) {
      const docx = unzip(writeScriptDocument("docx", input({ spec: format }), FONTS));
      const sect = all(xmlOf(docx, "word/document.xml"), "w:sectPr").pop()!;
      const size = all(sect, "w:pgSz")[0];
      const margins = all(sect, "w:pgMar")[0];
      const inches = format.page.size === "a4" ? { w: 8.27, h: 11.69 } : { w: 8.5, h: 11 };
      expect(attr(size, "w:w")).toBe(String(Math.round(inches.w * 1440)));
      expect(attr(size, "w:h")).toBe(String(Math.round(inches.h * 1440)));
      expect(attr(margins, "w:left")).toBe(String(Math.round(format.page.margins.left * 1440)));
      expect(attr(margins, "w:top")).toBe(String(Math.round(format.page.margins.top * 1440)));
      // The header sits where the format says unless its line would reach past the margin.
      const headerIn = Math.min(format.header.position, format.page.margins.top - format.type.size / 72);
      expect(attr(margins, "w:header")).toBe(String(Math.round(headerIn * 1440)));
      const defaults = xmlOf(docx, "word/styles.xml");
      expect(attr(all(defaults, "w:sz")[0], "w:val")).toBe(String(format.type.size * 2));
      const pitch = String(Math.round(format.type.size * format.type.lineHeight * 20));
      expect(attr(all(all(defaults, "w:pPrDefault")[0], "w:spacing")[0], "w:line")).toBe(pitch);
      expect(attr(all(all(defaults, "w:pPrDefault")[0], "w:spacing")[0], "w:lineRule")).toBe("exact");

      const odt = unzip(writeScriptDocument("odt", input({ spec: format }), FONTS));
      const layout = all(xmlOf(odt, "styles.xml"), "style:page-layout-properties")[0];
      expect(attr(layout, "fo:page-width")).toBe(`${inches.w}in`);
      expect(attr(layout, "fo:margin-left")).toBe(`${format.page.margins.left}in`);
    }
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-147: a style holds its space before; a paragraph whose engine gap differs carries its own", () => {
    const doc = buildDocument(input());
    const items = doc.sections.flatMap((s) => s.items);
    const paragraphs = items.filter((i) => i.kind === "p");
    // DG: a scene heading has two blank lines before it; after an act's one line after, still two.
    const scene = paragraphs.find((p) => p.kind === "p" && p.style === "scene")!;
    expect(scene.spaceBeforeRows).toBeUndefined();
    // The first speech's cue after a direction: max(1 after, 1 before) = its style's 1.
    const cue = paragraphs.find((p) => p.kind === "p" && p.style === "character")!;
    expect(cue.spaceBeforeRows).toBeUndefined();
    // A direction straight after the scene: max(scene's 1 after, action's 1 before) = 1, the style's.
    // A cue directly after the act heading in a format whose act has more space after than a cue before:
    const roomy = spec({ ...dgModernRaw, id: "roomy", elements: { ...dgModernRaw.elements, act: { ...dgModernRaw.elements.act, spacingAfter: 3 } } });
    const afterAct = buildDocument(input({ spec: roomy })).sections.flatMap((s) => s.items)
      .find((p) => p.kind === "p" && p.style === "scene");
    expect(afterAct && afterAct.kind === "p" && afterAct.spaceBeforeRows).toBe(3);
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-148: the format's page rules are style properties, not hard breaks", () => {
    const docx = unzip(writeScriptDocument("docx", input(), FONTS));
    expect(all(docxStyle(docx, "Act"), "w:pageBreakBefore")).toHaveLength(1);
    expect(all(docxStyle(docx, "Character"), "w:keepNext")).toHaveLength(1);
    expect(all(docxStyle(docx, "Character"), "w:keepLines")).toHaveLength(1);
    expect(attr(all(docxStyle(docx, "Dialogue"), "w:widowControl")[0], "w:val")).toBe("");
    expect(all(docxStyle(docx, "Dialogue"), "w:keepLines")).toHaveLength(0);
    // No page is broken where the engine broke one — only where the script or a style says.
    const body = xmlOf(docx, "word/document.xml");
    expect(all(body, "w:br").filter((br) => attr(br, "w:type") === "page")).toHaveLength(0);

    const odt = unzip(writeScriptDocument("odt", input(), FONTS));
    const dialogue = all(odtStyle(odt, "Dialogue"), "style:paragraph-properties")[0];
    expect(attr(dialogue, "fo:orphans")).toBe(String(DG.pagination.minDialogueLinesBeforeBreak));
    expect(attr(dialogue, "fo:widows")).toBe(String(DG.pagination.minDialogueLinesAfterBreak));
    expect(attr(all(odtStyle(odt, "Act"), "style:paragraph-properties")[0], "fo:break-before")).toBe("page");
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-148: a page break in the script is a page break, and a scene after its act does not start another", () => {
    const pagey = spec({ ...dgModernRaw, id: "pagey", elements: { ...dgModernRaw.elements, scene: { ...dgModernRaw.elements.scene, startsNewPage: true } } });
    const items = buildDocument(input({ spec: pagey })).sections.flatMap((s) => s.items);
    const scenes = items.filter((p) => p.kind === "p" && p.style === "scene");
    expect(scenes[0].kind === "p" && scenes[0].pageBreakBefore).toBe(false); // straight after ACT ONE
    expect(scenes[1].kind === "p" && scenes[1].pageBreakBefore).toBeUndefined(); // the style's own break
    const morning = items.find((p) => p.kind === "p" && p.inlines.some((i) => i.kind === "text" && i.text === "Morning."));
    expect(morning?.kind === "p" && morning.pageBreakBefore).toBe(true);
  });
});

describe("what goes in", () => {
  it("docs/app/formatting/formats-and-layout.md#FMT-155: notes, summaries and omitted text stay out; the words and emphasis go in", () => {
    for (const type of ["docx", "odt"] as DocumentType[]) {
      const parts = unzip(writeScriptDocument(type, input(), FONTS));
      const body = new TextDecoder().decode(parts[type === "docx" ? "word/document.xml" : "content.xml"]);
      expect(body).not.toContain("fix the tap cue");
      expect(body).not.toContain("synopsis nobody prints");
      expect(body).not.toContain("a cut line");
      expect(body).toContain("crying");
      expect(body).toContain("Row, row, row");
    }
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-149: a dual pair is one two-cell row, the left speech first", () => {
    const docx = unzip(writeScriptDocument("docx", input(), FONTS));
    const rows = all(xmlOf(docx, "word/document.xml"), "w:tr");
    expect(rows).toHaveLength(1);
    expect(all(rows[0], "w:cantSplit")).toHaveLength(1);
    // A cue in a cell keeps nothing with the next paragraph: a reader would
    // keep its whole row with the row below, and a scene of pairs would move
    // as one block.
    expect(all(rows[0], "w:keepNext").every((keep) => attr(keep, "w:val") === "0")).toBe(true);
    expect(all(rows[0], "w:keepNext").length).toBeGreaterThan(0);
    const cells = all(rows[0], "w:tc").map((c) => all(c, "w:t").map((t) => t.textContent).join(" "));
    expect(cells).toEqual(["MARA Left.", "JONAH Right."]);

    const odt = unzip(writeScriptDocument("odt", input(), FONTS));
    const odtCells = all(xmlOf(odt, "content.xml"), "table:table-cell").map((c) => c.textContent);
    expect(odtCells).toEqual(["MARALeft.", "JONAHRight."]);
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-147: a .docx breaks the page for a pair inside the table, and gives back the point a hairline takes", () => {
    const broken = unzip(writeScriptDocument("docx", input({ frontSheets: [] }, "MARA\nFirst.\n\n===\n\nMARA\nLeft.\n\nJONAH ^\nRight.\n"), FONTS));
    const body = xmlOf(broken, "word/document.xml");
    const cells = all(body, "w:tc");
    expect(all(all(cells[0], "w:p")[0], "w:pageBreakBefore")).toHaveLength(1);
    // No paragraph stands in front of the table to carry the break.
    const bodyChildren = [...(all(body, "w:body")[0].childNodes as unknown as Element[])].filter((n) => n.nodeType === 1);
    const table = bodyChildren.findIndex((n) => n.localName === "tbl");
    expect(all(bodyChildren[table - 1], "w:t").map((t) => t.textContent).join("")).toBe("First.");
    // A body that ends on a pair ends with a hairline, not a reader's whole blank line.
    const tail = bodyChildren[bodyChildren.length - 2];
    expect(tail.localName).toBe("p");
    expect(attr(all(tail, "w:spacing")[0], "w:line")).toBe("20");

    const numbered = spec({ ...dgModernRaw, id: "numbered", header: { ...dgModernRaw.header, content: { right: "{actRoman}-{sceneNumber}-{page}" } } });
    const pairThenScene = "# ACT ONE\n\n## SCENE 1\n\nMARA\nLeft.\n\nJONAH ^\nRight.\n\n## SCENE 2\n\nMARA\nOn.\n";
    const docx = xmlOf(unzip(writeScriptDocument("docx", input({ spec: numbered, frontSheets: [] }, pairThenScene), FONTS)), "word/document.xml");
    const scene2 = all(docx, "w:p").find((p) => p.textContent === "SCENE 2")!;
    // Scene 2's two blank lines, less the hairline's point that carries the section break above it.
    const pitch = Math.round(DG.type.size * DG.type.lineHeight * 20);
    expect(attr(all(scene2, "w:spacing")[0], "w:before")).toBe(String(DG.elements.scene.spacingBefore * pitch - 20));
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-150: the chosen front sheets come first, each kind on a new page, unnumbered", () => {
    const doc = buildDocument(input({ frontSheets: ["title", "characters"] }));
    expect(doc.sections[0].kind).toBe("front");
    expect(doc.sections[0].header).toBeNull();
    const front = doc.sections[0].items.filter((i) => i.kind === "p");
    expect(front[0].kind === "p" && front[0].style).toBe("title");
    expect(front[0].kind === "p" && front[0].align).toBe("center");
    // The title sits a third of the way down the sheet, as the engine put it.
    expect(front[0].kind === "p" && front[0].spaceBeforeRows).toBeGreaterThan(10);
    expect(doc.sections[1].begins).toBe("page");
    expect(buildDocument(input({ frontSheets: [] })).sections[0].kind).toBe("script");
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-148: a page break straight after an inline opening still breaks the page", () => {
    const doc = buildDocument(input({ spec: SKETCH }, "Title: Bits\nAuthor: Jo\n\n===\n\nMARA\nHello.\n"));
    const first = doc.sections[0].items.find((i) => i.kind === "p" && i.style === "character");
    expect(first?.kind === "p" && first.pageBreakBefore).toBe(true);
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-150: a front sheet the engine continued keeps its entries' gap", () => {
    const cast = Array.from({ length: 40 }, (_, i) => `ACTOR ${i + 1} - A person in the play with a long description of who they are.`).join("\n");
    const doc = buildDocument(input({ frontSheets: ["characters"] }, `Title: Crowd\nCharacters:\n${cast}\n\nMARA\nHi.\n`));
    const entries = doc.sections[0].items.filter((i) => i.kind === "p" && i.style === "castList");
    expect(entries.length).toBeGreaterThan(20);
    // Every entry after the first stands its format's gap from the one above,
    // on the engine's first sheet and on the one it continued onto.
    for (const entry of entries.slice(1)) expect(entry.kind === "p" && entry.spaceBeforeRows).toBe(DG.frontMatter.castGapRows);
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-150: an inline opening sits at the top of the first script page", () => {
    const doc = buildDocument(input({ spec: SKETCH }));
    expect(doc.sections[0].kind).toBe("script");
    const first = doc.sections[0].items[0];
    expect(first.kind === "p" && first.style).toBe("title");
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-145: an excerpt holds the words of those pages, numbered from the first", () => {
    const text = longPlay(1, 4);
    const whole = buildDocument(input({ frontSheets: [] }, text));
    const excerpt = buildDocument(input({ pages: [3], frontSheets: [] }, text));
    expect(excerpt.sections).toHaveLength(1);
    expect(excerpt.sections[0].firstPageNumber).toBe(3);
    expect(excerpt.sections[0].bareFirstPage).toBeUndefined();
    const words = (d: typeof whole) => d.sections.flatMap((s) => s.items).flatMap((i) => (i.kind === "p" ? [i] : [...i.left, ...i.right]))
      .map((p) => p.inlines.map((i) => (i.kind === "text" ? i.text : " ")).join(""));
    expect(words(excerpt).length).toBeLessThan(words(whole).length);
    expect(words(excerpt).join(" ")).not.toContain("Line 1.1.0");
    // Two runs of pages are two numbered stretches.
    const split = buildDocument(input({ pages: [1, 3], frontSheets: [] }, text));
    expect(split.sections.map((s) => s.firstPageNumber)).toEqual([1, 3]);
    expect(split.sections[1].begins).toBe("page");
  });
});

describe("headers and footers", () => {
  it("docs/app/formatting/formats-and-layout.md#FMT-151: {page} is the page-number field, and page 1 is bare where the format says", () => {
    const docx = unzip(writeScriptDocument("docx", input({ frontSheets: [] }), FONTS));
    const sect = all(xmlOf(docx, "word/document.xml"), "w:sectPr").pop()!;
    expect(all(sect, "w:titlePg")).toHaveLength(1);
    expect(attr(all(sect, "w:pgNumType")[0], "w:start")).toBe("1");
    const refs = all(sect, "w:headerReference");
    const byType = Object.fromEntries(refs.map((r) => [attr(r, "w:type"), attr(r, "r:id")]));
    const rels = Object.fromEntries(all(xmlOf(docx, "word/_rels/document.xml.rels"), "Relationship").map((r) => [attr(r, "Id"), attr(r, "Target")]));
    const header = new TextDecoder().decode(docx[`word/${rels[byType.default]}`]);
    expect(header).toContain('w:instr=" PAGE "');
    expect(header).toContain(">.<");
    expect(new TextDecoder().decode(docx[`word/${rels[byType.first]}`])).not.toContain("PAGE");

    const odt = unzip(writeScriptDocument("odt", input({ frontSheets: [] }), FONTS));
    const styles = xmlOf(odt, "styles.xml");
    const masters = Object.fromEntries(all(styles, "style:master-page").map((m) => [attr(m, "style:name"), m]));
    expect(all(masters.Script, "text:page-number")).toHaveLength(1);
    expect(all(masters.Script_20_First, "style:header")).toHaveLength(0);
    expect(attr(masters.Script_20_First, "style:next-style-name")).toBe("Script");
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-151: act-scene-page numbers change at each heading — a .docx section, an .odt field", () => {
    const numbered = spec({ ...dgModernRaw, id: "numbered", header: { ...dgModernRaw.header, content: { right: "{actRoman}-{sceneNumber}-{page}" } } });
    const doc = buildDocument(input({ spec: numbered }, longPlay(2, 3)));
    expect(doc.followsHeadings).toBe(true);
    // One section per act or scene; an act and the scene straight after it are one.
    const script = doc.sections.filter((s) => s.kind === "script");
    expect(script.map((s) => s.header!.right.join("#"))).toEqual(["I-1-#", "I-2-#", "I-3-#", "II-1-#", "II-2-#", "II-3-#"]);
    expect(script[3].begins).toBe("page"); // ACT TWO starts a page
    expect(script[1].begins).toBe("continuous");

    const docx = unzip(writeScriptDocument("docx", input({ spec: numbered, frontSheets: [] }, longPlay(2, 3)), FONTS));
    const headers = Object.keys(docx).filter((p) => /word\/header\d+\.xml/.test(p)).map((p) => new TextDecoder().decode(docx[p]));
    expect(headers.some((h) => h.includes(">II-2-<"))).toBe(true);
    expect(all(xmlOf(docx, "word/document.xml"), "w:sectPr")).toHaveLength(6);

    const odt = unzip(writeScriptDocument("odt", input({ spec: numbered }, longPlay(2, 3)), FONTS));
    const content = xmlOf(odt, "content.xml");
    const sets = all(content, "text:variable-set").filter((s) => attr(s, "text:name") === "hdr_right_0").map((s) => attr(s, "office:string-value"));
    expect(sets).toEqual(["I-1-", "I-2-", "I-3-", "II-1-", "II-2-", "II-3-"]);
    expect(all(xmlOf(odt, "styles.xml"), "text:variable-get").map((g) => attr(g, "text:name"))).toContain("hdr_right_0");
    // The fields print nothing in the text itself.
    expect(all(content, "text:variable-set").every((s) => !s.textContent && attr(s, "text:display") === "none")).toBe(true);
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-142: an empty act number takes its separator with it", () => {
    const numbered = spec({ ...dgModernRaw, id: "numbered", header: { ...dgModernRaw.header, content: { right: "{actRoman}-{sceneNumber}-{page}" } } });
    const oneAct = buildDocument(input({ spec: numbered }, "## SCENE 1\n\nMARA\nHi.\n\n## SCENE 2\n\nMARA\nBye.\n"));
    expect(oneAct.sections.map((s) => s.header!.right.join("#"))).toEqual(["1-#", "2-#"]);
  });
});

describe("the anonymous copy and the language", () => {
  it("docs/app/formatting/formats-and-layout.md#FMT-152: no byline, contact or author property", () => {
    const base = input();
    const meta = anonymousMeta(base.meta, "The Tide Table");
    const frontMatter = anonymousFrontMatter(base.meta.frontMatter, "The Tide Table");
    const withAuthor = spec({ ...dgModernRaw, id: "byline", header: { ...dgModernRaw.header, content: { left: "{author}", right: "{page}." } } });
    for (const type of ["docx", "odt"] as DocumentType[]) {
      const parts = unzip(writeScriptDocument(type, { ...base, spec: withAuthor, meta, frontMatter }, FONTS));
      const everything = Object.entries(parts)
        .filter(([path]) => /\.(xml|rels)$/.test(path))
        .map(([, bytes]) => new TextDecoder().decode(bytes))
        .join("");
      expect(everything).not.toContain("Jo Marlowe");
      expect(everything).not.toContain("jo@example.com");
      expect(everything).toContain("THE TIDE TABLE");
      const named = unzip(writeScriptDocument(type, { ...base, spec: withAuthor }, FONTS));
      const props = new TextDecoder().decode(named[type === "docx" ? "docProps/core.xml" : "meta.xml"]);
      expect(props).toContain("Jo Marlowe");
    }
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-153: the play's language is every style's and the file's", () => {
    const docx = unzip(writeScriptDocument("docx", input({ language: "fr-CA" }), FONTS));
    expect(attr(all(xmlOf(docx, "word/styles.xml"), "w:lang")[0], "w:val")).toBe("fr-CA");
    expect(new TextDecoder().decode(docx["docProps/core.xml"])).toContain("<dc:language>fr-CA</dc:language>");
    const odt = unzip(writeScriptDocument("odt", input({ language: "zh-Hant-TW" }), FONTS));
    const defaults = all(all(xmlOf(odt, "styles.xml"), "style:default-style")[0], "style:text-properties")[0];
    expect(attr(defaults, "fo:language")).toBe("zh");
    expect(attr(defaults, "fo:country")).toBe("TW");
    expect(attr(defaults, "fo:script")).toBe("Hant");
    expect(attr(defaults, "style:language-asian")).toBe("zh");
    expect(new TextDecoder().decode(odt["meta.xml"])).toContain("<dc:language>zh-Hant-TW</dc:language>");
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-153: headings carry outline levels for a reader's navigation", () => {
    const docx = unzip(writeScriptDocument("docx", input(), FONTS));
    expect(attr(all(docxStyle(docx, "Act"), "w:outlineLvl")[0], "w:val")).toBe("0");
    expect(attr(all(docxStyle(docx, "Scene"), "w:outlineLvl")[0], "w:val")).toBe("1");
    const odt = unzip(writeScriptDocument("odt", input(), FONTS));
    const levels = all(xmlOf(odt, "content.xml"), "text:h").map((h) => attr(h, "text:outline-level"));
    expect(levels).toEqual(["1", "2", "2"]);
  });
});

describe("type", () => {
  it("docs/app/formatting/formats-and-layout.md#FMT-154: both files carry the four faces; the .docx's are obfuscated with the keys its font table names", () => {
    const docx = unzip(writeScriptDocument("docx", input(), FONTS));
    const table = xmlOf(docx, "word/fontTable.xml");
    const font = all(table, "w:font").find((f) => attr(f, "w:name") === "Courier Prime")!;
    expect(attr(all(font, "w:altName")[0], "w:val")).toBe("Courier New");
    expect(attr(all(font, "w:pitch")[0], "w:val")).toBe("fixed");
    const rels = Object.fromEntries(all(xmlOf(docx, "word/_rels/fontTable.xml.rels"), "Relationship").map((r) => [attr(r, "Id"), attr(r, "Target")]));
    for (const [element, face] of [["w:embedRegular", "regular"], ["w:embedBold", "bold"], ["w:embedItalic", "italic"], ["w:embedBoldItalic", "boldItalic"]] as const) {
      const embed = all(font, element)[0];
      const stored = docx[`word/${rels[attr(embed, "r:id")]}`];
      // Obfuscation is its own inverse: undone with the same key, it is the font again.
      expect(obfuscateFont(stored, attr(embed, "w:fontKey"))).toEqual(FONTS[face]);
      expect(stored.slice(0, 32)).not.toEqual(FONTS[face].slice(0, 32));
    }
    const odt = unzip(writeScriptDocument("odt", input(), FONTS));
    expect(odt["Fonts/CourierPrime-Regular.ttf"]).toEqual(FONTS.regular);
    expect(all(xmlOf(odt, "styles.xml"), "svg:font-face-uri")).toHaveLength(4);
  });
});

/**
 * docs/app/formatting/formats-and-layout.md#FMT-156: export, import the file
 * with the document importer, and compare the play that comes back with the
 * one that went out, block by block.
 */
describe("the round trip through the importer", () => {
  const read = (type: DocumentType, bytes: Uint8Array) =>
    type === "docx" ? readDocx("Tide.docx", bytes) : readOdt("Tide.odt", bytes);

  /** Each printed block as (type, words), the way both plays can be compared. */
  const blocks = (doc: Doc) =>
    doc.content
      .filter((b) => !["synopsis", "boneyard", "pageBreak"].includes(b.type))
      .map((b) => ({
        type: b.type,
        text: textContent((b.content ?? []).filter((n) => n.type === "text")).replace(/\s+/g, " ").trim(),
      }))
      .filter((b) => b.text);

  const marksOf = (doc: Doc) =>
    doc.content.flatMap((b) => (b.content ?? []).flatMap((n) => (n.type === "text" && n.marks?.length ? [`${n.text}:${n.marks.map((m) => m.type).join("+")}`] : [])));

  for (const type of ["docx", "odt"] as DocumentType[]) {
    it(`a .${type} comes back as the same elements, words and emphasis, recognized from its styles`, () => {
      const source = input({ frontSheets: [] });
      const imported = read(type, writeScriptDocument(type, source, FONTS));
      const lines = reviewLines(imported, "detect", EMPTY_CORRECTIONS);
      // Every paragraph's element came from its style, not a guess.
      expect(lines.filter((line) => line.review).map((line) => line.style)).toEqual([]);
      const back = parse(makeScript(imported, "The Tide Table", "detect", EMPTY_CORRECTIONS));
      // A dual pair comes back one speech after the other.
      expect(blocks(back.doc)).toEqual(blocks(source.doc));
      expect(marksOf(back.doc)).toEqual(expect.arrayContaining(["crying:strong", "tap:em", "pipe:underline"]));
      expect(back.frontMatter.title).toBe("The Tide Table");
    });

    it(`a .${type} in a format that decorates returns the decoration as text, and a whole element's emphasis as emphasis`, () => {
      const back = (format: FormatSpec) => {
        const imported = read(type, writeScriptDocument(type, input({ spec: format, frontSheets: [] }), FONTS));
        return parse(makeScript(imported, "The Tide Table", "detect", EMPTY_CORRECTIONS)).doc.content;
      };
      // Traditional parenthesizes directions: the parentheses are printed text.
      const direction = back(TRADITIONAL).find((b) => b.type === "action")!;
      expect(textContent(direction.content ?? [])).toMatch(/^\(A kitchen at dawn\./);
      // The BBC cue's colon is printed text too — and the cue beside its
      // speech comes back as its own paragraph, still a cue.
      const cues = back(UK).filter((b) => b.type === "character").map((b) => textContent(b.content ?? []));
      expect(cues[0]).toBe("MARA:");
      // House cues are bold: their words come back bold.
      const cue = back(HOUSE).find((b) => b.type === "character")!;
      expect((cue.content ?? []).every((n) => n.type !== "text" || n.marks?.some((m) => m.type === "strong"))).toBe(true);
    });
  }
});
