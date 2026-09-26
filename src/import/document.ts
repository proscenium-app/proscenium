// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An import read as a binder document rather than a script
 * (docs/app/importing/document-import.md#IMPT-100): the paragraphs as a page
 * of Markdown, written by the prose editor's own serializer so the file is
 * exactly what the editor would save.
 *
 * Headings come from the source's styles: Title is a first-level heading,
 * Heading (or Heading 1) the second, and so on down. Every other paragraph
 * is a paragraph. Bold and italic carry; Markdown has no underline, so an
 * underlined run keeps its words and loses the line. A line break within a
 * paragraph stays one, and a tab becomes a space: at the start of a line a
 * tab would read back as something other than prose.
 */
import { toMarkdown, type Node } from "../markdown/doc";
import type { InlineNode } from "../fountain/model";
import { styleKind, type ImportDocument, type Paragraph, type ReviewLine } from "./model";
import { assertDocumentText } from "../storage/read-limit";

/** The headings the readers add themselves, above what they append. */
const APPENDED = new Set(["Text Boxes", "Footnotes", "Endnotes", "Comments"]);

/** A paragraph's heading level from its source style, or 0 for a paragraph. */
export function headingLevel(p: Paragraph): number {
  const style = p.style.trim().toLowerCase();
  if (style === "title") return 1;
  if (APPENDED.has(p.style)) return 2;
  const heading = /^heading(?:\s*(\d))?$/.exec(style);
  if (heading) return Math.min(6, 1 + Number(heading[1] ?? 1));
  // A script's own act and scene headings, when the source named them.
  const kind = p.kind ?? styleKind(p.style);
  if (kind === "act") return 2;
  if (kind === "scene" || kind === "sceneHeading") return 3;
  return 0;
}

function inline(content: InlineNode[]): Node[] {
  const out: Node[] = [];
  for (const n of content) {
    if (n.type !== "text") continue;
    const marks = (n.marks ?? []).flatMap((m) =>
      m.type === "strong" ? [{ type: "bold" }] : m.type === "em" ? [{ type: "italic" }] : [],
    );
    n.text.replace(/\t/g, " ").split("\n").forEach((line, i) => {
      if (i) out.push({ type: "hardBreak" });
      if (line) out.push({ type: "text", text: line, ...(marks.length ? { marks } : {}) });
    });
  }
  return out;
}

/** The import as the Markdown body of a new binder document. */
export function documentMarkdown(doc: ImportDocument): string {
  const blocks: Node[] = doc.paragraphs
    .filter((p) => p.kind !== "pageBreak")
    .map((p) => {
      const content = inline(p.content);
      const level = headingLevel(p);
      return level ? { type: "heading", attrs: { level }, content } : { type: "paragraph", content };
    })
    .filter((b) => b.content?.length);
  const markdown = toMarkdown({ type: "doc", content: blocks });
  assertDocumentText(markdown);
  return markdown;
}

/** Whether the import has underlined text a document cannot keep. */
export const hasUnderline = (doc: ImportDocument) =>
  doc.paragraphs.some((p) => p.content.some((n) => n.type === "text" && n.marks?.some((m) => m.type === "underline")));

/** Whether a reading is a script rather than prose: the source named its
 * elements, or cues and dialogue carry it (docs/app/importing/document-import.md#IMPT-97). */
export function looksLikeScript(doc: ImportDocument, lines: ReviewLine[]): boolean {
  if (doc.fountain !== undefined || doc.format === "Final Draft") return true;
  if (lines.some((l) => !l.review && ["character", "dialogue", "sceneHeading"].includes(l.kind))) return true;
  // Read from the text: a cue said three times and dialogue in a quarter of
  // the paragraphs. Notes with a capitalised name or two stay a document.
  const cues = lines.filter((l) => l.kind === "character").length;
  const dialogue = lines.filter((l) => l.kind === "dialogue").length;
  return cues >= 3 && dialogue >= lines.length / 4;
}
