// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the guide's card goes (docs/app/preferences-and-help/tutorials.md#TUT-D103): beside its target,
 * never over it. The target is what the writer is about to click or type in,
 * and a card on top of it would be the one thing in the way — the native
 * self-test clicks at a control's centre and refuses when something else is
 * hit there, and so does a person. Any other box to keep clear (the menu a
 * target row sits in) is passed as `avoid`. Whether the target is scrolled
 * into view first, as the guide starts pointing at it, is `scrollFor`.
 *
 * Pure geometry, in viewport pixels, so it is tested without a window.
 */
export interface Box { left: number; top: number; width: number; height: number }
export type Side = "below" | "above" | "right" | "left";
export interface Placement {
  left: number; top: number;
  /** Which side of the target the card sits on; null when it floats with no target. */
  side: Side | null;
  /** Where the arrow meets the card's edge, measured along that edge. */
  arrow: number | null;
}

const MARGIN = 8, ARROW_INSET = 14;
const right = (b: Box) => b.left + b.width;
const bottom = (b: Box) => b.top + b.height;
export const overlaps = (a: Box, b: Box) => a.left < right(b) && b.left < right(a) && a.top < bottom(b) && b.top < bottom(a);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, lo > hi ? lo : v));

/** The target's box grown by every box it has to share its clearance with. */
function hull(boxes: Box[]): Box {
  const l = Math.min(...boxes.map(b => b.left)), t = Math.min(...boxes.map(b => b.top));
  return {left: l, top: t, width: Math.max(...boxes.map(right)) - l, height: Math.max(...boxes.map(bottom)) - t};
}

export function placeCard(target: Box | null, card: {width: number; height: number}, bounds: Box,
  prefer: Side[] = ["below", "above", "right", "left"], avoid: Box[] = [], gap = 12): Placement {
  const minX = bounds.left + MARGIN, maxX = right(bounds) - MARGIN - card.width;
  const minY = bounds.top + MARGIN, maxY = bottom(bounds) - MARGIN - card.height;
  if (!target) return {left: clamp(bounds.left + (bounds.width - card.width) / 2, minX, maxX), top: clamp(bottom(bounds) - card.height - 48, minY, maxY), side: null, arrow: null};
  const clear = hull([target, ...avoid]);
  const cx = target.left + target.width / 2, cy = target.top + target.height / 2;
  const at = (side: Side): Box => {
    switch (side) {
      case "below": return {left: clamp(cx - card.width / 2, minX, maxX), top: bottom(clear) + gap, width: card.width, height: card.height};
      case "above": return {left: clamp(cx - card.width / 2, minX, maxX), top: clear.top - gap - card.height, width: card.width, height: card.height};
      case "right": return {left: right(clear) + gap, top: clamp(cy - card.height / 2, minY, maxY), width: card.width, height: card.height};
      case "left": return {left: clear.left - gap - card.width, top: clamp(cy - card.height / 2, minY, maxY), width: card.width, height: card.height};
    }
  };
  const inside = (b: Box) => b.left >= minX - 0.5 && b.left <= maxX + 0.5 && b.top >= minY - 0.5 && b.top <= maxY + 0.5;
  const arrowFor = (side: Side, b: Box) => side === "below" || side === "above"
    ? clamp(cx - b.left, ARROW_INSET, card.width - ARROW_INSET)
    : clamp(cy - b.top, ARROW_INSET, card.height - ARROW_INSET);
  for (const side of prefer) {
    const b = at(side);
    if (inside(b) && ![target, ...avoid].some(x => overlaps(b, x))) return {left: b.left, top: b.top, side, arrow: arrowFor(side, b)};
  }
  // Nothing fits whole: take the roomiest side and keep the card on screen.
  // It may then cover something, but never by choice when a side had room.
  const room: Record<Side, number> = {below: bottom(bounds) - bottom(clear), above: clear.top - bounds.top, right: right(bounds) - right(clear), left: clear.left - bounds.left};
  const side = (["below", "above", "right", "left"] as Side[]).reduce((a, s) => room[s] > room[a] ? s : a, prefer[0] ?? "below");
  const b = at(side);
  const placed = {left: clamp(b.left, minX, maxX), top: clamp(b.top, minY, maxY), width: card.width, height: card.height};
  return {left: placed.left, top: placed.top, side, arrow: arrowFor(side, placed)};
}

/** A band of the window, top to bottom. */
export interface Band { top: number; bottom: number }

/**
 * How a control or a page the guide has just started pointing at is brought
 * into view, or null to leave it where it is. `view` is the band its pane
 * shows it in, below the sticky chrome the pane's scroll padding names (a
 * note's header and format bar), so what is scrolled in comes to rest there.
 *
 * A target that fits the band is brought in when any of it is outside. One
 * taller than the band, a note's page, is brought in by its top, and only when
 * its top is hidden: the top is where the writer starts, and bringing the
 * bottom in instead is what put a new note's first line under its format bar.
 */
export function scrollFor(target: Box, view: Band): "nearest" | "start" | null {
  const fits = target.height <= view.bottom - view.top;
  if (target.top < view.top - 0.5 || target.top >= view.bottom) return fits ? "nearest" : "start";
  return fits && bottom(target) > view.bottom + 0.5 ? "nearest" : null;
}
