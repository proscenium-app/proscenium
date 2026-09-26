// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Scene extraction from the parsed doc, consumed by the corkboard/outliner and
 * the card↔scene reconciliation (docs/app/keeping-work/storage-and-file-format.md#STOR-D6). Reads the SAME parse the editor
 * uses — scenes are not a separate data source.
 *
 * Boundary priority (docs/app/organizing/workspace-model.md#WORK-D104):
 * `scene` (`##`) → fall back to `sceneHeading` → fall back to the whole doc.
 */
import { textContent } from "./inline";
import type { BlockNode, BlockType, Doc } from "./model";

export interface SceneSpan {
  /** Document-order index of the scene (the `ordinal` anchor in docs/app/keeping-work/storage-and-file-format.md#STOR-D6). */
  ordinal: number;
  /** Nearest enclosing act label (`#` Section), if any. */
  act?: string;
  /** The scene label (`##`) or heading text. */
  heading: string;
  /** First `=` synopsis within the scene — the card description cache. */
  synopsis?: string;
  /** Embedded `[[id:<ULID>]]` anchor, if the script uses embedded mode. */
  embeddedId?: string | null;
  /** Block index range `[from, to)` covered by this scene. */
  range: { from: number; to: number };
}

const EMBEDDED_RE = /^id:([0-9A-HJKMNP-TV-Z]{26})$/i;

/**
 * Read an embedded scene-anchor id from a block. A standalone `[[id:…]]` parses
 * to an `action` whose single child is a `note`; the id is the note's INNER text
 * (critique R-EMBEDDEDID — `textContent` of the action block drops notes).
 */
function embeddedAnchorId(block: BlockNode): string | null {
  if (block.type !== "action" || block.content?.length !== 1) return null;
  const child = block.content[0];
  if (child.type !== "note") return null;
  const inner = (child.content ?? [])
    .map((n) => (n.type === "text" ? n.text : ""))
    .join("")
    .trim();
  const m = inner.match(EMBEDDED_RE);
  return m ? m[1].toUpperCase() : null;
}

/** The anchor must be immediately after the heading — scan the first body blocks. */
function firstEmbeddedAnchor(blocks: BlockNode[], from: number, to: number): string | null {
  for (let i = from; i < Math.min(to, from + 2); i++) {
    const id = embeddedAnchorId(blocks[i]);
    if (id) return id;
  }
  return null;
}

function boundaryType(blocks: BlockNode[]): BlockType | null {
  if (blocks.some((b) => b.type === "scene")) return "scene";
  if (blocks.some((b) => b.type === "sceneHeading")) return "sceneHeading";
  return null;
}

function firstSynopsis(blocks: BlockNode[], from: number, to: number): string | undefined {
  for (let i = from; i < to; i++) {
    if (blocks[i].type === "synopsis") return textContent(blocks[i].content);
  }
  return undefined;
}

export function extractScenes(doc: Doc): SceneSpan[] {
  const blocks = doc.content;
  const boundary = boundaryType(blocks);

  if (!boundary) {
    if (blocks.length === 0) return [];
    return [
      {
        ordinal: 0,
        heading: "",
        synopsis: firstSynopsis(blocks, 0, blocks.length),
        range: { from: 0, to: blocks.length },
      },
    ];
  }

  const starts: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type === boundary) starts.push(i);
  }

  const scenes: SceneSpan[] = [];
  let currentAct: string | undefined;
  let nextStart = 0;

  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : blocks.length;

    // Track the most recent act label that precedes this scene.
    for (let i = nextStart; i < from; i++) {
      if (blocks[i].type === "act") currentAct = textContent(blocks[i].content);
    }
    nextStart = from;

    scenes.push({
      ordinal: s,
      ...(currentAct ? { act: currentAct } : {}),
      heading: textContent(blocks[from].content),
      synopsis: firstSynopsis(blocks, from + 1, to),
      embeddedId: firstEmbeddedAnchor(blocks, from + 1, to),
      range: { from, to },
    });
  }

  return scenes;
}
