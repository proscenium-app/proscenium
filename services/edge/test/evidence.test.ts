// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import {
  bound,
  copiesOf,
  crashIn,
  crashSaid,
  days,
  evidence,
  idsOf,
  rows,
  window,
} from "../src/evidence";

const V = "1.0.2-beta.1";
const A = "0b6f35d4-5d0f-4c8e-9a41-6a3d2b1c0e11";
const B = "1c7a46e5-6e1a-4d9f-8b52-7b4e3c2d1f22";

test("a window is a build's version, two times with their zones in order, and feedback ids", () => {
  expect(window(V, "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z", [A])).toEqual({
    version: V,
    from: "2026-10-01T14:00:00Z",
    until: "2026-10-02T14:00:00Z",
    cleared: [A],
  });
  for (const [version, from, until, cleared] of [
    ["1.0.2-rc.1", "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z", []],
    [V, "2026-10-01 14:00", "2026-10-02T14:00:00Z", []],
    [V, "2026-10-01T14:00:00", "2026-10-02T14:00:00Z", []],
    [V, "2026-10-02T14:00:00Z", "2026-10-01T14:00:00Z", []],
    [V, "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z", ["'; DROP TABLE x; --"]],
  ] as const)
    expect(() => window(version, from, until, cleared)).toThrow();
});
test("the days a window touches: every UTC day, since a count or a message says only its day", () => {
  const w = (from: string, until: string) => window(V, from, until);
  expect(days(w("2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z"))).toEqual({
    start: "2026-10-01",
    end: "2026-10-03",
  });
  // Ending at midnight touches no more of the next day.
  expect(days(w("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"))).toEqual({
    start: "2026-10-01",
    end: "2026-10-02",
  });
  // A zone is honoured: 09:00 in New York is 13:00 UTC.
  expect(days(w("2026-10-01T09:00:00-04:00", "2026-10-01T23:30:00-04:00"))).toEqual({
    start: "2026-10-01",
    end: "2026-10-03",
  });
});
test("a query's bindings are written in as checked literals, and nothing else is", () => {
  const w = window(V, "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z");
  expect(bound("-- a comment\nSELECT ?3, ?1, ?2\n  -- another\nFROM x WHERE a = ?1", w)).toBe(
    "SELECT '1.0.2-beta.1', '2026-10-01', '2026-10-03'\nFROM x WHERE a = '2026-10-01'",
  );
  expect(() => bound("SELECT ?4", w)).toThrow();
});
test("a crash report counts in every window its day touches, and in none it does not", () => {
  const w = window(V, "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z");
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;
  expect(crashIn(day("2026-10-01"), w)).toBe(true);
  expect(crashIn(day("2026-10-02"), w)).toBe(true);
  expect(crashIn(day("2026-09-30"), w)).toBe(false);
  expect(crashIn(day("2026-10-03"), w)).toBe(false);
  // A window from midnight to midnight is its one day.
  const one = window(V, "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z");
  expect(
    [day("2026-10-01"), day("2026-10-02"), day("2026-10-03")].map((t) => crashIn(t, one)),
  ).toEqual([false, true, false]);
});
test("the crash line says how many and what, the most first, within 300 characters", () => {
  expect(crashSaid(V, 0, [])).toBeNull();
  expect(crashSaid(V, 1, [{ said: "TypeError at webview 1:234", count: 1 }])).toBe(
    "1 crash report from 1.0.2-beta.1: TypeError at webview 1:234 (1).",
  );
  expect(
    crashSaid(V, 3, [
      { said: "RustPanic in proscenium_lib::vault::save", count: 1 },
      { said: "TypeError at webview 1:234", count: 2 },
    ]),
  ).toBe(
    "3 crash reports from 1.0.2-beta.1: TypeError at webview 1:234 (2); RustPanic in proscenium_lib::vault::save (1).",
  );
  // Sentry's top kinds may not add up to the total.
  expect(crashSaid(V, 9, [{ said: "TypeError", count: 5 }])).toBe(
    "9 crash reports from 1.0.2-beta.1: TypeError (5); 4 more.",
  );
  const many = Array.from({ length: 30 }, (_, i) => ({
    said: `Error number ${i} at webview`,
    count: 1,
  }));
  const long = crashSaid(V, 30, many) ?? "";
  expect(long.length).toBeLessThanOrEqual(300);
  expect(long).toMatch(/more\.$/);
});
test("the evidence: the copies as counted, the crash reports, and the feedback less what was cleared", () => {
  const w = window(V, "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z", [A]);
  expect(evidence(w, 4, [A, B], { total: 1, kinds: [{ said: "TypeError", count: 1 }] })).toEqual({
    copies: 4,
    crashes: 1,
    crashSaid: "1 crash report from 1.0.2-beta.1: TypeError (1).",
    feedback: { total: 2, unmarked: 1 },
  });
  expect(evidence(w, null, [], { total: 0, kinds: [] })).toEqual({
    copies: null,
    crashes: 0,
    crashSaid: null,
    feedback: { total: 0, unmarked: 0 },
  });
});
test("D1's answers are read strictly: results, a count or null, and ids", () => {
  const out = (results: unknown[], success = true) =>
    JSON.stringify([{ results, success, meta: { duration: 1 } }]);
  expect(rows(out([{ copies: 3 }]))).toEqual([{ copies: 3 }]);
  expect(() => rows(out([], false))).toThrow();
  expect(() => rows("{}")).toThrow();
  expect(copiesOf([{ copies: 3 }])).toBe(3);
  expect(copiesOf([{ copies: null }])).toBeNull();
  for (const bad of [[], [{ copies: -1 }], [{ copies: 1.5 }], [{ copies: "3" }]])
    expect(() => copiesOf(bad)).toThrow();
  expect(idsOf([{ id: A }, { id: B }])).toEqual([A, B]);
  expect(() => idsOf([{ id: "writer@example.org" }])).toThrow();
});
