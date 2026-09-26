// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFArray, PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import raw from "../../formats/stage-us-modern.json";
import { charAdvanceIn, MONO_ADVANCE_EM, validateFormatSpec } from "../format";
import { parse } from "../fountain";
import { paginateDoc } from "../layout";
import { renderPdf } from "./render";

const font = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fonts/CourierPrime-${name}.ttf`, import.meta.url)));
const fonts = {
  regular: font("Regular"),
  bold: font("Bold"),
  italic: font("Italic"),
  boldItalic: font("BoldItalic"),
};

test("docs/app/formatting/formats-and-layout.md#FMT-115: the shared advance matches all four embedded faces", async () => {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  for (const bytes of Object.values(fonts)) {
    const face = await pdf.embedFont(bytes);
    expect(face.widthOfTextAtSize("MWi .", 1) / 5).toBeCloseTo(MONO_ADVANCE_EM, 10);
  }
});

test("docs/app/formatting/formats-and-layout.md#FMT-115: PDF tracking and styled-run placement use the same advance as pagination", async () => {
  const v = validateFormatSpec(raw);
  if (!v.ok) throw new Error(v.errors.join());
  const spec = v.spec;
  spec.elements.act.letterSpacing = 0.12;
  spec.header.suppressOnFirstPage = true;
  const doc = parse("# *ABC*DEFG\n\nPlain text.").doc;
  const layout = paginateDoc(doc, spec);
  const act = layout.pages[0].lines[0];
  expect(act.type).toBe("act");
  const bytes = await renderPdf({ layout, spec, meta: {}, fonts });
  const pdf = await PDFDocument.load(bytes);
  const contents = pdf.getPage(0).node.Contents()!;
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const stream = refs
    .map((ref) => pdf.context.lookup(ref))
    .map((s) =>
      s instanceof PDFRawStream ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "",
    )
    .join("\n");
  const spacing = [...stream.matchAll(/([\d.e-]+) Tc/g)].map((m) => +m[1]);
  expect(spacing[0]).toBeCloseTo(1.44, 10);
  expect(spacing[1]).toBeCloseTo(1.44, 10);
  expect(spacing[spacing.length - 1]).toBe(0);
  const positions = [...stream.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map((m) => [
    +m[1],
    +m[2],
  ]);
  expect(positions[1][0] - positions[0][0]).toBeCloseTo(
    3 * charAdvanceIn(spec, spec.elements.act.letterSpacing) * 72,
    8,
  );
  expect(positions[0][1]).toBe(positions[1][1]);
  expect(positions[0][0]).toBeCloseTo((spec.page.margins.left + act.xIn) * 72, 8);
});
