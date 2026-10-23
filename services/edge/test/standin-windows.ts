// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The update service learning Windows, proven on stand-ins under
 * `wrangler dev --local` (docs/engineering/services-and-feedback.md#SERV-284):
 *
 *   bun test/standin-windows.ts [--against <git ref>] [--port <n>]
 *
 * Two Workers, each on the stand-in's entry (test/standin-entry.ts), one after
 * the other: `<ref>`'s, origin/main's by default, taken from git as it is
 * there, and this checkout's. Each serves the same stand-in release twice:
 * once with every manifest naming the Mac alone, as every manifest has until
 * now, and once with every manifest naming Windows' two installers beside the
 * Mac's (docs/engineering/services-and-feedback.md#SERV-283). Stable's 1.0.1
 * and 1.0.2 come from a GitHub stand-in on loopback, beta's 1.0.3-beta.1 from
 * the Worker's local R2, and a crash report goes to a Sentry stand-in.
 *
 * Every Mac request, checks, downloads and crash reports, is asked of each
 * run, and must be answered byte for byte as `<ref>`'s Worker answers it with
 * the Mac's manifests, and counted in D1 as it counts it. Every Windows
 * request is asked too, and must be answered as
 * docs/engineering/services-and-feedback.md#SERV-283 says: nothing newer and
 * no installer from the Mac's manifests, Windows' own entries and files from
 * manifests that name them. It prints every answer, and exits 1 on any
 * difference.
 *
 * Local only: every Wrangler call says `--local` and is given no token, every
 * origin is loopback, and what it makes lives in a temporary folder that is
 * removed at the end. `--port` moves all of it: the Worker on that port, the
 * GitHub stand-in on the next, the Sentry stand-in on the one after, and the
 * inspector on the one after that.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UPDATES as PRODUCTION_UPDATES } from "../src/updates.ts";
import { CRASH_HEADERS, type CrashSystem, crashEnvelope } from "./standin-crash.ts";
import { EDGE } from "./standin.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const AGAINST = option("--against", "origin/main");
const PORT = Number(option("--port", "8897"));
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65_000) throw new Error("--port is a port");
const UPDATES = `http://127.0.0.1:${PORT}`;
const REPOSITORY = "proscenium-app/proscenium";
const GITHUB = `http://127.0.0.1:${PORT + 1}/${REPOSITORY}/releases`;
const SENTRY = `http://127.0.0.1:${PORT + 2}`;
const ROOT = join(EDGE, "../..");
const WRANGLER = join(EDGE, "node_modules/.bin/wrangler");
/** Wrangler's environment: no Cloudflare token or account, and no metrics. */
const ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLOUDFLARE_|^CF_/.test(k))),
  WRANGLER_SEND_METRICS: "false",
};
const STABLE = ["1.0.1", "1.0.2"];
const BETA = "1.0.3-beta.1";
const WINDOWS_11 = "10.0.26100";

/**
 * What every manifest names beside the Mac's builds: nothing (`mac`), Windows'
 * two installers (`windows`), or a broken Windows part (`broken`): one chip
 * without the other, as a failed Arm build would leave it, with every file
 * still in place.
 */
type Platforms = "mac" | "windows" | "broken";
const signature = (c: string) => c.repeat(100);
/** Windows' entries, an installer per chip, at `base`'s download route, as `platforms` says. */
function windowsEntries(base: string, version: string, platforms: Platforms) {
  if (platforms === "mac") return {};
  return {
    "windows-x86_64": {
      signature: signature("w"),
      url: `${base}/download/v${version}/Proscenium_${version}_x64-setup.exe`,
    },
    ...(platforms === "broken"
      ? {}
      : {
          "windows-aarch64": {
            signature: signature("v"),
            url: `${base}/download/v${version}/Proscenium_${version}_arm64-setup.exe`,
          },
        }),
  };
}
/** A release's manifest as GitHub serves it: universal for every Mac, and Windows' when it carries Windows. */
function release(version: string, platforms: Platforms) {
  const url = `${GITHUB}/download/v${version}/Proscenium_${version}_universal.app.tar.gz`;
  return {
    version,
    notes: `Proscenium ${version}, a stand-in.`,
    pub_date: "2026-10-14T12:00:00Z",
    platforms: {
      "darwin-aarch64": { signature: signature("a"), url },
      "darwin-x86_64": { signature: signature("a"), url },
      ...windowsEntries(GITHUB, version, platforms),
    },
  };
}
/** Beta's manifest as the pipeline writes it to R2: Apple silicon's, on the service's own host. */
function beta(platforms: Platforms) {
  const base = `${PRODUCTION_UPDATES}/v1/beta`;
  return {
    version: BETA,
    notes: "Unreleased, a stand-in.",
    pub_date: "2026-10-14T12:00:00Z",
    platforms: {
      "darwin-aarch64": {
        signature: signature("c"),
        url: `${base}/download/v${BETA}/Proscenium_${BETA}_aarch64.app.tar.gz`,
      },
      ...windowsEntries(base, BETA, platforms),
    },
  };
}
/** A version's files: the Mac's build's three, and Windows' four when it carries Windows, its manifest broken or not. */
function files(version: string, slice: string, platforms: Platforms): string[] {
  return [
    `Proscenium_${version}_${slice}.app.tar.gz`,
    `Proscenium_${version}_${slice}.app.tar.gz.sig`,
    `Proscenium_${version}_${slice}.dmg`,
    ...(platforms !== "mac"
      ? ["x64", "arm64"].flatMap((chip) => [
          `Proscenium_${version}_${chip}-setup.exe`,
          `Proscenium_${version}_${chip}-setup.exe.sig`,
        ])
      : []),
  ];
}

/** The Worker as `ref` holds it, in `dir`, beside this checkout's dependencies. */
function checkout(ref: string, dir: string): { edge: string; commit: string } {
  const commit = spawnSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${ref} is not a commit here`);
  const tar = spawnSync("git", ["archive", "--format=tar", commit, "services/edge"], {
    cwd: ROOT,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (tar.status !== 0) throw new Error(`git archive ${ref} failed:\n${tar.stderr}`);
  mkdirSync(dir, { recursive: true });
  const untar = spawnSync("tar", ["-x", "-C", dir], { input: tar.stdout });
  if (untar.status !== 0) throw new Error(`tar failed:\n${untar.stderr}`);
  const edge = join(dir, "services/edge");
  // Its own dependencies would be the same ones: the lockfile says so, or this proves nothing.
  if (readFileSync(join(edge, "bun.lock"), "utf8") !== readFileSync(join(EDGE, "bun.lock"), "utf8"))
    throw new Error(`${ref}'s services/edge/bun.lock is not this checkout's: install it first`);
  symlinkSync(join(EDGE, "node_modules"), join(edge, "node_modules"));
  return { edge, commit };
}

/**
 * The stand-in's configuration for one run, from that Worker's own
 * wrangler.standin.jsonc: its entry and migrations by their whole paths, the
 * origins this proof's, and the rate limits out of the way, since the proof
 * asks more in a minute than a copy does, and the limits are not what it proves.
 */
function configure(edge: string, dir: string): string {
  const base = JSON.parse(
    readFileSync(join(edge, "wrangler.standin.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""),
  );
  delete base.$schema;
  const config = {
    ...base,
    main: join(edge, "test/standin-entry.ts"),
    vars: { ...base.vars, REPOSITORY, UPDATES, GITHUB, SENTRY },
    d1_databases: base.d1_databases.map((d: { migrations_dir: string }) => ({
      ...d,
      migrations_dir: join(edge, d.migrations_dir),
    })),
    ratelimits: base.ratelimits.map((r: { simple: object }) => ({
      ...r,
      simple: { ...r.simple, limit: 100_000 },
    })),
  };
  const path = join(dir, "wrangler.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}
/** Wrangler on the run's local state, and its output. */
function wrangler(config: string, state: string, argv: string[]): string {
  const r = spawnSync(WRANGLER, [...argv, "--local", "--persist-to", state, "--config", config], {
    cwd: join(config, ".."),
    encoding: "utf8",
    env: ENV,
  });
  if (r.status !== 0)
    throw new Error(`wrangler ${argv.slice(0, 3).join(" ")} failed:\n${r.stderr}`);
  return r.stdout;
}
/** The run's database and bucket, as a stand-in's are seeded (test/standin-seed.ts). */
function seed(config: string, state: string, dir: string, platforms: Platforms) {
  const { r2_buckets, d1_databases } = JSON.parse(readFileSync(config, "utf8"));
  wrangler(config, state, ["d1", "migrations", "apply", d1_databases[0].database_name]);
  const put = (key: string, body: string) => {
    const file = join(dir, "object");
    writeFileSync(file, body);
    wrangler(config, state, [
      "r2",
      "object",
      "put",
      `${r2_buckets[0].bucket_name}/stand-in/${key}`,
      "--file",
      file,
    ]);
  };
  put("admission.json", JSON.stringify({ v: 1, stable: STABLE, halted: [] }));
  for (const file of files(BETA, "aarch64", platforms)) put(`beta/${BETA}/${file}`, `beta ${file}`);
  put("beta/versions.json", JSON.stringify([BETA]));
  put("beta/latest.json", JSON.stringify(beta(platforms)));
}
/** What a run's Worker counted, as the queries read it. */
function counted(config: string, state: string): unknown[] {
  const { d1_databases } = JSON.parse(readFileSync(config, "utf8"));
  const out = wrangler(config, state, [
    "d1",
    "execute",
    d1_databases[0].database_name,
    "--json",
    "--command",
    "SELECT kind, platform, arch, version, os, count FROM update_counts ORDER BY kind, platform, arch, version, os",
  ]);
  return (JSON.parse(out) as { results: unknown[] }[])[0].results;
}

/** GitHub's releases and Sentry's ingest, on loopback, for one run. */
function standIns(platforms: Platforms) {
  const crashes: string[] = [];
  const github = Bun.serve({
    hostname: "127.0.0.1",
    port: PORT + 1,
    fetch(request) {
      const prefix = new URL(GITHUB).pathname;
      const path = new URL(request.url).pathname;
      if (path === `${prefix}/latest/download/latest.json`)
        return Response.json(release(STABLE[STABLE.length - 1], platforms));
      const [, version, file] = /\/download\/v([^/]+)\/([^/]+)$/.exec(path) ?? [];
      if (!STABLE.includes(version)) return new Response(null, { status: 404 });
      if (file === "latest.json") return Response.json(release(version, platforms));
      return files(version, "universal", platforms).includes(file)
        ? new Response(`GitHub's ${file}`)
        : new Response(null, { status: 404 });
    },
  });
  const sentry = Bun.serve({
    hostname: "127.0.0.1",
    port: PORT + 2,
    async fetch(request) {
      crashes.push(await request.text());
      return Response.json({ id: "stand-in" });
    },
  });
  return {
    crashes,
    stop: () => {
      github.stop(true);
      sentry.stop(true);
    },
  };
}

/** `wrangler dev --local` on the run's configuration and state, answering once it answers. */
async function serve(config: string, state: string, log: string): Promise<ChildProcess> {
  const child = spawn(
    WRANGLER,
    [
      "dev",
      "--local",
      "--config",
      config,
      "--persist-to",
      state,
      "--ip",
      "127.0.0.1",
      "--port",
      String(PORT),
      "--inspector-port",
      String(PORT + 3),
      "--show-interactive-dev-session=false",
    ],
    { cwd: join(config, ".."), env: ENV, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  const output: string[] = [];
  child.stdout?.on("data", (d) => output.push(String(d)));
  child.stderr?.on("data", (d) => output.push(String(d)));
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    if (child.exitCode !== null) break;
    try {
      await fetch(`${UPDATES}/`);
      writeFileSync(log, output.join(""));
      return child;
    } catch {
      await Bun.sleep(500);
    }
  }
  writeFileSync(log, output.join(""));
  stop(child);
  throw new Error(`wrangler dev did not answer at ${UPDATES}:\n${output.join("").slice(-2000)}`);
}
function stop(child: ChildProcess) {
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch {}
}
async function stopped(child: ChildProcess) {
  stop(child);
  const until = Date.now() + 20_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < until)
    await Bun.sleep(200);
}

interface Ask {
  name: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}
const check = (path: string, os: string | null): Ask => ({
  name: `GET ${path}${os === null ? " (no OS)" : ` [${os}]`}`,
  path,
  headers: os === null ? {} : { "Proscenium-OS": os },
});
const file = (path: string): Ask => ({ name: `GET ${path}`, path, headers: {} });
const crash = (version: string, tags?: CrashSystem): Ask => ({
  name: `POST a crash from ${version} on ${tags?.app_platform ?? "darwin"}`,
  path: "/api/proscenium/envelope/",
  headers: CRASH_HEADERS,
  body: crashEnvelope(version, new Date(), "6f0b9c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e", tags),
});
/** Everything a Mac asks, or could. */
const MAC: Ask[] = [
  ...["/v1", "/v1/stable", "/v1/beta", "/v1/alpha"].flatMap((route) =>
    ["aarch64", "x86_64"].flatMap((arch) =>
      ["1.0.1", "1.0.2", BETA, "9.9.9"].map((v) => check(`${route}/darwin/${arch}/${v}`, "26.0")),
    ),
  ),
  ...["14.6", "13.6", "26.0.1", WINDOWS_11, null].map((os) =>
    check("/v1/darwin/aarch64/1.0.1", os),
  ),
  ...[
    ...files("1.0.2", "universal", "mac"),
    "Proscenium_1.0.2_aarch64.app.tar.gz",
    "secret.txt",
  ].map((f) => file(`/v1/download/v1.0.2/${f}`)),
  file("/v1/stable/download/v1.0.1/Proscenium_1.0.1_universal.dmg"),
  file("/v1/download/v9.9.9/Proscenium_9.9.9_universal.dmg"),
  ...[...files(BETA, "aarch64", "mac"), `Proscenium_${BETA}_universal.dmg`].map((f) =>
    file(`/v1/beta/download/v${BETA}/${f}`),
  ),
  file("/v1/beta/download/v1.0.3-beta.9/Proscenium_1.0.3-beta.9_aarch64.dmg"),
  file("/admin"),
  check("/v1/nightly/darwin/aarch64/1.0.1", "26.0"),
  crash("1.0.2"),
  crash(BETA),
  crash("9.9.9"),
];
const WINDOWS_CRASH: CrashSystem = { app_platform: "windows", arch: "x86_64", os: WINDOWS_11 };
/**
 * Everything a Windows copy asks, and how each is answered, by the manifests
 * (docs/engineering/services-and-feedback.md#SERV-283).
 */
const WINDOWS: ({ ask: Ask } & Record<Platforms, string>)[] = [
  ...["/v1", "/v1/stable"].flatMap((route) =>
    ["x86_64", "aarch64"].map((arch) => ({
      ask: check(`${route}/windows/${arch}/1.0.1`, WINDOWS_11),
      mac: "204",
      windows: "200 1.0.2 windows-x86_64,windows-aarch64",
      broken: "502",
    })),
  ),
  ...["x86_64", "aarch64"].map((arch) => ({
    ask: check(`/v1/beta/windows/${arch}/1.0.1`, WINDOWS_11),
    mac: "204",
    windows: `200 ${BETA} windows-x86_64,windows-aarch64`,
    broken: "502",
  })),
  {
    ask: check("/v1/windows/x86_64/1.0.1", "10.0.19045"),
    mac: "204",
    windows: "200 1.0.2 windows-x86_64,windows-aarch64",
    broken: "502",
  },
  {
    ask: check("/v1/windows/x86_64/1.0.1", "10.0.19044"),
    mac: "400",
    windows: "400",
    broken: "400",
  },
  { ask: check("/v1/windows/x86_64/1.0.1", "26.0"), mac: "400", windows: "400", broken: "400" },
  // A release's installers are judged on its manifest's Windows part.
  ...["x64-setup.exe", "x64-setup.exe.sig", "arm64-setup.exe", "arm64-setup.exe.sig"].map((f) => ({
    ask: file(`/v1/download/v1.0.2/Proscenium_1.0.2_${f}`),
    mac: "404",
    windows: "200",
    broken: "502",
  })),
  // A track's files are its version's own objects, as the Mac's are: its manifest is not read.
  ...["x64-setup.exe", "arm64-setup.exe.sig"].map((f) => ({
    ask: file(`/v1/beta/download/v${BETA}/Proscenium_${BETA}_${f}`),
    mac: "404",
    windows: "200",
    broken: "200",
  })),
  { ask: crash("1.0.2", WINDOWS_CRASH), mac: "204", windows: "204", broken: "204" },
];

interface Answer {
  status: number;
  type: string | null;
  cache: string | null;
  body: string;
}
async function ask(a: Ask): Promise<Answer> {
  const r = await fetch(`${UPDATES}${a.path}`, {
    method: a.body === undefined ? "GET" : "POST",
    headers: a.headers,
    body: a.body,
  });
  return {
    status: r.status,
    type: r.headers.get("Content-Type"),
    cache: r.headers.get("Cache-Control"),
    body: await r.text(),
  };
}
/** A Windows answer, said as WINDOWS says what it should be: its status, and for a check the version and keys it offers. */
function said(a: Answer, isCheck: boolean): string {
  if (a.status !== 200 || !isCheck) return String(a.status);
  const data = JSON.parse(a.body) as {
    version: string;
    platforms: Record<string, { url: string }>;
  };
  const routes = Object.values(data.platforms).every((p) => p.url.startsWith(`${UPDATES}/v1/`));
  return `${a.status} ${data.version} ${Object.keys(data.platforms).join(",")}${routes ? "" : " (an archive off this Worker's routes)"}`;
}

interface Run {
  mac: Answer[];
  windows: Answer[];
  counted: unknown[];
  crashes: number;
}
async function run(edge: string, platforms: Platforms, dir: string): Promise<Run> {
  mkdirSync(dir, { recursive: true });
  const config = configure(edge, dir);
  const state = join(dir, "state");
  seed(config, state, dir, platforms);
  const outside = standIns(platforms);
  const child = await serve(config, state, join(dir, "wrangler.log"));
  try {
    const mac: Answer[] = [];
    for (const a of MAC) mac.push(await ask(a));
    const windows: Answer[] = [];
    for (const w of WINDOWS) windows.push(await ask(w.ask));
    await stopped(child);
    return { mac, windows, counted: counted(config, state), crashes: outside.crashes.length };
  } finally {
    await stopped(child);
    outside.stop();
  }
}

const work = mkdtempSync(join(tmpdir(), "proscenium-standin-windows-"));
let failures = 0;
const fail = (line: string) => {
  failures++;
  console.log(`  FAIL ${line}`);
};
try {
  const before = checkout(AGAINST, join(work, "before"));
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  const dirty = spawnSync("git", ["status", "--porcelain", "--", "services/edge"], {
    cwd: ROOT,
    encoding: "utf8",
  }).stdout.trim();
  console.log(`Before: ${AGAINST} (${before.commit.slice(0, 8)}), services/edge from git.`);
  console.log(
    `Now: this checkout (${head.stdout.trim()}${dirty ? ", with uncommitted changes" : ""}).`,
  );
  console.log(
    `Each under wrangler dev --local at ${UPDATES}; GitHub's stand-in at ${GITHUB}; Sentry's at ${SENTRY}.\n`,
  );
  const runs: Record<string, Run> = {};
  for (const [name, edge, platforms] of [
    ["before, the Mac's manifests", before.edge, "mac"],
    ["now, the Mac's manifests", EDGE, "mac"],
    ["now, manifests naming Windows", EDGE, "windows"],
    ["now, a broken Windows part", EDGE, "broken"],
    ["before, manifests naming Windows", before.edge, "windows"],
  ] as const) {
    const t = Date.now();
    runs[name] = await run(edge, platforms, join(work, name.replace(/[^a-z]+/gi, "-")));
    console.log(`ran ${name} (${((Date.now() - t) / 1000).toFixed(0)} s)`);
  }
  const reference = runs["before, the Mac's manifests"];

  console.log(`\nMac requests: ${MAC.length}, each answered by "before, the Mac's manifests":`);
  for (const [i, a] of MAC.entries()) {
    const r = reference.mac[i];
    console.log(`  ${String(r.status).padEnd(4)}${a.name}`);
  }
  console.log("\nThe same requests, answered byte for byte as that (status, type, cache, body):");
  for (const name of Object.keys(runs).slice(1)) {
    const same = MAC.filter((_, i) => Bun.deepEquals(runs[name].mac[i], reference.mac[i])).length;
    const expected = !name.startsWith("before");
    console.log(`  ${name}: ${same} of ${MAC.length} the same`);
    if (expected) {
      for (const [i, a] of MAC.entries())
        if (!Bun.deepEquals(runs[name].mac[i], reference.mac[i]))
          fail(
            `${name}: ${a.name} answered ${runs[name].mac[i].status}, before ${reference.mac[i].status}`,
          );
    } else {
      const changed = MAC.flatMap((a, i) =>
        Bun.deepEquals(runs[name].mac[i], reference.mac[i])
          ? []
          : [`${runs[name].mac[i].status} ${a.name} (was ${reference.mac[i].status})`],
      );
      console.log(
        "    what the Worker before this change answers a Mac once a manifest names Windows:",
      );
      for (const line of changed) console.log(`      ${line}`);
    }
  }
  // A check is counted by its system; a download by its version alone, as
  // before Windows, so Windows' installer downloads add to their version's row.
  type Row = { kind: string; platform: string; version: string; count: number };
  const rows = (run: Run, kind: string, platform: string) =>
    (run.counted as Row[]).filter((r) => r.kind === kind && r.platform === platform);
  console.log("\nWhat each run counted (D1 update_counts):");
  for (const [name, r] of Object.entries(runs)) {
    const checks = Bun.deepEquals(rows(r, "check", "darwin"), rows(reference, "check", "darwin"));
    // Downloads: the reference's, and each Windows file this run served, by its version.
    const expected = structuredClone(rows(reference, "download", ""));
    let added = 0;
    for (const [i, w] of WINDOWS.entries()) {
      const version = /\/download\/v([^/]+)\//.exec(w.ask.path)?.[1];
      if (version === undefined || r.windows[i].status !== 200) continue;
      const row = expected.find((e) => e.version === version);
      added++;
      if (row) row.count++;
      else fail(`${name}: Windows downloaded ${version}, which no Mac did`);
    }
    const downloads = Bun.deepEquals(rows(r, "download", ""), expected);
    const windowsChecks = rows(r, "check", "windows").reduce((n, row) => n + row.count, 0);
    const counts = downloads
      ? `the Mac's${added ? `, and Windows' ${added} added to their versions` : ""}`
      : "NOT the Mac's";
    console.log(
      `  ${name}: the Mac's checks ${checks ? "the same" : "NOT the same"} (${rows(r, "check", "darwin").length} rows); downloads ${counts}; Windows' checks ${windowsChecks}; crash reports forwarded ${r.crashes}`,
    );
    if (name.startsWith("now") && !(checks && downloads)) fail(`${name}: the Mac's counts differ`);
  }

  for (const [name, platforms] of [
    ["now, the Mac's manifests", "mac"],
    ["now, manifests naming Windows", "windows"],
    ["now, a broken Windows part", "broken"],
  ] as const) {
    console.log(`\nWindows requests, ${name}:`);
    for (const [i, w] of WINDOWS.entries()) {
      const got = said(
        runs[name].windows[i],
        w.ask.name.startsWith("GET") && !w.ask.path.includes("/download/"),
      );
      const want = w[platforms];
      console.log(`  ${got === want ? "ok  " : "FAIL"} ${got.padEnd(48)} ${w.ask.name}`);
      if (got !== want) fail(`${name}: ${w.ask.name} answered ${got}, not ${want}`);
    }
    const rows = runs[name].counted.filter(
      (r) => (r as { platform: string }).platform === "windows",
    );
    console.log(`  counted as Windows': ${JSON.stringify(rows)}`);
  }
  console.log("\nWindows requests, before (the Worker this change replaces), for comparison:");
  for (const name of ["before, the Mac's manifests", "before, manifests naming Windows"]) {
    const statuses = runs[name].windows.map((a) => a.status);
    console.log(`  ${name}: ${statuses.join(" ")}`);
  }
  console.log(
    failures
      ? `\nFAILED: ${failures}`
      : "\nAll as docs/engineering/services-and-feedback.md#SERV-283 says.",
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
