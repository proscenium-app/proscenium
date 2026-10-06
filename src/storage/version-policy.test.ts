// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { SnapshotPolicy, WritingVersions } from "./version-policy";

function withClock(startAt = 0) {
  let t = startAt;
  const policy = new SnapshotPolicy(5 * 60_000, () => t);
  return { policy, tick: (ms: number) => (t += ms) };
}

describe("SnapshotPolicy", () => {
  test("first save always snapshots; the bucket then suppresses", () => {
    const { policy, tick } = withClock();
    expect(policy.shouldSnapshot("s1")).toBe(true);
    policy.record("s1");
    tick(1_000);
    expect(policy.shouldSnapshot("s1")).toBe(false);
    tick(4 * 60_000);
    expect(policy.shouldSnapshot("s1")).toBe(false); // 4m01s — still inside
    tick(59_000 + 1);
    expect(policy.shouldSnapshot("s1")).toBe(true); // bucket elapsed
  });

  test("scripts are independent", () => {
    const { policy } = withClock();
    policy.record("s1");
    expect(policy.shouldSnapshot("s1")).toBe(false);
    expect(policy.shouldSnapshot("s2")).toBe(true);
  });

  test("reset makes the next save snapshot immediately", () => {
    const { policy, tick } = withClock();
    policy.record("s1");
    tick(1_000);
    expect(policy.shouldSnapshot("s1")).toBe(false);
    policy.reset("s1");
    expect(policy.shouldSnapshot("s1")).toBe(true);
  });
});

describe("WritingVersions", () => {
  function harness() {
    let t = 0;
    const pending = new Map<number, { at: number; fn: () => void }>();
    let next = 1;
    const taken: string[] = [];
    const keeper = new WritingVersions(
      (playId, id, content, ext) => {
        taken.push(`${playId}/${id}.${ext}=${content}`);
      },
      5 * 60_000,
      2 * 60_000,
      () => t,
      {
        set: (fn, ms) => {
          pending.set(next, { at: t + ms, fn });
          return next++;
        },
        clear: (handle) => pending.delete(handle as number),
      },
    );
    const tick = (ms: number) => {
      t += ms;
      for (const [key, p] of [...pending]) {
        if (p.at <= t) {
          pending.delete(key);
          p.fn();
        }
      }
    };
    return { keeper, taken, tick };
  }

  test("the first save keeps a version at once", () => {
    const { keeper, taken } = harness();
    keeper.landed("p", "s1", "one", "fountain");
    expect(taken).toEqual(["p/s1.fountain=one"]);
  });

  test("saves inside the bucket are kept once they go quiet, as the last of them", () => {
    const { keeper, taken, tick } = harness();
    keeper.landed("p", "s1", "one", "fountain");
    tick(30_000);
    keeper.landed("p", "s1", "two", "fountain");
    tick(60_000);
    keeper.landed("p", "s1", "three", "fountain");
    tick(119_000);
    expect(taken).toEqual(["p/s1.fountain=one"]);
    tick(1_000);
    expect(taken).toEqual(["p/s1.fountain=one", "p/s1.fountain=three"]);
    tick(10 * 60_000);
    expect(taken.length).toBe(2);
  });

  test("a save after the bucket keeps a version at once and drops the held one's timer", () => {
    const { keeper, taken, tick } = harness();
    keeper.landed("p", "s1", "one", "md");
    tick(60_000);
    keeper.landed("p", "s1", "two", "md");
    tick(60_000);
    keeper.landed("p", "s1", "three", "md");
    tick(60_000);
    keeper.landed("p", "s1", "four", "md");
    tick(60_000);
    keeper.landed("p", "s1", "five", "md");
    tick(60_000);
    // Four minutes after "one" the quiet timer was still being pushed back;
    // "five" came before the bucket closed, so it is held, not kept.
    keeper.landed("p", "s1", "six", "md");
    expect(taken).toEqual(["p/s1.md=one", "p/s1.md=six"]);
    tick(2 * 60_000);
    expect(taken).toEqual(["p/s1.md=one", "p/s1.md=six"]);
  });

  test("items are independent, and each keeps the play it was written in", () => {
    const { keeper, taken, tick } = harness();
    keeper.landed("p", "s1", "a", "fountain");
    keeper.landed("p", "n1", "b", "md");
    tick(1_000);
    keeper.landed("p", "n1", "c", "md");
    keeper.landed("q", "s1", "d", "fountain");
    tick(2 * 60_000);
    expect(taken).toEqual(["p/s1.fountain=a", "p/n1.md=b", "p/n1.md=c", "q/s1.fountain=d"]);
  });

  test("reset keeps what is held and lets the next save keep one at once", () => {
    const { keeper, taken, tick } = harness();
    keeper.landed("p", "s1", "one", "fountain");
    tick(1_000);
    keeper.landed("p", "s1", "two", "fountain");
    keeper.reset("s1");
    expect(taken).toEqual(["p/s1.fountain=one", "p/s1.fountain=two"]);
    keeper.landed("p", "s1", "three", "fountain");
    expect(taken[taken.length - 1]).toBe("p/s1.fountain=three");
  });

  test("a session's first version keeps the text from before it first, in order", async () => {
    const { keeper, taken, tick } = harness();
    keeper.landed("p", "s1", "one", "fountain", "zero");
    await Promise.resolve();
    await Promise.resolve();
    expect(taken).toEqual(["p/s1.fountain=zero", "p/s1.fountain=one"]);
    tick(6 * 60_000);
    keeper.landed("p", "s1", "two", "fountain", "one");
    expect(taken.length).toBe(3);
    keeper.reset("s1");
    keeper.landed("p", "s1", "three", "fountain", "two");
    await Promise.resolve();
    await Promise.resolve();
    expect(taken.slice(3)).toEqual(["p/s1.fountain=two", "p/s1.fountain=three"]);
  });

  test("a save over text that changed underneath keeps that text first, at once", async () => {
    const { keeper, taken, tick } = harness();
    keeper.landed("p", "s1", "one", "fountain", "zero");
    await Promise.resolve();
    await Promise.resolve();
    tick(30_000);
    // An ordinary save: the file held what the last one landed.
    keeper.landed("p", "s1", "two", "fountain", "one");
    expect(taken.length).toBe(2);
    tick(30_000);
    // The file changed from outside: it held "theirs", not "two".
    keeper.landed("p", "s1", "theirs + mine", "fountain", "theirs");
    await Promise.resolve();
    await Promise.resolve();
    expect(taken.slice(2)).toEqual(["p/s1.fountain=theirs", "p/s1.fountain=theirs + mine"]);
  });

  test("flush keeps everything held", () => {
    const { keeper, taken, tick } = harness();
    keeper.landed("p", "a", "1", "md");
    keeper.landed("p", "b", "1", "md");
    tick(1_000);
    keeper.landed("p", "a", "2", "md");
    keeper.landed("p", "b", "2", "md");
    keeper.flush();
    expect(taken.slice(2).sort()).toEqual(["p/a.md=2", "p/b.md=2"]);
    tick(5 * 60_000);
    expect(taken.length).toBe(4);
  });
});
