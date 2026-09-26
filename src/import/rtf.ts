// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { InlineNode, MarkType } from "../fountain/model";
import { paragraphText, type ImportDocument, type Paragraph } from "./model";

interface State {
  skip: boolean;
  uc: number;
  marks: Set<MarkType>;
  style: string;
}
const DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "header",
  "headerl",
  "headerr",
  "footer",
  "footerl",
  "footerr",
  "fldinst",
  "listtable",
  "listoverridetable",
  "revtbl",
  "generator",
  "datastore",
  "themedata",
  "colorschememapping",
  "xmlnstbl",
]);

/** Small, bounded RTF reader. Groups restore formatting; Unicode fallback
 * characters and binary payloads are consumed, never mistaken for prose. */
export function readRtf(name: string, source: string): ImportDocument {
  if (!/^\s*\{\\rtf1\b/.test(source)) throw new Error("This file is not a readable RTF document.");
  let state: State = {
    skip: false,
    uc: 1,
    marks: new Set(),
    style: "Unstyled",
  };
  const stack: State[] = [];
  const paragraphs: Paragraph[] = [];
  let content: InlineNode[] = [],
    paragraphStyle = "Unstyled",
    fallback = 0,
    i = 0;
  let decoder = new TextDecoder("windows-1252");
  const styles = new Map<string, string>();
  for (const match of source.matchAll(/\{\\s(\d+)\b([^{}]*?);\}/g)) {
    const label = match[2].replace(/\\[a-z]+-?\d* ?|\\[^a-z]/gi, "").trim();
    if (label) styles.set(match[1], label);
  }
  const emit = (value: string, unicode = false) => {
    if (!unicode && fallback) {
      fallback--;
      return;
    }
    if (state.skip || !value) return;
    if (!content.length) paragraphStyle = state.style;
    const marks = [...state.marks].map((type) => ({ type }));
    const last = content[content.length - 1];
    if (last?.type === "text" && JSON.stringify(last.marks) === JSON.stringify(marks))
      last.text += value;
    else content.push({ type: "text", text: value, marks });
  };
  const flush = () => {
    const p = { content, style: paragraphStyle };
    if (paragraphText(p).trim()) paragraphs.push(p);
    content = [];
  };
  while (i < source.length) {
    const c = source[i++];
    if (c === "{") {
      if (stack.length >= 100)
        throw new Error("This RTF is too deeply nested. Export as Word or plain text.");
      stack.push(state);
      state = { ...state, marks: new Set(state.marks) };
      continue;
    }
    if (c === "}") {
      if (!stack.length) throw new Error("This RTF file is damaged.");
      state = stack.pop()!;
      fallback = 0;
      continue;
    }
    if (c !== "\\") {
      if (c !== "\r" && c !== "\n") emit(c);
      continue;
    }
    const symbol = source[i];
    if (symbol === "'" && /^[\da-f]{2}$/i.test(source.slice(i + 1, i + 3))) {
      emit(decoder.decode(new Uint8Array([parseInt(source.slice(i + 1, i + 3), 16)])));
      i += 3;
      continue;
    }
    if (symbol === "*") {
      state.skip = true;
      i++;
      continue;
    }
    if (!/[a-z]/i.test(symbol ?? "")) {
      i++;
      if (symbol === "\\" || symbol === "{" || symbol === "}") emit(symbol);
      else if (symbol === "~") emit("\u00a0");
      else if (symbol === "_") emit("‑");
      else if (symbol === "-") emit("\u00ad");
      continue;
    }
    const start = i;
    while (/[a-z]/i.test(source[i] ?? "")) i++;
    const word = source.slice(start, i);
    const numStart = i;
    if (source[i] === "-") i++;
    while (/\d/.test(source[i] ?? "")) i++;
    const hasNumber = i > numStart && source.slice(numStart, i) !== "-";
    const number = hasNumber ? Number(source.slice(numStart, i)) : 1;
    if (source[i] === " ") i++;
    if (word === "bin") {
      if (!hasNumber || number < 0 || i + number > source.length)
        throw new Error("This RTF has a damaged embedded object.");
      i += number;
      continue;
    }
    if (DESTINATIONS.has(word)) {
      state.skip = true;
      continue;
    }
    if (word === "ansicpg") {
      // Single-byte legacy encodings only; refusing is safer than mojibake.
      if (![1250, 1251, 1252, 1253, 1254, 1255, 1256, 1257, 1258].includes(number))
        throw new Error("This RTF uses an unsupported text encoding. Export it as Word (.docx).");
      decoder = new TextDecoder(`windows-${number}`);
      continue;
    }
    if (word === "uc") {
      state.uc = Math.min(16, Math.max(0, number));
      continue;
    }
    if (word === "u") {
      emit(String.fromCharCode(number < 0 ? number + 65536 : number), true);
      fallback = state.uc;
      continue;
    }
    if (state.skip) continue;
    if (word === "par" || word === "row") flush();
    else if (word === "line") emit("\n");
    else if (word === "tab" || word === "cell") emit("\t");
    else if (word === "s") state.style = styles.get(String(number)) ?? `Style ${number}`;
    else if (word === "pard") state.style = "Unstyled";
    else if (word === "plain") state.marks.clear();
    else if (["b", "i", "ul", "ulnone"].includes(word)) {
      const mark = word === "b" ? "strong" : word === "i" ? "em" : "underline";
      if (number === 0 || word === "ulnone") state.marks.delete(mark);
      else state.marks.add(mark);
    } else {
      const chars: Record<string, string> = {
        emdash: "—",
        endash: "–",
        lquote: "‘",
        rquote: "’",
        ldblquote: "“",
        rdblquote: "”",
        bullet: "•",
      };
      if (Object.prototype.hasOwnProperty.call(chars, word)) emit(chars[word]);
    }
  }
  if (stack.length)
    throw new Error("This RTF file ends before the document is complete. Export a fresh copy.");
  flush();
  return {
    name,
    format: "Rich Text",
    paragraphs,
    frontMatter: {},
    notices: [
      "Basic emphasis is preserved. Page layout, images, headers, footers and revision metadata stay in the original. Check tables and notes in the preview.",
    ],
  };
}
