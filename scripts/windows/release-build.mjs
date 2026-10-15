// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One chip's Windows release, built from a version tag on a hosted Windows
 * machine: the direct download's per-user installer and the Microsoft Store's
 * MSIX package, from the same release build of the app.
 *
 *   node scripts/windows/release-build.mjs --tag v1.0.2 --target x86_64-pc-windows-msvc
 *   node scripts/windows/release-build.mjs --tag v1.0.2-beta.3 --target aarch64-pc-windows-msvc \
 *     [--out windows-files] [--proof windows-proof]
 *
 * --out gets what ships, and SHA256SUMS-<chip> with each file's hash:
 *   Proscenium_<version>_<chip>-setup.exe   the installer, unsigned: the release
 *                                           machine signs it for the updater
 *   roll-<chip>.json                        the sponsors' roll baked in, as the
 *                                           page is given it: the release
 *                                           machine holds it to the Mac's, and
 *                                           no release carries it
 *   Proscenium_<version>_<chip>.msix        the Store's package, unsigned (the
 *                                           Store signs it), and only once the
 *                                           Store has given the app its identity
 *                                           (src-tauri/windows/store-identity.json)
 * --proof gets what the installed-artifact proof installs and nothing ships:
 *   the same MSIX signed with a throwaway certificate made here
 *   (Proscenium_<version>_<chip>.test.msix), that certificate's public half
 *   (throwaway.cer) for the test machine to trust, the package's identity name
 *   (package-name.txt), and the unsigned package itself.
 *
 * The build is the release's own, as scripts/release.mjs makes the Mac's: the
 * tag's whole version (a beta's `-beta.N` compiled in as `PROSCENIUM_VERSION`,
 * since Windows has no Info.plist to carry it, while the package stays X.Y.Z),
 * reports compiled in (`PROSCENIUM_REPORTS=1`), the sponsors' roll fetched once
 * and baked in, and no updater signature: no signing key is ever on these
 * machines, and the release machine signs the installer for the updater
 * afterwards. The tag must name a commit whose own version is the tag's X.Y.Z.
 */
import { spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The Rust targets a Windows release is built for, and the chip each is called. */
export const CHIPS = {
  "x86_64-pc-windows-msvc": "x64",
  "aarch64-pc-windows-msvc": "arm64",
};

/** The identity a package has until Partner Center gives the reserved name one: for a test install only. */
export const TEST_IDENTITY = {
  name: "Proscenium.TestPackage",
  publisher: "CN=Proscenium Test Package",
  publisherDisplayName: "Proscenium (test package)",
};

/**
 * The version a tag builds: `vX.Y.Z` a stable release, `vX.Y.Z-beta.N` a beta,
 * each of the commit whose own version is X.Y.Z. Throws on anything else: no
 * alpha is built for Windows, and nothing else is a release.
 */
export function versionOfTag(tag, packageVersion) {
  const m = /^v(\d+\.\d+\.\d+)(?:-beta\.(0|[1-9]\d{0,8}))?$/.exec(tag ?? "");
  if (!m) throw new Error(`${tag} is not a release's tag: vX.Y.Z or vX.Y.Z-beta.N`);
  if (m[1] !== packageVersion)
    throw new Error(`${tag} names ${m[1]}, but this commit's version is ${packageVersion}`);
  return { version: tag.slice(1), track: m[2] === undefined ? "stable" : "beta" };
}

/** An MSIX version has four numbers: X.Y.Z.0, whatever the track. */
export function packageVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version);
  if (!m) throw new Error(`${version} is not a version`);
  return `${m[1]}.${m[2]}.${m[3]}.0`;
}

/**
 * The Store's identity for the package, from store-identity.json: Partner
 * Center's own once the name is reserved (`forStore`), the test identity until
 * then, with nothing half one and half the other.
 */
export function storeIdentity(json) {
  const fields = ["name", "publisher", "publisherDisplayName"];
  const set = fields.filter((f) => json?.[f] !== null && json?.[f] !== undefined);
  if (set.length === 0) return { ...TEST_IDENTITY, forStore: false };
  if (set.length !== fields.length)
    throw new Error(
      `store-identity.json gives ${set.join(", ")} but not all of ${fields.join(", ")}`,
    );
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(json.name))
    throw new Error(`${json.name} is not a package name: 3 to 50 letters, digits, dots or dashes`);
  if (!/^CN=/.test(json.publisher)) throw new Error(`${json.publisher} is not a publisher, CN=…`);
  return {
    name: json.name,
    publisher: json.publisher,
    publisherDisplayName: json.publisherDisplayName,
    forStore: true,
  };
}

const escapeXml = (s) =>
  String(s).replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c],
  );

/** The manifest template with its blanks filled; every blank must be filled. */
export function renderManifest(template, { identity, version, chip }) {
  const values = {
    IDENTITY_NAME: identity.name,
    PUBLISHER: identity.publisher,
    PUBLISHER_DISPLAY_NAME: identity.publisherDisplayName,
    VERSION: packageVersion(version),
    ARCH: chip,
  };
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => {
    if (!(key in values)) throw new Error(`the manifest has a blank nothing fills: ${whole}`);
    return escapeXml(values[key]);
  });
  return out;
}

/** The files one chip's build makes, by name. */
export function fileNames(version, chip) {
  return {
    installer: `Proscenium_${version}_${chip}-setup.exe`,
    msix: `Proscenium_${version}_${chip}.msix`,
    roll: `roll-${chip}.json`,
    sums: `SHA256SUMS-${chip}`,
  };
}

/** `sha256sum`'s own lines, so the list is checked with `sha256sum -c`. */
export function sumsText(entries) {
  return entries.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join("");
}

// --- the build, on Windows ------------------------------------------------------

function options(argv) {
  const opts = { out: "windows-files", proof: "windows-proof" };
  for (let i = 0; i < argv.length; i++) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (!["--tag", "--target", "--out", "--proof"].includes(flag) || value === undefined)
      throw new Error(
        `usage: release-build.mjs --tag vX.Y.Z[-beta.N] --target <${Object.keys(CHIPS).join("|")}> [--out dir] [--proof dir]`,
      );
    opts[flag.slice(2)] = value;
    i++;
  }
  if (!CHIPS[opts.target]) throw new Error(`--target is one of ${Object.keys(CHIPS).join(", ")}`);
  return opts;
}

function run(command, args, env = process.env) {
  // A password, even the throwaway certificate's, is never written to a log.
  const shown = args.map((a, i) => (/^--(cert-)?password$/.test(args[i - 1] ?? "") ? "***" : a));
  console.log(`\n▸ ${command} ${shown.join(" ")}`);
  const r = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", env });
  if (r.error) throw new Error(`${command}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${command} ${args[0]} exited ${r.status}`);
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * The roll a release bakes in (scripts/patrons.mjs), asked for once. A roll
 * that cannot be had never holds a release back: it ships the empty one, as
 * the Mac's build does.
 */
async function roll(dir) {
  const { fetchRoll } = await import("../patrons.mjs");
  try {
    const file = join(dir, "roll.json");
    writeFileSync(file, JSON.stringify(await fetchRoll()));
    return file;
  } catch (e) {
    console.log(`::warning::no sponsors' roll (${e.message}); this build carries the empty one`);
    return null;
  }
}

async function main() {
  const opts = options(process.argv.slice(2));
  const chip = CHIPS[opts.target];
  const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
  const { version, track } = versionOfTag(opts.tag, conf.version);
  const identity = storeIdentity(
    JSON.parse(readFileSync(join(ROOT, "src-tauri/windows/store-identity.json"), "utf8")),
  );
  const names = fileNames(version, chip);
  const out = resolve(ROOT, opts.out);
  const proof = resolve(ROOT, opts.proof);
  for (const dir of [out, proof]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  console.log(`Proscenium ${version} (${track}) for Windows ${chip}`);

  // The release build. tauri.windows.conf.json is merged in by Tauri itself.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^(TAURI_SIGNING_|PROSCENIUM_)/.test(k)),
  );
  env.PROSCENIUM_REPORTS = "1";
  // A beta's whole version, compiled in: the package stays X.Y.Z, as a Mac's
  // CFBundleShortVersionString does, and the app answers to X.Y.Z-beta.N.
  if (track === "beta") env.PROSCENIUM_VERSION = version;
  const baked = await roll(proof);
  if (baked) env.PROSCENIUM_PATRONS_FILE = baked;
  // The roll as the page is given it, for the release machine to hold to the Mac's.
  const { bakedText } = await import("../patrons.mjs");
  writeFileSync(join(out, names.roll), bakedText(env));
  // The CLI's own entry, under this Node, with no shell between.
  run(
    process.execPath,
    [
      join(ROOT, "node_modules/@tauri-apps/cli/tauri.js"),
      "build",
      "--ci",
      "--target",
      opts.target,
      "--bundles",
      "nsis",
    ],
    env,
  );
  const release = join(ROOT, "src-tauri/target", opts.target, "release");
  // Tauri names the installer by the package's X.Y.Z; it ships by its whole version.
  const built = join(release, "bundle/nsis", fileNames(conf.version, chip).installer);
  if (!existsSync(built)) throw new Error(`the build made no ${built}`);
  copyFileSync(built, join(out, names.installer));

  // The Store's package: the same executable, its tiles, and the manifest.
  const stage = join(proof, "msix-stage");
  mkdirSync(join(stage, "Assets"), { recursive: true });
  copyFileSync(join(release, "proscenium.exe"), join(stage, "proscenium.exe"));
  for (const icon of ["Square150x150Logo.png", "Square44x44Logo.png", "StoreLogo.png"])
    copyFileSync(join(ROOT, "src-tauri/icons", icon), join(stage, "Assets", icon));
  const manifest = join(stage, "Package.appxmanifest");
  writeFileSync(
    manifest,
    renderManifest(readFileSync(join(ROOT, "src-tauri/windows/Package.appxmanifest"), "utf8"), {
      identity,
      version,
      chip,
    }),
  );
  const unsigned = join(proof, names.msix);
  run("winapp", ["pack", stage, "--manifest", manifest, "--no-sign", "--output", unsigned]);
  if (!existsSync(unsigned)) throw new Error(`winapp made no ${unsigned}`);
  if (identity.forStore) copyFileSync(unsigned, join(out, names.msix));

  // The proof's copy: those bytes, signed by a certificate made for this run
  // alone, whose private half never leaves this machine.
  const password = randomBytes(18).toString("base64url");
  const pfx = join(proof, "throwaway.pfx");
  run("winapp", [
    "cert",
    "generate",
    "--publisher",
    identity.publisher,
    "--output",
    pfx,
    "--password",
    password,
    "--export-cer",
    "--if-exists",
    "Overwrite",
  ]);
  const signed = join(proof, names.msix.replace(/\.msix$/, ".test.msix"));
  copyFileSync(unsigned, signed);
  run("winapp", ["sign", signed, pfx, "--password", password]);
  rmSync(pfx, { force: true });

  const shipped = [names.installer, ...(identity.forStore ? [names.msix] : []), names.roll];
  const entries = shipped.map((name) => ({ name, sha256: sha256(join(out, name)) }));
  writeFileSync(join(out, names.sums), sumsText(entries));
  const lines = [
    `### Proscenium ${version} for Windows ${chip}`,
    "",
    ...entries.map(({ name, sha256: h }) => `- \`${name}\` ${h}`),
    identity.forStore
      ? ""
      : `- The Store's package was built and is proven, with a test identity: Partner Center has not given the app its own, so it is not shipped.`,
    "",
  ];
  // What the proof (scripts/windows/installed-proof.ps1) looks for in --proof.
  writeFileSync(join(proof, "package-name.txt"), identity.name);
  if (!existsSync(join(proof, "throwaway.cer")))
    throw new Error("winapp exported no throwaway.cer");
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY)
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { flag: "a" });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`release-build: ${e.message}`);
    process.exit(1);
  });
}
