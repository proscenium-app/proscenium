// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The document model as a .docx: WordprocessingML (ECMA-376, transitional)
 * in its zip package (docs/app/formatting/formats-and-layout.md#FMT-D109).
 *
 * Readers of this format are strict about the ORDER of a property element's
 * children — a paragraph's properties, a run's, a section's — and refuse or
 * "repair" a file that has them out of sequence. Every builder below writes
 * its children in the schema's order, and says so where it matters.
 *
 * Act and scene headers are a section per heading, each with its own header
 * and footer parts (docs/app/formatting/formats-and-layout.md#FMT-151); parts
 * that would say the same thing are written once and shared.
 */
import { PAGE_SIZES, linePitchIn, textBlockWidthIn, type ElementAlign } from "../format/spec";
import { FACES, familyNames, type Face, type FontFaces } from "./fonts";
import {
  dualColumns,
  furniturePositions,
  SLOTS,
  type Furniture,
  type ParagraphStyle,
  type StyleKey,
  type WpDocument,
  type WpDual,
  type WpInline,
  type WpParagraph,
  type WpSection,
} from "./model";
import { XML_DECLARATION, esc } from "./xml";
import { zipEntries, type ZipEntry } from "./zip";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "application/vnd.openxmlformats-officedocument.wordprocessingml";
const NS = `xmlns:w="${W}" xmlns:r="${R}"`;

/** Twentieths of a point: the unit of every length here. */
const TWIPS_PER_INCH = 1440;
const TWIPS_PER_POINT = 20;
const tw = (inches: number) => Math.round(inches * TWIPS_PER_INCH);

/** Each face's obfuscation key (ECMA-376 Part 1, font embedding): fixed, so the same play makes the same file. */
const FONT_KEY: Record<Face, string> = {
  regular: "{6F1D2C83-5A4B-4E0F-9C7D-2B8E1A3F4C5D}",
  bold: "{3B7E9A12-C4D5-4F6A-8B9C-0D1E2F3A4B5C}",
  italic: "{8C2F4E61-7D9A-4B3C-A5E6-F7081920A1B2}",
  boldItalic: "{1E5A7C93-B2D4-4F68-9A0B-C1D2E3F40516}",
};
const EMBED: Record<Face, string> = {
  regular: "embedRegular",
  bold: "embedBold",
  italic: "embedItalic",
  boldItalic: "embedBoldItalic",
};

/**
 * A font as a package part: the key's sixteen bytes, last first, XOR the
 * font's first thirty-two. A reader undoes it with the key from the font
 * table; it keeps the font from being a loose file in the package, which is
 * what the format asks of an embedded font.
 */
export function obfuscateFont(font: Uint8Array, key: string): Uint8Array {
  const hex = key.replace(/[{}-]/g, "");
  if (!/^[0-9A-Fa-f]{32}$/.test(hex)) throw new Error(`not a font key: ${key}`);
  const bytes = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).reverse();
  const out = font.slice();
  for (let i = 0; i < 32 && i < out.length; i++) out[i] ^= bytes[i % 16];
  return out;
}

/** A style's id: its name without spaces, which is how the format names its own built-ins. */
export function styleId(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "");
}

const JC: Record<ElementAlign, string> = { left: "left", center: "center", right: "right" };

interface Geometry {
  /** One line, twips. */
  pitch: number;
  /** The text block's width, twips. */
  block: number;
  names: Map<StyleKey, string>;
  styles: Map<StyleKey, ParagraphStyle>;
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

function styleXml(style: ParagraphStyle, doc: WpDocument, g: Geometry): string {
  const size = doc.spec.type.size;
  // pPr in schema order: keepNext, keepLines, pageBreakBefore, widowControl,
  // tabs, spacing, ind, jc, outlineLvl.
  const p: string[] = [];
  if (style.keepWithNext) p.push("<w:keepNext/>");
  if (style.keepTogether) p.push("<w:keepLines/>");
  if (style.pageBreakBefore) p.push("<w:pageBreakBefore/>");
  // Widow control keeps two lines each side; it is all the format can say
  // (docs/app/formatting/formats-and-layout.md#FMT-148).
  p.push(style.orphans >= 2 || style.widows >= 2 ? "<w:widowControl/>" : '<w:widowControl w:val="0"/>');
  if (style.furniture) {
    p.push(`<w:tabs><w:tab w:val="center" w:pos="${Math.round(g.block / 2)}"/><w:tab w:val="right" w:pos="${g.block}"/></w:tabs>`);
  }
  // A header or footer line is as tall as the type, so it reaches no further
  // into the page than the PDF's (docs/app/formatting/formats-and-layout.md#FMT-147).
  const line = style.furniture ? Math.round(size * TWIPS_PER_POINT) : g.pitch;
  p.push(`<w:spacing w:before="${Math.round(style.spaceBeforeRows * g.pitch)}" w:after="0" w:line="${line}" w:lineRule="exact"/>`);
  p.push(`<w:ind w:left="${tw(style.leftIn)}" w:right="${tw(style.rightIn)}"/>`);
  p.push(`<w:jc w:val="${JC[style.align]}"/>`);
  if (style.outlineLevel) p.push(`<w:outlineLvl w:val="${style.outlineLevel - 1}"/>`);
  // rPr in schema order: b, i, caps, spacing, u.
  const r: string[] = [];
  r.push(style.bold ? "<w:b/><w:bCs/>" : "");
  r.push(style.italic ? "<w:i/><w:iCs/>" : "");
  if (style.caps) r.push("<w:caps/>");
  if (style.trackingPt) r.push(`<w:spacing w:val="${Math.round(style.trackingPt * TWIPS_PER_POINT)}"/>`);
  if (style.underline) r.push('<w:u w:val="single"/>');
  const id = g.names.get(style.key)!;
  const builtIn = style.key === "header" || style.key === "footer" || style.key === "title";
  return (
    `<w:style w:type="paragraph"${builtIn ? "" : ' w:customStyle="1"'} w:styleId="${id}">` +
    `<w:name w:val="${esc(style.name)}"/><w:basedOn w:val="Normal"/>` +
    `<w:next w:val="${g.names.get(style.next) ?? id}"/><w:qFormat/>` +
    `<w:pPr>${p.join("")}</w:pPr><w:rPr>${r.join("")}</w:rPr></w:style>`
  );
}

function langXml(language: string): string {
  const primary = language.split("-")[0].toLowerCase();
  const eastAsian = ["zh", "ja", "ko"].includes(primary);
  const complex = ["ar", "he", "fa", "ur", "yi"].includes(primary);
  return `<w:lang w:val="${esc(language)}"${eastAsian ? ` w:eastAsia="${esc(language)}"` : ""}${complex ? ` w:bidi="${esc(language)}"` : ""}/>`;
}

function stylesXml(doc: WpDocument, g: Geometry): string {
  const { primary } = familyNames(doc.spec);
  const halfPoints = Math.round(doc.spec.type.size * 2);
  const font = esc(primary);
  return (
    `${XML_DECLARATION}<w:styles ${NS}>` +
    `<w:docDefaults><w:rPrDefault><w:rPr>` +
    `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>` +
    `<w:sz w:val="${halfPoints}"/><w:szCs w:val="${halfPoints}"/>${langXml(doc.language)}` +
    `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>` +
    `<w:spacing w:before="0" w:after="0" w:line="${g.pitch}" w:lineRule="exact"/>` +
    `</w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
    doc.styles.map((style) => styleXml(style, doc, g)).join("") +
    `</w:styles>`
  );
}

/* ------------------------------------------------------------------ */
/* The body                                                             */
/* ------------------------------------------------------------------ */

function runXml(inline: WpInline): string {
  if (inline.kind === "break") return "<w:r><w:br/></w:r>";
  if (inline.kind === "tab") return "<w:r><w:tab/></w:r>";
  // Direct formatting sets these outright; it does not toggle the style's.
  const props = `${inline.bold ? "<w:b/><w:bCs/>" : ""}${inline.italic ? "<w:i/><w:iCs/>" : ""}${inline.underline ? '<w:u w:val="single"/>' : ""}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(inline.text)}</w:t></w:r>`;
}

/**
 * One paragraph. `lessBefore` takes twips off its space before: what a
 * hairline just above it already took (see `hairline`).
 */
function paragraphXml(p: WpParagraph, g: Geometry, sectPr = "", lessBefore = 0): string {
  // pPr in schema order: pStyle, keepNext, pageBreakBefore, spacing, ind, jc, sectPr.
  const props: string[] = [`<w:pStyle w:val="${g.names.get(p.style)}"/>`];
  if (p.inCell) props.push('<w:keepNext w:val="0"/>');
  if (p.pageBreakBefore !== undefined) props.push(p.pageBreakBefore ? "<w:pageBreakBefore/>" : '<w:pageBreakBefore w:val="0"/>');
  const before = p.spaceBeforeRows ?? g.styles.get(p.style)?.spaceBeforeRows ?? 0;
  if (p.spaceBeforeRows !== undefined || lessBefore) {
    props.push(`<w:spacing w:before="${Math.max(0, Math.round(before * g.pitch) - lessBefore)}"/>`);
  }
  if (p.inCell) props.push('<w:ind w:left="0" w:right="0"/>');
  if (p.align) props.push(`<w:jc w:val="${JC[p.align]}"/>`);
  props.push(sectPr);
  return `<w:p><w:pPr>${props.join("")}</w:pPr>${p.inlines.map(runXml).join("")}</w:p>`;
}

/** How tall a hairline is, twips: one point. */
const HAIRLINE = TWIPS_PER_POINT;

/**
 * A paragraph a point tall: somewhere to hang a section break after a table,
 * which cannot hold one, and the last thing in a body that ends on a table,
 * where a reader would otherwise add a paragraph of its own a whole line tall.
 * The paragraph after it gives the point back from its space before
 * (docs/app/formatting/formats-and-layout.md#FMT-147).
 */
function hairline(sectPr = ""): string {
  // pPr in schema order: spacing, rPr, sectPr.
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:line="${HAIRLINE}" w:lineRule="exact"/>` +
    `<w:rPr><w:sz w:val="2"/></w:rPr>${sectPr}</w:pPr></w:p>`
  );
}

function dualXml(d: WpDual, doc: WpDocument, g: Geometry): string {
  const c = dualColumns(doc.spec);
  const left = tw(c.leftWidthIn + c.gutterIn);
  const right = tw(c.rightWidthIn);
  // A table takes no page break of its own; its first paragraph's breaks the
  // page before the row, which is where the pair belongs.
  const opener = d.left[0] ?? d.right[0];
  const breakFirst = (p: WpParagraph) => (d.pageBreakBefore && p === opener ? { ...p, pageBreakBefore: true } : p);
  const cell = (width: number, padRight: number, paragraphs: WpParagraph[]) =>
    // tcPr in schema order: tcW, tcMar.
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>` +
    (padRight ? `<w:tcMar><w:right w:w="${padRight}" w:type="dxa"/></w:tcMar>` : "") +
    `</w:tcPr>${paragraphs.length ? paragraphs.map((p) => paragraphXml(breakFirst(p), g)).join("") : "<w:p/>"}</w:tc>`;
  return (
    // tblPr in schema order: tblW, tblInd, tblLayout, tblCellMar, tblLook.
    `<w:tbl><w:tblPr><w:tblW w:w="${left + right}" w:type="dxa"/>` +
    `<w:tblInd w:w="${tw(c.leftIn)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>` +
    `<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>` +
    `<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>` +
    `</w:tblPr><w:tblGrid><w:gridCol w:w="${left}"/><w:gridCol w:w="${right}"/></w:tblGrid>` +
    // The pair never splits (docs/app/formatting/formats-and-layout.md#FMT-148).
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
    cell(left, tw(c.gutterIn), d.left) +
    cell(right, 0, d.right) +
    `</w:tr></w:tbl>`
  );
}

/* ------------------------------------------------------------------ */
/* Headers, footers and sections                                        */
/* ------------------------------------------------------------------ */

const PAGE_FIELD = '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>';

/** The three slots on one line: left, then a tab to the centre stop and one to the right. */
function slotsXml(f: Furniture | null): string {
  if (!f) return "";
  const prints = SLOTS.map((slot) => f[slot].length > 1 || f[slot].some(Boolean));
  const last = prints.lastIndexOf(true);
  let out = "";
  SLOTS.forEach((slot, i) => {
    if (i > last) return;
    if (i > 0) out += "<w:r><w:tab/></w:r>";
    out += f[slot]
      .map((text, j) => (j ? PAGE_FIELD : "") + (text ? runXml({ kind: "text", text, bold: false, italic: false, underline: false }) : ""))
      .join("");
  });
  return out;
}

function furniturePart(tag: "hdr" | "ftr", f: Furniture | null, g: Geometry): string {
  const style = g.names.get(tag === "hdr" ? "header" : "footer");
  return `${XML_DECLARATION}<w:${tag} ${NS}><w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${slotsXml(f)}</w:p></w:${tag}>`;
}

class Parts {
  readonly entries: ZipEntry[] = [];
  readonly rels: { id: string; type: string; target: string }[] = [];
  readonly overrides: { part: string; type: string }[] = [];
  private readonly byXml = new Map<string, string>();
  private count = { hdr: 0, ftr: 0 };

  /** The relationship id of a header or footer part holding this XML, written once. */
  furniture(tag: "hdr" | "ftr", xml: string): string {
    const known = this.byXml.get(xml);
    if (known) return known;
    const n = ++this.count[tag];
    const name = `${tag === "hdr" ? "header" : "footer"}${n}.xml`;
    const id = `rId${tag}${n}`;
    this.entries.push({ path: `word/${name}`, data: xml });
    this.rels.push({ id, type: `${REL}/${tag === "hdr" ? "header" : "footer"}`, target: name });
    this.overrides.push({ part: `/word/${name}`, type: `${CT}.${tag === "hdr" ? "header" : "footer"}+xml` });
    this.byXml.set(xml, id);
    return id;
  }
}

function sectPrXml(section: WpSection, doc: WpDocument, g: Geometry, parts: Parts, furnished: { header: boolean; footer: boolean }): string {
  const { spec } = doc;
  const m = spec.page.margins;
  const { widthIn, heightIn } = PAGE_SIZES[spec.page.size];
  const refs: string[] = [];
  if (section.kind === "script") {
    const bare = section.bareFirstPage;
    const titlePage = !!bare && (bare.header || bare.footer);
    // A section that names no part inherits the one before's, so every script
    // section names its own — an empty one where its slots print nothing.
    for (const [tag, on, f, off] of [
      ["hdr", furnished.header, section.header, bare?.header],
      ["ftr", furnished.footer, section.footer, bare?.footer],
    ] as const) {
      if (!on) continue;
      const element = tag === "hdr" ? "headerReference" : "footerReference";
      refs.push(`<w:${element} w:type="default" r:id="${parts.furniture(tag, furniturePart(tag, f, g))}"/>`);
      if (titlePage) {
        refs.push(`<w:${element} w:type="first" r:id="${parts.furniture(tag, furniturePart(tag, off ? null : f, g))}"/>`);
      }
    }
  }
  // sectPr in schema order: references, type, pgSz, pgMar, pgNumType, titlePg.
  const type = section.begins === "document" ? "" : `<w:type w:val="${section.begins === "page" ? "nextPage" : "continuous"}"/>`;
  const width = tw(widthIn);
  const height = tw(heightIn);
  // The header's text top and the footer's text bottom, from the paper edge
  // (docs/app/formatting/formats-and-layout.md#FMT-101), where they leave the
  // text all its rows (docs/app/formatting/formats-and-layout.md#FMT-147).
  const at = furniturePositions(spec);
  const margins =
    `<w:pgMar w:top="${tw(m.top)}" w:right="${tw(m.right)}" w:bottom="${tw(m.bottom)}" w:left="${tw(m.left)}" ` +
    `w:header="${tw(at.headerIn)}" w:footer="${tw(at.footerIn)}" w:gutter="0"/>`;
  const numbering = section.firstPageNumber !== undefined ? `<w:pgNumType w:start="${section.firstPageNumber}"/>` : "";
  const titlePg = section.bareFirstPage && (section.bareFirstPage.header || section.bareFirstPage.footer) ? "<w:titlePg/>" : "";
  return `<w:sectPr>${refs.join("")}${type}<w:pgSz w:w="${width}" w:h="${height}"/>${margins}${numbering}${titlePg}</w:sectPr>`;
}

function bodyXml(doc: WpDocument, g: Geometry, parts: Parts): string {
  const furnished = {
    header: doc.sections.some((s) => s.header),
    footer: doc.sections.some((s) => s.footer),
  };
  const out: string[] = [];
  // Twips a hairline took that the next paragraph gives back from its space before.
  let owed = 0;
  doc.sections.forEach((section, i) => {
    const sectPr = sectPrXml(section, doc, g, parts, furnished);
    const final = i === doc.sections.length - 1;
    section.items.forEach((item, j) => {
      // A section's properties ride on its last paragraph; the last section's close the body.
      const last = j === section.items.length - 1;
      const closes = !final && last;
      if (item.kind === "dual") {
        out.push(dualXml(item, doc, g));
        owed = 0;
        if (closes || (final && last)) {
          out.push(hairline(closes ? sectPr : ""));
          owed = HAIRLINE;
        }
      } else {
        out.push(paragraphXml(item, g, closes ? sectPr : "", owed));
        owed = 0;
      }
    });
    if (!section.items.length && !final) out.push(hairline(sectPr));
    if (final) out.push(sectPr);
  });
  return `${XML_DECLARATION}<w:document ${NS}><w:body>${out.join("")}</w:body></w:document>`;
}

/* ------------------------------------------------------------------ */
/* The package                                                          */
/* ------------------------------------------------------------------ */

export function writeDocx(doc: WpDocument, fonts: FontFaces): Uint8Array {
  const { primary, fallback } = familyNames(doc.spec);
  const names = new Map<StyleKey, string>(doc.styles.map((style) => [style.key, styleId(style.name)]));
  const g: Geometry = {
    pitch: Math.round(linePitchIn(doc.spec) * TWIPS_PER_INCH),
    block: tw(textBlockWidthIn(doc.spec)),
    names,
    styles: new Map(doc.styles.map((style) => [style.key, style])),
  };
  const parts = new Parts();
  const body = bodyXml(doc, g, parts);

  const fontRels = FACES.map((face, i) => ({ id: `rIdFont${i + 1}`, face, target: `fonts/font${i + 1}.odttf` }));
  // CT_Font in schema order: altName, family, pitch, then the embeds.
  const fontTable =
    `${XML_DECLARATION}<w:fonts ${NS}>` +
    `<w:font w:name="${esc(primary)}"><w:altName w:val="${esc(fallback)}"/><w:family w:val="modern"/><w:pitch w:val="fixed"/>` +
    fontRels.map((rel) => `<w:${EMBED[rel.face]} r:id="${rel.id}" w:fontKey="${FONT_KEY[rel.face]}"/>`).join("") +
    `</w:font><w:font w:name="${esc(fallback)}"><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font></w:fonts>`;

  const settings =
    `${XML_DECLARATION}<w:settings ${NS}><w:embedTrueTypeFonts/><w:defaultTabStop w:val="${TWIPS_PER_INCH / 2}"/>` +
    `<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>` +
    `</w:settings>`;

  const relsXml = (rels: { id: string; type: string; target: string }[]) =>
    `${XML_DECLARATION}<Relationships xmlns="${PKG_REL}">` +
    rels.map((rel) => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/>`).join("") +
    `</Relationships>`;

  const documentRels = [
    { id: "rIdStyles", type: `${REL}/styles`, target: "styles.xml" },
    { id: "rIdSettings", type: `${REL}/settings`, target: "settings.xml" },
    { id: "rIdFonts", type: `${REL}/fontTable`, target: "fontTable.xml" },
    ...parts.rels,
  ];

  const core =
    `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${esc(doc.title)}</dc:title>${doc.author ? `<dc:creator>${esc(doc.author)}</dc:creator>` : ""}` +
    `<dc:language>${esc(doc.language)}</dc:language></cp:coreProperties>`;
  const app =
    `${XML_DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
    `<Application>Proscenium</Application></Properties>`;

  const contentTypes =
    `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>` +
    `<Override PartName="/word/document.xml" ContentType="${CT}.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="${CT}.styles+xml"/>` +
    `<Override PartName="/word/settings.xml" ContentType="${CT}.settings+xml"/>` +
    `<Override PartName="/word/fontTable.xml" ContentType="${CT}.fontTable+xml"/>` +
    parts.overrides.map((o) => `<Override PartName="${o.part}" ContentType="${o.type}"/>`).join("") +
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
    `</Types>`;

  return zipEntries([
    { path: "[Content_Types].xml", data: contentTypes },
    {
      path: "_rels/.rels",
      data: relsXml([
        { id: "rIdDocument", type: `${REL}/officeDocument`, target: "word/document.xml" },
        { id: "rIdCore", type: `${PKG_REL}/metadata/core-properties`, target: "docProps/core.xml" },
        { id: "rIdApp", type: `${REL}/extended-properties`, target: "docProps/app.xml" },
      ]),
    },
    { path: "word/document.xml", data: body },
    { path: "word/_rels/document.xml.rels", data: relsXml(documentRels) },
    { path: "word/styles.xml", data: stylesXml(doc, g) },
    { path: "word/settings.xml", data: settings },
    { path: "word/fontTable.xml", data: fontTable },
    {
      path: "word/_rels/fontTable.xml.rels",
      data: relsXml(fontRels.map((rel) => ({ id: rel.id, type: `${REL}/font`, target: rel.target }))),
    },
    ...fontRels.map((rel) => ({ path: `word/${rel.target}`, data: obfuscateFont(fonts[rel.face], FONT_KEY[rel.face]) })),
    ...parts.entries,
    { path: "docProps/core.xml", data: core },
    { path: "docProps/app.xml", data: app },
  ]);
}
