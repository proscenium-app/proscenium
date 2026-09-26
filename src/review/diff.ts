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

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const head = a.slice(0, start).map((text): DiffLine => ({ kind: "same", text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ kind: "same", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  let middle: DiffLine[];
  if (midA.length === 0 && midB.length === 0) {
    middle = [];
  } else if (midA.length > LCS_LIMIT || midB.length > LCS_LIMIT) {
    middle = [
      ...midA.map((text): DiffLine => ({ kind: "del", text })),
      ...midB.map((text): DiffLine => ({ kind: "add", text })),
    ];
  } else {
    middle = lcsDiff(midA, midB);
  }
  return [...head, ...middle, ...tail];
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // lengths[i][j] = LCS length of a[i..] vs b[j..]
  const lengths: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  return out;
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
