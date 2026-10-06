// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The stand-in's configuration, state and files, as its servers, its seeding,
 * its reader and its tests read them
 * (docs/engineering/services-and-feedback.md#SERV-274). Imported by Node too
 * (test/workerd.node.ts), so its imports name their files.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifest, parseTrackManifest, trackOf, UPDATES, VERSION } from "../src/updates.ts";

export const EDGE = fileURLToPath(new URL("..", import.meta.url).href);
export const STANDIN_CONFIG = join(EDGE, "wrangler.standin.jsonc");
/** The stand-in's local state: its D1 and R2, and what its Sentry stand-in received. */
export const STANDIN_STATE = join(EDGE, ".wrangler/standin");
/** One line for each crash report the Sentry stand-in received. */
export const SENTRY_LOG = join(STANDIN_STATE, "sentry.jsonl");
/** The addresses the stand-in's vars name; every port comes from these. */
export const LOOPBACK = ["127.0.0.1", "[::1]", "localhost"];

/** wrangler.standin.jsonc, whose comments are whole lines. */
export function standInConfig(): {
  vars: Record<string, string>;
  r2_buckets: { binding: string; bucket_name: string }[];
  d1_databases: { binding: string; database_name: string }[];
  [key: string]: unknown;
} {
  return JSON.parse(readFileSync(STANDIN_CONFIG, "utf8").replace(/^\s*\/\/.*$/gm, ""));
}
/**
 * Wrangler on the stand-in's local state, and its output: every call says
 * `--local`, and none has a token or an account in its environment.
 */
export function localWrangler(args: string[]): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^CLOUDFLARE_|^CF_/.test(k)),
  );
  const r = spawnSync(
    join(EDGE, "node_modules/.bin/wrangler"),
    [...args, "--local", "--persist-to", STANDIN_STATE, "--config", STANDIN_CONFIG],
    { cwd: EDGE, encoding: "utf8", env: { ...env, WRANGLER_SEND_METRICS: "false" } },
  );
  if (r.status !== 0)
    throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed:\n${r.stderr}`);
  return r.stdout;
}
/** A loopback address from the vars: the host and port a stand-in server listens on. */
export function listening(address: string): { hostname: string; port: number } {
  const url = new URL(address);
  if (!LOOPBACK.includes(url.hostname) || !url.port)
    throw new Error(`${address} is not a loopback address with a port`);
  return { hostname: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port) };
}

interface Build {
  version?: unknown;
  notes?: unknown;
  pub_date?: unknown;
  platforms?: Record<string, { signature?: unknown }>;
}
/**
 * A release build's manifest as the GitHub stand-in serves it: its version,
 * notes, date and signatures, with its archive at `github`. The updater checks
 * an archive against its signature, never its address. Refused unless it is a
 * release's, universal, as the Worker will read it.
 */
export function releaseManifest(build: Build, github: string) {
  if (typeof build.version !== "string" || !VERSION.test(build.version))
    throw new Error("GitHub's stand-in serves releases alone: a track's builds are in R2");
  const archive = `${github}/download/v${build.version}/Proscenium_${build.version}_universal.app.tar.gz`;
  return parseManifest(
    {
      ...build,
      platforms: Object.fromEntries(
        Object.entries(build.platforms ?? {}).map(([key, p]) => [
          key,
          { signature: p.signature, url: archive },
        ]),
      ),
    },
    github,
  );
}
/**
 * A track build's manifest as the stand-in's R2 holds it: as the pipeline wrote
 * it, its archives on the update service's own host (or already on the
 * stand-in's), which the Worker answers on its own origin
 * (docs/engineering/services-and-feedback.md#SERV-278).
 */
export function trackManifest(build: Build, updates: string) {
  const track = typeof build.version === "string" ? trackOf(build.version) : null;
  if (track === null) throw new Error("Not a track build's manifest");
  return parseTrackManifest(build, track, [UPDATES, updates]);
}
/** Release order, for `X.Y.Z`. */
export function compareReleases(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
