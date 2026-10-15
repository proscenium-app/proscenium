// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { CARET_WIDTH, caretBox, endOfUpperLine, onTwoLines, type Stand } from "./caret";

/** Three lines of a paragraph, 18 tall on a 25 pitch. */
const line = (n: number, left: number): Stand => ({ left, top: n * 25, bottom: n * 25 + 18 });

describe("which side of a wrap the caret is drawn on", () => {
  // The same place in the document: the end of line 1, or the start of line 2.
  const up = line(1, 540);
  const down = line(2, 0);

  test("two stands on one line are not a wrap", () => {
    expect(onTwoLines(line(1, 100), line(1, 100.4))).toBe(false);
    expect(onTwoLines(up, down)).toBe(true);
  });

  test("with nothing to say otherwise it is the start of the lower line", () => {
    expect(endOfUpperLine(up, down, null)).toBe(false);
  });

  test("a key to the end of the line leaves it at that end", () => {
    expect(endOfUpperLine(up, down, { kind: "line-end" })).toBe(true);
  });

  test("a click is on the line it was made on", () => {
    expect(endOfUpperLine(up, down, { kind: "point", y: 30 })).toBe(true);
    expect(endOfUpperLine(up, down, { kind: "point", y: 55 })).toBe(false);
  });

  test("an arrow down moves one line: from line 0 to the end of line 1", () => {
    const hint = { kind: "vertical", direction: 1, from: line(0, 560) } as const;
    expect(endOfUpperLine(up, down, hint)).toBe(true);
  });

  test("an arrow down from line 1 itself goes to the start of line 2", () => {
    const hint = { kind: "vertical", direction: 1, from: line(1, 0) } as const;
    expect(endOfUpperLine(up, down, hint)).toBe(false);
  });

  test("an arrow up from line 2 goes to the end of line 1", () => {
    const hint = { kind: "vertical", direction: -1, from: line(2, 560) } as const;
    expect(endOfUpperLine(up, down, hint)).toBe(true);
  });

  test("an arrow up from line 3 goes to the start of line 2", () => {
    const hint = { kind: "vertical", direction: -1, from: line(3, 0) } as const;
    expect(endOfUpperLine(up, down, hint)).toBe(false);
  });
});

describe("the caret's box", () => {
  const stand: Stand = { left: 623.39, top: 431.27, bottom: 449.27 };

  test("is centred on the boundary and snapped to the screen's pixels", () => {
    const box = caretBox(stand, { left: 0, top: 0, scale: 1 }, 1, 2);
    expect(box.width).toBe(CARET_WIDTH);
    expect(box.left).toBe(622.5);
    expect(box.top).toBe(431.5);
    expect(box.height).toBe(18);
  });

  test("is one height wherever the line falls between pixels", () => {
    const frame = { left: 0, top: 0, scale: 1 };
    const heights = [0, 0.2, 0.5, 0.7].map(
      (d) => caretBox({ left: 10, top: 100 + d, bottom: 117.66 + d }, frame, 1, 1).height,
    );
    expect(new Set(heights).size).toBe(1);
  });

  test("on a zoomed page it is placed in the page's px and stays two wide on screen", () => {
    // A WebKit that reports a zoomed box as drawn: the layer's 100px read 125.
    const box = caretBox(stand, { left: 23.39, top: 31.27, scale: 1.25 }, 1.25, 2);
    expect(box.width * 1.25).toBe(CARET_WIDTH);
    expect(box.left * 1.25 + 23.39).toBeCloseTo(622.5, 5);
    expect(box.height * 1.25).toBe(18);
  });
});
