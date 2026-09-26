// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * PDF rendering: the layout engine's pages, drawn 1:1. No layout decisions
 * happen here — every break, row, and x-position comes from LayoutResult, so
 * the PDF can never disagree with the paginated editor view. Courier Prime is
 * embedded (subset) so margins and metrics survive on machines without the
 * font.
 *
 * Font bytes are injected (PdfFontBytes) so this module stays runnable in
 * plain bun tests; the Vite asset loading lives in fonts.ts.
 */
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSpacing,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import { MONO_ADVANCE_EM } from "../format/metrics";
import { PAGE_SIZES, type ElementFontStyle, type FormatSpec } from "../format";
import type { FrontMatter } from "../fountain";
import {
  paginateFrontMatter,
  type FrontMatterLine,
  type LayoutMeta,
  type LayoutPage,
  type LayoutResult,
  type StyleRun,
} from "../layout";
import { selectFrontMatter, styleSegments, type FrontSheet } from "./plan";
import { TaggedPdf, type PdfElement } from "./tagged";
import { canonicalLanguage, DEFAULT_PLAY_LANGUAGE } from "../workspace/language";

const PT_PER_IN = 72;

export interface PdfFontBytes {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
  boldItalic: Uint8Array;
}

interface Faces {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

function pick(faces: Faces, bold: boolean, italic: boolean): PDFFont {
  if (bold && italic) return faces.boldItalic;
  if (bold) return faces.bold;
  if (italic) return faces.italic;
  return faces.regular;
}

function baseStyle(style: ElementFontStyle): { bold: boolean; italic: boolean } {
  return {
    bold: style === "bold" || style === "bold-italic",
    italic: style === "italic" || style === "bold-italic",
  };
}

export async function renderPdf(args: {
  layout: LayoutResult;
  spec: FormatSpec;
  meta: LayoutMeta;
  frontMatter?: FrontMatter | null;
  /** Which kinds of front sheet to draw, in their own stage order; omitted draws every one. */
  frontSheets?: readonly FrontSheet[] | null;
  language?: string;
  fonts: PdfFontBytes;
}): Promise<Uint8Array> {
  const { layout, spec, meta, frontMatter } = args;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const faces: Faces = {
    regular: await doc.embedFont(args.fonts.regular, { subset: true }),
    bold: await doc.embedFont(args.fonts.bold, { subset: true }),
    italic: await doc.embedFont(args.fonts.italic, { subset: true }),
    boldItalic: await doc.embedFont(args.fonts.boldItalic, { subset: true }),
  };

  const { widthIn, heightIn } = PAGE_SIZES[spec.page.size];
  const pageW = widthIn * PT_PER_IN;
  const pageH = heightIn * PT_PER_IN;
  const m = spec.page.margins;
  const size = spec.type.size;
  const pitch = size * spec.type.lineHeight;
  const advance = MONO_ADVANCE_EM * size;
  const blockW = pageW - (m.left + m.right) * PT_PER_IN;
  // Real font metric: ascender height at size (baseline offset from line top).
  const ascent = faces.regular.heightAtSize(size, { descender: false });

  // The title names the document; the saved play language selects its voice.
  doc.setTitle(meta.title ?? "Untitled", { showInWindowTitleBar: true });
  const language = canonicalLanguage(args.language ?? DEFAULT_PLAY_LANGUAGE);
  if (!language) throw new Error("Invalid play language.");
  doc.setLanguage(language);
  if (meta.author) doc.setAuthor(meta.author);
  doc.setCreator("Proscenium");
  const tags = new TaggedPdf(doc);

  const frontSections = new Map<string, PdfElement>();
  const frontParagraphs = new Map<string, PdfElement>();
  let castList: PdfElement | null = null;
  const frontParagraph = (kind: string, line: FrontMatterLine): PdfElement => {
    let section = frontSections.get(kind);
    if (!section) {
      section = tags.element("Sect");
      frontSections.set(kind, section);
    }
    const key = `${kind}:${line.paragraphId}`;
    let paragraph = frontParagraphs.get(key);
    if (!paragraph) {
      let parent = section;
      if (line.role === "cast") {
        castList ??= tags.element("L", section);
        parent = tags.element("LBody", tags.element("LI", castList));
      }
      paragraph = tags.element(line.role === "heading" ? "H1" : "P", parent);
      frontParagraphs.set(key, paragraph);
    }
    return paragraph;
  };
  const drawFrontLine = (p: PDFPage, line: FrontMatterLine, kind: string) => {
    tags.content(p, frontParagraph(kind, line), () =>
      drawStyledLine(p, line.text, line.runs ?? [], {
        x0: (m.left + line.xIn) * PT_PER_IN,
        baseline: pageH - m.top * PT_PER_IN - line.row * pitch - ascent,
        size,
        advance,
        faces,
        base: baseStyle(line.fontStyle),
      }),
    );
  };
  for (const page of selectFrontMatter(paginateFrontMatter(frontMatter, spec), args.frontSheets)) {
    const p = doc.addPage([pageW, pageH]);
    for (const line of page.lines) drawFrontLine(p, line, page.kind);
  }
  // Establish the opening's semantic order before adding body paragraphs.
  for (const page of layout.pages)
    for (const line of page.intro ?? []) frontParagraph("opening", line);

  // Source order, not the page's x/y order: read the entire left speech before
  // the right speech in dual dialogue. Wrapped paragraphs keep one owner even
  // when they span pages. Continuation cues repeat existing content; only an
  // excerpt's leading cue needs its own paragraph to identify the speaker.
  const body = tags.element("Part");
  const paragraphs = new Map<number, PdfElement>();
  let section = body;
  let speech: PdfElement | null = null;
  const firstLines = new Map(
    layout.pages
      .flatMap((p) => p.lines)
      .filter((line) => line.kind === "text" && line.text)
      .reverse()
      .map((line) => [line.sourceIndex, line] as const),
  );
  for (const [index, line] of [...firstLines].sort(([a], [b]) => a - b)) {
    if (["act", "scene", "sceneHeading"].includes(line.type)) {
      section = tags.element("Sect", body);
      speech = null;
    }
    if (line.type === "character") speech = tags.element("Speech", section);
    const inSpeech = ["character", "dialogue", "parenthetical", "lyric"].includes(line.type);
    if (!inSpeech) speech = null;
    const tag =
      line.type === "act"
        ? "H1"
        : line.type === "scene"
          ? "H2"
          : line.type === "sceneHeading"
            ? "H3"
            : line.type === "character"
              ? "Speaker"
              : line.type === "dialogue" || line.type === "lyric"
                ? "Dialogue"
                : line.type === "action" || line.type === "parenthetical"
                  ? "StageDirection"
                  : "P";
    paragraphs.set(index, tags.element(tag, speech ?? section));
  }
  const leadingCue = layout.pages[0]?.lines.find((line) => line.text);
  // Prepend an excerpt-only continuation cue to its reading sequence.
  let excerptCue: PdfElement | null = null;
  if (leadingCue?.kind === "contd") {
    excerptCue = tags.element("Speaker", body);
    body.children.remove(body.children.size() - 1);
    body.children.insert(0, excerptCue.ref);
  }

  // The descender's depth at size, so a footer's text can SIT at its position
  // the way a header's hangs from its own.
  const descent = faces.regular.heightAtSize(size, { descender: true }) - ascent;

  /** Left, centre and right slots across the text block, on one baseline. */
  const drawSlots = (p: PDFPage, slots: NonNullable<LayoutPage["header"]>, baseline: number) => {
    const xFor = {
      left: () => m.left * PT_PER_IN,
      center: (w: number) => m.left * PT_PER_IN + (blockW - w) / 2,
      right: (w: number) => m.left * PT_PER_IN + blockW - w,
    };
    for (const slot of ["left", "center", "right"] as const) {
      const text = slots[slot];
      if (!text) continue;
      p.drawText(text, {
        x: xFor[slot](text.length * advance),
        y: baseline,
        size,
        font: faces.regular,
      });
    }
  };

  for (const page of layout.pages) {
    const p = doc.addPage([pageW, pageH]);

    // Header: its text's top `position` inches below the top edge.
    if (page.header)
      tags.artifact(p, () =>
        drawSlots(p, page.header!, pageH - spec.header.position * PT_PER_IN - ascent),
      );
    // Footer: its text's bottom `position` inches above the bottom edge.
    if (page.footer)
      tags.artifact(p, () =>
        drawSlots(p, page.footer!, spec.footer.position * PT_PER_IN + descent),
      );

    for (const line of page.intro ?? []) drawFrontLine(p, line, "opening");

    for (const line of page.lines) {
      if (!line.text) continue;
      const el = spec.elements[line.type];
      const base = baseStyle(el.fontStyle);
      const baseline = pageH - m.top * PT_PER_IN - line.row * pitch - ascent;
      const x0 = m.left * PT_PER_IN + line.xIn * PT_PER_IN;
      const drawLine = () =>
        drawStyledLine(p, line.text, line.runs, {
          x0,
          baseline,
          size,
          advance: advance + el.letterSpacing * size,
          faces,
          base,
        });
      const paragraph =
        line === leadingCue && excerptCue ? excerptCue : paragraphs.get(line.sourceIndex);
      if (paragraph) tags.content(p, paragraph, drawLine);
      else tags.artifact(p, drawLine);
    }
  }

  return doc.save();
}

/** Draw one line from the shared style split (plan.ts), so the export preview
 * shows the same emphasis this draws. Monospace: x advances by cells, same as
 * the engine and the DOM. */
function drawStyledLine(
  p: PDFPage,
  text: string,
  runs: StyleRun[],
  o: {
    x0: number;
    baseline: number;
    size: number;
    advance: number;
    faces: Faces;
    base: { bold: boolean; italic: boolean };
  },
): void {
  for (const seg of styleSegments(text, runs, o.base)) {
    const x = o.x0 + seg.start * o.advance;
    const font = pick(o.faces, seg.bold, seg.italic);
    // Tc is a text-state parameter, retained across text objects. Scope it to
    // this run so following furniture/front matter cannot inherit tracking.
    // Use the face's actual advance (Courier Prime is just shy of 0.6 em) so
    // glyphs and styled-run starts stay on the same shared character grid.
    p.pushOperators(
      pushGraphicsState(),
      setCharacterSpacing(o.advance - font.widthOfTextAtSize("M", o.size)),
    );
    p.drawText(seg.text, {
      x,
      y: o.baseline,
      size: o.size,
      font,
    });
    p.pushOperators(popGraphicsState());
    if (seg.underline) {
      const w = seg.text.length * o.advance;
      p.drawLine({
        start: { x, y: o.baseline - 1.5 },
        end: { x: x + w, y: o.baseline - 1.5 },
        thickness: 0.6,
      });
    }
  }
}
