// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  feedback,
  expireFeedback,
  FEEDBACK,
  MAX_BODY,
  type FeedbackEnv,
  type Message,
} from "../src/feedback";
const migrations = await Promise.all(
  ["0002_feedback.sql", "0004_feedback_list.sql", "0007_feedback_version.sql"].map((name) =>
    Bun.file(new URL(`../migrations/${name}`, import.meta.url)).text(),
  ),
);
const message = (): Message => ({
  id: "f17cbfa4-3761-44e4-b4cf-ff6c2537960f",
  message: "I wish the binder remembered its width",
});
function fixture() {
  const db = new Database(":memory:");
  for (const migration of migrations) db.exec(migration);
  const env: FeedbackEnv = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: (string | number | null)[]) {
            return {
              async run() {
                const result = db.query(sql).run(...args);
                return { success: true, meta: { changes: result.changes } };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
    FEEDBACK_ENABLED: "true",
    FEEDBACK_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
  };
  const deps = { now: () => new Date("2026-09-18T12:00:00Z") };
  const request = (body: unknown) =>
    new Request(`${FEEDBACK}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" },
      body: JSON.stringify(body),
    });
  return {
    db,
    env,
    deps,
    request,
    run: (body: unknown = message()) => feedback(request(body), env, deps),
  };
}
test("confirmed receipt is durable, deduplicated, and stores only submitted fields and day", async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) {
    const r = await f.run();
    expect(r.status).toBe(201);
    expect(JSON.parse(await r.text())).toEqual({ id: message().id });
  }
  expect(f.db.query("SELECT * FROM feedback_messages").all()).toEqual([
    { ...message(), email: null, details: null, received_day: "2026-09-18", version: null },
  ]);
});
test("a message may say the whole build version it came from, stored with it (docs/engineering/services-and-feedback.md#SERV-273)", async () => {
  const f = fixture();
  const ids = [
    "0b6f35d4-5d0f-4c8e-9a41-6a3d2b1c0e11",
    "1c7a46e5-6e1a-4d9f-8b52-7b4e3c2d1f22",
    "2d8b57f6-7f2b-4eaf-9c63-8c5f4d3e2a33",
  ];
  for (const [i, version] of ["1.0.1-beta.2", "1.0.0", "1.0.2-alpha.573"].entries())
    expect((await f.run({ ...message(), id: ids[i], version })).status).toBe(201);
  expect(
    f.db
      .query("SELECT id, version FROM feedback_messages WHERE version IS NOT NULL ORDER BY id")
      .all(),
  ).toEqual([
    { id: ids[0], version: "1.0.1-beta.2" },
    { id: ids[1], version: "1.0.0" },
    { id: ids[2], version: "1.0.2-alpha.573" },
  ]);
  // Not a build's version: refused with a reason, and nothing stored.
  for (const version of ["1.0", "1.0.1-rc.1", "1.0.1-beta.02", " 1.0.1", 101, null])
    expect((await f.run({ ...message(), version })).status, String(version)).toBe(400);
  expect(f.db.query("SELECT * FROM feedback_messages").all()).toHaveLength(3);
});
test("failed storage never confirms", async () => {
  const f = fixture();
  f.db.close();
  expect((await f.run()).status).toBe(503);
});
test("feedback is a list, never an email: no email API, binding or address anywhere in the Worker", async () => {
  const glob = new Bun.Glob("src/**/*.ts");
  let scanned = 0;
  for await (const file of glob.scan({ cwd: new URL("..", import.meta.url).pathname })) {
    const source = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
    expect(source).not.toMatch(/cloudflare:email|EmailMessage|SendEmail|send_email/);
    scanned++;
  }
  expect(scanned).toBeGreaterThanOrEqual(7);
  for (const config of ["wrangler.jsonc", "wrangler.local.jsonc", "wrangler.standin.jsonc"]) {
    expect(await Bun.file(new URL(`../${config}`, import.meta.url)).text()).not.toMatch(
      /send_email|NOTICE/,
    );
  }
});
test("refuses unknown fields, malformed email and oversize characters without storage", async () => {
  const f = fixture();
  for (const extra of [
    { message: " " },
    { message: "x".repeat(10_001) },
    { email: "bad" },
    { email: "a@b.c\r\nBcc: x@y.z" },
    { appVersion: "0.9.0" },
    { details: "x".repeat(65537) },
    { id: "other" },
  ])
    expect((await f.run({ ...message(), ...extra })).status).toBe(400);
  expect(f.db.query("SELECT * FROM feedback_messages").all()).toEqual([]);
  expect(
    (
      await f.run({
        ...message(),
        message: "👩🏽‍💻".repeat(10_000),
        email: "writer@example.org",
        details: "Exactly what was reviewed.",
      })
    ).status,
  ).toBe(201);
});
test("caps the body before reading it, including unknown content lengths", async () => {
  const f = fixture();
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(8));
      },
    },
    { highWaterMark: 0 },
  );
  const r = new Request(`${FEEDBACK}/v1/messages`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", "Content-Length": String(MAX_BODY + 1) },
  });
  expect((await feedback(r, f.env, f.deps)).status).toBe(413);
  expect(pulled).toBe(0);
  expect((await f.run({ ...message(), message: "x".repeat(MAX_BODY) })).status).toBe(413);
});
test("feedback has a switch, a rate limit, and no public listing", async () => {
  const f = fixture();
  f.env.FEEDBACK_ENABLED = "false";
  expect((await f.run()).status).toBe(503);
  f.env.FEEDBACK_ENABLED = "true";
  f.env.FEEDBACK_LIMIT = {
    async limit() {
      return { success: false };
    },
  };
  expect((await f.run()).status).toBe(429);
  for (const path of ["/v1/messages", "/admin", "/v1/messages?all=1"])
    expect((await feedback(new Request(FEEDBACK + path), f.env, f.deps)).status).toBe(404);
});
test("the private inbox expires messages after a year", async () => {
  const f = fixture();
  await f.run();
  await expireFeedback(f.env.DB, new Date("2027-09-18T12:00:00Z"));
  expect(f.db.query("SELECT * FROM feedback_messages").all()).toHaveLength(1);
  await expireFeedback(f.env.DB, new Date("2027-09-19T12:00:00Z"));
  expect(f.db.query("SELECT * FROM feedback_messages").all()).toHaveLength(0);
});
