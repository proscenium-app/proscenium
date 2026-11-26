// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The iPad app, proven in the iPad simulator on the build host: driven from
 * outside by `simctl` and from inside by the page's probe (scripts/ipad/probe.js,
 * in a build with Cargo's `ipad-probe` feature, never a release build).
 *
 *   node scripts/ipad-sim.mjs                  build, then every step
 *   node scripts/ipad-sim.mjs --no-build       the last build, every step
 *   node scripts/ipad-sim.mjs --steps type,export
 *
 * First, the build itself: every command of the folder-picker plugin's Swift
 * is a selector in the app (scripts/ipad/plugin-commands.mjs), since one the
 * linker left out fails only when it is used.
 *
 * On a simulator of its own, erased first, with a copy of sample-vault/ as the
 * Plays folder in the app's own Documents (On My iPad), and nothing of any
 * writer's:
 *
 *   cloud     the Plays folder as an iPad that never downloaded it holds it,
 *             each play a name with nothing in it; the app's own download
 *             passes bring every play down, the screen saying so and offering
 *             nothing meanwhile (docs/engineering/cross-platform.md#PLAT-69).
 *             First, on the fresh install, so the Plays screen is what opens.
 *   type      a play is opened and words are typed into its script; another
 *             app is brought forward a moment later, before autosave's
 *             two-second wait is over; the app is ended a second after that;
 *             and the script's file on disk holds the words.
 *   verify    the app opened again opens the play with the words in it.
 *   export    a PDF export reaches the share sheet (the plugin's log line, and
 *             a screenshot of the sheet).
 *   settings  Settings › Updates says the App Store updates this copy.
 *   network   the page's requests to another host open no connection, where
 *             a build without WebKit's content rules (the negative control)
 *             is seen to open one.
 *
 * The simulator has no iCloud account, so every step runs with the probe's
 * PROSCENIUM_IPAD_PROBE_COORDINATE: the app treats the Plays folder as one in
 * iCloud Drive, and every listing, read and replace goes through the file
 * coordinator, as it would there. Each report says how many accesses did. The
 * cloud step's plays wait in a folder outside the Plays folder, which
 * PROSCENIUM_IPAD_PROBE_ICLOUD names, as iCloud's would: the probe build's
 * passes stand in for iCloud bringing them down, and the iPad's own pass is
 * asked once beside them, which on a folder iCloud does not keep says so.
 *
 * Holds the host's bench throughout (scripts/host-bench.mjs). Leaves its
 * screenshots and reports in `.ipad-sim/<time>/` and ends with one line per
 * step and an exit of 0 only when every step held.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { holdHostBench } from "./host-bench.mjs";
import { commandsMissingFrom, pluginCommands } from "./ipad/plugin-commands.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const BUNDLE = "org.habiby.proscenium";
const DEVICE = "Proscenium iPad probe";
const DEVICE_TYPE = "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M5-12GB";
const ALL_STEPS = ["cloud", "type", "verify", "export", "settings", "network"];
const steps = args.includes("--steps") ? args[args.indexOf("--steps") + 1].split(",") : ALL_STEPS;
const OUT = join(ROOT, ".ipad-sim", new Date().toISOString().replace(/[:.]/g, "-"));
const APP = join(ROOT, "src-tauri/gen/apple/build/arm64-sim/Proscenium.app");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const run = (cmd, argv, opts = {}) =>
  execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const simctl = (...argv) => run("xcrun", ["simctl", ...argv]).trim();

/** The newest iOS runtime the host's Xcode has. */
function runtime() {
  const { runtimes } = JSON.parse(simctl("list", "runtimes", "-j"));
  const ios = runtimes.filter((r) => r.platform === "iOS" && r.isAvailable);
  if (!ios.length) throw new Error("no iOS simulator runtime on this host");
  return ios
    .sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }))
    .at(-1);
}

/** This script's own simulator, made if missing, erased and booted. */
function device() {
  const { devices } = JSON.parse(simctl("list", "devices", "-j"));
  let udid = Object.values(devices)
    .flat()
    .find((d) => d.name === DEVICE && d.isAvailable)?.udid;
  if (!udid) udid = simctl("create", DEVICE, DEVICE_TYPE, runtime().identifier);
  spawnSync("xcrun", ["simctl", "shutdown", udid], { stdio: "ignore" });
  simctl("erase", udid);
  simctl("boot", udid);
  simctl("bootstatus", udid, "-b");
  return udid;
}

function build() {
  rmSync(join(ROOT, "src-tauri/gen/apple/build"), { recursive: true, force: true });
  const argv = ["tauri", "ios", "build", "--ci", "--target", "aarch64-sim"];
  argv.push("--features", "custom-protocol,ipad-probe", "--", "--no-default-features");
  const built = spawnSync("bun", argv, { cwd: ROOT, stdio: "inherit" });
  // The CLI writes the version and the merged keys into the committed plist.
  spawnSync(
    "git",
    [
      "checkout",
      "--",
      "src-tauri/gen/apple/proscenium_iOS/Info.plist",
      "src-tauri/gen/apple/proscenium.xcodeproj/project.pbxproj",
    ],
    { cwd: ROOT, stdio: "ignore" },
  );
  if (built.status !== 0) throw new Error(`the iPad build failed (${built.status})`);
}

/** Launches the app for one step, with the probe's variables. */
function launch(udid, step, extra = {}) {
  const env = { ...process.env };
  const vars = { PROSCENIUM_IPAD_PROBE: step, PROSCENIUM_IPAD_PROBE_COORDINATE: "1", ...extra };
  for (const [k, v] of Object.entries(vars)) env[`SIMCTL_CHILD_${k}`] = v;
  run("xcrun", ["simctl", "launch", "--terminate-running-process", udid, BUNDLE], { env });
}

function container(udid) {
  return simctl("get_app_container", udid, BUNDLE, "data");
}

/** The probe's report for `step`, once it is there. */
async function report(udid, step, ms = 90_000) {
  const file = join(container(udid), "Library/Caches", BUNDLE, "probe", `${step}.json`);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8");
      writeFileSync(join(OUT, `${step}.json`), text);
      return JSON.parse(text);
    }
    await sleep(250);
  }
  throw new Error(`no report from the probe's ${step} step`);
}

function shot(udid, name) {
  const file = join(OUT, `${name}.png`);
  spawnSync("xcrun", ["simctl", "io", udid, "screenshot", file], { stdio: "ignore" });
  return file;
}

/** A Plays folder in the app's Documents: a copy of sample-vault/. */
function seed(udid) {
  const data = container(udid);
  const plays = join(data, "Documents", "Plays");
  rmSync(plays, { recursive: true, force: true });
  mkdirSync(plays, { recursive: true });
  cpSync(join(ROOT, "sample-vault"), plays, { recursive: true });
  const config = join(data, "Library/Application Support", BUNDLE);
  mkdirSync(config, { recursive: true });
  writeFileSync(
    join(config, "settings.json"),
    JSON.stringify({ lastVault: plays, privacyNoticeSeen: true }, null, 2),
  );
  return plays;
}

/** A TCP listener on the loopback, counting the connections it is offered. */
async function listener() {
  let accepted = 0;
  const server = createServer((socket) => {
    accepted++;
    socket.destroy();
  });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  return { port: server.address().port, count: () => accepted, close: () => server.close() };
}

const results = [];
function held(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? "held" : "FAILED"}  ${step}: ${detail}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await holdHostBench("the iPad simulator's proof (scripts/ipad-sim.mjs)");
  if (!args.includes("--no-build")) build();
  if (!existsSync(APP)) throw new Error(`no simulator build at ${APP}`);
  // Every command of the folder-picker plugin's Swift is in the build: one the
  // linker left out answers "No command … found" only when it is used.
  const missing = commandsMissingFrom(APP, ROOT);
  held(
    "commands",
    missing.length === 0,
    missing.length
      ? `the build lacks ${missing.join(", ")}: nothing names the file that holds them (scripts/ipad/plugin-commands.mjs)`
      : `each of the plugin's ${pluginCommands(ROOT).length} commands is in the build`,
  );
  const udid = device();
  simctl("install", udid, APP);
  const plays = seed(udid);
  const script = join(plays, "The Weight of Water", "The Weight of Water.fountain");
  const words = `Kept as typed on the iPad ${Date.now().toString(36)}`;

  if (steps.includes("cloud")) {
    // Each folder of the Plays folder emptied into one outside it, as iCloud
    // keeps a folder an iPad never downloaded: a name with nothing in it.
    const inCloud = join(container(udid), "Library", "probe-icloud");
    rmSync(inCloud, { recursive: true, force: true });
    const folders = readdirSync(plays).filter(
      (name) => !name.startsWith(".") && statSync(join(plays, name)).isDirectory(),
    );
    const isPlay = (dir) => readdirSync(dir).some((name) => name.endsWith(".proscenium"));
    const expected = folders.filter((name) => isPlay(join(plays, name))).length;
    for (const name of folders) {
      mkdirSync(join(inCloud, name), { recursive: true });
      for (const inner of readdirSync(join(plays, name)))
        renameSync(join(plays, name, inner), join(inCloud, name, inner));
    }
    launch(udid, "cloud", { PROSCENIUM_IPAD_PROBE_ICLOUD: inCloud });
    const came = await report(udid, "cloud", 150_000);
    shot(udid, "cloud");
    simctl("terminate", udid, BUNDLE);
    const back = folders.every((name) => readdirSync(join(plays, name)).length > 0);
    const swift = came.swift ? `the iPad's own pass said ${JSON.stringify(came.swift)}` : "";
    held(
      "cloud",
      Boolean(
        came.ok &&
          came.said &&
          !came.offeredWhileDownloading &&
          came.rows === expected &&
          back &&
          came.swift?.ubiquitous === false,
      ),
      came.ok
        ? `said “${came.said}”; ${came.offeredWhileDownloading ? "offered the sample play meanwhile" : "offered nothing meanwhile"}; ${came.rows} of ${expected} plays listed once down; ${back ? "every folder back" : "a folder still empty"}; ${swift}`
        : came.error,
    );
  }

  if (steps.includes("type")) {
    launch(udid, "type", { PROSCENIUM_IPAD_PROBE_WORDS: words });
    const typed = await report(udid, "type");
    if (!typed.ok) {
      held("type", false, typed.error);
    } else {
      // Another app forward at once, and the app ended a second later: before
      // autosave's two-second wait is over, so only leaving can keep them.
      simctl("launch", udid, "com.apple.Preferences");
      await sleep(1000);
      shot(udid, "type-left");
      simctl("terminate", udid, BUNDLE);
      const kept = readFileSync(script, "utf8").includes(words);
      held(
        "type",
        kept && typed.coordinated > 0,
        `${kept ? `the file holds “${words}”` : "the file does not hold the words"}; ${typed.coordinated} coordinated accesses`,
      );
    }
  }

  if (steps.includes("verify")) {
    launch(udid, "verify", { PROSCENIUM_IPAD_PROBE_WORDS: words });
    const verified = await report(udid, "verify");
    shot(udid, "verify");
    held(
      "verify",
      verified.ok && verified.found,
      verified.ok
        ? `${verified.found ? "opened again, the script holds the words" : "opened again, the script does not hold them"}; ${verified.coordinated} coordinated accesses`
        : verified.error,
    );
    simctl("terminate", udid, BUNDLE);
  }

  if (steps.includes("export")) {
    launch(udid, "export");
    const asked = await report(udid, "export");
    await sleep(3000);
    shot(udid, "export-share-sheet");
    const log = spawnSync(
      "xcrun",
      [
        "simctl",
        "spawn",
        udid,
        "log",
        "show",
        "--last",
        "2m",
        "--predicate",
        'eventMessage CONTAINS "the share sheet is up"',
        "--style",
        "compact",
      ],
      { encoding: "utf8" },
    ).stdout;
    const line = log.split("\n").find((l) => l.includes("the share sheet is up"));
    held(
      "export",
      Boolean(asked.ok && line),
      asked.ok
        ? line
          ? line.replace(/^.*Proscenium: /, "")
          : "no share sheet was logged"
        : asked.error,
    );
    simctl("terminate", udid, BUNDLE);
  }

  if (steps.includes("settings")) {
    launch(udid, "settings");
    const pane = await report(udid, "settings");
    shot(udid, "settings-updates");
    const says = pane.ok && /App Store/.test(pane.text) && !/Check Now/.test(pane.text);
    held(
      "settings",
      says,
      pane.ok
        ? (pane.text.split("\n").find((l) => /App Store|TestFlight/.test(l)) ??
            pane.text.slice(0, 200))
        : pane.error,
    );
    simctl("terminate", udid, BUNDLE);
  }

  if (steps.includes("network")) {
    const fenced = await listener();
    launch(udid, "network", { PROSCENIUM_IPAD_PROBE_PORT: String(fenced.port) });
    const tried = await report(udid, "network");
    await sleep(1000);
    fenced.close();
    simctl("terminate", udid, BUNDLE);
    const control = await listener();
    rmSync(join(container(udid), "Library/Caches", BUNDLE, "probe", "network.json"), {
      force: true,
    });
    launch(udid, "network", {
      PROSCENIUM_IPAD_PROBE_PORT: String(control.port),
      PROSCENIUM_IPAD_PROBE_NO_RULES: "1",
    });
    await report(udid, "network");
    await sleep(1000);
    control.close();
    simctl("terminate", udid, BUNDLE);
    const ok = tried.ok && fenced.count() === 0 && control.count() > 0;
    held(
      "network",
      ok,
      `${fenced.count()} connections with the rules, ${control.count()} without (the control); fetch ${tried.results?.fetch ?? tried.error}`,
    );
  }

  writeFileSync(join(OUT, "results.json"), JSON.stringify({ udid, words, results }, null, 2));
  spawnSync("xcrun", ["simctl", "shutdown", udid], { stdio: "ignore" });
  console.log(`evidence: ${OUT}`);
  // The commands' check, and one result for each step.
  return results.every((r) => r.ok) && results.length === steps.length + 1 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`ipad-sim: ${error.message}`);
    process.exit(1);
  },
);
