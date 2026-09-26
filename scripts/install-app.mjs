// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Install the freshly built Proscenium.app into /Applications — the one-step
// "update the app in my launcher" flow. Run via `bun run app:install`, which
// regenerates icons and `tauri build`s first.
//
//   node scripts/install-app.mjs --signed <Proscenium.app> [--track alpha]
//
// installs a signed, notarized build instead, as it is: the first alpha on
// the maintainer's Mac, which its updater keeps current from then on. It is verified, and
// never re-signed, which would strip its Developer ID and its notarization.
// `--track` sets the copy's update track in settings.json while it is quit,
// and changes nothing else there.
//
// The adaptive icon (light, dark, tinted) is already inside the bundle: Tauri
// embeds the prebuilt src-tauri/icons/Assets.car before signing
// (scripts/make-icon.ts). This used to compile it here, after the build, which
// is the one thing a signed bundle cannot survive.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const argv = process.argv.slice(2);
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const SIGNED = opt("--signed");
const TRACK = opt("--track");
const BUILT = SIGNED ? resolve(SIGNED) : join(repo, "src-tauri/target/release/bundle/macos/Proscenium.app");
const DEST = "/Applications/Proscenium.app";

if (TRACK !== undefined && !["stable", "beta", "alpha"].includes(TRACK)) {
  console.error(`install-app: --track is stable, beta or alpha, not ${TRACK}`);
  process.exit(1);
}
if (TRACK !== undefined && !SIGNED) {
  console.error("install-app: --track is for a signed build; a local build has no updater, because one that could update would swap itself for a published copy at its next check");
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

if (!existsSync(BUILT)) {
  console.error(`install-app: no built bundle at ${BUILT} — run \`bun run tauri build\` first.`);
  process.exit(1);
}

// A signed build is taken only as Apple and its signature say: notarized
// Developer ID, every file sealed.
if (SIGNED) {
  if (spawnSync("codesign", ["--verify", "--deep", "--strict", BUILT], { stdio: "inherit" }).status !== 0) {
    console.error(`install-app: ${BUILT} is not intact as signed — not installing it.`);
    process.exit(1);
  }
  const verdict = spawnSync("spctl", ["--assess", "--type", "execute", "--verbose=4", BUILT], { encoding: "utf8" });
  if (verdict.status !== 0 || !`${verdict.stdout}${verdict.stderr}`.includes("source=Notarized Developer ID")) {
    console.error(`install-app: Gatekeeper does not accept ${BUILT} as notarized — not installing it.`);
    process.exit(1);
  }
}

// --- update etiquette ---
// Never replace the bundle out from under a writer. The app maintains an
// unsaved-work beacon (buffer-state.json, written on every status change and
// cleared on launch); the installer refuses while it says dirty, and quits a
// clean instance GRACEFULLY (AppleScript quit → the app's flush-on-quit runs)
// instead of letting the ditto/open dance kill it. `--force` overrides both,
// eating the last unsaved seconds — for wedged instances only.
const FORCE = process.argv.includes("--force");
const STATE_FILE = join(
  process.env.HOME ?? "",
  "Library/Application Support/org.habiby.proscenium/buffer-state.json",
);

function runningPids() {
  // The unix process is lowercase `proscenium` (the Cargo binary name), while
  // the bundle is Proscenium.app — match case-insensitively to cover both.
  let pids;
  try {
    pids = run("pgrep", ["-ix", "proscenium"]).trim().split("\n").filter(Boolean).map(Number);
  } catch {
    return []; // pgrep exits 1 when nothing matches
  }
  // A name match alone is not this app. An iOS build running in the Simulator
  // has the identical process name and is a different program on a simulated
  // device: AppleScript's `quit` cannot touch it, so counting it as "running"
  // made the installer wait ten seconds and then refuse, permanently, for
  // anyone who had tested on the Simulator that session. Ask ps for the actual
  // executable path and drop anything under CoreSimulator.
  return pids.filter((pid) => {
    try {
      return !run("ps", ["-p", String(pid), "-o", "args="]).includes("/CoreSimulator/");
    } catch {
      return false; // exited between the two calls — not running
    }
  });
}

function readBufferState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null; // no beacon (pre-etiquette build or first run) — can't check
  }
}

const pids = runningPids();
if (pids.length) {
  const state = readBufferState();
  // The beacon only speaks for a live process; a stale file from a crashed
  // instance (pid no longer running) never blocks an install.
  const beaconLive = state && pids.includes(state.pid);
  if (beaconLive && state.dirty && !FORCE) {
    console.error(
      "install-app: Proscenium is running with UNSAVED EDITS — not touching it.\n" +
        "            Save (or just pause typing for a couple of seconds) and re-run,\n" +
        "            or use --force to install anyway.",
    );
    process.exit(1);
  }
  if (!FORCE) {
    console.log("install-app: asking the running Proscenium to quit gracefully…");
    try {
      run("osascript", ["-e", 'tell application "Proscenium" to quit']);
    } catch {
      /* fall through to the wait — the app may already be quitting */
    }
    const deadline = Date.now() + 10_000;
    while (runningPids().length && Date.now() < deadline) {
      execFileSync("sleep", ["0.25"]);
    }
    if (runningPids().length) {
      console.error(
        "install-app: Proscenium did not quit within 10s (a dialog may be open).\n" +
          "            Close it yourself and re-run, or use --force.",
      );
      process.exit(1);
    }
  } else {
    console.log("install-app: --force — skipping the graceful-quit etiquette.");
  }
}

// --- seal the bundle, ad hoc ---
/*
 * Ad hoc and deliberately WITHOUT the entitlements in
 * src-tauri/Entitlements.plist. Those need a real team identifier and a
 * provisioning profile for their iCloud keys, and an ad-hoc-signed app that
 * claims them is killed at launch, so a local install is unsandboxed, reaches
 * the Plays folder by path, and is the honest thing to develop against. The
 * bookmark path still runs: creating and resolving a security-scoped bookmark
 * works outside the sandbox too, it just is not what grants the access.
 *
 * `tauri build` without a signing identity leaves only the linker's signature
 * on the executable, with the bundle's resources unsealed; this seals them.
 */
if (!SIGNED) run("codesign", ["--force", "--deep", "--sign", "-", BUILT]);

// --- the track, while nothing is running to rewrite settings.json ---
if (TRACK) {
  const settings = join(process.env.HOME ?? "", "Library/Application Support/org.habiby.proscenium/settings.json");
  let values = {};
  if (existsSync(settings)) {
    try {
      values = JSON.parse(readFileSync(settings, "utf8"));
    } catch {
      console.error(`install-app: ${settings} does not read as JSON — not touching it, and not installing.`);
      process.exit(1);
    }
    if (values === null || typeof values !== "object" || Array.isArray(values)) {
      console.error(`install-app: ${settings} is not a settings object — not touching it, and not installing.`);
      process.exit(1);
    }
  }
  const next = `${settings}.install-app`;
  writeFileSync(next, `${JSON.stringify({ ...values, updateTrack: TRACK }, null, 2)}\n`, { mode: 0o600 });
  renameSync(next, settings);
  console.log(`install-app: updates come from the ${TRACK} track`);
}

// --- install over /Applications and relaunch ---
rmSync(DEST, { recursive: true, force: true });
run("ditto", [BUILT, DEST]);
try {
  run("killall", ["Dock"]); // bust the icon cache so the new icon shows now
} catch {
  /* Dock restarts itself; a failure here is harmless */
}
run("open", [DEST]);
console.log(`install-app: installed ${DEST} and launched it.`);
