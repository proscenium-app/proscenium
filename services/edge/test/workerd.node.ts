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

const EDGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const archive = "Proscenium_1.0.0_universal.app.tar.gz";
const manifest = {
  version: "1.0.0",
  pub_date: "2026-09-26T12:00:00Z",
  platforms: {
    "darwin-aarch64": { signature: "a".repeat(100), url: `${GITHUB}/download/v1.0.0/${archive}` },
    "darwin-x86_64": { signature: "a".repeat(100), url: `${GITHUB}/download/v1.0.0/${archive}` },
  },
};

/** What the stand-in answers, per test, and every request that reached it. */
let github: (url: URL) => Response = () => new Response(null, { status: 404 });
const outbound: { url: string; userAgent: string | null }[] = [];

const out = mkdtempSync(join(tmpdir(), "edge-workerd-"));
/** The bundle `wrangler deploy` would upload, for this entry. */
function bundle(entry: string | null, name: string): string {
  const dir = join(out, name);
  const r = spawnSync(
    join(EDGE, "node_modules/.bin/wrangler"),
    ["deploy", ...(entry ? [entry] : []), "--dry-run", "--outdir", dir],
    {
      cwd: EDGE,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
      encoding: "utf8",
    },
  );
  if (r.status !== 0)
    throw new Error(`wrangler could not bundle ${entry ?? "the production entry"}:\n${r.stderr}`);
  // Named after the entry: index.js for the production one.
  const [script] = readdirSync(dir).filter((file) => file.endsWith(".js"));
  return readFileSync(join(dir, script), "utf8");
}
async function start(script: string): Promise<Miniflare> {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script,
      compatibilityDate: "2026-09-18",
      bindings: {
        UPDATES_ENABLED: "true",
        DOWNLOADS_ENABLED: "true",
        RELEASED_VERSIONS_JSON: '["0.9.0","1.0.0"]',
      },
      d1Databases: { DB: "db" },
      r2Buckets: { TRACKS: "tracks" },
      ratelimits: {
        UPDATE_LIMIT: { namespace_id: "7001", simple: { limit: 1000, period: 60 } },
        DOWNLOAD_LIMIT: { namespace_id: "7002", simple: { limit: 1000, period: 60 } },
      },
      outboundService: (request: Request) => {
        outbound.push({ url: request.url, userAgent: request.headers.get("User-Agent") });
        return github(new URL(request.url));
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
  return mf;
}

let production: Miniflare;
let firstDeploy: Miniflare;
before(async () => {
  production = await start(bundle(null, "production"));
  firstDeploy = await start(bundle("test/fixtures/misbound-entry.ts", "first-deploy"));
});
after(async () => {
  await Promise.all([production?.dispose(), firstDeploy?.dispose()]);
  rmSync(out, { recursive: true, force: true });
});

const ask = (mf: Miniflare, path: string) =>
  mf.dispatchFetch(`${UPDATES}${path}`, { headers: { "Proscenium-OS": "26.0" } });
const releasedGithub = (url: URL) =>
  url.pathname.endsWith("/latest.json")
    ? Response.json(manifest)
    : url.pathname.endsWith(`/v1.0.0/${archive}`)
      ? new Response("signed archive")
      : new Response(null, { status: 404 });

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
});
