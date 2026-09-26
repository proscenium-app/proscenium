// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The document model as an .odt: OpenDocument 1.3 text in its zip package
 * (docs/app/formatting/formats-and-layout.md#FMT-D109).
 *
 * Headers and footers belong to master pages, not to stretches of text, so
 * the act and scene a header prints are string variables: set, invisibly, at
 * the start of each section the model begins at a heading, and read in the
 * header, where a reader evaluates them for each page as it begins
 * (docs/app/formatting/formats-and-layout.md#FMT-151). Each slot is its text
 * around page-number fields, so a slot is one variable per stretch of text —
 * which keeps an empty act number's separator out too
 * (docs/app/formatting/formats-and-layout.md#FMT-142).
 */
import { PAGE_SIZES, linePitchIn, textBlockWidthIn, type HeaderFooterSpec } from "../format/spec";
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
import { XML_DECLARATION, esc, num } from "./xml";
import { zipEntries } from "./zip";

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
].join(" ");

const MIMETYPE = "application/vnd.oasis.opendocument.text";

const FONT_FILE: Record<Face, string> = {
  regular: "Fonts/CourierPrime-Regular.ttf",
  bold: "Fonts/CourierPrime-Bold.ttf",
  italic: "Fonts/CourierPrime-Italic.ttf",
  boldItalic: "Fonts/CourierPrime-BoldItalic.ttf",
};

/** A style's name: its display name with each space written `_20_`, as the format's own readers do. */
export function styleName(display: string): string {
  return display.replace(/ /g, "_20_").replace(/[^A-Za-z0-9_.-]/g, "");
}

const inches = (value: number) => `${num(value)}in`;
const points = (value: number) => `${num(value)}pt`;
/** No length at all: an edge a style or cell leaves flush. */
const NONE = inches(0);

interface Geometry {
  pitchPt: number;
  blockIn: number;
  names: Map<StyleKey, string>;
}

/* ------------------------------------------------------------------ */
/* Language and type                                                    */
/* ------------------------------------------------------------------ */

/** The play's language as the text properties spell it: language, country, script, and the whole tag. */
function languageAttrs(tag: string): string {
  let language = tag;
  let region = "";
  let script = "";
  try {
    const locale = new Intl.Locale(tag);
    language = locale.language;
    region = locale.region ?? "";
    script = locale.script ?? "";
  } catch {
    // canonicalLanguage accepted it before the export began; keep it whole.
  }
  const western = `fo:language="${esc(language)}"${region ? ` fo:country="${esc(region)}"` : ""}${script ? ` fo:script="${esc(script)}"` : ""} style:rfc-language-tag="${esc(tag)}"`;
  const asian = ["zh", "ja", "ko"].includes(language)
    ? ` style:language-asian="${esc(language)}"${region ? ` style:country-asian="${esc(region)}"` : ""} style:rfc-language-tag-asian="${esc(tag)}"`
    : "";
  const complex = ["ar", "he", "fa", "ur", "yi"].includes(language)
    ? ` style:language-complex="${esc(language)}"${region ? ` style:country-complex="${esc(region)}"` : ""} style:rfc-language-tag-complex="${esc(tag)}"`
    : "";
  return western + asian + complex;
}

function fontDecls(doc: WpDocument): string {
  const { primary, fallback } = familyNames(doc.spec);
  const uri = (face: Face) =>
    `<svg:font-face-uri xlink:href="${FONT_FILE[face]}" xlink:type="simple"><svg:font-face-format svg:string="truetype"/></svg:font-face-uri>`;
  return (
    `<office:font-face-decls>` +
    `<style:font-face style:name="${esc(primary)}" svg:font-family="'${esc(primary)}'" style:font-family-generic="modern" style:font-pitch="fixed">` +
    `<svg:font-face-src>${FACES.map(uri).join("")}</svg:font-face-src></style:font-face>` +
    `<style:font-face style:name="${esc(fallback)}" svg:font-family="'${esc(fallback)}'" style:font-family-generic="modern" style:font-pitch="fixed"/>` +
    `</office:font-face-decls>`
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

function textProps(o: { bold?: boolean; italic?: boolean; underline?: boolean; caps?: boolean; trackingPt?: number }): string {
  const attrs: string[] = [];
  if (o.bold) attrs.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"');
  if (o.italic) attrs.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"');
  if (o.underline) attrs.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
  if (o.caps) attrs.push('fo:text-transform="uppercase"');
  if (o.trackingPt) attrs.push(`fo:letter-spacing="${points(o.trackingPt)}"`);
  return attrs.length ? `<style:text-properties ${attrs.join(" ")}/>` : "";
}

function styleXml(style: ParagraphStyle, doc: WpDocument, g: Geometry): string {
  const lineHeight = style.furniture ? points(doc.spec.type.size) : points(g.pitchPt);
  const para = [
    `fo:margin-left="${inches(style.leftIn)}"`,
    `fo:margin-right="${inches(style.rightIn)}"`,
    `fo:margin-top="${points(style.spaceBeforeRows * g.pitchPt)}"`,
    `fo:margin-bottom="${NONE}"`,
    `fo:text-align="${style.align}"`,
    `fo:line-height="${lineHeight}"`,
    `fo:keep-with-next="${style.keepWithNext ? "always" : "auto"}"`,
    `fo:keep-together="${style.keepTogether ? "always" : "auto"}"`,
    ...(style.pageBreakBefore ? ['fo:break-before="page"'] : []),
    // The format's minimums exactly (docs/app/formatting/formats-and-layout.md#FMT-148).
    `fo:orphans="${style.orphans}"`,
    `fo:widows="${style.widows}"`,
  ];
  const tabs = style.furniture
    ? `<style:tab-stops><style:tab-stop style:position="${inches(g.blockIn / 2)}" style:type="center"/>` +
      `<style:tab-stop style:position="${inches(g.blockIn)}" style:type="right"/></style:tab-stops>`
    : "";
  const outline = style.outlineLevel ? ` style:default-outline-level="${style.outlineLevel}"` : "";
  const next = g.names.get(style.next) ?? g.names.get(style.key)!;
  return (
    `<style:style style:name="${g.names.get(style.key)}" style:display-name="${esc(style.name)}" style:family="paragraph" ` +
    `style:parent-style-name="Standard" style:next-style-name="${next}"${outline}>` +
    `<style:paragraph-properties ${para.join(" ")}>${tabs}</style:paragraph-properties>` +
    textProps(style) +
    `</style:style>`
  );
}

/** A page layout: the format's paper and margins, with room for a header or footer where there is one. */
function pageLayout(name: string, doc: WpDocument, header: boolean, footer: boolean): string {
  const { spec } = doc;
  const m = spec.page.margins;
  const { widthIn, heightIn } = PAGE_SIZES[spec.page.size];
  const lineIn = spec.type.size / 72;
  // The header's text top sits its distance below the paper's edge, and the
  // space between its line and the body makes up the top margin
  // (docs/app/formatting/formats-and-layout.md#FMT-147). The footer mirrors it.
  const at = furniturePositions(spec);
  const top = header ? at.headerIn : m.top;
  const bottom = footer ? at.footerIn : m.bottom;
  const headerStyle = header
    ? `<style:header-style><style:header-footer-properties fo:min-height="${NONE}" fo:margin-bottom="${inches(Math.max(0, m.top - at.headerIn - lineIn))}" style:dynamic-spacing="false"/></style:header-style>`
    : "<style:header-style/>";
  const footerStyle = footer
    ? `<style:footer-style><style:header-footer-properties fo:min-height="${NONE}" fo:margin-top="${inches(Math.max(0, m.bottom - at.footerIn - lineIn))}" style:dynamic-spacing="false"/></style:footer-style>`
    : "<style:footer-style/>";
  return (
    `<style:page-layout style:name="${name}"><style:page-layout-properties fo:page-width="${inches(widthIn)}" ` +
    `fo:page-height="${inches(heightIn)}" style:print-orientation="portrait" fo:margin-top="${inches(top)}" ` +
    `fo:margin-bottom="${inches(bottom)}" fo:margin-left="${inches(m.left)}" fo:margin-right="${inches(m.right)}"/>` +
    `${headerStyle}${footerStyle}</style:page-layout>`
  );
}

/* ------------------------------------------------------------------ */
/* Headers and footers                                                  */
/* ------------------------------------------------------------------ */

/** The variable that holds one stretch of a slot's text: `hdr_left_0`. */
const variable = (tag: "hdr" | "ftr", slot: string, index: number) => `${tag}_${slot}_${index}`;

/** How many stretches of text each slot has: one more than its page numbers. */
function shape(hf: HeaderFooterSpec): Record<string, number> {
  return Object.fromEntries(SLOTS.map((slot) => [slot, (hf.content[slot]?.match(/\{page\}/g) ?? []).length + 1]));
}

const PAGE_FIELD = '<text:page-number text:select-page="current">1</text:page-number>';

/**
 * One header or footer line: literal text when it never changes, or the
 * variables the sections set when it follows the headings.
 */
function furnitureLine(tag: "hdr" | "ftr", f: Furniture | null, hf: HeaderFooterSpec, doc: WpDocument, style: string): string {
  const counts = shape(hf);
  const prints = SLOTS.map((slot) => counts[slot] > 1 || (!!f && f[slot].some(Boolean)) || (doc.followsHeadings && !!hf.content[slot]));
  const last = prints.lastIndexOf(true);
  let out = "";
  const state: TextState = { atStart: true, afterSpace: false };
  SLOTS.forEach((slot, i) => {
    if (i > last) return;
    if (i > 0) {
      out += "<text:tab/>";
      Object.assign(state, { atStart: true, afterSpace: false });
    }
    for (let k = 0; k < counts[slot]; k++) {
      if (k) out += PAGE_FIELD;
      out += doc.followsHeadings
        ? `<text:variable-get text:name="${variable(tag, slot, k)}" office:value-type="string"/>`
        : textXml(f?.[slot][k] ?? "", state);
    }
  });
  return `<text:p text:style-name="${style}">${out}</text:p>`;
}

/** The variables a section sets where it begins: what its header and footer print until the next. */
function variableSets(section: WpSection, doc: WpDocument): string {
  if (!doc.followsHeadings || section.kind !== "script") return "";
  let out = "";
  for (const [tag, hf, f] of [["hdr", doc.spec.header, section.header], ["ftr", doc.spec.footer, section.footer]] as const) {
    const counts = shape(hf);
    for (const slot of SLOTS) {
      for (let k = 0; k < counts[slot]; k++) {
        out += `<text:variable-set text:name="${variable(tag, slot, k)}" office:value-type="string" office:string-value="${esc(f?.[slot][k] ?? "")}" text:display="none"/>`;
      }
    }
  }
  return out;
}

function variableDecls(doc: WpDocument): string {
  if (!doc.followsHeadings) return "";
  let out = "";
  for (const [tag, hf] of [["hdr", doc.spec.header], ["ftr", doc.spec.footer]] as const) {
    const counts = shape(hf);
    for (const slot of SLOTS) {
      for (let k = 0; k < counts[slot]; k++) out += `<text:variable-decl text:name="${variable(tag, slot, k)}" office:value-type="string"/>`;
    }
  }
  return `<text:variable-decls>${out}</text:variable-decls>`;
}

/* ------------------------------------------------------------------ */
/* Text                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Text as a reader will keep it. A reader collapses runs of spaces and drops
 * them at a paragraph's start, so every space there, or after another, is a
 * `text:s` — which a reader always keeps, and which the importer reads back
 * as a space.
 */
function textXml(text: string, state: TextState): string {
  let out = "";
  let kept = 0;
  const flush = () => {
    if (kept) out += kept === 1 ? "<text:s/>" : `<text:s text:c="${kept}"/>`;
    kept = 0;
  };
  for (const ch of text) {
    if (ch === " ") {
      if (state.atStart || state.afterSpace) kept++;
      else out += " ";
      state.afterSpace = true;
      continue;
    }
    flush();
    out += esc(ch);
    state.atStart = false;
    state.afterSpace = false;
  }
  flush();
  return out;
}

/** Where a paragraph's text has got to, across its spans. */
interface TextState {
  atStart: boolean;
  afterSpace: boolean;
}

class AutoStyles {
  private readonly paragraphs = new Map<string, string>();
  private readonly texts = new Map<string, string>();
  private tables = 0;
  readonly xml: string[] = [];

  /** A name for the next dual-dialogue table. */
  nextTable(): string {
    return `Dual${++this.tables}`;
  }

  paragraph(parent: string, props: string[], master: string | null): string {
    const key = `${parent}|${props.join(" ")}|${master ?? ""}`;
    const known = this.paragraphs.get(key);
    if (known) return known;
    const name = `P${this.paragraphs.size + 1}`;
    this.paragraphs.set(key, name);
    this.xml.push(
      `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${parent}"` +
        `${master ? ` style:master-page-name="${master}"` : ""}>` +
        (props.length ? `<style:paragraph-properties ${props.join(" ")}/>` : "") +
        `</style:style>`,
    );
    return name;
  }

  text(o: { bold: boolean; italic: boolean; underline: boolean }): string | null {
    if (!o.bold && !o.italic && !o.underline) return null;
    const key = `${o.bold}${o.italic}${o.underline}`;
    const known = this.texts.get(key);
    if (known) return known;
    const name = `T${this.texts.size + 1}`;
    this.texts.set(key, name);
    this.xml.push(`<style:style style:name="${name}" style:family="text">${textProps(o)}</style:style>`);
    return name;
  }

  table(xml: string): void {
    this.xml.push(xml);
  }
}

/** Where a section begins, told to its first paragraph or table. */
interface Opening {
  master: string | null;
  pageNumber: number | null;
  sets: string;
}

function inlinesXml(inlines: WpInline[], auto: AutoStyles): string {
  const state: TextState = { atStart: true, afterSpace: false };
  return inlines
    .map((inline) => {
      if (inline.kind === "break" || inline.kind === "tab") {
        Object.assign(state, { atStart: true, afterSpace: false });
        return inline.kind === "break" ? "<text:line-break/>" : "<text:tab/>";
      }
      const body = textXml(inline.text, state);
      const span = auto.text(inline);
      return span ? `<text:span text:style-name="${span}">${body}</text:span>` : body;
    })
    .join("");
}

function paragraphXml(p: WpParagraph, g: Geometry, auto: AutoStyles, opening: Opening | null): string {
  const props: string[] = [];
  if (p.spaceBeforeRows !== undefined) props.push(`fo:margin-top="${points(p.spaceBeforeRows * g.pitchPt)}"`);
  if (p.pageBreakBefore !== undefined) props.push(`fo:break-before="${p.pageBreakBefore ? "page" : "auto"}"`);
  if (p.align) props.push(`fo:text-align="${p.align}"`);
  if (p.inCell) props.push(`fo:margin-left="${NONE}" fo:margin-right="${NONE}" fo:keep-with-next="auto"`);
  if (opening?.pageNumber) props.push(`style:page-number="${opening.pageNumber}"`);
  const parent = g.names.get(p.style)!;
  const name = props.length || opening?.master ? auto.paragraph(parent, props, opening?.master ?? null) : parent;
  const level = p.style === "act" ? 1 : p.style === "scene" ? 2 : p.style === "sceneHeading" ? 3 : 0;
  const body = (opening?.sets ?? "") + inlinesXml(p.inlines, auto);
  return level
    ? `<text:h text:style-name="${name}" text:outline-level="${level}">${body}</text:h>`
    : `<text:p text:style-name="${name}">${body}</text:p>`;
}

function dualXml(d: WpDual, doc: WpDocument, g: Geometry, auto: AutoStyles, opening: Opening | null): string {
  const c = dualColumns(doc.spec);
  const name = auto.nextTable();
  const leftWidth = c.leftWidthIn + c.gutterIn;
  const breakBefore = d.pageBreakBefore ? ' fo:break-before="page"' : "";
  const pageNumber = opening?.pageNumber ? ` style:page-number="${opening.pageNumber}"` : "";
  auto.table(
    `<style:style style:name="${name}" style:family="table"${opening?.master ? ` style:master-page-name="${opening.master}"` : ""}>` +
      `<style:table-properties style:width="${inches(leftWidth + c.rightWidthIn)}" fo:margin-left="${inches(c.leftIn)}" ` +
      `table:align="left"${breakBefore}${pageNumber}/></style:style>` +
      `<style:style style:name="${name}.A" style:family="table-column"><style:table-column-properties style:column-width="${inches(leftWidth)}"/></style:style>` +
      `<style:style style:name="${name}.B" style:family="table-column"><style:table-column-properties style:column-width="${inches(c.rightWidthIn)}"/></style:style>` +
      // The pair never splits (docs/app/formatting/formats-and-layout.md#FMT-148).
      `<style:style style:name="${name}.1" style:family="table-row"><style:table-row-properties fo:keep-together="always"/></style:style>` +
      `<style:style style:name="${name}.A1" style:family="table-cell"><style:table-cell-properties fo:padding="${NONE}" fo:padding-right="${inches(c.gutterIn)}" fo:border="none"/></style:style>` +
      `<style:style style:name="${name}.B1" style:family="table-cell"><style:table-cell-properties fo:padding="${NONE}" fo:border="none"/></style:style>`,
  );
  const cell = (style: string, paragraphs: WpParagraph[], sets: string) => {
    const inner = paragraphs.length
      ? paragraphs.map((p, i) => paragraphXml(p, g, auto, i === 0 && sets ? { master: null, pageNumber: null, sets } : null)).join("")
      : `<text:p text:style-name="Standard">${sets}</text:p>`;
    return `<table:table-cell table:style-name="${style}" office:value-type="string">${inner}</table:table-cell>`;
  };
  return (
    `<table:table table:name="${name}" table:style-name="${name}">` +
    `<table:table-column table:style-name="${name}.A"/><table:table-column table:style-name="${name}.B"/>` +
    `<table:table-row table:style-name="${name}.1">` +
    cell(`${name}.A1`, d.left, opening?.sets ?? "") +
    cell(`${name}.B1`, d.right, "") +
    `</table:table-row></table:table>`
  );
}

/* ------------------------------------------------------------------ */
/* The package                                                          */
/* ------------------------------------------------------------------ */

export function writeOdt(doc: WpDocument, fonts: FontFaces): Uint8Array {
  const { spec } = doc;
  const names = new Map<StyleKey, string>(doc.styles.map((style) => [style.key, styleName(style.name)]));
  const g: Geometry = { pitchPt: linePitchIn(spec) * 72, blockIn: textBlockWidthIn(spec), names };
  const auto = new AutoStyles();

  // Master pages: the opening sheets bare, the script with its furniture, and
  // the script's first page without what the format leaves off it.
  const script = doc.sections.filter((s) => s.kind === "script");
  const hasHeader = script.some((s) => s.header);
  const hasFooter = script.some((s) => s.footer);
  const bare = script.find((s) => s.bareFirstPage)?.bareFirstPage;
  const firstHeader = hasHeader && !bare?.header;
  const firstFooter = hasFooter && !bare?.footer;
  const firstMaster = bare && (bare.header || bare.footer) ? "Script_20_First" : "Script";
  const sample = script[0];

  const masters =
    `<style:master-page style:name="Front" style:display-name="Opening Pages" style:page-layout-name="PageFront"/>` +
    `<style:master-page style:name="Script" style:page-layout-name="PageScript">` +
    (hasHeader ? `<style:header>${furnitureLine("hdr", sample?.header ?? null, spec.header, doc, names.get("header")!)}</style:header>` : "") +
    (hasFooter ? `<style:footer>${furnitureLine("ftr", sample?.footer ?? null, spec.footer, doc, names.get("footer")!)}</style:footer>` : "") +
    `</style:master-page>` +
    (firstMaster !== "Script"
      ? `<style:master-page style:name="Script_20_First" style:display-name="Script First Page" style:page-layout-name="PageScriptFirst" style:next-style-name="Script">` +
        (firstHeader ? `<style:header>${furnitureLine("hdr", sample?.header ?? null, spec.header, doc, names.get("header")!)}</style:header>` : "") +
        (firstFooter ? `<style:footer>${furnitureLine("ftr", sample?.footer ?? null, spec.footer, doc, names.get("footer")!)}</style:footer>` : "") +
        `</style:master-page>`
      : "");

  const body: string[] = [variableDecls(doc)];
  for (const section of doc.sections) {
    const opens: Opening = {
      master:
        section.kind === "front"
          ? "Front"
          : section.firstPageNumber !== undefined
            ? section.bareFirstPage
              ? firstMaster
              : "Script"
            : null,
      pageNumber: section.kind === "script" ? (section.firstPageNumber ?? null) : null,
      sets: variableSets(section, doc),
    };
    section.items.forEach((item, i) => {
      const opening = i === 0 ? opens : null;
      body.push(item.kind === "dual" ? dualXml(item, doc, g, auto, opening) : paragraphXml(item, g, auto, opening));
    });
    if (!section.items.length && (opens.master || opens.sets)) {
      body.push(paragraphXml({ kind: "p", style: "action", inlines: [] }, g, auto, opens));
    }
  }

  const standard =
    `<style:default-style style:family="paragraph"><style:paragraph-properties fo:orphans="2" fo:widows="2"/>` +
    `<style:text-properties style:font-name="${esc(familyNames(spec).primary)}" fo:font-size="${points(spec.type.size)}" ` +
    `style:font-name-asian="${esc(familyNames(spec).primary)}" style:font-size-asian="${points(spec.type.size)}" ` +
    `style:font-name-complex="${esc(familyNames(spec).primary)}" style:font-size-complex="${points(spec.type.size)}" ` +
    `${languageAttrs(doc.language)}/></style:default-style>` +
    `<style:style style:name="Standard" style:family="paragraph" style:class="text">` +
    `<style:paragraph-properties fo:margin-top="${NONE}" fo:margin-bottom="${NONE}" fo:line-height="${points(g.pitchPt)}"/></style:style>`;

  const stylesXml =
    `${XML_DECLARATION}<office:document-styles ${NS} office:version="1.3">${fontDecls(doc)}` +
    `<office:styles>${standard}${doc.styles.map((style) => styleXml(style, doc, g)).join("")}</office:styles>` +
    `<office:automatic-styles>` +
    pageLayout("PageFront", doc, false, false) +
    pageLayout("PageScript", doc, hasHeader, hasFooter) +
    pageLayout("PageScriptFirst", doc, firstHeader, firstFooter) +
    `</office:automatic-styles><office:master-styles>${masters}</office:master-styles></office:document-styles>`;

  const contentXml =
    `${XML_DECLARATION}<office:document-content ${NS} office:version="1.3">${fontDecls(doc)}` +
    `<office:automatic-styles>${auto.xml.join("")}</office:automatic-styles>` +
    `<office:body><office:text>${body.join("")}</office:text></office:body></office:document-content>`;

  const metaXml =
    `${XML_DECLARATION}<office:document-meta ${NS} office:version="1.3"><office:meta>` +
    `<meta:generator>Proscenium</meta:generator><dc:title>${esc(doc.title)}</dc:title>` +
    (doc.author ? `<meta:initial-creator>${esc(doc.author)}</meta:initial-creator><dc:creator>${esc(doc.author)}</dc:creator>` : "") +
    `<dc:language>${esc(doc.language)}</dc:language></office:meta></office:document-meta>`;

  const manifest =
    `${XML_DECLARATION}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">` +
    `<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="${MIMETYPE}"/>` +
    ["content.xml", "styles.xml", "meta.xml"]
      .map((path) => `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="text/xml"/>`)
      .join("") +
    FACES.map((face) => `<manifest:file-entry manifest:full-path="${FONT_FILE[face]}" manifest:media-type="application/x-font-ttf"/>`).join("") +
    `</manifest:manifest>`;

  return zipEntries([
    // First, and stored: how a reader knows what the package is.
    { path: "mimetype", data: MIMETYPE, store: true },
    { path: "content.xml", data: contentXml },
    { path: "styles.xml", data: stylesXml },
    { path: "meta.xml", data: metaXml },
    ...FACES.map((face) => ({ path: FONT_FILE[face], data: fonts[face] })),
    { path: "META-INF/manifest.xml", data: manifest },
  ]);
}
