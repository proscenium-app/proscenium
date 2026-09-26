// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { fillSlot, headingNumber, slotValues, toRoman, type PagePosition } from "./furniture";

describe("headingNumber (docs/app/formatting/formats-and-layout.md#FMT-141)", () => {
  it.each([
    ["ACT ONE", 1],
    ["Act Two", 2],
    ["ACT II", 2],
    ["Act 3", 3],
    ["ACT IV: THE RECKONING", 4],
    ["Act Twenty-One", 21],
  ])("reads the act in %p", (text, n) => {
    expect(headingNumber(text, "act")).toEqual({ says: true, number: n });
  });

  it.each([
    ["SCENE 1", 1],
    ["Scene Three", 3],
    ["SCENE 3: THE KITCHEN", 3],
    ["Scene 12B", 12],
    ["ACT ONE, SCENE 2", 2],
    ["Scene No. 5", 5],
    ["SCENE viii", 8],
  ])("reads the scene in %p", (text, n) => {
    expect(headingNumber(text, "scene")).toEqual({ says: true, number: n });
  });

  it("knows a heading that names the scene without numbering it", () => {
    expect(headingNumber("SCENE TBD - THE DORM", "scene")).toEqual({ says: true, number: null });
    expect(headingNumber("SCENE - RETREAT", "scene")).toEqual({ says: true, number: null });
    expect(headingNumber("SCENE", "scene")).toEqual({ says: true, number: null });
  });

  it("knows a heading that does not name one at all", () => {
    expect(headingNumber("PROLOGUE", "scene")).toEqual({ says: false, number: null });
    expect(headingNumber("THE SCENERY FALLS", "scene")).toEqual({ says: false, number: null });
    expect(headingNumber("ACTION", "act")).toEqual({ says: false, number: null });
  });

  it("does not read a word that happens to be Roman numerals as a number", () => {
    expect(headingNumber("SCENE MIX", "scene").number).toBeNull();
    expect(headingNumber("SCENE CIVIL WAR", "scene").number).toBeNull();
  });
});

describe("toRoman", () => {
  it("writes the numerals a play needs", () => {
    expect([1, 2, 3, 4, 5, 9, 14, 40].map(toRoman)).toEqual([
      "I",
      "II",
      "III",
      "IV",
      "V",
      "IX",
      "XIV",
      "XL",
    ]);
  });
});

const at = (actNumber: number | null, sceneNumber: number | null): PagePosition => ({
  act: actNumber ? `ACT ${actNumber}` : "",
  scene: sceneNumber ? `SCENE ${sceneNumber}` : "",
  actNumber,
  sceneNumber,
});

describe("fillSlot (docs/app/formatting/formats-and-layout.md#FMT-142)", () => {
  const roman = "{actRoman}-{sceneNumber}-{page}";

  it("prints act, scene and page", () => {
    expect(fillSlot(roman, slotValues({ pageNumber: 67, at: at(2, 3) }))).toBe("II-3-67");
    expect(
      fillSlot("{actNumber}-{sceneNumber}-{page}", slotValues({ pageNumber: 67, at: at(2, 3) })),
    ).toBe("2-3-67");
  });

  it("drops the act from a one-act, and the scene from a play with none", () => {
    expect(fillSlot(roman, slotValues({ pageNumber: 67, at: at(null, 3) }))).toBe("3-67");
    expect(fillSlot(roman, slotValues({ pageNumber: 67, at: at(2, null) }))).toBe("II-67");
    expect(fillSlot(roman, slotValues({ pageNumber: 67, at: at(null, null) }))).toBe("67");
  });

  it("drops a trailing number's separator too", () => {
    expect(
      fillSlot("{page} / {sceneNumber}", slotValues({ pageNumber: 4, at: at(null, null) })),
    ).toBe("4");
  });

  it("leaves text that is not a separator alone", () => {
    expect(fillSlot("Scene {sceneNumber}", slotValues({ pageNumber: 4, at: at(1, null) }))).toBe(
      "Scene ",
    );
    expect(
      fillSlot(
        "{title} — {author}",
        slotValues({ pageNumber: 4, at: at(1, 1), title: "Tideline" }),
      ),
    ).toBe("Tideline — ");
  });

  it("prints the draft date on one line", () => {
    expect(
      fillSlot(
        "{draftDate}",
        slotValues({ pageNumber: 1, at: at(null, null), draftDate: "Draft 3\nSeptember 23, 2026" }),
      ),
    ).toBe("Draft 3 September 23, 2026");
  });
});
