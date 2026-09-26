// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Who is on stage, scene by scene — the shape of the play's company.
 *
 * One screen that answers questions a cast list can't: where each character
 * enters and leaves, which scene has everybody in it, and — the one writers
 * actually get caught by — who disappears for a stretch in the middle and needs
 * either a reason or a cut.
 *
 * Entirely derived from the script (storage rule 3): speaking is what the
 * document records, so speaking is what this counts. Pure functions, no React.
 */
import type { SceneAppearance } from "./appearances";

export interface PresenceScene {
  ordinal: number;
  /** Scene heading, or "Sc 3" when it has none. */
  label: string;
  act: string | null;
  /** How many of the listed characters speak in this scene. */
  onStage: number;
}

export interface PresenceRow {
  name: string;
  /** Scene ordinals where this character speaks. */
  scenes: Set<number>;
  /** First and last scene they speak in; -1 when they never do. */
  first: number;
  last: number;
  /**
   * The longest run of consecutive scenes with no line, BETWEEN their first and
   * last appearance. A character absent from the end of the play hasn't
   * disappeared — they've left, which is a different thing.
   */
  longestGap: number;
  /** Scenes they speak in, for the summary column. */
  count: number;
}

export interface PresenceGridData {
  scenes: PresenceScene[];
  rows: PresenceRow[];
  /** Ordinal of the fullest scene, or -1 when nobody speaks anywhere. */
  fullestScene: number;
}

/**
 * Build the grid.
 *
 * `names` is the writer's own cast order (so the grid reads like the printed
 * page); `appearances` and the scene list come from the derived data the Cast
 * surface already holds.
 */
export function presenceGrid(
  names: readonly string[],
  appearances: Map<string, SceneAppearance[]>,
  scenes: readonly { ordinal: number; label: string; act: string | null }[],
): PresenceGridData {
  const rows: PresenceRow[] = names.map((raw) => {
    const name = raw.trim();
    const key = name.toUpperCase();
    const present = new Set((appearances.get(key) ?? []).map((a) => a.ordinal));
    const ordinals = scenes.map((s) => s.ordinal).filter((o) => present.has(o));
    const first = ordinals.length ? ordinals[0] : -1;
    const last = ordinals.length ? ordinals[ordinals.length - 1] : -1;
    return {
      name,
      scenes: present,
      first,
      last,
      longestGap: longestInnerGap(scenes, present, first, last),
      count: present.size,
    };
  });

  const withCounts: PresenceScene[] = scenes.map((s) => ({
    ...s,
    onStage: rows.reduce((n, row) => n + (row.scenes.has(s.ordinal) ? 1 : 0), 0),
  }));

  let fullest = -1;
  let most = 0;
  for (const s of withCounts) {
    if (s.onStage > most) {
      most = s.onStage;
      fullest = s.ordinal;
    }
  }
  return { scenes: withCounts, rows, fullestScene: fullest };
}

function longestInnerGap(
  scenes: readonly { ordinal: number }[],
  present: ReadonlySet<number>,
  first: number,
  last: number,
): number {
  if (first < 0 || first === last) return 0;
  let longest = 0;
  let run = 0;
  for (const scene of scenes) {
    if (scene.ordinal <= first || scene.ordinal >= last) continue;
    if (present.has(scene.ordinal)) {
      run = 0;
    } else {
      run += 1;
      if (run > longest) longest = run;
    }
  }
  return longest;
}

/** A gap worth pointing at. One scene off is a breath; three is a disappearance. */
export const NOTABLE_GAP = 2;
