// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { bound, window } from "../src/evidence";
const db = new Database(":memory:");
for (const name of [
  "0001_updates.sql",
  "0002_feedback.sql",
  "0003_usage.sql",
  "0004_feedback_list.sql",
  "0006_usage_track.sql",
  "0007_feedback_version.sql",
])
  db.exec(await Bun.file(new URL(`../migrations/${name}`, import.meta.url)).text());
const queries = new Map<string, string>();
for (const name of [
  "update-use",
  "downloads",
  "feature-share",
  "launches-by-version",
  "daily-volume",
  "feedback-counts",
  "feedback-receipts",
  "feedback-list",
  "copies-by-version",
  "feedback-by-version",
  "usage-by-day",
  "launches-by-day",
])
  queries.set(name, await Bun.file(new URL(`../queries/${name}.sql`, import.meta.url)).text());
function query(name: string, ...params: string[]): Record<string, unknown>[] {
  return db.query(queries.get(name)!).all(...params) as Record<string, unknown>[];
}
/** One day's count, as the Worker stores it. */
function usage(
  day: string,
  version: string,
  channel: string,
  event: string,
  props: string,
  count: number,
  track = "stable",
) {
  db.query(
    `INSERT INTO usage_counts (day, version, platform, arch, os, channel, track, event, props, count)
     VALUES (?, ?, 'darwin', 'aarch64', '15.6', ?, ?, ?, ?, ?)`,
  ).run(day, version, channel, track, event, props, count);
}
function feedback(
  id: string,
  message: string,
  email: string | null,
  details: string | null,
  day: string,
  version: string | null = null,
) {
  db.query(
    "INSERT INTO feedback_messages (id, message, email, details, received_day, version) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, message, email, details, day, version);
}
test("the scheduled jobs' queries respect UTC boundaries and denominators; zero is different from unavailable", () => {
  usage("2026-09-17", "1.0.0", "developer-id", "app_launched", "{}", 10);
  usage("2026-09-17", "1.0.0", "developer-id", "surface_shown", '{"surface":"board"}', 4);
  usage("2026-09-17", "1.0.0", "app-store", "format_saved", "{}", 2);
  usage("2026-09-18", "1.0.0", "developer-id", "app_launched", "{}", 100);
  db.run(
    "INSERT INTO update_counts VALUES ('2026-09-17','check','darwin','aarch64','1.0.0','15.6',12)",
  );
  db.run("INSERT INTO update_counts VALUES ('2026-09-17','download','','','1.0.0','',3)");
  const rows = query("feature-share", "2026-09-17", "2026-09-18");
  expect(rows.find((r) => r.event === "surface_shown")).toEqual({
    track: "stable",
    channel: "developer-id",
    event: "surface_shown",
    props: '{"surface":"board"}',
    actions: 4,
    launches: 10,
    actions_per_100_launches: 40,
  });
  expect(rows.find((r) => r.channel === "app-store")?.actions_per_100_launches).toBeNull();
  expect(query("update-use", "2026-09-17", "2026-09-18")[0].checks).toBe(12);
  // Launches by version: the newest release first, each channel its own row, the day's boundary held.
  usage("2026-09-17", "0.9.0", "developer-id", "app_launched", "{}", 3);
  expect(query("launches-by-version", "2026-09-17", "2026-09-18")).toEqual([
    { version: "1.0.0", track: "stable", channel: "developer-id", launches: 10 },
    { version: "0.9.0", track: "stable", channel: "developer-id", launches: 3 },
  ]);
  expect(query("launches-by-version", "2026-09-18", "2026-09-19")).toEqual([
    { version: "1.0.0", track: "stable", channel: "developer-id", launches: 100 },
  ]);
  expect(query("downloads", "2026-09-17", "2026-09-18")[0].download_requests).toBe(3);
});
test("a beta's counts are counted apart: its own launches, and shares over its own launches (docs/engineering/services-and-feedback.md#SERV-272)", () => {
  usage("2026-09-20", "1.0.0", "developer-id", "app_launched", "{}", 50);
  usage("2026-09-20", "1.0.0", "developer-id", "surface_shown", '{"surface":"cast"}', 5);
  usage("2026-09-20", "1.0.1-beta.2", "developer-id", "app_launched", "{}", 4, "beta");
  usage(
    "2026-09-20",
    "1.0.1-beta.2",
    "developer-id",
    "surface_shown",
    '{"surface":"cast"}',
    4,
    "beta",
  );
  expect(query("launches-by-version", "2026-09-20", "2026-09-21")).toEqual([
    { version: "1.0.1-beta.2", track: "beta", channel: "developer-id", launches: 4 },
    { version: "1.0.0", track: "stable", channel: "developer-id", launches: 50 },
  ]);
  const cast = query("feature-share", "2026-09-20", "2026-09-21").filter(
    (r) => r.event === "surface_shown",
  );
  expect(cast.map((r) => [r.track, r.actions_per_100_launches])).toEqual([
    ["stable", 10],
    ["beta", 100],
  ]);
});
test("a day's counts for the usage page: every event and value by day and track, launches by version and system (docs/engineering/services-and-feedback.md#CHECKS-D105)", () => {
  const launch = (
    day: string,
    version: string,
    arch: string,
    os: string,
    n: number,
    track = "stable",
  ) =>
    db
      .query(
        `INSERT INTO usage_counts (day, version, platform, arch, os, channel, track, event, props, count)
         VALUES (?, ?, 'darwin', ?, ?, 'developer-id', ?, 'app_launched', '{}', ?)`,
      )
      .run(day, version, arch, os, track, n);
  launch("2026-10-03", "1.0.0", "aarch64", "15.6", 7);
  launch("2026-10-03", "1.0.0", "x86_64", "14.7", 2);
  launch("2026-10-03", "1.0.1-beta.1", "aarch64", "26.0", 1, "beta");
  launch("2026-10-04", "1.0.0", "aarch64", "15.6", 5);
  usage("2026-10-03", "1.0.0", "developer-id", "surface_shown", '{"surface":"board"}', 3);
  usage("2026-10-03", "0.9.0", "developer-id", "surface_shown", '{"surface":"board"}', 1);
  usage(
    "2026-10-03",
    "1.0.0",
    "developer-id",
    "pdf_exported",
    '{"kind":"whole","format":"dg-modern"}',
    2,
  );
  usage("2026-10-04", "1.0.0", "developer-id", "surface_shown", '{"surface":"board"}', 4);
  // Systems fold into one row a day for each version, event and value; versions and tracks stay apart.
  expect(query("usage-by-day", "2026-10-03", "2026-10-05")).toEqual([
    {
      day: "2026-10-03",
      version: "1.0.0",
      track: "stable",
      event: "app_launched",
      props: "{}",
      actions: 9,
    },
    {
      day: "2026-10-03",
      version: "1.0.0",
      track: "stable",
      event: "pdf_exported",
      props: '{"kind":"whole","format":"dg-modern"}',
      actions: 2,
    },
    {
      day: "2026-10-03",
      version: "1.0.0",
      track: "stable",
      event: "surface_shown",
      props: '{"surface":"board"}',
      actions: 3,
    },
    // A build that was never published is a row of its own, so a reader can leave it out.
    {
      day: "2026-10-03",
      version: "0.9.0",
      track: "stable",
      event: "surface_shown",
      props: '{"surface":"board"}',
      actions: 1,
    },
    {
      day: "2026-10-03",
      version: "1.0.1-beta.1",
      track: "beta",
      event: "app_launched",
      props: "{}",
      actions: 1,
    },
    {
      day: "2026-10-04",
      version: "1.0.0",
      track: "stable",
      event: "app_launched",
      props: "{}",
      actions: 5,
    },
    {
      day: "2026-10-04",
      version: "1.0.0",
      track: "stable",
      event: "surface_shown",
      props: '{"surface":"board"}',
      actions: 4,
    },
  ]);
  // The end day is exclusive, and a day with no count has no row: absent, never a zero the service wrote.
  expect(
    query("usage-by-day", "2026-10-03", "2026-10-04").every((r) => r.day === "2026-10-03"),
  ).toBe(true);
  expect(query("usage-by-day", "2026-10-05", "2026-10-06")).toEqual([]);
  expect(query("launches-by-day", "2026-10-03", "2026-10-05")).toEqual([
    {
      day: "2026-10-03",
      version: "1.0.1-beta.1",
      track: "beta",
      channel: "developer-id",
      arch: "aarch64",
      os: "26.0",
      launches: 1,
    },
    {
      day: "2026-10-03",
      version: "1.0.0",
      track: "stable",
      channel: "developer-id",
      arch: "x86_64",
      os: "14.7",
      launches: 2,
    },
    {
      day: "2026-10-03",
      version: "1.0.0",
      track: "stable",
      channel: "developer-id",
      arch: "aarch64",
      os: "15.6",
      launches: 7,
    },
    {
      day: "2026-10-04",
      version: "1.0.0",
      track: "stable",
      channel: "developer-id",
      arch: "aarch64",
      os: "15.6",
      launches: 5,
    },
  ]);
  // Only launches: no other event's count is ever read as one.
  expect(
    query("launches-by-day", "2026-10-03", "2026-10-05").reduce(
      (n, r) => n + (r.launches as number),
      0,
    ),
  ).toBe(15);
});
test("feedback counts and receipts hold no words; the private list pages completed days without repeating a cursor", () => {
  feedback("a", "Private words", "writer@example.org", "Details", "2026-09-17");
  feedback("b", "More words", null, null, "2026-09-17", "1.0.1-beta.2");
  feedback("c", "Arrived today", null, null, "2026-09-18", "1.0.0");
  expect(query("feedback-counts", "2026-09-17", "2026-09-18")).toEqual([
    { day: "2026-09-17", messages: 2 },
  ]);
  const receipts = query("feedback-receipts", "2026-09-17", "2026-09-19");
  expect(receipts).toEqual([
    { day: "2026-09-17", id: "a", characters: 13, with_email: 1, with_details: 1, version: null },
    {
      day: "2026-09-17",
      id: "b",
      characters: 10,
      with_email: 0,
      with_details: 0,
      version: "1.0.1-beta.2",
    },
    {
      day: "2026-09-18",
      id: "c",
      characters: 13,
      with_email: 0,
      with_details: 0,
      version: "1.0.0",
    },
  ]);
  expect(JSON.stringify(receipts)).not.toMatch(/words|writer@|Details|Arrived/);
  expect(query("feedback-list", "", "", "2026-09-18")).toEqual([
    {
      id: "a",
      received_day: "2026-09-17",
      message: "Private words",
      email: "writer@example.org",
      details: "Details",
    },
    { id: "b", received_day: "2026-09-17", message: "More words", email: null, details: null },
  ]);
  expect(query("feedback-list", "2026-09-17", "a", "2026-09-18").map((r) => r.id)).toEqual(["b"]);
  expect(query("feedback-list", "2026-09-17", "b", "2026-09-18")).toHaveLength(0);
  expect(query("feedback-list", "2026-09-17", "b", "2026-09-19").map((r) => r.id)).toEqual(["c"]);
  expect(
    query("daily-volume", "2026-09-17", "2026-09-18").find((r) => r.metric === "feedback")?.total,
  ).toBe(2);
  db.exec("PRAGMA query_only = ON");
  const bindings = (name: string) =>
    name === "feedback-list"
      ? ["", "", "2026-09-18"]
      : ["copies-by-version", "feedback-by-version"].includes(name)
        ? ["2026-09-17", "2026-09-18", "1.0.0"]
        : ["2026-09-17", "2026-09-18"];
  for (const [name, sql] of queries)
    expect(() => db.query(sql).all(...bindings(name))).not.toThrow();
});
test("a build's copies and feedback for a release's clock, by SQLite's bindings and by the literals the readers write (docs/engineering/services-and-feedback.md#SERV-280)", () => {
  const own = new Database(":memory:");
  for (const name of [
    "0001_updates.sql",
    "0002_feedback.sql",
    "0004_feedback_list.sql",
    "0007_feedback_version.sql",
  ])
    own.exec(
      require("node:fs").readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    );
  const beta = "1.0.2-beta.1";
  const check = (day: string, version: string, os: string, count: number) =>
    own.run("INSERT INTO update_counts VALUES (?, 'check', 'darwin', 'aarch64', ?, ?, ?)", [
      day,
      version,
      os,
      count,
    ]);
  // Both readers' ways of asking: SQLite's own bindings, and bound()'s literals.
  const ask = (name: string, from: string, until: string) => {
    const w = window(beta, from, until);
    const days = [
      from.slice(0, 10),
      new Date(Date.parse(until) - 1 + 86_400_000).toISOString().slice(0, 10),
    ];
    const byBinding = own.query(queries.get(name)!).all(days[0], days[1], beta);
    const byLiteral = own.query(bound(queries.get(name)!, w)).all();
    expect(byLiteral).toEqual(byBinding);
    return byBinding as Record<string, unknown>[];
  };
  // No check counted at all those days: the counts are missing, not zero.
  expect(ask("copies-by-version", "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z")).toEqual([
    { copies: null },
  ]);
  // Checks from other versions only: none from this one.
  check("2026-10-01", "1.0.1", "26.0", 40);
  expect(ask("copies-by-version", "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z")).toEqual([
    { copies: 0 },
  ]);
  // Each day's checks summed across systems; the busiest day of the window.
  check("2026-10-01", beta, "26.0", 3);
  check("2026-10-01", beta, "15.6", 2);
  check("2026-10-02", beta, "26.0", 4);
  check("2026-10-03", beta, "26.0", 9);
  expect(ask("copies-by-version", "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z")).toEqual([
    { copies: 5 },
  ]);
  expect(ask("copies-by-version", "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z")).toEqual([
    { copies: 4 },
  ]);
  // Feedback: the ids from copies on the version, those days, and no words.
  const message = (id: string, day: string, version: string | null) =>
    own.run(
      "INSERT INTO feedback_messages (id, message, email, details, received_day, version) VALUES (?, 'Private words', NULL, NULL, ?, ?)",
      [id, day, version],
    );
  message("a", "2026-10-01", beta);
  message("b", "2026-10-02", beta);
  message("c", "2026-10-02", "1.0.1");
  message("d", "2026-10-02", null);
  message("e", "2026-10-03", beta);
  const ids = ask("feedback-by-version", "2026-10-01T14:00:00Z", "2026-10-02T14:00:00Z");
  expect(ids).toEqual([{ id: "a" }, { id: "b" }]);
  expect(JSON.stringify(ids)).not.toContain("Private");
});
