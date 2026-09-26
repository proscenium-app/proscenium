// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The footer reaches the paper. The PDF's text is subset-encoded glyph ids, so
 * this reads where text is DRAWN rather than what it says: a format with a
 * footer puts one more line of text on every page, at the footer's own height
 * above the bottom edge, and a format without one puts nothing there.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";

import dgModernRaw from "../../formats/dg-modern.json";
import type { Doc } from "../fountain/model";
import type { FormatSpec } from "../format/spec";
import { validateFormatSpec } from "../format/validate";
import { paginateDoc } from "../layout";
import { renderPdf, type PdfFontBytes } from "./render";

const font = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fonts/${name}`, import.meta.url))));
const FONTS: PdfFontBytes = {
  regular: font("CourierPrime-Regular.ttf"),
  bold: font("CourierPrime-Bold.ttf"),
  italic: font("CourierPrime-Italic.ttf"),
  boldItalic: font("CourierPrime-BoldItalic.ttf"),
};

function spec(footer?: unknown): FormatSpec {
  const raw = structuredClone(dgModernRaw) as Record<string, unknown>;
  if (footer) raw.footer = footer;
  const v = validateFormatSpec(raw);
  if (!v.ok) throw new Error(v.errors.join("\n"));
  return v.spec;
}

const PLAY: Doc = {
  type: "doc",
  content: [
    {
      type: "action",
      content: [
        { type: "text", text: Array.from({ length: 80 }, (_, i) => `beat ${i}`).join("\n") },
      ],
    },
  ],
};

/** Every text baseline drawn on each page, in points above the bottom edge. */
async function baselines(s: FormatSpec): Promise<number[][]> {
  const layout = paginateDoc(PLAY, s, { title: "Tideline" });
  const bytes = await renderPdf({ layout, spec: s, meta: { title: "Tideline" }, fonts: FONTS });
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => {
    const contents = page.node.Contents();
    const parts = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
    const text = parts
      .map((ref) => pdf.context.lookup(ref))
      .map((stream) =>
        stream instanceof PDFRawStream
          ? new TextDecoder().decode(decodePDFRawStream(stream).decode())
          : "",
      )
      .join("\n");
    return [...text.matchAll(/1 0 0 1 [-\d.]+ ([-\d.]+) Tm/g)].map((m) => Number(m[1]));
  });
}

describe("the PDF footer", () => {
  it("draws on every page at its position above the bottom edge, and nowhere else", async () => {
    const without = await baselines(spec());
    const withFooter = await baselines(spec({ content: { center: "{page}" }, position: 0.5 }));
    expect(withFooter.length).toBe(without.length);
    expect(without.length).toBeGreaterThan(1);
    for (let i = 0; i < without.length; i++) {
      // Exactly one more line of text on the page…
      expect(withFooter[i].length).toBe(without[i].length + 1);
      const added = withFooter[i].filter((y) => !without[i].includes(y));
      expect(added).toHaveLength(1);
      // …sitting just above the half inch: the position (36pt) plus the depth
      // of Courier Prime's descender at 12pt, which is under a line.
      expect(added[0]).toBeGreaterThan(36);
      expect(added[0]).toBeLessThan(36 + 12);
    }
    // Nothing drawn by the format without a footer comes that low.
    expect(Math.min(...without.flat())).toBeGreaterThan(72);
  });

  it("leaves page one alone when the format says so", async () => {
    const suppressed = await baselines(
      spec({ content: { center: "{page}" }, position: 0.5, suppressOnFirstPage: true }),
    );
    const without = await baselines(spec());
    expect(suppressed[0].length).toBe(without[0].length);
    expect(suppressed[1].length).toBe(without[1].length + 1);
  });
});
