// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A small Markdown parser, shared by every prose surface that reads a `.md`
 * file: the material editor and the outline scratchpad.
 *
 * Markdown is the data on disk (docs/app/keeping-work/storage-and-file-format.md#STOR-D2) — this is what makes it legible.
 * It turns source into a tiny AST that the renderer walks into React elements,
 * never into an HTML string. That is the point: text arriving from a file
 * something else wrote is not trusted markup, and building React nodes means
 * there is no injection surface to sanitize.
 *
 * Deliberately a subset — what the vault's own notes actually use. Anything
 * unrecognised stays literal text rather than disappearing, which
 * is the right failure everywhere it renders: you always see what was written.
 *
 * One deliberate divergence from strict CommonMark: a single newline inside a
 * paragraph is a line break, not a space. Character sheets are written as
 * stacked lines ("**Wants:** …" / "**Fears:** …") and reflowing them into one
 * grey block loses the shape the writer typed.
 */

import { assertDocumentText, DocumentSizeError } from "../storage/read-limit";
import { MANAGED_MARK } from "../materials/schema";
import {
  scanSpans,
  spend,
  MarkdownBudget,
  MAX_MARKDOWN_DEPTH,
  MAX_MARKDOWN_NODES,
  type Budget,
} from "./inline";
import { FOOT_MARK } from "./page-fields";

/** How a file is read. */
export interface ParseOptions {
  /**
   * The file is a page before the script (src/layout/page-files.ts). Its first
   * line that is the foot mark is a block of its own, `foot`, wherever it
   * stands, since the layout splits the page's body from its foot at that
   * line whatever is around it. Any later one is the text it is, as it prints.
   */
  pageFile?: boolean;
}

export interface CodeBlock {
  kind: "code";
  lang: string | null;
  text: string;
}
export interface Heading {
  kind: "heading";
  align?: "center" | "right";
  level: number;
  spans: Span[];
}
export interface Paragraph {
  kind: "paragraph";
  align?: "center" | "right";
  spans: Span[];
}
/** A list item: its own text, plus any lists nested underneath it. */
export interface ListItem {
  spans: Span[];
  children: ListBlock[];
}
export interface ListBlock {
  kind: "list";
  ordered: boolean;
  /** The number the source started at — `3.` renders as 3, not 1. */
  start: number;
  items: ListItem[];
}
export interface Quote {
  kind: "quote";
  spans: Span[];
}
export interface Rule {
  kind: "rule";
}
export type Align = "left" | "center" | "right" | null;
export interface TableBlock {
  kind: "table";
  head: Span[][];
  aligns: Align[];
  rows: Span[][][];
}
export type Block =
  | { kind: "managedMarker"; text: string }
  /** Where a title page's foot begins: read only from a page file. */
  | { kind: "foot" }
  | CodeBlock
  | Heading
  | Paragraph
  | ListBlock
  | Quote
  | Rule
  | TableBlock;

export type Span =
  | { kind: "text"; text: string }
  | { kind: "break" }
  | { kind: "code"; text: string }
  | { kind: "strong"; spans: Span[] }
  | { kind: "em"; spans: Span[] }
  | { kind: "link"; href: string; spans: Span[] };

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
/** Indent, marker, text — the one regex both bullet and numbered items use. */
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
/** `|---|:--:|` — the row that turns the line above it into a table header. */
function tableDelimiter(line: string): boolean {
  if (!line.includes("|")) return false;
  const trimmed = line.trimStart();
  if (trimmed.startsWith("|") && line.length - trimmed.length > 3) return false;
  const cells = trimmed.trimEnd().split("|");
  if (cells[0] === "") cells.shift();
  // The old grammar requires a dash cell ending in |, then permits an empty
  // last cell and an optional trailing |. Check each cell once, with no retry.
  for (let i = 1; i < cells.length; i++) {
    if (!/^:?-+:?$/.test(cells[i - 1]!.trim())) return false;
    if (
      (i === cells.length - 1 || (i === cells.length - 2 && cells[i + 1] === "")) &&
      /^:?-*:?$/.test(cells[i]!.trim())
    )
      return true;
  }
  return false;
}

/** Remove optional closing ATX marks with one backwards scan, avoiding an
 * unanchored whitespace expression retrying across a long malformed line. */
function headingText(text: string): string {
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1]!)) end--;
  let start = end;
  while (start > 0 && text[start - 1] === "#") start--;
  if (start === end || start === 0 || !/\s/.test(text[start - 1]!)) return text;
  while (start > 0 && /\s/.test(text[start - 1]!)) start--;
  return text.slice(0, start);
}
/** Leading whitespace as a column count; a tab is four columns. */
function indentOf(line: string): number {
  const lead = /^[ \t]*/.exec(line)![0];
  let n = 0;
  for (const ch of lead) n += ch === "\t" ? 4 : 1;
  return n;
}

/**
 * The line without its hard-break mark, or null when it has none. An even run
 * of backslashes is escaped backslashes, which end nothing.
 */
function hardEnd(line: string): string | null {
  let slashes = 0;
  while (slashes < line.length && line[line.length - 1 - slashes] === "\\") slashes += 1;
  if (slashes % 2 === 1) return line.slice(0, -1);
  return line.endsWith("  ") ? line.trimEnd() : null;
}

function isItem(line: string): boolean {
  return ITEM.test(line) && !RULE.test(line);
}

/** Whether the foot can still begin: a page file's, until its first foot mark. */
interface Foot {
  open: boolean;
}

function isFoot(line: string, foot: Foot): boolean {
  return foot.open && line.trim() === FOOT_MARK;
}

function isBlockStart(line: string, foot: Foot): boolean {
  return (
    line.trim() === MANAGED_MARK ||
    isFoot(line, foot) ||
    HEADING.test(line) ||
    QUOTE.test(line) ||
    RULE.test(line) ||
    FENCE.test(line) ||
    isItem(line)
  );
}

/** Split source into blocks. Fenced code wins over everything inside it. */
export function parseBlocks(source: string, options: ParseOptions = {}): Block[] {
  try {
    assertDocumentText(source);
    const blocks = scanBlocks(
      source,
      { left: MAX_MARKDOWN_NODES },
      { open: options.pageFile === true },
    );
    // A line set centered or at the right and waiting for words is a comment
    // of its own, `<!-- proscenium:line=center -->`: an empty paragraph, as a
    // page started from a dedication's scaffold begins (src/layout/scaffolds.ts).
    // Its own mark, never the alignment's below with nothing under it: that
    // one sets whatever paragraph follows, so an empty centered line written
    // as it would center the next paragraph when the file was read again.
    const set = blocks.map((block): Block => {
      if (block.kind !== "paragraph" || block.spans.length !== 1 || block.spans[0]!.kind !== "text")
        return block;
      const line = block.spans[0]!.text.match(/^<!-- proscenium:line=(center|right) -->$/);
      return line ? { kind: "paragraph", spans: [], align: line[1] as "center" | "right" } : block;
    });
    // Alignment is a narrow, inert comment; unmatched comments stay visible.
    return set.filter((block, i) => {
      if (block.kind !== "paragraph" || block.spans.length !== 1 || block.spans[0].kind !== "text")
        return true;
      const marker = block.spans[0].text.match(/^<!-- proscenium:align=(center|right) -->$/);
      const next = set[i + 1];
      if (!marker || !next || (next.kind !== "paragraph" && next.kind !== "heading")) return true;
      next.align = marker[1] as "center" | "right";
      return false;
    });
  } catch (error) {
    if (!(error instanceof MarkdownBudget || error instanceof DocumentSizeError)) throw error;
    // Complexity limits keep every original character visible.
    return [{ kind: "code", lang: null, text: source }];
  }
}

function scanBlocks(source: string, budget: Budget, foot: Foot): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    spend(budget);
    const line = lines[i]!;

    if (line.trim() === MANAGED_MARK) {
      out.push({ kind: "managedMarker", text: line.trim() });
      i += 1;
      continue;
    }

    if (isFoot(line, foot)) {
      out.push({ kind: "foot" });
      foot.open = false;
      i += 1;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      const marker = fence[1]![0]!;
      const min = fence[1]!.length;
      const lang = fence[2] || null;
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const close = lines[i]!.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
        if (close && close[1]![0] === marker && close[1]!.length >= min) {
          i += 1;
          break;
        }
        body.push(lines[i]!);
        i += 1;
      }
      // An unterminated fence still renders as code — the model was cut off,
      // and showing the code is better than showing the backticks.
      out.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    if (RULE.test(line)) {
      out.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      out.push({
        kind: "heading",
        level: heading[1]!.length,
        spans: scanSpans(headingText(heading[2]!), budget),
      });
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        body.push(lines[i]!.match(QUOTE)![1]!);
        i += 1;
      }
      out.push({ kind: "quote", spans: scanSpans(body.join("\n").trim(), budget) });
      continue;
    }

    // A table is only a table if the row after the header is a delimiter —
    // otherwise a prose line with a pipe in it would swallow the paragraph.
    if (line.includes("|") && i + 1 < lines.length && tableDelimiter(lines[i + 1]!)) {
      const [table, next] = readTable(lines, i, budget);
      out.push(table);
      i = next;
      continue;
    }

    if (isItem(line)) {
      const [list, next] = readList(lines, i, indentOf(line), budget, foot);
      out.push(list);
      i = next;
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim()) {
      const l = lines[i]!;
      if (para.length && isBlockStart(l, foot)) break;
      para.push(l.trim());
      i += 1;
    }
    out.push({ kind: "paragraph", spans: scanSpans(para.join("\n"), budget) });
  }

  return out;
}

/**
 * One list, from `start`, at `base` columns of indent. Deeper items recurse
 * into a child list on the item above them; shallower items end this list and
 * return to the caller. A single blank line between items keeps the list
 * together — notes are written loose far more often than tight.
 */
function readList(
  lines: string[],
  start: number,
  base: number,
  budget: Budget,
  foot: Foot,
  depth = 0,
): [ListBlock, number] {
  if (depth >= MAX_MARKDOWN_DEPTH) throw new MarkdownBudget();
  const first = lines[start]!.match(ITEM)!;
  const ordered = /\d/.test(first[2]!);
  const startNum = ordered ? Number.parseInt(first[2]!, 10) : 1;
  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    // Look past a single blank line to see whether the list continues.
    if (!lines[i]!.trim()) {
      const next = i + 1;
      if (next >= lines.length || !lines[next]!.trim()) break;
      if (!isItem(lines[next]!) || indentOf(lines[next]!) < base) break;
      i = next;
      continue;
    }

    const line = lines[i]!;
    if (!isItem(line)) break;

    const indent = indentOf(line);
    if (indent < base) break;

    if (indent >= base + 2 && items.length) {
      // Nested: hang a whole child list off the item we just read.
      const [child, next] = readList(lines, i, indent, budget, foot, depth + 1);
      items[items.length - 1]!.children.push(child);
      i = next;
      continue;
    }

    const m = line.match(ITEM)!;
    if (/\d/.test(m[2]!) !== ordered) break; // a different kind of list starts

    const parts = [m[3]!];
    i += 1;
    // Lazy continuation: an indented, non-item line belongs to this item.
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      indentOf(lines[i]!) > base &&
      !isItem(lines[i]!) &&
      !isBlockStart(lines[i]!, foot)
    ) {
      // A wrapped line reflows into the one above. A line the writer ended on
      // purpose says so, with a backslash or two spaces, and stays a line of
      // its own inside the item.
      const ended = hardEnd(parts[parts.length - 1]!);
      if (ended === null) parts.splice(-1, 1, parts[parts.length - 1]!.trimEnd(), " ");
      else parts.splice(-1, 1, ended, "\n");
      parts.push(lines[i]!.trimStart());
      i += 1;
    }
    spend(budget);
    const text = parts.length > 1 ? parts.join("").trimEnd() : parts[0]!;
    items.push({ spans: scanSpans(text, budget), children: [] });
  }

  return [{ kind: "list", ordered, start: startNum, items }, i];
}

/** Header row, delimiter row, then body rows until the pipes stop. */
function readTable(lines: string[], start: number, budget: Budget): [TableBlock, number] {
  const head = splitRow(lines[start]!).map((c) => scanSpans(c, budget));
  const aligns: Align[] = splitRow(lines[start + 1]!).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
  const rows: Span[][][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) {
    const cells = splitRow(lines[i]!);
    // Ragged rows are normal in hand-written tables; pad so every row lines up.
    spend(budget, Math.max(cells.length, head.length));
    while (cells.length < head.length) cells.push("");
    rows.push(cells.map((c) => scanSpans(c, budget)));
    i += 1;
  }
  return [{ kind: "table", head, aligns, rows }, i];
}

/** Cells of one table row. Outer pipes are optional; `\|` is a literal pipe. */
function splitRow(line: string): string[] {
  const body = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|\s*$/, "");
  const cells: string[] = [];
  let buf = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (ch === "\\" && body[i + 1] === "|") {
      buf += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return cells;
}

/**
 * Inline spans. Code wins over emphasis (so `**` inside backticks stays
 * literal), and an unmatched marker stays literal text.
 */
export function parseSpans(source: string): Span[] {
  try {
    assertDocumentText(source);
    return scanSpans(source, { left: MAX_MARKDOWN_NODES });
  } catch (error) {
    if (!(error instanceof MarkdownBudget || error instanceof DocumentSizeError)) throw error;
    return [{ kind: "text", text: source }];
  }
}
