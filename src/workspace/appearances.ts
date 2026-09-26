// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Trace each character through the script: which scenes they speak in. Derived
 * from the parsed doc + the scene records — never stored (storage rule 3: the
 * script is the single source of truth for who speaks where). The Cast panel
 * shows this so a writer can see a character's presence at a glance.
 */
import type { Doc } from "../fountain";
import { cueName } from "../fountain/cue";
import type { SceneCard } from "./card-reconcile";

function blockText(block: { content?: { type: string; text?: string }[] }): string {
  return (block.content ?? []).map((n) => (n.type === "text" ? (n.text ?? "") : "")).join("");
}

export interface SceneAppearance {
  ordinal: number;
  /** Short label like "Sc 1" or the scene heading if present. */
  label: string;
}

/**
 * Map of UPPERCASE cue name → the scenes it appears in, in order. Scenes are
 * counted exactly as the corkboard/outliner counts them (`scene` blocks if the
 * doc has any, else `sceneHeading`), so ordinals line up with the cards.
 */
export function computeAppearances(
  doc: Doc | null,
  cards: SceneCard[],
): Map<string, SceneAppearance[]> {
  const out = new Map<string, SceneAppearance[]>();
  if (!doc) return out;
  const blocks = doc.content ?? [];
  const boundary = blocks.some((b) => b.type === "scene") ? "scene" : "sceneHeading";

  // Act-qualify the label so repeated scene headings across acts (a very
  // common shape) don't collapse to "SCENE 1, SCENE 1". Only qualifies when
  // more than one act is present — a single-act play stays terse.
  const acts = new Set(cards.map((c) => c.act?.trim()).filter(Boolean));
  const multiAct = acts.size > 1;
  const labelFor = (ordinal: number): string => {
    const rec = cards.find((c) => c.anchor.ordinal === ordinal);
    const heading = rec?.heading?.trim() || `Sc ${ordinal + 1}`;
    const act = rec?.act?.trim();
    return multiAct && act ? `${act} · ${heading}` : heading;
  };

  let sceneIdx = -1;
  const seen = new Map<string, Set<number>>();
  for (const block of blocks) {
    if (block.type === boundary) sceneIdx += 1;
    if (block.type !== "character") continue;
    const name = cueName(blockText(block));
    if (!name) continue;
    const at = Math.max(0, sceneIdx);
    let set = seen.get(name);
    if (!set) {
      set = new Set();
      seen.set(name, set);
      out.set(name, []);
    }
    if (!set.has(at)) {
      set.add(at);
      out.get(name)!.push({ ordinal: at, label: labelFor(at) });
    }
  }
  return out;
}
