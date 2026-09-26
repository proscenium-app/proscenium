// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { parse, serialize, textContent } from "../fountain";
import type { BlockNode, BlockType, FrontMatter, InlineNode } from "../fountain/model";
import { assertDocumentText } from "../storage/read-limit";

export const ELEMENTS: { value: BlockType; label: string }[] = [
  { value: "action", label: "Stage Direction" },
  { value: "character", label: "Character" },
  { value: "dialogue", label: "Dialogue" },
  { value: "parenthetical", label: "Parenthetical" },
  { value: "act", label: "Act" },
  { value: "scene", label: "Scene" },
  { value: "sceneHeading", label: "Scene Heading" },
  { value: "lyric", label: "Lyric" },
  { value: "transition", label: "Transition" },
  { value: "centered", label: "Centered" },
  { value: "synopsis", label: "Synopsis" },
  { value: "pageBreak", label: "Page Break" },
  { value: "boneyard", label: "Omitted Text" },
];
export interface Paragraph {
  content: InlineNode[];
  style: string;
  kind?: BlockType;
  attrs?: Record<string, unknown>;
  uncertainty?: string;
}
export interface ImportDocument {
  name: string;
  format: string;
  paragraphs: Paragraph[];
  frontMatter: FrontMatter;
  notices: string[];
  /** Fountain is already canonical. Keep its bytes until the writer makes a correction. */
  fountain?: string;
}
export interface ReviewLine extends Paragraph {
  kind: BlockType;
  reason: string;
  review: boolean;
}
export type Reading = "detect" | "directions";
export interface Corrections {
  lines: Record<number, BlockType>;
  styles: Record<string, BlockType>;
}
export const EMPTY_CORRECTIONS: Corrections = { lines: {}, styles: {} };
export const plain = (text: string): InlineNode[] => (text ? [{ type: "text", text }] : []);
export const paragraphText = (p: Paragraph) => textContent(p.content);
/** A package-form `.pages` arrives as `Name.pages.zip`; its title is `Name`. */
export const documentTitle = (doc: ImportDocument) =>
  doc.frontMatter.title || doc.name.replace(/\.pages\.zip$|\.[^.]+$/i, "");

export function styleKind(style: string): BlockType | undefined {
  const key = style.toLowerCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, BlockType> = {
    action: "action",
    stagedirection: "action",
    stagedirections: "action",
    general: "action",
    shot: "action",
    character: "character",
    charactername: "character",
    charactercue: "character",
    speaker: "character",
    dialogue: "dialogue",
    dialog: "dialogue",
    speech: "dialogue",
    parenthetical: "parenthetical",
    act: "act",
    actheading: "act",
    scene: "scene",
    scenetitle: "scene",
    sceneheading: "sceneHeading",
    transition: "transition",
    lyric: "lyric",
    lyrics: "lyric",
    centered: "centered",
    // The names an exported .docx or .odt gives these, as the element bar
    // does (docs/app/formatting/formats-and-layout.md#FMT-146).
    centeredtext: "centered",
    synopsis: "synopsis",
    scenesummary: "synopsis",
    omittedtext: "boneyard",
  };
  return Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : undefined;
}

/** Explicit source semantics win; guesses are always labelled. No text is discarded. */
export function reviewLines(
  doc: ImportDocument,
  reading: Reading,
  corrections: Corrections,
): ReviewLine[] {
  const lines: ReviewLine[] = [];
  for (const [index, p] of doc.paragraphs.entries()) {
    const text = paragraphText(p).trim();
    const previous = lines[lines.length - 1]?.kind;
    const chosen =
      corrections.lines[index] ??
      (Object.prototype.hasOwnProperty.call(corrections.styles, p.style)
        ? corrections.styles[p.style]
        : undefined);
    let kind = chosen ?? p.kind ?? styleKind(p.style);
    let reason = chosen
      ? "Your choice"
      : (p.uncertainty ?? (p.kind ? "From the script" : `Source style: ${p.style}`));
    let review = !chosen && !!p.uncertainty;
    if (!kind) {
      kind = "action";
      reason = "Kept as a stage direction";
      review = true;
      if (reading === "detect") {
        if (/^ACT\s+(?:[IVXLCDM]+|\d+|ONE|TWO|THREE|FOUR|FIVE)\b/i.test(text)) kind = "act";
        else if (/^SCENE\s+(?:[IVXLCDM]+|\d+|ONE|TWO|THREE|FOUR|FIVE)\b/i.test(text))
          kind = "scene";
        else if (/^(?:INT\.?|EXT\.?|INT\.?\/EXT\.?)\s/i.test(text)) kind = "sceneHeading";
        else if (/^(?:CUT TO:|FADE OUT\.|BLACKOUT\.)$/.test(text)) kind = "transition";
        else if (
          /^(?:LIGHTS (?:UP|DOWN|OUT)|CURTAIN|END OF (?:ACT|PLAY)|THE END)[.!]?$/i.test(text)
        )
          kind = "action";
        else if (
          /^\([\s\S]+\)$/.test(text) &&
          (previous === "character" || previous === "dialogue" || previous === "parenthetical")
        )
          kind = "parenthetical";
        else if (
          text.length <= 55 &&
          /\p{Lu}/u.test(text) &&
          !/\p{Ll}/u.test(text) &&
          !/[.!?:;\n]$/.test(text) &&
          doc.paragraphs[index + 1] &&
          /\p{Ll}/u.test(paragraphText(doc.paragraphs[index + 1]))
        )
          kind = "character";
        else if (
          (previous === "character" || previous === "parenthetical" || previous === "dialogue") &&
          !/^\s*[[(]/.test(text)
        )
          kind = "dialogue";
        if (kind !== "action") reason = "Recognized from the text";
      }
    }
    lines.push({ ...p, kind, reason, review });
  }
  return lines;
}

export function makeScript(
  doc: ImportDocument,
  title: string,
  reading: Reading,
  corrections: Corrections,
): string {
  if (
    doc.fountain !== undefined &&
    title === documentTitle(doc) &&
    reading === "detect" &&
    !Object.keys(corrections.lines).length &&
    !Object.keys(corrections.styles).length
  )
    return doc.fountain;
  const lines = reviewLines(doc, reading, corrections);
  const content: BlockNode[] = lines.map((p, index) => {
    if (
      (p.kind === "dialogue" || p.kind === "parenthetical") &&
      !["character", "dialogue", "parenthetical"].includes(lines[index - 1]?.kind ?? "")
    ) {
      throw new Error(
        `Paragraph ${index + 1} is ${p.kind === "dialogue" ? "Dialogue" : "a Parenthetical"} without a character cue. Set its speaker’s paragraph to Character, or use Stage Direction for this paragraph.`,
      );
    }
    let nodes = p.content;
    // The canonical serializer supplies the outer parentheses itself.
    if (p.kind === "parenthetical" && /^\([\s\S]*\)$/.test(paragraphText(p))) {
      nodes = p.content.map((n) => ({ ...n }));
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (first?.type === "text") first.text = first.text.slice(1);
      if (last?.type === "text") last.text = last.text.slice(0, -1);
    }
    return { type: p.kind, content: nodes, attrs: p.attrs };
  });
  const result = serialize({
    frontMatter: { ...doc.frontMatter, title },
    doc: { type: "doc", content },
  });
  assertDocumentText(result);
  return result;
}

export function fountainDocument(name: string, text: string): ImportDocument {
  const parsed = parse(text);
  return {
    name,
    format: "Fountain",
    frontMatter: parsed.frontMatter,
    fountain: text,
    notices: [],
    paragraphs: parsed.doc.content.map((p) => ({
      kind: p.type,
      style: p.type,
      content: p.content ?? [],
      attrs: p.attrs,
    })),
  };
}
