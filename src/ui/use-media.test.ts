// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { toolbarFold } from "./use-media";

describe("the toolbar's fold", () => {
  it("never folds on a Mac, whose window is 820 points at the least and whose pointer is no finger", () => {
    for (const width of [820, 1000, 1280, 2560]) expect(toolbarFold(false, width)).toBe("wide");
  });

  it("folds on a finger in an iPad's portrait window, and not in its landscape one", () => {
    expect(toolbarFold(true, 820)).toBe("folded");
    expect(toolbarFold(true, 999)).toBe("folded");
    expect(toolbarFold(true, 1000)).toBe("wide");
    expect(toolbarFold(true, 1180)).toBe("wide");
  });

  it("is compact in a third of a Split View and a small Stage Manager window, on any pointer", () => {
    for (const finger of [true, false]) {
      expect(toolbarFold(finger, 320)).toBe("compact");
      expect(toolbarFold(finger, 600)).toBe("compact");
      expect(toolbarFold(finger, 699)).toBe("compact");
    }
    expect(toolbarFold(false, 700)).toBe("wide");
    expect(toolbarFold(true, 700)).toBe("folded");
  });
});
