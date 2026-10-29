// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  updates,
  countedAs,
  fileTarget,
  GITHUB,
  UPDATES,
  TRACK_KEY_HEADER,
  UPSTREAM_HEADERS,
  parseAdmission,
  parseManifest,
  parseTrackManifest,
  readManifest,
  boundedBytes,
  trackOf,
  type Env,
  type Dependencies,
} from "../src/updates";
import { admissionList } from "./lists";
/** Alpha's key in these tests, and the hash the Worker holds as its secret. */
const KEY = "k".repeat(22) + "Ey_-0123456789abcdefg";
const KEY_SHA256 = createHash("sha256").update(KEY).digest("hex");
const keyed = { [TRACK_KEY_HEADER]: KEY };
const migration = (
  await Promise.all(
    ["0001_updates.sql", "0008_update_kinds.sql"].map((f) =>
      Bun.file(new URL(`../migrations/${f}`, import.meta.url)).text(),
    ),
  )
).join("\n");
/** A release's manifest, as GitHub serves it. */
const release = (version: string) => ({
  version,
  notes: "A release.",
  pub_date: "2026-09-18T12:00:00Z",
  platforms: {
    "darwin-aarch64": {
      signature: "a".repeat(100),
      url: `${GITHUB}/download/v${version}/Proscenium_${version}_universal.app.tar.gz`,
    },
    "darwin-x86_64": {
      signature: "a".repeat(100),
      url: `${GITHUB}/download/v${version}/Proscenium_${version}_universal.app.tar.gz`,
    },
  },
});
const latest = () => release("0.9.1");
/** A track's manifest, as the pipeline writes it to R2. */
const trackLatest = (track: string, version: string) => ({
  version,
  notes: "Unreleased.",
  pub_date: "2026-09-22T20:00:00Z",
  platforms: {
    "darwin-aarch64": {
      signature: "b".repeat(100),
      url: `${UPDATES}/v1/${track}/update/v${version}/Proscenium_${version}_universal.app.tar.gz`,
    },
    "darwin-x86_64": {
      signature: "b".repeat(100),
      url: `${UPDATES}/v1/${track}/update/v${version}/Proscenium_${version}_universal.app.tar.gz`,
    },
  },
});
/** A track's manifest since track builds are Apple silicon's alone. */
const armLatest = (track: string, version: string) => ({
  version,
  notes: "Unreleased.",
  pub_date: "2026-09-26T20:00:00Z",
  platforms: {
    "darwin-aarch64": {
      signature: "c".repeat(100),
      url: `${UPDATES}/v1/${track}/update/v${version}/Proscenium_${version}_aarch64.app.tar.gz`,
    },
  },
});
/** R2 as the Worker reads it: `get` and nothing else. */
function bucket(objects: Map<string, string>): Env["TRACKS"] {
  return {
    async get(key: string) {
      const text = objects.get(key);
      return text === undefined
        ? null
        : { body: new Response(text).body!, size: new TextEncoder().encode(text).byteLength };
    },
  } as unknown as Env["TRACKS"];
}
function fixture() {
  const db = new Database(":memory:");
  db.exec(migration);
  const calls: Request[] = [];
  const cache = new Map<string, Response>();
  const objects = new Map<string, string>([
    ["alpha/versions.json", JSON.stringify(["1.0.1-alpha.56", "1.0.1-alpha.57", "1.0.1-alpha.58"])],
    ["alpha/latest.json", JSON.stringify(trackLatest("alpha", "1.0.1-alpha.58"))],
    ["alpha/1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz", "alpha archive"],
    ["alpha/1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz.sig", "alpha signature"],
    ["alpha/1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.dmg", "alpha disk image"],
  ]);
  const env: Env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: (string | number)[]) {
            return {
              async run() {
                db.query(sql).run(...args);
                return { success: true };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
    UPDATE_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
    DOWNLOAD_LIMIT: {
      async limit() {
        return { success: true };
      },
    },
    UPDATES_ENABLED: "true",
    DOWNLOADS_ENABLED: "true",
    RELEASED_VERSIONS_JSON: '["0.9.0","0.9.1"]',
    TRACKS: bucket(objects),
    ALPHA_KEY_SHA256: KEY_SHA256,
  };
  const said: string[] = [];
  const deps: Dependencies = {
    updatesOrigin: UPDATES,
    log: (line) => said.push(line),
    now: () => new Date("2026-09-18T12:34:56Z"),
    cache: {
      async match(r) {
        return cache.get(typeof r === "string" ? r : r instanceof URL ? r.href : r.url)?.clone();
      },
      async put(r, response) {
        cache.set(typeof r === "string" ? r : r instanceof URL ? r.href : r.url, response.clone());
      },
    },
    async fetch(r) {
      calls.push(r);
      return r.url.endsWith("latest.json")
        ? Response.json(latest())
        : new Response("signed archive");
    },
  };
  function request(path = "/v1/darwin/aarch64/0.9.0", headers: Record<string, string> = {}) {
    return new Request(`${UPDATES}${path}`, {
      headers: {
        "Proscenium-OS": "14.6",
        "CF-Connecting-IP": "192.0.2.100",
        Cookie: "private",
        "X-Forwarded-For": "private",
        ...headers,
      },
    });
  }
  return {
    env,
    deps,
    calls,
    db,
    cache,
    objects,
    said,
    request,
    run: (r = request()) => updates(r, env, deps),
  };
}
/**
 * GitHub with these releases published, the last one newest: its manifest at
 * `latest/download`, each release's own at `download/v<version>`, and its files.
 */
function github(
  f: ReturnType<typeof fixture>,
  published: string[],
  manifestOf: (version: string) => unknown = release,
) {
  f.deps.fetch = async (r) => {
    f.calls.push(r);
    const path = new URL(r.url).pathname;
    if (path.endsWith("/latest/download/latest.json"))
      return Response.json(manifestOf(published[published.length - 1]));
    const own = /\/download\/v([^/]+)\/latest\.json$/.exec(path)?.[1];
    if (own !== undefined)
      return published.includes(own)
        ? Response.json(manifestOf(own))
        : new Response(null, { status: 404 });
    return new Response("signed archive");
  };
}
type Manifest = { version: string; platforms: Record<string, { signature: string; url: string }> };
/**
 * A manifest with Windows' two beside the Mac's, as a release or a track names
 * them: an installer per chip, at `base`'s download route.
 */
function withWindows<M extends Manifest>(m: M, base: string): M {
  return {
    ...m,
    platforms: {
      ...m.platforms,
      "windows-x86_64": {
        signature: "w".repeat(100),
        url: `${base}/download/v${m.version}/Proscenium_${m.version}_x64-setup.exe`,
      },
      "windows-aarch64": {
        signature: "v".repeat(100),
        url: `${base}/download/v${m.version}/Proscenium_${m.version}_arm64-setup.exe`,
      },
    },
  };
}
/** A release that carries Windows, as GitHub serves its manifest. */
const windowsRelease = (version: string) => withWindows(release(version), GITHUB);
/** What a Windows 11 copy sends as its system's version. */
const WINDOWS_11 = { "Proscenium-OS": "10.0.26100" };
const checks = (f: ReturnType<typeof fixture>) =>
  f.db
    .query("SELECT version, count FROM update_counts WHERE kind = 'check' ORDER BY version")
    .all();
/** What a check answered: its status, and the version it offers. */
async function answer(r: Response) {
  const body = await r.text();
  return {
    status: r.status,
    version: body ? (JSON.parse(body) as { version: string }).version : null,
  };
}
describe("update service", () => {
  test("counts checks by day and documented fields, never stores an address or sends one upstream", async () => {
    const f = fixture();
    const first = await f.run();
    const second = await f.run();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const data = (await first.json()) as ReturnType<typeof latest>;
    for (const p of Object.values(data.platforms))
      expect(p.url).toBe(`${UPDATES}/v1/update/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz`);
    expect(f.calls.length).toBe(1);
    expect([...f.calls[0].headers]).toEqual([["user-agent", "proscenium-updates"]]);
    const rows = f.db.query("SELECT * FROM update_counts").all();
    expect(rows).toEqual([
      {
        day: "2026-09-18",
        kind: "check",
        platform: "darwin",
        arch: "aarch64",
        version: "0.9.0",
        os: "14.6",
        count: 2,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("192.0.2.100");
    expect(f.cache.get(`${GITHUB}/latest/download/latest.json`)?.headers.get("Cache-Control")).toBe(
      "public, max-age=300",
    );
  });
  test("streams only the release's own files and counts each by what it was (docs/engineering/services-and-feedback.md#SERV-286)", async () => {
    const f = fixture();
    for (const suffix of [".app.tar.gz", ".app.tar.gz.sig", ".dmg"]) {
      const r = await f.run(f.request(`/v1/download/v0.9.1/Proscenium_0.9.1_universal${suffix}`));
      expect(r.status).toBe(200);
      expect(await r.text()).toBe("signed archive");
      expect(r.headers.has("Location")).toBe(false);
    }
    expect(
      f.db.query("SELECT kind, platform, arch, version, os, count FROM update_counts").all(),
    ).toEqual([
      {
        kind: "signature",
        platform: "darwin",
        arch: "universal",
        version: "0.9.1",
        os: "",
        count: 1,
      },
      {
        kind: "website",
        platform: "darwin",
        arch: "universal",
        version: "0.9.1",
        os: "",
        count: 2,
      },
    ]);
    for (const path of [
      "/v1/download/v0.9.1/secret.txt",
      "/v1/download/v0.9.1/Proscenium_0.9.0_universal.dmg",
      "/v1/download/v8.8.8/Proscenium_8.8.8_universal.dmg",
    ])
      expect((await f.run(f.request(path))).status).toBe(404);
  });
  test("a download is counted by where it came from, apart from updates and the project's own machines (docs/engineering/services-and-feedback.md#SERV-286)", async () => {
    const f = fixture();
    const dmg = "/v1/download/v0.9.1/Proscenium_0.9.1_universal.dmg";
    const asks: [string, Record<string, string>][] = [
      // A person, from the website's Download.
      [dmg, { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15" }],
      [dmg, {}],
      // Homebrew, from the cask.
      [dmg, { "User-Agent": "Homebrew/4.4.0 (Macintosh; arm64 Mac OS X 15.1) curl/8.7.1" }],
      // An installed copy, on the route it was offered, and its signature.
      ["/v1/update/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz", {}],
      ["/v1/stable/update/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz", {}],
      ["/v1/update/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz.sig", {}],
      // The release's own check of the site's Download.
      [dmg, { "User-Agent": "proscenium-checks (release)" }],
    ];
    for (const [path, headers] of asks)
      expect((await f.run(f.request(path, headers))).status, path).toBe(200);
    expect(f.db.query("SELECT kind, count FROM update_counts ORDER BY kind").all()).toEqual([
      { kind: "homebrew", count: 1 },
      { kind: "own", count: 1 },
      { kind: "signature", count: 1 },
      { kind: "update", count: 2 },
      { kind: "website", count: 2 },
    ]);
    const update = await f.run(f.request("/v1/darwin/aarch64/0.9.0"));
    const offered = (await update.json()) as ReturnType<typeof latest>;
    for (const p of Object.values(offered.platforms)) expect(p.url).toContain("/v1/update/v0.9.1/");
  });
  test("what a file counts as, and what it is for", () => {
    expect(countedAs("download", "Proscenium_1.0.4_universal.dmg", "")).toBe("website");
    expect(countedAs("download", "Proscenium_1.0.4_x64-setup.exe", "Homebrew/4.4.0")).toBe(
      "homebrew",
    );
    expect(countedAs("update", "Proscenium_1.0.4_universal.app.tar.gz", "")).toBe("update");
    expect(countedAs("update", "Proscenium_1.0.4_universal.app.tar.gz.sig", "")).toBe("signature");
    expect(countedAs("download", "Proscenium_1.0.4_universal.dmg", "proscenium-checks")).toBe(
      "own",
    );
    expect(countedAs("update", "Proscenium_1.0.4_universal.app.tar.gz", "a Homebrew/ tool")).toBe(
      "update",
    );
    expect(fileTarget("1.0.4", "Proscenium_1.0.4_universal.dmg")).toEqual({
      platform: "darwin",
      arch: "universal",
    });
    expect(fileTarget("1.0.4-beta.1", "Proscenium_1.0.4-beta.1_aarch64.app.tar.gz.sig")).toEqual({
      platform: "darwin",
      arch: "aarch64",
    });
    expect(fileTarget("1.0.4", "Proscenium_1.0.4_x64-setup.exe")).toEqual({
      platform: "windows",
      arch: "x86_64",
    });
    expect(fileTarget("1.0.4", "Proscenium_1.0.4_arm64-setup.exe.sig")).toEqual({
      platform: "windows",
      arch: "aarch64",
    });
  });
  test("unknown paths, hosts and methods have a bare 404", async () => {
    const f = fixture();
    for (const r of [
      f.request("/admin"),
      // A system we do not build: Windows answers since it was built
      // (docs/engineering/services-and-feedback.md#SERV-283); Linux never has.
      f.request("/v1/linux/x86_64/0.9.0"),
      f.request("/v1/beta/linux/x86_64/0.9.0"),
      f.request("/v1/darwin/aarch64/0.9.0?secret=1"),
      new Request("https://evil.test/v1/darwin/aarch64/0.9.0"),
      new Request(f.request(), { method: "POST" }),
    ]) {
      const result = await f.run(r);
      expect(result.status).toBe(404);
      expect(await result.text()).toBe("");
    }
    expect(f.calls).toHaveLength(0);
  });
  test("unreleased versions and unbounded system fields are refused before upstream or storage", async () => {
    const f = fixture();
    for (const r of [
      f.request("/v1/darwin/aarch64/9.9.9"),
      f.request(undefined, { "Proscenium-OS": "14.6.1" }),
      f.request(undefined, { "Proscenium-OS": "my machine" }),
    ])
      expect((await f.run(r)).status).toBe(400);
    expect(f.calls).toHaveLength(0);
    expect(f.db.query("SELECT * FROM update_counts").all()).toEqual([]);
  });
  test("each route has its own kill switch and rate limit", async () => {
    const f = fixture();
    f.env.UPDATES_ENABLED = "false";
    expect((await f.run()).status).toBe(503);
    f.env.UPDATES_ENABLED = "true";
    f.env.UPDATE_LIMIT = {
      async limit() {
        return { success: false };
      },
    };
    expect((await f.run()).status).toBe(429);
    f.env.DOWNLOADS_ENABLED = "false";
    expect(
      (await f.run(f.request("/v1/download/v0.9.1/Proscenium_0.9.1_universal.dmg"))).status,
    ).toBe(503);
    expect(f.calls).toHaveLength(0);
  });
  test("GitHub failures and malformed manifests give 502 for the app's fallback", async () => {
    for (const fetch of [
      async () => new Response(null, { status: 404 }),
      async () => {
        throw new Error("secret");
      },
      async () => Response.json({ ...latest(), version: "9.9.9" }),
      async () => new Response("broken json"),
    ]) {
      const f = fixture();
      f.deps.fetch = fetch;
      const result = await f.run();
      expect(result.status).toBe(502);
      expect(await result.text()).toBe("");
    }
  });
  test("the Worker's own fault answers 500, never GitHub's 502", async () => {
    // docs/engineering/services-and-feedback.md#SERV-266. workerd throws "Illegal invocation"
    // synchronously when fetch is called as another object's method; the
    // first deploy did that, and its 502 read as GitHub down for eight days.
    const misbound = () => {
      throw new TypeError("Illegal invocation: function called with incorrect `this` reference.");
    };
    for (const path of [
      "/v1/darwin/aarch64/0.9.0",
      "/v1/stable/darwin/x86_64/0.9.0",
      "/v1/download/v0.9.1/Proscenium_0.9.1_universal.dmg",
    ]) {
      const f = fixture();
      f.deps.fetch = misbound as unknown as Dependencies["fetch"];
      const r = await f.run(f.request(path));
      expect(r.status).toBe(500);
      expect(await r.text()).toBe("");
    }
    const broken = {
      async run() {
        throw new Error("D1 is down");
      },
    };
    const d1 = fixture();
    d1.env.DB = {
      prepare() {
        return {
          bind() {
            return broken;
          },
        };
      },
    } as unknown as D1Database;
    expect((await d1.run()).status).toBe(500);
    const cache = fixture();
    cache.deps.cache = {
      async match() {
        throw new Error("cache");
      },
      async put() {},
    };
    expect((await cache.run()).status).toBe(500);
    const unbound = fixture();
    unbound.env.TRACKS = undefined as unknown as Env["TRACKS"];
    expect(
      (await unbound.run(unbound.request("/v1/alpha/darwin/aarch64/1.0.1-alpha.57", keyed))).status,
    ).toBe(500);
  });
  test("a source that cannot be reached is 502: a lost connection, a timeout, R2 failing", async () => {
    for (const error of [
      new Error("Network connection lost."),
      new DOMException("timed out", "TimeoutError"),
    ]) {
      const f = fixture();
      f.deps.fetch = async () => {
        throw error;
      };
      expect((await f.run()).status).toBe(502);
    }
    const r2 = fixture();
    r2.env.TRACKS = {
      async get() {
        throw new Error("R2 unavailable");
      },
    } as unknown as Env["TRACKS"];
    expect(
      (await r2.run(r2.request("/v1/alpha/darwin/aarch64/1.0.1-alpha.57", keyed))).status,
    ).toBe(502);
  });
  test("rejects off-repository manifests and redirects without contacting the target", async () => {
    const data = latest();
    data.platforms["darwin-aarch64"].url = "https://evil.test/secret";
    expect(() => parseManifest(data)).toThrow();
    for (const target of [
      "http://github.com/proscenium-app/proscenium/releases/file",
      "https://github.com/other/repo/releases/file",
      "https://evil.test/private",
      "https://user@release-assets.githubusercontent.com/private",
    ]) {
      const f = fixture();
      let calls = 0;
      f.deps.fetch = async () => {
        calls++;
        return new Response(null, { status: 302, headers: { Location: target } });
      };
      expect((await f.run()).status).toBe(502);
      expect(calls).toBe(1);
    }
  });
  test("GitHub asset redirects get fresh headers: the service's name and nothing else", async () => {
    const f = fixture();
    const calls: Request[] = [];
    f.deps.fetch = async (r) => {
      calls.push(r);
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: {
              Location: "https://release-assets.githubusercontent.com/asset?signature=public",
              "Set-Cookie": "private",
            },
          })
        : Response.json(latest());
    };
    expect((await f.run()).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect([...calls[1].headers]).toEqual([["user-agent", UPSTREAM_HEADERS["User-Agent"]]]);
  });
  test("oversized declared bodies are refused unread; chunked bodies are bounded", async () => {
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
    await expect(
      boundedBytes(new Response(body, { headers: { "Content-Length": "999" } }), 10),
    ).rejects.toThrow();
    expect(pulled).toBe(0);
    await expect(boundedBytes(new Response("this is too long"), 10)).rejects.toThrow();
  });
});

describe("update tracks (docs/engineering/services-and-feedback.md#SERV-245)", () => {
  test("a check on alpha answers alpha's manifest from R2, archives on alpha's own route, and is counted", async () => {
    const f = fixture();
    const r = await f.run(f.request("/v1/alpha/darwin/aarch64/1.0.1-alpha.57", keyed));
    expect(r.status).toBe(200);
    const data = (await r.json()) as ReturnType<typeof trackLatest>;
    expect(data.version).toBe("1.0.1-alpha.58");
    for (const p of Object.values(data.platforms))
      expect(p.url).toBe(
        `${UPDATES}/v1/alpha/update/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz`,
      );
    expect(f.calls).toHaveLength(0);
    expect(f.db.query("SELECT kind, version, count FROM update_counts").all()).toEqual([
      { kind: "check", version: "1.0.1-alpha.57", count: 1 },
    ]);
  });
  test("a track with nothing published yet says there is nothing newer", async () => {
    const f = fixture();
    const r = await f.run(f.request("/v1/beta/darwin/aarch64/1.0.1-alpha.57"));
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
  });
  test("a track build is Apple silicon's alone: its manifest names darwin-aarch64, and its files are served (docs/engineering/services-and-feedback.md#SERV-265)", async () => {
    const f = fixture();
    const v = "1.0.1-alpha.59";
    f.objects.set("alpha/versions.json", JSON.stringify(["1.0.1-alpha.57", "1.0.1-alpha.58", v]));
    f.objects.set("alpha/latest.json", JSON.stringify(armLatest("alpha", v)));
    f.objects.set(`alpha/${v}/Proscenium_${v}_aarch64.app.tar.gz`, "arm archive");
    const r = await f.run(f.request("/v1/alpha/darwin/aarch64/1.0.1-alpha.58", keyed));
    expect(r.status).toBe(200);
    const data = (await r.json()) as ReturnType<typeof armLatest>;
    expect(Object.keys(data.platforms)).toEqual(["darwin-aarch64"]);
    expect(data.platforms["darwin-aarch64"].url).toBe(
      `${UPDATES}/v1/alpha/update/v${v}/Proscenium_${v}_aarch64.app.tar.gz`,
    );
    const d = await f.run(
      f.request(`/v1/alpha/download/v${v}/Proscenium_${v}_aarch64.app.tar.gz`, keyed),
    );
    expect(d.status).toBe(200);
    expect(await d.text()).toBe("arm archive");
    // The universal files of the versions before stay served.
    expect(
      (
        await f.run(
          f.request(
            "/v1/alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.dmg",
            keyed,
          ),
        )
      ).status,
    ).toBe(200);
    // A release is universal, always: an Apple-silicon-only stable manifest is refused.
    expect(() =>
      parseManifest({
        ...latest(),
        platforms: { "darwin-aarch64": latest().platforms["darwin-aarch64"] },
      }),
    ).toThrow();
    // Apple silicon's slice named universal, or universal's names on one platform, is refused.
    const mixed = armLatest("alpha", v);
    mixed.platforms["darwin-aarch64"].url =
      `${UPDATES}/v1/alpha/download/v${v}/Proscenium_${v}_universal.app.tar.gz`;
    expect(() => parseTrackManifest(mixed, "alpha")).toThrow();
    expect(() =>
      parseTrackManifest(
        {
          ...armLatest("alpha", v),
          platforms: { "darwin-x86_64": armLatest("alpha", v).platforms["darwin-aarch64"] },
        },
        "alpha",
      ),
    ).toThrow();
  });
  test("an Intel copy on alpha or beta is answered as stable answers it (docs/engineering/services-and-feedback.md#SERV-265)", async () => {
    const f = fixture();
    for (const [path, headers] of [
      ["/v1/beta/darwin/x86_64/1.0.1-alpha.57", {}],
      ["/v1/alpha/darwin/x86_64/1.0.1-alpha.57", keyed],
    ] as const) {
      const r = await f.run(f.request(path, headers));
      expect(r.status).toBe(200);
      const data = (await r.json()) as ReturnType<typeof latest>;
      expect(data.version).toBe("0.9.1");
      for (const p of Object.values(data.platforms))
        expect(p.url).toBe(`${UPDATES}/v1/update/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz`);
    }
    // Still counted as the checks they are, and alpha still needs its key first.
    expect(f.db.query("SELECT arch, count FROM update_counts WHERE kind = 'check'").all()).toEqual([
      { arch: "x86_64", count: 2 },
    ]);
    const unkeyed = await f.run(f.request("/v1/alpha/darwin/x86_64/1.0.1-alpha.57"));
    expect(unkeyed.status).toBe(404);
    expect(await unkeyed.text()).toBe("");
  });
  test("a copy on any track may ask any track, and a version on no list is refused", async () => {
    const f = fixture();
    // An alpha copy that went back to stable still asks, from stable's own routes.
    expect((await f.run(f.request("/v1/darwin/aarch64/1.0.1-alpha.57"))).status).toBe(200);
    expect((await f.run(f.request("/v1/stable/darwin/aarch64/1.0.1-alpha.57"))).status).toBe(200);
    // A release copy asks alpha.
    expect((await f.run(f.request("/v1/alpha/darwin/aarch64/0.9.1", keyed))).status).toBe(200);
    for (const path of [
      "/v1/alpha/darwin/aarch64/1.0.1-alpha.99",
      "/v1/alpha/darwin/aarch64/1.0.1-beta.1",
      "/v1/alpha/darwin/aarch64/9.9.9",
      "/v1/alpha/darwin/aarch64/1.0.1-alpha.057",
    ]) {
      expect((await f.run(f.request(path, keyed))).status).toBe(400);
    }
    for (const path of [
      "/v1/darwin/aarch64/9.9.9",
      "/v1/beta/darwin/aarch64/1.0.1-beta.9",
      "/v1/darwin/aarch64/1.0.1-alpha.057",
    ]) {
      expect((await f.run(f.request(path))).status).toBe(400);
    }
  });
  test("a track's files are served only for its own published versions", async () => {
    const f = fixture();
    for (const [suffix, body] of [
      [".app.tar.gz", "alpha archive"],
      [".app.tar.gz.sig", "alpha signature"],
      [".dmg", "alpha disk image"],
    ]) {
      const r = await f.run(
        f.request(
          `/v1/alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal${suffix}`,
          keyed,
        ),
      );
      expect(r.status).toBe(200);
      expect(await r.text()).toBe(body);
      expect(r.headers.get("Content-Length")).toBe(String(body.length));
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    }
    expect(f.db.query("SELECT kind, count FROM update_counts ORDER BY kind").all()).toEqual([
      { kind: "signature", count: 1 },
      { kind: "website", count: 2 },
    ]);
    for (const path of [
      "/v1/beta/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.dmg", // another track's file
      "/v1/alpha/download/v1.0.1-alpha.99/Proscenium_1.0.1-alpha.99_universal.dmg", // unpublished
      "/v1/alpha/download/v1.0.1-alpha.56/Proscenium_1.0.1-alpha.56_universal.dmg", // published, its files gone
      "/v1/alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.57_universal.dmg", // not its own file
      "/v1/alpha/download/v1.0.1-alpha.58/secret.txt",
      "/v1/alpha/download/v0.9.1/Proscenium_0.9.1_universal.dmg", // a release is GitHub's
    ]) {
      const r = await f.run(f.request(path, keyed));
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("");
    }
  });
  test("an unknown track has a bare 404", async () => {
    const f = fixture();
    for (const path of [
      "/v1/nightly/darwin/aarch64/1.0.1-alpha.57",
      "/v1/Alpha/darwin/aarch64/1.0.1-alpha.57",
      "/v1/nightly/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.dmg",
    ]) {
      const r = await f.run(f.request(path));
      expect(r.status).toBe(404);
      expect(await r.text()).toBe("");
    }
  });
  test("the stable routes answer as before under their second name", async () => {
    const f = fixture();
    const r = await f.run(f.request("/v1/stable/darwin/aarch64/0.9.0"));
    expect(r.status).toBe(200);
    expect(((await r.json()) as ReturnType<typeof latest>).version).toBe("0.9.1");
    const d = await f.run(f.request("/v1/stable/download/v0.9.1/Proscenium_0.9.1_universal.dmg"));
    expect(d.status).toBe(200);
    expect(await d.text()).toBe("signed archive");
  });
  test("a track's manifest must be its own: its version, and archives on its own route", async () => {
    expect(() => parseTrackManifest(trackLatest("alpha", "1.0.1-alpha.58"), "alpha")).not.toThrow();
    expect(() => parseTrackManifest(trackLatest("alpha", "1.0.1-alpha.58"), "beta")).toThrow();
    expect(() => parseTrackManifest(trackLatest("alpha", "1.0.1"), "alpha")).toThrow();
    const elsewhere = trackLatest("alpha", "1.0.1-alpha.58");
    elsewhere.platforms["darwin-x86_64"].url = "https://evil.test/archive";
    expect(() => parseTrackManifest(elsewhere, "alpha")).toThrow();
    // Stable keeps refusing a pre-release.
    expect(() => parseManifest({ ...latest(), version: "0.9.2-alpha.1" })).toThrow();
    expect(trackOf("1.0.1-alpha.57")).toBe("alpha");
    expect(trackOf("1.0.1-beta.2")).toBe("beta");
    for (const v of ["1.0.1", "1.0.1-rc.1", "1.0.1-alpha", "1.0.1-alpha.01", "1.0.1-alpha.1.2"])
      expect(trackOf(v)).toBeNull();
  });
  test("a bad track list or manifest gives 502, never a guess", async () => {
    for (const [key, text] of [
      ["alpha/latest.json", "broken json"],
      ["alpha/latest.json", JSON.stringify(trackLatest("alpha", "1.0.1-alpha.99"))],
      ["alpha/versions.json", JSON.stringify(["1.0.1-beta.1"])],
    ] as const) {
      const f = fixture();
      f.objects.set(key, text);
      const r = await f.run(f.request("/v1/alpha/darwin/aarch64/0.9.1", keyed));
      expect(r.status).toBe(502);
      expect(await r.text()).toBe("");
    }
  });
  test("production answers a track's manifest exactly as the pipeline wrote it (docs/engineering/services-and-feedback.md#SERV-278)", async () => {
    for (const manifest of [
      trackLatest("alpha", "1.0.1-alpha.58"),
      armLatest("alpha", "1.0.1-alpha.58"),
    ]) {
      const f = fixture();
      f.objects.set("alpha/latest.json", JSON.stringify(manifest));
      const r = await f.run(f.request("/v1/alpha/darwin/aarch64/1.0.1-alpha.57", keyed));
      expect(r.status).toBe(200);
      const text = await r.text();
      // The pipeline's values, in the parser's order, which is what production answered before.
      expect(JSON.parse(text) as unknown).toEqual(manifest as unknown);
      expect(text).toBe(JSON.stringify(parseTrackManifest(manifest, "alpha")));
    }
  });
  test("a stand-in answers a track's manifest on its own origin, whichever of the service's hosts it named (docs/engineering/services-and-feedback.md#SERV-278)", async () => {
    const standIn = "http://127.0.0.1:8797";
    const v = "1.0.1-beta.2";
    const onStandIn = armLatest("beta", v);
    onStandIn.platforms["darwin-aarch64"].url = onStandIn.platforms["darwin-aarch64"].url.replace(
      UPDATES,
      standIn,
    );
    const elsewhere = armLatest("beta", v);
    elsewhere.platforms["darwin-aarch64"].url =
      `https://example.org/v1/beta/download/v${v}/Proscenium_${v}_aarch64.app.tar.gz`;
    for (const [what, manifest, status] of [
      ["as the pipeline wrote it", armLatest("beta", v), 200],
      ["already on the stand-in", onStandIn, 200],
      ["on another host", elsewhere, 502],
      ["universal, as the first track builds were", trackLatest("beta", v), 200],
    ] as const) {
      const f = fixture();
      f.deps.updatesOrigin = standIn;
      f.objects.set("beta/versions.json", JSON.stringify([v]));
      f.objects.set("beta/latest.json", JSON.stringify(manifest));
      const r = await f.run(
        new Request(`${standIn}/v1/beta/darwin/aarch64/0.9.1`, {
          headers: { "Proscenium-OS": "26.0" },
        }),
      );
      expect(r.status, what).toBe(status);
      if (status !== 200) continue;
      const data = (await r.json()) as ReturnType<typeof trackLatest>;
      expect(data.version).toBe(v);
      const slice = Object.keys(manifest.platforms).length === 1 ? "aarch64" : "universal";
      for (const p of Object.values(data.platforms))
        expect(p.url, what).toBe(
          `${standIn}/v1/beta/update/v${v}/Proscenium_${v}_${slice}.app.tar.gz`,
        );
    }
  });
});

describe("alpha answers only its key", () => {
  const routes = [
    "/v1/alpha/darwin/aarch64/1.0.1-alpha.57",
    "/v1/alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal.app.tar.gz",
  ];
  /** What an unknown track answers: the reply alpha must be indistinguishable from. */
  async function unknownTrack(f: ReturnType<typeof fixture>) {
    const r = await f.run(f.request("/v1/nightly/darwin/aarch64/1.0.1-alpha.57"));
    return { status: r.status, headers: [...r.headers], body: await r.text() };
  }
  test("without a key, with a wrong one, or with no secret set, alpha is an unknown track's bare 404", async () => {
    const wrong: Record<string, string>[] = [
      {},
      { [TRACK_KEY_HEADER]: "" },
      { [TRACK_KEY_HEADER]: KEY.slice(0, -1) + "h" },
      { [TRACK_KEY_HEADER]: KEY + "=" },
      { [TRACK_KEY_HEADER]: KEY_SHA256 },
      { [TRACK_KEY_HEADER.toUpperCase()]: KEY.toLowerCase() },
      { Authorization: `Bearer ${KEY}` },
    ];
    for (const headers of wrong)
      for (const path of routes) {
        const f = fixture();
        const expected = await unknownTrack(f);
        const r = await f.run(f.request(path, headers));
        expect({ status: r.status, headers: [...r.headers], body: await r.text() }).toEqual(
          expected,
        );
        expect(expected.status).toBe(404);
        expect(expected.body).toBe("");
        expect(f.db.query("SELECT * FROM update_counts").all()).toEqual([]);
      }
    for (const secret of [undefined, "", "not a hash", KEY_SHA256.toUpperCase()]) {
      const f = fixture();
      f.env.ALPHA_KEY_SHA256 = secret;
      for (const path of routes) expect((await f.run(f.request(path, keyed))).status).toBe(404);
    }
  });
  test("no switch, limit or refusal on alpha answers before the key does", async () => {
    const f = fixture();
    f.env.UPDATES_ENABLED = "false";
    f.env.DOWNLOADS_ENABLED = "false";
    f.env.UPDATE_LIMIT = {
      async limit() {
        return { success: false };
      },
    };
    f.env.DOWNLOAD_LIMIT = f.env.UPDATE_LIMIT;
    for (const path of [...routes, "/v1/alpha/darwin/aarch64/9.9.9"]) {
      expect((await f.run(f.request(path))).status).toBe(404);
      expect((await f.run(f.request(path, { "Proscenium-OS": "nonsense" }))).status).toBe(404);
    }
  });
  test("with the key, alpha answers its check and its files", async () => {
    const f = fixture();
    const check = await f.run(f.request(routes[0], keyed));
    expect(check.status).toBe(200);
    expect(((await check.json()) as { version: string }).version).toBe("1.0.1-alpha.58");
    const file = await f.run(f.request(routes[1], keyed));
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("alpha archive");
  });
  test("beta needs no key, and every stable route answers as before without one", async () => {
    const f = fixture();
    f.objects.set("beta/versions.json", JSON.stringify(["1.0.1-beta.1"]));
    f.objects.set("beta/latest.json", JSON.stringify(trackLatest("beta", "1.0.1-beta.1")));
    f.objects.set("beta/1.0.1-beta.1/Proscenium_1.0.1-beta.1_universal.dmg", "beta disk image");
    expect((await f.run(f.request("/v1/beta/darwin/aarch64/0.9.1"))).status).toBe(200);
    expect(
      await (
        await f.run(
          f.request("/v1/beta/download/v1.0.1-beta.1/Proscenium_1.0.1-beta.1_universal.dmg"),
        )
      ).text(),
    ).toBe("beta disk image");
    for (const path of [
      "/v1/darwin/aarch64/0.9.0",
      "/v1/stable/darwin/x86_64/0.9.0",
      "/v1/download/v0.9.1/Proscenium_0.9.1_universal.dmg",
      "/v1/stable/download/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz.sig",
    ]) {
      expect((await f.run(f.request(path))).status).toBe(200);
    }
    // A key on a route that needs none changes nothing.
    expect((await f.run(f.request("/v1/stable/darwin/aarch64/0.9.0", keyed))).status).toBe(200);
  });
  test("without the key, no answer says which alphas exist; only a listed one is counted", async () => {
    const f = fixture();
    const answers: { route: string; status: number; body: string }[] = [];
    for (const version of ["1.0.1-alpha.57", "1.0.1-alpha.99", "7.0.0-alpha.1"])
      for (const route of ["/v1", "/v1/stable", "/v1/beta"]) {
        const r = await f.run(f.request(`${route}/darwin/aarch64/${version}`));
        answers.push({ route, status: r.status, body: await r.text() });
      }
    for (const [i, a] of answers.entries()) expect(a).toEqual(answers[i % 3]);
    expect(f.db.query("SELECT version, count FROM update_counts ORDER BY version").all()).toEqual([
      { version: "1.0.1-alpha.57", count: 3 },
    ]);
  });
  test("the key never reaches D1 or a response", async () => {
    const f = fixture();
    const bodies: string[] = [];
    for (const path of [
      ...routes,
      "/v1/alpha/darwin/aarch64/9.9.9",
      "/v1/alpha/download/v1.0.1-alpha.58/secret.txt",
    ]) {
      const r = await f.run(f.request(path, keyed));
      bodies.push(await r.text(), JSON.stringify([...r.headers]));
    }
    const stored = JSON.stringify(f.db.query("SELECT * FROM update_counts").all());
    for (const text of [...bodies, stored]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(KEY_SHA256);
    }
  });
});

describe("the admission list the release writes (docs/engineering/services-and-feedback.md#SERV-268)", () => {
  test("a release admitted in R2 is answered, counted, offered and served, with no deploy", async () => {
    const f = fixture();
    github(f, ["0.9.1", "0.9.2"]);
    // Published, not yet admitted: the fallback's signal, as before.
    expect((await f.run()).status).toBe(502);
    expect((await f.run(f.request("/v1/darwin/aarch64/0.9.2"))).status).toBe(400);
    expect(
      (await f.run(f.request("/v1/download/v0.9.2/Proscenium_0.9.2_universal.dmg"))).status,
    ).toBe(404);
    f.objects.set("admission.json", admissionList(["0.9.2"]));
    f.cache.clear(); // the minute passes
    expect(await answer(await f.run())).toEqual({ status: 200, version: "0.9.2" });
    expect(await answer(await f.run(f.request("/v1/darwin/aarch64/0.9.2")))).toEqual({
      status: 200,
      version: "0.9.2",
    });
    const file = await f.run(f.request("/v1/download/v0.9.2/Proscenium_0.9.2_universal.dmg"));
    expect(file.status).toBe(200);
    expect(await file.text()).toBe("signed archive");
    // The deployed list still admits on its own.
    expect((await f.run(f.request("/v1/darwin/aarch64/0.9.0"))).status).toBe(200);
    expect(checks(f)).toEqual([
      { version: "0.9.0", count: 3 },
      { version: "0.9.2", count: 1 },
    ]);
    expect(f.said).toEqual([]);
  });
  test("it is read at most once a minute, through the edge cache", async () => {
    const f = fixture();
    github(f, ["0.9.1", "0.9.2"]);
    expect((await f.run()).status).toBe(502);
    expect(f.cache.get(`${UPDATES}/tracks/admission.json`)?.headers.get("Cache-Control")).toBe(
      "public, max-age=60",
    );
    // Written within the minute: not seen until the cached copy ends.
    f.objects.set("admission.json", admissionList(["0.9.2"]));
    expect((await f.run()).status).toBe(502);
    f.cache.delete(`${UPDATES}/tracks/admission.json`);
    expect((await f.run()).status).toBe(200);
  });
  test("none written admits nothing more; one unreadable or not the list's shape is said and admits and halts nothing", async () => {
    const valid = JSON.parse(admissionList(["0.9.2"], [{ version: "0.9.1", track: "stable" }]));
    const halt = valid.halted[0];
    const broken: [string, string | Uint8Array][] = [
      ["not JSON", "{ stable: [0.9.2] }"],
      ["a version it does not know", JSON.stringify({ ...valid, v: 2 })],
      ["no version", JSON.stringify({ stable: valid.stable, halted: valid.halted })],
      ["a field more", JSON.stringify({ ...valid, admitted: ["0.9.2"] })],
      ["a list that is not one", JSON.stringify({ ...valid, stable: "0.9.2" })],
      ["a version that is not a release", JSON.stringify({ ...valid, stable: ["0.9.2-beta.1"] })],
      ["a halt on no track", JSON.stringify({ ...valid, halted: [{ ...halt, track: "nightly" }] })],
      [
        "a halt whose version is another track's",
        JSON.stringify({ ...valid, halted: [{ ...halt, track: "beta" }] }),
      ],
      ["a halt with no time", JSON.stringify({ ...valid, halted: [{ ...halt, at: "yesterday" }] })],
      ["a halt with a field more", JSON.stringify({ ...valid, halted: [{ ...halt, by: "x" }] })],
      ["too large", JSON.stringify({ ...valid, padding: "x".repeat(70_000) })],
      ["not UTF-8", new Uint8Array([0x7b, 0xff, 0x7d])],
    ];
    for (const [what, content] of broken) {
      const f = fixture();
      github(f, ["0.9.1", "0.9.2"]);
      const bytes =
        typeof content === "string" ? content : new TextDecoder("latin1").decode(content);
      f.env.TRACKS = {
        async get(key: string) {
          if (key !== "admission.json") return null;
          const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
          return { body: new Response(body).body as ReadableStream, size: body.byteLength };
        },
      } as unknown as Env["TRACKS"];
      // Never admitting: 0.9.2 is still refused, and GitHub's 0.9.2 is still not offered.
      expect((await f.run(f.request("/v1/darwin/aarch64/0.9.2"))).status, what).toBe(400);
      expect((await f.run()).status, what).toBe(502);
      // Never halting: the halted 0.9.1 of the valid list would not be served.
      expect(
        (await f.run(f.request("/v1/download/v0.9.1/Proscenium_0.9.1_universal.dmg"))).status,
        what,
      ).toBe(200);
      // Said once for the minute it is kept, and nothing of any request in it.
      expect(f.said, what).toEqual([
        "admission.json is not an admission list: nothing is admitted or halted by it",
      ]);
      expect(bytes.length).toBeGreaterThan(0);
    }
    // The valid list itself admits 0.9.2 and halts 0.9.1.
    expect(parseAdmission(valid)).toEqual({ stable: ["0.9.2"], halted: [halt] });
    const f = fixture();
    expect((await f.run(f.request("/v1/darwin/aarch64/0.9.2"))).status).toBe(400);
    expect(f.said).toEqual([]);
  });
  test("R2 not answering is said, taken as empty, and asked again by the next request", async () => {
    const f = fixture();
    let asked = 0;
    f.env.TRACKS = {
      async get(key: string) {
        if (key === "admission.json") asked++;
        throw new Error("R2 unavailable");
      },
    } as unknown as Env["TRACKS"];
    // The deployed list still answers stable: a check, and the offer of 0.9.1.
    expect(await answer(await f.run())).toEqual({ status: 200, version: "0.9.1" });
    expect(await answer(await f.run())).toEqual({ status: 200, version: "0.9.1" });
    expect(asked).toBeGreaterThanOrEqual(2);
    expect(new Set(f.said)).toEqual(
      new Set([
        "admission.json could not be read: nothing is admitted or halted by it until it can be",
      ]),
    );
  });
  test("its keys are read under the prefix: a stand-in reads `stand-in/`, and nothing at the root", async () => {
    const f = fixture();
    f.deps.prefix = "stand-in/";
    github(f, ["0.9.1", "0.9.2"]);
    f.objects.set("admission.json", admissionList(["0.9.2"]));
    f.objects.set("beta/versions.json", JSON.stringify(["1.0.1-beta.1"]));
    f.objects.set("beta/latest.json", JSON.stringify(trackLatest("beta", "1.0.1-beta.1")));
    // The root's list and track are not the stand-in's.
    expect((await f.run()).status).toBe(502);
    expect((await f.run(f.request("/v1/beta/darwin/aarch64/0.9.1"))).status).toBe(204);
    f.objects.set("stand-in/admission.json", admissionList(["0.9.2"]));
    f.objects.set("stand-in/beta/versions.json", JSON.stringify(["1.0.1-beta.1"]));
    f.objects.set("stand-in/beta/latest.json", JSON.stringify(trackLatest("beta", "1.0.1-beta.1")));
    f.objects.set(
      "stand-in/beta/1.0.1-beta.1/Proscenium_1.0.1-beta.1_universal.dmg",
      "stand-in disk image",
    );
    f.cache.clear();
    expect(await answer(await f.run())).toEqual({ status: 200, version: "0.9.2" });
    expect(await answer(await f.run(f.request("/v1/beta/darwin/aarch64/0.9.1")))).toEqual({
      status: 200,
      version: "1.0.1-beta.1",
    });
    const d = await f.run(
      f.request("/v1/beta/download/v1.0.1-beta.1/Proscenium_1.0.1-beta.1_universal.dmg"),
    );
    expect(await d.text()).toBe("stand-in disk image");
    expect([...f.cache.keys()].filter((k) => k.includes("/tracks/"))).toEqual(
      expect.arrayContaining([
        `${UPDATES}/tracks/stand-in/admission.json`,
        `${UPDATES}/tracks/stand-in/beta/latest.json`,
      ]),
    );
  });
});

describe("a halt stops the offer and deletes nothing (docs/engineering/services-and-feedback.md#SERV-270)", () => {
  const halting = (version: string, track = "stable") =>
    admissionList(["0.9.2"], [{ version, track }]);
  test("GitHub's newest release halted: the release before it is offered in its place, never GitHub's", async () => {
    const f = fixture();
    github(f, ["0.9.1", "0.9.2"]);
    f.objects.set("admission.json", halting("0.9.2"));
    for (const path of ["/v1/darwin/aarch64/0.9.0", "/v1/stable/darwin/x86_64/0.9.0"]) {
      const r = await f.run(f.request(path));
      expect(r.status).toBe(200);
      const data = (await r.json()) as ReturnType<typeof release>;
      expect(data.version).toBe("0.9.1");
      for (const p of Object.values(data.platforms))
        expect(p.url).toBe(`${UPDATES}/v1/update/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz`);
    }
    // An Intel copy on a track is answered as stable answers it.
    expect(await answer(await f.run(f.request("/v1/beta/darwin/x86_64/0.9.0")))).toEqual({
      status: 200,
      version: "0.9.1",
    });
    // The halted release's files are not served as an update; the release before it's are.
    expect(
      (await f.run(f.request("/v1/update/v0.9.2/Proscenium_0.9.2_universal.app.tar.gz"))).status,
    ).toBe(404);
    expect(
      (await f.run(f.request("/v1/update/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz"))).status,
    ).toBe(200);
    // Nothing asked of GitHub was the halted release's file.
    expect(f.calls.map((c) => new URL(c.url).pathname).filter((p) => p.includes("0.9.2_"))).toEqual(
      [],
    );
    // The website's Download names it until it is moved, and is served it as
    // GitHub serves it: a halt deletes nothing (docs/engineering/services-and-feedback.md#SERV-286).
    expect(
      (await f.run(f.request("/v1/download/v0.9.2/Proscenium_0.9.2_universal.dmg"))).status,
    ).toBe(200);
  });
  test("a copy running the halted release is still answered and counted, and offered nothing older", async () => {
    const f = fixture();
    github(f, ["0.9.1", "0.9.2"]);
    f.objects.set("admission.json", halting("0.9.2"));
    // 0.9.1 is not newer than 0.9.2: the updater keeps the copy where it is.
    expect(await answer(await f.run(f.request("/v1/darwin/aarch64/0.9.2")))).toEqual({
      status: 200,
      version: "0.9.1",
    });
    expect(checks(f)).toEqual([{ version: "0.9.2", count: 1 }]);
    // When a better release is out, it is offered to that copy through this service.
    github(f, ["0.9.1", "0.9.2", "0.9.3"]);
    f.objects.set(
      "admission.json",
      admissionList(["0.9.2", "0.9.3"], [{ version: "0.9.2", track: "stable" }]),
    );
    f.cache.clear();
    expect(await answer(await f.run(f.request("/v1/darwin/aarch64/0.9.2")))).toEqual({
      status: 200,
      version: "0.9.3",
    });
  });
  test("with no release before it to offer, or its manifest failing, the answer is 204, never an error", async () => {
    // The only admitted release is the halted one.
    const alone = fixture();
    github(alone, ["0.9.2"]);
    alone.env.RELEASED_VERSIONS_JSON = "[]";
    alone.objects.set(
      "admission.json",
      admissionList(["0.9.2"], [{ version: "0.9.2", track: "stable" }]),
    );
    const r = await alone.run(alone.request("/v1/darwin/aarch64/0.9.2"));
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
    // The release before it is admitted, and its own manifest is not there.
    const missing = fixture();
    github(missing, ["0.9.2"]);
    missing.objects.set("admission.json", halting("0.9.2"));
    expect((await missing.run()).status).toBe(204);
    // Both halted.
    const both = fixture();
    github(both, ["0.9.0", "0.9.1", "0.9.2"]);
    both.objects.set(
      "admission.json",
      admissionList(
        ["0.9.2"],
        [
          { version: "0.9.2", track: "stable" },
          { version: "0.9.1", track: "stable" },
        ],
      ),
    );
    expect(await answer(await both.run())).toEqual({ status: 200, version: "0.9.0" });
  });
  test("while a halt is in force a failure answers 204, since GitHub's manifest names the halted release (docs/engineering/services-and-feedback.md#SERV-271)", async () => {
    for (const [what, fail] of [
      ["GitHub unreachable", () => Promise.reject(new Error("Network connection lost."))],
      ["GitHub refusing", () => Promise.resolve(new Response(null, { status: 503 }))],
      ["a manifest that does not validate", () => Promise.resolve(new Response("broken json"))],
    ] as const) {
      const f = fixture();
      f.deps.fetch = fail;
      f.objects.set("admission.json", halting("0.9.2"));
      expect((await f.run()).status, what).toBe(204);
      // With no halt in force, the same failure is 502, the fallback's signal.
      const plain = fixture();
      plain.deps.fetch = fail;
      expect((await plain.run()).status, what).toBe(502);
      // A halt of an older release is not in force: 0.9.2 is admitted and newer.
      const older = fixture();
      older.deps.fetch = fail;
      older.objects.set("admission.json", halting("0.9.1"));
      expect((await older.run()).status, what).toBe(502);
    }
    // The Worker's own fault too: 204 while a halt is in force, 500 otherwise.
    for (const inForce of [true, false]) {
      const f = fixture();
      f.objects.set("admission.json", inForce ? halting("0.9.2") : admissionList(["0.9.2"]));
      const cache = f.deps.cache;
      f.deps.cache = {
        async match(r) {
          if (
            new URL(typeof r === "string" ? r : r instanceof URL ? r.href : r.url).hostname ===
            "github.com"
          )
            throw new Error("cache");
          return cache.match(r);
        },
        put: cache.put,
      };
      expect((await f.run()).status).toBe(inForce ? 204 : 500);
    }
  });
  test("a halted track version is not offered: its check hears nothing newer and its files are not served", async () => {
    const f = fixture();
    f.objects.set("admission.json", halting("1.0.1-alpha.58", "alpha"));
    const r = await f.run(f.request("/v1/alpha/darwin/aarch64/1.0.1-alpha.57", keyed));
    expect(r.status).toBe(204);
    expect(await r.text()).toBe("");
    for (const suffix of [".app.tar.gz", ".app.tar.gz.sig", ".dmg"])
      expect(
        (
          await f.run(
            f.request(
              `/v1/alpha/download/v1.0.1-alpha.58/Proscenium_1.0.1-alpha.58_universal${suffix}`,
              keyed,
            ),
          )
        ).status,
      ).toBe(404);
    // A copy on the halted version is answered and counted; alpha still asks for its key first.
    expect((await f.run(f.request("/v1/alpha/darwin/aarch64/1.0.1-alpha.58", keyed))).status).toBe(
      204,
    );
    expect((await f.run(f.request("/v1/alpha/darwin/aarch64/1.0.1-alpha.58"))).status).toBe(404);
    expect(checks(f)).toEqual([
      { version: "1.0.1-alpha.57", count: 1 },
      { version: "1.0.1-alpha.58", count: 1 },
    ]);
    // A beta halted the same way; the track it names is the one halted.
    const b = fixture();
    b.objects.set("beta/versions.json", JSON.stringify(["1.0.1-beta.1", "1.0.1-beta.2"]));
    b.objects.set("beta/latest.json", JSON.stringify(trackLatest("beta", "1.0.1-beta.2")));
    b.objects.set("beta/1.0.1-beta.1/Proscenium_1.0.1-beta.1_universal.dmg", "beta 1");
    b.objects.set("beta/1.0.1-beta.2/Proscenium_1.0.1-beta.2_universal.dmg", "beta 2");
    b.objects.set("admission.json", halting("1.0.1-beta.2", "beta"));
    expect((await b.run(b.request("/v1/beta/darwin/aarch64/0.9.1"))).status).toBe(204);
    expect(
      (
        await b.run(
          b.request("/v1/beta/download/v1.0.1-beta.2/Proscenium_1.0.1-beta.2_universal.dmg"),
        )
      ).status,
    ).toBe(404);
    expect(
      await (
        await b.run(
          b.request("/v1/beta/download/v1.0.1-beta.1/Proscenium_1.0.1-beta.1_universal.dmg"),
        )
      ).text(),
    ).toBe("beta 1");
    // Stable is untouched by a track's halt.
    expect(await answer(await b.run())).toEqual({ status: 200, version: "0.9.1" });
  });
  test("a halt deletes nothing: the Worker reads R2 and never writes it", async () => {
    const f = fixture();
    github(f, ["0.9.1", "0.9.2"]);
    const before = new Map(f.objects);
    f.objects.set("admission.json", halting("0.9.2"));
    await f.run();
    await f.run(f.request("/v1/download/v0.9.2/Proscenium_0.9.2_universal.dmg"));
    f.objects.delete("admission.json");
    expect(f.objects).toEqual(before);
    const source = await Bun.file(new URL("../src/updates.ts", import.meta.url)).text();
    expect(source).not.toMatch(
      /\.(put|delete)\(\s*`?\$\{source\.prefix|TRACKS\.(put|delete)|bucket\.(put|delete)/,
    );
  });
});

describe("Windows, beside the Mac (docs/engineering/services-and-feedback.md#SERV-283)", () => {
  /** A beta that carries Windows: its manifest, its list and its files in R2. */
  function windowsBeta(f: ReturnType<typeof fixture>, v = "1.0.1-beta.1") {
    f.objects.set("beta/versions.json", JSON.stringify([v]));
    f.objects.set(
      "beta/latest.json",
      JSON.stringify(withWindows(armLatest("beta", v), `${UPDATES}/v1/beta`)),
    );
    for (const chip of ["x64", "arm64"])
      for (const suffix of ["", ".sig"])
        f.objects.set(
          `beta/${v}/Proscenium_${v}_${chip}-setup.exe${suffix}`,
          `beta ${chip}${suffix}`,
        );
  }
  const counted = (f: ReturnType<typeof fixture>) =>
    f.db
      .query(
        "SELECT platform, arch, version, os, count FROM update_counts WHERE kind = 'check' ORDER BY arch",
      )
      .all();
  test("a Windows check is answered with Windows' entries alone, each on its own installer's route, and counted as Windows'", async () => {
    const f = fixture();
    github(f, ["0.9.0", "0.9.1"], windowsRelease);
    for (const path of ["/v1/windows/x86_64/0.9.0", "/v1/stable/windows/aarch64/0.9.0"]) {
      const r = await f.run(f.request(path, WINDOWS_11));
      expect(r.status).toBe(200);
      const text = await r.text();
      expect(JSON.parse(text)).toEqual({
        version: "0.9.1",
        platforms: {
          "windows-x86_64": {
            signature: "w".repeat(100),
            url: `${UPDATES}/v1/update/v0.9.1/Proscenium_0.9.1_x64-setup.exe`,
          },
          "windows-aarch64": {
            signature: "v".repeat(100),
            url: `${UPDATES}/v1/update/v0.9.1/Proscenium_0.9.1_arm64-setup.exe`,
          },
        },
        notes: "A release.",
        pub_date: "2026-09-18T12:00:00Z",
      });
      // Nothing of the Mac's is in a Windows copy's answer.
      expect(text).not.toContain("darwin");
    }
    expect(counted(f)).toEqual([
      { platform: "windows", arch: "aarch64", version: "0.9.0", os: "10.0.26100", count: 1 },
      { platform: "windows", arch: "x86_64", version: "0.9.0", os: "10.0.26100", count: 1 },
    ]);
  });
  test("a manifest naming Windows answers a Mac exactly as one that does not", async () => {
    const paths = [
      "/v1/darwin/aarch64/0.9.0",
      "/v1/stable/darwin/x86_64/0.9.0",
      "/v1/beta/darwin/aarch64/0.9.1",
      "/v1/beta/darwin/x86_64/0.9.1",
    ];
    const answers = async (windows: boolean) => {
      const f = fixture();
      github(f, ["0.9.0", "0.9.1"], windows ? windowsRelease : release);
      f.objects.set("beta/versions.json", JSON.stringify(["1.0.1-beta.1"]));
      const beta = armLatest("beta", "1.0.1-beta.1");
      f.objects.set(
        "beta/latest.json",
        JSON.stringify(windows ? withWindows(beta, `${UPDATES}/v1/beta`) : beta),
      );
      const out: { status: number; headers: [string, string][]; body: string }[] = [];
      for (const path of paths) {
        const r = await f.run(f.request(path));
        out.push({ status: r.status, headers: [...r.headers], body: await r.text() });
      }
      return out;
    };
    const mac = await answers(false);
    expect(mac.map((a) => a.status)).toEqual([200, 200, 200, 200]);
    expect(await answers(true)).toEqual(mac);
  });
  test("a manifest naming the Mac alone stays valid: a Mac is answered, and a Windows copy hears nothing newer", async () => {
    const f = fixture();
    f.objects.set("beta/versions.json", JSON.stringify(["1.0.1-beta.1"]));
    f.objects.set("beta/latest.json", JSON.stringify(armLatest("beta", "1.0.1-beta.1")));
    for (const path of [
      "/v1/windows/x86_64/0.9.0",
      "/v1/stable/windows/aarch64/0.9.0",
      "/v1/beta/windows/x86_64/0.9.1",
      "/v1/beta/windows/aarch64/0.9.1",
    ]) {
      const r = await f.run(f.request(path, WINDOWS_11));
      expect(r.status, path).toBe(204);
      expect(await r.text()).toBe("");
    }
    expect((await f.run(f.request("/v1/darwin/aarch64/0.9.0"))).status).toBe(200);
    expect((await f.run(f.request("/v1/beta/darwin/aarch64/0.9.1"))).status).toBe(200);
    // Counted as the checks they are: each chip, from 0.9.0 on stable and 0.9.1 on beta.
    expect(
      counted(f)
        .filter((row) => (row as { platform: string }).platform === "windows")
        .map((row) => (row as { count: number }).count),
    ).toEqual([1, 1, 1, 1]);
  });
  test("x86_64 Windows is not an Intel Mac: on a track it is answered from the track's manifest", async () => {
    const f = fixture();
    windowsBeta(f);
    const windows = await f.run(f.request("/v1/beta/windows/x86_64/0.9.1", WINDOWS_11));
    expect(windows.status).toBe(200);
    const data = (await windows.json()) as Manifest;
    expect(data.version).toBe("1.0.1-beta.1");
    expect(data.platforms["windows-x86_64"].url).toBe(
      `${UPDATES}/v1/beta/update/v1.0.1-beta.1/Proscenium_1.0.1-beta.1_x64-setup.exe`,
    );
    expect(Object.keys(data.platforms)).toEqual(["windows-x86_64", "windows-aarch64"]);
    // An Intel Mac on the same track still takes stable's release.
    expect(await answer(await f.run(f.request("/v1/beta/darwin/x86_64/0.9.1")))).toEqual({
      status: 200,
      version: "0.9.1",
    });
    // Alpha still answers only its key, whoever asks; and its manifest names no Windows build.
    expect((await f.run(f.request("/v1/alpha/windows/x86_64/0.9.1", WINDOWS_11))).status).toBe(404);
    expect(
      (await f.run(f.request("/v1/alpha/windows/x86_64/0.9.1", { ...WINDOWS_11, ...keyed })))
        .status,
    ).toBe(204);
  });
  test("Windows' version is 10.0.<build>, from Windows 10 22H2's build 19045; a Mac's stays major.minor from 14", async () => {
    const f = fixture();
    github(f, ["0.9.0", "0.9.1"], windowsRelease);
    for (const os of [
      "10.0.19045",
      "10.0.19999",
      "10.0.22000",
      "10.0.22631",
      "10.0.26100",
      "10.0.28000",
    ])
      expect(
        (await f.run(f.request("/v1/windows/x86_64/0.9.0", { "Proscenium-OS": os }))).status,
        os,
      ).toBe(200);
    for (const os of [
      "10.0.19044", // Windows 10 21H2, below the floor
      "10.0.10240",
      "10.0",
      "10.0.026100",
      "10.0.26100.4652", // the update revision is not sent
      "11.0.26100",
      "14.6", // a Mac's, from Windows
      "",
    ])
      for (const path of ["/v1/windows/x86_64/0.9.0", "/v1/beta/windows/aarch64/0.9.0"])
        expect(
          (await f.run(f.request(path, { "Proscenium-OS": os }))).status,
          `${path} ${os}`,
        ).toBe(400);
    // Windows' version from a Mac is refused, as it was.
    expect((await f.run(f.request("/v1/darwin/aarch64/0.9.0", WINDOWS_11))).status).toBe(400);
    expect(counted(f)).toEqual([
      { platform: "windows", arch: "x86_64", version: "0.9.0", os: "10.0.19045", count: 1 },
      { platform: "windows", arch: "x86_64", version: "0.9.0", os: "10.0.19999", count: 1 },
      { platform: "windows", arch: "x86_64", version: "0.9.0", os: "10.0.22000", count: 1 },
      { platform: "windows", arch: "x86_64", version: "0.9.0", os: "10.0.22631", count: 1 },
      { platform: "windows", arch: "x86_64", version: "0.9.0", os: "10.0.26100", count: 1 },
      { platform: "windows", arch: "x86_64", version: "0.9.0", os: "10.0.28000", count: 1 },
    ]);
  });
  test("a release's installers are served only when its manifest names them; a track's from its own objects", async () => {
    const files = [
      "Proscenium_0.9.1_x64-setup.exe",
      "Proscenium_0.9.1_x64-setup.exe.sig",
      "Proscenium_0.9.1_arm64-setup.exe",
      "Proscenium_0.9.1_arm64-setup.exe.sig",
    ];
    const f = fixture();
    github(f, ["0.9.0", "0.9.1"], windowsRelease);
    for (const file of files) {
      f.calls.length = 0;
      const r = await f.run(f.request(`/v1/download/v0.9.1/${file}`));
      expect(r.status, file).toBe(200);
      expect(await r.text()).toBe("signed archive");
      expect(f.calls.map((c) => c.url).at(-1)).toBe(`${GITHUB}/download/v0.9.1/${file}`);
    }
    // A release whose manifest names no Windows build serves none, and asks GitHub for none.
    const mac = fixture();
    for (const file of files) {
      mac.calls.length = 0;
      expect((await mac.run(mac.request(`/v1/stable/download/v0.9.1/${file}`))).status, file).toBe(
        404,
      );
      expect(mac.calls.map((c) => c.url).filter((u) => u.includes("setup"))).toEqual([]);
    }
    // Only the installers' own names.
    for (const file of [
      "Proscenium_0.9.1_x86_64-setup.exe",
      "Proscenium_0.9.1_aarch64-setup.exe",
      "Proscenium_0.9.1_x64_en-US.msi",
      "Proscenium_0.9.1_x64-setup.nsis.zip",
      "Proscenium_0.9.0_x64-setup.exe",
    ])
      expect((await f.run(f.request(`/v1/download/v0.9.1/${file}`))).status, file).toBe(404);
    // A track's, from R2, for a version on its list.
    const t = fixture();
    windowsBeta(t);
    for (const [file, body] of [
      ["Proscenium_1.0.1-beta.1_x64-setup.exe", "beta x64"],
      ["Proscenium_1.0.1-beta.1_arm64-setup.exe.sig", "beta arm64.sig"],
    ]) {
      const r = await t.run(t.request(`/v1/beta/download/v1.0.1-beta.1/${file}`));
      expect(r.status).toBe(200);
      expect(await r.text()).toBe(body);
    }
    expect(
      (
        await t.run(
          t.request("/v1/beta/download/v1.0.1-beta.9/Proscenium_1.0.1-beta.9_x64-setup.exe"),
        )
      ).status,
    ).toBe(404);
  });
  test("each system is judged on its own part alone: a broken Windows part never changes a Mac's answer, and a broken Mac part answers Windows", async () => {
    /** Windows' part broken the way a failed Arm build would leave it: one chip without the other. */
    const oneChip = <M extends Manifest>(m: M): M => {
      const out = structuredClone(m);
      delete out.platforms["windows-aarch64"];
      return out;
    };
    const macPaths = [
      "/v1/darwin/aarch64/0.9.0",
      "/v1/stable/darwin/x86_64/0.9.0",
      "/v1/beta/darwin/aarch64/0.9.1",
      "/v1/beta/darwin/x86_64/0.9.1",
      "/v1/download/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz",
      "/v1/download/v0.9.1/Proscenium_0.9.1_universal.dmg",
    ];
    const world = (releaseOf: (v: string) => Manifest, betaOf: (m: Manifest) => Manifest) => {
      const f = fixture();
      github(f, ["0.9.0", "0.9.1"], releaseOf);
      windowsBeta(f);
      f.objects.set(
        "beta/latest.json",
        JSON.stringify(
          betaOf(withWindows(armLatest("beta", "1.0.1-beta.1"), `${UPDATES}/v1/beta`)),
        ),
      );
      return f;
    };
    const asked = async (f: ReturnType<typeof fixture>, paths: string[], headers = {}) => {
      const out: { path: string; status: number; body: string }[] = [];
      for (const path of paths) {
        const r = await f.run(f.request(path, headers));
        out.push({ path, status: r.status, body: await r.text() });
      }
      return out;
    };
    // The Mac's answers with Windows' part broken are the Mac's with Windows' part absent,
    // asked twice: the second time from the edge cache, which keeps the broken part as it was.
    const macOnly = world(release, (m) => ({
      ...m,
      platforms: { "darwin-aarch64": m.platforms["darwin-aarch64"] },
    }));
    const brokenWindows = world((v) => oneChip(windowsRelease(v)), oneChip);
    const expected = await asked(macOnly, macPaths);
    expect(expected.map((a) => a.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(await asked(brokenWindows, macPaths)).toEqual(expected);
    expect(await asked(brokenWindows, macPaths)).toEqual(expected);
    // Windows' copies hear that their part is broken: the source's failure, 502, from
    // the cache as from GitHub; and the release's installers are not served from it.
    for (let i = 0; i < 2; i++)
      expect(
        (
          await asked(
            brokenWindows,
            ["/v1/windows/x86_64/0.9.0", "/v1/beta/windows/x86_64/0.9.1"],
            WINDOWS_11,
          )
        ).map((a) => a.status),
      ).toEqual([502, 502]);
    expect(
      (
        await brokenWindows.run(
          brokenWindows.request("/v1/download/v0.9.1/Proscenium_0.9.1_x64-setup.exe"),
        )
      ).status,
    ).toBe(502);
    // And the other way: the Mac's part broken answers a Mac 502, as it always has, and Windows as it should be.
    const brokenMac = world(
      (v) => {
        const m = windowsRelease(v);
        m.platforms["darwin-x86_64"].url = "https://evil.test/archive";
        return m;
      },
      (m) => ({
        ...m,
        platforms: { ...m.platforms, "darwin-x86_64": m.platforms["darwin-aarch64"] },
      }),
    );
    expect(
      (await asked(brokenMac, ["/v1/darwin/aarch64/0.9.0", "/v1/beta/darwin/aarch64/0.9.1"])).map(
        (a) => a.status,
      ),
    ).toEqual([502, 502]);
    const windows = await asked(
      brokenMac,
      ["/v1/windows/x86_64/0.9.0", "/v1/beta/windows/aarch64/0.9.1"],
      WINDOWS_11,
    );
    expect(windows.map((a) => [a.status, (JSON.parse(a.body) as Manifest).version])).toEqual([
      [200, "0.9.1"],
      [200, "1.0.1-beta.1"],
    ]);
    // A key of no system we build is no system's part: neither is answered it, nor refused for it.
    const stray = world(
      (v) => {
        const m: Manifest = windowsRelease(v);
        return {
          ...m,
          platforms: { ...m.platforms, "linux-x86_64": m.platforms["windows-x86_64"] },
        };
      },
      (m) => m,
    );
    const answered = await asked(stray, ["/v1/darwin/aarch64/0.9.0"]);
    expect(answered).toEqual([expected[0]]);
    expect((await asked(stray, ["/v1/windows/x86_64/0.9.0"], WINDOWS_11))[0].body).not.toContain(
      "linux",
    );
  });
  test("read per system, each broken part is its own system's alone", () => {
    const good: Manifest = windowsRelease("0.9.1");
    const read = (m: Manifest) => {
      const r = readManifest(m);
      return { broken: r.broken, stray: r.stray, platforms: Object.keys(r.manifest.platforms) };
    };
    const mac = ["darwin-aarch64", "darwin-x86_64"];
    const windows = ["windows-x86_64", "windows-aarch64"];
    expect(read(good)).toEqual({ broken: [], stray: [], platforms: [...mac, ...windows] });
    expect(read(release("0.9.1"))).toEqual({ broken: [], stray: [], platforms: mac });
    const edit = (change: (p: Record<string, { signature: string; url: string }>) => void) => {
      const m = structuredClone(good);
      change(m.platforms);
      return m;
    };
    for (const [what, m] of [
      ["one chip", edit((p) => delete p["windows-aarch64"])],
      ["an installer elsewhere", edit((p) => (p["windows-x86_64"].url = "https://evil.test/x"))],
      ["a bad signature", edit((p) => (p["windows-aarch64"].signature = "not a signature"))],
      ["an installer's own key", edit((p) => (p["windows-x86_64-nsis"] = p["windows-x86_64"]))],
    ] as const)
      expect(read(m), what).toEqual({ broken: ["windows"], stray: [], platforms: mac });
    for (const [what, m] of [
      ["no Mac", edit((p) => (delete p["darwin-aarch64"], delete p["darwin-x86_64"]))],
      ["half a Mac", edit((p) => delete p["darwin-x86_64"])],
      ["a Mac archive elsewhere", edit((p) => (p["darwin-aarch64"].url = "https://evil.test/x"))],
      ["a Mac installer's own key", edit((p) => (p["darwin-aarch64-app"] = p["darwin-aarch64"]))],
    ] as const)
      expect(read(m), what).toEqual({ broken: ["darwin"], stray: [], platforms: windows });
    expect(read(edit((p) => (p["linux-x86_64"] = p["windows-x86_64"])))).toEqual({
      broken: [],
      stray: ["linux-x86_64"],
      platforms: [...mac, ...windows],
    });
    // What every system shares is still refused whole.
    expect(() => readManifest({ ...good, notes: 7 })).toThrow();
    expect(() => readManifest({ ...good, version: "0.9.1-beta.1" })).toThrow();
    expect(() => readManifest({ ...good, extra: true })).toThrow();
  });
  test("a manifest's Windows part is both chips or none, each its own installer at its own address: anything else is not a manifest a release writes", () => {
    const good: Manifest = windowsRelease("0.9.1");
    expect(() => parseManifest(good)).not.toThrow();
    expect(Object.keys(parseManifest(good).platforms)).toEqual([
      "darwin-aarch64",
      "darwin-x86_64",
      "windows-x86_64",
      "windows-aarch64",
    ]);
    const without = (key: string) => {
      const m = structuredClone(good);
      delete (m.platforms as Record<string, unknown>)[key];
      return m;
    };
    const changed = (key: string, url: string) => {
      const m = structuredClone(good);
      (m.platforms as Record<string, { url: string }>)[key].url = url;
      return m;
    };
    for (const [what, m] of [
      ["one chip without the other", without("windows-aarch64")],
      ["Windows without the Mac", without("darwin-aarch64")],
      [
        "x64's entry naming Arm's installer",
        changed("windows-x86_64", `${GITHUB}/download/v0.9.1/Proscenium_0.9.1_arm64-setup.exe`),
      ],
      [
        "an installer naming the Mac's archive",
        changed(
          "windows-x86_64",
          `${GITHUB}/download/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz`,
        ),
      ],
      [
        "the Mac's entry naming an installer",
        changed("darwin-x86_64", `${GITHUB}/download/v0.9.1/Proscenium_0.9.1_x64-setup.exe`),
      ],
      [
        "another version's installer",
        changed("windows-x86_64", `${GITHUB}/download/v0.9.0/Proscenium_0.9.0_x64-setup.exe`),
      ],
      [
        "an installer elsewhere",
        changed("windows-x86_64", "https://evil.test/Proscenium_0.9.1_x64-setup.exe"),
      ],
      [
        "a platform we do not build",
        {
          ...good,
          platforms: { ...good.platforms, "linux-x86_64": good.platforms["windows-x86_64"] },
        },
      ],
      [
        "an installer's own key",
        {
          ...good,
          platforms: { ...good.platforms, "windows-x86_64-nsis": good.platforms["windows-x86_64"] },
        },
      ],
    ] as const)
      expect(() => parseManifest(m), what).toThrow();
    // A track's: on the track's own route, beside an Apple-silicon or a universal Mac build.
    for (const mac of [armLatest("beta", "1.0.1-beta.1"), trackLatest("beta", "1.0.1-beta.1")]) {
      expect(() =>
        parseTrackManifest(withWindows(mac, `${UPDATES}/v1/beta`), "beta"),
      ).not.toThrow();
      expect(() => parseTrackManifest(withWindows(mac, `${UPDATES}/v1/alpha`), "beta")).toThrow();
      expect(() => parseTrackManifest(withWindows(mac, GITHUB), "beta")).toThrow();
    }
  });
  test("a halt answers Windows as it answers the Mac: the release before it, its Windows build if it has one", async () => {
    const f = fixture();
    github(f, ["0.9.1", "0.9.2"], windowsRelease);
    f.objects.set(
      "admission.json",
      admissionList(["0.9.2"], [{ version: "0.9.2", track: "stable" }]),
    );
    const r = await f.run(f.request("/v1/windows/aarch64/0.9.0", WINDOWS_11));
    expect(r.status).toBe(200);
    const data = (await r.json()) as Manifest;
    expect(data.version).toBe("0.9.1");
    expect(data.platforms["windows-aarch64"].url).toBe(
      `${UPDATES}/v1/update/v0.9.1/Proscenium_0.9.1_arm64-setup.exe`,
    );
    // The release before carried no Windows build: nothing newer, never an error.
    const g = fixture();
    github(g, ["0.9.1", "0.9.2"], (v) => (v === "0.9.2" ? windowsRelease(v) : release(v)));
    g.objects.set(
      "admission.json",
      admissionList(["0.9.2"], [{ version: "0.9.2", track: "stable" }]),
    );
    expect((await g.run(g.request("/v1/windows/aarch64/0.9.0", WINDOWS_11))).status).toBe(204);
    expect(await answer(await g.run(g.request("/v1/darwin/aarch64/0.9.0")))).toEqual({
      status: 200,
      version: "0.9.1",
    });
  });
});
