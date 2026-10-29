// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The deployed bundle, in the runtime that runs it, against GitHub itself.
 *
 * `workerd.node.ts` proves the bundle with a stand-in for GitHub as its only
 * way out. This one lets it out: the same bundle `wrangler deploy` uploads,
 * in workerd, asking the real github.com for the newest stable release. It
 * passes only when the Worker's answers are GitHub's own, read here directly:
 * the version and platforms of `latest.json`, and the bytes of a file the
 * release serves. Both of the stable route's launch faults, a request GitHub
 * refused for want of a User-Agent and a fetch workerd refused as another
 * object's method, would have failed it, and both hid behind the stand-in the
 * rehearsal used from the first deploy to the day of the release
 * (docs/engineering/services-and-feedback.md#SERV-267).
 *
 * It admits what the live Worker admits. That is the deployed list in
 * wrangler.jsonc and the list a release writes to R2 with no deploy
 * (docs/engineering/services-and-feedback.md#SERV-268), which this test cannot
 * read without the deploy token. So it asks the live service itself whether
 * GitHub's newest release is released, by the one answer every route gives
 * (docs/engineering/services-and-feedback.md#SERV-269): the `go` link to that
 * release's notes redirects to its page on GitHub only for a release the
 * service has released (docs/engineering/services-and-feedback.md#SERV-281).
 * That route counts and writes nothing, and the question carries no
 * credential. When the live service admits it, so does the bundle here, through
 * its own local bucket; when it does not, the test fails, as the live stable
 * route would answer 502. Reading the deployed list alone, it failed from the
 * day 1.0.1 was admitted by the list in R2.
 *
 * It needs the network and a published release, so it is not part of the
 * pipeline's every-push Worker step: a tagged release runs it before it
 * builds, and the release procedure runs it by hand before the tag
 * (docs/engineering/release-engineering.md#SHIP-D107). `bun run test:live`.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { GITHUB, UPDATES, UPSTREAM_HEADERS, VERSION } from "../src/updates.ts";

const EDGE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The production `vars`, read from wrangler.jsonc itself so the admission list under test is the deployed one. */
function productionVars(): Record<string, string> {
  const text = readFileSync(join(EDGE, "wrangler.jsonc"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(text) as { vars: Record<string, string> };
  return config.vars;
}
const vars = productionVars();
const released = (JSON.parse(vars.RELEASED_VERSIONS_JSON) as string[]).filter((v) =>
  VERSION.test(v),
);
assert.ok(released.length > 0, "wrangler.jsonc admits no stable version");
/** The oldest admitted version asks, as a copy that has not updated yet would. */
const asking = released[0];
/**
 * The live service's links (src/links.ts's `GO`, named again here: Node loads
 * this file's imports by their whole names, and that file's name none).
 */
const GO = "https://go.proscenium.ink";

/** What the live service said of GitHub's newest release, and whether it has released it. */
interface Live {
  version: string;
  released: boolean;
  said: string;
}
/**
 * Whether the live service has released `version` on stable, in its own words:
 * a 302 to the release's page on GitHub, or a 404. Anything else is no answer.
 */
async function liveReleased(version: string): Promise<Live> {
  const address = `${GO}/releases/v${version}`;
  const r = await fetch(address, {
    headers: UPSTREAM_HEADERS,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  await r.body?.cancel();
  const location = r.headers.get("Location");
  const said = `${address} answered ${r.status}${location ? ` to ${location}` : ""}`;
  if (r.status === 302 && location === `${GITHUB}/tag/v${version}`)
    return { version, released: true, said };
  if (r.status === 404) return { version, released: false, said };
  throw new Error(`${said}: not the service's answer to whether ${version} is released`);
}

const out = mkdtempSync(join(tmpdir(), "edge-workerd-live-"));
/** The bundle `wrangler deploy` would upload: the production entry, dry run. */
function bundle(): string {
  const r = spawnSync(
    join(EDGE, "node_modules/.bin/wrangler"),
    ["deploy", "--dry-run", "--outdir", out],
    {
      cwd: EDGE,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
      encoding: "utf8",
    },
  );
  if (r.status !== 0)
    throw new Error(`wrangler could not bundle the production entry:\n${r.stderr}`);
  const [script] = readdirSync(out).filter((file) => file.endsWith(".js"));
  return readFileSync(join(out, script), "utf8");
}

let production: Miniflare;
/** What the live service said of GitHub's newest release. */
let live: Live;
before(async () => {
  // No outboundService: the bundle's fetch reaches the network, as deployed.
  production = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle(),
      compatibilityDate: "2026-09-18",
      bindings: {
        UPDATES_ENABLED: vars.UPDATES_ENABLED,
        DOWNLOADS_ENABLED: vars.DOWNLOADS_ENABLED,
        RELEASED_VERSIONS_JSON: vars.RELEASED_VERSIONS_JSON,
      },
      d1Databases: { DB: "db" },
      r2Buckets: { TRACKS: "tracks" },
      ratelimits: {
        UPDATE_LIMIT: { namespace_id: "7001", simple: { limit: 1000, period: 60 } },
        DOWNLOAD_LIMIT: { namespace_id: "7002", simple: { limit: 1000, period: 60 } },
      },
    }),
  );
  const db = await production.getD1Database("DB");
  for (const file of readdirSync(join(EDGE, "migrations")).sort()) {
    await db.exec(
      readFileSync(join(EDGE, "migrations", file), "utf8")
        .replace(/--[^\n]*/g, "")
        .replace(/\s*\n\s*/g, " "),
    );
  }
  // Admit what the live service admits: GitHub's newest release, when the live
  // service says it has released it, through the bucket's admission list, as a
  // release admits it in production.
  const own = (await (await github("/latest/download/latest.json")).json()) as Manifest;
  live = await liveReleased(own.version);
  if (live.released)
    await (await production.getR2Bucket("TRACKS")).put(
      "admission.json",
      JSON.stringify({ v: 1, stable: [own.version], halted: [] }),
    );
});
after(async () => {
  await production?.dispose();
  rmSync(out, { recursive: true, force: true });
});

const ask = (path: string) =>
  production.dispatchFetch(`${UPDATES}${path}`, { headers: { "Proscenium-OS": "26.0" } });
/** GitHub's own answer, read the way the Worker reads it, as the oracle. */
async function github(path: string): Promise<Response> {
  const r = await fetch(`${GITHUB}${path}`, {
    headers: UPSTREAM_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(r.status, 200, `GitHub answered ${r.status} for ${path}: is a release published?`);
  return r;
}
interface Manifest {
  version: string;
  pub_date: string;
  platforms: Record<string, { signature: string; url: string }>;
}

describe("the deployed bundle in workerd, against GitHub itself", () => {
  test("GitHub's newest release is one the live service has released, in its own words", (t) => {
    t.diagnostic(`GitHub's newest release: ${live.version}; ${live.said}`);
    t.diagnostic(
      released.includes(live.version)
        ? `wrangler.jsonc's deployed list holds ${live.version}`
        : `wrangler.jsonc's deployed list (${released.join(", ")}) does not hold ${live.version}: admitted here as the live service admits it, by the admission list in its bucket`,
    );
    assert.ok(
      live.released,
      `${live.said}: the live service has not released GitHub's newest release, so its stable route answers 502`,
    );
  });
  test("a stable check answers GitHub's own latest.json, with the update route as its address (docs/engineering/services-and-feedback.md#SERV-286)", async () => {
    const own = (await (await github("/latest/download/latest.json")).json()) as Manifest;
    assert.ok(VERSION.test(own.version), `GitHub's latest.json names ${own.version}`);
    for (const arch of ["aarch64", "x86_64"] as const) {
      for (const route of [`/v1/stable/darwin/${arch}/${asking}`, `/v1/darwin/${arch}/${asking}`]) {
        const r = await ask(route);
        assert.equal(r.status, 200, `${route} answered ${r.status}`);
        const answer = (await r.json()) as Manifest;
        assert.equal(answer.version, own.version);
        assert.equal(answer.pub_date, own.pub_date);
        const platform = answer.platforms[`darwin-${arch}`];
        assert.ok(platform, `no darwin-${arch} in the answer`);
        assert.equal(platform.signature, own.platforms[`darwin-${arch}`].signature);
        const file = new URL(own.platforms[`darwin-${arch}`].url).pathname.split("/").pop();
        assert.equal(platform.url, `${UPDATES}/v1/update/v${own.version}/${file}`);
      }
    }
  });
  test("a stable download serves the bytes GitHub serves", async () => {
    const own = (await (await github("/latest/download/latest.json")).json()) as Manifest;
    const archive = new URL(own.platforms["darwin-aarch64"].url).pathname.split("/").pop();
    // The signature file: the release's own, about a hundred bytes.
    const signature = `${archive}.sig`;
    const theirs = await (await github(`/download/v${own.version}/${signature}`)).text();
    for (const via of ["update", "download"]) {
      const r = await ask(`/v1/${via}/v${own.version}/${signature}`);
      assert.equal(r.status, 200, `the ${via} route answered ${r.status}`);
      assert.equal(await r.text(), theirs);
      assert.equal(r.headers.get("Cache-Control"), "no-store");
    }
  });
  test("a version the list does not admit is refused before GitHub is asked", async () => {
    const r = await ask("/v1/stable/darwin/aarch64/0.0.1");
    assert.equal(r.status, 400);
  });
});
