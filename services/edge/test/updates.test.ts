// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { updates, GITHUB, UPDATES, TRACK_KEY_HEADER, parseManifest, parseTrackManifest, boundedBytes, trackOf, type Env, type Dependencies } from "../src/updates";
/** Alpha's key in these tests, and the hash the Worker holds as its secret. */
const KEY = "k".repeat(22) + "Ey_-0123456789abcdefg";
const KEY_SHA256 = createHash("sha256").update(KEY).digest("hex");
const keyed = { [TRACK_KEY_HEADER]: KEY };
const migration = await Bun.file(new URL("../migrations/0001_updates.sql", import.meta.url)).text();
const latest = () => ({ version: "0.9.1", notes: "A release.", pub_date: "2026-09-18T12:00:00Z", platforms: {
  "darwin-aarch64": { signature: "a".repeat(100), url: `${GITHUB}/download/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz` },
  "darwin-x86_64": { signature: "a".repeat(100), url: `${GITHUB}/download/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz` },
} });
/** A track's manifest, as the pipeline writes it to R2. */
const trackLatest = (track: string, version: string) => ({ version, notes: "Unreleased.", pub_date: "2026-09-22T20:00:00Z", platforms: {
  "darwin-aarch64": { signature: "b".repeat(100), url: `${UPDATES}/v1/${track}/download/v${version}/Proscenium_${version}_universal.app.tar.gz` },
  "darwin-x86_64": { signature: "b".repeat(100), url: `${UPDATES}/v1/${track}/download/v${version}/Proscenium_${version}_universal.app.tar.gz` },
} });
/** R2 as the Worker reads it: `get` and nothing else. */
function bucket(objects: Map<string, string>): Env["TRACKS"] {
  return { async get(key: string) {
    const text = objects.get(key);
    return text === undefined ? null : { body: new Response(text).body!, size: new TextEncoder().encode(text).byteLength };
  } } as unknown as Env["TRACKS"];
}
function fixture() {
  const db = new Database(":memory:"); db.exec(migration);
  const calls: Request[] = []; const cache = new Map<string, Response>();
  const objects = new Map<string, string>([
    ["alpha/versions.json", JSON.stringify(["1.0.1-alpha.56", "1.0.1-alpha.57", "1.0.1-alpha.58"])],
    ["alpha/latest.json", JSON.stringify(trackLatest("alpha", "1.0.1-alpha.58"))],
    ["alpha/1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz", "alpha archive"],
    ["alpha/1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz.sig", "alpha signature"],
    ["alpha/1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.dmg", "alpha disk image"],
  ]);
  const env: Env = {
    DB: { prepare(sql: string) { return { bind(...args: (string | number)[]) { return {
      async run() { db.query(sql).run(...args); return { success: true }; },
    }; } }; } } as unknown as D1Database,
    UPDATE_LIMIT: { async limit() { return { success: true }; } },
    DOWNLOAD_LIMIT: { async limit() { return { success: true }; } },
    UPDATES_ENABLED: "true", DOWNLOADS_ENABLED: "true", RELEASED_VERSIONS_JSON: '["0.9.0","0.9.1"]',
    TRACKS: bucket(objects),
    ALPHA_KEY_SHA256: KEY_SHA256,
  };
  const deps: Dependencies = {
    updatesOrigin: UPDATES, now: () => new Date("2026-09-18T12:34:56Z"),
    cache: {
      async match(r) { return cache.get(typeof r === "string" ? r : r instanceof URL ? r.href : r.url)?.clone(); },
      async put(r, response) { cache.set(typeof r === "string" ? r : r instanceof URL ? r.href : r.url, response.clone()); },
    },
    async fetch(r) { calls.push(r); return r.url.endsWith("latest.json") ? Response.json(latest()) : new Response("signed archive"); },
  };
  function request(path = "/v1/darwin/aarch64/0.9.0", headers: Record<string, string> = {}) {
    return new Request(`${UPDATES}${path}`, { headers: { "Proscenium-OS": "14.6", "CF-Connecting-IP": "192.0.2.100", "Cookie": "private", "X-Forwarded-For": "private", ...headers } });
  }
  return { env, deps, calls, db, cache, objects, request, run: (r = request()) => updates(r, env, deps) };
}
describe("update service", () => {
  test("counts checks by day and documented fields, never stores an address or supplies one in application headers", async () => {
    const f = fixture(); const first = await f.run(); const second = await f.run();
    expect(first.status).toBe(200); expect(second.status).toBe(200);
    const data = await first.json() as ReturnType<typeof latest>;
    for (const p of Object.values(data.platforms)) expect(p.url).toBe(`${UPDATES}/v1/download/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz`);
    expect(f.calls.length).toBe(1); expect([...f.calls[0].headers]).toEqual([]);
    const rows = f.db.query("SELECT * FROM update_counts").all();
    expect(rows).toEqual([{ day: "2026-09-18", kind: "check", platform: "darwin", arch: "aarch64", version: "0.9.0", os: "14.6", count: 2 }]);
    expect(JSON.stringify(rows)).not.toContain("192.0.2.100");
    expect(f.cache.values().next().value?.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
  test("streams only the release's own files and counts downloads by version", async () => {
    const f = fixture();
    for (const suffix of [".app.tar.gz", ".app.tar.gz.sig", ".dmg"]) {
      const r = await f.run(f.request(`/v1/download/v0.9.1/Proscenium_0.9.1_universal${suffix}`));
      expect(r.status).toBe(200); expect(await r.text()).toBe("signed archive"); expect(r.headers.has("Location")).toBe(false);
    }
    expect(f.db.query("SELECT count FROM update_counts WHERE kind = 'download'").get()).toEqual({ count: 3 });
    for (const path of ["/v1/download/v0.9.1/secret.txt", "/v1/download/v0.9.1/Proscenium_0.9.0_universal.dmg", "/v1/download/v8.8.8/Proscenium_8.8.8_universal.dmg"]) expect((await f.run(f.request(path))).status).toBe(404);
  });
  test("unknown paths, hosts and methods have a bare 404", async () => {
    const f = fixture();
    for (const r of [f.request("/admin"), f.request("/v1/windows/x86_64/0.9.0"), f.request("/v1/darwin/aarch64/0.9.0?secret=1"), new Request("https://evil.test/v1/darwin/aarch64/0.9.0"), new Request(f.request(), { method: "POST" })]) {
      const result = await f.run(r); expect(result.status).toBe(404); expect(await result.text()).toBe("");
    }
    expect(f.calls).toHaveLength(0);
  });
  test("unreleased versions and unbounded system fields are refused before upstream or storage", async () => {
    const f = fixture();
    for (const r of [f.request("/v1/darwin/aarch64/9.9.9"), f.request(undefined, { "Proscenium-OS": "14.6.1" }), f.request(undefined, { "Proscenium-OS": "my machine" })]) expect((await f.run(r)).status).toBe(400);
    expect(f.calls).toHaveLength(0); expect(f.db.query("SELECT * FROM update_counts").all()).toEqual([]);
  });
  test("each route has its own kill switch and rate limit", async () => {
    const f = fixture(); f.env.UPDATES_ENABLED = "false"; expect((await f.run()).status).toBe(503);
    f.env.UPDATES_ENABLED = "true"; f.env.UPDATE_LIMIT = { async limit() { return { success: false }; } }; expect((await f.run()).status).toBe(429);
    f.env.DOWNLOADS_ENABLED = "false"; expect((await f.run(f.request("/v1/download/v0.9.1/Proscenium_0.9.1_universal.dmg"))).status).toBe(503);
    expect(f.calls).toHaveLength(0);
  });
  test("GitHub failures and malformed manifests give 502 for the app's fallback", async () => {
    for (const fetch of [async () => new Response(null, { status: 404 }), async () => { throw new Error("secret"); }, async () => Response.json({ ...latest(), version: "9.9.9" }), async () => new Response("broken json")]) {
      const f = fixture(); f.deps.fetch = fetch; const result = await f.run(); expect(result.status).toBe(502); expect(await result.text()).toBe("");
    }
  });
  test("rejects off-repository manifests and redirects without contacting the target", async () => {
    const data = latest(); data.platforms["darwin-aarch64"].url = "https://evil.test/secret"; expect(() => parseManifest(data)).toThrow();
    for (const target of ["http://github.com/proscenium-app/proscenium/releases/file", "https://github.com/other/repo/releases/file", "https://evil.test/private", "https://user@release-assets.githubusercontent.com/private"]) {
      const f = fixture(); let calls = 0; f.deps.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { Location: target } }); };
      expect((await f.run()).status).toBe(502); expect(calls).toBe(1);
    }
  });
  test("GitHub asset redirects get fresh empty headers", async () => {
    const f = fixture(); const calls: Request[] = [];
    f.deps.fetch = async r => { calls.push(r); return calls.length === 1
      ? new Response(null, { status: 302, headers: { Location: "https://release-assets.githubusercontent.com/asset?signature=public", "Set-Cookie": "private" } }) : Response.json(latest()); };
    expect((await f.run()).status).toBe(200); expect(calls).toHaveLength(2); expect([...calls[1].headers]).toEqual([]);
  });
  test("oversized declared bodies are refused unread; chunked bodies are bounded", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(8)); } }, { highWaterMark: 0 });
    await expect(boundedBytes(new Response(body, { headers: { "Content-Length": "999" } }), 10)).rejects.toThrow(); expect(pulled).toBe(0);
    await expect(boundedBytes(new Response("this is too long"), 10)).rejects.toThrow();
  });
});

describe("update tracks (docs/engineering/services-and-feedback.md#SERV-245)", () => {
  test("a check on alpha answers alpha's manifest from R2, archives on alpha's own route, and is counted", async () => {
    const f = fixture();
    const r = await f.run(f.request("/v1/alpha/darwin/aarch64/1.0.1-alpha.57", keyed));
    expect(r.status).toBe(200);
    const data = await r.json() as ReturnType<typeof trackLatest>;
    expect(data.version).toBe("1.0.1-alpha.58");
    for (const p of Object.values(data.platforms)) expect(p.url).toBe(`${UPDATES}/v1/alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz`);
    expect(f.calls).toHaveLength(0);
    expect(f.db.query("SELECT kind, version, count FROM update_counts").all()).toEqual([{ kind: "check", version: "1.0.1-alpha.57", count: 1 }]);
  });
  test("a track with nothing published yet says there is nothing newer", async () => {
    const f = fixture();
    const r = await f.run(f.request("/v1/beta/darwin/x86_64/1.0.1-alpha.57"));
    expect(r.status).toBe(204); expect(await r.text()).toBe("");
  });
  test("a copy on any track may ask any track, and a version on no list is refused", async () => {
    const f = fixture();
    // An alpha copy that went back to stable still asks, from stable's own routes.
    expect((await f.run(f.request("/v1/darwin/aarch64/1.0.1-alpha.57"))).status).toBe(200);
    expect((await f.run(f.request("/v1/stable/darwin/aarch64/1.0.1-alpha.57"))).status).toBe(200);
    // A release copy asks alpha.
    expect((await f.run(f.request("/v1/alpha/darwin/aarch64/0.9.1", keyed))).status).toBe(200);
    for (const path of ["/v1/alpha/darwin/aarch64/1.0.1-alpha.99", "/v1/alpha/darwin/aarch64/1.0.1-beta.1", "/v1/alpha/darwin/aarch64/9.9.9", "/v1/alpha/darwin/aarch64/1.0.1-alpha.057"]) {
      expect((await f.run(f.request(path, keyed))).status).toBe(400);
    }
    for (const path of ["/v1/darwin/aarch64/9.9.9", "/v1/beta/darwin/aarch64/1.0.1-beta.9", "/v1/darwin/aarch64/1.0.1-alpha.057"]) {
      expect((await f.run(f.request(path))).status).toBe(400);
    }
  });
  test("a track's files are served only for its own published versions", async () => {
    const f = fixture();
    for (const [suffix, body] of [[".app.tar.gz", "alpha archive"], [".app.tar.gz.sig", "alpha signature"], [".dmg", "alpha disk image"]]) {
      const r = await f.run(f.request(`/v1/alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal${suffix}`, keyed));
      expect(r.status).toBe(200); expect(await r.text()).toBe(body);
      expect(r.headers.get("Content-Length")).toBe(String(body.length)); expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(f.db.query("SELECT count FROM update_counts WHERE kind = 'download'").get()).toEqual({ count: 3 });
    for (const path of [
      "/v1/beta/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.dmg", // another track's file
      "/v1/alpha/download/v1.0.1-alpha.99/Proscenium_1.0.1-alpha.99_universal.dmg", // unpublished
      "/v1/alpha/download/v1.0.1-alpha.56/Proscenium_1.0.1-alpha.56_universal.dmg", // published, its files gone
      "/v1/alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.57_universal.dmg", // not its own file
      "/v1/alpha/download/v1.0.1-alpha.58/secret.txt",
      "/v1/alpha/download/v0.9.1/Proscenium_0.9.1_universal.dmg", // a release is GitHub's
    ]) {
      const r = await f.run(f.request(path, keyed)); expect(r.status).toBe(404); expect(await r.text()).toBe("");
    }
  });
  test("an unknown track has a bare 404", async () => {
    const f = fixture();
    for (const path of ["/v1/nightly/darwin/aarch64/1.0.1-alpha.57", "/v1/Alpha/darwin/aarch64/1.0.1-alpha.57", "/v1/nightly/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.dmg"]) {
      const r = await f.run(f.request(path)); expect(r.status).toBe(404); expect(await r.text()).toBe("");
    }
  });
  test("the stable routes answer as before under their second name", async () => {
    const f = fixture();
    const r = await f.run(f.request("/v1/stable/darwin/aarch64/0.9.0"));
    expect(r.status).toBe(200); expect((await r.json() as ReturnType<typeof latest>).version).toBe("0.9.1");
    const d = await f.run(f.request("/v1/stable/download/v0.9.1/Proscenium_0.9.1_universal.dmg"));
    expect(d.status).toBe(200); expect(await d.text()).toBe("signed archive");
  });
  test("a track's manifest must be its own: its version, and archives on its own route", async () => {
    expect(() => parseTrackManifest(trackLatest("alpha", "1.0.1-alpha.58"), "alpha")).not.toThrow();
    expect(() => parseTrackManifest(trackLatest("alpha", "1.0.1-alpha.58"), "beta")).toThrow();
    expect(() => parseTrackManifest(trackLatest("alpha", "1.0.1"), "alpha")).toThrow();
    const elsewhere = trackLatest("alpha", "1.0.1-alpha.58"); elsewhere.platforms["darwin-x86_64"].url = "https://evil.test/archive"; expect(() => parseTrackManifest(elsewhere, "alpha")).toThrow();
    // Stable keeps refusing a pre-release.
    expect(() => parseManifest({ ...latest(), version: "0.9.2-alpha.1" })).toThrow();
    expect(trackOf("1.0.1-alpha.57")).toBe("alpha"); expect(trackOf("1.0.1-beta.2")).toBe("beta");
    for (const v of ["1.0.1", "1.0.1-rc.1", "1.0.1-alpha", "1.0.1-alpha.01", "1.0.1-alpha.1.2"]) expect(trackOf(v)).toBeNull();
  });
  test("a bad track list or manifest gives 502, never a guess", async () => {
    for (const [key, text] of [["alpha/latest.json", "broken json"], ["alpha/latest.json", JSON.stringify(trackLatest("alpha", "1.0.1-alpha.99"))], ["alpha/versions.json", JSON.stringify(["1.0.1-beta.1"])]] as const) {
      const f = fixture(); f.objects.set(key, text);
      const r = await f.run(f.request("/v1/alpha/darwin/aarch64/0.9.1", keyed));
      expect(r.status).toBe(502); expect(await r.text()).toBe("");
    }
  });
});

describe("alpha answers only its key", () => {
  const routes = ["/v1/alpha/darwin/aarch64/1.0.1-alpha.57", "/v1/alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz"];
  /** What an unknown track answers: the reply alpha must be indistinguishable from. */
  async function unknownTrack(f: ReturnType<typeof fixture>) {
    const r = await f.run(f.request("/v1/nightly/darwin/aarch64/1.0.1-alpha.57"));
    return { status: r.status, headers: [...r.headers], body: await r.text() };
  }
  test("without a key, with a wrong one, or with no secret set, alpha is an unknown track's bare 404", async () => {
    const wrong: Record<string, string>[] = [{}, { [TRACK_KEY_HEADER]: "" }, { [TRACK_KEY_HEADER]: KEY.slice(0, -1) + "h" }, { [TRACK_KEY_HEADER]: KEY + "=" },
      { [TRACK_KEY_HEADER]: KEY_SHA256 }, { [TRACK_KEY_HEADER.toUpperCase()]: KEY.toLowerCase() }, { "Authorization": `Bearer ${KEY}` }];
    for (const headers of wrong) for (const path of routes) {
      const f = fixture(); const expected = await unknownTrack(f);
      const r = await f.run(f.request(path, headers));
      expect({ status: r.status, headers: [...r.headers], body: await r.text() }).toEqual(expected);
      expect(expected.status).toBe(404); expect(expected.body).toBe("");
      expect(f.db.query("SELECT * FROM update_counts").all()).toEqual([]);
    }
    for (const secret of [undefined, "", "not a hash", KEY_SHA256.toUpperCase()]) {
      const f = fixture(); f.env.ALPHA_KEY_SHA256 = secret;
      for (const path of routes) expect((await f.run(f.request(path, keyed))).status).toBe(404);
    }
  });
  test("no switch, limit or refusal on alpha answers before the key does", async () => {
    const f = fixture();
    f.env.UPDATES_ENABLED = "false"; f.env.DOWNLOADS_ENABLED = "false";
    f.env.UPDATE_LIMIT = { async limit() { return { success: false }; } }; f.env.DOWNLOAD_LIMIT = f.env.UPDATE_LIMIT;
    for (const path of [...routes, "/v1/alpha/darwin/aarch64/9.9.9"]) {
      expect((await f.run(f.request(path))).status).toBe(404);
      expect((await f.run(f.request(path, { "Proscenium-OS": "nonsense" }))).status).toBe(404);
    }
  });
  test("with the key, alpha answers its check and its files", async () => {
    const f = fixture();
    const check = await f.run(f.request(routes[0], keyed));
    expect(check.status).toBe(200); expect((await check.json() as { version: string }).version).toBe("1.0.1-alpha.58");
    const file = await f.run(f.request(routes[1], keyed));
    expect(file.status).toBe(200); expect(await file.text()).toBe("alpha archive");
  });
  test("beta needs no key, and every stable route answers as before without one", async () => {
    const f = fixture(); f.objects.set("beta/versions.json", JSON.stringify(["1.0.1-beta.1"]));
    f.objects.set("beta/latest.json", JSON.stringify(trackLatest("beta", "1.0.1-beta.1")));
    f.objects.set("beta/1.0.1-beta.1/Proscenium_1.0.1-beta.1_universal.dmg", "beta disk image");
    expect((await f.run(f.request("/v1/beta/darwin/aarch64/0.9.1"))).status).toBe(200);
    expect(await (await f.run(f.request("/v1/beta/download/v1.0.1-beta.1/Proscenium_1.0.1-beta.1_universal.dmg"))).text()).toBe("beta disk image");
    for (const path of ["/v1/darwin/aarch64/0.9.0", "/v1/stable/darwin/x86_64/0.9.0", "/v1/download/v0.9.1/Proscenium_0.9.1_universal.dmg", "/v1/stable/download/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz.sig"]) {
      expect((await f.run(f.request(path))).status).toBe(200);
    }
    // A key on a route that needs none changes nothing.
    expect((await f.run(f.request("/v1/stable/darwin/aarch64/0.9.0", keyed))).status).toBe(200);
  });
  test("without the key, no answer says which alphas exist; only a listed one is counted", async () => {
    const f = fixture();
    const answers: { route: string; status: number; body: string }[] = [];
    for (const version of ["1.0.1-alpha.57", "1.0.1-alpha.99", "7.0.0-alpha.1"]) for (const route of ["/v1", "/v1/stable", "/v1/beta"]) {
      const r = await f.run(f.request(`${route}/darwin/aarch64/${version}`));
      answers.push({ route, status: r.status, body: await r.text() });
    }
    for (const [i, a] of answers.entries()) expect(a).toEqual(answers[i % 3]);
    expect(f.db.query("SELECT version, count FROM update_counts ORDER BY version").all()).toEqual([{ version: "1.0.1-alpha.57", count: 3 }]);
  });
  test("the key never reaches D1 or a response", async () => {
    const f = fixture();
    const bodies: string[] = [];
    for (const path of [...routes, "/v1/alpha/darwin/aarch64/9.9.9", "/v1/alpha/download/v1.0.1-alpha.58/secret.txt"]) {
      const r = await f.run(f.request(path, keyed));
      bodies.push(await r.text(), JSON.stringify([...r.headers]));
    }
    const stored = JSON.stringify(f.db.query("SELECT * FROM update_counts").all());
    for (const text of [...bodies, stored]) { expect(text).not.toContain(KEY); expect(text).not.toContain(KEY_SHA256); }
  });
});
