// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether a finger's tap is still on its way to its click
 * (docs/engineering/cross-platform.md#PLAT-70), and work that would draw
 * something new waiting until it has landed.
 *
 * WebKit on an iPad gives a tap its click only if nothing it counts as
 * actionable came into view while the finger was down, or in the moment after
 * its hover: anywhere in the page, and every element inside the script's own
 * text counts, as every button and field does, a new one as much as one
 * revealed. The page's own work redrew in that moment: the page view laying
 * out its sheets again a beat after a change, the element bar unfolding a
 * group of its buttons, a document's format bar putting up its list numbering.
 * Each such tap only showed it, and the writer tapped again.
 *
 * So that work asks `afterTap` to run it: at once when no finger is down;
 * otherwise once the tap's click has landed, or a moment after a lift that
 * brought none. A pointer's press is no finger, and waits for nothing. A
 * finger held down past a ceiling holds nothing back either: a press that long
 * is a long press, the system's, and a lift the page is never told of (the
 * system took the touch) must not leave the page's layout waiting for good.
 */

/** How long after a lift with no click the waiting work runs anyway. */
export const AFTER_A_LIFT_MS = 400;

/** How long a finger may stay down before the work waiting on its tap runs anyway. */
export const HELD_MS = 1500;

export interface FingerClock {
  now(): number;
  setTimer(run: () => void, ms: number): number;
  clearTimer(id: number): void;
}

export interface Finger {
  /** A finger is down, or lifted a moment ago with its click still to come. */
  busy(): boolean;
  /** `run` at once when no tap is under way, else once it has landed. Each function waits once. */
  afterTap(run: () => void): void;
  down(): void;
  lifted(): void;
  /** A gesture that is no tap (a scroll, a pinch): nothing waits for a click. */
  cancelled(): void;
  /** A click, which a tap on its way ends with. */
  clicked(): void;
}

export function finger(
  clock: FingerClock,
  afterLiftMs = AFTER_A_LIFT_MS,
  heldMs = HELD_MS,
): Finger {
  let isDown = false;
  let waitingForClick = false;
  const queued = new Set<() => void>();
  let timer = 0;
  const flush = () => {
    if (timer) clock.clearTimer(timer);
    timer = 0;
    waitingForClick = false;
    const runs = [...queued];
    queued.clear();
    for (const run of runs) run();
  };
  const busy = () => isDown || waitingForClick;
  return {
    busy,
    afterTap(run) {
      if (!busy()) run();
      else queued.add(run);
    },
    down() {
      isDown = true;
      if (timer) clock.clearTimer(timer);
      // Held this long, it is no tap: its lift, if it comes, waits for no click.
      timer = clock.setTimer(() => {
        isDown = false;
        flush();
      }, heldMs);
    },
    lifted() {
      if (!isDown) return;
      isDown = false;
      waitingForClick = true;
      if (timer) clock.clearTimer(timer);
      timer = clock.setTimer(flush, afterLiftMs);
    },
    cancelled() {
      isDown = false;
      flush();
    },
    clicked() {
      if (isDown || !waitingForClick) return;
      // After the click's own handlers, which may move the page themselves.
      if (timer) clock.clearTimer(timer);
      timer = clock.setTimer(flush, 0);
    },
  };
}

let shared: Finger | null = null;

/** The page's one finger, listening from its first use. */
function pageFinger(): Finger {
  if (shared) return shared;
  const made = finger({
    now: () => performance.now(),
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });
  shared = made;
  if (typeof window === "undefined") return made;
  const byFinger = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";
  window.addEventListener("pointerdown", (e) => byFinger(e) && made.down(), true);
  window.addEventListener("pointerup", (e) => byFinger(e) && made.lifted(), true);
  window.addEventListener("pointercancel", (e) => byFinger(e) && made.cancelled(), true);
  window.addEventListener("click", () => made.clicked(), true);
  return made;
}

/** A tap is under way: work that draws something new would cost it its click. */
export function tapUnderWay(): boolean {
  return typeof window !== "undefined" && pageFinger().busy();
}

/** `run` now, or once the tap under way has had its click. */
export function afterTap(run: () => void): void {
  if (typeof window === "undefined") {
    run();
    return;
  }
  pageFinger().afterTap(run);
}

// Listening from the page's start, so a tap under way as the first work asks is known.
if (typeof window !== "undefined") pageFinger();
