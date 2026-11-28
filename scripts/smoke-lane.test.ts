// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACTS_A_BROWSER, browserLane, STALLS_A_RUN, Stalled } from "./smoke-lane.mjs";

type Fake = { n: number; closed: boolean; close: () => Promise<void> };

/** A lane over browsers that are only numbered, and a list of every one launched. */
function fakes(options: Record<string, unknown> = {}, close?: (b: Fake) => Promise<void>) {
  const launched: Fake[] = [];
  const stalls: { count: number; message: string }[] = [];
  const lane = browserLane({
    launch: async () => {
      const b: Fake = {
        n: launched.length + 1,
        closed: false,
        close: async () => {
          if (close) await close(b);
          b.closed = true;
        },
      };
      launched.push(b);
      return b;
    },
    failed: (outcome: unknown) => (outcome as { ok: boolean }).ok === false,
    said: (s: { count: number; message: string }) => stalls.push(s),
    ...options,
  });
  return { lane, launched, stalls };
}

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("an engine's lane: which browser an act gets", () => {
  test("one browser for its limit of acts, then a fresh one, and the old one closed", async () => {
    const { lane, launched } = fakes({ limit: 2 });
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) await lane.run(async (b: Fake) => seen.push(b.n));
    expect(seen).toEqual([1, 1, 2, 2, 3]);
    await tick();
    expect(launched.map((b) => b.closed)).toEqual([true, true, false]);
    await lane.end();
    expect(launched.every((b) => b.closed)).toBe(true);
    expect(lane.browsers).toBe(3);
    expect(lane.stalls).toBe(0);
  });

  test("acts that ask at once get the same fresh browser, and an old one is closed only when no act is in it", async () => {
    const { lane, launched } = fakes({ limit: 3 });
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    // Three acts at once fill the first browser; the fourth is given the second.
    const first = [0, 1, 2].map(() =>
      lane.run(async (b: Fake) => {
        await held;
        return b.n;
      }),
    );
    const fourth = await lane.run(async (b: Fake) => b.n);
    expect(fourth).toBe(2);
    expect(launched).toHaveLength(2);
    // The first browser is retired, with three acts still in it: not closed.
    expect(launched[0].closed).toBe(false);
    release();
    expect(await Promise.all(first)).toEqual([1, 1, 1]);
    await tick();
    expect(launched[0].closed).toBe(true);
    await lane.end();
  });

  test("the limits a run is given: a third of where a WebKit stalled, and two stalls", () => {
    expect(ACTS_A_BROWSER).toBe(20);
    expect(STALLS_A_RUN).toBe(2);
  });
});

describe("a browser that stalls", () => {
  test("its act runs again in a fresh one, and the stall is said once however many acts met it", async () => {
    const { lane, launched, stalls } = fakes();
    const run = (name: string) =>
      lane.run(async (b: Fake) => {
        await tick();
        if (b.n === 1) throw new Stalled(`the page never loaded (${name})`);
        return `${name} in ${b.n}`;
      });
    // Three acts in the first browser, all of which find it stalled.
    expect(await Promise.all([run("a"), run("b"), run("c")])).toEqual([
      "a in 2",
      "b in 2",
      "c in 2",
    ]);
    expect(stalls).toHaveLength(1);
    expect(stalls[0].count).toBe(1);
    expect(lane.stalls).toBe(1);
    expect(launched).toHaveLength(2);
    await lane.end();
  });

  test("an act that failed a check in a browser that stalled under it runs again; one that passed there stands", async () => {
    const { lane } = fakes();
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const calls: string[] = [];
    const slow = (name: string, ok: boolean) =>
      lane.run(async (b: Fake) => {
        calls.push(`${name}@${b.n}`);
        if (b.n === 1) await held;
        // In the stalled browser the check fails; in a fresh one it passes.
        return { name, ok: b.n === 1 ? ok : true, browser: b.n };
      });
    const failing = slow("failing", false);
    const passing = slow("passing", true);
    // A third act in the same browser finds it stalled while the two are in it.
    const stalled = lane.run(async (b: Fake) => {
      if (b.n === 1) throw new Stalled("would not close");
      return { name: "stalled", ok: true, browser: b.n };
    });
    expect((await stalled).browser).toBe(2);
    release();
    expect(await failing).toEqual({ name: "failing", ok: true, browser: 2 });
    expect(await passing).toEqual({ name: "passing", ok: true, browser: 1 });
    expect(calls).toEqual(["failing@1", "passing@1", "failing@2"]);
    await lane.end();
  });

  test("a failure in a browser that never stalled is the check's own", async () => {
    const { lane, launched } = fakes();
    expect(await lane.run(async () => ({ ok: false }))).toEqual({ ok: false });
    expect(launched).toHaveLength(1);
    await lane.end();
  });

  test("more stalls than a run takes stops it, saying the last", async () => {
    const { lane, stalls } = fakes({ maxStalls: 2 });
    const always = lane.run(async () => {
      throw new Stalled("the page never loaded");
    });
    expect(always).rejects.toThrow(
      "the browser stalled 3 times in one run, and a fresh one each time did not mend it: the page never loaded",
    );
    await always.catch(() => {});
    expect(stalls.map((s) => s.count)).toEqual([1, 2, 3]);
    await lane.end();
  });

  test("a lane whose browser is not replaced stops at the first", async () => {
    const { lane } = fakes({ maxStalls: 0 });
    expect(
      lane.run(async () => {
        throw new Stalled("the app would not close");
      }),
    ).rejects.toThrow("the browser stalled: the app would not close");
  });

  test("any other error is the run's own, and leaves the lane as it was", async () => {
    const { lane, launched } = fakes();
    expect(
      lane.run(async () => {
        throw new Error("a check's own");
      }),
    ).rejects.toThrow("a check's own");
    await tick();
    expect(await lane.run(async (b: Fake) => b.n)).toBe(1);
    await lane.end();
    expect(launched).toHaveLength(1);
    expect(launched[0].closed).toBe(true);
  });

  test("a stalled browser that will not close is not waited on at the run's end", async () => {
    const { lane, launched } = fakes({ closeMs: 20 }, async (b) => {
      if (b.n === 1) await new Promise(() => {});
    });
    await lane.run(async (b: Fake) => {
      if (b.n === 1) throw new Stalled("would not close");
      return b.n;
    });
    const began = Date.now();
    await lane.end();
    expect(Date.now() - began).toBeLessThan(1000);
    expect(launched.map((b) => b.closed)).toEqual([false, true]);
  });
});

describe("smoke runs every act through a lane", () => {
  const source = readFileSync(join(import.meta.dir, "smoke.mjs"), "utf8");

  test("a pass and a proof both, and no act is handed a browser any other way", () => {
    const direct = source.match(/await runAct\(/g) ?? [];
    expect(direct).toEqual([]);
    expect(source.match(/\.run\(\(browser\) =>\s*runAct\(browser,/g)?.length).toBe(3);
  });

  test("a page that never loads and a page that will not close are both a stall, never a check's failure", () => {
    expect(source).toContain("throw new Stalled(`the page never loaded (");
    expect(source).toContain("did not close the page of");
    expect(source).not.toContain('stoppedBy("a browser that would not close")');
  });
});
