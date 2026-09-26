// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** The card beside its target, never over it (docs/app/preferences-and-help/tutorials.md#TUT-D103). */
import { describe, expect, test } from "bun:test";
import { overlaps, placeCard, scrollFor, type Box } from "./place";

const window = { left: 0, top: 0, width: 1280, height: 800 };
const card = { width: 300, height: 120 };
const at = (p: { left: number; top: number }): Box => ({ ...p, ...card });
const inside = (b: Box) =>
  b.left >= 0 && b.top >= 0 && b.left + b.width <= 1280 && b.top + b.height <= 800;

describe("placing the guide's card", () => {
  test("below a target with room, arrow aimed at its centre", () => {
    const target = { left: 400, top: 100, width: 80, height: 20 };
    const p = placeCard(target, card, window);
    expect(p.side).toBe("below");
    expect(p.top).toBe(100 + 20 + 12);
    expect(p.left + (p.arrow ?? 0)).toBe(440);
    expect(overlaps(at(p), target)).toBe(false);
  });
  test("above a target at the bottom of the window (the save indicator)", () => {
    const target = { left: 1100, top: 780, width: 90, height: 14 };
    const p = placeCard(target, card, window);
    expect(p.side).toBe("above");
    expect(inside(at(p))).toBe(true);
    expect(overlaps(at(p), target)).toBe(false);
  });
  test("kept inside the window at an edge, with the arrow still on the target", () => {
    const target = { left: 1250, top: 40, width: 20, height: 20 };
    const p = placeCard(target, card, window);
    expect(inside(at(p))).toBe(true);
    expect(p.left + (p.arrow ?? 0)).toBeGreaterThan(1200);
    expect(p.arrow).toBeLessThanOrEqual(card.width - 14);
  });
  test("beside an open menu, never over the menu the target row sits in", () => {
    const menu = { left: 180, top: 50, width: 160, height: 260 };
    const row = { left: 184, top: 120, width: 152, height: 24 };
    const p = placeCard(row, card, window, ["right", "left", "below", "above"], [menu]);
    expect(p.side).toBe("right");
    expect(p.left).toBeGreaterThanOrEqual(340);
    expect(overlaps(at(p), menu)).toBe(false);
  });
  test("a line: the whole line stays clear, the arrow points where the words go", () => {
    const line = { left: 280, top: 300, width: 420, height: 18 };
    const caret = { left: 290, top: 300, width: 2, height: 18 };
    const p = placeCard(caret, card, window, ["below", "above", "right", "left"], [line]);
    expect(p.side).toBe("below");
    expect(overlaps(at(p), line)).toBe(false);
    expect(p.left + (p.arrow ?? 0)).toBeCloseTo(291, 0);
  });
  test("with nothing to point at, it waits near the bottom middle", () => {
    const p = placeCard(null, card, window);
    expect(p.side).toBeNull();
    expect(p.arrow).toBeNull();
    expect(p.left).toBe((1280 - 300) / 2);
    expect(inside(at(p))).toBe(true);
  });
  test("in a window too small for any side, it stays on screen on the roomiest side", () => {
    const tiny = { left: 0, top: 0, width: 360, height: 200 };
    const p = placeCard({ left: 100, top: 60, width: 100, height: 80 }, card, tiny);
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.left + card.width).toBeLessThanOrEqual(360);
  });
  test("any target anywhere on a 1280×800 window leaves the target uncovered", () => {
    for (let x = 0; x < 1280; x += 97)
      for (let y = 0; y < 800; y += 61) {
        const target = { left: x, top: y, width: 40, height: 20 };
        const p = placeCard(target, card, window);
        expect(overlaps(at(p), target)).toBe(false);
        expect(inside(at(p))).toBe(true);
      }
  });
});

describe("bringing a target into view as the guide first points at it", () => {
  // The app's own 1100×760 window with a new note open, as measured: the pane
  // runs 82–734, and its header and format bar cover its top 90 px, so what is
  // scrolled in comes to rest from 172. The page is 655 px tall at 62 %.
  const view = { top: 82 + 90, bottom: 734 };
  const page = (top: number): Box => ({ left: 300, top, width: 510, height: 655 });
  test("a page taller than the pane, its top showing under the bars, stays where it is", () => {
    expect(scrollFor(page(188), view)).toBeNull();
  });
  test("a page whose top is behind the format bar or above the pane is brought in by its top", () => {
    expect(scrollFor(page(100), view)).toBe("start");
    expect(scrollFor(page(-300), view)).toBe("start");
  });
  test("a page below the pane is brought in by its top", () => {
    expect(scrollFor(page(760), view)).toBe("start");
  });
  test("a control that fits comes in by the nearest edge when any of it is hidden", () => {
    expect(scrollFor({ left: 300, top: 720, width: 120, height: 28 }, view)).toBe("nearest");
    expect(scrollFor({ left: 300, top: 150, width: 120, height: 28 }, view)).toBe("nearest");
    expect(scrollFor({ left: 300, top: 900, width: 120, height: 28 }, view)).toBe("nearest");
  });
  test("a control in full view stays where it is", () => {
    expect(scrollFor({ left: 300, top: 400, width: 120, height: 28 }, view)).toBeNull();
    expect(scrollFor({ left: 300, top: 172, width: 120, height: 562 }, view)).toBeNull();
  });
});
