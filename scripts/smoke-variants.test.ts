// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { ACTS, actRunsIn } from "./smoke-checks.mjs";
import {
  VARIANTS,
  variantNamed,
  variantNames,
  variantOfFile,
  variantsFrom,
} from "./smoke-variants.mjs";

test("every variant names real acts that run in the real Windows app, and changes something", () => {
  const names = new Set(VARIANTS.map((v) => v.name));
  expect(names.size).toBe(VARIANTS.length);
  for (const v of VARIANTS) {
    expect(v.name).toMatch(/^[a-z0-9-]+$/);
    expect(v.what).toBeTruthy();
    expect(v.launch || v.emulate).toBeTruthy();
    expect(v.acts.length).toBeGreaterThan(0);
    for (const a of v.acts) {
      const act = ACTS.find((x) => x.name === a);
      expect(act).toBeTruthy();
      expect(actRunsIn(act, "webview2")).toBe(true);
    }
  }
});

test("--variants takes all, or names", () => {
  expect(variantsFrom(undefined)).toEqual([]);
  expect(variantsFrom("all")).toEqual(VARIANTS);
  expect(variantsFrom("contrast, de").map((v) => v.name)).toEqual(["contrast", "de"]);
  expect(() => variantNamed("klingon")).toThrow("no variant");
});

test("a variant's tree files come first, and are known by their names", () => {
  expect(variantNames("plays", "de", "light", ["plays.yml"])).toEqual([
    "plays.de.yml",
    "plays.yml",
  ]);
  expect(variantNames("plays", "de", "dark", ["plays.dark.yml", "plays.yml"])).toEqual([
    "plays.de.dark.yml",
    "plays.de.yml",
    "plays.dark.yml",
    "plays.yml",
  ]);
  expect(variantOfFile("plays.de.yml")).toBe("de");
  expect(variantOfFile("plays.scale-150.dark.yml")).toBe("scale-150");
  expect(variantOfFile("plays.dark.yml")).toBe(null);
  expect(variantOfFile("plays.yml")).toBe(null);
});
