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
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { GITHUB, UPDATES } from "../src/updates";
import { admissionList, bucket } from "./lists";
mock.module("cloudflare:sockets", () => ({
  connect() {
    throw new Error("No socket in this test");
  },
}));
const { default: worker } = await import("../src/index");
const { REPORTS } = await import("../src/reports");
const migrations = await Promise.all(
  ["0001_updates.sql", "0003_usage.sql", "0006_usage_track.sql"].map((f) =>
    Bun.file(new URL(`../migrations/${f}`, import.meta.url)).text(),
  ),
);

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

function env(objects = new Map<string, string>()) {
  const db = new Database(":memory:");
  for (const sql of migrations) db.exec(sql);
  const allow = {
    async limit() {
      return { success: true };
    },
  };
  return {
    db,
    objects,
    env: {
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: string[]) {
              return {
                sql,
                args,
                async run() {
                  db.query(sql).run(...args);
                  return { success: true };
                },
              };
            },
          };
        },
        async batch(statements: { sql: string; args: string[] }[]) {
          return db.transaction(() =>
            statements.map((s) => {
              db.query(s.sql).run(...s.args);
              return { success: true };
            }),
          )();
        },
      },
      UPDATE_LIMIT: allow,
      DOWNLOAD_LIMIT: allow,
      EVENTS_LIMIT: allow,
      UPDATES_ENABLED: "true",
      DOWNLOADS_ENABLED: "true",
      EVENTS_ENABLED: "true",
      RELEASED_VERSIONS_JSON: '["0.9.0","1.0.0"]',
      TRACKS: bucket(objects),
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
  test("the entry reads the admission list at the bucket's root, and says one it cannot read on the error console alone", async () => {
    const said = spyOn(console, "error").mockImplementation(() => {});
    const logged = spyOn(console, "log");
    try {
      // A stand-in's keys are not production's.
      const standIn = env(new Map([["stand-in/admission.json", admissionList(["1.0.1"])]]));
      cache.clear();
      expect((await worker.fetch(get("/v1/darwin/aarch64/1.0.1"), standIn.env)).status).toBe(400);
      const root = env(new Map([["admission.json", admissionList(["1.0.1"])]]));
      cache.clear();
      expect((await worker.fetch(get("/v1/darwin/aarch64/1.0.1"), root.env)).status).toBe(200);
      expect(said).not.toHaveBeenCalled();
      // Not a list: said once, on the error console, with nothing of the request in it.
      const broken = env(new Map([["admission.json", "{ not a list"]]));
      cache.clear();
      expect((await worker.fetch(get("/v1/darwin/aarch64/1.0.1"), broken.env)).status).toBe(400);
      expect((await worker.fetch(get("/v1/darwin/aarch64/1.0.0"), broken.env)).status).toBe(200);
      expect(said.mock.calls).toEqual([
        ["admission.json is not an admission list: nothing is admitted or halted by it"],
      ]);
      expect(logged).not.toHaveBeenCalled();
    } finally {
      said.mockRestore();
      logged.mockRestore();
    }
  });
  test("a halt through the entry: GitHub's newest release is not offered, and the updater is not sent to GitHub for it", async () => {
    const f = env(
      new Map([["admission.json", admissionList([], [{ version: "1.0.0", track: "stable" }])]]),
    );
    cache.clear();
    upstream.length = 0;
    // The release before it is asked for; this GitHub answers it with the halted one's manifest,
    // which is refused, so the answer is that there is nothing newer.
    const r = await worker.fetch(get("/v1/darwin/aarch64/0.9.0"), f.env);
    expect(r.status).toBe(204);
    expect(upstream).toEqual([
      `${GITHUB}/latest/download/latest.json`,
      `${GITHUB}/download/v0.9.0/latest.json`,
    ]);
    expect((await worker.fetch(get(`/v1/download/v1.0.0/${archive}`), f.env)).status).toBe(404);
  });
  test("a published beta's usage counts through the entry are counted apart", async () => {
    const f = env(new Map([["beta/versions.json", JSON.stringify(["1.0.1-beta.1"])]]));
    cache.clear();
    const batch = (version: string) =>
      new Request(`${REPORTS}/v1/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version,
          platform: "darwin",
          arch: "aarch64",
          os: "26.0",
          channel: "developer-id",
          events: [{ name: "app_launched", props: {} }],
        }),
      });
    expect((await worker.fetch(batch("1.0.1-beta.1"), f.env)).status).toBe(204);
    expect((await worker.fetch(batch("1.0.0"), f.env)).status).toBe(204);
    expect((await worker.fetch(batch("1.0.1-beta.2"), f.env)).status).toBe(400);
    expect(f.db.query("SELECT version, track FROM usage_counts ORDER BY version").all()).toEqual([
      { version: "1.0.0", track: "stable" },
      { version: "1.0.1-beta.1", track: "beta" },
    ]);
  });
});
