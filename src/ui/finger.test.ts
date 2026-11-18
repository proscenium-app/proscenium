// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { finger, type FingerClock } from "./finger";

/** A clock the test moves by hand, firing what falls due. */
function fakeClock() {
  let t = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: FingerClock = {
    now: () => t,
    setTimer(run, ms) {
      const id = next++;
      timers.set(id, { at: t + ms, run });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
  };
  const advance = (ms: number) => {
    const until = t + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = due[1].at;
      due[1].run();
    }
    t = until;
  };
  return { clock, advance };
}

describe("work that draws, around a finger's tap", () => {
  test("runs at once when no finger is down", () => {
    const { clock } = fakeClock();
    const f = finger(clock, 400);
    const ran: string[] = [];
    f.afterTap(() => ran.push("layout"));
    expect(ran).toEqual(["layout"]);
    expect(f.busy()).toBe(false);
  });

  test("waits while the finger is down and runs once the tap's click has landed", () => {
    const { clock, advance } = fakeClock();
    const f = finger(clock, 400);
    const ran: string[] = [];
    f.down();
    f.afterTap(() => ran.push("layout"));
    advance(80);
    f.lifted();
    advance(90);
    expect(ran).toEqual([]);
    f.clicked();
    // After the click's own handlers.
    expect(ran).toEqual([]);
    advance(0);
    expect(ran).toEqual(["layout"]);
    expect(f.busy()).toBe(false);
  });

  test("a lift that brings no click lets the work run a moment later", () => {
    const { clock, advance } = fakeClock();
    const f = finger(clock, 400);
    const ran: string[] = [];
    f.down();
    f.afterTap(() => ran.push("fit"));
    f.lifted();
    advance(399);
    expect(ran).toEqual([]);
    advance(1);
    expect(ran).toEqual(["fit"]);
  });

  test("a scroll or a pinch, cancelled, holds nothing back", () => {
    const { clock } = fakeClock();
    const f = finger(clock, 400);
    const ran: string[] = [];
    f.down();
    f.afterTap(() => ran.push("layout"));
    f.cancelled();
    expect(ran).toEqual(["layout"]);
    expect(f.busy()).toBe(false);
  });

  test("the same work asked for twice in one tap runs once", () => {
    const { clock, advance } = fakeClock();
    const f = finger(clock, 400);
    let runs = 0;
    const layout = () => runs++;
    f.down();
    f.afterTap(layout);
    f.afterTap(layout);
    f.lifted();
    f.clicked();
    advance(0);
    expect(runs).toBe(1);
  });

  test("a second tap before the first's work ran keeps it waiting for its own click", () => {
    const { clock, advance } = fakeClock();
    const f = finger(clock, 400);
    const ran: string[] = [];
    f.down();
    f.afterTap(() => ran.push("layout"));
    f.lifted();
    advance(200);
    f.down();
    advance(300);
    expect(ran).toEqual([]);
    f.lifted();
    f.clicked();
    advance(0);
    expect(ran).toEqual(["layout"]);
  });

  test("a finger held past the ceiling, or never lifted, holds nothing back", () => {
    const { clock, advance } = fakeClock();
    const f = finger(clock, 400, 1500);
    const ran: string[] = [];
    f.down();
    f.afterTap(() => ran.push("layout"));
    advance(1499);
    expect(ran).toEqual([]);
    advance(1);
    expect(ran).toEqual(["layout"]);
    expect(f.busy()).toBe(false);
    // Still held, new work runs at once, and the late lift waits for no click.
    f.afterTap(() => ran.push("fit"));
    expect(ran).toEqual(["layout", "fit"]);
    f.lifted();
    expect(f.busy()).toBe(false);
  });

  test("a click with no finger on its way, a pointer's, changes nothing", () => {
    const { clock } = fakeClock();
    const f = finger(clock, 400);
    f.clicked();
    expect(f.busy()).toBe(false);
  });
});
