// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { insetGate, type InsetGateClock } from "./inset-gate";

/** A clock the test moves by hand, with the timers it would have fired. */
function fakeClock() {
  let t = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: InsetGateClock = {
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
  return { clock, advance, pending: () => timers.size };
}

describe("what the keyboard covers, written around a touch", () => {
  test("a finger never lifted holds an inset back no longer than the ceiling", () => {
    const { clock, advance } = fakeClock();
    const written: number[] = [];
    const gate = insetGate((inset) => written.push(inset), clock, 400, 250, 1500);
    // The tap that raised the keyboard, whose lift the system kept.
    gate.touchDown();
    gate.offer(262);
    advance(1499);
    expect(written).toEqual([]);
    advance(1);
    expect(written).toEqual([262]);
    // A new touch is a tap under way again.
    gate.touchDown();
    gate.offer(0);
    advance(100);
    expect(written).toEqual([262]);
    gate.touchUp();
    advance(400);
    expect(written).toEqual([262, 0]);
  });

  test("is written at once when no finger is down", () => {
    const { clock } = fakeClock();
    const written: number[] = [];
    const gate = insetGate((inset) => written.push(inset), clock, 400);
    gate.offer(46);
    expect(written).toEqual([46]);
  });

  test("waits while a finger is down and for a moment after it lifts, then writes the newest", () => {
    const { clock, advance } = fakeClock();
    const written: number[] = [];
    const gate = insetGate((inset) => written.push(inset), clock, 400);
    gate.touchDown();
    gate.offer(46);
    gate.offer(51);
    advance(100);
    expect(written).toEqual([]);
    gate.touchUp();
    advance(399);
    expect(written).toEqual([]);
    advance(1);
    expect(written).toEqual([51]);
  });

  test("an inset offered just after a lift waits out the rest of the moment", () => {
    const { clock, advance } = fakeClock();
    const written: number[] = [];
    const gate = insetGate((inset) => written.push(inset), clock, 400);
    gate.touchDown();
    gate.touchUp();
    advance(150);
    gate.offer(330);
    expect(written).toEqual([]);
    advance(250);
    expect(written).toEqual([330]);
    // Long after, at once again.
    advance(1000);
    gate.offer(0);
    expect(written).toEqual([330, 0]);
  });

  test("a bar that grows by a few points waits a moment, so a touch on its way holds it", () => {
    const { clock, advance } = fakeClock();
    const written: number[] = [];
    const gate = insetGate((inset) => written.push(inset), clock, 400, 250);
    gate.offer(46);
    expect(written).toEqual([46]);
    // iPadOS grows the bar as a field is touched, and says so first.
    gate.offer(51);
    expect(written).toEqual([46]);
    advance(20);
    gate.touchDown();
    advance(60);
    gate.touchUp();
    advance(399);
    expect(written).toEqual([46]);
    advance(1);
    expect(written).toEqual([46, 51]);
  });

  test("a bar's small change with no touch after it is written a moment later", () => {
    const { clock, advance } = fakeClock();
    const written: number[] = [];
    const gate = insetGate((inset) => written.push(inset), clock, 400, 250);
    gate.offer(51);
    gate.offer(46);
    advance(249);
    expect(written).toEqual([51]);
    advance(1);
    expect(written).toEqual([51, 46]);
  });

  test("a keyboard that comes or goes is no bar's change, and is written at once", () => {
    const { clock } = fakeClock();
    const written: number[] = [];
    const gate = insetGate((inset) => written.push(inset), clock, 400, 250);
    gate.offer(46);
    gate.offer(402);
    gate.offer(0);
    gate.offer(46);
    expect(written).toEqual([46, 402, 0, 46]);
  });

  test("leaves nothing waiting once it is let go", () => {
    const { clock, advance, pending } = fakeClock();
    const written: number[] = [];
    const gate = insetGate((inset) => written.push(inset), clock, 400);
    gate.touchDown();
    gate.offer(46);
    gate.dispose();
    expect(pending()).toBe(0);
    advance(1000);
    expect(written).toEqual([]);
  });
});
