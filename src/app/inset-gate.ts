// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * When what the keyboard covers is written to the page (use-keyboard-inset.ts):
 * at once, but never while a finger is down or in the moment after it lifts.
 *
 * A tap's click comes about a tenth of a second after the finger lifts, and on
 * an iPad a tap whose page moved or changed meanwhile is held back from its
 * click. A keyboard's bar that grew as a field was touched (46 to 51 points)
 * reflowed the window under the finger, and the tap only showed it. So an
 * inset offered while a finger is down, or within `holdMs` of its lift, waits,
 * and then the newest one alone is written.
 *
 * The bar itself grows and shrinks by a few points (46, 51, 62) as a field is
 * touched, and iPadOS says so before the page has heard the touch: written at
 * once, it moved the window under a finger that had not yet reached the page.
 * So a change that small between two bars waits a moment more, for a touch on
 * its way; a keyboard that comes or goes is written as before.
 *
 * A finger held down past `HELD_MS` (ui/finger.ts) holds nothing back, as the
 * page's layout holds nothing back then. Were a lift ever kept from the page,
 * as the system may keep one when it takes a touch for its own, the
 * keyboard's inset would wait for good and the page would lie under the keys.
 */
import { HELD_MS } from "../ui/finger";

export interface InsetGateClock {
  now(): number;
  setTimer(run: () => void, ms: number): number;
  clearTimer(id: number): void;
}

export interface InsetGate {
  offer(inset: number): void;
  touchDown(): void;
  touchUp(): void;
  dispose(): void;
}

export const STILL_AFTER_A_TOUCH_MS = 400;

/** How long a bar's small change waits for a touch that may be on its way. */
export const BAR_CHANGE_WAIT_MS = 250;

/** A change this small between two insets is a bar growing or shrinking. */
export const BAR_CHANGE_PX = 24;

export function insetGate(
  write: (inset: number) => void,
  clock: InsetGateClock,
  holdMs = STILL_AFTER_A_TOUCH_MS,
  barWaitMs = BAR_CHANGE_WAIT_MS,
  heldMs = HELD_MS,
): InsetGate {
  let touching = false;
  let touchedAt = Number.NEGATIVE_INFINITY;
  let liftedAt = Number.NEGATIVE_INFINITY;
  let pending: number | null = null;
  let last: number | null = null;
  let notBefore = Number.NEGATIVE_INFINITY;
  let timer = 0;
  const settle = () => {
    timer = 0;
    if (pending === null) return;
    const now = clock.now();
    // A finger down past the ceiling is no tap under way.
    const down = touching && now - touchedAt < heldMs;
    const wait = Math.max(
      down ? Math.min(holdMs, touchedAt + heldMs - now) : liftedAt + holdMs - now,
      notBefore - now,
    );
    if (wait > 0) {
      timer = clock.setTimer(settle, wait);
      return;
    }
    const inset = pending;
    pending = null;
    last = inset;
    write(inset);
  };
  const barChange = (inset: number) =>
    last !== null &&
    last > 0 &&
    inset > 0 &&
    inset !== last &&
    Math.abs(inset - last) <= BAR_CHANGE_PX;
  return {
    offer(inset) {
      pending = inset;
      if (timer) return;
      if (barChange(inset)) notBefore = clock.now() + barWaitMs;
      settle();
    },
    touchDown() {
      touching = true;
      touchedAt = clock.now();
    },
    touchUp() {
      touching = false;
      liftedAt = clock.now();
    },
    dispose() {
      if (timer) clock.clearTimer(timer);
      timer = 0;
      pending = null;
    },
  };
}
