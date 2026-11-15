// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { fractionAlong, lineAt } from "./zoom-anchor";

describe("lineAt", () => {
  const lines = [
    { top: 0, bottom: 20 },
    { top: 20, bottom: 40 },
    // The desk between two pages: a gap no line covers.
    { top: 100, bottom: 120 },
  ];

  test("takes the line the point is on", () => {
    expect(lineAt(lines, 10)).toBe(0);
    expect(lineAt(lines, 30)).toBe(1);
    expect(lineAt(lines, 110)).toBe(2);
  });

  test("from a gap, takes the line after it", () => {
    expect(lineAt(lines, 70)).toBe(2);
  });

  test("past the last line, the last; above the first, the first", () => {
    expect(lineAt(lines, 500)).toBe(2);
    expect(lineAt(lines, -50)).toBe(0);
  });

  test("no lines, no line", () => {
    expect(lineAt([], 10)).toBe(-1);
  });
});

describe("fractionAlong", () => {
  test("how far along a box a point stands", () => {
    expect(fractionAlong(100, 20, 105)).toBe(0.25);
  });

  test("clamped to the box, so a point in a gap holds the line's edge", () => {
    expect(fractionAlong(100, 20, 60)).toBe(0);
    expect(fractionAlong(100, 20, 300)).toBe(1);
  });

  test("an empty box is held at its top", () => {
    expect(fractionAlong(100, 0, 150)).toBe(0);
  });
});
