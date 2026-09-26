// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Move a scene block within the flat document — the corkboard/outliner drag-
 * reorder that reorders the script ON DISK (docs/app/organizing/workspace-model.md#WORK-D2).
 *
 * A "scene block" is a `scene` node plus its body up to the next scene OR act
 * boundary. Act nodes are FIXED dividers that stay in place — so dragging a
 * scene across an act divider changes its act (a valid cross-act move), and the
 * act node is never dragged along (critique R-SCENEMOVE: act nodes live at the
 * trailing edge of the preceding scene's extractScenes range, so the move must
 * stop the block at the next scene-or-act, not just the next scene).
 */
import type { BlockNode, Doc } from "./model";
import { extractScenes } from "./scenes";

export interface SceneBlock {
  ordinal: number;
  from: number; // index of the scene node
  to: number; // exclusive: next scene-or-act boundary (or doc end)
}

/** The movable scene blocks (boundaries at `scene` and `act` nodes). */
export function sceneBlockRanges(doc: Doc): SceneBlock[] {
  const blocks = doc.content;
  const out: SceneBlock[] = [];
  let ordinal = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== "scene") continue;
    let j = i + 1;
    while (j < blocks.length && blocks[j].type !== "scene" && blocks[j].type !== "act") {
      j += 1;
    }
    out.push({ ordinal: ordinal++, from: i, to: j });
    i = j - 1;
  }
  return out;
}

/**
 * Whether two versions of a script have the same scenes: the same scene and
 * act lines, with the same words, in the same order. A board change named its
 * scenes by position; typed on in the meantime, the page it lands on must still
 * put the same scenes at those positions for the change to mean the same thing.
 */
export function sameSceneOutline(a: Doc, b: Doc): boolean {
  const outline = (doc: Doc) =>
    doc.content
      .filter((n) => n.type === "scene" || n.type === "sceneHeading" || n.type === "act")
      .map(
        (n) => `${n.type}:${(n.content ?? []).map((c) => ("text" in c ? c.text : "")).join("")}`,
      );
  const x = outline(a);
  const y = outline(b);
  return x.length === y.length && x.every((line, i) => line === y[i]);
}

/**
 * Move the scene block at `fromOrdinal` so it becomes the `toOrdinal`-th scene
 * in document order. Returns a new doc; act dividers stay put.
 */
export function moveSceneInDoc(doc: Doc, fromOrdinal: number, toOrdinal: number): Doc {
  const ranges = sceneBlockRanges(doc);
  const n = ranges.length;
  if (
    fromOrdinal === toOrdinal ||
    fromOrdinal < 0 ||
    toOrdinal < 0 ||
    fromOrdinal >= n ||
    toOrdinal >= n
  ) {
    return doc;
  }

  const blocks = doc.content;
  const src = ranges[fromOrdinal];
  const moved = blocks.slice(src.from, src.to);
  const blockLen = src.to - src.from;
  const rest: BlockNode[] = [...blocks.slice(0, src.from), ...blocks.slice(src.to)];

  // Anchor against the target's original indices, adjusted for the removal.
  const insertAt =
    toOrdinal < fromOrdinal
      ? ranges[toOrdinal].from // before target (indices before src are unaffected)
      : ranges[toOrdinal].to - blockLen; // after target (shifted down by the removal)

  return {
    type: "doc",
    content: [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)],
  };
}

/**
 * Set (or clear) a scene's `=` synopsis in the doc — the corkboard editing a
 * card's description writes it back to the canonical `.fountain` (the synopsis
 * is Fountain-expressible, so the file owns it). Empty text removes the line.
 */
export function setSceneSynopsis(doc: Doc, ordinal: number, text: string): Doc {
  const scenes = extractScenes(doc);
  if (ordinal < 0 || ordinal >= scenes.length) return doc;
  const { from, to } = scenes[ordinal].range;
  const blocks = doc.content.slice();

  let synIdx = -1;
  for (let i = from; i < to; i++) {
    if (blocks[i].type === "synopsis") {
      synIdx = i;
      break;
    }
  }
  const trimmed = text.trim();
  const node: BlockNode = {
    type: "synopsis",
    content: trimmed ? [{ type: "text", text: trimmed }] : [],
  };
  if (synIdx >= 0) {
    if (trimmed) blocks[synIdx] = node;
    else blocks.splice(synIdx, 1);
  } else if (trimmed) {
    blocks.splice(from + 1, 0, node); // immediately after the scene heading
  }
  return { type: "doc", content: blocks };
}

/**
 * Append an empty scene to the doc — the board making a card for a scene that
 * has not been written yet (docs/app/organizing/workspace-model.md#WORK-31).
 *
 * Until this, a card existed only BECAUSE a scene existed: the board was a lens
 * on the script and could not create what it looked at, which is the one thing
 * a corkboard is for at the start of a play, and it left the relationship
 * between the board and the actual scenes hard to see. This is the answer —
 * the lens can now write, and it writes through the same doc→`writeScriptDoc`
 * path every other board edit uses, so there is still exactly one writer.
 *
 * **It matches the boundary the doc already uses.** `extractScenes` prefers
 * `scene` (`##`) and falls back to `sceneHeading`, so dropping a `##` into a
 * script written with headings would make `extractScenes` see ONE scene and
 * every existing card would vanish from the board — indistinguishable from data
 * loss, with the file untouched. An empty doc gets `##`, which is what the
 * board's own empty state tells the writer to type.
 *
 * A `sceneHeading` needs no `forced` attr: the serializer prefixes `.` for
 * anything that is not a natural INT/EXT slug.
 */
export function addSceneToDoc(doc: Doc, title?: string): Doc {
  const hasScene = doc.content.some((b) => b.type === "scene");
  const type: BlockNode["type"] = hasScene
    ? "scene"
    : doc.content.some((b) => b.type === "sceneHeading")
      ? "sceneHeading"
      : "scene";
  const count = doc.content.filter((b) => b.type === type).length;
  // The same label the card falls back to, so the card reads identically the
  // instant before and the instant after the write.
  const text = title?.trim() || `Scene ${count + 1}`;
  return {
    type: "doc",
    content: [...doc.content, { type, content: [{ type: "text", text }] }],
  };
}
