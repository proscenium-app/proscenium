// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The update proof on Windows: the update a writer's copy makes, made on a
 * clean hosted Windows machine of each chip, as the Mac's own update proof
 * makes it on a Mac. The Windows release workflow runs it, dispatched at the
 * tag of the version the update must bring.
 *
 *   node scripts/windows/update-proof.mjs --copy <installer> --from <X.Y.Z> --to <version>
 *        [--track stable|beta] [--tree <dir>] [--out <dir>]
 *        [--replay <answers.json> --installers <dir>]
 *
 * `--copy` is the installer of the copy updated from: the update-proof build
 * (`node scripts/build-app.mjs --update-proof`) of the stable release before,
 * built from its own tag by that tree's own build, or, for a stand-in, of the
 * release's line numbered as the release before. `--to` is the version the
 * update must bring, X.Y.Z or X.Y.Z-beta.N; `--track` follows it unless given.
 * `--tree` is the tree the copy was built from, whose sample play it opens.
 *
 * It then, as a writer's PC would:
 *
 *   1. installs the copy for the current user, silently, where a writer's
 *      copy goes, and checks it is the version updated from;
 *   2. gives it the sample play, inside the app's own data so it reopens with
 *      no folder chosen, the track, the play open at launch, and reports and
 *      update checks off, so the launch is not counted and nothing asks
 *      unasked;
 *   3. starts it. Its page presses Check Now, waits for the new version to
 *      download, types a line into the script and presses Restart to Update
 *      at once (scripts/update-proof/drive.js); the updater checks the
 *      installer against its signature, runs it, and the installer starts
 *      the new version;
 *   4. passes only when the version installed and running is then `--to`
 *      (a beta's whole version compiled into it too), still running twenty
 *      seconds on, with no crash report, and, after it is closed through its
 *      window, with the typed line in the play's file.
 *
 * **The service it asks.** The update service at its real address, which
 * every released copy asks. A stand-in's proof (`--replay`) asks a stand-in
 * of the service on this machine's loopback address instead, which only an
 * update-proof build takes: the answers the stand-in's own service gave on
 * the build host for this check, and the installer it published, served
 * byte for byte on the same address, since a hosted machine cannot reach the
 * build host. `answers.json` is `{ origin, routes: [{ path, status, type,
 * body }|{ path, status, type, file, sha256 }] }`; a file is read from
 * `--installers` and held to its hash, and anything else asked is answered
 * 404 and said.
 *
 * Writes `<out>/report.json`, the copy's log and the stand-in's requests.
 * Exits 0 when the update is proven, 1 when it is not, 2 when it could not run.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TARGET = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta\.(0|[1-9]\d*))?$/;
const LOOPBACK = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/;
/** The variable an update-proof build reads its stand-in's origin from. */
export const ORIGIN_VAR = "PROSCENIUM_UPDATE_PROOF_ORIGIN";
/** The sample play the copy opens (sample-vault/). */
const PLAY = "The Lighthouse";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => console.log(`update-proof: ${line}`);

const cannot = (why) => Object.assign(new Error(why), { code: 2 });
const fail = (why) => Object.assign(new Error(why), { code: 1 });

/** Whether release `a` comes before release `b`, both X.Y.Z. */
export function before(a, b) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

/** What the command line asks for, or why it cannot be run (an error whose `code` is 2). Pure. */
export function readOptions(argv, { root = ROOT } = {}) {
  const valued = new Set([
    "--copy",
    "--from",
    "--to",
    "--track",
    "--tree",
    "--out",
    "--replay",
    "--installers",
  ]);
  const given = {};
  for (let i = 0; i < argv.length; i++) {
    if (!valued.has(argv[i])) throw cannot(`${argv[i]} is not an option of the update proof`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw cannot(`${argv[i]} needs a value`);
    if (argv[i] in given) throw cannot(`${argv[i]} is given twice`);
    given[argv[i]] = value;
    i++;
  }
  if (!given["--copy"]) throw cannot("--copy <installer>: the copy updated from, its installer");
  const from = given["--from"];
  if (!RELEASE.test(from ?? ""))
    throw cannot("--from <X.Y.Z>: the release the copy updated from is numbered as");
  const to = given["--to"];
  if (!TARGET.test(to ?? ""))
    throw cannot("--to <version>: the version the update must bring, X.Y.Z or X.Y.Z-beta.N");
  const beta = to.includes("-beta.");
  const track = given["--track"] ?? (beta ? "beta" : "stable");
  if (track !== "stable" && track !== "beta")
    throw cannot(`--track is stable or beta, not ${track}`);
  if (beta && track === "stable")
    throw cannot(`${to} is a beta, and a copy on the stable track is never offered one`);
  if (!beta && track === "beta")
    throw cannot(`a beta's proof updates to a beta, X.Y.Z-beta.N, not ${to}`);
  if (!before(from, to.replace(/-beta\..*$/, "")))
    throw cannot(`the copy updated from, ${from}, must come before ${to}`);
  const replay = given["--replay"] ?? null;
  const installers = given["--installers"] ?? null;
  if (Boolean(replay) !== Boolean(installers))
    throw cannot("--replay and --installers go together: the stand-in's answers and its files");
  const out = resolve(given["--out"] ?? join(root, ".update-proof"));
  if (out === resolve(root) || resolve(root).startsWith(`${out}${out.endsWith("\\") ? "" : "/"}`))
    throw cannot(`--out ${out} would be emptied, and it holds the checkout`);
  return {
    copy: resolve(given["--copy"]),
    from,
    to,
    track,
    tree: resolve(given["--tree"] ?? root),
    out,
    replay: replay ? resolve(replay) : null,
    installers: installers ? resolve(installers) : null,
  };
}

/**
 * The copy's settings.json: the play open at launch, the track, nothing asked
 * unasked, nothing counted. The same keys a Mac's proof gives its copy.
 */
export function scratchSettings({ plays, playId, track }) {
  return {
    lastVault: plays,
    lastPlay: playId,
    updateTrack: track,
    checkForUpdates: false,
    shareAnalytics: false,
    privacyNoticeSeen: true,
  };
}

/**
 * A stand-in's answers, checked: `{ origin, routes }`, each route a path
 * under `/v1/` with a status, a type, and a body or a file held to its hash.
 * Throws why not.
 */
export function readAnswers(doc) {
  const d = typeof doc === "string" ? JSON.parse(doc) : doc;
  if (!LOOPBACK.test(d?.origin ?? ""))
    throw cannot(`the answers' origin is http://127.0.0.1:<port>, not ${d?.origin}`);
  if (!Array.isArray(d.routes) || !d.routes.length) throw cannot("the answers hold no route");
  const paths = new Set();
  const routes = d.routes.map((r) => {
    if (!/^\/v1\/[\w./-]+$/.test(r?.path ?? "") || r.path.includes(".."))
      throw cannot(`${r?.path} is not a route of the update service`);
    if (paths.has(r.path)) throw cannot(`${r.path} is answered twice`);
    paths.add(r.path);
    if (!Number.isInteger(r.status) || r.status < 200 || r.status > 599)
      throw cannot(`${r.path}: ${r.status} is not a status`);
    if (typeof r.type !== "string" || !r.type) throw cannot(`${r.path} has no content type`);
    const file = r.file ?? null;
    if (file !== null) {
      if (!/^[\w.-]+$/.test(file)) throw cannot(`${r.path}: ${file} is not a file's name`);
      if (!/^[0-9a-f]{64}$/.test(r.sha256 ?? ""))
        throw cannot(`${r.path}: ${file} is not held to a SHA-256`);
    } else if (typeof r.body !== "string") throw cannot(`${r.path} has neither a body nor a file`);
    return {
      path: r.path,
      status: r.status,
      type: r.type,
      body: r.body ?? null,
      file,
      sha256: r.sha256 ?? null,
    };
  });
  return { origin: d.origin, port: Number(LOOPBACK.exec(d.origin)[1]), routes };
}

/**
 * A stand-in's answers for each chip, `{ x64, arm64 }`, as a workflow input
 * carries them: gzip, then base64, so a release's notes in the answer stay
 * well inside an input's 65,535 characters.
 */
export function encodeAnswers(byChip) {
  const text = gzipSync(Buffer.from(JSON.stringify(byChip), "utf8")).toString("base64");
  if (text.length > 60_000)
    throw new Error(
      `the stand-in's answers are ${text.length} characters, more than an input holds`,
    );
  return text;
}

/** One chip's answers from what `encodeAnswers` made, checked. */
export function decodeAnswers(text, chip) {
  const all = JSON.parse(gunzipSync(Buffer.from(String(text).trim(), "base64")).toString("utf8"));
  if (!all?.[chip]) throw cannot(`the stand-in's answers hold none for ${chip}`);
  return readAnswers(all[chip]);
}

/** A file's SHA-256, as hex. */
export const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * The stand-in, served on this machine's loopback address: each route as it
 * was answered, every other request 404, and each request written to `log`.
 * Returns the server, listening.
 */
export async function serveAnswers(answers, { installers, log }) {
  const bodies = new Map(
    answers.routes.map((r) => {
      if (!r.file) return [r.path, { ...r, bytes: Buffer.from(r.body, "utf8") }];
      const file = join(installers, r.file);
      if (!existsSync(file)) throw cannot(`${r.file} is not in ${installers}`);
      const got = sha256(file);
      if (got !== r.sha256)
        throw cannot(`${r.file} is not the file the stand-in published: ${got} is not ${r.sha256}`);
      return [r.path, { ...r, bytes: readFileSync(file) }];
    }),
  );
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", answers.origin).pathname;
    const found = request.method === "GET" ? bodies.get(path) : undefined;
    appendFileSync(
      log,
      `${new Date().toISOString()} ${request.method} ${request.url} ${found ? found.status : 404}\n`,
    );
    if (!found) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(found.status, {
      "content-type": found.type,
      "content-length": String(found.bytes.length),
    });
    response.end(found.bytes);
  });
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(answers.port, "127.0.0.1", ok);
  });
  return server;
}

// --- on Windows ----------------------------------------------------------------------------

/** Windows PowerShell, one script, its output; a failure throws with what it said. */
function ps(script) {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "powershell failed").trim());
  return (r.stdout ?? "").trim();
}

const quoted = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** The per-user install's entry: `{ location, version }`, or null when none. */
function installed(product) {
  const out = ps(
    `$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${product}'; if (Test-Path $k) { $p = Get-ItemProperty $k; "$($p.InstallLocation)|$($p.DisplayVersion)" }`,
  );
  if (!out) return null;
  const [location, version] = out.split("|");
  return { location: location.replace(/^"|"$/g, ""), version };
}

/** A version as Windows' resources say it, X.Y.Z or X.Y.Z.W, as X.Y.Z. */
export const threePart = (v) =>
  String(v)
    .trim()
    .replace(/^(\d+\.\d+\.\d+)\.\d+$/, "$1");

/** An executable's product version, X.Y.Z. */
function productVersion(exe) {
  return threePart(ps(`(Get-Item -LiteralPath ${quoted(exe)}).VersionInfo.ProductVersion`));
}

/** The processes running `exe`, by pid. */
function processesOf(exe) {
  const out = ps(
    `Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ${quoted(exe)} } | ForEach-Object { $_.Id }`,
  );
  return out
    .split(/\r?\n/)
    .map((l) => Number(l.trim()))
    .filter(Boolean);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

async function exited(pid, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500))
    if (!alive(pid)) return true;
  return false;
}

/** Windows' crash reports and dumps of the app, made since `since`. */
function crashReports(since) {
  const places = [
    join(process.env.LOCALAPPDATA ?? "", "CrashDumps"),
    join(process.env.LOCALAPPDATA ?? "", "Microsoft/Windows/WER/ReportArchive"),
    join(process.env.LOCALAPPDATA ?? "", "Microsoft/Windows/WER/ReportQueue"),
    join(process.env.ProgramData ?? "C:/ProgramData", "Microsoft/Windows/WER/ReportArchive"),
    join(process.env.ProgramData ?? "C:/ProgramData", "Microsoft/Windows/WER/ReportQueue"),
  ];
  return places
    .filter(existsSync)
    .flatMap((d) => readdirSync(d).map((f) => join(d, f)))
    .filter((f) => /proscenium/i.test(f) && statSync(f).mtimeMs >= since);
}

async function prove(options, report, step) {
  const { copy, from, to, track, tree, out } = options;
  const conf = JSON.parse(readFileSync(join(tree, "src-tauri/tauri.conf.json"), "utf8"));
  const product = conf.productName;
  if (!existsSync(copy)) throw cannot(`there is no installer at ${copy}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const log = join(out, "proof.log");
  const asked = join(out, "stand-in.log");
  let server = null;
  let first = null;
  let location = null;
  let clean = false;
  const appData = join(process.env.APPDATA ?? "", conf.identifier);
  // WebView2's data, beside the install.
  const localData = join(process.env.LOCALAPPDATA ?? "", conf.identifier);
  try {
    if (installed(product))
      throw cannot(`${product} is installed here already: a proof starts clean`);
    for (const dir of [appData, localData])
      if (existsSync(dir)) throw cannot(`${dir} exists already: a proof starts clean`);
    // From here on, what the copy leaves is the proof's own, and is removed.
    clean = true;

    // 1. The copy, installed as a writer's is: for this user, silently.
    step("installing the copy", { installer: copy });
    const setup = spawnSync(copy, ["/S"], { stdio: "inherit" });
    if (setup.status !== 0) throw cannot(`the copy's installer exited ${setup.status}`);
    const entry = installed(product);
    if (!entry) throw cannot("the copy's installer left no uninstall entry for this user");
    location = entry.location;
    const exe = join(location, `${conf.mainBinaryName ?? "proscenium"}.exe`);
    if (!existsSync(exe)) throw cannot(`the install holds no ${exe}`);
    const says = productVersion(exe);
    step("the copy installed", { location, version: says, entry: entry.version });
    if (says !== from) throw cannot(`the installed copy is ${says}, not ${from}`);
    const bytes = readFileSync(exe);
    if (!bytes.includes(Buffer.from("PROSCENIUM_UPDATE_PROOF")))
      throw cannot("the copy is not an update-proof build, which alone can be driven to update");
    if (options.replay && !bytes.includes(Buffer.from(ORIGIN_VAR)))
      throw cannot(`the copy does not take a stand-in's address (${ORIGIN_VAR})`);

    // 2. The scratch play and settings, in the app's own data.
    const plays = join(appData, "Plays");
    mkdirSync(plays, { recursive: true });
    cpSync(join(tree, "sample-vault", PLAY), join(plays, PLAY), { recursive: true });
    const playId = JSON.parse(readFileSync(join(plays, PLAY, `${PLAY}.proscenium`), "utf8")).id;
    writeFileSync(
      join(appData, "settings.json"),
      `${JSON.stringify(scratchSettings({ plays, playId, track }), null, 2)}\n`,
    );
    const line = `Proof line ${Date.now().toString(36)}`;
    step("scratch play", { plays, play: PLAY, track, line });

    // The stand-in, when the proof asks one.
    let origin = null;
    if (options.replay) {
      const answers = readAnswers(readFileSync(options.replay, "utf8"));
      server = await serveAnswers(answers, { installers: options.installers, log: asked });
      origin = answers.origin;
      step("the stand-in's answers served", {
        origin,
        routes: answers.routes.map((r) => `${r.path} ${r.status}${r.file ? ` ${r.file}` : ""}`),
      });
    }

    // 3. The copy, started; it ends itself when the installer begins.
    const started = Date.now();
    const env = {
      ...process.env,
      PROSCENIUM_UPDATE_PROOF: log,
      PROSCENIUM_UPDATE_PROOF_LINE: line,
    };
    delete env[ORIGIN_VAR];
    if (origin) env[ORIGIN_VAR] = origin;
    step("starting the copy", { exe, asks: origin ?? "the update service" });
    first = spawn(exe, [], { stdio: ["ignore", "pipe", "pipe"], env });
    const sink = [];
    first.stdout.on("data", (d) => sink.push(d));
    first.stderr.on("data", (d) => sink.push(d));
    const firstExit = new Promise((r) => first.on("exit", (code, signal) => r({ code, signal })));
    const outcome = await Promise.race([
      firstExit.then((e) => ({ exited: e })),
      (async () => {
        for (const end = Date.now() + 25 * 60_000; Date.now() < end; await sleep(2000)) {
          const said = existsSync(log) ? readFileSync(log, "utf8") : "";
          const failed = said.match(/FAILED: (.*)/);
          if (failed) return { failed: failed[1] };
        }
        return { failed: "the copy neither updated nor said why in 25 minutes" };
      })(),
    ]);
    writeFileSync(join(out, "app.log"), Buffer.concat(sink));
    report.log = existsSync(log) ? readFileSync(log, "utf8").split(/\r?\n/).filter(Boolean) : [];
    if (outcome.failed) throw fail(`the proof's copy: ${outcome.failed}`);
    step("the copy ended, for the installer", outcome.exited);

    // 4. What came back: the installer starts the new version from the same place.
    let next = [];
    for (const end = Date.now() + 180_000; Date.now() < end && !next.length; await sleep(2000))
      next = processesOf(exe);
    if (!next.length)
      throw fail("nothing was running from the install three minutes after the restart");
    const pid = next[0];
    const now = productVersion(exe);
    const entryNow = installed(product);
    step("the relaunched copy", { pid, version: now, entry: entryNow?.version ?? null });
    const base = to.replace(/-beta\.\d+$/, "");
    if (now !== base) report.problems.push(`the copy came back as ${now}, not ${base}`);
    if (threePart(entryNow?.version ?? "") !== base)
      report.problems.push(
        `the uninstall entry says ${entryNow?.version ?? "nothing"}, not ${base}`,
      );
    if (to !== base && !readFileSync(exe).includes(Buffer.from(to)))
      report.problems.push(`the copy installed does not carry its whole version, ${to}`);

    await sleep(20_000);
    if (!alive(pid)) report.problems.push("the new version quit on its own within twenty seconds");
    else step("the new version is still running twenty seconds on");

    // Closed through its window, as a writer closes it.
    spawnSync("taskkill", ["/PID", String(pid)], { stdio: "ignore" });
    if (!(await exited(pid, 30_000))) {
      report.problems.push("the new version did not close when its window was asked to; stopped");
      spawnSync("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
    } else step("the new version closed through its window");
    const script = readFileSync(join(plays, PLAY, `${PLAY}.fountain`), "utf8");
    if (script.includes(line)) step("the typed line is in the play", `${PLAY}.fountain`);
    else report.problems.push(`the typed line "${line}" is not in ${PLAY}.fountain`);

    const crashes = crashReports(started);
    if (crashes.length) report.problems.push(`crash reports: ${crashes.join(", ")}`);
    if (existsSync(asked))
      report.asked = readFileSync(asked, "utf8").split(/\r?\n/).filter(Boolean);
  } finally {
    if (first && first.exitCode === null) first.kill();
    if (location) {
      const exe = join(location, `${conf.mainBinaryName ?? "proscenium"}.exe`);
      for (const pid of existsSync(exe) ? processesOf(exe) : [])
        spawnSync("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
      const uninstaller = join(location, "uninstall.exe");
      if (existsSync(uninstaller)) spawnSync(uninstaller, ["/S"], { stdio: "ignore" });
    }
    if (server) await new Promise((r) => server.close(r));
    // The machine as it was: the scratch play, its settings and WebView2's
    // data, which a silent uninstall keeps as a writer's.
    if (clean) {
      await sleep(3000);
      for (const dir of [appData, localData])
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
        } catch (e) {
          report.problems.push(`${dir} could not be removed after the proof: ${e.message}`);
        }
    }
  }
}

/** The run's step summary, in Markdown, from its report. */
export function summaryOf(report) {
  return [
    `### Windows update proof (${report.arch ?? "?"}): ${report.ok ? "proven" : "NOT proven"}`,
    "",
    "| | |",
    "|---|---|",
    `| Updated from | ${report.from ?? "?"} |`,
    `| Updated to | ${report.to ?? "?"} |`,
    `| Track | ${report.track ?? "?"} |`,
    `| Asked | ${report.asks ?? "?"} |`,
    "",
    ...(report.problems ?? []).map((p) => `- ${String(p).replace(/\n/g, " ")}`),
    "",
  ].join("\n");
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    arch: process.arch,
    steps: [],
    problems: [],
  };
  const step = (what, detail) => {
    report.steps.push({
      at: new Date().toISOString(),
      what,
      ...(detail === undefined ? {} : { detail }),
    });
    say(
      detail === undefined
        ? what
        : `${what}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`,
    );
  };
  let out = resolve(ROOT, ".update-proof");
  let options = null;
  try {
    if (process.platform !== "win32") throw cannot("the Windows update proof runs on Windows");
    options = readOptions(process.argv.slice(2));
    out = options.out;
    Object.assign(report, {
      from: options.from,
      to: options.to,
      track: options.track,
      asks: options.replay ? "a stand-in's answers, replayed" : "the update service",
    });
    await prove(options, report, step);
    report.ok = report.problems.length === 0;
  } catch (e) {
    report.ok = false;
    report.problems.push(e.message);
    report.code = e.code ?? 1;
  }
  report.finishedAt = new Date().toISOString();
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryOf(report));
  for (const p of report.problems) say(`FAIL  ${p}`);
  say(
    report.ok
      ? `proven: ${report.from} on ${report.track} updated itself to ${report.to}, and the line typed before the restart is in the play`
      : "NOT proven",
  );
  process.exit(report.ok ? 0 : (report.code ?? 1));
}

/**
 * `answers --chip <x64|arm64> --out <file>`: one chip's answers, from the
 * workflow's input in `ANSWERS`, written where the proof reads them.
 */
function answersCommand(argv) {
  const at = (name) => argv[argv.indexOf(name) + 1];
  const chip = at("--chip");
  const out = at("--out");
  if (!["x64", "arm64"].includes(chip) || !out)
    throw cannot("answers --chip <x64|arm64> --out <file>");
  const answers = decodeAnswers(process.env.ANSWERS ?? "", chip);
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, `${JSON.stringify(answers, null, 2)}\n`);
  say(
    `the stand-in's answers for ${chip}: ${answers.routes.map((r) => `${r.path} ${r.status}`).join(", ")}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "answers") {
    try {
      answersCommand(process.argv.slice(3));
    } catch (e) {
      console.error(`update-proof: ${e.message}`);
      process.exit(e.code ?? 1);
    }
  } else await main();
}
