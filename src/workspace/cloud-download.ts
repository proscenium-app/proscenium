// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The app asks iCloud for the open folder itself (docs/engineering/cross-platform.md#PLAT-69).
 *
 * iCloud Drive on an iPad knows a folder by its names and leaves what is in it
 * in the cloud until something asks. A Plays folder nothing has asked for lists
 * as folders with nothing in them, so no play is found, and a writer was left
 * to download the folder by hand in Files before any play appeared. So once a
 * folder iCloud Drive keeps is open, the app asks for everything in it that is
 * not on the device, in passes: every second and a half while anything is
 * still coming down, every five seconds once nothing new has come for half a
 * minute, once a minute after everything is down, and at once when the writer
 * comes back to the app, so a play changed on another device comes down too.
 * A folder iCloud Drive does not keep (a desktop's, one on the iPad itself) is
 * asked once and never again.
 *
 * Nothing here reads or writes a play: a pass only asks, and says what is still
 * waiting. What came down is found by the caller, through the Plays folder's
 * discovery or the open files' check for changes from outside.
 */
import type { CloudDownload } from "../storage";

/** How soon the next pass looks while something is still coming down. */
export const CLOUD_FAST_MS = 1500;
/** With nothing new for this long, the wait is a slow one, and passes come less often. */
export const CLOUD_SLOW_AFTER_MS = 30_000;
/** How soon the next pass looks during a slow wait. */
export const CLOUD_SLOW_MS = 5000;
/** How often a folder with nothing waiting is asked again while the app is in front. */
export const CLOUD_KEEP_MS = 60_000;

export interface CloudState {
  /** Something in the open folder is still coming down from iCloud. */
  downloading: boolean;
  /** It has been coming down for half a minute with nothing new arriving. */
  slow: boolean;
  /**
   * The first pass has not answered yet: a folder that looks empty may be a
   * folder still in iCloud, so nothing is offered into it meanwhile.
   */
  looking: boolean;
}

export const CLOUD_IDLE: CloudState = { downloading: false, slow: false, looking: false };
/** A folder just opened, before the first pass has answered. */
export const CLOUD_LOOKING: CloudState = { ...CLOUD_IDLE, looking: true };

/** The clock a downloader runs on: the page's own, or a test's. */
export interface CloudTimers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
  now: () => number;
}

const pageTimers: CloudTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export interface CloudDownloader {
  /** Ask now: the folder was just opened, or the writer came back to the app. */
  nudge(): void;
  /** Never ask again, and say nothing more. */
  stop(): void;
}

export function cloudDownloader({
  ask,
  arrived,
  changed,
  live = () => true,
  hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden",
  timers = pageTimers,
}: {
  /** One pass: what is still waiting, each of it asked for. */
  ask: () => Promise<CloudDownload>;
  /** What is waiting changed since the last pass: look again at what is open. */
  arrived: () => void;
  /** The state the screen shows, each time it changes. */
  changed: (state: CloudState) => void;
  /** Whether the folder this downloader asks for is still the one open. */
  live?: () => boolean;
  /** The app is not in front: a pass waits for the writer to come back. */
  hidden?: () => boolean;
  timers?: CloudTimers;
}): CloudDownloader {
  let stopped = false;
  let running = false;
  let again = false;
  let timer: unknown = null;
  /** Whether iCloud Drive keeps the folder, until a pass says it does not. */
  let kept = true;
  /** What was waiting at the last pass, or null before the first. */
  let last: number | null = null;
  /** When what is waiting last changed, or the wait began. */
  let movedAt = timers.now();
  let state = CLOUD_LOOKING;

  const cancel = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const stop = () => {
    stopped = true;
    cancel();
  };
  const say = (next: CloudState) => {
    if (
      next.downloading === state.downloading &&
      next.slow === state.slow &&
      next.looking === state.looking
    )
      return;
    state = next;
    changed(next);
  };
  const later = (ms: number) => {
    cancel();
    timer = timers.set(() => {
      timer = null;
      // Behind another app, nothing is asked: coming back asks at once.
      if (!hidden()) void pass();
    }, ms);
  };

  const pass = async (): Promise<void> => {
    if (stopped) return;
    if (!live()) return stop();
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      let answer: CloudDownload | null;
      try {
        answer = await ask();
      } catch {
        // No answer is no information: nothing came down and nothing is gone.
        answer = null;
      }
      if (stopped) return;
      if (!live()) return stop();
      if (answer && !answer.ubiquitous) {
        kept = false;
        say(CLOUD_IDLE);
        return stop();
      }
      if (!answer) {
        // Nothing is known, so nothing is held back for it either.
        say({ ...state, looking: false });
        later(state.downloading ? CLOUD_SLOW_MS : CLOUD_KEEP_MS);
        return;
      }
      const now = timers.now();
      const moved = last !== null && answer.waiting !== last;
      last = answer.waiting;
      if (moved) {
        movedAt = now;
        arrived();
      }
      if (answer.waiting > 0) {
        if (!state.downloading) movedAt = now;
        const slow = now - movedAt >= CLOUD_SLOW_AFTER_MS;
        say({ downloading: true, slow, looking: false });
        later(slow ? CLOUD_SLOW_MS : CLOUD_FAST_MS);
      } else {
        say(CLOUD_IDLE);
        later(CLOUD_KEEP_MS);
      }
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        void pass();
      }
    }
  };

  return {
    nudge() {
      if (stopped || !kept) return;
      cancel();
      void pass();
    },
    stop,
  };
}
