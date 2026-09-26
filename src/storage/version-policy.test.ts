// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { SnapshotPolicy } from "./version-policy";

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
