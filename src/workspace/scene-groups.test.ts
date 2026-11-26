// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { sceneGroups, type BinderScene } from "./BinderView";

const scene = (ordinal: number, act?: string): BinderScene => ({
  id: `s${ordinal}`,
  ordinal,
  label: `SCENE ${ordinal + 1}`,
  color: "none",
  pages: null,
  ...(act ? { act } : {}),
});

describe("sceneGroups (docs/app/organizing/workspace-model.md#WORK-89)", () => {
  test("a play with no acts is one run with no act", () => {
    const groups = sceneGroups([scene(0), scene(1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].act).toBeNull();
    expect(groups[0].scenes.map((s) => s.ordinal)).toEqual([0, 1]);
  });

  test("scenes fold under their acts, in script order, with each act's pages", () => {
    const groups = sceneGroups(
      [scene(0, "ACT ONE"), scene(1, "ACT ONE"), scene(2, "ACT TWO")],
      [
        { label: "ACT ONE", pages: "1–2" },
        { label: "ACT TWO", pages: "3" },
      ],
    );
    expect(groups.map((g) => [g.act?.label, g.act?.pages, g.scenes.length])).toEqual([
      ["ACT ONE", "1–2", 2],
      ["ACT TWO", "3", 1],
    ]);
  });

  test("scenes before the first act stay under the script", () => {
    const groups = sceneGroups([scene(0), scene(1, "ACT ONE")]);
    expect(groups.map((g) => g.act?.label ?? null)).toEqual([null, "ACT ONE"]);
  });

  test("two acts with one name are two rows, keyed apart", () => {
    const groups = sceneGroups([scene(0, "ACT"), scene(1, "INTERVAL"), scene(2, "ACT")]);
    expect(groups.map((g) => g.key)).toEqual(["act-0", "act-1", "act-2"]);
  });

  test("an act not yet paginated shows no pages", () => {
    expect(sceneGroups([scene(0, "ACT ONE")])[0].act?.pages).toBeNull();
  });
});
