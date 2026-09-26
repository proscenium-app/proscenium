// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { AutosaveScheduler, type TimerHost } from "./autosave";

class FakeClock implements TimerHost {
  private t = 0;
  private seq = 1;
  private timers: { id: number; at: number; fn: () => void }[] = [];

  now() {
    return this.t;
  }
  set(fn: () => void, ms: number) {
    const id = this.seq++;
    this.timers.push({ id, at: this.t + ms, fn });
    return id;
  }
  clear(id: number) {
    this.timers = this.timers.filter((x) => x.id !== id);
  }
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers
        .filter((x) => x.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter((x) => x.id !== due.id);
      this.t = due.at;
      due.fn();
    }
    this.t = end;
  }
}

const opts = { debounceMs: 600, maxWaitMs: 2000 };

describe("AutosaveScheduler", () => {
  it("flushes after the idle debounce", () => {
    const clock = new FakeClock();
    let flushes = 0;
    const s = new AutosaveScheduler(opts, () => flushes++, clock);
    s.schedule();
    clock.advance(599);
    expect(flushes).toBe(0);
    clock.advance(1); // t = 600
    expect(flushes).toBe(1);
  });

  it("resets the idle timer on each edit", () => {
    const clock = new FakeClock();
    let flushes = 0;
    const s = new AutosaveScheduler(opts, () => flushes++, clock);
    s.schedule();
    clock.advance(400);
    s.schedule(); // resets idle
    clock.advance(400); // 800 total, but only 400 since last edit
    expect(flushes).toBe(0);
    clock.advance(200); // 600 since last edit
    expect(flushes).toBe(1);
  });

  it("honors the max-wait ceiling under continuous editing", () => {
    const clock = new FakeClock();
    let flushes = 0;
    const s = new AutosaveScheduler(opts, () => flushes++, clock);
    s.schedule();
    for (let i = 0; i < 4; i++) {
      clock.advance(400); // 400, 800, 1200, 1600
      s.schedule();
    }
    expect(flushes).toBe(0); // idle kept resetting
    clock.advance(400); // t = 2000 → max-wait fires
    expect(flushes).toBe(1);
  });

  it("flushNow flushes immediately", () => {
    const clock = new FakeClock();
    let flushes = 0;
    const s = new AutosaveScheduler(opts, () => flushes++, clock);
    s.schedule();
    s.flushNow();
    expect(flushes).toBe(1);
  });

  it("cancel drops a pending flush", () => {
    const clock = new FakeClock();
    let flushes = 0;
    const s = new AutosaveScheduler(opts, () => flushes++, clock);
    s.schedule();
    s.cancel();
    clock.advance(5000);
    expect(flushes).toBe(0);
  });
});
