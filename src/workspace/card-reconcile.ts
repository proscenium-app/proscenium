// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Card↔scene reconciliation (docs/app/keeping-work/storage-and-file-format.md#STOR-D6). Binds each scene in the parsed script
 * to its prior card record so card metadata survives app edits, EXTERNAL edits,
 * and reordering. Orphaned records are retained, never deleted (docs/app/keeping-work/storage-and-file-format.md#STOR-110).
 *
 * Binding priority: embeddedId → headingHash (nearest ordinal breaks ties) →
 * ordinal.
 *
 * **Two shapes, and the split is the point.** `SceneRecord` is what the play
 * file stores: identity, anchor, card. `SceneCard` is what the app renders: the
 * record plus the act, heading and synopsis the script already says. The
 * pre-1.0 sidecar stored those three as `_act`/`_heading`/`_synopsis` caches,
 * which meant retyping a scene heading rewrote a synced JSON file. They are
 * derived, they are free to recompute, and docs/app/keeping-work/storage-and-file-format.md#STOR-D5 keeps them out of the file.
 *
 * The `changed` flag compares STORED shapes only, so an open that changes
 * nothing the file owns is a no-op write — which is what keeps a multi-device
 * open from triggering a write storm.
 *
 * (Named card-reconcile to avoid colliding with binder-reconcile.)
 */
import { extractScenes, headingHash, type Doc } from "../fountain";
import { SCRIPT_DATA_TMPL, stringifyCanonical } from "./json-io";
import {
  defaultCard,
  emptyScriptData,
  type Card,
  type ScriptData,
  type SceneRecord,
} from "./play-file";
import { ulid } from "./ulid";

/**
 * A scene record plus what the script says about it. In memory only — the
 * three derived fields are never written (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
 */
export interface SceneCard extends SceneRecord {
  act?: string;
  heading: string;
  synopsis?: string;
}

export interface ReconcileInput {
  doc: Doc;
  prior: ScriptData | null;
}

export interface ReconcileResult {
  /** What to store. */
  data: ScriptData;
  /** What to render. */
  cards: SceneCard[];
  /** True iff `data` differs from prior — gate writes on it. */
  changed: boolean;
  newCards: number;
  orphaned: number;
}

/** The stored half of a card: everything but the three derived fields. */
export function toRecord(card: SceneCard): SceneRecord {
  const { act, heading, synopsis, ...rest } = card;
  void act;
  void heading;
  void synopsis;
  return rest;
}

function serializeData(d: ScriptData): string {
  return stringifyCanonical(d, SCRIPT_DATA_TMPL);
}

export function sameScriptData(a: ScriptData, b: ScriptData): boolean {
  return serializeData(a) === serializeData(b);
}

export function reconcileCards(
  input: ReconcileInput,
  mintId: () => string = ulid,
): ReconcileResult {
  const { doc } = input;
  const prior = input.prior ?? emptyScriptData();
  const scenes = extractScenes(doc);
  const priorScenes = prior.scenes;

  const consumed = new Set<number>();
  const byEmbedded = new Map<string, number>();
  const byHash = new Map<string, number[]>();
  const byOrdinal = new Map<number, number>();
  priorScenes.forEach((r, i) => {
    const a = r.anchor;
    if (!a) return;
    if (a.embeddedId) byEmbedded.set(a.embeddedId, i);
    if (a.headingHash) {
      const arr = byHash.get(a.headingHash);
      if (arr) arr.push(i);
      else byHash.set(a.headingHash, [i]);
    }
    if (typeof a.ordinal === "number" && !byOrdinal.has(a.ordinal)) {
      byOrdinal.set(a.ordinal, i);
    }
  });

  let newCards = 0;
  const cards: SceneCard[] = scenes.map((scene) => {
    const hHash = headingHash(scene.act, scene.heading);
    let bound: number | undefined;

    if (scene.embeddedId && byEmbedded.has(scene.embeddedId)) {
      const i = byEmbedded.get(scene.embeddedId)!;
      if (!consumed.has(i)) bound = i;
    }
    if (bound === undefined) {
      const candidates = (byHash.get(hHash) ?? []).filter((i) => !consumed.has(i));
      if (candidates.length) {
        bound = candidates.reduce((best, i) =>
          Math.abs(priorScenes[i].anchor.ordinal - scene.ordinal) <
          Math.abs(priorScenes[best].anchor.ordinal - scene.ordinal)
            ? i
            : best,
        );
      }
    }
    if (bound === undefined) {
      const i = byOrdinal.get(scene.ordinal);
      if (i !== undefined && !consumed.has(i)) bound = i;
    }

    let id: string;
    let card: Card;
    if (bound !== undefined) {
      consumed.add(bound);
      id = priorScenes[bound].id;
      card = { ...priorScenes[bound].card }; // carry card.* + unknown card keys
    } else {
      id = mintId();
      card = defaultCard();
      newCards += 1;
    }

    const out: SceneCard = {
      id,
      anchor: {
        ordinal: scene.ordinal,
        headingHash: hHash,
        embeddedId: scene.embeddedId ?? null,
      },
      card,
      heading: scene.heading,
    };
    if (scene.act) out.act = scene.act;
    if (scene.synopsis) out.synopsis = scene.synopsis;
    if (bound !== undefined) {
      // Preserve any unknown keys on the bound record — another program's
      // annotation survives our round trip (docs/app/keeping-work/storage-and-file-format.md#STOR-D5 preserve-unknown).
      for (const [k, v] of Object.entries(priorScenes[bound])) {
        if (!(k in out)) (out as Record<string, unknown>)[k] = v;
      }
    }
    return out;
  });

  // Unbound prior records become orphans — retained, never dropped (docs/app/keeping-work/storage-and-file-format.md#STOR-110).
  const freshOrphans = priorScenes.filter((_, i) => !consumed.has(i));
  const orphans = [...prior.orphans, ...freshOrphans];

  const data: ScriptData = {
    ...prior,
    scenes: cards.map(toRecord),
    orphans,
  };

  return {
    data,
    cards,
    changed: !sameScriptData(prior, data),
    newCards,
    orphaned: freshOrphans.length,
  };
}

/**
 * App-driven scene reorder: reorder the cards to match a move already applied
 * to the doc, refreshing each anchor (new ordinal + new act-qualified
 * headingHash) and carrying each card + id with its scene. This keeps the move
 * self-consistent so the next load-reconcile is a no-op — the app maintains the
 * card↔scene mapping directly rather than relying on reconcile to preserve
 * order. On a length mismatch it bails (the caller should full-reconcile
 * instead — the lockstep guard).
 */
export function reorderSceneCards(
  cards: SceneCard[],
  fromOrdinal: number,
  toOrdinal: number,
  newDoc: Doc,
): SceneCard[] {
  const records = cards.slice();
  const n = records.length;
  if (
    fromOrdinal === toOrdinal ||
    fromOrdinal < 0 ||
    toOrdinal < 0 ||
    fromOrdinal >= n ||
    toOrdinal >= n
  ) {
    return cards;
  }
  const [rec] = records.splice(fromOrdinal, 1);
  records.splice(toOrdinal, 0, rec);

  const scenes = extractScenes(newDoc);
  if (scenes.length !== records.length) return cards; // lockstep guard

  return records.map((r, k) => {
    const s = scenes[k];
    const out: SceneCard = {
      ...r,
      anchor: {
        ordinal: k,
        headingHash: headingHash(s.act, s.heading),
        embeddedId: s.embeddedId ?? r.anchor.embeddedId ?? null,
      },
      heading: s.heading,
    };
    if (s.act) out.act = s.act;
    else delete out.act;
    if (s.synopsis) out.synopsis = s.synopsis;
    else delete out.synopsis;
    return out;
  });
}
