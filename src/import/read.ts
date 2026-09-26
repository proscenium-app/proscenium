// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseInline } from "../fountain";
import { assertDocumentSize, assertDocumentText } from "../storage/read-limit";
import { extension, guidance, isPagesName } from "./formats";
import { fountainDocument, plain, type ImportDocument, type Paragraph } from "./model";
import { readDocx, readOdt } from "./office";
import { readPages } from "./pages";
import { readRtf } from "./rtf";
import { attr, child, children, decode, descendants, xml } from "./xml";
import type { InlineNode, MarkType } from "../fountain/model";
import { styleKind } from "./model";

function readFdx(name: string, text: string): ImportDocument {
  const root = xml(text);
  if (root.localName !== "FinalDraft") throw new Error("This is not a Final Draft script.");
  const body = child(root, "Content");
  if (!body) throw new Error("This Final Draft file has no script content.");
  const readParagraph = (p: import("./xml").Element): Paragraph => {
    const content: InlineNode[] = [];
    for (const t of descendants(p, "Text")) {
      const styles = attr(t, "Style")
        .toLowerCase()
        .split(/[+ ,]+/);
      const marks: MarkType[] = [
        ...(styles.includes("bold") ? ["strong" as const] : []),
        ...(styles.includes("italic") ? ["em" as const] : []),
        ...(styles.includes("underline") ? ["underline" as const] : []),
      ];
      if (t.textContent)
        content.push({
          type: "text",
          text: t.textContent,
          marks: marks.map((type) => ({ type })),
        });
    }
    const style = attr(p, "Type") || "General";
    const kind = styleKind(style);
    return {
      style,
      kind: kind ?? "action",
      ...(!kind
        ? {
            uncertainty: `Unknown source element: ${style}. Kept as a stage direction.`,
          }
        : {}),
      content: content.length ? content : plain(p.textContent ?? ""),
    };
  };
  const paragraphs: Paragraph[] = [];
  for (const e of children(body)) {
    if (e.localName === "Paragraph") paragraphs.push(readParagraph(e));
    else if (e.localName === "DualDialogue") {
      let cue = 0;
      for (const p of descendants(e, "Paragraph")) {
        const line = readParagraph(p);
        if (line.kind === "character" && ++cue > 1) line.attrs = { dual: true };
        paragraphs.push(line);
      }
    } else for (const p of descendants(e, "Paragraph")) paragraphs.push(readParagraph(p));
  }
  const titlePage = child(root, "TitlePage");
  const titles = titlePage
    ? descendants(titlePage, "Paragraph")
        .map(readParagraph)
        .map((p) => p.content.map((n) => (n.type === "text" ? n.text : "")).join(""))
        .filter((t) => t.trim())
    : [];
  const notices = [
    "Script elements and basic emphasis carry across. Production revisions, locked pagination and layout stay in the original.",
  ];
  if (titles.length > 1)
    notices.push(
      "Additional title-page text is kept in the title page’s Contact field. Check it after import.",
    );
  return {
    name,
    format: "Final Draft",
    paragraphs,
    notices,
    frontMatter: {
      ...(titles[0] ? { title: titles[0] } : {}),
      ...(titles.length > 1 ? { contact: titles.slice(1) } : {}),
    },
  };
}

export function readDocument(name: string, bytes: Uint8Array): ImportDocument {
  assertDocumentSize(bytes.byteLength);
  const help = guidance(name);
  if (help) throw new Error(help);
  const ext = extension(name);
  let result: ImportDocument;
  if (ext === "docx") result = readDocx(name, bytes);
  else if (ext === "odt") result = readOdt(name, bytes);
  else if (isPagesName(name)) result = readPages(name, bytes);
  else if (ext === "rtf") result = readRtf(name, new TextDecoder("windows-1252").decode(bytes));
  else {
    const sourceText = decode(bytes);
    const text = sourceText.replace(/\r\n?/g, "\n");
    assertDocumentText(text);
    if (text.includes("\0"))
      throw new Error(
        "This appears to be a binary file. Choose a Word, Pages, RTF, OpenDocument or script export.",
      );
    if (ext === "fdx") result = readFdx(name, text);
    else if (ext === "fountain" || ext === "spmd") result = fountainDocument(name, sourceText);
    else if (ext === "txt" || ext === "md")
      result = {
        name,
        format: ext === "md" ? "Markdown" : "Plain Text",
        frontMatter: {},
        paragraphs: text
          .split(/\n/)
          .filter((t) => t.trim())
          .map((t) => ({
            style: "Unstyled",
            content: ext === "md" ? parseInline(t) : plain(t),
          })),
        notices: [
          "Paragraph types are inferred from the text. Review character cues and stage directions before importing.",
        ],
      };
    else
      throw new Error(
        "Choose a .docx, .pages, .odt, .rtf, .txt, .md, .fountain or .fdx file. The source-app guide below explains how to export one.",
      );
  }
  result.paragraphs = result.paragraphs.filter((p) => p.kind === "pageBreak" || p.content.length);
  if (!result.paragraphs.length)
    throw new Error(
      "No editable text was found. This may be an empty document or an image-only file.",
    );
  if (result.paragraphs.length > 20_000)
    throw new Error(
      "This draft has more than 20,000 paragraphs. Export and import a smaller section at a time.",
    );
  return result;
}
