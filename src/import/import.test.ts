// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { parse, textContent } from "../fountain";
import type { InlineNode } from "../fountain/model";
import { MAX_DOCUMENT_BYTES } from "../storage/read-limit";
import { encodeBytes, decodeBytes } from "../storage/import-bytes";
import { readDocument } from "./read";
import {
  EMPTY_CORRECTIONS,
  documentTitle,
  makeScript,
  paragraphText,
  reviewLines,
} from "./model";
import { guidance, SOURCE_GUIDES } from "./formats";
import { zipPackage } from "./package";
import { HARBOR, harborPackage, harborPages } from "../../scripts/pages-sample.mjs";

const w =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (text: string, style = "", props = "") =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r>${props}<w:t>${text}</w:t></w:r></w:p>`;
function docx(body: string, extra: Record<string, string> = {}) {
  return zipSync(
    Object.fromEntries(
      Object.entries({
        "word/document.xml": `<w:document ${w}><w:body>${body}</w:body></w:document>`,
        ...extra,
      }).map(([k, v]) => [k, strToU8(v)]),
    ),
  );
}
const script = (name: string, bytes: Uint8Array) => {
  const d = readDocument(name, bytes);
  return parse(makeScript(d, documentTitle(d), "detect", EMPTY_CORRECTIONS));
};

describe("document import preserves the writing", () => {
  test("Word styles, emphasis, Unicode, escaped text and unknown paragraphs survive", () => {
    const bytes = docx(
      p("ACT ONE", "Act") +
        p("Scene 1", "Scene") +
        p("MARA", "Character") +
        p(
          "Stay &amp; listen. Café.",
          "Dialogue",
          "<w:rPr><w:b/><w:i/></w:rPr>",
        ) +
        p("LIGHTS OUT", "Stage Directions"),
    );
    const out = script("Tide.docx", bytes);
    expect(out.doc.content.map((p) => p.type)).toEqual([
      "act",
      "scene",
      "character",
      "dialogue",
      "action",
    ]);
    expect(textContent(out.doc.content[3].content)).toBe(
      "Stay & listen. Café.",
    );
    expect(out.doc.content[3].content?.[0]).toMatchObject({
      marks: [{ type: "strong" }, { type: "em" }],
    });
    expect(textContent(out.doc.content[4].content)).toBe("LIGHTS OUT");
  });
  test("Word keeps current tracked text, table cells, text boxes and attached notes without duplication", () => {
    const bytes = docx(
      `<w:del>${p("DELETED")}</w:del><w:ins>${p("Inserted")}</w:ins><w:tbl><w:tr><w:tc>${p("Left")}</w:tc><w:tc>${p("Right")}</w:tc></w:tr></w:tbl><w:p><w:r><w:t>Outside</w:t><w:drawing><w:txbxContent>${p("Inside")}</w:txbxContent></w:drawing></w:r></w:p>`,
      {
        "word/comments.xml": `<w:comments ${w}><w:comment w:id="0">${p("Keep the pause.")}</w:comment></w:comments>`,
      },
    );
    const d = readDocument("Notes.docx", bytes);
    expect(d.paragraphs.map(paragraphText)).toEqual([
      "Inserted",
      "Left",
      "Right",
      "Outside",
      "Inside",
      "Comments from the original document",
      "Keep the pause.",
    ]);
    expect(d.notices.some((n) => n.includes("tracked deletions"))).toBe(true);
  });
  test("Word resolves friendly style names and inherited bold with an explicit off switch", () => {
    const bytes = docx(
      p("BOB", "Char") +
        p("Hello", "Dlg", '<w:rPr><w:b w:val="0"/><w:i/></w:rPr>'),
      {
        "word/styles.xml": `<w:styles ${w}><w:style w:styleId="Char"><w:name w:val="Character"/></w:style><w:style w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style><w:style w:styleId="Dlg"><w:name w:val="Dialogue"/><w:basedOn w:val="Base"/></w:style></w:styles>`,
      },
    );
    const out = script("Styles.docx", bytes);
    expect(out.doc.content[1].type).toBe("dialogue");
    expect(out.doc.content[1].content?.[0]).toMatchObject({
      marks: [{ type: "em" }],
    });
  });
  test("ODT retains styled script paragraphs and inline emphasis", () => {
    const bytes = zipSync({
      "content.xml": strToU8(
        `<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"><office:automatic-styles><style:style style:name="P1" style:parent-style-name="Character"/><style:style style:name="Em"><style:text-properties fo:font-style="italic"/></style:style></office:automatic-styles><office:body><office:text><text:p text:style-name="P1">MARA</text:p><text:p text:style-name="Dialogue">Stay <text:span text:style-name="Em">here</text:span>.</text:p></office:text></office:body></office:document-content>`,
      ),
    });
    const out = script("Tide.odt", bytes);
    expect(out.doc.content.map((p) => p.type)).toEqual([
      "character",
      "dialogue",
    ]);
    expect(textContent(out.doc.content[1].content)).toBe("Stay here.");
    expect(
      out.doc.content[1].content?.some(
        (n) => n.type === "text" && n.marks?.some((m) => m.type === "em"),
      ),
    ).toBe(true);
  });
  test("RTF handles group scopes, Unicode fallback, legacy characters and omitted images", () => {
    const d = readDocument(
      "Draft.rtf",
      strToU8(
        String.raw`{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Courier;}}ACT ONE\par MARA\par {\b Caf\'e9} and \u8212? silence. {\i Stay.}{\pict 010203}\par Literal \{braces\}.}`,
      ),
    );
    expect(d.paragraphs.map(paragraphText)).toEqual([
      "ACT ONE",
      "MARA",
      "Café and — silence. Stay.",
      "Literal {braces}.",
    ]);
    expect(d.paragraphs[2].content[0]).toMatchObject({
      text: "Café",
      marks: [{ type: "strong" }],
    });
  });
  test("FDX keeps basic emphasis, lyrics, unknown types and dual dialogue", () => {
    const d = readDocument(
      "Duet.fdx",
      strToU8(
        `<FinalDraft><Content><Paragraph Type="Act"><Text>ACT I</Text></Paragraph><DualDialogue><Paragraph Type="Character"><Text>MARA</Text></Paragraph><Paragraph Type="Dialogue"><Text Style="Italic">Hello.</Text></Paragraph><Paragraph Type="Character"><Text>IVAN</Text></Paragraph><Paragraph Type="Dialogue"><Text>Hello!</Text></Paragraph></DualDialogue><Paragraph Type="Lyrics"><Text>Sing.</Text></Paragraph><Paragraph Type="Custom"><Text>Something unusual.</Text></Paragraph></Content></FinalDraft>`,
      ),
    );
    const out = parse(makeScript(d, "Duet", "detect", EMPTY_CORRECTIONS));
    expect(out.doc.content.map((p) => p.type)).toEqual([
      "act",
      "character",
      "dialogue",
      "character",
      "dialogue",
      "lyric",
      "action",
    ]);
    expect(out.doc.content[3].attrs?.dual).toBe(true);
    expect(textContent(out.doc.content[6].content)).toBe("Something unusual.");
  });
  test("unchanged Fountain remains byte-for-byte, including title page and notes", () => {
    const text =
      "Title: Tide\nAuthor: A Writer\n\n# ACT ONE\n\n## Kitchen\n\nMARA\nHello. [[Note]]\n";
    const d = readDocument("Draft.fountain", strToU8(text));
    expect(makeScript(d, "Tide", "detect", EMPTY_CORRECTIONS)).toBe(text);
    const windowsText = text.replace(/\n/g, "\r\n");
    const windowsDoc = readDocument("Draft.fountain", strToU8(windowsText));
    expect(makeScript(windowsDoc, "Tide", "detect", EMPTY_CORRECTIONS)).toBe(
      windowsText,
    );
  });
  test("a correction to one paragraph takes precedence over a source-style rule", () => {
    const d = readDocument(
      "Draft.txt",
      strToU8("MARA\nHello.\nSome other line."),
    );
    const lines = reviewLines(d, "detect", {
      lines: { 0: "character", 1: "dialogue" },
      styles: { Unstyled: "action" },
    });
    expect(lines.map((p) => p.kind)).toEqual([
      "character",
      "dialogue",
      "action",
    ]);
    expect(lines.every((p) => !p.review)).toBe(true);
    expect(
      reviewLines(d, "directions", EMPTY_CORRECTIONS).every(
        (p) => p.kind === "action",
      ),
    ).toBe(true);
  });
  test("binary source round trip includes non-UTF8 bytes", () => {
    const bytes = new Uint8Array([0, 255, 128, 13, 10, 42]);
    expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes);
  });
});

describe("unreadable imports give an actionable refusal before writing", () => {
  test("proprietary source apps have specific export guidance", () => {
    for (const ext of [
      "doc",
      "gdoc",
      "scriv",
      "scrivx",
      "wdz",
      "pdf",
    ]) {
      expect(guidance(`Draft.${ext}`)).toBeTruthy();
      expect(() => readDocument(`Draft.${ext}`, new Uint8Array())).toThrow();
    }
  });
  test("malformed XML, entity declarations, incomplete RTF, empty and binary text fail", () => {
    for (const [name, text] of [
      ["x.fdx", "<FinalDraft><Content></FinalDraft>"],
      [
        "x.fdx",
        '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><FinalDraft/>',
      ],
      ["x.rtf", String.raw`{\rtf1 missing end`],
      ["x.txt", ""],
      ["x.txt", "a\0b"],
    ])
      expect(() => readDocument(name, strToU8(text))).toThrow();
    expect(() =>
      readDocument("x.docx", zipSync({ "unrelated.xml": strToU8("hello") })),
    ).toThrow();
  });
  test("input bytes and expanded ZIP members are bounded before parsing", () => {
    expect(() =>
      readDocument("large.txt", new Uint8Array(MAX_DOCUMENT_BYTES + 1)),
    ).toThrow("16 MiB");
    const bytes = zipSync({
      "word/document.xml": new Uint8Array(MAX_DOCUMENT_BYTES + 1),
    });
    expect(() => readDocument("bomb.docx", bytes)).toThrow("too large");
  });
});

/*
 * Pages (docs/app/importing/document-import.md#IMPT-92). The real
 * document is Apache Tika's testPages2013.pages (Apache-2.0, REUSE.toml). The
 * others are built here field by field, each the smallest archive that shows
 * one behaviour, on the layout the real files have.
 */
const tika = () => new Uint8Array(readFileSync(join(import.meta.dir, "fixtures/testPages2013.pages")));
const TIKA_TEXT = [
  "Sample pages document",
  "Some plain text to parse.",
  "Column one",
  "Column two",
  "Column three",
  "Cell one",
  "Cell two",
  "Cell three",
  "Cell four",
  "Cell five",
  "Cell six",
  "Cell seven",
  "Cell eight",
  "Cell nine",
];

type Field = [no: number, value: number | string | Uint8Array | Field[]];
const varint = (n: number) => {
  const out: number[] = [];
  do {
    const b = n % 128;
    n = Math.floor(n / 128);
    out.push(n ? b | 128 : b);
  } while (n);
  return out;
};
function pb(fields: Field[]): Uint8Array {
  const out: number[] = [];
  for (const [no, v] of fields) {
    if (typeof v === "number") out.push(...varint(no * 8), ...varint(v));
    else {
      const b = typeof v === "string" ? strToU8(v) : v instanceof Uint8Array ? v : pb(v);
      out.push(...varint(no * 8 + 2), ...varint(b.length), ...b);
    }
  }
  return new Uint8Array(out);
}
const ref = (id: number): Field[] => [[1, id]];
/** Objects as one `.iwa` chunk: Snappy of literals only, which is valid Snappy. */
function iwa(objects: [id: number, type: number, body: Field[]][]): Uint8Array {
  const stream: number[] = [];
  for (const [id, type, body] of objects) {
    const data = pb(body);
    const info = pb([[1, id], [2, [[1, type], [3, data.length]]]]);
    stream.push(...varint(info.length), ...info, ...data);
  }
  const block = [...varint(stream.length)];
  for (let i = 0; i < stream.length; i += 60) {
    const piece = stream.slice(i, i + 60);
    block.push((piece.length - 1) << 2, ...piece);
  }
  return new Uint8Array([0, block.length & 255, (block.length >> 8) & 255, block.length >> 16, ...block]);
}
/** A run table: where each run starts, and the object it applies (none clears it). */
const runs = (entries: [at: number, id?: number][]): Field[] =>
  entries.map(([at, id]) => [1, [[1, at], ...(id ? [[2, ref(id)] as Field] : [])]]);
const style = (id: number, type: 2021 | 2022, name: string | null, parent: number | null, marks: Field[] = []) =>
  [id, type, [[1, [...(name ? [[1, name] as Field] : []), ...(parent ? [[3, ref(parent)] as Field] : [])]], ...(marks.length ? [[11, marks] as Field] : [])]] as [number, number, Field[]];
/** A document whose body is `text`, with `body` fields and any `more` objects. */
const pagesDoc = (text: string, body: Field[], more: [number, number, Field[]][] = [], doc: Field[] = []) =>
  zipSync({ "Index/Document.iwa": iwa([[1, 10000, [[4, ref(2)], ...doc]], [2, 2001, [[1, 0], [3, text], ...body]], ...more]) });
const texts = (d: { paragraphs: Parameters<typeof paragraphText>[0][] }) => d.paragraphs.map(paragraphText);
/** A paragraph's runs as [text, marks joined by +]. */
const runsOf = (p: { content: InlineNode[] }) =>
  p.content.map((n) => (n.type === "text" ? [n.text, (n.marks ?? []).map((m) => m.type).join("+")] : ["", ""]));

describe("a Pages document imports directly", () => {
  test("a real Pages document: every paragraph, its table row by row, and its text box", () => {
    const d = readDocument("testPages2013.pages", tika());
    expect(d.format).toBe("Pages");
    const body = texts(d);
    expect(body.slice(0, TIKA_TEXT.length)).toEqual(TIKA_TEXT);
    expect(body.slice(TIKA_TEXT.length, -2).map((t) => t.slice(0, 24))).toEqual([
      "Both Pages 1.x and Keyno",
      "Because Keynote uses an ",
      "The Keynote APXL file is",
      "Similarly, understanding",
      "A second page....",
      "Extensible Markup Langua",
    ]);
    // A text box placed on the page follows the body, under a heading.
    expect(body.slice(-2)).toEqual(["Text boxes from the original document", "A text box with text."]);
    // A style entry without a style keeps the one before it: every body
    // paragraph after the table is in the varied "Free Form" the source used.
    expect(d.paragraphs[14].style).toBe("Free Form");
    expect(d.paragraphs[0].style).toBe("Body");
    expect(d.notices.some((n) => n.includes("row order"))).toBe(true);
    expect(d.notices.some((n) => n.includes("Text boxes and tables placed on the page"))).toBe(true);
  });

  test("a package, zipped whole the way the web view and Finder hand it over, reads the same", () => {
    const flat = texts(readDocument("Draft.pages", tika()));
    const parts = unzipSync(tika());
    const index = zipSync(Object.fromEntries(Object.entries(parts).filter(([n]) => n.startsWith("Index/"))), { level: 0 });
    const withParent = zipSync({
      "Draft.pages/Index.zip": index,
      "Draft.pages/Metadata/Properties.plist": strToU8("<plist/>"),
      "__MACOSX/Draft.pages/._Index.zip": new Uint8Array([0, 5, 22, 7]),
    });
    const d = readDocument("Draft.pages.zip", withParent);
    expect(texts(d)).toEqual(flat);
    expect(documentTitle(d)).toBe("Draft");
    expect(texts(readDocument("Draft.pages", zipSync({ "Index.zip": index })))).toEqual(flat);
    // A single-file document compressed on its own.
    expect(texts(readDocument("Draft.pages.zip", zipSync({ "Draft.pages": tika() })))).toEqual(flat);
    // A package opened from Finder, as the native side lists it.
    const zipped = zipPackage("Draft.pages", [
      { path: "Index.zip", bytes: index },
      { path: "Metadata/Properties.plist", bytes: strToU8("<plist/>") },
    ]);
    expect(zipped.name).toBe("Draft.pages.zip");
    expect(texts(readDocument(zipped.name, zipped.bytes))).toEqual(flat);
  });

  test("a styled script: the playwright's named styles become its elements, and it imports as written", () => {
    const d = readDocument("Harbor.pages", harborPages());
    expect(texts(d)).toEqual(HARBOR.map(([line]) => line));
    expect(d.paragraphs.map((p) => p.style)).toEqual(HARBOR.map(([, name]) => name.replace("*", "")));
    const lines = reviewLines(d, "detect", EMPTY_CORRECTIONS);
    expect(lines.map((p) => p.kind)).toEqual([
      "act", "scene", "action", "action", "character", "dialogue", "character", "parenthetical", "dialogue", "action", "character", "dialogue", "action",
    ]);
    // Named styles are the source's own semantics: nothing is left to review.
    expect(lines.every((p) => !p.review && p.reason.startsWith("Source style:"))).toBe(true);
    expect(runsOf(d.paragraphs[5])).toEqual([["You said it ", ""], ["would", "em"], [" wait.", ""]]);
    expect(runsOf(d.paragraphs[9])).toEqual([["She sets down a small blue suitcase.", "em"]]);
    const out = parse(makeScript(d, "Harbor", "detect", EMPTY_CORRECTIONS));
    expect(out.doc.content.map((p) => p.type)).toEqual(lines.map((p) => p.kind));
    expect(texts(readDocument("Harbor.pages", zipPackage("Harbor.pages", harborPackage()).bytes))).toEqual(texts(d));
  });

  test("a play typed in the body style is read from its text, and every guess is marked for review", () => {
    const text = "MARA\nIt was never this quiet.\nShe crosses to the window.";
    const d = readDocument("Plain.pages", pagesDoc(text, [[5, runs([[0, 10], [5], [30]])]], [style(10, 2022, "Body", null)]));
    const lines = reviewLines(d, "detect", EMPTY_CORRECTIONS);
    expect(lines.map((p) => p.kind)).toEqual(["character", "dialogue", "dialogue"]);
    expect(lines.every((p) => p.review)).toBe(true);
    expect(reviewLines(d, "directions", EMPTY_CORRECTIONS).every((p) => p.kind === "action")).toBe(true);
  });

  test("named styles and their one-off variations become script elements; emphasis follows the styles", () => {
    const lines = ["MARA", "Stay here.", "(quietly)", "She waits.", "Lights fade.", "INT. PIER - DAY", "MARA", "Hello again\tthere"];
    const text = lines.join("\n");
    const at = lines.map((_, i) => lines.slice(0, i).join("\n").length + (i ? 1 : 0));
    const bytes = pagesDoc(
      text,
      [
        [5, runs([[at[0], 10], [at[1], 11], [at[2], 12], [at[3], 13], [at[4]], [at[5], 15], [at[6], 10], [at[7], 11]])],
        [8, runs([[at[1] + 5, 20], [at[1] + 9], [at[6], 22], [at[7]]])],
      ],
      [
        style(10, 2022, "Character", null, [[1, 1]]),
        style(11, 2022, "Dialogue", null),
        style(12, 2022, "Parenthetical", null),
        style(13, 2022, null, 14, [[7, 1]]),
        style(14, 2022, "Stage Direction", null, [[2, 1]]),
        style(15, 2022, "Scene Heading", null),
        style(20, 2021, null, 21, [[11, 1]]),
        style(21, 2021, "None", null),
        style(22, 2021, "Plain", null, [[1, 0]]),
      ],
    );
    const d = readDocument("Tide.pages", bytes);
    expect(d.paragraphs.map((p) => p.style)).toEqual([
      "Character", "Dialogue", "Parenthetical", "Stage Direction", "Stage Direction", "Scene Heading", "Character", "Dialogue",
    ]);
    expect(reviewLines(d, "detect", EMPTY_CORRECTIONS).map((p) => p.kind)).toEqual([
      "character", "dialogue", "parenthetical", "action", "action", "sceneHeading", "character", "dialogue",
    ]);
    const marks = (i: number) => runsOf(d.paragraphs[i]);
    expect(marks(0)).toEqual([["MARA", "strong"]]);
    expect(marks(1)).toEqual([["Stay ", ""], ["here", "underline"], [".", ""]]);
    expect(marks(3)).toEqual([["She waits.", "em"]]);
    expect(marks(4)).toEqual([["Lights fade.", "em"]]);
    // A character style that turns bold off wins over its bold paragraph style.
    expect(marks(6)).toEqual([["MARA", ""]]);
    expect(texts(d)[7]).toBe("Hello\nagain\tthere");
    const out = parse(makeScript(d, "Tide", "detect", EMPTY_CORRECTIONS));
    expect(out.doc.content.map((p) => p.type)).toEqual(["character", "dialogue", "parenthetical", "action", "action", "sceneHeading", "character", "dialogue"]);
  });

  test("breaks end paragraphs, and what is anchored in the text follows its paragraph", () => {
    const text = "One\u0005Two\u0004Three\u000cFour￼Five￼\nEnd";
    const box = text.indexOf("￼");
    const bytes = pagesDoc(
      text,
      [[9, runs([[box, 30]])]],
      [
        [30, 2003, [[1, ref(31)]]],
        [31, 2011, [[1, []], [4, ref(32)]]],
        [32, 2001, [[3, "Boxed text"]]],
        [40, 10015, [[1, ref(2)], [1, ref(41)]]],
        [41, 2011, [[1, []], [2, ref(42)]]],
        [42, 2001, [[3, "Note on the page"]]],
      ],
      [[20, ref(40)]],
    );
    expect(texts(readDocument("Breaks.pages", bytes))).toEqual([
      "One", "Two", "Three", "FourFive", "Boxed text", "End", "Text boxes from the original document", "Note on the page",
    ]);
  });

  test("a current-layout table: text and rich-text cells carry across, a number is named and left", () => {
    const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
    const cell = (type: number, flags: number, values: number[]) => [5, type, 0, 0, 0, 0, 0, 0, ...u32(flags), ...values];
    const row = (index: number, cells: number[][]) => {
      const offsets: number[] = [];
      let at = 0;
      for (const c of cells) {
        offsets.push(at & 255, at >> 8);
        at += c.length;
      }
      return [5, [[1, index], [2, cells.length], [3, new Uint8Array()], [4, new Uint8Array()], [6, new Uint8Array(cells.flat())], [7, new Uint8Array(offsets)]]] as Field;
    };
    const bytes = pagesDoc(
      "Cast￼\nEnd",
      [[9, runs([[4, 50]])]],
      [
        [50, 2003, [[1, ref(51)]]],
        [51, 6000, [[1, []], [2, ref(52)]]],
        [52, 6001, [[4, [[3, [[1, [[1, 0], [2, ref(53)]]]]], [4, ref(54)], [17, ref(55)]]], [6, 2], [7, 2]]],
        [53, 6002, [row(0, [cell(3, 0x8, u32(1)), cell(2, 0x1, new Array(16).fill(0))]), row(1, [cell(9, 0x10, u32(7)), cell(3, 0x8, u32(2))])]],
        [54, 6005, [[1, 1], [2, 3], [3, [[1, 1], [2, 1], [3, "BOB"]]], [3, [[1, 2], [2, 1], [3, "Hi."]]]]],
        [55, 6005, [[1, 8], [2, 8], [3, [[1, 7], [2, 1], [9, ref(56)]]]]],
        [56, 6218, [[1, ref(57)]]],
        [57, 2001, [[1, 5], [3, "Rich cell"]]],
      ],
    );
    const d = readDocument("Cast.pages", bytes);
    expect(texts(d)).toEqual(["Cast", "BOB", "Rich cell", "Hi.", "End"]);
    expect(d.notices.some((n) => n.startsWith("One table cell holds a number"))).toBe(true);
  });
});

describe("a Pages document that cannot be read directly says what to do, before anything is written", () => {
  const index = () => zipSync(Object.fromEntries(Object.entries(unzipSync(tika())).filter(([n]) => n.startsWith("Index/"))), { level: 0 });
  test("password, tracked changes, Pages ’09 and not-a-Pages-document", () => {
    expect(() => readDocument("Locked.pages", zipSync({ "Locked.pages/Index.zip": index(), "Locked.pages/.iwpv2": new Uint8Array(100) }))).toThrow("password-protected");
    // An encrypted member shows up as a compression method no ZIP defines.
    const scrambled = zipSync({ "Index/Document.iwa": new Uint8Array(40) }, { level: 0 });
    const view = new DataView(scrambled.buffer);
    view.setUint16(8, 99, true);
    let central = scrambled.length - 4;
    while (view.getUint32(central, true) !== 0x02014b50) central--;
    view.setUint16(central + 10, 99, true);
    expect(() => readDocument("Locked.pages", scrambled)).toThrow("password-protected");
    expect(() => readDocument("Edited.pages", pagesDoc("Kept\nGone", [[22, runs([[5, 60]])]], [[60, 2059, []]]))).toThrow("tracked changes");
    expect(() => readDocument("Old.pages", zipSync({ "index.xml": strToU8("<sl:document/>") }))).toThrow("Pages ’09");
    expect(() => readDocument("Slides.pages", zipSync({ "Index/Document.iwa": iwa([[1, 1, [[1, "not a document"]]]]) }))).toThrow("not a Pages");
    expect(() => readDocument("Draft.pages", new Uint8Array())).toThrow("not a Pages");
    expect(() => readDocument("Two.pages.zip", zipSync({ "A.pages/Index.zip": index(), "B.pages/Index.zip": index() }))).toThrow("more than one document");
    expect(() => readDocument("Empty.pages", pagesDoc("\n\n", []))).toThrow("No editable text");
  });
  test("damaged archives fail with a sentence, and a declared expansion past the bound allocates nothing", () => {
    const iwaOnly = (bytes: number[]) => zipSync({ "Index/Document.iwa": new Uint8Array(bytes) });
    for (const damaged of [
      [1, 1, 0, 0, 0], // not a Snappy chunk
      [0, 9, 0, 0], // a chunk longer than the file
      [0, 3, 0, 0, 4, 1, 1], // a copy from before the start
      [0, 3, 0, 0, 5, 8, 99], // a literal past the end
    ])
      expect(() => readDocument("Bad.pages", iwaOnly(damaged))).toThrow("damaged");
    // An object header holding a group, the wire type no Pages file uses: a
    // valid chunk and a valid literal, so the refusal is the message reader's.
    const stream = [2, 0x0b, 0x0c];
    expect(() => readDocument("Bad.pages", iwaOnly([0, 5, 0, 0, stream.length, (stream.length - 1) << 2, ...stream]))).toThrow("damaged");
    const huge = varint(65 * 1024 * 1024);
    expect(() => readDocument("Huge.pages", iwaOnly([0, huge.length, 0, 0, ...huge]))).toThrow("expands beyond");
  });
  test("Pages is a direct format, and its guide says when Word is still the way", () => {
    expect(guidance("Draft.pages")).toBeNull();
    expect(guidance("Draft.pages.zip")).toBeNull();
    expect(guidance("Draft.zip")).toContain("Unzip");
    expect(SOURCE_GUIDES.find((g) => g.name === "Pages")?.text).toContain("Export To › Word");
  });
});
