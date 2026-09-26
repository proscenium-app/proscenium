// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { NOTABLE_GAP, presenceGrid } from "./presence";
import type { SceneAppearance } from "./appearances";

/** Five scenes across two acts. */
const SCENES = [
  { ordinal: 0, label: "SCENE 1", act: "ACT ONE" },
  { ordinal: 1, label: "SCENE 2", act: "ACT ONE" },
  { ordinal: 2, label: "SCENE 1", act: "ACT TWO" },
  { ordinal: 3, label: "SCENE 2", act: "ACT TWO" },
  { ordinal: 4, label: "SCENE 3", act: "ACT TWO" },
];

function appearances(spec: Record<string, number[]>): Map<string, SceneAppearance[]> {
  return new Map(
    Object.entries(spec).map(([name, ords]) => [
      name,
      ords.map((ordinal) => ({ ordinal, label: `Sc ${ordinal + 1}` })),
    ]),
  );
}

describe("presence grid", () => {
  it("marks the scenes each character speaks in", () => {
    const grid = presenceGrid(
      ["MARA", "JONAH"],
      appearances({ MARA: [0, 1, 4], JONAH: [1, 2] }),
      SCENES,
    );
    expect([...grid.rows[0].scenes].sort()).toEqual([0, 1, 4]);
    expect([...grid.rows[1].scenes].sort()).toEqual([1, 2]);
    expect(grid.rows[0].count).toBe(3);
  });

  it("matches names case-insensitively and keeps the writer's order", () => {
    const grid = presenceGrid(["Mara", "jonah"], appearances({ MARA: [0], JONAH: [1] }), SCENES);
    expect(grid.rows.map((r) => r.name)).toEqual(["Mara", "jonah"]);
    expect(grid.rows[0].count).toBe(1);
    expect(grid.rows[1].count).toBe(1);
  });

  it("counts who is on stage in each scene and finds the fullest", () => {
    const grid = presenceGrid(
      ["MARA", "JONAH", "VOICE"],
      appearances({ MARA: [0, 2], JONAH: [2], VOICE: [2] }),
      SCENES,
    );
    expect(grid.scenes.map((s) => s.onStage)).toEqual([1, 0, 3, 0, 0]);
    expect(grid.fullestScene).toBe(2);
  });

  /** The point of the whole grid. */
  it("finds the stretch in the middle where a character vanishes", () => {
    const grid = presenceGrid(["JONAH"], appearances({ JONAH: [0, 4] }), SCENES);
    // Absent from scenes 1, 2 and 3 — three scenes between his first and last.
    expect(grid.rows[0].longestGap).toBe(3);
    expect(grid.rows[0].longestGap).toBeGreaterThan(NOTABLE_GAP);
  });

  it("does not call leaving the play a gap", () => {
    // Speaks in the first two scenes and is gone: that is an exit, not a hole.
    const grid = presenceGrid(["VOICE"], appearances({ VOICE: [0, 1] }), SCENES);
    expect(grid.rows[0].longestGap).toBe(0);
    // Same for a late entrance.
    const late = presenceGrid(["LATE"], appearances({ LATE: [3, 4] }), SCENES);
    expect(late.rows[0].longestGap).toBe(0);
  });

  it("takes the longest gap, not the first", () => {
    const grid = presenceGrid(["MARA"], appearances({ MARA: [0, 1, 4] }), SCENES);
    // Off in 2 and 3 → 2.
    expect(grid.rows[0].longestGap).toBe(2);
  });

  it("handles a character on the list who never speaks", () => {
    const grid = presenceGrid(["GHOST"], appearances({}), SCENES);
    expect(grid.rows[0].count).toBe(0);
    expect(grid.rows[0].first).toBe(-1);
    expect(grid.rows[0].longestGap).toBe(0);
    expect(grid.fullestScene).toBe(-1);
  });

  it("handles a play with no scenes at all", () => {
    const grid = presenceGrid(["MARA"], appearances({ MARA: [0] }), []);
    expect(grid.scenes).toEqual([]);
    expect(grid.rows[0].count).toBe(1);
    expect(grid.fullestScene).toBe(-1);
  });
});
