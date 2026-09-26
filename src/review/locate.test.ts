// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { touchedScenes } from "./locate";

const SCRIPT = [
  "Title: A Play",
  "",
  "# ACT ONE",
  "",
  "## Scene 1",
  "",
  "MARA",
  "One.",
  "",
  "## Scene 2",
  "",
  "JONAH",
  "Two.",
  "",
  "# ACT TWO",
  "",
  "## Scene 1",
  "",
  "MARA",
  "Three.",
].join("\n");

describe("touchedScenes", () => {
  it("locates an addition in the scene it lands in", () => {
    const after = SCRIPT.replace("Two.", "Two.\nAnd more.");
    expect([...touchedScenes(SCRIPT, after)]).toEqual([1]);
  });

  it("locates a change in the last scene", () => {
    const after = SCRIPT.replace("Three.", "Three, and again.");
    expect([...touchedScenes(SCRIPT, after)]).toEqual([2]);
  });

  it("attributes a deletion to the scene it was cut from", () => {
    // Otherwise a scene gutted by a change would carry no mark at all.
    const after = SCRIPT.replace("JONAH\nTwo.\n", "");
    expect(touchedScenes(SCRIPT, after).has(1)).toBe(true);
  });

  it("puts a title-page change on the first scene rather than nowhere", () => {
    const after = SCRIPT.replace("Title: A Play", "Title: Another Play");
    expect([...touchedScenes(SCRIPT, after)]).toEqual([0]);
  });

  it("reports nothing for an identical script", () => {
    expect(touchedScenes(SCRIPT, SCRIPT).size).toBe(0);
  });

  it("can touch several scenes at once", () => {
    const after = SCRIPT.replace("One.", "One!").replace("Three.", "Three!");
    expect([...touchedScenes(SCRIPT, after)].sort()).toEqual([0, 2]);
  });

  it("falls back to forced scene headings when the script has no ## sections", () => {
    const flat = ["Title: X", "", ".A kitchen", "", "MARA", "One.", "", ".A hallway", "", "JONAH", "Two."].join("\n");
    const after = flat.replace("Two.", "Two, later.");
    expect([...touchedScenes(flat, after)]).toEqual([1]);
  });

  it("treats a script with no structure at all as one scene", () => {
    const flat = "MARA\nOne.\n\nJONAH\nTwo.";
    expect([...touchedScenes(flat, flat.replace("Two.", "Three."))]).toEqual([0]);
  });
});
