// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

interface Paragraph { type: string; text: string }
export interface FdxParagraphs { title: Paragraph[]; body: Paragraph[] }

/** XML text only; never resolve entities or fetch a DTD. Invalid numeric
 * references stay literal, including values outside Unicode's scalar range. */
function decode(text: string): string {
  const named: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
  return text.replace(/&(#x[\da-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, (raw, key: string) => {
    if (!key.startsWith("#")) return named[key]!;
    const value = key[1] === "x" ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : raw;
  });
}

/** Scan tags once, respecting quotes, comments and CDATA. No retrying a failed
 * Paragraph/Text match from every subsequent '<'. A malformed document is
 * refused as a whole, so a partial conversion never becomes a new play. */
export function scanFdx(xml: string): FdxParagraphs | null {
  const result: FdxParagraphs = { title: [], body: [] };
  const stack: string[] = [];
  let nodes = 0, i = 0, titleDepth = 0, contentDepth = 0, textDepth = 0;
  let sawRoot = false, sawContent = false;
  let paragraph: { type: string; plain: string[]; runs: string[]; hasRuns: boolean; title: boolean } | null = null;
  const append = (text: string, literal = false) => {
    if (!paragraph) return;
    const decoded = literal ? text : decode(text);
    paragraph.plain.push(decoded);
    if (textDepth) paragraph.runs.push(decoded);
  };
  const close = (name: string) => {
    if (name === "Paragraph" && paragraph) {
      const text = (paragraph.hasRuns ? paragraph.runs : paragraph.plain).join("").trim();
      (paragraph.title ? result.title : result.body).push({ type: paragraph.type, text });
      paragraph = null;
    }
    if (name === "Text") textDepth--;
    if (name === "TitlePage") titleDepth--;
    if (name === "Content") contentDepth--;
  };
  while (i < xml.length) {
    if (++nodes > 100_000) return null;
    if (xml[i] !== "<") {
      const next = xml.indexOf("<", i);
      const end = next < 0 ? xml.length : next;
      if (!stack.length && xml.slice(i, end).trim()) return null;
      append(xml.slice(i, end)); i = end; continue;
    }
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end < 0) return null;
      i = end + 3; continue;
    }
    if (xml.startsWith("<![CDATA[", i)) {
      const end = xml.indexOf("]]>", i + 9);
      if (end < 0 || !stack.length) return null;
      append(xml.slice(i + 9, end), true); i = end + 3; continue;
    }
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i + 2);
      if (end < 0) return null;
      i = end + 2; continue;
    }
    const closing = xml[i + 1] === "/";
    let cursor = i + (closing ? 2 : 1);
    const nameStart = cursor;
    while (cursor < xml.length && /[\w:.-]/.test(xml[cursor]!)) cursor++;
    if (cursor === nameStart) return null;
    const name = xml.slice(nameStart, cursor);
    const attrsStart = cursor;
    let quote = "";
    while (cursor < xml.length) {
      const ch = xml[cursor]!;
      if (quote) { if (ch === quote) quote = ""; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
      else if (ch === "<") return null;
      cursor++;
    }
    if (cursor >= xml.length) return null;
    const attrs = xml.slice(attrsStart, cursor);
    const selfClosing = !closing && xml[cursor - 1] === "/";
    i = cursor + 1;
    if (closing) {
      if (attrs.trim() || stack.pop() !== name) return null;
      close(name); continue;
    }
    if (stack.length === 0) {
      if (name !== "FinalDraft" || sawRoot) return null;
      sawRoot = true;
    }
    if (stack.length >= 128) return null;
    if (name === "TitlePage") titleDepth++;
    if (name === "Content") { contentDepth++; if (!titleDepth) sawContent = true; }
    if (name === "Paragraph" && contentDepth) {
      if (paragraph) return null;
      const type = /(?:^|\s)Type\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
      paragraph = { type: decode(type?.[1] ?? type?.[2] ?? "General"), plain: [], runs: [], hasRuns: false, title: titleDepth > 0 };
    }
    if (name === "Text") { textDepth++; if (paragraph) paragraph.hasRuns = true; }
    if (selfClosing) close(name);
    else stack.push(name);
  }
  return sawRoot && sawContent && stack.length === 0 ? result : null;
}
