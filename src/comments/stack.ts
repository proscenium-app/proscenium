// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the margin cards sit (docs/app/writing/comments.md#COMM-D4) — the pure half of the
 * margin's behaviour: every card wants to be level with the line it
 * annotates, no two cards may overlap, and the card you are reading gets its
 * wish exactly while its neighbours give way around it.
 *
 * Pure on purpose: measuring belongs to the DOM (CommentsMargin.tsx), but
 * *placement* is arithmetic, and arithmetic can be pinned by tests.
 */

export interface CardBox {
  /** Where the card wants to be: its anchor's y, in column pixels. */
  want: number;
  /** The card's measured height. */
  height: number;
}

export interface StackOptions {
  /** Clear space between two cards. */
  gap?: number;
  /** The column's ceiling — no card may sit above it. */
  minTop?: number;
  /** The focused card: placed exactly at its anchor, others yield to it. */
  active?: number | null;
}

/**
 * Did the measured positions actually change?
 *
 * Guarding a `setState` on this is what keeps the margin from re-rendering on
 * every transaction — and getting it wrong is how every card vanishes while
 * its highlight stays on the page. The first version compared
 * `Math.abs((b.get(pos) ?? NaN) - top) > 0.5`, and `NaN > 0.5` is **false**:
 * a key that had MOVED (every key, after typing one character above the first
 * comment) read as unchanged, the stale map survived, and the cards were
 * filtered out of the render for keys that no longer existed. Same keys, then
 * same values — in that order, and neither by accident.
 */
export function sameSpots(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other === undefined || Math.abs(other - value) > 0.5) return false;
  }
  return true;
}

/**
 * Resolve desired positions into non-overlapping ones, in document order.
 * Returns one top per card, in the order given.
 */
export function stackCards(cards: CardBox[], opts: StackOptions = {}): number[] {
  const gap = opts.gap ?? 8;
  const minTop = opts.minTop ?? 0;
  const n = cards.length;
  const tops = new Array<number>(n);
  if (n === 0) return tops;

  const active = opts.active ?? null;
  const pivot = active !== null && active >= 0 && active < n ? active : -1;

  if (pivot >= 0) {
    // The focused card is level with its anchor; everything above is pushed
    // up and everything below is pushed down, only as far as it takes.
    tops[pivot] = cards[pivot].want;
    for (let i = pivot - 1; i >= 0; i--) {
      tops[i] = Math.min(cards[i].want, tops[i + 1] - gap - cards[i].height);
    }
    for (let i = pivot + 1; i < n; i++) {
      tops[i] = Math.max(cards[i].want, tops[i - 1] + cards[i - 1].height + gap);
    }
  } else {
    for (let i = 0; i < n; i++) {
      tops[i] =
        i === 0 ? cards[i].want : Math.max(cards[i].want, tops[i - 1] + cards[i - 1].height + gap);
    }
  }

  // The ceiling outranks the anchor — a card shoved off the top of the column
  // would be unreachable. Clamp, then cascade back down so nothing overlaps.
  if (tops[0] < minTop) tops[0] = minTop;
  for (let i = 1; i < n; i++) {
    tops[i] = Math.max(tops[i], tops[i - 1] + cards[i - 1].height + gap);
  }
  return tops;
}
