// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Span } from "./parse";

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!>|~]/;
const WORDCHAR = /[\p{L}\p{N}]/u;
export const MAX_MARKDOWN_DEPTH = 32;
export const MAX_MARKDOWN_NODES = 50_000;
export class MarkdownBudget extends Error {}
export interface Budget { left: number }
export function spend(budget: Budget, nodes = 1): void {
  budget.left -= nodes;
  if (budget.left < 0) throw new MarkdownBudget();
}

interface Run { start: number; end: number; marker: string; code?: Run; one?: Run; two?: Run }
interface Link { close: number; end: number; hrefEnd: number }

/** One forward lexical pass, one reverse delimiter-index pass. A failed opener
 * never scans the suffix again. Recursive bodies are bounded to 32 passes. */
export function scanSpans(source: string, budget: Budget, depth = 0): Span[] {
  if (depth >= MAX_MARKDOWN_DEPTH) throw new MarkdownBudget();
  const runs: Run[] = [];
  const at = new Map<number, Run>();
  const links = new Map<number, Link>();
  let brackets: number[] = [];
  let hrefStop = -1;
  const destinationTails = new Map<number, number>();
  for (let i = 0; i < source.length;) {
    const ch = source[i]!;
    if (ch === "`" || ch === "*" || ch === "_") {
      let end = i + 1;
      while (source[end] === ch) end++;
      const run = { start: i, end, marker: ch };
      spend(budget);
      runs.push(run); at.set(i, run); i = end;
    } else if (ch === "[") {
      spend(budget); brackets.push(i++);
    } else if (ch === "]") {
      if (brackets.length && source[i + 1] === "(") {
        // Each destination is scanned once, even for thousands of unmatched [.
        if (hrefStop < i + 2) {
          hrefStop = i + 2;
          while (hrefStop < source.length && source[hrefStop] !== ")" && !/\s/.test(source[hrefStop]!)) hrefStop++;
        }
        let j = destinationTails.get(hrefStop);
        if (j === undefined) {
          j = hrefStop;
          if (/\s/.test(source[j] ?? "")) {
            while (j < source.length && /\s/.test(source[j]!)) j++;
            if (source[j] === '"') {
              j++;
              while (j < source.length && source[j] !== '"') j++;
              if (source[j] === '"') j++;
            } else j = -1;
          }
          destinationTails.set(hrefStop, j);
        }
        if (hrefStop > i + 2 && source[j] === ")") {
          const link = { close: i, end: j + 1, hrefEnd: hrefStop };
          for (const open of brackets) links.set(open, link);
        }
      }
      brackets = []; i++;
    } else i++;
  }
  const codes = new Map<number, Run>();
  const one = new Map<string, Run>();
  const two = new Map<string, Run>();
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!;
    const width = run.end - run.start;
    if (run.marker === "`") {
      run.code = codes.get(width);
      if (source[run.start - 1] !== "\\") codes.set(width, run);
    } else {
      run.one = one.get(run.marker); run.two = two.get(run.marker);
      const canClose = !(run.marker === "_" && WORDCHAR.test(source[run.end] ?? ""));
      // A longer closing run contributes its last one/two markers, preserving
      // **bold *and italic*** and ***both*** when the body is scanned next.
      if (canClose && source[run.end - 2] !== "\\" && !/\s/.test(source[run.end - 2] ?? "")) one.set(run.marker, run);
      if (width >= 2 && canClose && source[run.end - 3] !== "\\" && !/\s/.test(source[run.end - 3] ?? "")) two.set(run.marker, run);
    }
  }
  const out: Span[] = [];
  let buf = "";
  const push = (span: Span) => { spend(budget); out.push(span); };
  const flush = () => { if (buf) push({ kind: "text", text: buf }); buf = ""; };
  for (let i = 0; i < source.length;) {
    const ch = source[i]!;
    if (ch === "\\" && ESCAPABLE.test(source[i + 1] ?? "")) { buf += source[i + 1]; i += 2; continue; }
    if (ch === "\n") { flush(); push({ kind: "break" }); i++; continue; }
    const link = links.get(i);
    if (link) {
      flush();
      const href = source.slice(link.close + 2, link.hrefEnd);
      push(/^(https?:|mailto:)/i.test(href)
        ? { kind: "link", href, spans: scanSpans(source.slice(i + 1, link.close), budget, depth + 1) }
        : { kind: "text", text: source.slice(i, link.end) });
      i = link.end; continue;
    }
    const run = at.get(i);
    if (run) {
      if (run.marker === "`" && run.code) {
        flush(); push({ kind: "code", text: source.slice(run.end, run.code.start).replace(/^ | $/g, "") });
        i = run.code.end; continue;
      }
      const after = source[run.end] ?? "";
      const opens = after !== "" && !/\s/.test(after) && !(run.marker === "_" && WORDCHAR.test(source[i - 1] ?? ""));
      const width = run.end - i >= 2 && run.two ? 2 : 1;
      const close = width === 2 ? run.two : run.one;
      if (run.marker !== "`" && opens && close) {
        flush();
        push({ kind: width === 2 ? "strong" : "em", spans: scanSpans(source.slice(i + width, close.end - width), budget, depth + 1) });
        i = close.end; continue;
      }
      buf += source.slice(i, run.end); i = run.end; continue;
    }
    buf += ch; i++;
  }
  flush(); return out;
}
