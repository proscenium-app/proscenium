// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { buildsOn, builtOn, rememberFailed } from "./material-buffer";

describe("buildsOn", () => {
  test("words written on the version on disk build on it", () => {
    expect(buildsOn("B0", "B0", new Map())).toBe(true);
  });

  test("words written on another version do not", () => {
    expect(buildsOn("B0", "X", new Map())).toBe(false);
  });

  test("a save the disk refused counts as what it was built on", () => {
    const failed = new Map<string, string>();
    rememberFailed(failed, "F1", "B0");
    expect(buildsOn("F1", "B0", failed)).toBe(true);
  });

  test("through a chain of refused saves, back to the disk", () => {
    const failed = new Map<string, string>();
    rememberFailed(failed, "F1", "B0");
    rememberFailed(failed, "F2", "F1");
    expect(buildsOn("F2", "B0", failed)).toBe(true);
  });

  test("a refused save built on a version that was replaced does not", () => {
    const failed = new Map<string, string>();
    rememberFailed(failed, "F1", "B0");
    expect(buildsOn("F1", "IPAD", failed)).toBe(false);
  });

  test("stops at the disk even when the chain goes on", () => {
    const failed = new Map<string, string>();
    rememberFailed(failed, "F2", "F1");
    rememberFailed(failed, "F1", "B0");
    // F1 later landed: it is what the disk holds now.
    expect(builtOn("F2", "F1", failed)).toBe("F1");
    expect(buildsOn("F2", "F1", failed)).toBe(true);
  });

  test("a loop of refusals ends", () => {
    const failed = new Map<string, string>();
    rememberFailed(failed, "A", "B");
    rememberFailed(failed, "B", "A");
    expect(buildsOn("A", "C", failed)).toBe(false);
  });

  test("builtOn gives the version at the end of the chain", () => {
    const failed = new Map<string, string>();
    rememberFailed(failed, "F2", "F1");
    rememberFailed(failed, "F1", "B0");
    expect(builtOn("F2", "B0'", failed)).toBe("B0");
  });
});

describe("rememberFailed", () => {
  test("a save built on itself is not a refusal worth remembering", () => {
    const failed = new Map<string, string>();
    rememberFailed(failed, "A", "A");
    expect(failed.size).toBe(0);
  });

  test("keeps the newest sixteen", () => {
    const failed = new Map<string, string>();
    for (let i = 0; i < 20; i++) rememberFailed(failed, `S${i}`, `S${i - 1}`);
    expect(failed.size).toBe(16);
    expect(failed.has("S0")).toBe(false);
    expect(failed.get("S19")).toBe("S18");
  });

  test("the same save refused again moves to the newest", () => {
    const failed = new Map<string, string>();
    rememberFailed(failed, "A", "B0");
    rememberFailed(failed, "C", "B0");
    rememberFailed(failed, "A", "X");
    expect([...failed.keys()]).toEqual(["C", "A"]);
    expect(failed.get("A")).toBe("X");
  });
});
