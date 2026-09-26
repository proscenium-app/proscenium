// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { InlineNode, MarkType } from "../fountain/model";
import { plain, paragraphText, styleKind, type ImportDocument, type Paragraph } from "./model";
import { attr, child, children, decode, descendants, xml, zipParts, type Element } from "./xml";

export function readDocx(name: string, bytes: Uint8Array): ImportDocument {
  const parts = zipParts(
    bytes,
    new Set([
      "word/document.xml",
      "word/styles.xml",
      "word/footnotes.xml",
      "word/endnotes.xml",
      "word/comments.xml",
      "docProps/core.xml",
    ]),
  );
  if (!parts["word/document.xml"])
    throw new Error(
      "This is not a readable Word document. Password-protected files need an unprotected copy.",
    );
  const root = xml(decode(parts["word/document.xml"]));
  if (root.localName !== "document") throw new Error("This file does not contain a Word document.");
  const styles = new Map<string, { name: string; base: string; marks: MarkType[] }>();
  const marks = (r: Element | undefined): MarkType[] => {
    if (!r) return [];
    const enabled = (key: string) => {
      const e = child(r, key);
      return !!e && !["0", "false", "off", "none"].includes(attr(e, "val"));
    };
    return [
      ...(enabled("b") ? ["strong" as const] : []),
      ...(enabled("i") ? ["em" as const] : []),
      ...(enabled("u") ? ["underline" as const] : []),
    ];
  };
  if (parts["word/styles.xml"])
    for (const s of descendants(xml(decode(parts["word/styles.xml"])), "style")) {
      styles.set(attr(s, "styleId"), {
        name: attr(child(s, "name"), "val"),
        base: attr(child(s, "basedOn"), "val"),
        marks: marks(child(s, "rPr")),
      });
    }
  const inherited = (id: string, visited = new Set<string>()): MarkType[] => {
    const s = styles.get(id);
    if (!s || visited.has(id)) return [];
    visited.add(id);
    return [...new Set([...inherited(s.base, visited), ...s.marks])];
  };
  const inheritedKind = (id: string, visited = new Set<string>()): Paragraph["kind"] => {
    if (!id || visited.has(id)) return undefined;
    visited.add(id);
    const s = styles.get(id);
    return styleKind(s?.name ?? id) ?? (s?.base ? inheritedKind(s.base, visited) : undefined);
  };
  const paragraphs = (body: Element): Paragraph[] =>
    descendants(body, "p")
      .filter((p) => {
        for (let at = p.parentNode; at && at !== body; at = at.parentNode)
          if ((at as Element).localName === "del" || (at as Element).localName === "moveFrom")
            return false;
        return true;
      })
      .map((p) => {
        const styleId = attr(child(child(p, "pPr") ?? p, "pStyle"), "val");
        const content: InlineNode[] = [];
        const walk = (node: Element, current: MarkType[]) => {
          if (["del", "moveFrom", "instrText", "pPr", "rPr"].includes(node.localName ?? "")) return;
          // Nested text-box paragraphs are returned separately, in document order.
          if (node !== p && node.localName === "p") return;
          let active = current;
          if (node.localName === "r") {
            const props = child(node, "rPr");
            active = [
              ...new Set([
                ...current,
                ...inherited(attr(props && child(props, "rStyle"), "val")),
                ...marks(props),
              ]),
            ];
            for (const [tag, mark] of [
              ["b", "strong"],
              ["i", "em"],
              ["u", "underline"],
            ] as const) {
              const flag = props && child(props, tag);
              if (flag && ["0", "false", "off", "none"].includes(attr(flag, "val")))
                active = active.filter((m) => m !== mark);
            }
          }
          const value =
            node.localName === "t"
              ? (node.textContent ?? "")
              : node.localName === "tab"
                ? "\t"
                : ["br", "cr"].includes(node.localName ?? "")
                  ? "\n"
                  : "";
          if (value)
            content.push({
              type: "text",
              text: value,
              ...(active.length ? { marks: active.map((type) => ({ type })) } : {}),
            });
          if (node.localName !== "t") for (const c of children(node)) walk(c, active);
        };
        walk(p, inherited(styleId));
        return {
          content,
          style: styles.get(styleId)?.name || styleId || "Unstyled",
          kind: inheritedKind(styleId),
        };
      })
      .filter((p) => paragraphText(p).trim());
  const body = child(root, "body");
  if (!body) throw new Error("This Word document has no body text.");
  const result: ImportDocument = {
    name,
    format: "Word",
    paragraphs: paragraphs(body),
    frontMatter: {},
    notices: [
      "Page layout, fonts, headers and footers are replaced by your Proscenium script format.",
    ],
  };
  if (descendants(body, "tbl").length)
    result.notices.push(
      "Tables are read cell by cell, in row order. Check any side-by-side dialogue.",
    );
  if (descendants(body, "drawing").length || descendants(body, "pict").length)
    result.notices.push(
      "Images and drawings stay in the original file. Text in text boxes is included where available.",
    );
  if (["del", "ins", "moveFrom", "moveTo"].some((n) => descendants(body, n).length))
    result.notices.push(
      "The current text is imported: insertions included, tracked deletions omitted. Revision history stays in the original.",
    );
  if (parts["docProps/core.xml"]) {
    const core = xml(decode(parts["docProps/core.xml"]));
    const title = descendants(core, "title")[0]?.textContent?.trim();
    if (title) result.frontMatter.title = title;
  }
  for (const [path, tag, label] of [
    ["word/footnotes.xml", "footnote", "Footnotes"],
    ["word/endnotes.xml", "endnote", "Endnotes"],
    ["word/comments.xml", "comment", "Comments"],
  ]) {
    if (!parts[path]) continue;
    const notes = descendants(xml(decode(parts[path])), tag)
      .filter((n) => !attr(n, "type") && Number(attr(n, "id")) >= 0)
      .flatMap(paragraphs);
    if (!notes.length) continue;
    result.paragraphs.push(
      {
        content: plain(`${label} from the original document`),
        style: label,
        kind: "action",
      },
      ...notes.map((p) => ({ ...p, kind: "action" as const })),
    );
    result.notices.push(
      `${label} are included at the end of the script. Their original anchors stay in the Word file.`,
    );
  }
  return result;
}

export function readOdt(name: string, bytes: Uint8Array): ImportDocument {
  const parts = zipParts(bytes, new Set(["content.xml", "styles.xml"]));
  if (!parts["content.xml"])
    throw new Error("This is not a readable OpenDocument text file. Export an unprotected copy.");
  const root = xml(decode(parts["content.xml"]));
  const body = descendants(root, "text")[0];
  if (!body) throw new Error("This OpenDocument file has no text body.");
  const styles = new Map<string, { name: string; base: string; marks: MarkType[] }>();
  for (const source of [parts["styles.xml"] ? xml(decode(parts["styles.xml"])) : null, root]) {
    if (!source) continue;
    for (const s of descendants(source, "style")) {
      const props = child(s, "text-properties");
      styles.set(attr(s, "name"), {
        name: attr(s, "display-name"),
        base: attr(s, "parent-style-name"),
        marks: [
          ...(attr(props, "font-weight") === "bold" ? ["strong" as const] : []),
          ...(attr(props, "font-style") === "italic" ? ["em" as const] : []),
          ...(attr(props, "text-underline-style") && attr(props, "text-underline-style") !== "none"
            ? ["underline" as const]
            : []),
        ],
      });
    }
  }
  const styleInfo = (id: string, seen = new Set<string>()): { name: string; marks: MarkType[] } => {
    const s = styles.get(id);
    if (!s || seen.has(id)) return { name: id || "Unstyled", marks: [] };
    seen.add(id);
    const parent = styleInfo(s.base, seen);
    return {
      name: s.name || (s.base ? parent.name : id),
      marks: [...new Set([...parent.marks, ...s.marks])],
    };
  };
  const result: ImportDocument = {
    name,
    format: "OpenDocument",
    paragraphs: [],
    frontMatter: {},
    notices: [
      "Page layout, images, headers and footers stay in the original. Tables are read in row order; notes are included as text.",
    ],
  };
  const walk = (p: Element, node: Element, active: MarkType[], content: InlineNode[]) => {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        if (n.nodeValue)
          content.push({
            type: "text",
            text: n.nodeValue,
            marks: active.map((type) => ({ type })),
          });
        continue;
      }
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      const special =
        e.localName === "tab"
          ? "\t"
          : e.localName === "line-break"
            ? "\n"
            : e.localName === "s"
              ? " ".repeat(Math.min(1000, Math.max(1, Number(attr(e, "c")) || 1)))
              : null;
      if (special !== null) content.push(...plain(special));
      else
        walk(p, e, [...new Set([...active, ...styleInfo(attr(e, "style-name")).marks])], content);
    }
  };
  // Select outer paragraphs only: a note can itself contain paragraphs.
  const collect = (node: Element) => {
    for (const e of children(node)) {
      if (e.localName === "tracked-changes") continue;
      if (e.localName === "p" || e.localName === "h") {
        const info = styleInfo(attr(e, "style-name"));
        const content: InlineNode[] = [];
        walk(e, e, info.marks, content);
        const p = { content, style: info.name };
        if (paragraphText(p).trim()) result.paragraphs.push(p);
      } else collect(e);
    }
  };
  collect(body);
  return result;
}
