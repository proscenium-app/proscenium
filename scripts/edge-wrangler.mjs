// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The reviewed production commands for the Proscenium Worker, and only those
 * (services/edge/README.md). Each one changes or reads Cloudflare, so each is
 * run only with the maintainer's yes for that change.
 *
 *   node scripts/edge-wrangler.mjs whoami                    the filed token works, and for which account
 *   node scripts/edge-wrangler.mjs d1-create                 create the production database, once
 *   node scripts/edge-wrangler.mjs r2-create                 create the tracks' bucket, once
 *   node scripts/edge-wrangler.mjs r2-exposure               the bucket's r2.dev address and custom domains: both must be
 *                                                            off, so its objects answer only through the Worker
 *   node scripts/edge-wrangler.mjs migrate                   apply services/edge/migrations to it
 *   node scripts/edge-wrangler.mjs deploy                    deploy services/edge/wrangler.jsonc
 *   node scripts/edge-wrangler.mjs query <name> <from> <to>  one aggregate query from services/edge/queries,
 *                                                            UTC days, from inclusive, to exclusive
 *   <value on stdin> | node scripts/edge-wrangler.mjs secret SENTRY_DSN | PATRONS_WEBHOOK_SECRET | ALPHA_KEY_SHA256
 *                                                            a Worker secret, checked for shape, never printed; alpha's
 *                                                            key hash is filed by scripts/track-key.mjs, never by hand
 *
 * The deploy token travels from the login keychain into Wrangler's
 * environment: never argv, never output. Wrangler writes its debug log into a
 * private directory that is removed when the command ends, and sends no
 * metrics. Wrangler is the only network tool given the token.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "./release-keychain.mjs";

const edge = fileURLToPath(new URL("../services/edge/", import.meta.url));
const WORKER = "proscenium-services";
const DATABASE = "proscenium-services";
/** Alpha's and beta's manifests, version lists and files. */
const BUCKET = "proscenium-updates";
const HOSTS = ["updates.proscenium.ink", "feedback.proscenium.ink", "reports.proscenium.ink", "go.proscenium.ink", "patrons.proscenium.ink"];
/** Counts and receipts only: never a writer's words. feedback-list is pulled privately by the maintainer's scheduled jobs. */
const QUERIES = ["update-use", "downloads", "daily-volume", "feature-share", "feedback-counts", "feedback-receipts"];
const DAY = /^\d{4}-\d\d-\d\d$/;
/** The Worker's secrets, each held to the shape the Worker itself accepts (sentry-forward.ts). */
const SECRETS = {
  SENTRY_DSN: v => /^https:\/\/[a-f0-9]{32}@o\d+\.ingest(?:\.(?:us|de))?\.sentry\.io\/[1-9]\d{0,19}$/.test(v),
  /** The Sponsors webhook's shared secret (patrons.ts): 32 random bytes as hex, made here, pasted into GitHub by the maintainer. */
  PATRONS_WEBHOOK_SECRET: v => /^[0-9a-f]{64}$/.test(v),
  /** The SHA-256 of alpha's key, hex (services/edge/src/updates.ts). */
  ALPHA_KEY_SHA256: v => /^[0-9a-f]{64}$/.test(v),
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USAGE = "usage: node scripts/edge-wrangler.mjs whoami | d1-create | r2-create | r2-exposure | migrate | deploy | query <name> <from> <to> | secret <name>";

function config() {
  const c = JSON.parse(readFileSync(`${edge}wrangler.jsonc`, "utf8"));
  if (c.name !== WORKER || c.main !== "src/index.ts" || c.workers_dev !== false || c.preview_urls !== false
    || c.send_metrics !== false || c.observability?.enabled !== false) {
    throw new Error("Production entry, private preview and logging checks failed. Nothing was run.");
  }
  if (!/^[0-9a-f]{32}$/.test(c.account_id ?? "")) throw new Error("wrangler.jsonc names no Cloudflare account. Nothing was run.");
  if (!c.routes?.length || !c.routes.every(r => r.custom_domain === true && HOSTS.includes(r.pattern))) {
    throw new Error("Only proscenium.ink's custom domains may be routes. Nothing was run.");
  }
  const versions = JSON.parse(c.vars?.RELEASED_VERSIONS_JSON ?? "null");
  if (!Array.isArray(versions) || !versions.every(v => /^\d+\.\d+\.\d+$/.test(v))) {
    throw new Error("RELEASED_VERSIONS_JSON must list released x.y.z versions. Nothing was run.");
  }
  if (c.d1_databases?.length !== 1 || c.d1_databases[0].database_name !== DATABASE) {
    throw new Error(`The one production database must be ${DATABASE}. Nothing was run.`);
  }
  if (c.r2_buckets?.length !== 1 || c.r2_buckets[0].binding !== "TRACKS" || c.r2_buckets[0].bucket_name !== BUCKET) {
    throw new Error(`The one bucket must be ${BUCKET}, bound as TRACKS. Nothing was run.`);
  }
  return c;
}

function databaseConfigured(c) {
  const id = c.d1_databases[0].database_id ?? "";
  return UUID.test(id) && !id.startsWith("00000000");
}

/** `input`, when given, is Wrangler's stdin: how a secret's value reaches it without argv or a prompt. */
function wrangler(args, input) {
  const token = load("CLOUDFLARE_API_TOKEN");
  if (!token) throw new Error("No Proscenium deploy token is filed in the login keychain. Nothing was run.");
  const logs = mkdtempSync(join(tmpdir(), "proscenium-wrangler-"));
  try {
    const result = spawnSync(`${edge}node_modules/.bin/wrangler`, [...args, "--config", "wrangler.jsonc"], {
      cwd: edge, stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"], input,
      env: {
        ...process.env,
        CLOUDFLARE_API_TOKEN: token.toString().trim(),
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_LOG_PATH: logs,
      },
    });
    return result.status ?? 1;
  } finally {
    rmSync(logs, { recursive: true, force: true });
  }
}

function query(name, from, to) {
  if (!QUERIES.includes(name)) throw new Error(`Only the count and receipt queries may be run here: ${QUERIES.join(", ")}.`);
  if (!DAY.test(from ?? "") || !DAY.test(to ?? "") || !(from < to)) throw new Error("Give two UTC days, YYYY-MM-DD, the first before the second.");
  // The reviewed file, with its two day bindings as literals: both are checked above. Its
  // whole-line comments go, or Wrangler's argument parser reads a leading "--" as a flag.
  const sql = readFileSync(`${edge}queries/${name}.sql`, "utf8")
    .split("\n").filter(line => !/^\s*--/.test(line)).join("\n").trim()
    .replace(/\?([12])\b/g, (_, n) => `'${n === "1" ? from : to}'`);
  if (/\?\d/.test(sql)) throw new Error(`${name} needs a binding this command does not give.`);
  return wrangler(["d1", "execute", DATABASE, "--remote", "--json", `--command=${sql}`]);
}

function secret(name) {
  if (!Object.hasOwn(SECRETS, name)) throw new Error(`Only these Worker secrets may be set: ${Object.keys(SECRETS).join(", ")}.`);
  if (process.stdin.isTTY) throw new Error("Pipe the value in: it is never typed, and never an argument.");
  const value = readFileSync(0, "utf8").trim();
  if (!SECRETS[name](value)) throw new Error(`That is not a valid ${name}. Nothing was stored.`);
  return wrangler(["secret", "put", name], value);
}

try {
  const [command, ...rest] = process.argv.slice(2);
  const c = config();
  if (command === "whoami" && rest.length === 0) process.exitCode = wrangler(["whoami"]);
  else if (command === "d1-create" && rest.length === 0) {
    if (c.d1_databases[0].database_id) throw new Error("wrangler.jsonc already names the production database. Nothing was created.");
    process.exitCode = wrangler(["d1", "create", DATABASE]);
  } else if (command === "r2-create" && rest.length === 0) {
    process.exitCode = wrangler(["r2", "bucket", "create", BUCKET]);
  } else if (command === "r2-exposure" && rest.length === 0) {
    // Read-only: Wrangler's own words for each, so nothing here can misread "disabled".
    process.exitCode = wrangler(["r2", "bucket", "dev-url", "get", BUCKET]) || wrangler(["r2", "bucket", "domain", "list", BUCKET]);
  } else if (["migrate", "deploy", "query", "secret"].includes(command)) {
    if (!databaseConfigured(c)) throw new Error("The approved production D1 database has not been configured. Nothing was run.");
    if (command === "migrate" && rest.length === 0) process.exitCode = wrangler(["d1", "migrations", "apply", DATABASE, "--remote"]);
    else if (command === "deploy" && rest.length === 0) process.exitCode = wrangler(["deploy"]);
    else if (command === "query" && rest.length === 3) process.exitCode = query(...rest);
    else if (command === "secret" && rest.length === 1) process.exitCode = secret(rest[0]);
    else throw new Error(USAGE);
  } else throw new Error(USAGE);
} catch (error) {
  console.error(error instanceof Error ? error.message : "The Worker command failed.");
  process.exitCode = 1;
}
