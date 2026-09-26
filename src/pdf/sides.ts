// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Actor sides: one character's part, derived from the play (backlog P5).
 *
 * A side is what a rehearsal room actually hands an actor: their speeches in
 * full, each preceded by the tail of the line that cues them, with scene
 * labels kept for orientation and everything else left out. Producing one
 * from a script by hand is an evening of copy-paste; every input already
 * exists here — the doc knows who speaks, the engine paginates, the PDF draws.
 *
 * This module only DERIVES a document. The result flows through the same
 * paginator and renderer as the script itself, so sides inherit the format,
 * the emphasis handling and the page furniture without any second layout path
 * (the one-paginator invariant). Like plan.ts it is imported by path, keeps
 * type-only imports, and never touches pdf-lib — the export dialog previews
 * sides without paying for the renderer.
 *
 * Two derivation choices keep the artifact COMPACT, which is its whole point:
 * `act` blocks are never emitted (both shipped formats give acts
 * `startsNewPage`, so a five-act play would open with five near-empty sheets)
 * — instead each kept scene label is act-qualified the way appearances.ts
 * labels scenes ("ACT TWO · SCENE 1") when the play has more than one act.
 * And a scene the character never speaks in contributes no heading: sides for
 * a three-scene part must not be a flip-book of empty scene labels. The gaps
 * in the scene numbering say where the character is offstage.
 *
 * The derived doc is never serialized back to Fountain; it exists between the
 * script and the paper. That is why the cue-in lines may use the `em` mark on
 * synthetic text without violating the editor's "no emphasis in cues" fence —
 * that fence protects the `.fountain`, which this never reaches.
 */
import { cueName } from "../fountain/cue";
import type { BlockNode, Doc, InlineNode } from "../fountain/model";

/** How many words of the preceding line an actor gets as their cue. */
export const SIDES_CUE_WORDS = 8;

/** Blocks that continue a speech chain under a cue. */
const CHAIN = new Set<string>(["dialogue", "parenthetical", "lyric"]);
/** Blocks whose text can cue the next speaker. */
const SPEECH = new Set<string>(["dialogue", "lyric"]);

/** A block's plain text — text nodes only, notes skipped (they don't print). */
function blockText(block: BlockNode): string {
  return (block.content ?? [])
    .map((n: InlineNode) => (n.type === "text" ? (n.text ?? "") : ""))
    .join("");
}

/**
 * The cue an actor hears: the last spoken line of the chain, trimmed to its
 * final words. "… " marks that something came before — it appears when the
 * line was truncated OR when earlier lines of the same speech were dropped,
 * and not when the whole speech fits, so the mark always tells the truth.
 */
export function cueTail(speechText: string, cueWords = SIDES_CUE_WORDS): string | null {
  const lines = speechText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  const words = last.split(/\s+/);
  const kept = words.slice(-cueWords).join(" ");
  const elided = words.length > cueWords || lines.length > 1;
  return elided ? `… ${kept}` : kept;
}

/** The last spoken (dialogue/lyric) text in a chain, or null for a chain that
 * never speaks (a cue with only a wryly can't cue anyone). */
function lastSpeechText(chain: BlockNode[]): string | null {
  for (let j = chain.length - 1; j >= 0; j--) {
    const b = chain[j];
    if (!SPEECH.has(b.type)) continue;
    const text = blockText(b).trim();
    if (text) return text;
  }
  return null;
}

/** Copy a block, dropping a character cue's `dual` flag — the pair's other
 * half is elided from sides, so half-column layout would be a lie. */
function withoutDual(block: BlockNode): BlockNode {
  if (block.type !== "character" || block.attrs?.dual !== true) return block;
  const attrs = { ...block.attrs };
  delete attrs.dual;
  return { ...block, attrs };
}

function textBlock(type: BlockNode["type"], text: string): BlockNode {
  return { type, content: [{ type: "text", text }] };
}

/**
 * Derive one character's sides from the play.
 *
 * Kept: a leading "NAME — SIDES" line (a printed stack in a rehearsal room
 * must say whose it is — sides drop the title page), an act-qualified scene
 * label for every scene the character speaks in, and the character's chains
 * verbatim (cue, wrylies, speeches, marks and all). Before each chain, the
 * tail of the line that cues them is printed as the other speaker's cue + an
 * italic line. Everything else — actions, other speeches, transitions, empty
 * scenes, forced breaks — is elided.
 *
 * A cue-in appears only when there is one: not when the character opens a
 * scene (headings reset the memory — a cue never carries across a scene
 * break, the same rule computeWeights applies) and not when the previous
 * speech was their own.
 */
export function sidesDoc(doc: Doc, character: string): Doc {
  const target = character.trim().toUpperCase();
  const blocks = doc.content ?? [];
  const multiAct = blocks.filter((b) => b.type === "act").length > 1;

  const out: BlockNode[] = [textBlock("centered", `${target} — SIDES`)];

  let currentAct = "";
  /** The current scene's structure blocks, unflushed until the character
   * actually speaks under them — an empty scene leaves no heading behind. */
  let pending: BlockNode[] = [];
  let last: { name: string; text: string } | null = null;

  const flushPending = () => {
    for (const [i, block] of pending.entries()) {
      const label = blockText(block);
      out.push(
        i === 0 && multiAct && currentAct
          ? textBlock(block.type, `${currentAct} · ${label}`)
          : block,
      );
    }
    pending = [];
  };

  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === "act") {
      currentAct = blockText(block).trim().toUpperCase();
      pending = []; // whatever scene was open had nothing of the character's
      last = null;
      i++;
      continue;
    }
    if (block.type === "scene" || block.type === "sceneHeading") {
      // A heading after a `scene` block details the same scene; otherwise a
      // new scene replaces whatever empty one was pending.
      if (block.type === "sceneHeading" && pending[pending.length - 1]?.type === "scene") {
        pending.push(block);
      } else {
        pending = [block];
      }
      last = null;
      i++;
      continue;
    }

    if (block.type === "character") {
      let end = i + 1;
      while (end < blocks.length && CHAIN.has(blocks[end].type)) end++;
      const chain = blocks.slice(i, end);
      const name = cueName(blockText(block));

      if (name === target) {
        flushPending();
        if (last && last.name !== target) {
          const tail = cueTail(last.text);
          if (tail) {
            out.push(textBlock("character", last.name));
            out.push({
              type: "dialogue",
              content: [{ type: "text", text: tail, marks: [{ type: "em" }] }],
            });
          }
        }
        for (const b of chain) out.push(withoutDual(b));
      }

      const speech = lastSpeechText(chain);
      if (name && speech) last = { name, text: speech };
      i = end;
      continue;
    }

    i++; // everything else is elided
  }

  return { type: "doc", content: out };
}
