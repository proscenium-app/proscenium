// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";

import dgModernRaw from "../../formats/dg-modern.json";
import type { Doc } from "../fountain/model";
import { validateFormatSpec } from "../format/validate";
import { paginateBackMatter, paginateDoc, paginateFrontMatter } from "../layout";
import { selectPages } from "./plan";
import { renderPdf, type PdfFontBytes } from "./render";

function ttf(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`./fonts/${name}`, import.meta.url))));
}

const FONTS: PdfFontBytes = {
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

function speechDoc(speeches: number): Doc {
  const content = [];
  for (let i = 0; i < speeches; i++) {
    content.push(
      { type: "character" as const, content: [{ type: "text" as const, text: `VOICE ${i}` }] },
      {
        type: "dialogue" as const,
        content: [
          {
            type: "text" as const,
            text: "A line of dialogue that runs the full width of the block. ".repeat(3),
          },
        ],
      },
    );
  }
  return { type: "doc", content };
}

describe("renderPdf", () => {
  it("docs/app/formatting/formats-and-layout.md#FMT-60: a long cast and setting add sheets and every rendered baseline stays on paper", async () => {
    const frontMatter = {
      title: "Long front matter",
      characters: Array.from({ length: 40 }, (_, i) => ({
        name: `Actor ${i + 1}`,
        description: "A person in the play.",
      })),
      setting: "The coast beyond the kitchen. ".repeat(180),
    };
    const front = paginateFrontMatter(frontMatter, DG);
    expect(front.filter((page) => page.kind === "characters").length).toBeGreaterThan(1);
    expect(front.filter((page) => page.kind === "setting").length).toBeGreaterThan(1);
    const layout = paginateDoc(speechDoc(1), DG);
    const pdf = await PDFDocument.load(
      await renderPdf({ layout, spec: DG, meta: {}, fonts: FONTS, frontMatter }),
    );
    expect(pdf.getPageCount()).toBe(front.length + layout.pages.length);
    front.forEach((planned, i) => {
      const page = pdf.getPage(i);
      const contents = page.node.Contents();
      const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
      const stream = refs
        .map((ref) => pdf.context.lookup(ref))
        .map((s) =>
          s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "",
        )
        .join("\n");
      const baselines = [...stream.matchAll(/1 0 0 1 [-\d.]+ ([-\d.]+) Tm/g)].map((m) => +m[1]);
      expect(baselines).toHaveLength(planned.lines.length);
      for (const y of baselines) {
        expect(y).toBeGreaterThanOrEqual(DG.page.margins.bottom * 72);
        expect(y).toBeLessThanOrEqual(page.getHeight() - DG.page.margins.top * 72);
      }
    });
  });
  it("renders exactly the engine's pages and embeds the font", async () => {
    const doc = speechDoc(60);
    const layout = paginateDoc(doc, DG, { title: "Tideline" });
    const bytes = await renderPdf({ layout, spec: DG, meta: { title: "Tideline" }, fonts: FONTS });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(layout.pages.length);
    expect(layout.pages.length).toBeGreaterThan(1);
    // What a screen reader and a viewer's title bar name the file by.
    expect(parsed.getTitle()).toBe("Tideline");
    expect(String(parsed.catalog.get(PDFName.of("Lang")))).toContain("en-US");
    const prefs = parsed.catalog.getOrCreateViewerPreferences();
    expect(prefs.getDisplayDocTitle()).toBe(true);
  });

  it("prepends an unnumbered title page when front matter has a title", async () => {
    const doc = speechDoc(3);
    const layout = paginateDoc(doc, DG, { title: "Tideline" });
    const bytes = await renderPdf({
      layout,
      spec: DG,
      meta: { title: "Tideline" },
      frontMatter: {
        title: "Tideline",
        authors: ["Jo Marlowe"],
        contact: ["jo@example.com"],
        draftDate: "July 2026",
      },
      fonts: FONTS,
    });
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(layout.pages.length + 1);
  });

  it("adds short CHARACTERS and SETTING/TIME sheets after the title", async () => {
    const doc = speechDoc(3);
    const layout = paginateDoc(doc, DG, { title: "Tideline" });
    const bytes = await renderPdf({
      layout,
      spec: DG,
      meta: { title: "Tideline" },
      frontMatter: {
        title: "Tideline",
        characters: [
          { name: "Mara", description: "a hydrologist, 40s" },
          { name: "Jonah", description: "her brother, 30s" },
        ],
        setting: "A coastal kitchen.",
        time: "The last night of winter.",
      },
      fonts: FONTS,
    });
    const parsed = await PDFDocument.load(bytes);
    // title + cast + setting = 3 front-matter pages before the body.
    expect(parsed.getPageCount()).toBe(layout.pages.length + 3);
  });

  it("renders only the selected pages, still carrying their own numbering", async () => {
    const doc = speechDoc(60);
    const layout = paginateDoc(doc, DG, { title: "Tideline" });
    expect(layout.pages.length).toBeGreaterThan(3);
    const slice = selectPages(layout, [2, 3]);
    const bytes = await renderPdf({
      layout: slice,
      spec: DG,
      meta: { title: "Tideline" },
      fonts: FONTS,
    });
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(2);
    // The excerpt's first page is page 2 of the play, header and all.
    expect(slice.pages[0].pageNumber).toBe(2);
    expect(slice.pages[0].header).not.toBeNull();
  });

  it("draws only the front sheets asked for, in stage order, before any selection of pages", async () => {
    const doc = speechDoc(60);
    const layout = paginateDoc(doc, DG, { title: "Tideline" });
    const frontMatter = {
      title: "Tideline",
      characters: [{ name: "Mara", description: "a hydrologist, 40s" }],
      setting: "A coastal kitchen.",
    };
    const render = async (
      frontSheets: ("title" | "characters" | "setting")[] | undefined,
      pages: number[] | null,
    ) =>
      PDFDocument.load(
        await renderPdf({
          layout: selectPages(layout, pages),
          spec: DG,
          meta: { title: "Tideline" },
          frontMatter,
          frontSheets,
          fonts: FONTS,
        }),
      );
    // An excerpt with a cover and a cast list, and no setting sheet.
    const excerpt = await render(["characters", "title"], [2, 3]);
    expect(excerpt.getPageCount()).toBe(2 + 2);
    const text = (pdf: PDFDocument, i: number) => {
      const contents = pdf.getPage(i).node.Contents();
      const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
      return refs
        .map((ref) => pdf.context.lookup(ref))
        .map((s) =>
          s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "",
        )
        .join("\n");
    };
    // The title sheet prints before the cast sheet whichever order they were ticked in.
    const glyphs = (pdf: PDFDocument, i: number) => [...text(pdf, i).matchAll(/Tj/g)].length;
    expect(glyphs(excerpt, 0)).toBe(1); // TIDELINE, alone: a title sheet with no author
    expect(glyphs(excerpt, 1)).toBe(2); // CHARACTERS, and Mara
    // None asked for: none drawn. Omitted: all of them, as before.
    expect((await render([], null)).getPageCount()).toBe(layout.pages.length);
    expect((await render(undefined, null)).getPageCount()).toBe(layout.pages.length + 3);
  });

  it("omits empty front-matter pages (cast only, no setting)", async () => {
    const doc = speechDoc(3);
    const layout = paginateDoc(doc, DG, { title: "Tideline" });
    const bytes = await renderPdf({
      layout,
      spec: DG,
      meta: { title: "Tideline" },
      frontMatter: { title: "Tideline", characters: [{ name: "Solo" }] },
      fonts: FONTS,
    });
    const parsed = await PDFDocument.load(bytes);
    // title + cast only — no setting page.
    expect(parsed.getPageCount()).toBe(layout.pages.length + 2);
  });
});

/** docs/app/formatting/formats-and-layout.md#FMT-172 */
describe("a horizontal line", () => {
  it("is a hairline through the middle of its row, margin to margin", async () => {
    const text = (t: string) => [{ type: "text" as const, text: t }];
    const doc: Doc = {
      type: "doc",
      content: [
        { type: "action", content: text("Before.") },
        { type: "horizontalRule" },
        { type: "action", content: text("After.") },
      ],
    };
    const layout = paginateDoc(doc, DG);
    const pdf = await PDFDocument.load(
      await renderPdf({ layout, spec: DG, meta: {}, fonts: FONTS }),
    );
    const page = pdf.getPage(0);
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const stream = refs
      .map((ref) => pdf.context.lookup(ref))
      .map((s) =>
        s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "",
      )
      .join("\n");
    const strokes = [...stream.matchAll(/([-\d.]+) ([-\d.]+) m\s+([-\d.]+) ([-\d.]+) l/g)].map(
      (m) => m.slice(1).map(Number),
    );
    expect(strokes).toHaveLength(1);
    const [x0, y0, x1, y1] = strokes[0];
    const m = DG.page.margins;
    expect(x0).toBeCloseTo(m.left * 72, 3);
    expect(x1).toBeCloseTo(page.getWidth() - m.right * 72, 3);
    expect(y1).toBeCloseTo(y0, 6);
    // Row 2 (a blank row under "Before."), halfway down it.
    const pitch = DG.type.size * DG.type.lineHeight;
    expect(y0).toBeCloseTo(page.getHeight() - m.top * 72 - 2.5 * pitch, 3);
    expect(layout.pages[0].lines.map((l) => [l.type, l.row])).toEqual([
      ["action", 0],
      ["horizontalRule", 2],
      ["action", 4],
    ]);
  });
});

describe("renderPdf page labels", () => {
  /** Each sheet's label as a viewer reads /PageLabels: prefix, then the number. */
  function labels(pdf: PDFDocument): string[] {
    const tree = pdf.catalog.lookup(PDFName.of("PageLabels"), PDFDict);
    const nums = tree.lookup(PDFName.of("Nums"), PDFArray).asArray();
    const runs: { index: number; prefix: string; start: number | null }[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      const dict = pdf.context.lookup(nums[i + 1], PDFDict);
      const prefix = dict.lookup(PDFName.of("P"));
      const start = dict.lookup(PDFName.of("St"));
      runs.push({
        index: (nums[i] as PDFNumber).asNumber(),
        prefix: prefix instanceof PDFHexString ? prefix.decodeText() : "",
        start: dict.has(PDFName.of("S"))
          ? start instanceof PDFNumber
            ? start.asNumber()
            : 1
          : null,
      });
    }
    return Array.from({ length: pdf.getPageCount() }, (_, sheet) => {
      const run = runs.filter((r) => r.index <= sheet).pop() ?? runs[0];
      return run.prefix + (run.start === null ? "" : String(run.start + sheet - run.index));
    });
  }

  it("docs/app/formatting/formats-and-layout.md#FMT-159: a viewer calls each script page the number printed on it, past the title page", async () => {
    const doc = speechDoc(40);
    const layout = paginateDoc(doc, DG, { title: "Tideline" });
    expect(layout.pages.length).toBeGreaterThan(2);
    const pdf = await PDFDocument.load(
      await renderPdf({
        layout,
        spec: DG,
        meta: { title: "Tideline" },
        frontMatter: { title: "Tideline", characters: [{ name: "Solo" }] },
        fonts: FONTS,
      }),
    );
    expect(labels(pdf)).toEqual([
      "Title",
      "Characters",
      ...layout.pages.map((page) => String(page.pageNumber)),
    ]);
    // The number a viewer shows is the one the page's header prints.
    expect(layout.pages[1].header?.right).toBe("2.");
    expect(labels(pdf)[3]).toBe("2");
  });

  it("docs/app/formatting/formats-and-layout.md#FMT-159: an excerpt of pages 2 and 3 is labelled 2 and 3", async () => {
    const layout = paginateDoc(speechDoc(40), DG);
    const pdf = await PDFDocument.load(
      await renderPdf({
        layout: selectPages(layout, [2, 3]),
        spec: DG,
        meta: {},
        fonts: FONTS,
      }),
    );
    expect(labels(pdf)).toEqual(["2", "3"]);
  });

  it("the sheets after the script are named, and the last page's number does not run on into them", async () => {
    const layout = paginateDoc(speechDoc(40), DG, { title: "Tideline" });
    const pdf = await PDFDocument.load(
      await renderPdf({
        layout,
        spec: DG,
        meta: { title: "Tideline" },
        frontMatter: {
          title: "Tideline",
          backPages: [
            { id: "about", name: "About the Author", text: "She writes by the sea.\n" },
            { id: "thanks", name: "Acknowledgments", text: "With thanks.\n" },
          ],
        },
        fonts: FONTS,
      }),
    );
    expect(labels(pdf)).toEqual([
      "Title",
      ...layout.pages.map((page) => String(page.pageNumber)),
      "About the Author",
      "Acknowledgments",
    ]);
  });
});

describe("the pages after the script", () => {
  /** A page's drawn text operators, in drawing order. */
  const stream = (pdf: PDFDocument, i: number) => {
    const contents = pdf.getPage(i).node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    return refs
      .map((ref) => pdf.context.lookup(ref))
      .map((s) =>
        s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "",
      )
      .join("\n");
  };
  const shown = (pdf: PDFDocument, i: number) => [...stream(pdf, i).matchAll(/Tj/g)].length;
  const frontMatter = {
    title: "Tideline",
    backPages: [
      {
        id: "about",
        name: "About the Author",
        text: "## ABOUT THE AUTHOR\n\nShe writes by the sea.\n\nShe has a dog.\n",
      },
      { id: "thanks", name: "Acknowledgments", text: "With thanks to the lighthouse.\n" },
    ],
  };
  const doc = speechDoc(60);
  const layout = paginateDoc(doc, DG, { title: "Tideline" });
  const render = async (frontSheets: string[] | undefined, pages: number[] | null = null) =>
    PDFDocument.load(
      await renderPdf({
        layout: selectPages(layout, pages),
        spec: DG,
        meta: { title: "Tideline" },
        frontMatter,
        frontSheets,
        fonts: FONTS,
      }),
    );

  it("are drawn after the last script page, one sheet each, at the engine's rows and with no header", async () => {
    const back = paginateBackMatter(frontMatter, DG);
    expect(back.map((page) => page.kind)).toEqual(["page:about", "page:thanks"]);
    const pdf = await render(undefined);
    const total = layout.pages.length;
    expect(layout.pages.length).toBeGreaterThan(1);
    // The title page, the script, then the two pages.
    expect(pdf.getPageCount()).toBe(1 + total + 2);
    back.forEach((planned, i) => {
      const at = 1 + total + i;
      const page = pdf.getPage(at);
      const baselines = [...stream(pdf, at).matchAll(/1 0 0 1 [-\d.]+ ([-\d.]+) Tm/g)].map(
        (m) => +m[1],
      );
      // Its lines and nothing else: no page number, no header, no footer.
      expect(baselines).toHaveLength(planned.lines.length);
      for (const y of baselines) {
        expect(y).toBeGreaterThanOrEqual(DG.page.margins.bottom * 72);
        expect(y).toBeLessThanOrEqual(page.getHeight() - DG.page.margins.top * 72);
      }
    });
    // The last script page still carries its own number in its header.
    expect(layout.pages[total - 1].header).not.toBeNull();
    expect(shown(pdf, total)).toBeGreaterThan(shown(pdf, 1 + total));
  });

  it("go only when their kind is asked for, whichever pages of the script go", async () => {
    const total = layout.pages.length;
    // None asked for: the script alone.
    expect((await render([])).getPageCount()).toBe(total);
    // One of the two, and no title page.
    const one = await render(["page:thanks"]);
    expect(one.getPageCount()).toBe(total + 1);
    expect(shown(one, total)).toBe(1);
    // An excerpt carries them the same way, after its last page.
    const excerpt = await render(["title", "page:about"], [2, 3]);
    expect(excerpt.getPageCount()).toBe(1 + 2 + 1);
    expect(shown(excerpt, 3)).toBe(3); // the heading and the two paragraphs
  });

  it("a play with none is the file it was", async () => {
    const without = { title: "Tideline" };
    const pdf = await PDFDocument.load(
      await renderPdf({
        layout,
        spec: DG,
        meta: { title: "Tideline" },
        frontMatter: without,
        fonts: FONTS,
      }),
    );
    expect(pdf.getPageCount()).toBe(1 + layout.pages.length);
  });
});
