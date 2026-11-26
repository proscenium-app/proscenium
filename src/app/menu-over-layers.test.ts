// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { menuActsOverLayer } from "./menu-over-layers";

const quiet = { shortcutsShown: false, designerUp: false };

describe("the menu's items over a layer", () => {
  test("Save reaches the format designer over its own sheet, and waits behind any other", () => {
    expect(menuActsOverLayer("save", { ...quiet, designerUp: true })).toBe(true);
    expect(menuActsOverLayer("save", quiet)).toBe(false);
  });

  test("⌘/ acts only to close the shortcuts it showed", () => {
    expect(menuActsOverLayer("shortcuts", { ...quiet, shortcutsShown: true })).toBe(true);
    expect(menuActsOverLayer("shortcuts", quiet)).toBe(false);
  });

  test("Help's diagnostics and its feedback sheet act above Settings", () => {
    expect(menuActsOverLayer("copy-diagnostics", quiet)).toBe(true);
    expect(menuActsOverLayer("report-problem", quiet)).toBe(true);
  });

  test("every other item waits for the layer, the designer up or not", () => {
    for (const id of ["mark-strong", "el-dialogue", "find", "all-plays", "zoom-in", "next-area"]) {
      expect(menuActsOverLayer(id, quiet)).toBe(false);
      expect(menuActsOverLayer(id, { shortcutsShown: true, designerUp: true })).toBe(false);
    }
  });
});
