// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { crashes, parseEnvelope, CRASH_PATH, MAX_CRASH_BODY, type CrashEnv } from "../src/crashes";
import { forward, type Connect } from "../src/sentry-forward";
import { REPORTS } from "../src/reports";
const encoder = new TextEncoder();
const sample = await Bun.file(new URL("./fixtures/crash.envelope", import.meta.url)).text();
const now = new Date("2026-09-18T23:00:00Z");
const env: CrashEnv = {
  CRASHES_ENABLED: "true",
  CRASH_LIMIT: {
    async limit() {
      return { success: true };
    },
  },
  RELEASED_VERSIONS_JSON: '["1.0.0"]',
  SENTRY_DSN: `https://${"a".repeat(32)}@o123.ingest.us.sentry.io/123456`,
};
interface TestEvent extends Record<string, unknown> {
  timestamp: number;
  release: string;
  platform?: string;
  tags: Record<string, string>;
  exception: {
    values: Array<{
      type: string;
      stacktrace: { frames: Array<Record<string, unknown>> };
      [key: string]: unknown;
    }>;
  };
}
function altered(change: (event: TestEvent) => void): Uint8Array {
  const lines = sample.trim().split("\n"),
    event = JSON.parse(lines[2]);
  change(event);
  const body = JSON.stringify(event);
  return encoder.encode(
    `${lines[0]}\n${JSON.stringify({ type: "event", length: encoder.encode(body).length })}\n${body}\n`,
  );
}
function request(body: Uint8Array = encoder.encode(sample)): Request {
  return new Request(REPORTS + CRASH_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "CF-Connecting-IP": "192.0.2.123",
      "X-Forwarded-For": "192.0.2.234",
      Cookie: "secret",
    },
    body,
  });
}
test("the real Rust SDK fixture is accepted; native protocol defaults are accepted too", () => {
  expect(parseEnvelope(encoder.encode(sample), env, now)).toEqual(encoder.encode(sample));
  const native = altered((e) => {
    delete e.platform;
    e.exception.values[0].type = "RustPanic";
    e.exception.values[0].stacktrace.frames = [
      { module: "native", function: "proscenium_lib::vault::save", lineno: 12 },
    ];
  });
  expect(() => parseEnvelope(native, env, now)).not.toThrow();
});
test("every message, path, dump, identity, source or metadata extension is refused", () => {
  for (const key of [
    "message",
    "logentry",
    "user",
    "request",
    "breadcrumbs",
    "contexts",
    "extra",
    "threads",
    "debug_meta",
    "sdk",
    "server_name",
    "transaction",
    "fingerprint",
  ])
    expect(() =>
      parseEnvelope(
        altered((e) => {
          e[key] = "Secret";
        }),
        env,
        now,
      ),
    ).toThrow();
  for (const key of ["value", "mechanism", "thread_id"])
    expect(() =>
      parseEnvelope(
        altered((e) => {
          e.exception.values[0][key] = "Secret";
        }),
        env,
        now,
      ),
    ).toThrow();
  for (const key of [
    "filename",
    "abs_path",
    "vars",
    "context_line",
    "pre_context",
    "post_context",
    "instruction_addr",
    "image_addr",
    "symbol",
    "function",
  ])
    expect(() =>
      parseEnvelope(
        altered((e) => {
          e.exception.values[0].stacktrace.frames[0][key] = "Secret";
        }),
        env,
        now,
      ),
    ).toThrow();
  for (const type of ["attachment", "minidump", "transaction", "session"])
    expect(() =>
      parseEnvelope(encoder.encode(sample.replace('"type":"event"', `"type":"${type}"`)), env, now),
    ).toThrow();
  expect(() => parseEnvelope(encoder.encode(sample + "{}\n"), env, now)).toThrow();
  for (const change of [
    (e: TestEvent) => e.timestamp++,
    (e: TestEvent) => (e.release = "4.0.0"),
    (e: TestEvent) => (e.tags.os = "15.6.1"),
    (e: TestEvent) => (e.exception.values[0].type = "Secret"),
    (e: TestEvent) => (e.exception.values[0].stacktrace.frames = []),
    (e: TestEvent) => (e.exception.values[0].stacktrace.frames[0].lineno = -1),
  ])
    expect(() => parseEnvelope(altered(change), env, now)).toThrow();
});
function connection(status = 200) {
  const chunks: Uint8Array[] = [];
  let closed = 0;
  const destinations: unknown[] = [];
  const connect: Connect = (address, options) => {
    destinations.push({ address, options });
    return {
      opened: Promise.resolve(),
      writable: new WritableStream({
        write(bytes) {
          chunks.push(bytes);
        },
      }),
      readable: new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode(`HTTP/1.1 ${status} Result\r\nContent-Length: 0\r\n\r\n`));
          c.close();
        },
      }),
      async close() {
        closed++;
      },
    };
  };
  return {
    connect,
    destinations,
    text: () => chunks.map((b) => new TextDecoder().decode(b)).join(""),
    closed: () => closed,
  };
}
test("Sentry receives an explicit TLS request with no visitor address or forwarding header", async () => {
  const f = connection();
  const r = await crashes(request(), env, now, (bytes, dsn) => forward(bytes, dsn, f.connect));
  expect(r.status).toBe(204);
  expect(f.destinations).toEqual([
    {
      address: { hostname: "o123.ingest.us.sentry.io", port: 443 },
      options: { secureTransport: "on" },
    },
  ]);
  const text = f.text(),
    head = text.split("\r\n\r\n")[0];
  expect(
    head
      .split("\r\n")
      .slice(1)
      .map((s) => s.split(":")[0].toLowerCase()),
  ).toEqual(["host", "content-type", "content-length", "x-sentry-auth", "connection"]);
  expect(text.endsWith(sample)).toBe(true);
  for (const leak of [
    "192.0.2.",
    "secret",
    "cookie",
    "forwarded",
    "cf-connecting",
    "user-agent",
    "referer",
  ])
    expect(text.toLowerCase()).not.toContain(leak);
  expect(f.closed()).toBe(1);
});
test("no redirects, arbitrary hosts or project routes can receive a crash", async () => {
  let sends = 0;
  const send = async () => {
    sends++;
    return 200;
  };
  expect(
    (
      await crashes(
        new Request(REPORTS + "/api/other/envelope/", { method: "POST" }),
        env,
        now,
        send,
      )
    ).status,
  ).toBe(404);
  expect(sends).toBe(0);
  const f = connection();
  for (const dsn of [
    "https://example.org/123",
    env.SENTRY_DSN + "?secret=1",
    env.SENTRY_DSN.replace(".sentry.io", ".sentry.io.evil.org"),
  ])
    await expect(forward(encoder.encode(sample), dsn, f.connect)).rejects.toThrow();
  expect(f.destinations).toHaveLength(0);
  for (const [status, result] of [
    [302, 503],
    [429, 429],
    [500, 503],
    [400, 400],
  ])
    expect((await crashes(request(), env, now, () => Promise.resolve(status))).status).toBe(result);
});
test("crashes have unread body caps, consent-independent edge switches and rate limits", async () => {
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
  const r = new Request(REPORTS + CRASH_PATH, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "Content-Length": String(MAX_CRASH_BODY + 1),
    },
  });
  expect((await crashes(r, env, now, async () => 200)).status).toBe(413);
  expect(pulls).toBe(0);
  expect(
    (await crashes(request(), { ...env, CRASHES_ENABLED: "false" }, now, async () => 200)).status,
  ).toBe(503);
  expect(
    (
      await crashes(
        request(),
        {
          ...env,
          CRASH_LIMIT: {
            async limit() {
              return { success: false };
            },
          },
        },
        now,
        async () => 200,
      )
    ).status,
  ).toBe(429);
});
