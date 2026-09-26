// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { computeMarks, emptyMarks, mergeMarks } from "./tracked";

// Blocks are non-blank lines: "Title", "MARA", "One.", "JONAH", "Two."
const BEFORE = ["Title: A Play", "", "MARA", "One.", "", "JONAH", "Two."].join("\n");

describe("computeMarks", () => {
  it("marks a rewritten line's block as added", () => {
    const after = BEFORE.replace("One.", "One, and only once.");
    const marks = computeMarks(BEFORE, after);
    expect([...marks.added]).toEqual([2]);
    expect(marks.removedBefore.get(2)).toEqual(["One."]);
  });

  it("marks a pure insertion without claiming anything was removed", () => {
    const after = BEFORE.replace("Two.", "Two.\nAnd three.");
    const marks = computeMarks(BEFORE, after);
    expect(marks.added.size).toBe(1);
    expect(marks.removedBefore.size).toBe(0);
  });

  it("keeps removed text so a deletion can be SHOWN, never re-inserted", () => {
    // The whole reason deletions are widgets: the text is not in the document.
    const after = BEFORE.replace("\nJONAH\nTwo.", "");
    const marks = computeMarks(BEFORE, after);
    const removed = [...marks.removedBefore.values()].flat();
    expect(removed).toContain("JONAH");
    expect(removed).toContain("Two.");
    expect(marks.added.size).toBe(0);
  });

  it("ignores blank-line churn — a blank line is not a block", () => {
    const after = BEFORE.replace("MARA\nOne.", "MARA\n\nOne.");
    const marks = computeMarks(BEFORE, after);
    expect(marks.added.size).toBe(0);
    expect(marks.removedBefore.size).toBe(0);
  });

  it("is empty for an identical script", () => {
    const marks = computeMarks(BEFORE, BEFORE);
    expect(marks.added.size).toBe(0);
    expect(marks.removedBefore.size).toBe(0);
  });
});

describe("mergeMarks", () => {
  it("unions several pending changes into one view", () => {
    const a = computeMarks(BEFORE, BEFORE.replace("One.", "One!"));
    const b = computeMarks(BEFORE, BEFORE.replace("Two.", "Two!"));
    const merged = mergeMarks([a, b]);
    expect(merged.added.size).toBe(2);
  });

  it("handles an empty list", () => {
    expect(mergeMarks([]).added.size).toBe(0);
    expect(mergeMarks([emptyMarks()]).removedBefore.size).toBe(0);
  });
});
