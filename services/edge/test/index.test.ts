// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The production entry as workerd calls it. workerd throws "Illegal
 * invocation" when fetch is called as a method of any object but the global,
 * and updates() answers that throw as 502, the updater's fallback signal: a
 * `{ fetch }` dependency turned every stable check and download into a 502
 * that looked like GitHub being down. Bun's fetch accepts any receiver, so the
 * global is replaced here by one that refuses the way workerd does.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { GITHUB, UPDATES } from "../src/updates";
mock.module("cloudflare:sockets", () => ({
  connect() {
    throw new Error("No socket in this test");
  },
}));
const { default: worker } = await import("../src/index");
const migration = await Bun.file(new URL("../migrations/0001_updates.sql", import.meta.url)).text();

const archive = "Proscenium_1.0.0_universal.app.tar.gz";
const manifest = {
  version: "1.0.0",
  pub_date: "2026-09-26T12:00:00Z",
  platforms: {
    "darwin-aarch64": { signature: "a".repeat(100), url: `${GITHUB}/download/v1.0.0/${archive}` },
    "darwin-x86_64": { signature: "a".repeat(100), url: `${GITHUB}/download/v1.0.0/${archive}` },
  },
};
const upstream: string[] = [];
/** The global fetch as workerd has it: callable bare, never as another object's method. */
function workerdFetch(this: unknown, input: RequestInfo | URL): Promise<Response> {
  if (this !== undefined && this !== globalThis)
    throw new TypeError("Illegal invocation: function called with incorrect this reference.");
  const url = new URL(input instanceof Request ? input.url : input);
  upstream.push(url.href);
  if (url.pathname.endsWith("/latest.json")) return Promise.resolve(Response.json(manifest));
  if (url.pathname.endsWith(`/v1.0.0/${archive}`))
    return Promise.resolve(new Response("signed archive"));
  return Promise.resolve(new Response(null, { status: 404 }));
}
const cache = new Map<string, Response>();
const saved = { fetch: globalThis.fetch, caches: Reflect.get(globalThis, "caches") };
beforeAll(() => {
  globalThis.fetch = workerdFetch as typeof fetch;
  Reflect.set(globalThis, "caches", {
    default: {
      async match(r: Request) {
        return cache.get(r.url)?.clone();
      },
      async put(r: Request, response: Response) {
        cache.set(r.url, response.clone());
      },
    },
  });
});
afterAll(() => {
  globalThis.fetch = saved.fetch;
  Reflect.set(globalThis, "caches", saved.caches);
});

function env() {
  const db = new Database(":memory:");
  db.exec(migration);
  const allow = {
    async limit() {
      return { success: true };
    },
  };
  return {
    db,
    env: {
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: string[]) {
              return {
                async run() {
                  db.query(sql).run(...args);
                  return { success: true };
                },
              };
            },
          };
        },
      },
      UPDATE_LIMIT: allow,
      DOWNLOAD_LIMIT: allow,
      UPDATES_ENABLED: "true",
      DOWNLOADS_ENABLED: "true",
      RELEASED_VERSIONS_JSON: '["0.9.0","1.0.0"]',
      TRACKS: {
        async get() {
          return null;
        },
      },
    } as unknown as Parameters<typeof worker.fetch>[1],
  };
}
const get = (path: string) =>
  new Request(`${UPDATES}${path}`, { headers: { "Proscenium-OS": "26.0" } });

describe("production entry", () => {
  test("the stand-in refuses fetch as a method, as workerd does", () => {
    expect(() =>
      ({ fetch: workerdFetch }).fetch(new Request(`${GITHUB}/latest/download/latest.json`)),
    ).toThrow("Illegal invocation");
  });
  test("a stable check reaches GitHub and answers the manifest on our own download route", async () => {
    const f = env();
    upstream.length = 0;
    cache.clear();
    for (const path of ["/v1/darwin/aarch64/1.0.0", "/v1/stable/darwin/x86_64/1.0.0"]) {
      const r = await worker.fetch(get(path), f.env);
      expect(r.status).toBe(200);
      const data = (await r.json()) as typeof manifest;
      expect(data.version).toBe("1.0.0");
      for (const p of Object.values(data.platforms))
        expect(p.url).toBe(`${UPDATES}/v1/download/v1.0.0/${archive}`);
    }
    expect(upstream).toEqual([`${GITHUB}/latest/download/latest.json`]);
    expect(
      f.db.query("SELECT kind, arch, version, os, count FROM update_counts ORDER BY arch").all(),
    ).toEqual([
      { kind: "check", arch: "aarch64", version: "1.0.0", os: "26.0", count: 1 },
      { kind: "check", arch: "x86_64", version: "1.0.0", os: "26.0", count: 1 },
    ]);
  });
  test("a stable download streams the release's archive from GitHub", async () => {
    const f = env();
    upstream.length = 0;
    cache.clear();
    const r = await worker.fetch(get(`/v1/download/v1.0.0/${archive}`), f.env);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("signed archive");
    expect(upstream).toEqual([
      `${GITHUB}/download/v1.0.0/latest.json`,
      `${GITHUB}/download/v1.0.0/${archive}`,
    ]);
  });
});
