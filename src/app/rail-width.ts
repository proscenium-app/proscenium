// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How wide the binder and the inspector are drawn
 * (docs/app/organizing/workspace-model.md#WORK-97).
 *
 * Each rail has a width it starts at and a range it can be dragged within. The
 * range is narrow on purpose: wide enough that a long scene title or a long
 * comment has room, never so wide that the page beside it is squeezed into a
 * ribbon, and never so narrow that the rail's own controls overlap. The width
 * is a chrome preference of this device, kept beside whether the rail is open.
 */

export type Rail = "binder" | "inspector";

export interface RailLimits {
  /** Where it starts, and where a double-click puts it back. */
  initial: number;
  min: number;
  max: number;
}

export const RAIL_LIMITS: Record<Rail, RailLimits> = {
  binder: { initial: 246, min: 200, max: 400 },
  inspector: { initial: 292, min: 260, max: 440 },
};

/** One arrow press; Shift moves four of them. */
export const RAIL_STEP = 8;
export const RAIL_STEP_BIG = 32;

const KEY: Record<Rail, string> = {
  binder: "proscenium:binderWidth",
  inspector: "proscenium:inspectorWidth",
};

/** A width held within its rail's range, in whole pixels. */
export function clampRail(rail: Rail, px: number): number {
  const { min, max, initial } = RAIL_LIMITS[rail];
  if (!Number.isFinite(px)) return initial;
  return Math.round(Math.min(max, Math.max(min, px)));
}

/** The width kept for a rail, or where it starts when none is kept. */
export function readRailWidth(rail: Rail, stored: string | null): number {
  if (stored === null || stored.trim() === "") return RAIL_LIMITS[rail].initial;
  return clampRail(rail, Number(stored));
}

export function loadRailWidth(rail: Rail): number {
  try {
    return readRailWidth(rail, localStorage.getItem(KEY[rail]));
  } catch {
    return RAIL_LIMITS[rail].initial;
  }
}

export function saveRailWidth(rail: Rail, px: number): void {
  try {
    localStorage.setItem(KEY[rail], String(clampRail(rail, px)));
  } catch {
    /* chrome preference only */
  }
}

/**
 * The width a key asks for, or null for a key that is not the handle's. The
 * binder's handle is on its right edge and the inspector's on its left, so →
 * widens the binder and narrows the inspector: the arrow moves the edge.
 */
export function railWidthForKey(
  rail: Rail,
  width: number,
  key: string,
  shift: boolean,
): number | null {
  const step = shift ? RAIL_STEP_BIG : RAIL_STEP;
  const grows = rail === "binder" ? 1 : -1;
  switch (key) {
    case "ArrowRight":
      return clampRail(rail, width + step * grows);
    case "ArrowLeft":
      return clampRail(rail, width - step * grows);
    case "Home":
      return RAIL_LIMITS[rail].min;
    case "End":
      return RAIL_LIMITS[rail].max;
    default:
      return null;
  }
}

/**
 * The width a drag has reached: the width at the press, moved by how far the
 * pointer has travelled since, toward the page or away from it.
 */
export function railWidthForDrag(rail: Rail, startWidth: number, dx: number): number {
  return clampRail(rail, startWidth + (rail === "binder" ? dx : -dx));
}
