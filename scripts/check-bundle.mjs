// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The gate every built Proscenium.app passes before anyone ships, tests or
 * installs it (docs/engineering/release-engineering.md#REL-D1, docs/engineering/release-engineering.md#REL-D2, docs/engineering/release-engineering.md#REL-D4).
 *
 *   node scripts/check-bundle.mjs <Proscenium.app> [--universal | --arm64] [--release] [--version <x.y.z>]
 *
 * Nobody ever chose which Macs the app runs on, and the bundle said so three
 * different ways: `lipo -archs` printed `arm64` alone, which
 * locked out every Intel Mac including ones on current macOS; the plist said
 * 10.13, inviting a High Sierra Mac to launch an app that cannot load; the
 * binary said 11.0. Each of those was a default nobody read. This reads them.
 *
 *   --universal  both slices, x86_64 and arm64, or it fails
 *   --arm64      the Apple silicon slice alone, in every Mach-O it carries: a
 *                pre-release (alpha, beta) is built for Apple silicon only, since
 *                an Intel Mac takes stable releases alone (docs/engineering/release-engineering.md#REL-124)
 *   (always)     LSMinimumSystemVersion and each slice's LC_BUILD_VERSION minos
 *                are the floor in tauri.conf.json; the bundle's version is the
 *                app's one version; LSRequiresNativeExecution is set, so no Mac
 *                runs the app under Rosetta
 *   --version    the version it must say to macOS, when it is not package.json's:
 *                a track build is the next release's, as macOS takes only X.Y.Z
 *   --release    nothing of the self-test is in it: no `selftest` in the binary
 *                and none in dist/ (docs/engineering/release-engineering.md#REL-D4 — a shipped build honours no feature,
 *                command or environment variable of the test harness)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, openSync, readSync, closeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const app = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--version");
const UNIVERSAL = args.includes("--universal");
const ARM64 = args.includes("--arm64");
if (UNIVERSAL && ARM64) {
  console.error("check-bundle: --universal and --arm64 ask for different bundles");
  process.exit(1);
}
const RELEASE = args.includes("--release");
const VERSION_AT = args.indexOf("--version");
const EXPECTED_VERSION = VERSION_AT >= 0 ? args[VERSION_AT + 1] : null;

if (!app || !existsSync(join(app, "Contents/Info.plist"))) {
  console.error(`check-bundle: no app bundle at ${app ?? "(none given)"}`);
  process.exit(1);
}

const run = (cmd, argv) => execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const plist = (key) => run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(app, "Contents/Info.plist")]).trim();

const tauri = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const floor = tauri.bundle.macOS.minimumSystemVersion;
const exe = join(app, "Contents/MacOS", plist("CFBundleExecutable"));

const failures = [];
const passed = [];

// 1. Architectures.
const archs = run("lipo", ["-archs", exe]).trim().split(/\s+/);
if (UNIVERSAL) {
  const missing = ["x86_64", "arm64"].filter((a) => !archs.includes(a));
  if (missing.length) failures.push(`lipo -archs says "${archs.join(" ")}" — missing ${missing.join(" and ")}`);
  else passed.push(`universal (${archs.join(" + ")})`);
} else if (ARM64) {
  if (archs.join(" ") !== "arm64") failures.push(`lipo -archs says "${archs.join(" ")}" — expected arm64 alone`);
  else passed.push("arm64 alone");
} else {
  passed.push(archs.join(" + "));
}

// 1b. Every other Mach-O the bundle carries — a framework, a helper, a plug-in
// — has to have the same slices: a universal main executable linked to an
// arm64-only library loads on an Intel Mac and dies. Found by
// magic number, not by name, because a dylib without an extension is common.
const MAGIC = new Set(["cafebabe", "feedface", "feedfacf", "cefaedfe", "cffaedfe"]);
function machos(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isSymbolicLink()) continue;
    if (name.isDirectory()) out.push(...machos(path));
    else if (name.isFile()) {
      const head = Buffer.alloc(4);
      const fd = openSync(path, "r");
      readSync(fd, head, 0, 4, 0);
      closeSync(fd);
      if (MAGIC.has(head.toString("hex"))) out.push(path);
    }
  }
  return out;
}
const others = ["Frameworks", "PlugIns", "Library", "MacOS", "XPCServices", "Helpers"]
  .flatMap((d) => machos(join(app, "Contents", d)))
  .filter((p) => p !== exe);
for (const dep of others) {
  const depArchs = run("lipo", ["-archs", dep]).trim().split(/\s+/);
  const short = dep.slice(app.length + 1);
  if (UNIVERSAL) {
    const missing = ["x86_64", "arm64"].filter((a) => !depArchs.includes(a));
    if (missing.length) failures.push(`${short} says "${depArchs.join(" ")}" — missing ${missing.join(" and ")}`);
  }
  if (ARM64 && !depArchs.includes("arm64")) failures.push(`${short} says "${depArchs.join(" ")}" — missing arm64`);
}
if (others.length) passed.push(`${others.length} other Mach-O file(s) checked`);

// 2. The floor, as Finder reads it and as the loader reads it.
const lsmin = plist("LSMinimumSystemVersion");
if (lsmin !== floor) failures.push(`Info.plist LSMinimumSystemVersion is ${lsmin}, the floor is ${floor}`);
for (const arch of archs) {
  const build = run("vtool", ["-arch", arch, "-show-build", exe]);
  const minos = build.match(/minos\s+(\S+)/)?.[1] ?? build.match(/version\s+(\d+\.\d+)/)?.[1];
  if (minos !== floor) {
    failures.push(`${arch} slice says minos ${minos ?? "(none)"}, the floor is ${floor} — MACOSX_DEPLOYMENT_TARGET was not applied`);
  }
}
if (!failures.some((f) => f.includes("minos") || f.includes("LSMinimum"))) passed.push(`macOS ${floor} floor`);

// 3. One version.
const shortVersion = plist("CFBundleShortVersionString");
const expected = EXPECTED_VERSION ?? pkg.version;
if (shortVersion !== expected) {
  failures.push(`CFBundleShortVersionString is ${shortVersion}, ${EXPECTED_VERSION ? "expected" : "package.json is"} ${expected}`);
} else {
  passed.push(`version ${shortVersion}`);
}

// 4. Native on every Mac (docs/engineering/release-engineering.md#REL-D1, src-tauri/Info.plist). Under Rosetta, macOS 26
// tells the writer that this version "will not open in a future release of
// macOS"; the key keeps an Apple silicon Mac on the arm64 slice, whatever Get
// Info or `open --arch` asks for.
let native = "";
try {
  native = plist("LSRequiresNativeExecution");
} catch {
  /* absent: PlistBuddy exits non-zero */
}
if (native !== "true") {
  failures.push(
    "Info.plist has no LSRequiresNativeExecution — Finder offers “Open using Rosetta”, and under Rosetta macOS 26 says this version will not open in a future release (src-tauri/Info.plist)",
  );
} else {
  passed.push("native on Apple silicon");
}

// 5. No self-test in a release.
if (RELEASE) {
  // The raw bytes hold symbol names and literals alike: the command names, the
  // environment variable, the harness script. Any one of them means the
  // feature was on. (Read directly — `strings` on a 26 MB binary overflows a
  // child-process buffer.)
  const bytes = readFileSync(exe).toString("latin1");
  const hits = [...bytes.matchAll(/[\x20-\x7e]{0,40}selftest[\x20-\x7e]{0,40}/gi)].map((m) => m[0]);
  if (hits.length) failures.push(`the binary contains self-test code: ${hits.slice(0, 3).join(" · ")}`);
  const assets = join(ROOT, "dist/assets");
  const leaked = existsSync(assets)
    ? readdirSync(assets).filter((f) => /\.(js|css|html)$/.test(f) && /selftest/i.test(readFileSync(join(assets, f), "utf8")))
    : [];
  if (leaked.length) failures.push(`dist/ carries self-test code: ${leaked.join(", ")}`);
  if (!hits.length && !leaked.length) passed.push("no self-test code");
}

if (failures.length) {
  console.error(`check-bundle: ${app}`);
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
console.log(`bundle check: clean (${passed.join(", ")})`);
