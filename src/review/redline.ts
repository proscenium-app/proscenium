// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The redline: two texts read as one page, with what was cut struck through
 * and what was added marked where it now stands
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-177).
 *
 * A list of added and removed lines is how a programmer reads a change. A
 * writer reads a page: the speech as it stands, the three words that went
 * crossed out inside it. So the comparison is made twice. First block against
 * block, a line of a note or an element of a script; then, where a block was
 * rewritten and not replaced, word against word inside it.
 *
 * Pure, and it knows nothing of a script: a block is a kind and its words.
 * What a block looks like is the caller's (redline-doc.ts for a script,
 * RedlineText.tsx for any other text).
 */
import { diffKeys } from "./diff";

/** One word, run of spaces or mark of punctuation. */
export interface RedlineToken {
  /** What two tokens must share to be the same one: its text, and whatever else it carries. */
  key: string;
  /** A word, as opposed to the space or punctuation between two. */
  word: boolean;
  /** Nothing but space. */
  space?: boolean;
}

/** One block of a text. */
export interface RedlineUnit {
  /** What it is. Only two blocks of one kind are read word against word. */
  kind: string;
  tokens: readonly RedlineToken[];
  /** Anything else that makes two blocks with the same words differ. */
  extra?: string;
  /** Never read word against word: it shows whole, as cut or as added. */
  whole?: boolean;
}

/** A stretch of a rewritten block: kept and added words by their place in the new block, cut ones by their place in the old. */
export type RedlinePart = { state: "same" | "add"; b: number[] } | { state: "del"; a: number[] };

export type RedlineRow =
  | { state: "same"; a: number; b: number }
  | { state: "del"; a: number }
  | { state: "add"; b: number }
  /** Rewritten: block `a` became block `b`. */
  | { state: "mod"; a: number; b: number; parts: RedlinePart[] };

/**
 * How much of two blocks must be the same words before the change is shown
 * inside one block. Below it the old block is struck whole above the new one:
 * a rewritten speech read word against word is confetti.
 */
const REWRITE_FLOOR = 0.5;
/** The most pairs of blocks one changed stretch is matched over; past it, old then new. */
const PAIR_LIMIT = 3600;

const TOKEN = /\s+|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}]/gu;
const WORD = /^[\p{L}\p{N}]/u;

/** A text as words, spaces and punctuation, each its own token. */
export function tokenize(text: string): RedlineToken[] {
  return (text.match(TOKEN) ?? []).map((key) => ({
    key,
    word: WORD.test(key),
    space: key.trim() === "",
  }));
}

/** A plain text as blocks: one a line. */
export function lineUnits(text: string): RedlineUnit[] {
  return text.split("\n").map((line) => ({ kind: "line", tokens: tokenize(line) }));
}

function unitKey(unit: RedlineUnit): string {
  return `${unit.kind}\u0000${unit.extra ?? ""}\u0000${unit.tokens.map((t) => t.key).join("\u0001")}`;
}

function sameTokens(a: RedlineUnit, b: RedlineUnit): boolean {
  return a.tokens.length === b.tokens.length && a.tokens.every((t, i) => t.key === b.tokens[i].key);
}

/** The share of two blocks' words that are the same words, 0 to 1. */
function likeness(a: RedlineUnit, b: RedlineUnit): number {
  if (a.whole || b.whole) return 0;
  // An element retyped, a cue made dual: the same words, so the same block.
  if (sameTokens(a, b)) return 1;
  if (a.kind !== b.kind) return 0;
  const counts = new Map<string, number>();
  let wordsA = 0;
  for (const t of a.tokens) {
    if (!t.word) continue;
    wordsA++;
    counts.set(t.key, (counts.get(t.key) ?? 0) + 1);
  }
  let wordsB = 0;
  let shared = 0;
  for (const t of b.tokens) {
    if (!t.word) continue;
    wordsB++;
    const left = counts.get(t.key) ?? 0;
    if (left > 0) {
      shared++;
      counts.set(t.key, left - 1);
    }
  }
  // Twice the shared words over all of both: a cue that gained "(O.S.)" is
  // still that cue, where a share of the longer block alone would call it new.
  const all = wordsA + wordsB;
  return all === 0 ? 0 : (2 * shared) / all;
}

/** A rewritten block's stretches, cut words before the ones that took their place. */
function wordParts(a: RedlineUnit, b: RedlineUnit, close: boolean): RedlinePart[] {
  const allA = a.tokens.map((_, i) => i);
  const allB = b.tokens.map((_, i) => i);
  const whole: RedlinePart[] = [];
  if (allA.length) whole.push({ state: "del", a: allA });
  if (allB.length) whole.push({ state: "add", b: allB });
  if (!close) return whole;

  // Runs of the comparison: kept, or changed (cut and added together).
  type Run = { same: boolean; a: number[]; b: number[] };
  const runs: Run[] = [];
  for (const op of diffKeys(
    a.tokens.map((t) => t.key),
    b.tokens.map((t) => t.key),
  )) {
    const same = op.kind === "same";
    let last = runs[runs.length - 1];
    if (!last || last.same !== same) {
      last = { same, a: [], b: [] };
      runs.push(last);
    }
    if (op.kind !== "add") last.a.push(op.a);
    if (op.kind !== "del") last.b.push(op.b);
  }
  // A space kept between two changes joins them: "quick brown" became
  // "slow red", not two changes with a space left standing between.
  const joined: Run[] = [];
  runs.forEach((run, i) => {
    // Runs alternate, so a kept run with one on each side stands between two changes.
    const between =
      run.same && i > 0 && i < runs.length - 1 && run.b.every((at) => b.tokens[at].space);
    const last = joined[joined.length - 1];
    if ((between || !run.same) && last && !last.same) {
      last.a.push(...run.a);
      last.b.push(...run.b);
    } else {
      joined.push({ same: run.same, a: [...run.a], b: [...run.b] });
    }
  });
  // A space both the cut words and the added ones end (or begin) on was
  // never changed: it goes back outside the marks.
  const tidy: Run[] = [];
  for (const run of joined) {
    if (run.same || !run.a.length || !run.b.length) {
      const last = tidy[tidy.length - 1];
      if (run.same && last?.same) last.b.push(...run.b);
      else tidy.push(run);
      continue;
    }
    const shared = (i: number, j: number) =>
      a.tokens[i].space === true && a.tokens[i].key === b.tokens[j].key;
    const lead: number[] = [];
    while (run.a.length > 1 && run.b.length > 1 && shared(run.a[0], run.b[0])) {
      run.a.shift();
      lead.push(run.b.shift()!);
    }
    const trail: number[] = [];
    while (
      run.a.length > 1 &&
      run.b.length > 1 &&
      shared(run.a[run.a.length - 1], run.b[run.b.length - 1])
    ) {
      run.a.pop();
      trail.unshift(run.b.pop()!);
    }
    const last = tidy[tidy.length - 1];
    if (lead.length) {
      if (last?.same) last.b.push(...lead);
      else tidy.push({ same: true, a: [], b: lead });
    }
    tidy.push(run);
    if (trail.length) tidy.push({ same: true, a: [], b: trail });
  }
  const parts: RedlinePart[] = [];
  for (const run of tidy) {
    if (run.same) parts.push({ state: "same", b: run.b });
    else {
      if (run.a.length) parts.push({ state: "del", a: run.a });
      if (run.b.length) parts.push({ state: "add", b: run.b });
    }
  }
  return parts;
}

/**
 * One changed stretch: which cut block became which added one. Matched in
 * order, for the most shared words overall, so a line added above a rewritten
 * one does not take its place.
 */
function pairStretch(
  a: readonly RedlineUnit[],
  b: readonly RedlineUnit[],
  dels: number[],
  adds: number[],
): RedlineRow[] {
  const plain = (): RedlineRow[] => [
    ...dels.map((at): RedlineRow => ({ state: "del", a: at })),
    ...adds.map((at): RedlineRow => ({ state: "add", b: at })),
  ];
  if (!dels.length || !adds.length) return plain();
  const mod = (i: number, j: number, close: boolean): RedlineRow => ({
    state: "mod",
    a: i,
    b: j,
    parts: wordParts(a[i], b[j], close),
  });
  if (dels.length === 1 && adds.length === 1) {
    // One block for one of its kind is that block rewritten, however little is left of it.
    const [i] = dels;
    const [j] = adds;
    const like = likeness(a[i], b[j]);
    if (like >= REWRITE_FLOOR) return [mod(i, j, true)];
    if (a[i].kind === b[j].kind && !a[i].whole && !b[j].whole) return [mod(i, j, false)];
    return plain();
  }
  const n = dels.length;
  const m = adds.length;
  if (n * m > PAIR_LIMIT) return plain();
  const like: Float64Array[] = dels.map(
    (i) => new Float64Array(adds.map((j) => likeness(a[i], b[j]))),
  );
  // best[i][j]: the most likeness dels[i..] and adds[j..] can be matched for.
  const best: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const pair = like[i][j] >= REWRITE_FLOOR ? like[i][j] + best[i + 1][j + 1] : -1;
      best[i][j] = Math.max(pair, best[i + 1][j], best[i][j + 1]);
    }
  }
  const out: RedlineRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const pair = like[i][j] >= REWRITE_FLOOR ? like[i][j] + best[i + 1][j + 1] : -1;
    if (pair >= best[i + 1][j] && pair >= best[i][j + 1]) {
      out.push(mod(dels[i++], adds[j++], true));
    } else if (best[i + 1][j] >= best[i][j + 1]) {
      out.push({ state: "del", a: dels[i++] });
    } else {
      out.push({ state: "add", b: adds[j++] });
    }
  }
  while (i < n) out.push({ state: "del", a: dels[i++] });
  while (j < m) out.push({ state: "add", b: adds[j++] });
  return out;
}

/** Both texts as one run of blocks: kept, cut, added, or rewritten. */
export function redlineRows(a: readonly RedlineUnit[], b: readonly RedlineUnit[]): RedlineRow[] {
  const rows: RedlineRow[] = [];
  let dels: number[] = [];
  let adds: number[] = [];
  const flush = () => {
    if (dels.length || adds.length) rows.push(...pairStretch(a, b, dels, adds));
    dels = [];
    adds = [];
  };
  for (const op of diffKeys(a.map(unitKey), b.map(unitKey))) {
    if (op.kind === "same") {
      flush();
      rows.push({ state: "same", a: op.a, b: op.b });
    } else if (op.kind === "del") dels.push(op.a);
    else adds.push(op.b);
  }
  flush();
  return rows;
}

/** A row to show, or a run of unchanged rows left out before row `next` (the count of rows, at the end). */
export type RedlineItem =
  | { kind: "row"; row: RedlineRow; index: number }
  | { kind: "skip"; count: number; next: number };

/**
 * The changed rows with `context` unchanged rows around each, and the rest
 * left out. `together(i)` says row `i` cannot be shown without row `i + 1`,
 * nor that one without it: a cue and its speech. `needs(i)` names rows that
 * row `i`, shown, cannot be shown without: the list item a nested one hangs
 * from.
 */
export function compactRedline(
  rows: readonly RedlineRow[],
  context = 3,
  together: (index: number) => boolean = () => false,
  needs: (index: number) => readonly number[] = () => [],
): RedlineItem[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  rows.forEach((row, i) => {
    if (row.state === "same") return;
    const from = Math.max(0, i - context);
    const to = Math.min(rows.length - 1, i + context);
    for (let k = from; k <= to; k++) keep[k] = true;
  });
  if (!keep.includes(true)) return [];
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i + 1 < rows.length; i++) {
      if (keep[i] !== keep[i + 1] && together(i)) {
        keep[i] = true;
        keep[i + 1] = true;
        changed = true;
      }
    }
    for (let i = 0; i < rows.length; i++) {
      if (!keep[i]) continue;
      for (const n of needs(i))
        if (!keep[n]) {
          keep[n] = true;
          changed = true;
        }
    }
    // One row left out takes the room it would have taken shown.
    for (let i = 0; i < rows.length; i++) {
      if (keep[i]) continue;
      let end = i;
      while (end < rows.length && !keep[end]) end++;
      if (end - i === 1) {
        keep[i] = true;
        changed = true;
      }
      i = end;
    }
  }
  const out: RedlineItem[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (keep[i]) {
      out.push({ kind: "row", row: rows[i], index: i });
      continue;
    }
    let end = i;
    while (end < rows.length && !keep[end]) end++;
    out.push({ kind: "skip", count: end - i, next: end });
    i = end - 1;
  }
  return out;
}

/** How many blocks a redline cut, added or rewrote. */
export function redlineChanges(rows: readonly RedlineRow[]): number {
  return rows.filter((row) => row.state !== "same").length;
}

/**
 * Words added and words cut between two texts, read as the redline reads them
 * (block, then word): what a writer counts a change in. A line count calls a
 * speech with one word changed "1 added, 1 removed".
 */
export function wordStats(before: string, after: string): { added: number; removed: number } {
  const a = lineUnits(before);
  const b = lineUnits(after);
  const words = (unit: RedlineUnit, at?: readonly number[]) =>
    (at ? at.map((i) => unit.tokens[i]) : unit.tokens).filter((t) => t.word).length;
  let added = 0;
  let removed = 0;
  for (const row of redlineRows(a, b)) {
    if (row.state === "add") added += words(b[row.b]);
    else if (row.state === "del") removed += words(a[row.a]);
    else if (row.state === "mod")
      for (const part of row.parts) {
        if (part.state === "add") added += words(b[row.b], part.b);
        else if (part.state === "del") removed += words(a[row.a], part.a);
      }
  }
  return { added, removed };
}
