// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { burstTexts, changesTo, newestBurst, type ChangeTexts } from "./bursts";
import type { LedgerEntry } from "./store";

const T0 = Date.parse("2026-10-16T09:00:00Z");
const entry = (id: string, min: number, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id,
  ts: new Date(T0 + min * 60_000).toISOString(),
  kind: "external",
  path: "Play.fountain",
  afterHash: `h-${id}`,
  revertable: true,
  stats: { added: 1, removed: 0 },
  note: null,
  status: "pending",
  ...extra,
});

function texts(before: Record<string, string>, after: Record<string, string>): ChangeTexts {
  return {
    before: async (id) => before[id] ?? null,
    after: async (id) => after[id] ?? null,
  };
}

const same = (a: string, b: string) => a === b;

describe("docs/app/keeping-work/storage-and-file-format.md#STOR-184: the newest burst of changes to a file", () => {
  test("runs back while each change began from what the one before it left", async () => {
    const list = changesTo(
      [entry("c", 4), entry("a", 0), entry("b", 2), entry("x", 3, { path: "Other.md" })],
      "Play.fountain",
      same,
    );
    const burst = await newestBurst(list, texts({ a: "0", b: "1", c: "2" }, { a: "1", b: "2" }));
    expect(burst.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  test("stops where the writer's own words came between", async () => {
    // "b" began from "1+mine": the writer saved after "a" left "1".
    const list = changesTo([entry("a", 0), entry("b", 2), entry("c", 4)], "Play.fountain", same);
    const burst = await newestBurst(
      list,
      texts({ a: "0", b: "1+mine", c: "2" }, { a: "1", b: "2" }),
    );
    expect(burst.map((e) => e.id)).toEqual(["b", "c"]);
  });

  test("stops at a gap, and never counts a change put back", async () => {
    const apart = changesTo([entry("a", 0), entry("b", 45)], "Play.fountain", same);
    expect((await newestBurst(apart, texts({}, {}))).map((e) => e.id)).toEqual(["b"]);
    const back = changesTo(
      [entry("a", 0), entry("b", 2, { status: "reverted" })],
      "Play.fountain",
      same,
    );
    expect(back.map((e) => e.id)).toEqual(["a"]);
  });

  test("is read from before its first change to what its last left", async () => {
    const list = [entry("a", 0), entry("b", 2)];
    const read = texts({ a: "0", b: "1" }, { a: "1", b: "2" });
    expect(await burstTexts(list, read, null, async () => "now")).toEqual({
      before: "0",
      after: "2",
    });
    // A change kept before after-texts were: what the next began from, else the file now.
    const old = texts({ a: "0", b: "1", n: "2+" }, {});
    expect(await burstTexts(list, old, entry("n", 9), async () => "now")).toEqual({
      before: "0",
      after: "2+",
    });
    expect(await burstTexts(list, old, null, async () => "now")).toEqual({
      before: "0",
      after: "now",
    });
  });
});
