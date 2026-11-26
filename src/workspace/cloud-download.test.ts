// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import type { CloudDownload } from "../storage";
import {
  CLOUD_FAST_MS,
  CLOUD_IDLE,
  CLOUD_KEEP_MS,
  CLOUD_SLOW_AFTER_MS,
  CLOUD_SLOW_MS,
  cloudDownloader,
  type CloudState,
  type CloudTimers,
} from "./cloud-download";

/** A clock the test moves by hand. */
function clock() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: CloudTimers = {
    set: (fn, ms) => {
      const id = next++;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (id) => {
      due.delete(id as number);
    },
    now: () => now,
  };
  /** Moves the clock on by `ms`, running each timer as its moment comes, and what it started. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const first = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > end) break;
      due.delete(first[0]);
      now = first[1].at;
      first[1].fn();
      await settle();
    }
    now = end;
  };
  return { timers, advance, pending: () => due.size };
}

/** Lets a pass's awaited answer land. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A downloader whose passes answer `answers` in turn, the last one ever after. */
function downloader(
  answers: (CloudDownload | Error)[],
  opts: { live?: () => boolean; hidden?: () => boolean } = {},
) {
  const c = clock();
  let asked = 0;
  let arrived = 0;
  const states: CloudState[] = [];
  const d = cloudDownloader({
    ask: async () => {
      const answer = answers[Math.min(asked, answers.length - 1)];
      asked++;
      if (answer instanceof Error) throw answer;
      return answer;
    },
    arrived: () => {
      arrived++;
    },
    changed: (s) => states.push(s),
    live: opts.live,
    hidden: opts.hidden ?? (() => false),
    timers: c.timers,
  });
  return {
    d,
    ...c,
    asked: () => asked,
    arrived: () => arrived,
    states,
  };
}

const waiting = (n: number): CloudDownload => ({ ubiquitous: true, waiting: n });

/** The state the screen was last told. */
const latest = (states: CloudState[]): CloudState | undefined => states[states.length - 1];

describe("the app asks iCloud for the open folder itself", () => {
  test("a folder iCloud Drive does not keep is asked once and never again", async () => {
    const t = downloader([{ ubiquitous: false, waiting: 0 }]);
    t.d.nudge();
    await settle();
    await t.advance(10 * CLOUD_KEEP_MS);
    t.d.nudge();
    await settle();
    expect(t.asked()).toBe(1);
    // Its one answer ends the look: nothing waits, and nothing is held back.
    expect(t.states).toEqual([CLOUD_IDLE]);
    expect(t.pending()).toBe(0);
  });

  test("while plays come down, passes come quickly, the screen says so, and each arrival is looked for", async () => {
    const t = downloader([waiting(3), waiting(2), waiting(1), waiting(0)]);
    t.d.nudge();
    await settle();
    expect(t.states).toEqual([{ downloading: true, slow: false, looking: false }]);
    expect(t.arrived()).toBe(0);

    await t.advance(CLOUD_FAST_MS);
    expect(t.asked()).toBe(2);
    expect(t.arrived()).toBe(1);
    await t.advance(2 * CLOUD_FAST_MS);
    expect(t.asked()).toBe(4);
    expect(t.arrived()).toBe(3);
    // Everything is down: the screen says nothing more, and the folder is
    // asked again in a minute, not in a second and a half.
    expect(latest(t.states)).toEqual(CLOUD_IDLE);
    await t.advance(CLOUD_KEEP_MS - 1);
    expect(t.asked()).toBe(4);
    await t.advance(1);
    expect(t.asked()).toBe(5);
  });

  test("a folder with everything already down says nothing and looks for nothing", async () => {
    const t = downloader([waiting(0)]);
    t.d.nudge();
    await settle();
    await t.advance(3 * CLOUD_KEEP_MS);
    expect(t.asked()).toBe(4);
    expect(t.states).toEqual([CLOUD_IDLE]);
    expect(t.arrived()).toBe(0);
  });

  test("until the first pass answers, the folder is still being looked at, whatever the answer", async () => {
    for (const first of [waiting(0), waiting(2), new Error("no answer")]) {
      const t = downloader([first]);
      t.d.nudge();
      expect(t.states).toEqual([]);
      await settle();
      expect(t.states.length).toBe(1);
      expect(latest(t.states)?.looking).toBe(false);
    }
  });

  test("half a minute with nothing new is a slow wait, said so, and asked about less often", async () => {
    const t = downloader([waiting(2)]);
    t.d.nudge();
    await settle();
    await t.advance(CLOUD_SLOW_AFTER_MS - CLOUD_FAST_MS);
    expect(t.states).toEqual([{ downloading: true, slow: false, looking: false }]);
    await t.advance(CLOUD_FAST_MS);
    expect(latest(t.states)).toEqual({ downloading: true, slow: true, looking: false });
    const before = t.asked();
    await t.advance(CLOUD_SLOW_MS - 1);
    expect(t.asked()).toBe(before);
    await t.advance(1);
    expect(t.asked()).toBe(before + 1);
    expect(t.arrived()).toBe(0);
  });

  test("something new arriving ends a slow wait, a folder showing more inside it too", async () => {
    // Twenty-one passes with two waiting take the wait past half a minute.
    // Then a folder comes down and shows three more files inside it: what is
    // waiting went up, and that is something arriving too.
    const t = downloader([...Array<CloudDownload>(21).fill(waiting(2)), waiting(3)]);
    t.d.nudge();
    await settle();
    await t.advance(CLOUD_SLOW_AFTER_MS);
    expect(latest(t.states)).toEqual({ downloading: true, slow: true, looking: false });
    expect(t.arrived()).toBe(0);
    await t.advance(CLOUD_SLOW_MS);
    expect(t.arrived()).toBe(1);
    expect(latest(t.states)).toEqual({ downloading: true, slow: false, looking: false });
  });

  test("coming back to the app asks at once", async () => {
    const t = downloader([waiting(0)]);
    t.d.nudge();
    await settle();
    expect(t.asked()).toBe(1);
    t.d.nudge();
    await settle();
    expect(t.asked()).toBe(2);
    // And the minute's pass starts counting again from there.
    expect(t.pending()).toBe(1);
  });

  test("a pass that gets no answer is no information: nothing came down, nothing is gone", async () => {
    const t = downloader([waiting(2), new Error("the plugin did not answer"), waiting(1)]);
    t.d.nudge();
    await settle();
    await t.advance(CLOUD_FAST_MS);
    expect(t.asked()).toBe(2);
    expect(t.states).toEqual([{ downloading: true, slow: false, looking: false }]);
    expect(t.arrived()).toBe(0);
    await t.advance(CLOUD_SLOW_MS);
    expect(t.asked()).toBe(3);
    expect(t.arrived()).toBe(1);
  });

  test("behind another app nothing is asked, and coming back asks", async () => {
    let away = false;
    const t = downloader([waiting(0)], { hidden: () => away });
    t.d.nudge();
    await settle();
    away = true;
    await t.advance(5 * CLOUD_KEEP_MS);
    expect(t.asked()).toBe(1);
    away = false;
    t.d.nudge();
    await settle();
    expect(t.asked()).toBe(2);
  });

  test("a folder no longer open is asked about no more", async () => {
    let open = true;
    const t = downloader([waiting(3)], { live: () => open });
    t.d.nudge();
    await settle();
    open = false;
    await t.advance(10 * CLOUD_FAST_MS);
    expect(t.asked()).toBe(1);
    expect(t.pending()).toBe(0);
  });

  test("a stopped downloader says nothing more", async () => {
    const t = downloader([waiting(3), waiting(0)]);
    t.d.nudge();
    t.d.stop();
    await settle();
    await t.advance(CLOUD_KEEP_MS);
    expect(t.states).toEqual([]);
    expect(t.arrived()).toBe(0);
  });
});
