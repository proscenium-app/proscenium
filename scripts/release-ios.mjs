// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The iPad's build, for TestFlight and the App Store
 * (docs/engineering/cross-platform.md#PLAT-65, docs/engineering/release-engineering.md#REL-56):
 * a commit built for iPadOS without the updater, archived unsigned, exported
 * by Xcode with the build host's Apple Distribution identity and the iOS App
 * Store profile, checked, and uploaded to App Store Connect, which processes it
 * and hands it to TestFlight. On the build host, from its release keychain
 * (`PROSCENIUM_KEYCHAIN`), as the Mac App Store's copy is made
 * (scripts/release-app-store.mjs), with the same key, identity and calls.
 *
 *   node scripts/release-ios.mjs build --track alpha [--out <dir>]
 *        this commit, checked out: archived, exported, signed and checked,
 *        the `.ipa` left in <dir>/export for `upload`
 *   node scripts/release-ios.mjs upload [--out <dir>] [--notes <file>]
 *        that build, uploaded, waited on until App Store Connect has processed
 *        it, and given What to Test from <file>; the iPad workflow's own step
 *        alone, in its main queue for an alpha and its beta queue for a beta
 *   node scripts/release-ios.mjs material
 *        what the build host has of the iPad's material, by name, never a value
 *
 * **Only the workflow's own step uploads.** `upload` refuses anywhere but the
 * iPad's workflow (ios-alpha.yml) in its `main` queue, which a batch of
 * `main` carrying iPad work dispatches, for an alpha, and its `beta` queue,
 * which every beta's tag dispatches, for a beta, so a build of any other
 * commit never reaches a tester. Anyone may `build` and check a
 * commit: nothing leaves the host.
 *
 * **The version** is the one the Mac's build of the same commit says
 * (scripts/release.mjs): an alpha is a
 * pre-release of the next release (`version.mjs next`), `X.Y.Z-alpha.N`, the
 * Mac alpha's own; a beta is of the release whose line it is on, `X.Y.Z-beta.N`
 * from its tag at HEAD; a release is package.json's `X.Y.Z`. App Store Connect
 * is given `X.Y.Z`, which CFBundleShortVersionString holds, and a track build's
 * whole version is the app's own Info.plist key `ProsceniumVersion`, written
 * into the archive before the export signs it, as the Mac's track build
 * carries it. The app reports it (version.rs), so the reports service refuses
 * an iPad alpha's as it refuses every alpha's, and the team's own copy is never
 * counted as a writer's. Until 2026-11-04 the iPad took package.json's
 * `X.Y.Z`, which on `main` is the last release's, so its alpha of a commit was
 * `1.0.5 (997.1)` where the Mac's was `1.0.6-alpha.997`, and main's alphas
 * would have shared a version's numbers with its line's betas.
 *
 * The build number (CFBundleVersion) is `N.u`: N the commit's first-parent
 * count, the N of the Mac's `X.Y.Z-alpha.N`, so an iPad build and a Mac alpha
 * of one commit carry one number; u the upload's number for that commit, from
 * 1, read from what App Store Connect already holds, so a build it refused, or
 * one rebuilt before TestFlight ends it, can go again. App Store Connect takes
 * at most three integers there and refuses a number it has seen. Given to this
 * build alone, with its version, through the CLI's configuration (`version`,
 * `bundle.iOS.bundleVersion`), never written into the committed project, and
 * never through `--build-number`, which appends a fourth part.
 *
 * **Reports are compiled in**, as every release build's are, on every track
 * (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-14), and the bundle's
 * check holds the binary to its mark. Through the crate's `reports` feature,
 * never `PROSCENIUM_REPORTS=1` as a Mac's build says it: Xcode builds the
 * Rust by calling the Tauri CLI back, which hands Cargo the features it was
 * given and not this process's environment, so the first trial with the
 * variable alone was built without them, and its check refused it.
 *
 * **An alpha is for the team alone.** Its export says
 * `testFlightInternalTestingOnly`, so App Store Connect lets it reach an
 * internal TestFlight group and never an external group or the App Store.
 *
 * **What it signs with.** Tauri's own signing is not used: its automatic
 * signing is Apple's cloud signing, which an App Manager key may not do, and
 * its manual signing imports the certificate into a keychain of its own. The
 * archive is made unsigned (`--archive-only --no-sign`), and `xcodebuild
 * -exportArchive` signs the export manually with the Apple Distribution
 * identity in the release keychain, which is on the build host's search list,
 * and the iOS App Store profile, made through the API when there is none, it
 * names another certificate, or it lapses within a month.
 *
 * **Waiting, not failing.** Without the key, the identity or the app's record,
 * `build` says what is missing in its result (`waiting`) and exits 0, and
 * `upload` passes it on.
 *
 * Writes `<out>/ios.json`, the result the workflow's verdict reads. Nothing
 * here prints a secret: the API key is written to a private temporary folder
 * for the one command that reads it and removed afterwards, pass or fail; App
 * Store Connect's own calls sign a token with it in memory. Nothing of the
 * build is kept but the result: `upload` removes the `.ipa`, pass or fail.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiOf, appOf, makeProfile, profileDue } from "./app-store-connect.mjs";
import { holdHostBench } from "./host-bench.mjs";
import { commandsMissingFrom } from "./ipad/plugin-commands.mjs";
import { readAltool } from "./release-app-store.mjs";
import { PROFILE_DIR, load, readProfile, storeIds } from "./release-keychain.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

/** The iPad's App Store profile, beside the Mac's (scripts/release-keychain.mjs). */
export const IOS_PROFILE = join(PROFILE_DIR, "Proscenium_iPad_App_Store.mobileprovision");
/** Where Xcode 16 and later look for a profile by its UUID. */
const XCODE_PROFILES = join(homedir(), "Library/Developer/Xcode/UserData/Provisioning Profiles");
const APPLE = join(ROOT, "src-tauri/gen/apple");
const ARCHIVE = join(APPLE, "build/proscenium_iOS.xcarchive");
/** Files the CLI writes into the committed project on every build, put back after. */
const WRITTEN = [
  "src-tauri/gen/apple/proscenium_iOS/Info.plist",
  "src-tauri/gen/apple/proscenium.xcodeproj/project.pbxproj",
];
const TRACKS = ["alpha", "beta", "stable"];
/**
 * The iPad's workflow, by its name (ios-alpha.yml), and the queues of it that
 * upload, each with the one track it may upload: the `main` queue an alpha,
 * which a batch of `main` carrying iPad work dispatches; the `beta` queue a
 * beta, which a beta's tag dispatches.
 */
export const UPLOADER = { workflow: "iPad alpha", queues: { main: "alpha", beta: "beta" } };

/**
 * The version a build of this commit says, as the Mac's build of the same
 * commit says it (scripts/release.mjs): `{ base, whole }`, `base` the `X.Y.Z`
 * App Store Connect is given, `whole` a track build's whole version, or null
 * for a release. An alpha is a pre-release of the next release (`next`,
 * `version.mjs next`), numbered by the commit (`n`); a beta is of the release
 * whose line it is on (`lineof`, else `next`), numbered by its one
 * `vX.Y.Z-beta.N` tag at HEAD (`tags`); a release is package.json's (`pkg`).
 * Pure.
 */
export function versionOf({ track, pkg, next, lineof = "", n, tags = [] }) {
  const release = /^\d+\.\d+\.\d+$/;
  if (track === "stable") return { base: pkg, whole: null };
  if (!Number.isInteger(n) || n < 1) throw new Error(`the commit count is ${n}, not a count`);
  if (track === "alpha") {
    if (!release.test(String(next))) throw new Error(`the next release is ${next}, not X.Y.Z`);
    return { base: next, whole: `${next}-alpha.${n}` };
  }
  if (track !== "beta") throw new Error(`a build's track is alpha, beta or stable, not ${track}`);
  const base = lineof || next;
  if (!release.test(String(base))) throw new Error(`the beta's release is ${base}, not X.Y.Z`);
  const betas = tags
    .map((t) =>
      String(t)
        .trim()
        .match(/^v(\d+\.\d+\.\d+)-beta\.(0|[1-9]\d*)$/),
    )
    .filter(Boolean);
  if (betas.length !== 1)
    throw new Error(`a beta is built from one vX.Y.Z-beta.N tag at HEAD; found ${betas.length}`);
  if (betas[0][1] !== base)
    throw new Error(`the tag names ${betas[0][1]}, but this is the line of ${base}`);
  return { base, whole: `${base}-beta.${betas[0][2]}` };
}

/** `N.u`, as App Store Connect takes a build number: two integers. */
export function buildNumber(n, u) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`the commit count is ${n}, not a count`);
  if (!Number.isInteger(u) || u < 1) throw new Error(`the upload's number is ${u}, not one`);
  return `${n}.${u}`;
}

/**
 * The next upload's number for commit count `n`, from the build numbers App
 * Store Connect holds for this version on iOS: one more than the highest
 * `n.u`, or 1. A number another commit's count gave (`m.u`) says nothing of
 * this one's.
 */
export function nextUpload(numbers, n) {
  let highest = 0;
  for (const number of numbers) {
    const m = /^(\d+)\.(\d+)$/.exec(String(number));
    if (m && Number(m[1]) === n) highest = Math.max(highest, Number(m[2]));
  }
  return highest + 1;
}

/** The system's own tool folders, which Xcode's own steps expect to find first. */
const SYSTEM_TOOLS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/**
 * `PATH` with the system's tool folders first. Xcode's export makes the
 * `.ipa` with whatever `rsync` comes first, and a build host's toolchain may
 * put GNU rsync ahead of the system's openrsync, which refuses Xcode's
 * arguments ("rsync error: syntax or usage error", "Copy failed"). Pure.
 */
export function systemToolsFirst(path = "") {
  const rest = path.split(":").filter((p) => p && !SYSTEM_TOOLS.includes(p));
  return [...SYSTEM_TOOLS, ...rest].join(":");
}

/**
 * Why this process may not upload `track`'s build, or null when it may: only
 * the iPad's workflow, in the queue a batch of `main` or a beta's tag
 * dispatches, and only the track that queue builds. Pure.
 */
export function uploadRefused(env, track = "alpha") {
  if (env.GITHUB_WORKFLOW !== UPLOADER.workflow)
    return `only the iPad alpha's workflow uploads (ios-alpha.yml), not ${env.GITHUB_WORKFLOW ? `"${env.GITHUB_WORKFLOW}"` : "a run by hand"}`;
  const own = UPLOADER.queues[env.IOS_ALPHA_QUEUE];
  if (!own)
    return `only its main and beta queues upload, which a batch of main and a beta's tag dispatch; this run's is ${env.IOS_ALPHA_QUEUE || "unsaid"}`;
  if (track !== own)
    return `the ${env.IOS_ALPHA_QUEUE} queue uploads ${own === "alpha" ? "an alpha" : "a beta"}, and this build is ${track === "alpha" ? "an alpha" : `a ${track}`}`;
  return null;
}

/**
 * Why this process uploads nothing, whatever was built, or null when its
 * workflow and its queue upload: the question `upload` asks before it looks
 * for a build. What was built is `uploadRefused`'s second argument, asked once
 * the build is read. Asked here with no track, `uploadRefused` took the build
 * for an alpha, and a beta's queue refused every beta it had just built: no
 * beta reached TestFlight from the day the queue was added. Pure.
 */
export function uploaderRefused(env) {
  return uploadRefused(env, UPLOADER.queues[env.IOS_ALPHA_QUEUE] ?? "alpha");
}

/**
 * The export's options for `xcodebuild -exportArchive`: App Store Connect's
 * method, signed by hand with the release keychain's identity and the profile
 * named by its UUID, and for an alpha, TestFlight's internal testers alone.
 */
export function exportOptions({ team, identifier, profileUuid, internalOnly }) {
  const flag = (b) => (b ? "<true/>" : "<false/>");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>export</string>
  <key>teamID</key>
  <string>${team}</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${identifier}</key>
    <string>${profileUuid}</string>
  </dict>
  <key>manageAppVersionAndBuildNumber</key>
  ${flag(false)}
  <key>uploadSymbols</key>
  ${flag(true)}
  <key>testFlightInternalTestingOnly</key>
  ${flag(internalOnly)}
</dict>
</plist>
`;
}

/**
 * What a build waits on, by name: the key, one Apple Distribution identity,
 * the app's record. The profile is the build's own to make, and is not
 * waited on unless the API would not make it.
 */
export function missingMaterial({ key, distribution, record, profile, profileWhy = null }) {
  const missing = [];
  if (!key) missing.push("the App Store Connect API key");
  if (distribution.length !== 1)
    missing.push(`one Apple Distribution identity (the keychain has ${distribution.length})`);
  if (!record) missing.push("the app's record in App Store Connect");
  if (!profile)
    missing.push(
      profileWhy
        ? `the iPad's App Store profile (the API made none: ${profileWhy})`.slice(0, 300)
        : "the iPad's App Store profile",
    );
  return missing;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * One App Store Connect call, tried again when the connection drops under it.
 * A connection left idle through the upload's minutes of processing can come
 * back closed, and the next call over it fails as "fetch failed" before
 * anything reaches Apple. Any other error is the call's own, thrown at once,
 * as is the last of `tries`.
 */
export async function patiently(what, call, { tries = 4, wait = sleep } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await call();
    } catch (e) {
      const cause = e?.cause?.code ?? e?.cause?.message ?? "";
      const said = `${what}: ${e?.message ?? e}${cause ? ` (${cause})` : ""}`;
      if (i >= tries || !/fetch failed/i.test(String(e?.message))) throw new Error(said);
      console.log(`  ${said}; again in ${i * 5} s`);
      await wait(i * 5000);
    }
  }
}

function step(what) {
  console.log(`\n── ${what}`);
}

function fail(message) {
  throw new Error(`release-ios: ${message}`);
}

function run(command, commandArgs, options = {}) {
  const r = spawnSync(command, commandArgs, { stdio: "inherit", ...options });
  if (r.status !== 0) fail(`${command} ${commandArgs[0]} failed (exit ${r.status})`);
  return r;
}

function capture(command, commandArgs, options = {}) {
  const r = spawnSync(command, commandArgs, { encoding: "utf8", ...options });
  if (r.status !== 0)
    fail(`${command} ${commandArgs[0]} failed: ${(r.stderr || r.stdout || "").trim().slice(-300)}`);
  return r.stdout.trim();
}

/** The App Store Connect API key, from the release keychain: `{ keyId, issuer, p8 }`, or null. */
function apiKey() {
  const keyId = load("APPLE_API_KEY")?.toString();
  const issuer = load("APPLE_API_ISSUER")?.toString();
  const p8 = load("APPLE_API_KEY_P8");
  return keyId && issuer && p8 ? { keyId, issuer, p8 } : null;
}

/** altool, with the key in a file only this run can read, removed after. Never prints the key. */
function altool(key, commandArgs) {
  const dir = mkdtempSync(join(tmpdir(), "proscenium-asc-"));
  const file = join(dir, `AuthKey_${key.keyId}.p8`);
  writeFileSync(file, key.p8, { mode: 0o600 });
  try {
    const r = spawnSync(
      "xcrun",
      [
        "altool",
        ...commandArgs,
        "--api-key",
        key.keyId,
        "--api-issuer",
        key.issuer,
        "--p8-file-path",
        file,
        "--output-format",
        "json",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    );
    return readAltool(r.status ?? 1, r.stdout ?? "", r.stderr ?? "", r.signal);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The build numbers App Store Connect holds for version `version` on iOS. */
async function numbersHeld(api, appId, version) {
  const r = await api(
    "GET",
    `/v1/builds?filter[app]=${appId}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&filter[preReleaseVersion.platform]=IOS&limit=200`,
  );
  if (r.status >= 300) fail(`App Store Connect would not list the iPad's builds: ${r.status}`);
  return (r.json?.data ?? []).map((b) => b.attributes?.version);
}

/** The build, once App Store Connect has it: its id, or null. */
async function buildOf(api, appId, version, number) {
  const r = await api(
    "GET",
    `/v1/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(number)}&filter[preReleaseVersion.version]=${encodeURIComponent(version)}&filter[preReleaseVersion.platform]=IOS&limit=5`,
  );
  return r.json?.data?.[0] ?? null;
}

/** The build, once App Store Connect lists it, asked every 15 s for ten minutes: its id, or null. */
async function listing(api, appId, version, number) {
  for (let i = 0; i < 40; i++) {
    const given = await patiently("the build's listing", () =>
      buildOf(api, appId, version, number),
    );
    if (given) return given;
    await sleep(15_000);
  }
  return null;
}

/** What to Test, for the team's testers: `notes`, cut to App Store Connect's 4000 characters. */
async function whatToTest(api, buildId, notes) {
  const whatsNew = notes.slice(0, 4000);
  const r = await api("POST", "/v1/betaBuildLocalizations", {
    data: {
      type: "betaBuildLocalizations",
      attributes: { locale: "en-US", whatsNew },
      relationships: { build: { data: { type: "builds", id: buildId } } },
    },
  });
  if (r.status === 409) {
    // The build has its localization already: written over.
    const have = await api("GET", `/v1/builds/${buildId}/betaBuildLocalizations`);
    const id = have.json?.data?.find((l) => l.attributes?.locale === "en-US")?.id;
    if (!id) return false;
    const patched = await api("PATCH", `/v1/betaBuildLocalizations/${id}`, {
      data: { type: "betaBuildLocalizations", id, attributes: { whatsNew } },
    });
    return patched.status < 300;
  }
  return r.status < 300;
}

/** Where the build's result and its `.ipa` go: `--out`, or the checkout's own. */
const outDir = () => resolve(opt("--out") ?? join(ROOT, ".release-artifacts", "ios"));

async function build() {
  const track = opt("--track") ?? "alpha";
  if (!TRACKS.includes(track)) fail(`--track is ${TRACKS.join(", ")}, not ${track}`);
  const out = outDir();
  const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  const n = Number(
    capture("git", ["rev-list", "--count", "--first-parent", "HEAD"], { cwd: ROOT }),
  );
  const commit = capture("git", ["rev-parse", "HEAD"], { cwd: ROOT });
  const verb = (v) =>
    capture(process.execPath, [join(ROOT, "scripts/version.mjs"), v], { cwd: ROOT });
  // `version` is App Store Connect's X.Y.Z; `whole` the Mac's whole version of this commit.
  let version;
  let whole;
  try {
    ({ base: version, whole } = versionOf({
      track,
      pkg,
      next: track === "stable" ? pkg : verb("next"),
      lineof: track === "beta" ? verb("lineof") : "",
      n,
      tags:
        track === "beta"
          ? capture("git", ["tag", "--points-at", "HEAD"], { cwd: ROOT }).split("\n")
          : [],
    }));
  } catch (e) {
    fail(e.message);
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const fields = { version, whole, track, commit, n };
  const result = (more) => {
    const doc = { ...fields, ...more };
    writeFileSync(join(out, "ios.json"), `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  };

  step(`material for ${version} at ${commit.slice(0, 8)} (${track})`);
  const key = apiKey();
  const { distribution } = storeIds();
  const api = key ? apiOf(key) : null;
  let app = null;
  if (api) {
    try {
      app = await appOf(api, conf.identifier);
    } catch (e) {
      if (!/has no app for/.test(e.message)) throw e;
    }
  }
  let profileWhy = null;
  if (api && app && distribution.length === 1) {
    const why = profileDue(
      existsSync(IOS_PROFILE) ? readProfile(IOS_PROFILE) : null,
      distribution[0].sha1,
    );
    if (why) {
      try {
        const bytes = await makeProfile({
          api,
          identifier: conf.identifier,
          certificateSha1: distribution[0].sha1,
          name: `Proscenium iPad App Store ${new Date().toISOString().slice(0, 10)}`,
          profileType: "IOS_APP_STORE",
          platforms: ["IOS", "UNIVERSAL"],
        });
        mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
        writeFileSync(`${IOS_PROFILE}.new`, bytes, { mode: 0o600 });
        renameSync(`${IOS_PROFILE}.new`, IOS_PROFILE);
        console.log(`  profile made anew: ${why}`);
      } catch (e) {
        profileWhy = e.message;
        console.log(`  profile not made: ${e.message}`);
      }
    }
  }
  const missing = missingMaterial({
    key,
    distribution,
    record: !!app,
    profile: existsSync(IOS_PROFILE) && !profileWhy ? IOS_PROFILE : null,
    profileWhy,
  });
  if (missing.length) {
    console.log(`  waiting on ${missing.join(", ")}`);
    return result({ state: "waiting", missing });
  }
  const profile = readProfile(IOS_PROFILE);
  const [identity] = distribution;
  if (identity.team !== profile.team)
    fail(`the identity is team ${identity.team}'s and the profile team ${profile.team}'s`);
  if (!profile.certificates.includes(identity.sha1))
    fail("the profile does not name the keychain's Apple Distribution certificate");
  const u = nextUpload(await numbersHeld(api, app.id, version), n);
  const number = buildNumber(n, u);
  fields.build = number;
  console.log(
    `  identity  ${identity.identity}\n  profile   ${profile.name}, until ${profile.expires}\n  build     ${version} (${number})${whole ? `, ${whole}` : ""}`,
  );

  await holdHostBench(`the iPad's ${track} build (scripts/release-ios.mjs)`);
  step("the archive, unsigned");
  rmSync(join(APPLE, "build"), { recursive: true, force: true });
  const config = JSON.stringify({ version, bundle: { iOS: { bundleVersion: number } } });
  try {
    run(
      "bun",
      [
        "tauri",
        "ios",
        "build",
        "--ci",
        "--target",
        "aarch64",
        "--export-method",
        "app-store-connect",
        "--archive-only",
        "--no-sign",
        "--features",
        "custom-protocol",
        // Reports compiled in, by the feature Xcode's build hands Cargo.
        "--features",
        "reports",
        "-c",
        config,
        "--",
        "--no-default-features",
      ],
      { cwd: ROOT },
    );
  } finally {
    spawnSync("git", ["checkout", "--", ...WRITTEN], { cwd: ROOT, stdio: "ignore" });
  }
  if (!existsSync(ARCHIVE)) fail(`no archive at ${ARCHIVE}`);

  // A track build's whole version, in the archived app's own Info.plist,
  // before the export signs it; a release carries none (version.rs).
  step(
    whole ? `the whole version, ${whole}, in the app's Info.plist` : "no whole version: a release",
  );
  const apps = join(ARCHIVE, "Products", "Applications");
  const archived = existsSync(apps) && readdirSync(apps).find((f) => f.endsWith(".app"));
  if (!archived) fail(`the archive holds no app in ${apps}`);
  // Every command of the folder-picker plugin is in the app: one the linker
  // left out fails only when it is used (scripts/ipad/plugin-commands.mjs).
  step("the plugin's commands, each in the app");
  const lacking = commandsMissingFrom(join(apps, archived), ROOT);
  if (lacking.length)
    fail(
      `the app lacks the plugin's ${lacking.join(", ")}: nothing names the file that holds them`,
    );
  const plist = join(apps, archived, "Info.plist");
  spawnSync("/usr/libexec/PlistBuddy", ["-c", "Delete :ProsceniumVersion", plist], {
    stdio: "ignore",
  });
  if (whole)
    run("/usr/libexec/PlistBuddy", ["-c", `Add :ProsceniumVersion string ${whole}`, plist]);

  step("the export, signed for App Store Connect");
  const scratch = mkdtempSync(join(tmpdir(), "proscenium-ios-"));
  const exported = join(out, "export");
  mkdirSync(XCODE_PROFILES, { recursive: true });
  const installed = join(XCODE_PROFILES, `${profile.uuid}.mobileprovision`);
  const already = existsSync(installed);
  try {
    if (!already) copyFileSync(IOS_PROFILE, installed);
    const options = join(scratch, "ExportOptions.plist");
    writeFileSync(
      options,
      exportOptions({
        team: profile.team,
        identifier: conf.identifier,
        profileUuid: profile.uuid,
        internalOnly: track === "alpha",
      }),
    );
    run(
      "xcodebuild",
      [
        "-exportArchive",
        "-archivePath",
        ARCHIVE,
        "-exportPath",
        exported,
        "-exportOptionsPlist",
        options,
      ],
      { env: { ...process.env, PATH: systemToolsFirst(process.env.PATH) } },
    );
    const ipa = readdirSync(exported).find((f) => f.endsWith(".ipa"));
    if (!ipa) fail("the export made no .ipa");
    const package_ = join(exported, ipa);

    step("the bundle's check");
    run("node", [
      join(ROOT, "scripts/check-bundle.mjs"),
      "--ios",
      package_,
      "--build",
      number,
      "--version",
      version,
      ...(whole ? ["--whole", whole] : []),
      "--reports",
    ]);
    return result({ state: "built", ipa: package_ });
  } finally {
    if (!already) rmSync(installed, { force: true });
    rmSync(scratch, { recursive: true, force: true });
    rmSync(join(APPLE, "build"), { recursive: true, force: true });
  }
}

async function upload() {
  const refused = uploaderRefused(process.env);
  if (refused) fail(`${refused}, so a build of any other commit never reaches TestFlight`);
  const out = outDir();
  const file = join(out, "ios.json");
  if (!existsSync(file)) fail(`no build to upload: \`build\` writes ${file} first`);
  const built = JSON.parse(readFileSync(file, "utf8"));
  // The build's own track, against its queue's: a beta's queue never uploads an alpha.
  const wrong = uploadRefused(process.env, built.track ?? "alpha");
  if (wrong) fail(`${wrong}, so nothing reaches TestFlight on the wrong track`);
  if (built.state === "waiting") {
    console.log(`  nothing to upload: the build waits on ${(built.missing ?? []).join(", ")}`);
    return built;
  }
  const exported = join(out, "export");
  const write = (more) => {
    const { ipa: _, ...doc } = { ...built, ...more };
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  };
  try {
    if (built.state !== "built" || !built.ipa || !existsSync(built.ipa))
      fail(`no checked build to upload (the build's result says ${built.state ?? "nothing"})`);
    const key = apiKey();
    if (!key) fail("the App Store Connect API key is not in the release keychain");
    const api = apiOf(key);
    const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
    const app = await appOf(api, conf.identifier);

    step(`${built.version} (${built.build}), uploaded and processed`);
    const sent = altool(key, ["--upload-package", built.ipa, "-t", "ios", "--wait"]);
    for (const e of sent.errors) console.log(`  ${e.code ?? "—"}: ${e.message} ${e.reason}`);
    let given = null;
    if (sent.crashed) {
      // altool died with no word from Apple, as it did in its own Swift
      // runtime on 2026-11-17. Whether the package got there before it died
      // is App Store Connect's to say: a build it lists is delivered, and
      // uploading it again would only be refused as a duplicate.
      step(`altool crashed: does App Store Connect have ${built.version} (${built.build})?`);
      given = await listing(api, app.id, built.version, built.build);
      if (!given) {
        write({ state: "crashed", errors: sent.errors });
        fail(
          `${sent.errors[0]?.message ?? "altool crashed"}, and App Store Connect does not list ${built.version} (${built.build})`,
        );
      }
      console.log("  it does: altool crashed after the package reached it");
    } else if (!sent.ok) {
      write({ state: "refused", errors: sent.errors });
      fail(
        `App Store Connect refused the upload: ${sent.errors[0]?.code ?? ""} ${sent.errors[0]?.message ?? ""}`.trim(),
      );
    }
    console.log(`  delivery ${sent.delivery ?? "(no id said)"}`);
    // TestFlight has it now, and nothing after this undoes that: the result
    // says so before What to Test is tried, which a failure there only leaves
    // unwritten.
    const crashed = sent.crashed ? { altoolCrashed: true } : {};
    const uploaded = write({
      state: "uploaded",
      delivery: sent.delivery,
      ...crashed,
      whatToTest: false,
    });

    step("What to Test");
    try {
      given ??= await listing(api, app.id, built.version, built.build);
      if (!given) {
        console.log(
          `  not written: App Store Connect does not list ${built.version} (${built.build}) yet`,
        );
        return uploaded;
      }
      const notesFile = opt("--notes");
      const notes =
        notesFile && existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : "";
      const written = notes
        ? await patiently("What to Test", () => whatToTest(api, given.id, notes))
        : false;
      console.log(
        `  ${written ? "written" : notes ? "not written (App Store Connect refused it)" : "no notes given"}`,
      );
      return write({
        state: "uploaded",
        delivery: sent.delivery,
        ...crashed,
        buildId: given.id,
        processing: given.attributes?.processingState ?? null,
        whatToTest: written,
      });
    } catch (e) {
      console.log(`  not written: ${e.message}`);
      return uploaded;
    }
  } finally {
    // The `.ipa` is never kept, pass or fail.
    rmSync(exported, { recursive: true, force: true });
  }
}

async function material() {
  const key = apiKey();
  const { distribution } = storeIds();
  console.log(`key       ${key ? "present" : "missing"}`);
  for (const id of distribution) console.log(`identity  ${id.identity}`);
  if (existsSync(IOS_PROFILE)) {
    const info = readProfile(IOS_PROFILE);
    console.log(`profile   ${info.name} · ${info.appId} · until ${info.expires}`);
  } else {
    console.log("profile   none yet: the first build makes it through the API");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = args[0];
  const commands = { build, upload, material };
  if (!commands[command]) {
    console.error(
      "usage: node scripts/release-ios.mjs build --track alpha|beta|stable [--out <dir>]\n" +
        "       node scripts/release-ios.mjs upload [--out <dir>] [--notes <file>]   (the iPad's workflow alone: main for an alpha, beta for a beta)\n" +
        "       node scripts/release-ios.mjs material",
    );
    process.exit(2);
  }
  try {
    await commands[command]();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
