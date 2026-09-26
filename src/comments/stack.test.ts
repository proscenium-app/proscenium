// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { sameSpots, stackCards, type CardBox } from "./stack";

const box = (want: number, height = 60): CardBox => ({ want, height });

/** No card may sit inside the one before it, in any arrangement. */
function noOverlap(cards: CardBox[], tops: number[], gap: number): boolean {
  for (let i = 1; i < tops.length; i++) {
    if (tops[i] < tops[i - 1] + cards[i - 1].height + gap - 0.001) return false;
  }
  return true;
}

describe("stackCards", () => {
  it("leaves cards where they want to be when they don't collide", () => {
    const cards = [box(0), box(200), box(400)];
    expect(stackCards(cards, { gap: 8 })).toEqual([0, 200, 400]);
  });

  it("cascades colliding cards downward, in document order", () => {
    const cards = [box(100), box(120), box(130)];
    const tops = stackCards(cards, { gap: 8 });
    expect(tops).toEqual([100, 168, 236]);
    expect(noOverlap(cards, tops, 8)).toBe(true);
  });

  it("gives the active card its anchor exactly and moves its neighbours", () => {
    const cards = [box(300), box(320), box(330)];
    const tops = stackCards(cards, { gap: 8, active: 2 });
    expect(tops[2]).toBe(330); // the focused card is level with its line
    expect(tops[1]).toBe(262); // pushed up out of its way
    expect(tops[0]).toBe(194);
    expect(noOverlap(cards, tops, 8)).toBe(true);
  });

  it("keeps every card below the ceiling, even when that costs the anchor", () => {
    const cards = [box(10), box(20), box(30)];
    const tops = stackCards(cards, { gap: 8, active: 2, minTop: 0 });
    expect(tops[0]).toBe(0);
    expect(Math.min(...tops)).toBeGreaterThanOrEqual(0);
    expect(noOverlap(cards, tops, 8)).toBe(true);
  });

  it("never reorders: a later comment never rises above an earlier one", () => {
    const cards = [box(500, 40), box(60, 90), box(80, 30), box(700, 50)];
    for (const active of [null, 0, 1, 2, 3]) {
      const tops = stackCards(cards, { gap: 10, active, minTop: 0 });
      expect(noOverlap(cards, tops, 10)).toBe(true);
    }
  });

  it("handles the empty column", () => {
    expect(stackCards([])).toEqual([]);
  });
});

describe("sameSpots", () => {
  it("is true only when the same comments sit in the same places", () => {
    expect(sameSpots(new Map([[1, 10]]), new Map([[1, 10]]))).toBe(true);
    expect(sameSpots(new Map([[1, 10]]), new Map([[1, 10.2]]))).toBe(true); // sub-pixel
    expect(sameSpots(new Map([[1, 10]]), new Map([[1, 40]]))).toBe(false);
    expect(sameSpots(new Map([[1, 10]]), new Map())).toBe(false);
  });

  it("notices when every comment MOVED but the count did not", () => {
    // The regression: type one character above the first comment and every
    // position shifts. Sizes match and no key survives — which a `?? NaN`
    // comparison called "unchanged", and the whole margin went blank.
    const before = new Map([
      [209, 500],
      [326, 620],
    ]);
    const after = new Map([
      [221, 500],
      [338, 620],
    ]);
    expect(sameSpots(before, after)).toBe(false);
  });
});
