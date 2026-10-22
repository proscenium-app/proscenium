// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Line diff for a changed script — small and dependency-free. Common
 * prefix/suffix are trimmed first; the middle gets an LCS walk when it is
 * reasonably sized, and degrades to a plain replace block for huge rewrites
 * (this is for eyeballing a change, not for archaeology).
 */

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

const LCS_LIMIT = 900; // per side, after trimming — keeps the DP table small

/** One step of a comparison of two lists: an item of both, of the first only, or of the second only. */
export type DiffOp =
  | { kind: "same"; a: number; b: number }
  | { kind: "del"; a: number }
  | { kind: "add"; b: number };

/**
 * The comparison itself, on any two lists of keys: the lines of two texts
 * here, and the blocks and words of two scripts for the redline
 * (redline.ts). Indexes come back, so a caller keeps whatever each key stood
 * for.
 */
export function diffKeys(a: readonly string[], b: readonly string[]): DiffOp[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffOp[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", a: i, b: i });
  const n = endA - start;
  const m = endB - start;
  if (n > LCS_LIMIT || m > LCS_LIMIT) {
    for (let i = start; i < endA; i++) out.push({ kind: "del", a: i });
    for (let j = start; j < endB; j++) out.push({ kind: "add", b: j });
  } else if (n > 0 || m > 0) {
    // lengths[i][j] = LCS length of a[start + i..] vs b[start + j..]
    const lengths: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lengths[i][j] =
          a[start + i] === b[start + j]
            ? lengths[i + 1][j + 1] + 1
            : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        out.push({ kind: "same", a: start + i, b: start + j });
        i++;
        j++;
      } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
        out.push({ kind: "del", a: start + i++ });
      } else {
        out.push({ kind: "add", b: start + j++ });
      }
    }
    while (i < n) out.push({ kind: "del", a: start + i++ });
    while (j < m) out.push({ kind: "add", b: start + j++ });
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) out.push({ kind: "same", a: i, b: j });
  return out;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  return diffKeys(a, b).map(
    (op): DiffLine =>
      op.kind === "add" ? { kind: "add", text: b[op.b] } : { kind: op.kind, text: a[op.a] },
  );
}

/** Collapse long unchanged stretches for display (keep context lines). */
export function compactDiff(
  lines: DiffLine[],
  context = 2,
): (DiffLine | { kind: "skip"; count: number })[] {
  const out: (DiffLine | { kind: "skip"; count: number })[] = [];
  let sameRun: DiffLine[] = [];
  const flush = (isEnd: boolean, isStart: boolean) => {
    const keepHead = isStart ? 0 : context;
    const keepTail = isEnd ? 0 : context;
    if (sameRun.length <= keepHead + keepTail + 1) {
      out.push(...sameRun);
    } else {
      out.push(...sameRun.slice(0, keepHead));
      out.push({ kind: "skip", count: sameRun.length - keepHead - keepTail });
      out.push(...sameRun.slice(sameRun.length - keepTail));
    }
    sameRun = [];
  };
  let seenChange = false;
  for (const line of lines) {
    if (line.kind === "same") {
      sameRun.push(line);
    } else {
      flush(false, !seenChange);
      seenChange = true;
      out.push(line);
    }
  }
  flush(true, !seenChange);
  return out;
}
