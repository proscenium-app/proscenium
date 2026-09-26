// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How much of the play each character actually occupies, and what that makes
 * them: a principal, a supporting role, or a name on the list who never speaks.
 *
 * Derived from the script every time (storage rule 3 — the Fountain file is the
 * only source of truth for who speaks and how much). Nothing here is stored;
 * the sidecar holds only the one thing the script cannot express, which is a
 * writer's decision to keep a speaker OFF the cast page (`castHidden`).
 *
 * The tiering is a heuristic for grouping a view. It is relative, not absolute
 * — a two-hander and a twelve-hander both come out sensible — and nothing
 * load-bearing depends on it. Pure functions only; no vault, no React.
 */
import type { Doc } from "../fountain";
import { cueName } from "../fountain/cue";

/** What one character's presence in the script adds up to. */
export interface CharacterWeight {
  /** Canonical cue name, ALL CAPS. */
  name: string;
  /** How many times they are cued. */
  cues: number;
  /** Lines of speech under those cues — the honest measure of a part's size. */
  lines: number;
  /** How many distinct scenes they speak in. */
  scenes: number;
  /** Ordinal of the scene they first speak in — used to break ties the way a
   *  programme does, by order of appearance. */
  first: number;
}

export type CastTier = "principal" | "supporting" | "mentioned";

/**
 * A speaker is a principal when they carry a real share of the talking OR turn
 * up across a real share of the play. Both are relative to this script, so the
 * split adapts instead of assuming a house size.
 */
const PRINCIPAL_LINE_SHARE = 0.25; // ≥ a quarter of the biggest part
const PRINCIPAL_SCENE_SHARE = 0.5; // …or present in half the scenes
/**
 * …but reach means *recurring*. One scene is never reach, however short the
 * play: a doorman with a line in a two-scene piece is in "half the play" by
 * arithmetic and is plainly not a principal.
 */
const PRINCIPAL_MIN_SCENES = 2;

function blockText(block: { content?: { type: string; text?: string }[] }): string {
  return (block.content ?? []).map((n) => (n.type === "text" ? (n.text ?? "") : "")).join("");
}

/** Speech blocks that count toward a part's size. */
function isSpeech(type: string): boolean {
  return type === "dialogue" || type === "lyric";
}

/**
 * Every speaker in the script, weighted. Walks the doc once, attributing each
 * speech block to the cue above it — the same way the page reads. A soft line
 * break inside a speech counts as a line, because on the page it is one.
 *
 * Parentheticals are deliberately NOT counted: "(beat)" is not a line, and
 * counting it would inflate the parts of characters who pause a lot.
 */
export function computeWeights(doc: Doc | null): Map<string, CharacterWeight> {
  const out = new Map<string, CharacterWeight>();
  if (!doc) return out;
  const blocks = doc.content ?? [];
  const boundary = blocks.some((b) => b.type === "scene") ? "scene" : "sceneHeading";

  let sceneIdx = -1;
  let speaker: string | null = null;
  const scenesSeen = new Map<string, Set<number>>();

  for (const block of blocks) {
    if (block.type === boundary) {
      sceneIdx += 1;
      speaker = null; // a cue never carries across a scene break
      continue;
    }
    if (block.type === "character") {
      const name = cueName(blockText(block));
      speaker = name || null;
      if (!speaker) continue;
      const at = Math.max(0, sceneIdx);
      let w = out.get(speaker);
      if (!w) {
        w = { name: speaker, cues: 0, lines: 0, scenes: 0, first: at };
        out.set(speaker, w);
        scenesSeen.set(speaker, new Set());
      }
      w.cues += 1;
      const seen = scenesSeen.get(speaker)!;
      if (!seen.has(at)) {
        seen.add(at);
        w.scenes += 1;
      }
      continue;
    }
    if (speaker && isSpeech(block.type)) {
      const text = blockText(block);
      if (text.trim()) out.get(speaker)!.lines += text.split("\n").filter((l) => l.trim()).length;
      continue;
    }
    // Anything that isn't a parenthetical ends the speech (action, transition,
    // a new act…), so the next speech block isn't misattributed.
    if (block.type !== "parenthetical") speaker = null;
  }
  return out;
}

/**
 * Which tier a name belongs to. A name with no speaking presence is "mentioned"
 * — it is on the cast list because someone put it there (or the character has
 * been written out), and saying so is more useful than ranking it last.
 *
 * `totalScenes` is the play's scene count, which the caller already holds (the
 * card records). It can't be inferred from the weights: a character who opens
 * the play and returns at the end appears in two scenes spanning twenty.
 */
export function tierFor(
  name: string,
  weights: Map<string, CharacterWeight>,
  totalScenes: number,
): CastTier {
  const w = weights.get(name.trim().toUpperCase());
  if (!w || w.cues === 0) return "mentioned";
  let topLines = 0;
  for (const other of weights.values()) topLines = Math.max(topLines, other.lines);
  const bigPart = topLines > 0 && w.lines >= topLines * PRINCIPAL_LINE_SHARE;
  const wideReach =
    totalScenes > 0 &&
    w.scenes >= PRINCIPAL_MIN_SCENES &&
    w.scenes >= totalScenes * PRINCIPAL_SCENE_SHARE;
  return bigPart || wideReach ? "principal" : "supporting";
}

/**
 * Rank two names by weight: the bigger part first, then the wider reach, then
 * whoever speaks first — the order a programme would print, with ties settled
 * alphabetically so the list never shuffles between renders.
 */
export function compareByWeight(
  a: string,
  b: string,
  weights: Map<string, CharacterWeight>,
): number {
  const wa = weights.get(a.trim().toUpperCase());
  const wb = weights.get(b.trim().toUpperCase());
  if (wa && wb) {
    if (wb.lines !== wa.lines) return wb.lines - wa.lines;
    if (wb.scenes !== wa.scenes) return wb.scenes - wa.scenes;
    if (wa.first !== wb.first) return wa.first - wb.first;
  }
  return a.localeCompare(b);
}

/**
 * Speakers in the script who aren't on the cast list and haven't been waved
 * off. This is what auto-add adds — the writer types a new cue and the
 * character is simply there, without a button.
 *
 * `hidden` is the escape hatch that makes that safe: without it, removing
 * VOICE or ALL from the cast page would just put it straight back.
 */
export function detectNewSpeakers(
  listed: readonly { name: string }[],
  weights: Map<string, CharacterWeight>,
  hidden: readonly string[] = [],
): string[] {
  const known = new Set(listed.map((c) => c.name.trim().toUpperCase()).filter(Boolean));
  for (const h of hidden) known.add(h.trim().toUpperCase());
  return [...weights.keys()]
    .filter((name) => !known.has(name))
    .sort((a, b) => compareByWeight(a, b, weights));
}

export interface CastGroup {
  tier: CastTier;
  label: string;
  /** Indices into the caller's entry list, heaviest part first. */
  indices: number[];
}

const TIER_LABEL: Record<CastTier, string> = {
  principal: "Principals",
  supporting: "Supporting",
  mentioned: "Mentioned",
};

const TIER_ORDER: CastTier[] = ["principal", "supporting", "mentioned"];

/**
 * Group the cast list for display, heaviest first inside each tier. Returns
 * INDICES rather than entries so the view keeps editing the writer's own array
 * — grouping is a lens on the list, never a rewrite of it. Empty tiers are
 * dropped, so a play where everyone is a principal shows one plain list.
 */
export function groupCast(
  entries: readonly { name: string }[],
  weights: Map<string, CharacterWeight>,
  totalScenes: number,
): CastGroup[] {
  const buckets = new Map<CastTier, number[]>(TIER_ORDER.map((t) => [t, []]));
  entries.forEach((entry, i) => {
    buckets.get(tierFor(entry.name, weights, totalScenes))!.push(i);
  });
  return TIER_ORDER.filter((tier) => buckets.get(tier)!.length > 0).map((tier) => ({
    tier,
    label: TIER_LABEL[tier],
    indices: buckets
      .get(tier)!
      .sort((x, y) => compareByWeight(entries[x]!.name, entries[y]!.name, weights)),
  }));
}
