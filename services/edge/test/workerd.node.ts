// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The deployed bundle, in the runtime that runs it. The other tests drive the
 * source in Bun with fakes, and Bun's fetch accepts any receiver, so every
 * stable check passed here while production answered 502 for eight days: the
 * first entry handed fetch over as `{ fetch }`, which workerd refuses. The
 * local rehearsal missed it too, because it ran its own entry.
 *
 * So this builds `src/index.ts` exactly as `wrangler deploy` bundles it, runs
 * it in workerd (Miniflare) with a GitHub stand-in as its only way out, and
 * asks the stable routes. The entry of the first deploy runs beside it, as the
 * negative control: in workerd it must answer 500, the Worker's own fault
 * (docs/engineering/services-and-feedback.md#SERV-266), and reach nobody.
 *
 * The same bundle then reads an admission list and a halt from its R2 bucket
 * (docs/engineering/services-and-feedback.md#SERV-268,
 * docs/engineering/services-and-feedback.md#SERV-270), and writes its one line
 * (docs/engineering/services-and-feedback.md#SERV-275); and the stand-in's
 * bundle, built from wrangler.standin.jsonc, serves a stand-in release from its
 * `stand-in/` keys and its loopback GitHub
 * (docs/engineering/services-and-feedback.md#SERV-274).
 *
 * Node, not `bun test`: Miniflare is a Node library, and under Bun its
 * dispatch loses the address the request was made to. `bun run test:workerd`.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { GITHUB, UPDATES } from "../src/updates.ts";
import { STANDIN_CONFIG, standInConfig } from "./standin.ts";
import { CRASH_HEADERS, crashEnvelope } from "./standin-crash.ts";

const EDGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const archive = "Proscenium_1.0.0_universal.app.tar.gz";
/** A release's manifest as GitHub serves it, its archive at `github`. */
const release = (version: string, github = GITHUB) => {
  const url = `${github}/download/v${version}/Proscenium_${version}_universal.app.tar.gz`;
  return {
    version,
    pub_date: "2026-09-26T12:00:00Z",
    platforms: {
      "darwin-aarch64": { signature: "a".repeat(100), url },
      "darwin-x86_64": { signature: "a".repeat(100), url },
    },
  };
};
const manifest = release("1.0.0");
const PRODUCTION_VARS = {
  UPDATES_ENABLED: "true",
  DOWNLOADS_ENABLED: "true",
  RELEASED_VERSIONS_JSON: '["0.9.0","1.0.0"]',
};

/** What the stand-in answers, per test, and every request that reached it. */
let github: (url: URL) => Response = () => new Response(null, { status: 404 });
const outbound: { url: string; userAgent: string | null }[] = [];
/** The Sentry stand-in's origin, and the envelopes it received. */
let sentryOrigin: string | null = null;
const envelopes: { url: string; contentType: string | null; body: string }[] = [];
/** What the bundles wrote of their own: the Worker's one line, and only it. */
const logs: { level: string; message: string }[] = [];

const out = mkdtempSync(join(tmpdir(), "edge-workerd-"));
/** The bundle `wrangler deploy` would upload, for this entry or this configuration. */
function bundle(entry: string | null, name: string, config?: string): string {
  const dir = join(out, name);
  const r = spawnSync(
    join(EDGE, "node_modules/.bin/wrangler"),
    [
      "deploy",
      ...(entry ? [entry] : []),
      ...(config ? ["--config", config] : []),
      "--dry-run",
      "--outdir",
      dir,
    ],
    {
      cwd: EDGE,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
      encoding: "utf8",
    },
  );
  if (r.status !== 0)
    throw new Error(
      `wrangler could not bundle ${entry ?? config ?? "the production entry"}:\n${r.stderr}`,
    );
  // Named after the entry: index.js for the production one.
  const [script] = readdirSync(dir).filter((file) => file.endsWith(".js"));
  return readFileSync(join(dir, script), "utf8");
}
async function start(
  script: string,
  {
    bindings = PRODUCTION_VARS as Record<string, string>,
    objects = {} as Record<string, string>,
  } = {},
): Promise<Miniflare> {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: "2026-09-18",
      bindings,
      d1Databases: { DB: "db" },
      r2Buckets: { TRACKS: "tracks" },
      ratelimits: {
        UPDATE_LIMIT: { namespace_id: "7001", simple: { limit: 1000, period: 60 } },
        DOWNLOAD_LIMIT: { namespace_id: "7002", simple: { limit: 1000, period: 60 } },
        FEEDBACK_LIMIT: { namespace_id: "7003", simple: { limit: 1000, period: 60 } },
        CRASH_LIMIT: { namespace_id: "7005", simple: { limit: 1000, period: 60 } },
      },
      outboundService: async (request: Request) => {
        outbound.push({ url: request.url, userAgent: request.headers.get("User-Agent") });
        if (sentryOrigin !== null && new URL(request.url).origin === sentryOrigin) {
          envelopes.push({
            url: request.url,
            contentType: request.headers.get("Content-Type"),
            body: await request.text(),
          });
          return Response.json({ id: "stand-in" });
        }
        return github(new URL(request.url));
      },
      handleStructuredLogs: (log: { level: string; message: string }) => {
        logs.push({ level: log.level, message: log.message });
      },
    }),
  );
  const db = await mf.getD1Database("DB");
  for (const file of readdirSync(join(EDGE, "migrations")).sort()) {
    await db.exec(
      readFileSync(join(EDGE, "migrations", file), "utf8")
        .replace(/--[^\n]*/g, "")
        .replace(/\s*\n\s*/g, " "),
    );
  }
  const tracks = await mf.getR2Bucket("TRACKS");
  for (const [key, value] of Object.entries(objects)) await tracks.put(key, value);
  return mf;
}

let productionScript: string;
let production: Miniflare;
let firstDeploy: Miniflare;
before(async () => {
  productionScript = bundle(null, "production");
  production = await start(productionScript);
  firstDeploy = await start(bundle("test/fixtures/misbound-entry.ts", "first-deploy"));
});
after(async () => {
  await Promise.all([production?.dispose(), firstDeploy?.dispose()]);
  rmSync(out, { recursive: true, force: true });
});

const ask = (mf: Miniflare, path: string, origin = UPDATES) =>
  mf.dispatchFetch(`${origin}${path}`, { headers: { "Proscenium-OS": "26.0" } });
const releasedGithub = (url: URL) =>
  url.pathname.endsWith("/latest.json")
    ? Response.json(manifest)
    : url.pathname.endsWith(`/v1.0.0/${archive}`)
      ? new Response("signed archive")
      : new Response(null, { status: 404 });
/** GitHub with these releases published at `base`, the last one newest. */
const publishedGithub =
  (published: string[], base = GITHUB) =>
  (url: URL) => {
    const path = url.href.slice(base.length);
    if (!url.href.startsWith(`${base}/`)) return new Response(null, { status: 404 });
    if (path === "/latest/download/latest.json")
      return Response.json(release(published[published.length - 1], base));
    const [, version, file] = /^\/download\/v([^/]+)\/([^/]+)$/.exec(path) ?? [];
    if (!published.includes(version)) return new Response(null, { status: 404 });
    return file === "latest.json"
      ? Response.json(release(version, base))
      : new Response(`${version} ${file}`);
  };
const halt = (version: string, track = "stable") => ({
  version,
  track,
  at: "2026-10-09T14:00:00Z",
  why: "It crashes on open.",
});
const version = async (r: { json(): Promise<unknown> }) =>
  ((await r.json()) as { version: string }).version;

describe("the deployed bundle in workerd", () => {
  // First: a manifest the Worker has read stays in its edge cache for five minutes.
  test("GitHub refusing or missing a release is 502, the fallback's signal", async () => {
    for (const status of [403, 404, 503]) {
      github = () => new Response(null, { status });
      const r = await ask(production, `/v1/darwin/x86_64/${status === 403 ? "0.9.0" : "1.0.0"}`);
      assert.equal(r.status, 502);
      assert.equal(await r.text(), "");
    }
  });
  test("a stable check and download reach GitHub, naming the service and nothing else", async () => {
    github = releasedGithub;
    outbound.length = 0;
    const check = await ask(production, "/v1/stable/darwin/aarch64/1.0.0");
    assert.equal(check.status, 200);
    assert.equal(
      ((await check.json()) as typeof manifest).platforms["darwin-aarch64"].url,
      `${UPDATES}/v1/download/v1.0.0/${archive}`,
    );
    const download = await ask(production, `/v1/download/v1.0.0/${archive}`);
    assert.equal(download.status, 200);
    assert.equal(await download.text(), "signed archive");
    assert.ok(outbound.length > 0);
    for (const request of outbound) assert.equal(request.userAgent, "proscenium-updates");
  });
  test("the first deploy's entry is the Worker's own fault: 500, and GitHub is never asked", async () => {
    github = releasedGithub;
    outbound.length = 0;
    for (const path of ["/v1/darwin/aarch64/1.0.0", `/v1/download/v1.0.0/${archive}`]) {
      const r = await ask(firstDeploy, path);
      assert.equal(r.status, 500);
      assert.equal(await r.text(), "");
    }
    assert.deepEqual(outbound, []);
  });
  test("with no admission list in its bucket, the bundle said nothing of its own", () => {
    assert.deepEqual(
      logs.filter((l) => l.message.includes("admission")),
      [],
    );
  });
});

describe("the deployed bundle reads the release's admission list and its halts from R2", () => {
  test("a release admitted in R2 is answered, offered and served; its halt offers the one before it", async () => {
    github = publishedGithub(["1.0.0", "1.0.1"]);
    const admitting = await start(productionScript, {
      objects: {
        "admission.json": JSON.stringify({ v: 1, stable: ["1.0.1"], halted: [] }),
        // A stand-in's keys are not production's.
        "stand-in/admission.json": JSON.stringify({ v: 1, stable: ["1.0.2"], halted: [] }),
      },
    });
    try {
      const check = await ask(admitting, "/v1/darwin/aarch64/1.0.1");
      assert.equal(check.status, 200);
      assert.equal(await version(check), "1.0.1");
      assert.equal((await ask(admitting, "/v1/darwin/aarch64/1.0.2")).status, 400);
      const file = await ask(admitting, "/v1/download/v1.0.1/Proscenium_1.0.1_universal.dmg");
      assert.equal(file.status, 200);
      assert.equal(await file.text(), "1.0.1 Proscenium_1.0.1_universal.dmg");
    } finally {
      await admitting.dispose();
    }
    const halting = await start(productionScript, {
      objects: {
        "admission.json": JSON.stringify({ v: 1, stable: ["1.0.1"], halted: [halt("1.0.1")] }),
      },
    });
    try {
      outbound.length = 0;
      for (const asking of ["0.9.0", "1.0.1"]) {
        const r = await ask(halting, `/v1/darwin/aarch64/${asking}`);
        assert.equal(r.status, 200, `a check from ${asking}`);
        assert.equal(await version(r), "1.0.0");
      }
      const r = await ask(halting, "/v1/download/v1.0.1/Proscenium_1.0.1_universal.dmg");
      assert.equal(r.status, 404);
      assert.deepEqual(
        outbound.map((o) => o.url).filter((u) => u.includes("Proscenium_1.0.1")),
        [],
      );
    } finally {
      await halting.dispose();
    }
  });
  test("a halt in force answers 204 where GitHub fails, never the error that sends the updater to GitHub", async () => {
    github = () => new Response(null, { status: 503 });
    const halting = await start(productionScript, {
      objects: {
        "admission.json": JSON.stringify({ v: 1, stable: ["1.0.1"], halted: [halt("1.0.1")] }),
      },
    });
    try {
      const r = await ask(halting, "/v1/darwin/aarch64/1.0.0");
      assert.equal(r.status, 204);
      assert.equal(await r.text(), "");
    } finally {
      await halting.dispose();
    }
  });
  test("a list that is not one admits and halts nothing, and is said in the Worker's one line", async () => {
    github = publishedGithub(["1.0.0", "1.0.1"]);
    logs.length = 0;
    const broken = await start(productionScript, {
      objects: { "admission.json": '{"v":1,"stable":["1.0.1"],"halted":[{"version":"1.0.0"}]}' },
    });
    try {
      assert.equal((await ask(broken, "/v1/darwin/aarch64/1.0.1")).status, 400);
      // GitHub's 1.0.1 is not admitted: the fallback's signal, as before any list.
      assert.equal((await ask(broken, "/v1/darwin/aarch64/1.0.0")).status, 502);
      const said = logs.filter((l) => l.message.includes("admission"));
      assert.deepEqual(said, [
        {
          level: "error",
          message: "admission.json is not an admission list: nothing is admitted or halted by it",
        },
      ]);
    } finally {
      await broken.dispose();
    }
  });
});

describe("the deployed bundle answers Windows beside the Mac (docs/engineering/services-and-feedback.md#SERV-283)", () => {
  /** A release that carries Windows: an installer per chip beside the universal archive. */
  const withWindows = (version: string) => {
    const m = release(version);
    const at = (chip: string) =>
      `${GITHUB}/download/v${version}/Proscenium_${version}_${chip}-setup.exe`;
    return {
      ...m,
      platforms: {
        ...m.platforms,
        "windows-x86_64": { signature: "w".repeat(100), url: at("x64") },
        "windows-aarch64": { signature: "v".repeat(100), url: at("arm64") },
      },
    };
  };
  const askAs = (mf: Miniflare, path: string, os: string) =>
    mf.dispatchFetch(`${UPDATES}${path}`, { headers: { "Proscenium-OS": os } });
  /** GitHub publishing `version` with this manifest, and every file it names. */
  const serving = (manifestOf: (v: string) => unknown) => (url: URL) =>
    url.pathname.endsWith("/latest.json")
      ? Response.json(manifestOf("1.0.0"))
      : new Response(`GitHub's ${url.pathname.slice(url.pathname.lastIndexOf("/") + 1)}`);
  test("a manifest naming Windows answers a Mac as one that does not, and a Windows copy with Windows' own", async () => {
    const answers = async (manifestOf: (v: string) => unknown) => {
      github = serving(manifestOf);
      const mf = await start(productionScript);
      try {
        const out: { status: number; body: string }[] = [];
        for (const path of ["/v1/darwin/aarch64/0.9.0", "/v1/stable/darwin/x86_64/0.9.0"]) {
          const r = await askAs(mf, path, "26.0");
          out.push({ status: r.status, body: await r.text() });
        }
        const windows: { status: number; body: string }[] = [];
        for (const path of ["/v1/windows/x86_64/0.9.0", "/v1/stable/windows/aarch64/0.9.0"]) {
          const r = await askAs(mf, path, "10.0.26100");
          windows.push({ status: r.status, body: await r.text() });
        }
        const installer = await askAs(
          mf,
          "/v1/download/v1.0.0/Proscenium_1.0.0_arm64-setup.exe",
          "",
        );
        return { mac: out, windows, installer: [installer.status, await installer.text()] };
      } finally {
        await mf.dispose();
      }
    };
    const before = await answers(release);
    const after = await answers(withWindows);
    assert.deepEqual(
      before.mac.map((a) => a.status),
      [200, 200],
    );
    assert.deepEqual(after.mac, before.mac);
    // A manifest naming the Mac alone: Windows hears nothing newer, and no installer is served.
    assert.deepEqual(before.windows, [
      { status: 204, body: "" },
      { status: 204, body: "" },
    ]);
    assert.deepEqual(before.installer, [404, ""]);
    for (const [i, a] of after.windows.entries()) {
      assert.equal(a.status, 200);
      const data = JSON.parse(a.body) as {
        version: string;
        platforms: Record<string, { url: string }>;
      };
      assert.equal(data.version, "1.0.0");
      assert.deepEqual(Object.keys(data.platforms), ["windows-x86_64", "windows-aarch64"], `${i}`);
      assert.equal(
        data.platforms["windows-aarch64"].url,
        `${UPDATES}/v1/download/v1.0.0/Proscenium_1.0.0_arm64-setup.exe`,
      );
    }
    assert.deepEqual(after.installer, [200, "GitHub's Proscenium_1.0.0_arm64-setup.exe"]);
    // Windows' part broken, one chip without the other: a Mac is answered exactly as
    // before, and Windows' copies hear the source failed (502), their installers too.
    const broken = await answers((v) => {
      const m = withWindows(v);
      const { "windows-aarch64": _, ...platforms } = m.platforms;
      return { ...m, platforms };
    });
    assert.deepEqual(broken.mac, before.mac);
    assert.deepEqual(
      broken.windows.map((a) => a.status),
      [502, 502],
    );
    assert.deepEqual(broken.installer, [502, ""]);
  });
});

describe("the stand-in's bundle (wrangler.standin.jsonc)", () => {
  const config = standInConfig();
  const vars = config.vars;
  const standInGithub = vars.GITHUB;
  let standIn: Miniflare;
  before(async () => {
    standIn = await start(bundle(null, "stand-in", STANDIN_CONFIG), {
      bindings: vars,
      objects: {
        "stand-in/admission.json": JSON.stringify({ v: 1, stable: ["1.0.1", "1.0.2"], halted: [] }),
        "stand-in/beta/versions.json": JSON.stringify(["1.0.2-beta.1"]),
        "stand-in/beta/latest.json": JSON.stringify({
          version: "1.0.2-beta.1",
          pub_date: "2026-10-01T12:00:00Z",
          platforms: {
            "darwin-aarch64": {
              signature: "b".repeat(100),
              // As the pipeline writes it: on the update service's own host.
              url: `${UPDATES}/v1/beta/download/v1.0.2-beta.1/Proscenium_1.0.2-beta.1_aarch64.app.tar.gz`,
            },
          },
        }),
        "stand-in/beta/1.0.2-beta.1/Proscenium_1.0.2-beta.1_aarch64.app.tar.gz": "stand-in beta",
        // Production's keys, at the root, are not the stand-in's.
        "admission.json": JSON.stringify({ v: 1, stable: ["9.9.9"], halted: [] }),
        "beta/versions.json": JSON.stringify(["9.9.9-beta.1"]),
      },
    });
  });
  after(async () => {
    await standIn?.dispose();
    sentryOrigin = null;
  });
  test("is local and deploys nowhere: no account, no route, a local entry and bucket", () => {
    assert.equal(config.main, "test/standin-entry.ts");
    assert.equal(config.account_id, undefined);
    assert.equal(config.routes, undefined);
    assert.equal(config.workers_dev, false);
    assert.notEqual(config.r2_buckets[0].bucket_name, "proscenium-updates");
    for (const origin of [vars.UPDATES, vars.GITHUB, vars.SENTRY])
      assert.equal(new URL(origin).hostname, "127.0.0.1");
    assert.equal(vars.KEY_PREFIX, "stand-in/");
  });
  test("takes a crash report by its own lists, as production does, and forwards it to the Sentry stand-in alone (docs/engineering/services-and-feedback.md#SERV-279)", async () => {
    sentryOrigin = vars.SENTRY;
    outbound.length = 0;
    envelopes.length = 0;
    const plant = (version: string) =>
      standIn.dispatchFetch(`${vars.UPDATES}/api/proscenium/envelope/`, {
        method: "POST",
        headers: CRASH_HEADERS,
        body: crashEnvelope(version),
      });
    // A published beta's is taken, and reaches the Sentry stand-in as it was sent.
    const taken = await plant("1.0.2-beta.1");
    assert.equal(taken.status, 204);
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].url, `${vars.SENTRY}/api/1/envelope/`);
    assert.equal(envelopes[0].contentType, "application/x-sentry-envelope");
    assert.equal(JSON.parse(envelopes[0].body.split("\n")[2]).release, "1.0.2-beta.1");
    // A release its list admits is taken too; an unpublished beta's, an alpha's and
    // production's root list's are refused, and nothing more is forwarded.
    assert.equal((await plant("1.0.1")).status, 204);
    for (const version of ["1.0.2-beta.2", "1.0.2-alpha.3", "9.9.9", "9.9.9-beta.1"])
      assert.equal((await plant(version)).status, 400, version);
    assert.equal(envelopes.length, 2);
    for (const request of outbound)
      assert.ok(request.url.startsWith(`${vars.SENTRY}/`), request.url);
    // On the stand-in's own origin alone.
    const elsewhere = await standIn.dispatchFetch(
      "https://reports.proscenium.ink/api/proscenium/envelope/",
      { method: "POST", headers: CRASH_HEADERS, body: crashEnvelope("1.0.2-beta.1") },
    );
    assert.equal(elsewhere.status, 404);
  });
  test("takes feedback, with the build version it says, into its own database", async () => {
    const id = "2d8b57f6-7f2b-4eaf-9c63-8c5f4d3e2a33";
    const r = await standIn.dispatchFetch(`${vars.UPDATES}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, message: "A stand-in's words.", version: "1.0.2-beta.1" }),
    });
    assert.equal(r.status, 201);
    const db = await standIn.getD1Database("DB");
    const row = await db
      .prepare("SELECT id, version FROM feedback_messages WHERE id = ?")
      .bind(id)
      .first();
    assert.deepEqual(row, { id, version: "1.0.2-beta.1" });
  });
  test("serves a stand-in release from its `stand-in/` keys and its loopback GitHub, and asks nothing else", async () => {
    github = publishedGithub(["1.0.1", "1.0.2"], standInGithub);
    outbound.length = 0;
    const check = await ask(standIn, "/v1/darwin/aarch64/1.0.1", vars.UPDATES);
    assert.equal(check.status, 200);
    const data = (await check.json()) as ReturnType<typeof release>;
    assert.equal(data.version, "1.0.2");
    for (const p of Object.values(data.platforms))
      assert.equal(
        p.url,
        `${vars.UPDATES}/v1/download/v1.0.2/Proscenium_1.0.2_universal.app.tar.gz`,
      );
    const file = await ask(
      standIn,
      "/v1/download/v1.0.2/Proscenium_1.0.2_universal.app.tar.gz",
      vars.UPDATES,
    );
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "1.0.2 Proscenium_1.0.2_universal.app.tar.gz");
    // Its beta, from its own keys, its archive on the stand-in's own origin
    // (docs/engineering/services-and-feedback.md#SERV-278).
    const beta = await ask(standIn, "/v1/beta/darwin/aarch64/1.0.1", vars.UPDATES);
    assert.equal(beta.status, 200);
    const betaData = (await beta.json()) as {
      version: string;
      platforms: Record<string, { url: string }>;
    };
    assert.equal(betaData.version, "1.0.2-beta.1");
    assert.deepEqual(
      Object.values(betaData.platforms).map((p) => p.url),
      [`${vars.UPDATES}/v1/beta/download/v1.0.2-beta.1/Proscenium_1.0.2-beta.1_aarch64.app.tar.gz`],
    );
    const betaFile = await ask(
      standIn,
      "/v1/beta/download/v1.0.2-beta.1/Proscenium_1.0.2-beta.1_aarch64.app.tar.gz",
      vars.UPDATES,
    );
    assert.equal(await betaFile.text(), "stand-in beta");
    // Production's root keys admit nothing here, and production's host is not its host.
    assert.equal((await ask(standIn, "/v1/darwin/aarch64/9.9.9", vars.UPDATES)).status, 400);
    assert.equal(
      (await ask(standIn, "/v1/beta/darwin/aarch64/9.9.9-beta.1", vars.UPDATES)).status,
      400,
    );
    assert.equal((await ask(standIn, "/v1/darwin/aarch64/1.0.1")).status, 404);
    assert.ok(outbound.length > 0);
    for (const request of outbound)
      assert.ok(request.url.startsWith(`${standInGithub}/`), request.url);
  });
  test("an origin off loopback is refused before anything is asked", async () => {
    for (const [name, value] of [
      ["GITHUB", GITHUB],
      ["UPDATES", UPDATES],
      ["SENTRY", "https://o123.ingest.us.sentry.io"],
      ["KEY_PREFIX", ""],
    ]) {
      const misconfigured = await start(bundle(null, `stand-in-${name}`, STANDIN_CONFIG), {
        bindings: { ...vars, [name]: value },
      });
      try {
        outbound.length = 0;
        const origin = name === "UPDATES" ? UPDATES : vars.UPDATES;
        const r = await ask(misconfigured, "/v1/darwin/aarch64/1.0.1", origin);
        assert.equal(r.status, 500, name);
        assert.deepEqual(outbound, [], name);
      } finally {
        await misconfigured.dispose();
      }
    }
  });
});
