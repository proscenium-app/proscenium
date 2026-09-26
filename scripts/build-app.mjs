// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Build Proscenium.app, then refuse it unless it passes check-bundle.
 *
 *   node scripts/build-app.mjs --universal --dmg   bun run build:universal — the real artifact
 *   node scripts/build-app.mjs --universal --selftest
 *                                                  bun run build:selftest — what CI's native matrix runs
 *   node scripts/build-app.mjs --selftest          the same for this Mac only, for iterating
 *
 *   node scripts/build-app.mjs --local             bun run app:install — this Mac's slice, no updater
 *   node scripts/build-app.mjs --update-proof      the update proof's copy of this version: the self-test
 *                                                  build under the real app's name and identifier, for
 *                                                  the build host's proof only
 *
 * `--universal` builds `universal-apple-darwin`: one bundle for Apple silicon and
 * Intel, the loader picks the slice (docs/engineering/release-engineering.md#REL-123). `bun run app:install`
 * stays host-only because a universal build compiles the crate twice.
 *
 * `--local` builds without default features, so without the updater, and with
 * the `local` feature, so the copy says `local`.
 * A local build that could update would replace itself with the next alpha.
 *
 * `--selftest` turns on the Cargo feature of the same name (release-engineering
 * docs/engineering/release-engineering.md#REL-D4) and builds a DIFFERENT app: bundle id `org.habiby.proscenium.selftest`,
 * named "Proscenium Self-Test", its webview on a non-persistent data store. A
 * test build that shared the real identifier would share the real app's
 * preferences, WebKit storage and Launch Services registration — a test run on
 * a writer's Mac could reopen their Plays folder, and a double-clicked play
 * could open in the test build. It is ad-hoc signed without entitlements, like
 * a local install, because the CI runners have no certificate; the release
 * gate (`--release`, implied without `--selftest`) proves no self-test code
 * reached the shipped binary.
 *
 * `--update-proof` is that self-test build with one difference: the real app's
 * name and bundle id. The update it installs is the real next version, whose
 * archive the installer takes only for the app it was built for, so the copy
 * that asks must be that app. Started with PROSCENIUM_UPDATE_PROOF, its updater
 * asks the real service (src-tauri/src/selftest.rs). Only the build host's proof
 * script builds it, into a scratch home that nothing else reads; like every
 * self-test build it is never packaged or shipped.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { requireDiskFloor } from "./disk-floor.mjs";
import { holdHostBench } from "./host-bench.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const UNIVERSAL = args.includes("--universal");
const PROOF = args.includes("--update-proof");
const SELFTEST = args.includes("--selftest") || PROOF;
const DMG = args.includes("--dmg");
const LOCAL = args.includes("--local");

if (SELFTEST && DMG) {
  console.error("build-app: a self-test build is never packaged for distribution — drop --dmg");
  process.exit(1);
}
if (LOCAL && (SELFTEST || DMG || UNIVERSAL)) {
  console.error("build-app: --local is this Mac's own copy, for app:install — not with --selftest, --dmg or --universal");
  process.exit(1);
}

const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const productName = SELFTEST && !PROOF ? "Proscenium Self-Test" : conf.productName;

const tauriArgs = ["build", "--bundles", DMG ? "app,dmg" : "app"];
if (UNIVERSAL) tauriArgs.push("--target", "universal-apple-darwin");
if (LOCAL) tauriArgs.push("--features", "custom-protocol,local", "--", "--no-default-features");
/**
 * The self-test app's Info.plist: the real app's keys, and `NSAppSleepDisabled`.
 * App Nap would coalesce the app's own timers once every window is covered, as
 * all of them are behind the build host's locked screen
 * (the self-test runs there without unlocking it). The opt-out is this app's
 * property, not the host's, and holds no power assertion.
 */
function selftestInfoPlist() {
  const path = join(ROOT, "src-tauri/target/selftest/Info.plist");
  const real = readFileSync(join(ROOT, "src-tauri/Info.plist"), "utf8");
  const plist = real.replace(/<\/dict>\s*<\/plist>\s*$/, "  <key>NSAppSleepDisabled</key>\n  <true/>\n</dict>\n</plist>\n");
  if (plist === real) throw new Error("build-app: src-tauri/Info.plist does not end in </dict></plist>");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, plist);
  return path;
}

if (SELFTEST) {
  tauriArgs.push("--features", "selftest");
  // A merge patch replaces arrays whole, so the window list is copied from the
  // real config rather than restated — a window setting added there reaches
  // the self-test build without anyone remembering this file.
  const overlay = {
    identifier: PROOF ? conf.identifier : `${conf.identifier}.selftest`,
    productName,
    // acceptFirstMouse: a click reaches the page even when the window is not
    // key, so a run survives someone clicking another app mid-test. The shipped
    // app keeps the Mac default (the first click only activates).
    app: { windows: conf.app.windows.map((w) => ({ ...w, incognito: true, acceptFirstMouse: true })) },
    bundle: { macOS: { infoPlist: selftestInfoPlist() } },
  };
  tauriArgs.push("--config", JSON.stringify(overlay));
}

const env = {
  ...process.env,
  // Local installs, universal checks and self-tests never enable automatic reports.
  PROSCENIUM_REPORTS: "0",
  // CI skips the AppleScript that arranges the DMG window in Finder: on a
  // desktop it opens Finder windows in front of whatever the person is doing.
  CI: process.env.CI ?? "true",
};

if (SELFTEST) {
  // The in-page half of the self-test, one self-contained script with axe-core
  // inside it. The Rust half embeds it at compile time (src-tauri/build.rs), so
  // it is bundled first, and never into dist/.
  const harness = join(ROOT, "src-tauri/target/selftest/harness.js");
  execFileSync(
    "bun",
    ["build", "scripts/selftest/harness.mjs", "--target=browser", "--format=iife", "--minify", `--outfile=${harness}`],
    { cwd: ROOT, stdio: "inherit" },
  );
  env.PROSCENIUM_SELFTEST_HARNESS = harness;
}

// Every core the compiler can take, and never beside a native self-test on the same host.
await holdHostBench("an app build");

// A universal build compiles the crate twice, so it needs room for both
// per-architecture target directories on top of the release one. Refusing here
// costs a second; finding out at the link step costs the whole build and reads
// like a code fault (scripts/disk-floor.mjs).
try {
  requireDiskFloor({
    reserveGb: UNIVERSAL ? 6 : 4,
    label: `a ${UNIVERSAL ? "universal " : ""}build of ${productName}`,
  });
} catch (err) {
  console.error(err.message);   // Already says the numbers; a stack adds nothing.
  process.exit(1);
}

console.log(`build-app: tauri ${tauriArgs.join(" ")}`);
execFileSync(join(ROOT, "node_modules/.bin/tauri"), tauriArgs, { cwd: ROOT, stdio: "inherit", env });

const app = join(
  ROOT,
  "src-tauri/target",
  UNIVERSAL ? "universal-apple-darwin" : "",
  "release/bundle/macos",
  `${productName}.app`,
);

if (SELFTEST) {
  const sleep = execFileSync("plutil", ["-extract", "NSAppSleepDisabled", "raw", join(app, "Contents/Info.plist")], { encoding: "utf8" }).trim();
  if (sleep !== "true") {
    console.error(`build-app: the self-test app's NSAppSleepDisabled is ${sleep || "missing"}, not true`);
    process.exit(1);
  }
  // Ad hoc and WITHOUT Entitlements.plist: its iCloud keys need a provisioning
  // profile, and an ad-hoc app that claims them is killed at launch.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
}

const checkArgs = [join(ROOT, "scripts/check-bundle.mjs"), app];
if (UNIVERSAL) checkArgs.push("--universal");
if (!SELFTEST) checkArgs.push("--release");
execFileSync(process.execPath, checkArgs, { stdio: "inherit" });
console.log(`build-app: ${app}`);
