// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, test } from "bun:test";
import { closeAt, dragRegion, setSystemTraits } from "./system-traits";

const MAC = { menuBar: true, systemSpelling: true, windowDrag: true, closeAt: "left" as const };

afterEach(() => setSystemTraits(MAC));

describe("a top bar is the window's handle only where it moves the window", () => {
  test("a Mac's and a PC's bars ask the window to drag, deep or by their own pixels", () => {
    setSystemTraits(MAC);
    expect(dragRegion(true)).toEqual({ "data-tauri-drag-region": "deep" });
    expect(dragRegion()).toEqual({ "data-tauri-drag-region": "" });
  });

  test("an iPad's bars carry no drag region, so a tap on one asks nothing of a window", () => {
    // Tauri's drag script asks the window plugin to start dragging on a press
    // over a drag region, and an iPad's shell has none: the tap was an error.
    setSystemTraits({ menuBar: false, systemSpelling: false, windowDrag: false, closeAt: "left" });
    expect(dragRegion(true)).toEqual({});
    expect(dragRegion()).toEqual({});
  });
});

describe("a window's close control is where the system puts it", () => {
  test("a Mac's and an iPad's at the top left, a PC's at the top right", () => {
    setSystemTraits(MAC);
    expect(closeAt()).toBe("left");
    setSystemTraits({ ...MAC, closeAt: "right" });
    expect(closeAt()).toBe("right");
  });
});
