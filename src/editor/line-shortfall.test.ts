// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { lineShortfall, remainderHeight, textRowsOf } from "./line-shortfall";

// docs/app/writing/editor-ux.md#EDIT-197
describe("what a line of the page is drawn short by", () => {
  it("is nothing where a line takes its exact pitch", () => {
    expect(lineShortfall(19.2, 192, 10)).toBe(0);
    expect(lineShortfall(21.312, 213.12, 10)).toBe(0);
  });

  it("is a layout unit's worth where an engine cuts a line to a 64th of a pixel", () => {
    // Chromium, and Playwright's build of WebKit: 19.2 is drawn 19.1875.
    expect(lineShortfall(19.2, 191.875, 10)).toBe(0.0125);
  });

  it("is the cut where an iPad draws each line a whole pixel tall", () => {
    // Apple's WebKit: iPadOS 26.5's, measured in the simulator, ten lines at
    // each level, and the Mac app's, which measured 0.2 at 100% in its self-test.
    expect(lineShortfall(19.2, 190, 10)).toBe(0.2);
    expect(lineShortfall(21.312, 210, 10)).toBe(0.312);
    expect(lineShortfall(10.944, 100, 10)).toBe(0.944);
  });

  it("is never less than nothing, and nothing where it cannot be read", () => {
    expect(lineShortfall(19.2, 200, 10)).toBe(0);
    expect(lineShortfall(Number.NaN, 190, 10)).toBe(0);
    expect(lineShortfall(19.2, 0, 10)).toBe(0);
    expect(lineShortfall(19.2, 190, 0)).toBe(0);
  });
});

describe("a page's blank remainder", () => {
  it("is its blank rows where its text is drawn at the pitch", () => {
    expect(remainderHeight(13, 0)).toBe("13lh");
    expect(remainderHeight(-2, 0)).toBe("0lh");
  });

  it("takes back what each row of text above it was drawn short by", () => {
    expect(remainderHeight(13, 41)).toBe("calc(13lh + 41 * var(--line-shortfall, 0px))");
    // A full page has no blank rows, and still its text's.
    expect(remainderHeight(0, 54)).toBe("calc(0lh + 54 * var(--line-shortfall, 0px))");
  });

  it("counts a dual pair's two halves, side by side, as one row each", () => {
    const pair = [
      { row: 10 },
      { row: 11 },
      { row: 12 },
      // The right half, from the same base row.
      { row: 10 },
      { row: 11 },
    ];
    expect(textRowsOf(pair)).toBe(3);
    expect(textRowsOf([])).toBe(0);
  });
});
