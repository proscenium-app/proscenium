// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { compactDiff, diffLines } from "./diff";

describe("diffLines", () => {
  it("marks identical inputs as all-same", () => {
    const rows = diffLines("a\nb\nc", "a\nb\nc");
    expect(rows.every((r) => r.kind === "same")).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("finds a one-line replacement inside common context", () => {
    const rows = diffLines("one\ntwo\nthree", "one\nTWO\nthree");
    expect(rows).toEqual([
      { kind: "same", text: "one" },
      { kind: "del", text: "two" },
      { kind: "add", text: "TWO" },
      { kind: "same", text: "three" },
    ]);
  });

  it("handles pure insertions and deletions", () => {
    expect(diffLines("a\nc", "a\nb\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "add", text: "b" },
      { kind: "same", text: "c" },
    ]);
    expect(diffLines("a\nb\nc", "a\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "same", text: "c" },
    ]);
  });

  it("compacts long unchanged stretches, keeping context", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 20", "LINE 20");
    const rows = compactDiff(diffLines(before, after));
    const skips = rows.filter((r) => r.kind === "skip");
    expect(skips.length).toBe(2); // before and after the change
    const changed = rows.filter((r) => r.kind === "add" || r.kind === "del");
    expect(changed).toHaveLength(2);
  });
});
