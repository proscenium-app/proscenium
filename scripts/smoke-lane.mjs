// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The browser an engine's acts run in, replaced before it can stall and when
 * it does.
 *
 * Each act is a browser context of its own in one browser an engine launched.
 * A WebKit that has opened about sixty of them can stop opening the next: on
 * 2026-11-26 and 27 three proofs, sixty acts an engine each, ended at their
 * sixtieth WebKit act with a page that never loaded, and then with contexts
 * that never closed (one waited sixteen hours, holding the host's bench). A
 * pass, thirty acts an engine, never met it, and the proof begun a second
 * after a stalled one ran fifty-nine acts in its fresh browser before it
 * stalled in turn. So:
 *
 * - a lane hands out one browser for at most `limit` acts, then launches the
 *   next; a browser no act is in any more is closed, and not waited on;
 * - an act that finds its browser stalled (`Stalled`: its page never loaded,
 *   or would not close) is run again in a fresh one, and so is an act that
 *   failed a check in a browser that stalled while it ran, since what a
 *   stalled browser said of a check counts for nothing;
 * - a lane that stalls more than `maxStalls` times stops the run, saying so.
 *
 * smoke.mjs owns the browsers and the acts; this owns only which browser an
 * act gets and what a stall does, so it can be tested without either.
 */

import { endedWithin } from "./smoke-journal.mjs";

/**
 * Acts one browser opens before the next is launched: a third of where a
 * WebKit was seen to stall.
 */
export const ACTS_A_BROWSER = 20;
/** Stalls a run takes, each mended by a fresh browser, before it stops. */
export const STALLS_A_RUN = 2;

/** An act's browser stopped answering: the act says nothing of its checks. */
export class Stalled extends Error {
  constructor(message) {
    super(message);
    this.name = "Stalled";
  }
}

/**
 * @param {object} o
 * @param {() => Promise<{ close(): Promise<void> }>} o.launch a fresh browser
 * @param {number} [o.limit] acts one browser opens before the next is launched
 * @param {number} [o.maxStalls] stalls the lane takes before it stops the run
 * @param {(outcome: unknown) => boolean} [o.failed] whether an act's outcome holds a failure
 * @param {(stall: { count: number, message: string }) => void} [o.said] told of each stall
 * @param {number} [o.closeMs] how long a finished browser's close is waited on
 */
export function browserLane({
  launch,
  limit = Number.POSITIVE_INFINITY,
  maxStalls = 2,
  failed = () => false,
  said = () => {},
  closeMs = 5000,
}) {
  /** @type {{ browser: any, opened: number, inside: number, dead: boolean, retired: boolean, closing: Promise<boolean> | null } | null} */
  let current = null;
  const slots = new Set();
  let stalls = 0;
  // One at a time: two acts asking at once get the same fresh browser, not two.
  let gate = Promise.resolve();

  /** A browser no act is in and none will be given: closed, for a moment and no longer. */
  const letGo = (slot) => {
    if (!slot.retired || slot.inside > 0 || slot.closing) return;
    slot.closing = endedWithin(closeMs, () => slot.browser.close());
  };

  const take = () => {
    const taken = gate.then(async () => {
      if (!current || current.retired || current.opened >= limit) {
        const old = current;
        current = {
          browser: await launch(),
          opened: 0,
          inside: 0,
          dead: false,
          retired: false,
          closing: null,
        };
        slots.add(current);
        if (old) {
          old.retired = true;
          letGo(old);
        }
      }
      current.opened++;
      current.inside++;
      return current;
    });
    gate = taken.then(
      () => {},
      () => {},
    );
    return taken;
  };

  return {
    /** How many times the lane's browser stalled. */
    get stalls() {
      return stalls;
    },
    /** How many browsers the lane launched. */
    get browsers() {
      return slots.size;
    },
    /**
     * Run one act: `act(browser)` in the lane's browser, again in a fresh one
     * for as long as its browser stalls under it.
     */
    async run(act) {
      for (;;) {
        const slot = await take();
        let outcome;
        let stall = null;
        try {
          outcome = await act(slot.browser);
        } catch (e) {
          if (!(e instanceof Stalled)) {
            slot.inside--;
            letGo(slot);
            throw e;
          }
          stall = e;
        }
        slot.inside--;
        if (stall && !slot.dead) {
          slot.dead = true;
          slot.retired = true;
          stalls++;
          said({ count: stalls, message: stall.message });
        }
        letGo(slot);
        if (stall) {
          if (stalls > maxStalls)
            throw new Error(
              maxStalls
                ? `the browser stalled ${stalls} times in one run, and a fresh one each time did not mend it: ${stall.message}`
                : `the browser stalled: ${stall.message}`,
            );
          continue;
        }
        // In a browser that stalled while this act ran: a failure there is the
        // browser's, so the act runs again; an act that passed, passed.
        if (slot.dead && failed(outcome)) continue;
        return outcome;
      }
    },
    /** The run's end: every browser closed, none waited on for long. */
    async end() {
      await gate;
      if (current) current.retired = true;
      for (const slot of slots) letGo(slot);
      await Promise.all([...slots].map((s) => s.closing));
    },
  };
}
