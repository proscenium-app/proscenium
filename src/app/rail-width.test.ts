// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import {
  RAIL_LIMITS,
  RAIL_STEP,
  RAIL_STEP_BIG,
  clampRail,
  railWidthForDrag,
  railWidthForKey,
  readRailWidth,
} from "./rail-width";

describe("rail widths (docs/app/organizing/workspace-model.md#WORK-97)", () => {
  test("each rail starts inside its own range", () => {
    for (const { initial, min, max } of Object.values(RAIL_LIMITS)) {
      expect(min).toBeLessThan(initial);
      expect(initial).toBeLessThan(max);
    }
  });

  test("a width is held within the range, in whole pixels", () => {
    expect(clampRail("binder", 10)).toBe(RAIL_LIMITS.binder.min);
    expect(clampRail("binder", 9999)).toBe(RAIL_LIMITS.binder.max);
    expect(clampRail("inspector", 300.6)).toBe(301);
    expect(clampRail("inspector", Number.NaN)).toBe(RAIL_LIMITS.inspector.initial);
  });

  test("a kept width is read back, and anything else starts where it starts", () => {
    expect(readRailWidth("binder", "320")).toBe(320);
    expect(readRailWidth("binder", null)).toBe(RAIL_LIMITS.binder.initial);
    expect(readRailWidth("binder", "")).toBe(RAIL_LIMITS.binder.initial);
    expect(readRailWidth("binder", "wide")).toBe(RAIL_LIMITS.binder.initial);
    expect(readRailWidth("inspector", "5000")).toBe(RAIL_LIMITS.inspector.max);
  });

  test("the arrows move the edge: → widens the binder and narrows the inspector", () => {
    expect(railWidthForKey("binder", 246, "ArrowRight", false)).toBe(246 + RAIL_STEP);
    expect(railWidthForKey("binder", 246, "ArrowLeft", true)).toBe(246 - RAIL_STEP_BIG);
    expect(railWidthForKey("inspector", 292, "ArrowRight", false)).toBe(292 - RAIL_STEP);
    expect(railWidthForKey("inspector", 292, "ArrowLeft", false)).toBe(292 + RAIL_STEP);
  });

  test("Home and End go to the limits, and the arrows stop at them", () => {
    expect(railWidthForKey("binder", 300, "Home", false)).toBe(RAIL_LIMITS.binder.min);
    expect(railWidthForKey("binder", 300, "End", false)).toBe(RAIL_LIMITS.binder.max);
    expect(railWidthForKey("binder", RAIL_LIMITS.binder.max, "ArrowRight", true)).toBe(
      RAIL_LIMITS.binder.max,
    );
    expect(railWidthForKey("binder", 300, "Enter", false)).toBeNull();
  });

  test("a drag toward the page widens either rail, within its range", () => {
    expect(railWidthForDrag("binder", 246, 40)).toBe(286);
    expect(railWidthForDrag("inspector", 292, -40)).toBe(332);
    expect(railWidthForDrag("inspector", 292, 400)).toBe(RAIL_LIMITS.inspector.min);
    expect(railWidthForDrag("binder", 246, 900)).toBe(RAIL_LIMITS.binder.max);
  });
});
