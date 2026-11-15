// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import type { FormatSpec } from "../format";
import { ZOOM_MAX, ZOOM_MIN, fitLevel, zoomFloor } from "./use-zoom";

/** US Letter at 96px to the inch: the sheet at 100%. */
const LETTER = { width: 816, height: 1056 };

/** Where a page drawn at `level` ends, measured down from the top of its pane's content. */
const pageBottom = (level: number, above: number) => above + level * LETTER.height;

describe("fit levels", () => {
  it("fits the width with a gutter either side", () => {
    const level = fitLevel("fit-width", { width: 1034, height: 692, above: 106, below: 0 }, LETTER);
    expect(level).toBe(1.2);
    expect(level * LETTER.width).toBeLessThanOrEqual(1034);
  });

  it("keeps a sheet's whole page below its header and format bar", () => {
    // A document at the script pane's old level: 106px of header, format bar
    // and desk above the sheet ran its page 48px past a 692px pane.
    const old = Math.round(((692 - 56) / LETTER.height) * 100) / 100;
    expect(pageBottom(old, 106)).toBeGreaterThan(692 + 40);

    const level = fitLevel("fit-page", { width: 1034, height: 692, above: 106, below: 0 }, LETTER);
    expect(pageBottom(level, 106)).toBeLessThanOrEqual(692);
    // A fit, not merely small: the gutter, give or take a rounded percent.
    expect(692 - pageBottom(level, 106)).toBeLessThan(28 + LETTER.height / 100);
  });

  it("keeps the script's page clear of the strip pinned under it", () => {
    const room = { width: 1034, height: 722, above: 99, below: 14 };
    const level = fitLevel("fit-page", room, LETTER);
    expect(pageBottom(level, room.above)).toBeLessThanOrEqual(722 - 14);
  });

  it("solves each surface for its own chrome, so the same pane can give two levels", () => {
    const pane = { width: 1034, height: 692, below: 0 };
    const page = fitLevel("fit-page", { ...pane, above: 106 }, LETTER);
    const source = fitLevel("fit-page", { ...pane, above: 64 }, LETTER);
    expect(source).toBeGreaterThan(page);
    // Width does not care what is above the sheet.
    expect(fitLevel("fit-width", { ...pane, above: 106 }, LETTER)).toBe(
      fitLevel("fit-width", { ...pane, above: 64 }, LETTER),
    );
  });

  it("keeps a gutter above a sheet with nothing over it", () => {
    const level = fitLevel("fit-page", { width: 2000, height: 800, above: 0, below: 0 }, LETTER);
    expect(level).toBe(
      fitLevel("fit-page", { width: 2000, height: 800, above: 28, below: 0 }, LETTER),
    );
  });

  it("lets the width decide in a pane narrower than the page is tall", () => {
    const room = { width: 500, height: 1400, above: 106, below: 0 };
    expect(fitLevel("fit-page", room, LETTER)).toBe(fitLevel("fit-width", room, LETTER));
  });

  it("stays inside the zoom range", () => {
    expect(fitLevel("fit-page", { width: 80, height: 120, above: 106, below: 0 }, LETTER)).toBe(
      ZOOM_MIN,
    );
    expect(fitLevel("fit-width", { width: 9000, height: 9000, above: 0, below: 0 }, LETTER)).toBe(
      ZOOM_MAX,
    );
  });
});

describe("the zoom's floor (docs/app/writing/editor-ux.md#EDIT-195)", () => {
  const type = (size: number) => ({ type: { size } }) as FormatSpec;

  it("keeps 12-point type at WebKit's 9 pixels or more", () => {
    const floor = zoomFloor(type(12));
    expect(floor).toBe(0.57);
    expect(((12 * 96) / 72) * floor).toBeGreaterThanOrEqual(9);
  });

  it("follows the format's type: smaller type, a higher floor", () => {
    expect(zoomFloor(type(10))).toBe(0.68);
    expect(zoomFloor(type(18))).toBe(0.38);
  });

  it("stays between the zoom's own least and 100%", () => {
    expect(zoomFloor(type(72))).toBe(ZOOM_MIN);
    expect(zoomFloor(type(4))).toBe(1);
    expect(zoomFloor(type(0))).toBe(ZOOM_MIN);
  });
});
