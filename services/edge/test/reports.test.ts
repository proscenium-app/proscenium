// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { counts, expireCounts, REPORTS, MAX_EVENTS_BODY, type ReportsEnv } from "../src/reports";
import schema from "../events.json";
import { GO, links } from "../src/links";
const now = new Date("2026-09-18T12:34:56Z");
const migrations = await Promise.all(
  ["0001_updates.sql", "0003_usage.sql"].map((f) =>
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
  return { db, env, request, run: (body: unknown = batch()) => counts(request(body), env, now) };
}
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
    { platform: "windows" },
    { arch: "arm64" },
    { channel: "Secret" },
    { sessionId: "secret" },
    { events: [] },
    { events: Array(26).fill(launch) },
  ])
    expect((await f.run({ ...batch(), ...extra })).status).toBe(400);
  expect(f.db.query("SELECT * FROM usage_counts").all()).toEqual([]);
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
  expect((await counts(request, f.env, now)).status).toBe(413);
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
    const r = await counts(new Request(REPORTS + path), f.env, now);
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
test("owned links redirect only the four documented names and released versions", () => {
  const env = { LINKS_ENABLED: "true", RELEASED_VERSIONS_JSON: '["1.0.0"]' };
  for (const [path, target] of [
    ["/releases", "https://github.com/proscenium-app/proscenium/releases"],
    ["/releases/v1.0.0", "https://github.com/proscenium-app/proscenium/releases/tag/v1.0.0"],
    ["/license", "https://www.gnu.org/licenses/agpl-3.0.html"],
    ["/privacy", "https://proscenium.ink/privacy"],
    ["/support", "https://proscenium.ink/support"],
  ]) {
    const r = links(new Request(GO + path), env);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(target);
  }
  for (const path of ["/admin", "/releases/v2.0.0", "/privacy?to=other"])
    expect(links(new Request(GO + path), env).status).toBe(404);
  expect(links(new Request(GO + "/license"), { ...env, LINKS_ENABLED: "false" }).status).toBe(503);
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
