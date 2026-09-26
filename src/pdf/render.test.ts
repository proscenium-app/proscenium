// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";

import dgModernRaw from "../../formats/dg-modern.json";
import type { Doc } from "../fountain/model";
import { validateFormatSpec } from "../format/validate";
import { paginateDoc, paginateFrontMatter } from "../layout";
import { selectPages } from "./plan";
import { renderPdf, type PdfFontBytes } from "./render";

function ttf(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`./fonts/${name}`, import.meta.url))),
  );
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
      characters: Array.from({ length: 40 }, (_, i) => ({ name: `Actor ${i + 1}`, description: "A person in the play." })),
      setting: "The coast beyond the kitchen. ".repeat(180),
    };
    const front = paginateFrontMatter(frontMatter, DG);
    expect(front.filter((page) => page.kind === "characters").length).toBeGreaterThan(1);
    expect(front.filter((page) => page.kind === "setting").length).toBeGreaterThan(1);
    const layout = paginateDoc(speechDoc(1), DG);
    const pdf = await PDFDocument.load(await renderPdf({ layout, spec: DG, meta: {}, fonts: FONTS, frontMatter }));
    expect(pdf.getPageCount()).toBe(front.length + layout.pages.length);
    front.forEach((planned, i) => {
      const page = pdf.getPage(i);
      const contents = page.node.Contents();
      const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
      const stream = refs.map((ref) => pdf.context.lookup(ref)).map((s) => s instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "").join("\n");
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
    const bytes = await renderPdf({ layout: slice, spec: DG, meta: { title: "Tideline" }, fonts: FONTS });
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
    const render = async (frontSheets: ("title" | "characters" | "setting")[] | undefined, pages: number[] | null) =>
      PDFDocument.load(await renderPdf({
        layout: selectPages(layout, pages), spec: DG, meta: { title: "Tideline" }, frontMatter, frontSheets, fonts: FONTS,
      }));
    // An excerpt with a cover and a cast list, and no setting sheet.
    const excerpt = await render(["characters", "title"], [2, 3]);
    expect(excerpt.getPageCount()).toBe(2 + 2);
    const text = (pdf: PDFDocument, i: number) => {
      const contents = pdf.getPage(i).node.Contents();
      const refs = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
      return refs.map((ref) => pdf.context.lookup(ref)).map((s) => s instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "").join("\n");
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
