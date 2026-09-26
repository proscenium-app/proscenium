// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
import raw from "../../formats/dg-modern.json";
import { FormatRegistry, validateFormatSpec } from "../format";
import { parse } from "../fountain";
import { paginateDoc } from "../layout";
import { renderPdf } from "./render";
import { selectPages } from "./plan";

const validation = validateFormatSpec(raw);
if (!validation.ok) throw new Error(validation.errors.join(", "));
const spec = validation.spec;
const font = (name: string) => new Uint8Array(readFileSync(new URL(`./fonts/CourierPrime-${name}.ttf`, import.meta.url)));
const fonts = { regular: font("Regular"), bold: font("Bold"), italic: font("Italic"), boldItalic: font("BoldItalic") };

function structure(pdf: PDFDocument) {
  const root = pdf.catalog.lookup(PDFName.of("StructTreeRoot"), PDFDict);
  const nodes: { tag: string; ref: PDFRef; parent: string; kids: PDFArray }[] = [];
  const visit = (ref: PDFRef, parent: string) => {
    const d = pdf.context.lookup(ref, PDFDict);
    expect(String(d.get(PDFName.of("P")))).toBe(parent);
    const tag = String(d.get(PDFName.of("S")));
    const kids = d.lookup(PDFName.of("K"), PDFArray);
    nodes.push({ tag, ref, parent, kids });
    for (const child of kids.asArray()) if (child instanceof PDFRef) visit(child, String(ref));
  };
  for (const child of root.lookup(PDFName.of("K"), PDFArray).asArray()) {
    visit(child as PDFRef, String(pdf.catalog.get(PDFName.of("StructTreeRoot"))));
  }
  return { root, nodes };
}

function stream(pdf: PDFDocument, pageIndex: number) {
  const contents = pdf.getPage(pageIndex).node.Contents();
  const parts = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  return parts.map((ref) => pdf.context.lookup(ref)).map((s) => s instanceof PDFRawStream
    ? new TextDecoder().decode(decodePDFRawStream(s).decode()) : "").join("\n");
}

test("sketch metadata prints on numbered pages, reads before dialogue and stays out of later excerpts", async () => {
  const spec = FormatRegistry.withBuiltins().get("sketch-comedy")!;
  const frontMatter = { title: "The Queue", authors: ["A. Writer"], characters: [{ name: "NELL" }], setting: "A ticket office." };
  const source = parse("@NELL\n" + "Still waiting. ".repeat(300)).doc;
  const layout = paginateDoc(source, spec, { frontMatter });
  const pdf = await PDFDocument.load(await renderPdf({ layout, spec, meta: {}, fonts, frontMatter }));
  expect(pdf.getPageCount()).toBe(layout.pages.length);
  const tags = structure(pdf).nodes.map((node) => node.tag);
  expect(tags.indexOf("/H1")).toBeLessThan(tags.indexOf("/Speech"));
  const first = stream(pdf, 0);
  const baselines = [...first.matchAll(/1 0 0 1 [-\d.]+ ([-\d.]+) Tm/g)].map((m) => +m[1]);
  const expected = 1 + layout.pages[0].intro!.length + layout.pages[0].lines.filter((line) => line.text).length;
  expect(baselines).toHaveLength(expected);
  for (let i = 1; i < baselines.length; i++) expect(baselines[i]).toBeLessThan(baselines[i - 1]);
  const excerpt = await PDFDocument.load(await renderPdf({ layout: selectPages(layout, [2]), spec, meta: {}, fonts, frontMatter }));
  expect(excerpt.getPageCount()).toBe(1);
  expect(structure(excerpt).nodes.some((node) => node.tag === "/H1")).toBe(false);
});

test("docs/app/formatting/formats-and-layout.md#FMT-61: every text sequence has a matching parent-tree entry and logical owner", async () => {
  const parsed = parse("Title: Exemple\nAuthor: Auteur\n\n# ACT I\n\n## SCENE 1\n\n@MARA\n" + "Left speech. ".repeat(12) + "\n\n@JONAH ^\n" + "Right speech. ".repeat(12));
  const layout = paginateDoc(parsed.doc, spec, {});
  const cues = layout.pages.flatMap((page) => page.lines).filter((line) => line.type === "character");
  expect(cues).toHaveLength(2);
  expect(cues[0].row).toBe(cues[1].row);
  expect(cues[0].xIn).not.toBe(cues[1].xIn);
  const bytes = await renderPdf({ layout, spec, meta: {}, fonts, language: "fr-ca", frontMatter: {
    title: "Exemple", authors: ["Auteur"], characters: [{ name: "Mara", description: "left" }, { name: "Jonah" }], setting: "Une cuisine.",
  } });
  const pdf = await PDFDocument.load(bytes);
  expect(String(pdf.catalog.get(PDFName.of("Lang")))).toContain("fr-CA");
  expect(String(pdf.catalog.lookup(PDFName.of("MarkInfo"), PDFDict).get(PDFName.of("Marked")))).toBe("true");
  const { root, nodes } = structure(pdf);
  expect(nodes.filter((n) => n.tag === "/Speech")).toHaveLength(2);
  expect(nodes.filter((n) => n.tag === "/LI")).toHaveLength(2);
  const dialogue = nodes.filter((n) => n.tag === "/Dialogue");
  expect(dialogue).toHaveLength(2);
  const parentTree = root.lookup(PDFName.of("ParentTree"), PDFDict).lookup(PDFName.of("Nums"), PDFArray);
  const seen = new Set<string>();
  for (const n of nodes) for (const child of n.kids.asArray()) {
    if (!(child instanceof PDFDict)) continue;
    const pageRef = child.get(PDFName.of("Pg"));
    const page = pdf.getPages().find((p) => String(p.ref) === String(pageRef))!;
    const key = page.node.lookup(PDFName.of("StructParents"), PDFNumber).asNumber();
    const mcid = child.lookup(PDFName.of("MCID"), PDFNumber).asNumber();
    const parents = parentTree.lookup(key * 2 + 1, PDFArray);
    expect(String(parents.get(mcid))).toBe(String(n.ref));
    const pair = `${pageRef}:${mcid}`;
    expect(seen.has(pair)).toBe(false);
    seen.add(pair);
  }
  let sequences = 0;
  pdf.getPages().forEach((page, i) => {
    const content = stream(pdf, i);
    const ids = [...content.matchAll(/\/MCID (\d+)/g)].map((m) => +m[1]);
    expect(ids).toEqual(ids.map((_, index) => index));
    sequences += ids.length;
    if (ids.length) expect(String(page.node.get(PDFName.of("Tabs")))).toBe("/S");
    for (const id of ids) expect(seen.has(`${page.ref}:${id}`)).toBe(true);
    // Drawing operators all live in either structural content or an artifact.
    let depth = 0;
    for (const token of content.matchAll(/\b(BDC|BMC|EMC|Tj)\b/g)) {
      if (token[1] === "BDC" || token[1] === "BMC") depth++;
      else if (token[1] === "EMC") depth--;
      else expect(depth).toBe(1);
    }
    expect(depth).toBe(0);
  });
  expect(sequences).toBe(seen.size);
  // Dual dialogue has overlapping coordinates, but all of the first speaker's
  // paragraph comes before the second in the structure tree, across pages too.
  const bodyNodes = nodes.slice(nodes.findIndex((n) => n.tag === "/Part"));
  expect(bodyNodes.filter((n) => ["/Speaker", "/Dialogue"].includes(n.tag)).map((n) => n.tag))
    .toEqual(["/Speaker", "/Dialogue", "/Speaker", "/Dialogue"]);
  for (const n of dialogue) expect(n.kids.size()).toBeGreaterThan(1);
});

test("docs/app/formatting/formats-and-layout.md#FMT-61: repeated continuation cues are artifacts, but an excerpt retains its leading speaker", async () => {
  const source = parse("@MARA\n" + "A long speech. ".repeat(500)).doc;
  const layout = paginateDoc(source, spec, {});
  expect(layout.pages.length).toBeGreaterThan(2);
  const full = await PDFDocument.load(await renderPdf({ layout, spec, meta: {}, fonts }));
  const fullNodes = structure(full).nodes;
  expect(stream(full, 1)).toContain("/Artifact BMC");
  expect(fullNodes.filter((n) => n.tag === "/Speaker")).toHaveLength(1);
  expect(fullNodes.filter((n) => n.tag === "/Dialogue")).toHaveLength(1);
  const paragraph = fullNodes.find((n) => n.tag === "/Dialogue")!;
  expect(new Set(paragraph.kids.asArray().map((kid) => String((kid as PDFDict).get(PDFName.of("Pg"))))).size)
    .toBe(layout.pages.length);
  const excerpt = await PDFDocument.load(await renderPdf({ layout: selectPages(layout, [2]), spec, meta: {}, fonts }));
  const excerptNodes = structure(excerpt).nodes;
  expect(excerptNodes.filter((n) => ["/Speaker", "/Dialogue"].includes(n.tag)).map((n) => n.tag))
    .toEqual(["/Speaker", "/Dialogue"]);
});
