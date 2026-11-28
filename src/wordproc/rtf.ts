// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The document model as an .rtf: Rich Text Format 1.9.1, the one file almost
 * every word processor and text editor opens
 * (docs/app/formatting/formats-and-layout.md#FMT-173).
 *
 * RTF has paragraph styles, but a reader does not apply them: a style only
 * names what a paragraph is, and each paragraph states its own properties
 * again. So every paragraph below restates its style in full, then whatever
 * it changes.
 *
 * Act and scene headers are a section per heading, as in a .docx
 * (docs/app/formatting/formats-and-layout.md#FMT-151). A paragraph that closes
 * a section ends in the section break rather than a paragraph mark, so the
 * break adds no empty line of its own.
 *
 * Every character past ASCII is a `\u` escape, so the file is plain ASCII and
 * needs no code page.
 */
import { PAGE_SIZES, linePitchIn, textBlockWidthIn, type ElementAlign } from "../format/spec";
import { familyNames } from "./fonts";
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

const TWIPS_PER_INCH = 1440;
const TWIPS_PER_POINT = 20;
const tw = (inches: number) => Math.round(inches * TWIPS_PER_INCH);

/** Text as RTF: its three special characters escaped, anything past ASCII as `\uN?`. */
export function rtfText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const c = text[i];
    if (c === "\\" || c === "{" || c === "}") out += `\\${c}`;
    else if (code >= 0x20 && code < 0x7f) out += c;
    // A signed 16-bit number, one per UTF-16 unit, so a surrogate pair is two;
    // `?` is what a reader that cannot show it shows instead (`\uc1`).
    else if (code >= 0x80) out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`;
    // Control characters have no place in a paragraph's words.
  }
  return out;
}

/**
 * Windows language numbers: RTF names a language by one, not by its tag. The
 * tag's own region first, then the region a reader most likely means by the
 * language alone (`Intl.Locale.maximize`), then the language.
 */
const LCID: Record<string, number> = {
  "af-ZA": 1078,
  "ar-EG": 3073,
  "ar-SA": 1025,
  "bg-BG": 1026,
  "ca-ES": 1027,
  "cs-CZ": 1029,
  "cy-GB": 1106,
  "da-DK": 1030,
  "de-AT": 3079,
  "de-CH": 2055,
  "de-DE": 1031,
  "el-GR": 1032,
  "en-AU": 3081,
  "en-CA": 4105,
  "en-GB": 2057,
  "en-IE": 6153,
  "en-IN": 16393,
  "en-NZ": 5129,
  "en-US": 1033,
  "en-ZA": 7177,
  "es-419": 22538,
  "es-AR": 11274,
  "es-ES": 3082,
  "es-MX": 2058,
  "es-US": 21514,
  "et-EE": 1061,
  "eu-ES": 1069,
  "fa-IR": 1065,
  "fi-FI": 1035,
  "fr-BE": 2060,
  "fr-CA": 3084,
  "fr-CH": 4108,
  "fr-FR": 1036,
  "ga-IE": 2108,
  "gl-ES": 1110,
  "he-IL": 1037,
  "hi-IN": 1081,
  "hr-HR": 1050,
  "hu-HU": 1038,
  "id-ID": 1057,
  "is-IS": 1039,
  "it-CH": 2064,
  "it-IT": 1040,
  "ja-JP": 1041,
  "ko-KR": 1042,
  "lt-LT": 1063,
  "lv-LV": 1062,
  "ms-MY": 1086,
  "nb-NO": 1044,
  "nl-BE": 2067,
  "nl-NL": 1043,
  "nn-NO": 2068,
  "pl-PL": 1045,
  "pt-BR": 1046,
  "pt-PT": 2070,
  "ro-RO": 1048,
  "ru-RU": 1049,
  "sk-SK": 1051,
  "sl-SI": 1060,
  "sv-SE": 1053,
  "sw-KE": 1089,
  "th-TH": 1054,
  "tr-TR": 1055,
  "uk-UA": 1058,
  "ur-PK": 1056,
  "vi-VN": 1066,
  "yi-001": 1085,
  "zh-CN": 2052,
  "zh-HK": 3076,
  "zh-SG": 4100,
  "zh-TW": 1028,
};

/** The play's language as a Windows language number, or null where it has none. */
export function languageNumber(tag: string): number | null {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag);
  } catch {
    return null;
  }
  const language = locale.language === "no" ? "nb" : locale.language;
  const likely = (() => {
    try {
      return locale.maximize().region;
    } catch {
      return undefined;
    }
  })();
  for (const region of [locale.region, likely]) {
    if (region && LCID[`${language}-${region}`]) return LCID[`${language}-${region}`];
  }
  // The language alone: the first region the table lists for it.
  const any = Object.keys(LCID).find((key) => key.startsWith(`${language}-`));
  return any ? LCID[any] : null;
}

const ALIGN: Record<ElementAlign, string> = { left: "\\ql", center: "\\qc", right: "\\qr" };

interface Geometry {
  /** One line, twips. */
  pitch: number;
  /** The type's size, twips: a header or footer line's height. */
  typeSize: number;
  /** The text block's width, twips. */
  block: number;
  /** Each style's number in the stylesheet; Normal is 0. */
  numbers: Map<StyleKey, number>;
  styles: Map<StyleKey, ParagraphStyle>;
  /** What every run starts from after `\plain`: the face, its size, the language. */
  base: string;
}

/* ------------------------------------------------------------------ */
/* Styles                                                               */
/* ------------------------------------------------------------------ */

interface ParagraphProps {
  align: ElementAlign;
  leftIn: number;
  rightIn: number;
  spaceBefore: number;
  pageBreakBefore: boolean;
  keepWithNext: boolean;
  /** Tab stops of the paragraph's own, as RTF writes them. */
  tabs?: string;
}

/** A style's paragraph properties, with whatever this paragraph changes. */
function paragraphProps(style: ParagraphStyle, g: Geometry, own: Partial<ParagraphProps>): string {
  const p: ParagraphProps = {
    align: style.align,
    leftIn: style.leftIn,
    rightIn: style.rightIn,
    spaceBefore: Math.round(style.spaceBeforeRows * g.pitch),
    pageBreakBefore: style.pageBreakBefore,
    keepWithNext: style.keepWithNext,
    ...own,
  };
  const out: string[] = [ALIGN[p.align], `\\li${tw(p.leftIn)}\\ri${tw(p.rightIn)}`];
  // A header or footer line is as tall as the type, so it reaches no further
  // into the page than the PDF's (docs/app/formatting/formats-and-layout.md#FMT-147).
  const line = style.furniture ? g.typeSize : g.pitch;
  out.push(`\\sb${Math.max(0, p.spaceBefore)}\\sa0\\sl-${line}\\slmult0`);
  if (p.keepWithNext) out.push("\\keepn");
  if (style.keepTogether) out.push("\\keep");
  if (p.pageBreakBefore) out.push("\\pagebb");
  // Widow control keeps two lines each side; it is all the format can say
  // (docs/app/formatting/formats-and-layout.md#FMT-148).
  out.push(style.orphans >= 2 || style.widows >= 2 ? "\\widctlpar" : "\\nowidctlpar");
  // A horizontal line is the paragraph's foot, a half-point rule
  // (docs/app/writing/editor-ux.md#EDIT-213).
  if (style.rule) out.push("\\brdrb\\brdrs\\brdrw10\\brsp0");
  if (style.furniture) out.push(`\\tqc\\tx${Math.round(g.block / 2)}\\tqr\\tx${g.block}`);
  if (p.tabs) out.push(p.tabs);
  if (style.outlineLevel) out.push(`\\outlinelevel${style.outlineLevel - 1}`);
  return out.join("");
}

/** A style's character properties, after the base. */
function characterProps(style: ParagraphStyle): string {
  return (
    (style.bold ? "\\b" : "") +
    (style.italic ? "\\i" : "") +
    (style.caps ? "\\caps" : "") +
    (style.trackingPt ? `\\expndtw${Math.round(style.trackingPt * TWIPS_PER_POINT)}` : "") +
    (style.underline ? "\\ul" : "")
  );
}

function stylesheet(doc: WpDocument, g: Geometry): string {
  const entries = doc.styles.map((style) => {
    const n = g.numbers.get(style.key)!;
    const next = g.numbers.get(style.next) ?? n;
    return (
      `{\\s${n}${paragraphProps(style, g, {})}${g.base}${characterProps(style)}` +
      `\\sbasedon0\\snext${next}\\sqformat ${rtfText(style.name)};}`
    );
  });
  return `{\\stylesheet{\\ql\\sl-${g.pitch}\\slmult0${g.base}\\snext0\\sqformat Normal;}${entries.join("")}}`;
}

/* ------------------------------------------------------------------ */
/* The body                                                             */
/* ------------------------------------------------------------------ */

function inlineRtf(inline: WpInline): string {
  if (inline.kind === "break") return "\\line ";
  if (inline.kind === "tab") return "\\tab ";
  // Direct formatting sets these outright; it adds to the style's, never takes away.
  const props = `${inline.bold ? "\\b" : ""}${inline.italic ? "\\i" : ""}${inline.underline ? "\\ul" : ""}`;
  return props ? `{${props} ${rtfText(inline.text)}}` : rtfText(inline.text);
}

/** How a paragraph ends: a paragraph mark, the end of a cell, or the end of a section. */
type Ending = "\\par" | "\\cell" | "\\sect";

/**
 * One paragraph. `lessBefore` takes twips off its space before: what a
 * hairline just above it already took (see `hairline`).
 */
function paragraphRtf(p: WpParagraph, g: Geometry, end: Ending, lessBefore = 0): string {
  const style = g.styles.get(p.style)!;
  const own: Partial<ParagraphProps> = {};
  const before = p.spaceBeforeRows ?? style.spaceBeforeRows;
  own.spaceBefore = Math.round(before * g.pitch) - lessBefore;
  if (p.pageBreakBefore !== undefined) own.pageBreakBefore = p.pageBreakBefore;
  if (p.align) own.align = p.align;
  if (p.inCell) {
    // The cell is the column (docs/app/formatting/formats-and-layout.md#FMT-149),
    // and the row keeps the pair together.
    own.leftIn = 0;
    own.rightIn = 0;
    own.keepWithNext = false;
  } else if (p.indentIn) own.leftIn = style.leftIn + p.indentIn;
  if (p.tabs?.length)
    own.tabs = p.tabs
      .map(
        (tab) =>
          `${tab.kind === "center" ? "\\tqc" : tab.kind === "right" ? "\\tqr" : ""}\\tx${tw(tab.atIn)}`,
      )
      .join("");
  return (
    `\\pard\\plain${p.inCell ? "\\intbl" : ""}\\s${g.numbers.get(p.style)}` +
    `${paragraphProps(style, g, own)}${g.base}${characterProps(style)} ` +
    `${p.inlines.map(inlineRtf).join("")}${end}\n`
  );
}

/** How tall a hairline is, twips: one point. */
const HAIRLINE = TWIPS_PER_POINT;

/**
 * A paragraph a point tall: somewhere to end a section after a table, and the
 * last thing in a body that ends on a table. The paragraph after it gives the
 * point back from its space before
 * (docs/app/formatting/formats-and-layout.md#FMT-147).
 */
function hairline(end: Ending): string {
  return `\\pard\\plain\\sb0\\sa0\\sl-${HAIRLINE}\\slmult0\\fs2 ${end}\n`;
}

function dualRtf(d: WpDual, doc: WpDocument, g: Geometry): string {
  const c = dualColumns(doc.spec);
  const left = tw(c.leftIn);
  const first = left + tw(c.leftWidthIn + c.gutterIn);
  const second = first + tw(c.rightWidthIn);
  // A row takes no page break of its own; its first paragraph's breaks the
  // page before the row, which is where the pair belongs.
  const opener = d.left[0] ?? d.right[0];
  const breakFirst = (p: WpParagraph) =>
    d.pageBreakBefore && p === opener ? { ...p, pageBreakBefore: true } : p;
  const cell = (paragraphs: WpParagraph[]) =>
    paragraphs.length
      ? paragraphs
          .map((p, i) =>
            paragraphRtf(breakFirst(p), g, i === paragraphs.length - 1 ? "\\cell" : "\\par"),
          )
          .join("")
      : "\\pard\\plain\\intbl\\cell\n";
  return (
    // No borders, no padding but the gutter, and the pair never splits
    // (docs/app/formatting/formats-and-layout.md#FMT-148).
    `\\trowd\\trgaph0\\trleft${left}\\trkeep` +
    `\\trpaddl0\\trpaddr0\\trpaddt0\\trpaddb0\\trpaddfl3\\trpaddfr3\\trpaddft3\\trpaddfb3` +
    `\\clpadr${tw(c.gutterIn)}\\clpadfr3\\cellx${first}\\cellx${second}\n` +
    cell(d.left) +
    cell(d.right) +
    "\\row\n"
  );
}

/* ------------------------------------------------------------------ */
/* Headers, footers and sections                                        */
/* ------------------------------------------------------------------ */

const PAGE_FIELD = "{\\field{\\*\\fldinst  PAGE }{\\fldrslt 1}}";

/** The three slots on one line: left, then a tab to the centre stop and one to the right. */
function slotsRtf(f: Furniture | null): string {
  if (!f) return "";
  const prints = SLOTS.map((slot) => f[slot].length > 1 || f[slot].some(Boolean));
  const last = prints.lastIndexOf(true);
  let out = "";
  SLOTS.forEach((slot, i) => {
    if (i > last) return;
    if (i > 0) out += "\\tab ";
    out += f[slot].map((text, j) => (j ? PAGE_FIELD : "") + rtfText(text)).join("");
  });
  return out;
}

function furnitureRtf(
  destination: "header" | "headerf" | "footer" | "footerf",
  f: Furniture | null,
  g: Geometry,
): string {
  const key: StyleKey = destination.startsWith("header") ? "header" : "footer";
  const style = g.styles.get(key)!;
  return (
    `{\\${destination}\\pard\\plain\\s${g.numbers.get(key)}${paragraphProps(style, g, {})}` +
    `${g.base} ${slotsRtf(f)}\\par}\n`
  );
}

function sectionRtf(
  section: WpSection,
  doc: WpDocument,
  g: Geometry,
  furnished: { header: boolean; footer: boolean },
): string {
  const { spec } = doc;
  const m = spec.page.margins;
  const { widthIn, heightIn } = PAGE_SIZES[spec.page.size];
  const at = furniturePositions(spec);
  const props: string[] = ["\\sectd"];
  if (section.begins !== "document")
    props.push(section.begins === "page" ? "\\sbkpage" : "\\sbknone");
  props.push(
    `\\pgwsxn${tw(widthIn)}\\pghsxn${tw(heightIn)}` +
      `\\marglsxn${tw(m.left)}\\margrsxn${tw(m.right)}\\margtsxn${tw(m.top)}\\margbsxn${tw(m.bottom)}` +
      // The header's text top and the footer's text bottom, from the paper edge
      // (docs/app/formatting/formats-and-layout.md#FMT-147).
      `\\headery${tw(at.headerIn)}\\footery${tw(at.footerIn)}`,
  );
  if (section.firstPageNumber !== undefined)
    props.push(`\\pgnrestart\\pgnstarts${section.firstPageNumber}`);
  const bare = section.bareFirstPage;
  const titlePage = !!bare && (bare.header || bare.footer);
  if (titlePage) props.push("\\titlepg");
  const parts: string[] = [];
  if (section.kind === "script") {
    // A section that names no header follows the one before's, so every
    // script section names its own — an empty one where its slots print nothing.
    if (furnished.header) {
      parts.push(furnitureRtf("header", section.header, g));
      if (titlePage) parts.push(furnitureRtf("headerf", bare?.header ? null : section.header, g));
    }
    if (furnished.footer) {
      parts.push(furnitureRtf("footer", section.footer, g));
      if (titlePage) parts.push(furnitureRtf("footerf", bare?.footer ? null : section.footer, g));
    }
  } else if (section.kind === "back") {
    // The pages after the script print no header or footer, and a section that
    // names none follows the script's: so these name empty ones.
    if (furnished.header) parts.push(furnitureRtf("header", null, g));
    if (furnished.footer) parts.push(furnitureRtf("footer", null, g));
  }
  return `${props.join("")}\n${parts.join("")}`;
}

function bodyRtf(doc: WpDocument, g: Geometry): string {
  const furnished = {
    header: doc.sections.some((s) => s.header),
    footer: doc.sections.some((s) => s.footer),
  };
  const out: string[] = [];
  // Twips a hairline took that the next paragraph gives back from its space before.
  let owed = 0;
  doc.sections.forEach((section, i) => {
    out.push(sectionRtf(section, doc, g, furnished));
    const final = i === doc.sections.length - 1;
    section.items.forEach((item, j) => {
      const last = j === section.items.length - 1;
      const closes = !final && last;
      if (item.kind === "dual") {
        out.push(dualRtf(item, doc, g));
        owed = 0;
        if (last) {
          out.push(hairline(closes ? "\\sect" : "\\par"));
          owed = HAIRLINE;
        }
      } else {
        out.push(paragraphRtf(item, g, closes ? "\\sect" : "\\par", owed));
        owed = 0;
      }
    });
    if (!section.items.length && !final) out.push(hairline("\\sect"));
  });
  return out.join("");
}

/* ------------------------------------------------------------------ */
/* The file                                                             */
/* ------------------------------------------------------------------ */

export function writeRtf(doc: WpDocument): Uint8Array {
  const { spec } = doc;
  const { fallback } = familyNames(spec);
  const lang = languageNumber(doc.language);
  const primaryLanguage = doc.language.split("-")[0].toLowerCase();
  const languageProps =
    lang === null
      ? ""
      : `\\lang${lang}` +
        (["zh", "ja", "ko"].includes(primaryLanguage) ? `\\langfe${lang}` : "") +
        (["ar", "he", "fa", "ur", "yi"].includes(primaryLanguage) ? `\\alang${lang}` : "");
  const numbers = new Map<StyleKey, number>(doc.styles.map((style, i) => [style.key, i + 1]));
  const g: Geometry = {
    pitch: Math.round(linePitchIn(spec) * TWIPS_PER_INCH),
    typeSize: Math.round(spec.type.size * TWIPS_PER_POINT),
    block: tw(textBlockWidthIn(spec)),
    numbers,
    styles: new Map(doc.styles.map((style) => [style.key, style])),
    base: `\\f0\\fs${Math.round(spec.type.size * 2)}${languageProps}`,
  };
  const m = spec.page.margins;
  const { widthIn, heightIn } = PAGE_SIZES[spec.page.size];
  const info =
    `{\\info{\\title ${rtfText(doc.title)}}` +
    (doc.author ? `{\\author ${rtfText(doc.author)}}` : "") +
    "}";
  const text =
    `{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0${lang === null ? "" : `\\deflang${lang}`}\n` +
    // The format's next family, fixed-pitch: an .rtf cannot carry the first
    // in a form readers use, and a reader without it sets a proportional face
    // whatever the file says to use instead
    // (docs/app/formatting/formats-and-layout.md#FMT-154).
    `{\\fonttbl{\\f0\\fmodern\\fprq1\\fcharset0 ${rtfText(fallback)};}}\n` +
    `${stylesheet(doc, g)}\n` +
    `${info}\n{\\*\\generator Proscenium;}\n` +
    `\\paperw${tw(widthIn)}\\paperh${tw(heightIn)}` +
    `\\margl${tw(m.left)}\\margr${tw(m.right)}\\margt${tw(m.top)}\\margb${tw(m.bottom)}` +
    `\\deftab${TWIPS_PER_INCH / 2}\\viewkind1\n` +
    bodyRtf(doc, g) +
    "}\n";
  return new TextEncoder().encode(text);
}
