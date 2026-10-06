// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Make a release (docs/engineering/release-engineering.md#REL-D5, docs/engineering/release-engineering.md#REL-D6, docs/engineering/release-engineering.md#SHIP-D100): one universal
 * Proscenium (Apple silicon alone for an alpha or a beta, docs/engineering/release-engineering.md#REL-124)
 * signed with Habiby LLC's Developer ID, notarized and stapled; its
 * DMG, notarized and stapled too; the archive installed copies update from, and
 * its signature; and the latest.json they read to find it.
 *
 *   node scripts/release.mjs                  package.json's version, signed with this Mac's keychain
 *   node scripts/release.mjs --publish        …then draft it as a GitHub release (from launch on)
 *   node scripts/release.mjs --rehearse       the same path with no signing material at all: ad hoc,
 *                                             not notarized, a throwaway update key. Proves the
 *                                             plumbing; can never be published.
 *   node scripts/release.mjs --track alpha    an alpha of the next release, X.Y.Z-alpha.N, N the
 *                                             first-parent commits on main, so N only rises
 *   node scripts/release.mjs --track beta     a beta, X.Y.Z-beta.N, from the vX.Y.Z-beta.N tag at HEAD
 *   --publish on a track                      …then publish it to that track, in R2
 *   --private on a track                      a private run's build: made, notarized and checked
 *                                             from any branch, never published
 *   --apple-limit 15m                         how long to wait for Apple on a track build; past it
 *                                             the build waits on Apple instead of the run
 *   --pickup                                  publish the alphas that were waiting on Apple and
 *                                             that Apple has since accepted, by their ids
 *   --base-url <url>                          where latest.json says the archive is (default: the
 *                                             GitHub release the updater endpoint names, or the
 *                                             track's own download route)
 *
 * **A track build asks Apple once:** the app is signed and put in its DMG,
 * and the DMG is notarized, which notarizes the app inside it; then both are
 * stapled. A release still notarizes the app and the DMG apart. With
 * `--apple-limit`, a submission Apple has not answered in that time is not
 * waited on: the build's files are kept on the build host with the
 * submission's id (its operations state, `ops/notary.json`), the step ends
 * "waiting on Apple", and a later run's `--pickup` asks Apple about that same
 * submission and publishes it once accepted. Nothing is ever submitted twice.
 *
 * **One script, three places.** It runs here, on the build host and in any
 * GitHub Actions job. Only the source of the signing material differs:
 *   - on this Mac, the login keychain (scripts/release-keychain.mjs);
 *   - wherever `PROSCENIUM_KEYCHAIN` names one, that keychain: the build host
 *     signs every build from its own, inside Actions too
 *     (a password only its user can read unlocks it headless);
 *   - in a GitHub Actions job with no keychain named, the secrets in the
 *     environment, under the same names: the redundant copy
 *     that lets any Mac that can reach GitHub make a signed build.
 *
 * **A track build** is the stable path with its version, its notes and its
 * destination changed. `X.Y.Z` is `version.mjs next`. The app is built as
 * `X.Y.Z` (macOS allows no more in CFBundleShortVersionString), with its whole
 * version in its Info.plist as `ProsceniumVersion`, from a staged copy, so the
 * tree stays exactly the commit. Its notes are the changelog's Unreleased
 * section and the commit. It refuses a version not newer than its track's
 * newest, and with --publish writes the files, then the version list, then the
 * manifest, so a manifest never names files that are not there, and keeps the
 * files of the newest five versions only, so R2 stays on its free tier.
 *
 * Refuses before the long part: a version the files disagree on, a version with
 * no CHANGELOG section, no updater public key, missing signing material, a
 * working tree with uncommitted changes, and, with --publish, a tag on GitHub
 * that is not the tree being built.
 *
 * **Intel Macs take stable releases alone** (docs/engineering/release-engineering.md#REL-124). A
 * track build is the Apple silicon slice only, `aarch64-apple-darwin`, and its
 * manifest names `darwin-aarch64` alone: half the build, and no Intel Mac is
 * ever offered a pre-release. Stable stays universal.
 *
 * Writes .release-artifacts/v<version>/ (…-rehearsal/ for a rehearsal):
 *   Proscenium_<v>_universal.dmg                     (_aarch64 on a track)
 *   Proscenium_<v>_universal.app.tar.gz  and  .sig   what the updater downloads and checks
 *   latest.json                                      what the updater reads
 *   notes.md · SHA256SUMS · build.json               the notes, the hashes, what was built from what
 *
 * Nothing here prints a secret. The notarization key is written to a private
 * temp directory for the build and deleted afterwards, pass or fail, as are the
 * entitlements and profile staged in .release/.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { holdHostBench } from "./host-bench.mjs";
import {
  KEYCHAIN,
  PROFILE,
  developerIds,
  load,
  minisignKeyId,
  p12Leaf,
  readProfile,
} from "./release-keychain.mjs";
import { assertProfileAuthorizes, requiredEntitlements } from "./release-profile.mjs";
import { fetchRoll, underwritten } from "./patrons.mjs";
import { inPassing, wranglerSaid } from "./wrangler-said.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const PUBLISH = args.includes("--publish");
const REHEARSE = args.includes("--rehearse");
/** A private run's track build: from any branch, notarized and checked, never published. */
const PRIVATE = args.includes("--private");
const PICKUP = args.includes("--pickup");
/**
 * A stand-in's build: the whole of a release, where no writer can reach it. Its
 * tags are under `stand-in/` in this repository, its files under `stand-in/`
 * in the tracks' bucket, and a stable's draft is made and published here, on
 * this repository, never on the public one.
 */
const STAND_IN = args.includes("--stand-in");
const TAG_PREFIX = STAND_IN ? "stand-in/" : "";
const KEY_PREFIX = STAND_IN ? "stand-in/" : "";
const IN_CI = process.env.GITHUB_ACTIONS === "true";
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
/**
 * `--draft <folder>`: draft a release that is already built, from the seven
 * files its build job kept, and build nothing. The tag's test and build are one
 * job on the runner; drafting, which only talks to GitHub, is the next.
 */
const DRAFT_FROM = opt("--draft") ?? null;

/** The Actions secrets are read only in a job that names no keychain of its own. */
const FROM_SECRETS = IN_CI && !KEYCHAIN;
const TRACK = opt("--track") ?? null;
if (TRACK !== null && !["alpha", "beta"].includes(TRACK)) {
  console.error(`release: --track is alpha or beta, not ${TRACK}`);
  process.exit(1);
}
if (PRIVATE && (PUBLISH || !TRACK)) {
  console.error("release: --private is a track build that is never published");
  process.exit(1);
}
/** How long a track build waits for Apple, in seconds; none, for as long as Apple takes. */
const APPLE_LIMIT = (() => {
  const said = opt("--apple-limit");
  if (!said) return null;
  const m = /^(\d+)(s|m|h)$/.exec(said);
  if (!m) {
    console.error(`release: --apple-limit is a duration like 15m, not ${said}`);
    process.exit(1);
  }
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2]];
})();

/** What is built: every Mac for a release, Apple silicon alone for a track. */
const RUST_TARGET = TRACK ? "aarch64-apple-darwin" : "universal-apple-darwin";
/** The slice in the files' names, which the update service checks. */
const SLICE = TRACK ? "aarch64" : "universal";
const TARGET = join(ROOT, `src-tauri/target/${RUST_TARGET}/release/bundle`);
const STAGE = join(ROOT, ".release");
const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
/**
 * The release this build is, or is a pre-release of: the release supersedes
 * its pre-releases by semver. A beta is of the release whose line it is on
 * (`version.mjs lineof`: the files' version, its changelog section not yet
 * dated); an alpha, of the next release.
 */
const versionOf = (verb) =>
  execFileSync(process.execPath, ["scripts/version.mjs", verb], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
const BASE = TRACK
  ? (TRACK === "beta" ? versionOf("lineof") : "") || versionOf("next")
  : JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
/** The whole version: X.Y.Z, or on a track X.Y.Z-alpha.N or X.Y.Z-beta.N. */
const version = TRACK ? `${BASE}-${TRACK}.${trackNumber()}` : BASE;
const APP = join(TARGET, "macos", `${conf.productName}.app`);
const OUT = join(ROOT, ".release-artifacts", `v${version}${REHEARSE ? "-rehearsal" : ""}`);
/** Where the Worker serves the tracks (tauri.conf.json's first update address). */
const UPDATES = new URL(conf.plugins?.updater?.endpoints?.[0] ?? "https://updates.proscenium.ink/")
  .origin;
const BUCKET = "proscenium-updates";

/**
 * A track build's N: for an alpha, the
 * first-parent commits on main at HEAD, so it names that commit and only rises;
 * for a beta, the number in the vX.Y.Z-beta.N tag at HEAD, whose X.Y.Z must be
 * the next release's.
 */
function trackNumber() {
  if (TRACK === "alpha") {
    return execFileSync("git", ["rev-list", "--count", "--first-parent", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  }
  const tags = execFileSync("git", ["tag", "--points-at", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).split("\n");
  const betas = tags
    .map((t) => t.trim())
    .filter((t) => t.startsWith(TAG_PREFIX))
    .map((t) => t.slice(TAG_PREFIX.length).match(/^v(\d+\.\d+\.\d+)-beta\.(0|[1-9]\d*)$/))
    .filter(Boolean);
  if (betas.length !== 1) {
    console.error(
      `release: a beta is built from one ${TAG_PREFIX}vX.Y.Z-beta.N tag at HEAD; found ${betas.length}`,
    );
    process.exit(1);
  }
  if (betas[0][1] !== BASE) {
    console.error(
      `release: the tag names ${betas[0][1]}, but this is the line of ${BASE} (CHANGELOG.md, \`version.mjs lineof\`)`,
    );
    process.exit(1);
  }
  return betas[0][2];
}

let temp = null;

function step(what) {
  console.log(`\nrelease: ${what}`);
}

function fail(message) {
  throw new Error(message);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: ROOT, stdio: "inherit", ...options });
  if (result.status !== 0)
    fail(`${command} ${commandArgs[0] ?? ""} failed (exit ${result.status ?? result.signal})`);
  return result;
}

function capture(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: ROOT, encoding: "utf8", ...options }).trim();
}

/**
 * `<owner>/<repo>`, from the updater endpoint: one source for both. A
 * stand-in's is this repository, where its draft is made and published.
 */
function repository() {
  if (STAND_IN) {
    const here =
      process.env.GITHUB_REPOSITORY ||
      capture("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
    if (!/^[\w.-]+\/[\w.-]+$/.test(here)) fail(`cannot tell which repository this is (${here})`);
    return here;
  }
  const endpoint =
    conf.plugins?.updater?.endpoints?.find((url) => url.startsWith("https://github.com/")) ?? "";
  const m = endpoint.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/latest\.json$/,
  );
  if (!m) fail(`the updater endpoint is not a GitHub latest.json (${endpoint || "none"})`);
  return m[1];
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function cleanup() {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = null;
  rmSync(STAGE, { recursive: true, force: true });
}

/** The tree on GitHub that tag v<version> names, or null when there is no such tag. */
function publishedTree(repo) {
  const gh = (path, jq) => {
    const r = spawnSync("gh", ["api", path, "--jq", jq], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  // A stand-in's sync is a branch and a tag of this repository (`stand-in/public/vX.Y.Z`).
  const tag = STAND_IN ? `stand-in/public/v${version}` : `v${version}`;
  const ref = gh(`repos/${repo}/git/ref/tags/${tag}`, '.object.type + " " + .object.sha');
  if (!ref) return null;
  let [type, sha] = ref.split(" ");
  if (type === "tag") sha = gh(`repos/${repo}/git/tags/${sha}`, ".object.sha");
  return sha ? gh(`repos/${repo}/git/commits/${sha}`, ".tree.sha") : null;
}

// --- refuse early, before an hour of building --------------------------------

function preflight() {
  step(`preflight for ${version}${REHEARSE ? " (rehearsal)" : ""}`);
  if (PUBLISH && REHEARSE) fail("a rehearsal is never published: it trusts a throwaway update key");
  run(process.execPath, ["scripts/version.mjs", "--check"]);
  // A rehearsal of a version not yet cut from the changelog reads Unreleased,
  // and so does a track build, whose release is not cut yet.
  const notesFor = (section) =>
    spawnSync(process.execPath, ["scripts/version.mjs", "notes", section], {
      cwd: ROOT,
      encoding: "utf8",
    });
  let notes;
  if (TRACK) {
    // What is in it so far, if the changelog says, and always the commit.
    const said = notesFor("Unreleased");
    const commit = capture("git", ["rev-parse", "--short=12", "HEAD"]);
    notes = `${said.status === 0 ? `${said.stdout.trim()}\n\n` : ""}Built from ${commit}.`;
  } else {
    let said = notesFor(version);
    if (said.status !== 0 && REHEARSE) said = notesFor("Unreleased");
    if (said.status !== 0) fail(said.stderr.trim() || `CHANGELOG.md has no notes for ${version}`);
    notes = said.stdout.trim();
  }
  if (!REHEARSE && !conf.plugins?.updater?.pubkey) {
    fail(
      'plugins.updater.pubkey is empty: this release could never update itself (docs/engineering/release-engineering.md#SHIP-D100, "The updater key")',
    );
  }
  const repo = TRACK ? null : repository();

  const dirty = capture("git", ["status", "--porcelain"]);
  if (dirty && !REHEARSE)
    fail("the working tree has uncommitted changes — a release is built from a commit");
  const ref = TRACK === "alpha" ? "main" : `${TAG_PREFIX}v${version}`;
  if (IN_CI && !PRIVATE && process.env.GITHUB_REF_NAME !== ref) {
    fail(
      `this run is for ${process.env.GITHUB_REF_NAME}, but ${version} is built from ${ref}${TRACK ? "" : " — run `bun run version` and tag that commit"}`,
    );
  }
  if (TRACK && PUBLISH) {
    // Newer than everything the track has published: a copy is never offered an older one.
    const published = trackVersions();
    const newest = published.at(-1);
    if (newest && !newerThan(version, newest)) {
      fail(
        `${version} is not newer than ${newest}, the ${TRACK} track's newest — a track never goes back, and a version is published once`,
      );
    }
    console.log(`  ${TRACK}: ${published.length} published${newest ? `, newest ${newest}` : ""}`);
    return { notes, repo, dirty: Boolean(dirty), published };
  }

  if (PUBLISH) {
    if (spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0)
      fail("gh is not signed in to GitHub");
    if (spawnSync("gh", ["api", `repos/${repo}`, "--silent"], { stdio: "ignore" }).status !== 0) {
      fail(
        `${repo} does not exist yet, or this account cannot see it — nothing is published before launch`,
      );
    }
    const tree = publishedTree(repo);
    if (!tree)
      fail(
        `there is no tag ${STAND_IN ? "stand-in/public/" : ""}v${version} on ${repo}: sync the release commit and its tag first`,
      );
    // The public repository holds this commit's public tree, which leaves out
    // the development repository's private folders, so that is the tree its
    // tag must name. A checkout without the exporter is the public tree itself.
    const exporter = join(ROOT, "scripts/public-tree.mjs");
    const expected = existsSync(exporter)
      ? capture(process.execPath, [
          exporter,
          "--tree-sha",
          "HEAD",
          ...(STAND_IN ? ["--stand-in"] : []),
        ])
      : capture("git", ["rev-parse", "HEAD^{tree}"]);
    if (tree !== expected) {
      fail(
        `v${version} on ${repo} is not the tree checked out here — a release is built from exactly what it is tagged as`,
      );
    }
  }
  return { notes, repo, dirty: Boolean(dirty) };
}

// --- signing material ------------------------------------------------------------

/**
 * Everything the build needs to sign, as the environment variables tauri's
 * bundler and notarytool read. From Actions secrets in CI, from the keychain
 * here; a rehearsal makes do with a throwaway update key and ad-hoc signing.
 */
function signingMaterial() {
  step(
    REHEARSE
      ? "a throwaway update key"
      : `signing material from ${FROM_SECRETS ? "Actions secrets" : KEYCHAIN ? KEYCHAIN : "this Mac's keychain"}`,
  );
  temp = mkdtempSync(join(tmpdir(), "proscenium-release-"));

  if (REHEARSE) {
    const key = join(temp, "rehearsal.key");
    run(
      join(ROOT, "node_modules/.bin/tauri"),
      ["signer", "generate", "--ci", "--write-keys", key],
      {
        stdio: "ignore",
        env: { ...process.env, CI: "true" },
      },
    );
    return {
      env: {
        TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, "utf8"),
        TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
      },
      overlay: {
        bundle: { macOS: { signingIdentity: "-", entitlements: null, files: null } },
        plugins: { updater: { pubkey: readFileSync(`${key}.pub`, "utf8").trim() } },
      },
    };
  }

  const value = FROM_SECRETS
    ? (name) => (process.env[name] ? Buffer.from(process.env[name]) : null)
    : (name) => load(name);
  const missing = [];
  const need = (name) => {
    const v = value(name);
    if (!v || v.length === 0) missing.push(name);
    return v;
  };

  const keyId = need("APPLE_API_KEY")?.toString();
  const issuer = need("APPLE_API_ISSUER")?.toString();
  const p8 = need("APPLE_API_KEY_P8");
  const updaterKey = need("TAURI_SIGNING_PRIVATE_KEY")?.toString();
  const profileBytes = FROM_SECRETS
    ? need("APPLE_PROVISIONING_PROFILE") &&
      Buffer.from(process.env.APPLE_PROVISIONING_PROFILE, "base64")
    : existsSync(PROFILE)
      ? readFileSync(PROFILE)
      : (missing.push(`the provisioning profile at ${PROFILE}`), null);
  if (FROM_SECRETS) {
    need("APPLE_SIGNING_IDENTITY");
    need("APPLE_CERTIFICATE");
    need("APPLE_CERTIFICATE_PASSWORD");
  } else if (developerIds().length === 0) {
    missing.push(
      "the Developer ID Application certificate (docs/engineering/release-engineering.md#SHIP-D2)",
    );
  }
  if (missing.length) {
    fail(
      `missing signing material: ${missing.join(", ")}. docs/engineering/release-engineering.md#SHIP-D100 says where each comes from.`,
    );
  }

  // The profile the iCloud entitlement needs, and the entitlements completed
  // with this team's identifiers, read from that profile.
  mkdirSync(STAGE, { recursive: true, mode: 0o700 });
  const profile = join(STAGE, "embedded.provisionprofile");
  writeFileSync(profile, profileBytes);
  const info = readProfile(profile);

  // Here the certificate is whichever one in the keychain the profile names —
  // not a name match, which would pick an old certificate after a renewal and
  // build an app its own profile does not authorise.
  let identity = process.env.APPLE_SIGNING_IDENTITY;
  let certificate;
  if (!FROM_SECRETS) {
    const named = developerIds().filter((i) => info.certificates.includes(i.sha1));
    if (named.length !== 1) {
      fail(
        "the provisioning profile names none of the Developer ID certificates in this keychain — " +
          "make the profile again for the current certificate (docs/engineering/release-engineering.md#SHIP-D4)",
      );
    }
    identity = named[0].identity;
    certificate = named[0].sha1;
  } else {
    // Check the public leaf in CI's P12 too, before starting the long build.
    // The password travels over stdin; neither it nor the P12 is logged.
    const p12 = join(temp, "signing.p12");
    writeFileSync(p12, Buffer.from(process.env.APPLE_CERTIFICATE, "base64"), { mode: 0o600 });
    try {
      // A Keychain Access export is legacy PKCS#12; p12Leaf reads both kinds.
      const pem = p12Leaf(p12, process.env.APPLE_CERTIFICATE_PASSWORD);
      if (!pem) fail("could not read the CI signing certificate");
      certificate = createHash("sha1")
        .update(new X509Certificate(pem).raw)
        .digest("hex")
        .toUpperCase();
    } finally {
      rmSync(p12, { force: true });
    }
  }
  const team = identity.match(/\(([A-Z0-9]{10})\)$/)?.[1];

  // The notarization key, where tauri's bundler and notarytool expect a file.
  const p8Path = join(temp, `AuthKey_${keyId}.p8`);
  writeFileSync(p8Path, p8, { mode: 0o600 });
  assertProfileAuthorizes({
    profile: info,
    signed: requiredEntitlements(conf.identifier, team),
    identifier: conf.identifier,
    team,
    certificate,
  });
  copyFileSync(
    join(ROOT, "src-tauri/Entitlements.developer-id.plist"),
    join(STAGE, "Entitlements.plist"),
  );
  run("/usr/libexec/PlistBuddy", [
    "-c",
    `Add :com.apple.application-identifier string ${info.appId}`,
    "-c",
    `Add :com.apple.developer.team-identifier string ${team}`,
    join(STAGE, "Entitlements.plist"),
  ]);
  console.log(`  identity  ${identity}\n  profile   ${info.name}, until ${info.expires}`);

  return {
    identity,
    notary: ["--key", p8Path, "--key-id", keyId, "--issuer", issuer],
    env: {
      APPLE_SIGNING_IDENTITY: identity,
      ...(FROM_SECRETS
        ? {
            APPLE_CERTIFICATE: process.env.APPLE_CERTIFICATE,
            APPLE_CERTIFICATE_PASSWORD: process.env.APPLE_CERTIFICATE_PASSWORD,
          }
        : {}),
      // A release has the bundler notarize the app, and then the DMG apart.
      // A track build notarizes the DMG alone, which covers the app in it, so
      // the bundler is not given the key.
      ...(TRACK
        ? {}
        : { APPLE_API_KEY: keyId, APPLE_API_ISSUER: issuer, APPLE_API_KEY_PATH: p8Path }),
      TAURI_SIGNING_PRIVATE_KEY: updaterKey,
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
      PROSCENIUM_REPORTS: "1",
    },
    overlay: null,
  };
}

// --- the program --------------------------------------------------------------------

/**
 * The sponsors' roll this release carries in Settings › About, and the line
 * its notes give the edition's Benefactors (docs/app/preferences-and-help/settings.md#SET-32).
 * Asked for once, here, so the app never asks. A rehearsal asks nobody. A
 * roll that cannot be had never holds a release back: it ships the empty
 * roll and says so.
 */
async function program(plan) {
  if (REHEARSE) return;
  step("the program");
  let roll;
  try {
    roll = await fetchRoll();
  } catch (e) {
    console.warn(`  WARNING: no sponsors' roll (${e.message}); this build carries the empty one`);
    return;
  }
  const file = join(mkdtempSync(join(tmpdir(), "proscenium-program-")), "roll.json");
  writeFileSync(file, JSON.stringify(roll));
  process.env.PROSCENIUM_PATRONS_FILE = file;
  const line = underwritten(roll);
  if (line) plan.notes = `${plan.notes}\n\n${line}`;
  console.log(
    `  ${roll.benefactors.length} benefactors, ${roll.patrons.length} patrons, ${roll.friends.length} friends, ${roll.private} in the wings`,
  );
}

// --- build -------------------------------------------------------------------------

function build(material) {
  step("icon");
  run("bun", ["run", "icon"]);
  if (!REHEARSE && capture("git", ["status", "--porcelain"])) {
    fail("making the icon changed tracked files — commit them, then release");
  }

  // Nothing from an earlier build may be mistaken for this one's.
  rmSync(join(TARGET, "dmg"), { recursive: true, force: true });
  for (const f of existsSync(join(TARGET, "macos")) ? readdirSync(join(TARGET, "macos")) : []) {
    if (f.endsWith(".tar.gz") || f.endsWith(".tar.gz.sig")) rmSync(join(TARGET, "macos", f));
  }

  const tauriArgs = [
    "build",
    "--bundles",
    "app,dmg",
    "--target",
    RUST_TARGET,
    "--config",
    "src-tauri/tauri.release.conf.json",
  ];
  if (material.overlay) tauriArgs.push("--config", JSON.stringify(material.overlay));
  if (TRACK) tauriArgs.push("--config", JSON.stringify(trackOverlay()));
  // Only what this build means to hand over: signing variables inherited from
  // the shell never reach it.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(APPLE_|TAURI_SIGNING_|PROSCENIUM_REPORTS$)/.test(k),
    ),
  );
  // CI=true skips the AppleScript that arranges the DMG window, which would open
  // Finder windows over whatever this Mac's owner is doing.
  Object.assign(env, material.env, { CI: "true" });
  step(`tauri ${tauriArgs.join(" ")}`);
  searchable(() => run(join(ROOT, "node_modules/.bin/tauri"), tauriArgs, { env }));
}

/**
 * A track build is the next release's X.Y.Z to macOS, with its whole version
 * in its own Info.plist key, from a staged copy of src-tauri/Info.plist, so
 * nothing the commit holds is edited.
 */
function trackOverlay() {
  const real = readFileSync(join(ROOT, "src-tauri/Info.plist"), "utf8");
  const plist = real.replace(
    /<\/dict>\s*<\/plist>\s*$/,
    `  <key>ProsceniumVersion</key>\n  <string>${version}</string>\n</dict>\n</plist>\n`,
  );
  if (plist === real) fail("src-tauri/Info.plist does not end in </dict></plist>");
  mkdirSync(STAGE, { recursive: true, mode: 0o700 });
  writeFileSync(join(STAGE, "Info.plist"), plist);
  return { version: BASE, bundle: { macOS: { infoPlist: join(STAGE, "Info.plist") } } };
}

/**
 * Run `build` with the named keychain in this account's search list, where
 * codesign looks for the identity the bundler names, and the list as it was
 * afterwards, pass or fail. Nothing to do on a Mac signing from its login
 * keychain, which is always there.
 */
function searchable(build) {
  if (!KEYCHAIN) return build();
  const list = () =>
    capture("security", ["list-keychains", "-d", "user"])
      .split("\n")
      .map((l) => l.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  const before = list();
  const named = before.some((k) => k.endsWith(`/${KEYCHAIN}`) || k.endsWith(`/${KEYCHAIN}-db`));
  if (!named) run("security", ["list-keychains", "-d", "user", "-s", ...before, KEYCHAIN]);
  try {
    return build();
  } finally {
    if (!named) run("security", ["list-keychains", "-d", "user", "-s", ...before]);
  }
}

// --- what the bundler does not check -------------------------------------------------

function one(dir, test, what) {
  const found = existsSync(dir) ? readdirSync(dir).filter(test) : [];
  if (found.length !== 1) fail(`expected one ${what} in ${dir}, found ${found.length}`);
  return join(dir, found[0]);
}

function notarizedBy(kind, path, extra = []) {
  const r = spawnSync("spctl", ["--assess", "--type", kind, ...extra, "--verbose=4", path], {
    encoding: "utf8",
  });
  const said = `${r.stdout}${r.stderr}`.trim();
  console.log(said);
  if (r.status !== 0 || !said.includes("source=Notarized Developer ID")) {
    fail(`Gatekeeper does not accept ${path} as notarized`);
  }
}

function checkApp() {
  step(`the app: ${TRACK ? "Apple silicon" : "universal"}, the floor, no self-test, signed`);
  run(process.execPath, [
    "scripts/check-bundle.mjs",
    APP,
    TRACK ? "--arm64" : "--universal",
    "--release",
    "--version",
    BASE,
  ]);
  // What macOS reads, and the whole version a track build answers to.
  const plist = (key) =>
    spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print :${key}`, join(APP, "Contents/Info.plist")],
      { encoding: "utf8" },
    );
  const short = plist("CFBundleShortVersionString").stdout.trim();
  const whole = plist("ProsceniumVersion");
  if (short !== BASE) fail(`the app says ${short} to macOS, not ${BASE}`);
  if (TRACK ? whole.stdout.trim() !== version : whole.status === 0) {
    fail(
      TRACK
        ? `the app's ProsceniumVersion is ${whole.stdout.trim() || "missing"}, not ${version}`
        : "a release carries no ProsceniumVersion",
    );
  }
  capture("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleIconName",
    join(APP, "Contents/Info.plist"),
  ]);
  if (!existsSync(join(APP, "Contents/Resources/Assets.car")))
    fail("the app has no Assets.car: the adaptive icon is missing");
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", APP]);
  if (REHEARSE) return;

  if (!existsSync(join(APP, "Contents/embedded.provisionprofile")))
    fail("the app carries no provisioning profile");
  const embedded = readProfile(join(APP, "Contents/embedded.provisionprofile"));
  const xml = capture("codesign", ["-d", "--entitlements", "-", "--xml", APP], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const signed = JSON.parse(
    capture("plutil", ["-convert", "json", "-o", "-", "-"], {
      input: xml,
      stdio: ["pipe", "pipe", "ignore"],
    }),
  );
  const prefix = join(temp, "signed-certificate-");
  // The prefix is an optional argument, so it must be attached: given as a
  // separate word, codesign reads it as the path to inspect and fails.
  capture("codesign", ["-d", `--extract-certificates=${prefix}`, APP], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const certificate = createHash("sha1")
    .update(readFileSync(`${prefix}0`))
    .digest("hex")
    .toUpperCase();
  const team = readProfile(join(STAGE, "embedded.provisionprofile")).team;
  assertProfileAuthorizes({
    profile: embedded,
    signed,
    identifier: conf.identifier,
    team,
    certificate,
  });
  // A track build is notarized by its DMG's submission, after this.
  if (TRACK) return;
  step("the app: notarized and stapled");
  run("xcrun", ["stapler", "validate", APP]);
  notarizedBy("execute", APP);
}

/**
 * A track build's one notarization: the DMG, which covers the app inside it.
 * Returns `{ accepted: true }` once Apple accepts and both are
 * stapled, or `{ accepted: false, id }` when Apple has not answered within
 * `--apple-limit`: the submission goes on at Apple, and is never sent again.
 */
function notarizeTrack(material, dmg) {
  step(
    `the DMG, and the app in it: one notarization${APPLE_LIMIT ? `, waited on for ${APPLE_LIMIT / 60} minutes at most` : ""}`,
  );
  const submitted = spawnSync(
    "xcrun",
    ["notarytool", "submit", dmg, ...material.notary, "--no-wait", "--output-format", "json"],
    { cwd: ROOT, encoding: "utf8" },
  );
  const id = /"id"\s*:\s*"([0-9a-f-]{36})"/.exec(submitted.stdout ?? "")?.[1];
  if (submitted.status !== 0 || !id)
    fail(
      `notarytool could not submit the DMG: ${(submitted.stderr || submitted.stdout).trim().split("\n").pop()}`,
    );
  console.log(`  submission ${id}`);
  const waited = spawnSync(
    "xcrun",
    [
      "notarytool",
      "wait",
      id,
      ...material.notary,
      "--output-format",
      "json",
      ...(APPLE_LIMIT ? ["--timeout", `${APPLE_LIMIT}s`] : []),
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  const status = /"status"\s*:\s*"([^"]+)"/.exec(waited.stdout ?? "")?.[1] ?? null;
  if (status === "Accepted") {
    stapleTrack(dmg, APP);
    return { accepted: true, id };
  }
  if (status === "Invalid" || status === "Rejected")
    fail(
      `Apple did not accept the DMG (${status}); \`node scripts/release-keychain.mjs log ${id}\` shows why`,
    );
  // Still at Apple: the limit ran out, or notarytool gave up waiting.
  console.log(
    `  Apple has not answered (${status ?? (waited.stderr || waited.stdout).trim().split("\n").pop()}): the build waits on Apple, and the run does not`,
  );
  return { accepted: false, id, status: status ?? "no answer" };
}

/** Both stapled, and Gatekeeper's word on each. */
function stapleTrack(dmg, app) {
  run("xcrun", ["stapler", "staple", dmg]);
  run("xcrun", ["stapler", "validate", dmg]);
  notarizedBy("open", dmg, ["--context", "context:primary-signature"]);
  run("xcrun", ["stapler", "staple", app]);
  run("xcrun", ["stapler", "validate", app]);
  notarizedBy("execute", app);
}

function checkDmg(material, dmg) {
  if (!REHEARSE && !TRACK) {
    step("the DMG: notarized and stapled (tauri notarizes only the app)");
    run("xcrun", ["notarytool", "submit", dmg, ...material.notary, "--wait"]);
    run("xcrun", ["stapler", "staple", dmg]);
    run("xcrun", ["stapler", "validate", dmg]);
    notarizedBy("open", dmg, ["--context", "context:primary-signature"]);
  }
  step("the DMG holds this app");
  const mount = join(temp, "dmg");
  mkdirSync(mount);
  run("hdiutil", ["attach", dmg, "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount], {
    stdio: "ignore",
  });
  try {
    const inside = join(mount, `${conf.productName}.app`);
    const exe = `Contents/MacOS/${capture("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", join(APP, "Contents/Info.plist")])}`;
    if (sha256(join(inside, exe)) !== sha256(join(APP, exe)))
      fail("the DMG's app is not the app that was checked");
    if (!existsSync(join(mount, "Applications"))) fail("the DMG has no Applications shortcut");
    // A track's DMG holds the app as it was submitted: notarized, by the
    // DMG's ticket, and stapled outside it.
    if (!REHEARSE) {
      if (TRACK) notarizedBy("execute", inside);
      else run("xcrun", ["stapler", "validate", inside]);
    }
  } finally {
    spawnSync("hdiutil", ["detach", mount, "-quiet"], { stdio: "ignore" });
  }
}

/** The update archive holds the checked app, stapled; returns it and its signature. */
function checkArchive(pubkey) {
  step("the update archive holds this app");
  const archive = one(join(TARGET, "macos"), (f) => f.endsWith(".app.tar.gz"), "update archive");
  const signature = `${archive}.sig`;
  if (!existsSync(signature))
    fail("the update archive has no signature: is createUpdaterArtifacts on?");
  // Signed with the key installed copies trust, not merely with a valid key
  // — the CLI only warns on a mismatch, and every check after
  // this one would pass while every Mac refused the update.
  if (pubkey) {
    const signedWith = minisignKeyId(readFileSync(signature, "utf8"), "the archive's signature");
    const trusted = minisignKeyId(pubkey, "plugins.updater.pubkey");
    if (signedWith !== trusted) {
      fail(
        `the update archive was signed with key ${signedWith}, but this app trusts key ${trusted}: installed copies would refuse it`,
      );
    }
  }
  const unpacked = join(temp, "archive");
  mkdirSync(unpacked);
  run("tar", ["-xzf", archive, "-C", unpacked]);
  const inside = join(unpacked, `${conf.productName}.app`);
  const exe = `Contents/MacOS/${capture("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", join(APP, "Contents/Info.plist")])}`;
  if (sha256(join(inside, exe)) !== sha256(join(APP, exe)))
    fail("the update archive's app is not the app that was checked");
  run("codesign", ["--verify", "--deep", "--strict", inside]);
  if (!REHEARSE) {
    // The bundler packs a track's archive before its one notarization: the
    // app in it is notarized, by the DMG's ticket, and not stapled.
    if (TRACK) notarizedBy("execute", inside);
    else run("xcrun", ["stapler", "validate", inside]);
  }
  return { archive, signature: readFileSync(signature, "utf8").trim() };
}

// --- the release's files -----------------------------------------------------------

function artifacts({ notes, repo, dirty }, material, dmg, { archive, signature }) {
  step(`artifacts in ${OUT}`);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const dmgName = `${conf.productName}_${version}_${SLICE}.dmg`;
  const archiveName = `${conf.productName}_${version}_${SLICE}.app.tar.gz`;
  copyFileSync(dmg, join(OUT, dmgName));
  copyFileSync(archive, join(OUT, archiveName));
  writeFileSync(join(OUT, `${archiveName}.sig`), `${signature}\n`);

  const base = (
    opt("--base-url") ??
    (TRACK
      ? `${UPDATES}/v1/${TRACK}/download/v${version}`
      : `https://github.com/${repo}/releases/download/${TAG_PREFIX}v${version}`)
  ).replace(/\/$/, "");
  // One universal archive serves both architectures; the updater asks for its
  // own (`darwin-aarch64`, or `darwin-x86_64` for the Intel slice, Rosetta
  // included). A track's archive is Apple silicon's alone, and so is its manifest.
  const platform = { signature, url: `${base}/${archiveName}` };
  const latest = {
    version,
    notes,
    pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms: TRACK
      ? { "darwin-aarch64": platform }
      : { "darwin-aarch64": platform, "darwin-x86_64": platform },
  };
  writeFileSync(join(OUT, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
  // A public key only, so the local updater rehearsal can verify this archive
  // after the throwaway private key has been removed. Never a launch artifact.
  if (REHEARSE)
    writeFileSync(join(OUT, "rehearsal.pub"), `${material.overlay.plugins.updater.pubkey}\n`);
  writeFileSync(join(OUT, "notes.md"), `${notes}\n`);

  const tool = (command, commandArgs) => {
    try {
      return capture(command, commandArgs, { stdio: ["ignore", "pipe", "ignore"] }).split("\n")[0];
    } catch {
      return null;
    }
  };
  writeFileSync(
    join(OUT, "build.json"),
    `${JSON.stringify(
      {
        version,
        commit: capture("git", ["rev-parse", "HEAD"]),
        tree: capture("git", ["rev-parse", "HEAD^{tree}"]),
        uncommittedChanges: dirty,
        rehearsal: REHEARSE,
        signedBy: material.identity ?? "ad hoc",
        notarized: !REHEARSE,
        builtOn: IN_CI
          ? `GitHub Actions, signed from ${FROM_SECRETS ? "its secrets" : KEYCHAIN}`
          : KEYCHAIN
            ? `a Mac, signed from ${KEYCHAIN}`
            : "a local Mac",
        ...(TRACK ? { track: TRACK, release: BASE, slice: SLICE } : {}),
        // What the pipeline tested before this build: its tier, and for a
        // narrowed run the acts it ran, so the build says how far it was proven.
        ...(process.env.PROSCENIUM_PIPELINE_TIER
          ? {
              pipeline: {
                tier: process.env.PROSCENIUM_PIPELINE_TIER,
                acts: (process.env.PROSCENIUM_PIPELINE_ACTS ?? "").split(",").filter(Boolean),
                run: process.env.GITHUB_RUN_ID ?? null,
              },
            }
          : {}),
        builtAt: latest.pub_date,
        tools: {
          macos: tool("sw_vers", ["-productVersion"]),
          xcode: tool("xcodebuild", ["-version"]),
          rustc: tool("rustc", ["--version"]),
          bun: tool("bun", ["--version"]),
        },
      },
      null,
      2,
    )}\n`,
  );

  const files = readdirSync(OUT)
    .filter((f) => f !== "SHA256SUMS")
    .sort();
  writeFileSync(
    join(OUT, "SHA256SUMS"),
    files.map((f) => `${sha256(join(OUT, f))}  ${f}\n`).join(""),
  );
  for (const f of [...files, "SHA256SUMS"]) console.log(`  ${f}`);
  return [...files, "SHA256SUMS"].map((f) => join(OUT, f));
}

// --- a track, in R2 ------------------------------------------------------------------

const EDGE = join(ROOT, "services/edge");

/**
 * Wrangler, with the deploy token in its environment and nowhere else, and its
 * debug log in a private folder removed afterwards (as scripts/edge-wrangler.mjs
 * does). Only the tracks' bucket is ever named. A failure in passing (a dropped
 * connection, a timeout, Cloudflare's 429 or 5xx) is made again, twice, after 5
 * and then 20 seconds: every command here reads, or writes the same bytes to
 * the same key, so making it again changes nothing but the outcome. On
 * 2026-09-28 one such failure of a read ended a beta's run before its build.
 */
function wrangler(args, { output = false } = {}) {
  const token = load("CLOUDFLARE_API_TOKEN");
  if (!token) fail("no Cloudflare token in the keychain: publishing a track writes to R2 with it");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(APPLE_|TAURI_SIGNING_)/.test(k)),
  );
  for (let attempt = 1; ; attempt++) {
    const logs = mkdtempSync(join(tmpdir(), "proscenium-wrangler-"));
    let r;
    try {
      r = spawnSync(
        join(EDGE, "node_modules/.bin/wrangler"),
        [...args, "--config", "wrangler.jsonc"],
        {
          cwd: EDGE,
          encoding: "utf8",
          stdio: ["ignore", output ? "pipe" : "inherit", "pipe"],
          env: {
            ...env,
            CLOUDFLARE_API_TOKEN: token.toString().trim(),
            WRANGLER_SEND_METRICS: "false",
            WRANGLER_LOG_PATH: logs,
          },
        },
      );
    } finally {
      rmSync(logs, { recursive: true, force: true });
    }
    const said = r.status === 0 ? "" : wranglerSaid(r.stderr, r.status);
    if (r.status === 0 || attempt === 3 || !inPassing(said)) return { ...r, said };
    const wait = attempt === 1 ? 5 : 20;
    console.log(`  ${args.slice(0, 4).join(" ")}: ${said}; made again in ${wait} s`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait * 1000);
  }
}

function trackKey(key) {
  if (
    !/^(alpha|beta)\/(latest\.json|versions\.json|\d+\.\d+\.\d+-(alpha|beta)\.\d+\/[A-Za-z0-9._-]+)$/.test(
      key,
    )
  )
    fail(`${key} is not a track's key`);
  // A stand-in's keys are under `stand-in/`, which the update service never serves.
  return `${BUCKET}/${KEY_PREFIX}${key}`;
}

function put(key, file, contentType) {
  const r = wrangler([
    "r2",
    "object",
    "put",
    trackKey(key),
    "--file",
    file,
    "--content-type",
    contentType,
    "--remote",
  ]);
  if (r.status !== 0) fail(`could not write ${key} to R2: ${r.said}`);
  console.log(`  put ${key}`);
}

/** Every version the track has published, oldest first; none before its first. */
function trackVersions() {
  const r = wrangler(
    ["r2", "object", "get", trackKey(`${TRACK}/versions.json`), "--pipe", "--remote"],
    { output: true },
  );
  if (r.status !== 0) {
    if (/NoSuchKey|does not exist|not found|404/i.test(r.stderr)) return [];
    fail(`could not read the ${TRACK} track's versions from R2: ${r.said}`);
  }
  const list = JSON.parse(r.stdout);
  if (
    !Array.isArray(list) ||
    !list.every((v) => typeof v === "string" && v.includes(`-${TRACK}.`))
  ) {
    fail(`the ${TRACK} track's version list is not a list of its versions`);
  }
  return list;
}

/** Semver order for the versions this script makes: X.Y.Z, and its alphas and betas below it. */
function newerThan(a, b) {
  const parse = (v) => {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/);
    if (!m) fail(`"${v}" is not a version this script makes`);
    return { base: [m[1], m[2], m[3]].map(Number), pre: m[4] ? [m[4], Number(m[5])] : null };
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x.base[i] !== y.base[i]) return x.base[i] > y.base[i];
  if (!x.pre || !y.pre) return !x.pre && Boolean(y.pre);
  if (x.pre[0] !== y.pre[0]) return x.pre[0] > y.pre[0];
  return x.pre[1] > y.pre[1];
}

/**
 * The files, then the version list, then the manifest:
 * a copy that reads the manifest finds everything it names. Then the files of
 * the version that fell out of the newest five go, so R2 stays on its free tier.
 */
function publishTrack(published, v = version, dir = OUT) {
  step(`publish ${v} to the ${TRACK} track`);
  const names = (x, slice = SLICE) => [
    `${conf.productName}_${x}_${slice}.dmg`,
    `${conf.productName}_${x}_${slice}.app.tar.gz`,
    `${conf.productName}_${x}_${slice}.app.tar.gz.sig`,
  ];
  for (const name of names(v))
    put(`${TRACK}/${v}/${name}`, join(dir, name), "application/octet-stream");
  const list = [...published, v];
  const listFile = join(
    temp ?? mkdtempSync(join(tmpdir(), "proscenium-release-")),
    "versions.json",
  );
  writeFileSync(listFile, `${JSON.stringify(list)}\n`);
  put(`${TRACK}/versions.json`, listFile, "application/json");
  put(`${TRACK}/latest.json`, join(dir, "latest.json"), "application/json");
  if (list.length > 5) {
    const gone = list[list.length - 6];
    // A version from before tracks were Apple silicon alone has universal files.
    for (const name of [...names(gone, "aarch64"), ...names(gone, "universal")]) {
      const r = wrangler([
        "r2",
        "object",
        "delete",
        trackKey(`${TRACK}/${gone}/${name}`),
        "--remote",
      ]);
      if (r.status !== 0) console.log(`  could not delete ${gone}'s ${name}, kept: ${r.said}`);
    }
    console.log(`  ${gone}'s files removed: the ${TRACK} track keeps the newest five`);
  }
}

function publish(repo, files) {
  const tag = `${TAG_PREFIX}v${version}`;
  step(`a draft release on ${repo}, on ${tag}`);
  const view = spawnSync(
    "gh",
    ["release", "view", tag, "--repo", repo, "--json", "isDraft", "--jq", ".isDraft"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const notes = join(OUT, "notes.md");
  if (view.status === 0 && view.stdout.trim() !== "true") {
    fail(
      `${tag} is already published — a published release is replaced by a newer one, never rebuilt`,
    );
  }
  if (view.status === 0) {
    run("gh", ["release", "upload", tag, "--repo", repo, "--clobber", ...files]);
    run("gh", ["release", "edit", tag, "--repo", repo, "--notes-file", notes]);
  } else {
    // Drafted, never published, by a script: a person checks it first. Not a
    // prerelease either: the updater reads releases/latest, which skips them.
    run("gh", [
      "release",
      "create",
      tag,
      "--repo",
      repo,
      "--draft",
      "--verify-tag",
      "--title",
      `${conf.productName} ${version}`,
      "--notes-file",
      notes,
      ...files,
    ]);
  }
  // The draft by its id, so that it and nothing else is published: a tag can
  // carry more than one draft, and publishing by tag could pick another.
  const id = capture("gh", [
    "api",
    `repos/${repo}/releases?per_page=100`,
    "--jq",
    `[.[] | select(.tag_name == "${tag}" and .draft)] | if length == 1 then .[0].id else error("\\(length) drafts on the tag") end`,
  ]);
  if (!/^\d+$/.test(id)) fail(`the draft on ${tag} has no single id (${id})`);
  writeFileSync(
    join(OUT, "draft.json"),
    `${JSON.stringify({ v: 1, repo, tag, id: Number(id), version }, null, 2)}\n`,
  );
  console.log(`  draft ${id} on ${tag}, written to draft.json`);
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

/** What the run's Triage step reads of this build: the version, and whether it went out (scripts/ci-triage.mjs). */
function tellRun(fields) {
  const dir =
    process.env.PIPELINE_PLAN_DIR ||
    (process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, "pipeline-plan") : null);
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "alpha.json"), `${JSON.stringify({ version, ...fields })}\n`);
}

// --- waiting on Apple ---------------------------------------------------------------

/** Where a track build waits on Apple. */
const NOTARY_DIR = join(homedir(), ".proscenium", "notary");
/**
 * The build host's operations state, which only a parked build and a pickup
 * write: its module is the build host's and not in the public tree, so it is
 * loaded only there.
 */
const opsState = () => import("./ops/state.mjs");

async function notaryState() {
  const { dirs } = await opsState();
  const file = join(dirs().ops, "notary.json");
  return existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : { v: 1, waiting: [], resolved: [] };
}

async function writeNotary(state) {
  const { dirs, writeJson } = await opsState();
  writeJson(dirs(), "notary", state);
}

/**
 * Keep a track build's files with its submission's id, and say the step is
 * waiting on Apple: the run's verdict stands on its tests.
 */
async function park(id, status, files) {
  const dir = join(NOTARY_DIR, version);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of files) copyFileSync(f, join(dir, f.split("/").pop()));
  run("ditto", [APP, join(dir, `${conf.productName}.app`)]);
  const state = await notaryState();
  state.waiting = state.waiting.filter((w) => w.version !== version);
  state.waiting.push({
    version,
    commit: capture("git", ["rev-parse", "HEAD"]),
    run: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    id,
    submittedAt: new Date().toISOString(),
    dir,
    checkedAt: new Date().toISOString(),
    status: String(status).slice(0, 200),
  });
  await writeNotary(state);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "waiting=true\n");
  console.log(
    `\nrelease: ${version} waits on Apple (submission ${id}); its files are in ${dir}, and a later run's --pickup publishes it`,
  );
}

/**
 * The alphas that waited on Apple: each submission asked about by its id,
 * never sent again. Accepted: stapled, checked and published, unless the
 * track has a newer version already. Rejected, or waiting a day: dropped, and
 * said so.
 */
async function pickup() {
  const state = await notaryState();
  if (!state.waiting.length) {
    console.log("release: nothing waits on Apple");
    return;
  }
  const material = signingMaterial();
  const keep = [];
  for (const w of state.waiting) {
    const info = spawnSync(
      "xcrun",
      ["notarytool", "info", w.id, ...material.notary, "--output-format", "json"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    const status = /"status"\s*:\s*"([^"]+)"/.exec(info.stdout ?? "")?.[1] ?? "no answer";
    const resolved = (outcome, detail) => {
      state.resolved = [
        ...state.resolved,
        {
          version: w.version,
          id: w.id,
          outcome,
          at: new Date().toISOString(),
          detail: detail.slice(0, 400),
        },
      ].slice(-20);
      console.log(`release: ${w.version} (submission ${w.id}): ${outcome}: ${detail}`);
    };
    if (status === "Accepted") {
      const dmg = one(w.dir, (f) => f.endsWith(".dmg"), "DMG");
      stapleTrack(dmg, join(w.dir, `${conf.productName}.app`));
      const published = trackVersions();
      const newest = published.at(-1);
      if (newest && !newerThan(w.version, newest)) {
        resolved("dropped", `Apple accepted it, but ${newest} was published meanwhile`);
      } else {
        publishTrack(published, w.version, w.dir);
        resolved("published", "Apple accepted it after the run that built it had ended");
      }
      rmSync(w.dir, { recursive: true, force: true });
    } else if (status === "Invalid" || status === "Rejected") {
      resolved(
        "rejected",
        `Apple said ${status}; \`node scripts/release-keychain.mjs log ${w.id}\` shows why`,
      );
      rmSync(w.dir, { recursive: true, force: true });
    } else if (Date.now() - Date.parse(w.submittedAt) > 24 * 3600 * 1000) {
      resolved("dropped", `Apple has not answered in a day (${status}); a newer alpha replaces it`);
      rmSync(w.dir, { recursive: true, force: true });
    } else {
      keep.push({ ...w, checkedAt: new Date().toISOString(), status: status.slice(0, 200) });
      console.log(`release: ${w.version} still waits on Apple (${status})`);
    }
  }
  state.waiting = keep;
  await writeNotary(state);
}

try {
  if (DRAFT_FROM) {
    if (TRACK) fail("--draft is a stable release's: a track publishes to its track, not a draft");
    const plan = preflight();
    const files = readdirSync(DRAFT_FROM)
      .filter((f) => !f.startsWith(".") && f !== "draft.json")
      .map((f) => join(DRAFT_FROM, f));
    const want = [
      `${conf.productName}_${version}_${SLICE}.dmg`,
      `${conf.productName}_${version}_${SLICE}.app.tar.gz`,
      `${conf.productName}_${version}_${SLICE}.app.tar.gz.sig`,
      "latest.json",
      "notes.md",
      "build.json",
      "SHA256SUMS",
    ];
    const missing = want.filter((w) => !files.some((f) => f.endsWith(`/${w}`)));
    if (missing.length)
      fail(`${DRAFT_FROM} lacks ${missing.join(", ")}: the build keeps seven files`);
    // What the checksums name is what is drafted, byte for byte.
    const sums = readFileSync(join(DRAFT_FROM, "SHA256SUMS"), "utf8").trim().split("\n");
    for (const line of sums) {
      const [hash, name] = line.trim().split(/\s+\*?/);
      if (sha256(join(DRAFT_FROM, name)) !== hash) fail(`${name} is not the file SHA256SUMS names`);
    }
    mkdirSync(OUT, { recursive: true });
    for (const f of files) copyFileSync(f, join(OUT, f.split("/").pop()));
    // The same seven files a build drafts, the notes among them.
    publish(
      plan.repo,
      want.map((w) => join(OUT, w)),
    );
  } else if (PICKUP) {
    await pickup();
  } else {
    const plan = preflight();
    await program(plan);
    const material = signingMaterial();
    // A signed build shares the host with the native self-test: it takes the bench.
    if (!REHEARSE) await holdHostBench("a release build");
    build(material);
    checkApp();
    const dmg = one(join(TARGET, "dmg"), (f) => f.endsWith(".dmg"), "DMG");
    const apple = TRACK && !REHEARSE ? notarizeTrack(material, dmg) : { accepted: true };
    if (!apple.accepted) {
      // The files are made, and checked but for Apple's word; they wait for it.
      const archive = one(
        join(TARGET, "macos"),
        (f) => f.endsWith(".app.tar.gz"),
        "update archive",
      );
      const files = artifacts(plan, material, dmg, {
        archive,
        signature: readFileSync(`${archive}.sig`, "utf8").trim(),
      });
      if (PUBLISH)
        await park(
          apple.id,
          apple.status,
          files.map((f) => join(OUT, f.split("/").pop())),
        );
      else
        console.log(
          `\nrelease: ${version} waits on Apple (submission ${apple.id}); a private build is not kept`,
        );
      if (TRACK === "alpha")
        tellRun({ published: false, waiting: Boolean(PUBLISH), submission: apple.id });
    } else {
      checkDmg(material, dmg);
      const archive = checkArchive(
        material.overlay?.plugins?.updater?.pubkey ?? conf.plugins?.updater?.pubkey,
      );
      const files = artifacts(plan, material, dmg, archive);
      if (PUBLISH && TRACK) publishTrack(plan.published);
      else if (PUBLISH) publish(plan.repo, files);
      if (TRACK === "alpha") tellRun({ published: Boolean(PUBLISH), waiting: false });
      console.log(
        `\nrelease: ${version}${REHEARSE ? " rehearsal" : ""}${PRIVATE ? ", a private build" : ""} done — ${OUT}`,
      );
    }
  }
} catch (e) {
  console.error(`\nrelease: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
