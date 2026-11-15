// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the place marker stands in its scene's segment
 * (docs/app/preferences-and-help/settings.md#SET-45). The hook measures the
 * page; this is the arithmetic it hands the measurements to, which is where a
 * marker could leave its segment.
 */
import { describe, expect, it } from "bun:test";
import { throughScene } from "./caret-scene";

describe("throughScene", () => {
  it("is the share of the scene above the reading point", () => {
    expect(throughScene(100, 100, 500)).toBe(0);
    expect(throughScene(200, 100, 500)).toBe(0.25);
    expect(throughScene(300, 100, 500)).toBe(0.5);
    expect(throughScene(500, 100, 500)).toBe(1);
  });

  it("works where the scene starts above the screen, as the tops then read", () => {
    expect(throughScene(240, -1760, 2240)).toBe(0.5);
  });

  it("never leaves the segment", () => {
    // Above the heading: an act title or the front matter before scene one.
    expect(throughScene(40, 100, 500)).toBe(0);
    // Past the end: the strip has not yet lit the next scene.
    expect(throughScene(900, 100, 500)).toBe(1);
  });

  it("puts a scene with no height yet at its start", () => {
    expect(throughScene(300, 100, 100)).toBe(0);
    expect(throughScene(300, 500, 100)).toBe(0);
    expect(throughScene(300, Number.NaN, 100)).toBe(0);
  });
});
