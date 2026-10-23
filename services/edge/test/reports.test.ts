// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { counts, expireCounts, REPORTS, MAX_EVENTS_BODY, type ReportsEnv } from "../src/reports";
import schema from "../events.json";
import { GO, links } from "../src/links";
import { admissionList, lists } from "./lists";
const now = new Date("2026-09-18T12:34:56Z");
const migrations = await Promise.all(
  ["0001_updates.sql", "0003_usage.sql", "0006_usage_track.sql"].map((f) =>
    Bun.file(new URL(`../migrations/${f}`, import.meta.url)).text(),
  ),
);
const launch = { name: "app_launched", props: {} };
const batch = () => ({
  version: "1.0.0",
  platform: "darwin",
  arch: "aarch64",
  os: "15.6",
  channel: "developer-id",
  events: [launch],
});
function fixture() {
  const db = new Database(":memory:");
  for (const sql of migrations) db.exec(sql);
  const env: ReportsEnv = {
    EVENTS_ENABLED: "true",
    RELEASED_VERSIONS_JSON: '["0.9.0","1.0.0"]',
    EVENTS_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: (string | number)[]) {
            return { sql, args };
          },
        };
      },
      async batch(statements: { sql: string; args: (string | number)[] }[]) {
        return db.transaction(() =>
          statements.map((s) => {
            const result = db.query(s.sql).run(...s.args);
            return { success: true, meta: { changes: result.changes } };
          }),
        )();
      },
    } as unknown as D1Database,
  };
  const request = (body: unknown) =>
    new Request(`${REPORTS}/v1/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.123",
        Cookie: "secret",
      },
      body: JSON.stringify(body),
    });
  // A published beta, and alpha's list, as the pipeline writes them to R2.
  const r2 = lists(
    new Map([
      ["beta/versions.json", JSON.stringify(["1.0.1-beta.1", "1.0.1-beta.2"])],
      ["alpha/versions.json", JSON.stringify(["1.0.1-alpha.57"])],
    ]),
  );
  return {
    db,
    env,
    request,
    ...r2,
    run: (body: unknown = batch()) => counts(request(body), env, now, r2.source),
  };
}
const rows = (f: ReturnType<typeof fixture>) =>
  f.db.query("SELECT version, track, event, count FROM usage_counts ORDER BY version, event").all();
test("batches become daily totals, with no request, address, session or precise time", async () => {
  const f = fixture();
  const body = {
    ...batch(),
    events: [launch, launch, { name: "pdf_exported", props: { kind: "sides", format: "user" } }],
  };
  expect((await f.run(body)).status).toBe(204);
  expect((await f.run(body)).status).toBe(204);
  expect(f.db.query("SELECT * FROM usage_counts ORDER BY event").all()).toEqual([
    {
      day: "2026-09-18",
      version: "1.0.0",
      platform: "darwin",
      arch: "aarch64",
      os: "15.6",
      channel: "developer-id",
      event: "app_launched",
      props: "{}",
      count: 4,
      track: "stable",
    },
    {
      day: "2026-09-18",
      version: "1.0.0",
      platform: "darwin",
      arch: "aarch64",
      os: "15.6",
      channel: "developer-id",
      event: "pdf_exported",
      props: '{"format":"user","kind":"sides"}',
      count: 2,
      track: "stable",
    },
  ]);
});
test("one unknown name, property, value or dimension refuses the entire batch", async () => {
  const f = fixture();
  for (const event of [
    { name: "crash_reported", props: {} },
    { name: "app_launched", props: { channel: "developer-id" } },
    { name: "error_shown", props: { code: "Secret" } },
    { name: "pdf_exported", props: { kind: "sides", format: "Secret" } },
    { name: "update_installed", props: { from: "0.0.1", to: "1.0.0" } },
    { ...launch, timestamp: 123 },
  ])
    expect((await f.run({ ...batch(), events: [launch, event] })).status).toBe(400);
  for (const extra of [
    { version: "4.0.0" },
    { os: "15.6.1" },
    { platform: "linux" },
    // Windows with a Mac's version, and a Mac with Windows': each system's own, or nothing.
    { platform: "windows" },
    { os: "10.0.26100" },
    { platform: "windows", os: "10.0.19044" },
    { platform: "windows", os: "10.0.26100.4652" },
    { arch: "arm64" },
    { channel: "Secret" },
    { sessionId: "secret" },
    { events: [] },
    { events: Array(26).fill(launch) },
  ])
    expect((await f.run({ ...batch(), ...extra })).status).toBe(400);
  expect(f.db.query("SELECT * FROM usage_counts").all()).toEqual([]);
});
test("a Windows copy's batch is taken, with Windows' version and build, and counted apart by its platform (docs/engineering/services-and-feedback.md#SERV-282)", async () => {
  const f = fixture();
  for (const [arch, os, channel] of [
    ["x86_64", "10.0.19045", "download"],
    ["aarch64", "10.0.26100", "microsoft-store"],
  ])
    expect((await f.run({ ...batch(), platform: "windows", arch, os, channel })).status).toBe(204);
  expect((await f.run(batch())).status).toBe(204);
  expect(
    f.db
      .query(
        "SELECT platform, arch, os, channel, track, count FROM usage_counts ORDER BY platform, arch",
      )
      .all(),
  ).toEqual([
    {
      platform: "darwin",
      arch: "aarch64",
      os: "15.6",
      channel: "developer-id",
      track: "stable",
      count: 1,
    },
    {
      platform: "windows",
      arch: "aarch64",
      os: "10.0.26100",
      channel: "microsoft-store",
      track: "stable",
      count: 1,
    },
    {
      platform: "windows",
      arch: "x86_64",
      os: "10.0.19045",
      channel: "download",
      track: "stable",
      count: 1,
    },
  ]);
  // Each system's channels are its own: a Mac's from Windows, or Windows' from a Mac, refuse the batch.
  const windows = { platform: "windows", os: "10.0.26100" };
  for (const body of [
    { ...batch(), ...windows, channel: "developer-id" },
    { ...batch(), ...windows, channel: "app-store" },
    { ...batch(), channel: "download" },
    { ...batch(), channel: "microsoft-store" },
  ])
    expect((await f.run(body)).status, JSON.stringify(body)).toBe(400);
});
test("an active copy is one more in its period's daily total, and nothing in a batch tells two copies apart (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-86)", async () => {
  const f = fixture();
  const active = (period: string, installed: string) => ({
    name: "copy_active",
    props: { period, installed },
  });
  // Two copies' first launch of the day, week and month, and a third's day alone.
  for (const installed of ["new", "earlier"])
    expect(
      (
        await f.run({
          ...batch(),
          events: [
            launch,
            active("day", installed),
            active("week", installed),
            active("month", installed),
          ],
        })
      ).status,
    ).toBe(204);
  expect((await f.run({ ...batch(), events: [active("day", "recent")] })).status).toBe(204);
  expect(
    f.db
      .query("SELECT props, count FROM usage_counts WHERE event = 'copy_active' ORDER BY props")
      .all(),
  ).toEqual([
    { props: '{"installed":"earlier","period":"day"}', count: 1 },
    { props: '{"installed":"earlier","period":"month"}', count: 1 },
    { props: '{"installed":"earlier","period":"week"}', count: 1 },
    { props: '{"installed":"new","period":"day"}', count: 1 },
    { props: '{"installed":"new","period":"month"}', count: 1 },
    { props: '{"installed":"new","period":"week"}', count: 1 },
    { props: '{"installed":"recent","period":"day"}', count: 1 },
  ]);
  // Nothing beside the two closed values: no id, day, first run or count of its own.
  for (const event of [
    { name: "copy_active", props: { period: "day" } },
    { name: "copy_active", props: { period: "year", installed: "new" } },
    { name: "copy_active", props: { period: "day", installed: "2026-10-01" } },
    { name: "copy_active", props: { period: "day", installed: "new", id: "a1b2" } },
    { name: "copy_active", props: { period: "day", installed: "new", day: "2026-10-16" } },
    { ...active("day", "new"), copy: "a1b2" },
  ])
    expect((await f.run({ ...batch(), events: [event] })).status, JSON.stringify(event)).toBe(400);
  // A copy counts itself once a period, so a batch carries one of each at most.
  expect(
    (await f.run({ ...batch(), events: [active("day", "new"), active("day", "earlier")] })).status,
  ).toBe(400);
  expect(
    (
      await f.run({
        ...batch(),
        events: [active("week", "new"), launch, active("week", "new")],
      })
    ).status,
  ).toBe(400);
  expect(
    f.db.query("SELECT SUM(count) AS n FROM usage_counts WHERE event = 'copy_active'").get(),
  ).toEqual({ n: 7 });
});
test("every published event and property is accepted, with transactional failure returning no receipt", async () => {
  const f = fixture();
  for (const [name, rule] of Object.entries(schema)) {
    const props = Object.fromEntries(
      Object.entries(rule.props).map(([key, values]) => [
        key,
        values[0] === "$released-version" ? "1.0.0" : values[0],
      ]),
    );
    expect((await f.run({ ...batch(), events: [{ name, props }] })).status).toBe(204);
  }
  f.db.close();
  expect((await f.run()).status).toBe(503);
});
test("counts enforce limits before reading, route switches, rates and bare 404s", async () => {
  const f = fixture();
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        pulls++;
        c.enqueue(new Uint8Array(1));
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(`${REPORTS}/v1/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(MAX_EVENTS_BODY + 1) },
    body,
  });
  expect((await counts(request, f.env, now, f.source)).status).toBe(413);
  expect(pulls).toBe(0);
  f.env.EVENTS_ENABLED = "false";
  expect((await f.run()).status).toBe(503);
  f.env.EVENTS_ENABLED = "true";
  f.env.EVENTS_LIMIT = {
    async limit() {
      return { success: false };
    },
  };
  expect((await f.run()).status).toBe(429);
  for (const path of ["/admin", "/v1/events", "/v1/events?all=1"]) {
    const r = await counts(new Request(REPORTS + path), f.env, now, f.source);
    expect(r.status).toBe(404);
    expect(await r.text()).toBe("");
  }
});
test("both kinds of daily counts expire after two years", async () => {
  const f = fixture();
  await f.run();
  f.db.run(
    "INSERT INTO update_counts VALUES ('2024-09-17','check','darwin','aarch64','0.9.0','14.6',1)",
  );
  await expireCounts(f.env.DB, new Date("2026-09-18T12:00:00Z"));
  expect(f.db.query("SELECT * FROM update_counts").all()).toHaveLength(0);
  await expireCounts(f.env.DB, new Date("2028-09-19T12:00:00Z"));
  expect(f.db.query("SELECT * FROM usage_counts").all()).toHaveLength(0);
});
test("a published beta's batches are counted apart by their whole version and track (docs/engineering/services-and-feedback.md#SERV-272)", async () => {
  const f = fixture();
  expect((await f.run({ ...batch(), version: "1.0.1-beta.2" })).status).toBe(204);
  expect((await f.run()).status).toBe(204);
  // A release the release admitted in R2 is a release's, with no deploy.
  expect((await f.run({ ...batch(), version: "1.0.1" })).status).toBe(400);
  f.objects.set("admission.json", admissionList(["1.0.1"]));
  f.cache.clear();
  expect((await f.run({ ...batch(), version: "1.0.1" })).status).toBe(204);
  expect(rows(f)).toEqual([
    { version: "1.0.0", track: "stable", event: "app_launched", count: 1 },
    { version: "1.0.1", track: "stable", event: "app_launched", count: 1 },
    { version: "1.0.1-beta.2", track: "beta", event: "app_launched", count: 1 },
  ]);
  // An unpublished beta's, an alpha's (published or not) and a local build's are refused whole.
  for (const version of ["1.0.1-beta.3", "1.0.1-alpha.57", "1.0.1-alpha.58", "1.0.2", "1.0.1-rc.1"])
    expect((await f.run({ ...batch(), version })).status, version).toBe(400);
  expect(rows(f)).toHaveLength(3);
});
test("a beta's version is no release: update_installed names releases alone", async () => {
  const f = fixture();
  const installed = (from: string, to: string) => ({
    ...batch(),
    events: [{ name: "update_installed", props: { from, to } }],
  });
  expect((await f.run(installed("0.9.0", "1.0.0"))).status).toBe(204);
  for (const [from, to] of [
    ["1.0.0", "1.0.1-beta.2"],
    ["1.0.1-beta.1", "1.0.1-beta.2"],
    ["0.9.0", "1.0.1"],
  ])
    expect((await f.run(installed(from, to))).status, `${from} to ${to}`).toBe(400);
  // A release the release admitted in R2 is one.
  f.objects.set("admission.json", admissionList(["1.0.1"]));
  f.cache.clear();
  expect((await f.run(installed("1.0.0", "1.0.1"))).status).toBe(204);
});
test("a list that cannot be read is the service's trouble: 503, and the app keeps the batch", async () => {
  const f = fixture();
  f.source.bucket = {
    async get() {
      throw new Error("R2 unavailable");
    },
  } as unknown as typeof f.source.bucket;
  expect((await f.run({ ...batch(), version: "1.0.1-beta.2" })).status).toBe(503);
  // A release on the deployed list needs no list from R2.
  expect((await f.run()).status).toBe(204);
  expect(rows(f)).toEqual([{ version: "1.0.0", track: "stable", event: "app_launched", count: 1 }]);
});
test("owned links redirect only the four documented names and released versions", async () => {
  const env = { LINKS_ENABLED: "true", RELEASED_VERSIONS_JSON: '["1.0.0"]' };
  const { source } = lists(
    new Map([
      // 1.0.1 admitted by the list the release writes, and halted: its page stays.
      ["admission.json", admissionList(["1.0.1"], [{ version: "1.0.1", track: "stable" }])],
      ["beta/versions.json", JSON.stringify(["1.0.2-beta.1"])],
    ]),
  );
  const go = (path: string, e = env) => links(new Request(GO + path), e, source);
  for (const [path, target] of [
    ["/releases", "https://github.com/proscenium-app/proscenium/releases"],
    ["/releases/v1.0.0", "https://github.com/proscenium-app/proscenium/releases/tag/v1.0.0"],
    ["/releases/v1.0.1", "https://github.com/proscenium-app/proscenium/releases/tag/v1.0.1"],
    // A beta has no release page, GitHub holds releases alone: its notes are the Guide's.
    ["/releases/v1.0.2-beta.1", "https://docs.proscenium.ink/whats-new#beta"],
    ["/license", "https://www.gnu.org/licenses/agpl-3.0.html"],
    ["/privacy", "https://proscenium.ink/privacy"],
    ["/support", "https://proscenium.ink/support"],
  ]) {
    const r = await go(path);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(target);
  }
  for (const path of ["/admin", "/releases/v2.0.0", "/releases/v1.0.2-beta.2", "/privacy?to=other"])
    expect((await go(path)).status).toBe(404);
  expect((await go("/license", { ...env, LINKS_ENABLED: "false" })).status).toBe(503);
});
test("a published beta's link opens its notes in the Guide, and no other track build has one (docs/engineering/services-and-feedback.md#SERV-281)", async () => {
  const env = { LINKS_ENABLED: "true", RELEASED_VERSIONS_JSON: '["1.0.0"]' };
  const { source, cache } = lists(
    new Map([
      ["beta/versions.json", JSON.stringify(["1.0.1-beta.1", "1.0.1-beta.2"])],
      ["alpha/versions.json", JSON.stringify(["1.0.1-alpha.57"])],
      // 1.0.1-beta.2 halted: it is no longer offered, and its notes stay.
      ["admission.json", admissionList([], [{ version: "1.0.1-beta.2", track: "beta" }])],
    ]),
  );
  const go = (path: string, e = env) => links(new Request(GO + path), e, source);
  // One address for every beta: the Guide's section is always the beta that is out.
  for (const version of ["1.0.1-beta.1", "1.0.1-beta.2"]) {
    const r = await go(`/releases/v${version}`);
    expect(r.status, version).toBe(302);
    expect(r.headers.get("Location"), version).toBe("https://docs.proscenium.ink/whats-new#beta");
    expect(r.headers.get("Referrer-Policy"), version).toBe("no-referrer");
  }
  // An unpublished beta, an alpha (published or not) and anything that is not a version are no link.
  for (const version of [
    "1.0.1-beta.3",
    "1.0.1-alpha.57",
    "1.0.1-alpha.58",
    "1.0.1-rc.1",
    "1.0.1-beta",
    "1.0.1-beta.2.1",
    "1.0.1-beta.2/x",
    "1.0.1-beta.2?to=other",
  ])
    expect((await go(`/releases/v${version}`)).status, version).toBe(404);
  const off = { ...env, LINKS_ENABLED: "false" };
  expect((await go("/releases/v1.0.1-beta.2", off)).status).toBe(503);
  // A list that cannot be read is the service's trouble, never a version that was not released.
  source.bucket = {
    async get() {
      throw new Error("R2 unavailable");
    },
  } as unknown as typeof source.bucket;
  cache.clear();
  expect((await go("/releases/v1.0.1-beta.2")).status).toBe(503);
  // A release on the deployed list needs no list from R2.
  expect((await go("/releases/v1.0.0")).status).toBe(302);
});
test("the separate website's privacy copy contains exactly the full public contract", async () => {
  const spec = await Bun.file(
    new URL("../../../docs/app/keeping-work/privacy-and-telemetry.md", import.meta.url),
  ).text();
  // The contract's copy carries requirement anchors, labels and an ids column
  // (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D7); the published copy is its prose.
  const section = spec
    .split("### Facts for the site and the store\n\n")[1]
    ?.split('\n<a id="PRIV-82"></a>')[0];
  expect(section).toBeDefined();
  const publicText = section!
    .replace(/<a id="[^"]+"><\/a>\n\n/g, "")
    .replace(/^(\s*- )<a id="[^"]+"><\/a> /gm, "$1")
    .replace(/\*\*PRIV-\d+\*\* /g, "")
    .replace(/^(\|.*)\|[^|]*\|$/gm, "$1|")
    .trimEnd();
  const copy = await Bun.file(new URL("../../../docs/site-privacy.md", import.meta.url)).text();
  expect(copy.trimEnd()).toBe("# Privacy\n\n" + publicText);
});
