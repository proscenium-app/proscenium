// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Mac App Store's copy of a stable release (docs/engineering/release-engineering.md#REL-56,
 * docs/engineering/release-engineering.md#SHIP-D113): the release's own commit built
 * without the updater, signed for the store, put in its signed installer
 * package, validated and uploaded to App Store Connect, then written and
 * submitted for review, to go on sale once App Review approves it. On the
 * build host, from its release keychain (`PROSCENIUM_KEYCHAIN`), as the
 * release machine's `appstore` stage runs it (release-stage.yml), after the
 * stable release that is the maintainer's word for it.
 *
 *   node scripts/release-app-store.mjs build --version X.Y.Z --n N [--upload] [--out <dir>]
 *        the tag's commit, checked out: built, signed, packaged, checked and validated;
 *        with --upload, uploaded and waited on until App Store Connect has processed it.
 *        N is the upload's number for this version, from the release's file
 *   --app <Proscenium.app>
 *        sign, package and check a store app `build-app.mjs --universal --app-store`
 *        made already, from this commit, instead of building it again
 *   node scripts/release-app-store.mjs build --version X.Y.Z --n N --stand-in [--out <dir>]
 *        the same path with no store material: a self-signed identity of each kind
 *        and a stand-in profile, in a scratch keychain made and removed here; the
 *        package is checked, and App Store Connect's validation must refuse it as
 *        a stand-in should be refused. Nothing is uploaded
 *   node scripts/release-app-store.mjs submit --version X.Y.Z --n N [--dry-run] [--out <dir>]
 *        upload N's build submitted for App Review with the release's What's New, the
 *        listing and the screenshots (scripts/app-store-connect.mjs); --dry-run, a
 *        stand-in's, makes all of it and sends none
 *   node scripts/release-app-store.mjs review --version X.Y.Z
 *        App Review's answer, as JSON, for the release machine's watch
 *   node scripts/release-app-store.mjs material
 *        what the build host has of the store's material, by name, never a value
 *
 * **The build number** (CFBundleVersion) is `X.Y.(Z×1000+N)`: 1.0.3's first
 * upload is 1.0.3001, its second 1.0.3002. App Store Connect takes at most
 * three integers there and refuses a number it has seen, and the next release
 * always reads higher. CFBundleShortVersionString stays X.Y.Z. Only a stable
 * release is built for the store.
 *
 * **What it signs with.** The Apple Distribution identity the store profile
 * names, `src-tauri/Entitlements.plist` completed with the application and
 * team identifiers read from that profile (codesign does not expand Xcode's
 * variables), the profile embedded as `Contents/embedded.provisionprofile`
 * (staged at `.release/appstore.provisionprofile`, the path
 * `tauri.appstore.conf.json` names), and the hardened runtime. The package is
 * `productbuild`'s, signed with the Mac Installer Distribution identity. The
 * signed app is audited against its own embedded profile
 * (scripts/release-profile.mjs) before it is packaged. The profile itself is
 * made through the API whenever there is none, it names another certificate,
 * or it lapses within a month.
 *
 * **Waiting, not failing.** Until the store's certificates and the app's
 * record exist, `build` says what is missing in its result (`waiting`) and
 * exits 0: the stage is skipped with that reason, as the Windows Store's is
 * until Partner Center names the app.
 *
 * Writes `<out>/appstore.json` or `<out>/submitted.json`, the result the
 * release machine records, and, for a real build, the package. Nothing here
 * prints a secret: the API key is written to a private temporary folder for
 * the one command that reads it and removed afterwards, pass or fail, and
 * App Store Connect's own calls sign a token with it in memory.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  apiOf,
  appOf,
  makeProfile,
  profileDue,
  putOf,
  readListing,
  reviewState,
  storeNotes,
  submitVersion,
} from "./app-store-connect.mjs";
import { fetchRoll } from "./patrons.mjs";
import { PROFILE_DIR, STORE_PROFILE, load, readProfile, storeIds } from "./release-keychain.mjs";
import { assertStoreProfileAuthorizes } from "./release-profile.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(ROOT, ".release");
/** Where tauri.appstore.conf.json says the store's profile is. */
export const STAGED_PROFILE = join(STAGE, "appstore.provisionprofile");

// --- what is pure, and tested ---------------------------------------------------------

/**
 * The build number of upload `n` of stable release `version`: `X.Y.(Z×1000+n)`.
 * Three integers, as App Store Connect takes, and always higher than every
 * upload of an earlier release, since Z only rises within X.Y.
 */
export function bundleVersion(version, n) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version ?? "");
  if (!m) throw new Error(`${version} is not a stable release's X.Y.Z: only those go to the store`);
  if (!Number.isInteger(n) || n < 1 || n > 999)
    throw new Error(`${n} is not an upload's number: 1 to 999`);
  return `${m[1]}.${m[2]}.${Number(m[3]) * 1000 + n}`;
}

/** What the build host lacks of the store's material, by name: empty when it has it all. */
export function missingMaterial({ distribution, installer, profile, key, record = true }) {
  const missing = [];
  if (distribution.length === 0) missing.push("the Apple Distribution certificate");
  if (distribution.length > 1)
    missing.push(`one Apple Distribution identity (the keychain has ${distribution.length})`);
  if (installer.length === 0) missing.push("the Mac Installer Distribution certificate");
  if (installer.length > 1)
    missing.push(`one installer identity (the keychain has ${installer.length})`);
  if (!profile) missing.push("the Mac App Store provisioning profile");
  if (!key) missing.push("the App Store Connect API key");
  else if (!record) missing.push("the app's record in App Store Connect");
  return missing;
}

/**
 * What altool said, from its JSON (`--output-format json`): `{ ok, errors,
 * delivery }`. Its errors come as `product-errors`, each with a code and a
 * message; anything it could not say in JSON is one error of its words.
 */
export function readAltool(status, stdout, stderr = "") {
  let doc = null;
  try {
    const at = stdout.indexOf("{");
    doc = at >= 0 ? JSON.parse(stdout.slice(at)) : null;
  } catch {
    doc = null;
  }
  const errors = (doc?.["product-errors"] ?? []).map((e) => ({
    code: e.code ?? null,
    message: String(e.message ?? e.userInfo?.NSLocalizedDescription ?? "").slice(0, 400),
    reason: String(e.userInfo?.NSLocalizedFailureReason ?? "").slice(0, 400),
  }));
  if (status !== 0 && errors.length === 0)
    errors.push({
      code: null,
      message: `${stderr || stdout}`.trim().split("\n").slice(-3).join(" ").slice(0, 400),
      reason: "",
    });
  const delivery =
    doc?.["delivery-uuid"] ?? doc?.details?.["delivery-uuid"] ?? doc?.deliveryUuid ?? null;
  return { ok: status === 0 && errors.length === 0, errors, delivery, doc };
}

/**
 * Whether App Store Connect's refusal of a stand-in package is the refusal a
 * stand-in earns: its identity is not Apple's, its profile is not Apple's, or
 * its team has no such app. An authentication failure is not one: that is
 * the real key refused, which a real upload would meet too.
 */
export function standInRefusal(errors) {
  const text = errors.map((e) => `${e.code ?? ""} ${e.message} ${e.reason}`).join(" | ");
  if (/authenticat|unauthori[sz]ed|401|NOT_AUTHORIZED|credentials/i.test(text))
    return { expected: false, why: `the API key was refused: ${text}` };
  const expected =
    /no suitable application records|cannot determine the apple id from bundle id|bundle identifier|certificate|signature|signed|provisioning|profile|team|invalid|not (?:a )?valid/i;
  return expected.test(text)
    ? { expected: true, why: text }
    : { expected: false, why: `refused for a reason a stand-in does not explain: ${text}` };
}

// --- the build host ---------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
let temp = null;

function scratch() {
  temp ??= mkdtempSync(join(tmpdir(), "proscenium-appstore-"));
  return temp;
}

function step(what) {
  console.log(`\n── ${what}`);
}

function fail(message) {
  throw new Error(`release-app-store: ${message}`);
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

const plist = (app, key) =>
  spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, join(app, "Contents/Info.plist")], {
    encoding: "utf8",
  }).stdout.trim();

const sha1Of = (der) => createHash("sha1").update(der).digest("hex").toUpperCase();

/** The App Store Connect API key, from the release keychain: `{ keyId, issuer, p8 }`, or null. */
function apiKey() {
  const keyId = load("APPLE_API_KEY")?.toString();
  const issuer = load("APPLE_API_ISSUER")?.toString();
  const p8 = load("APPLE_API_KEY_P8");
  return keyId && issuer && p8 ? { keyId, issuer, p8 } : null;
}

/** Whether App Store Connect has a record of the app. A key it refuses throws: that is no waiting. */
async function hasRecord(key, identifier) {
  try {
    await appOf(apiOf(key), identifier);
    return true;
  } catch (e) {
    if (/has no app for/.test(e.message)) return false;
    throw e;
  }
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
    return readAltool(r.status ?? 1, r.stdout ?? "", r.stderr ?? "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The stand-in's material: a scratch keychain holding a self-signed identity
 * of each kind, and a profile in Apple's form (a CMS-signed plist) naming the
 * stand-in's certificate. What it proves is the path: that the build signs,
 * embeds, audits, packages and checks with whatever Apple's portal will issue.
 */
function standInMaterial(identifier) {
  const dir = join(scratch(), "stand-in");
  mkdirSync(dir, { mode: 0o700 });
  const team = "STANDIN000";
  const password = randomBytes(24).toString("base64url");
  const keychain = join(dir, "stand-in.keychain-db");
  const security = (line) =>
    spawnSync("security", ["-i"], { input: `${line}\n`, stdio: ["pipe", "ignore", "ignore"] });
  if (security(`create-keychain -p "${password}" "${keychain}"`).status !== 0)
    fail("the stand-in's keychain could not be made");
  security(`unlock-keychain -p "${password}" "${keychain}"`);
  run("security", ["set-keychain-settings", keychain]);
  // codesign and productbuild find an identity only in a keychain on the
  // user's search list, whatever `--keychain` says: on it for this run, and
  // the list as it was afterwards, pass or fail.
  const list = () =>
    capture("security", ["list-keychains", "-d", "user"])
      .split("\n")
      .map((l) => l.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
  const before = list();
  run("security", ["list-keychains", "-d", "user", "-s", ...before, keychain]);

  const make = (name, usage) => {
    const cnf = join(dir, `${usage}.cnf`);
    writeFileSync(
      cnf,
      [
        "[req]",
        "distinguished_name = dn",
        "prompt = no",
        "x509_extensions = ext",
        "[dn]",
        `CN = ${name}`,
        `OU = ${team}`,
        "[ext]",
        "basicConstraints = critical,CA:false",
        "keyUsage = critical,digitalSignature",
        // Code signing; Apple's package-signing purpose for the installer.
        `extendedKeyUsage = critical,${usage === "code" ? "codeSigning" : "1.2.840.113635.100.4.13"}`,
        "",
      ].join("\n"),
    );
    const key = join(dir, `${usage}.key`);
    const pem = join(dir, `${usage}.pem`);
    const p12 = join(dir, `${usage}.p12`);
    capture("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "2",
      "-config",
      cnf,
      "-keyout",
      key,
      "-out",
      pem,
    ]);
    // `security import` takes the legacy PKCS#12 macOS itself writes: OpenSSL 3
    // writes it when told `-legacy`, LibreSSL always, and knows no such flag.
    const exported = [["-legacy"], []].some(
      (extra) =>
        spawnSync(
          "openssl",
          [
            "pkcs12",
            "-export",
            ...extra,
            "-inkey",
            key,
            "-in",
            pem,
            "-out",
            p12,
            "-passout",
            `pass:${password}`,
          ],
          { stdio: "ignore" },
        ).status === 0,
    );
    if (!exported) fail(`the stand-in's ${usage} identity could not be exported`);
    if (security(`import "${p12}" -k "${keychain}" -f pkcs12 -P "${password}" -A`).status !== 0)
      fail(`the stand-in's ${usage} identity could not be imported`);
    const der = Buffer.from(readFileSync(pem, "utf8").replace(/-----[^-]+-----|\s/g, ""), "base64");
    return { identity: name, sha1: sha1Of(der), der, pem, key };
  };
  const code = make(`Apple Distribution: Stand-in (${team})`, "code");
  const installer = make(`3rd Party Mac Developer Installer: Stand-in (${team})`, "installer");
  security(
    `set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "${password}" "${keychain}"`,
  );

  // A profile as Apple's portal makes a Mac App Store one: no devices, the
  // app's identifiers and its iCloud container, the certificate it allows.
  const ent = {
    "com.apple.application-identifier": `${team}.${identifier}`,
    "com.apple.developer.team-identifier": team,
    "com.apple.developer.icloud-container-identifiers": [`iCloud.${identifier}`],
    "com.apple.developer.ubiquity-container-identifiers": [`iCloud.${identifier}`],
    "com.apple.developer.icloud-services": ["CloudDocuments", "CloudKit"],
    "com.apple.developer.icloud-container-environment": ["Development", "Production"],
    "keychain-access-groups": [`${team}.*`],
  };
  const xml = join(dir, "profile.plist");
  writeFileSync(
    xml,
    JSON.stringify({
      AppIDName: "Proscenium",
      ApplicationIdentifierPrefix: [team],
      Name: "Proscenium Mac App Store (stand-in)",
      TeamIdentifier: [team],
      Entitlements: ent,
      Platform: ["OSX"],
      Version: 1,
    }),
  );
  run("plutil", ["-convert", "xml1", xml]);
  // Dates and data are plist types JSON cannot say: added in place.
  const expires = new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d+Z$/, "Z");
  run("plutil", ["-insert", "ExpirationDate", "-date", expires, xml]);
  run("plutil", ["-insert", "DeveloperCertificates", "-array", xml]);
  run("plutil", ["-insert", "DeveloperCertificates.0", "-data", code.der.toString("base64"), xml]);
  // Signed as Apple signs a profile, CMS with the content inside. OpenSSL 3
  // (the build host's toolchain) signs with any certificate; the keychain's
  // own CMS tool only with a trusted identity, which a stand-in's is not.
  const profile = join(dir, "stand-in.provisionprofile");
  capture("openssl", [
    "cms",
    "-sign",
    "-nodetach",
    "-binary",
    "-outform",
    "DER",
    "-in",
    xml,
    "-signer",
    code.pem,
    "-inkey",
    code.key,
    "-out",
    profile,
  ]);
  return {
    keychain,
    distribution: [{ identity: code.identity, sha1: code.sha1, team }],
    installer: [{ identity: installer.identity, sha1: installer.sha1, team }],
    profile,
    cleanup: () => {
      spawnSync("security", ["list-keychains", "-d", "user", "-s", ...before], { stdio: "ignore" });
      spawnSync("security", ["delete-keychain", keychain], { stdio: "ignore" });
    },
  };
}

/** The real material, from the release keychain and the profile beside it. */
function realMaterial() {
  const ids = storeIds();
  const keychain = process.env.PROSCENIUM_KEYCHAIN;
  return {
    keychain: keychain ?? null,
    distribution: ids.distribution,
    installer: ids.installer,
    profile: existsSync(STORE_PROFILE) ? STORE_PROFILE : null,
    cleanup: () => {},
  };
}

/**
 * Every Mach-O inside the bundle but its main executable, deepest first, which
 * is the order code signing needs: a store build of this app carries none
 * today, and one added later is signed with the sandbox's inheritance.
 */
function nestedCode(app, exe) {
  const MAGIC = new Set(["cafebabe", "feedface", "feedfacf", "cefaedfe", "cffaedfe"]);
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p);
      else if (p !== exe) {
        const head = Buffer.alloc(4);
        const fd = openSync(p, "r");
        readSync(fd, head, 0, 4, 0);
        closeSync(fd);
        if (MAGIC.has(head.toString("hex"))) found.push(p);
      }
    }
  };
  walk(join(app, "Contents"));
  return found.sort((a, b) => b.split("/").length - a.split("/").length);
}

async function build() {
  const version = opt("--version");
  const n = Number(opt("--n"));
  const standIn = args.includes("--stand-in");
  const upload = args.includes("--upload") && !standIn;
  const out = resolve(opt("--out") ?? join(ROOT, ".release-artifacts", `appstore-${version}`));
  const number = bundleVersion(version, n);
  const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
  const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  if (pkgVersion !== version) fail(`this commit is ${pkgVersion}, not ${version}`);
  if (!existsSync(join(ROOT, "src-tauri/tauri.appstore.conf.json")))
    fail("this commit has no store build (src-tauri/tauri.appstore.conf.json)");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const result = (fields) => {
    const doc = { version, n, build: number, standIn, ...fields };
    writeFileSync(join(out, "appstore.json"), `${JSON.stringify(doc, null, 2)}\n`);
    return doc;
  };

  step(`material for ${version}, build ${number}${standIn ? " (a stand-in)" : ""}`);
  const key = apiKey();
  const material = standIn ? standInMaterial(conf.identifier) : realMaterial();
  try {
    // The app's record, asked for before an hour's build: App Store Connect
    // refuses every package of an app it has no record of. A stand-in goes on,
    // and must be refused for it.
    const record = standIn || !key ? true : await hasRecord(key, conf.identifier);
    // The Mac App Store profile, made through the API when there is none,
    // when it names another certificate, or a month before it lapses.
    let profileWhy = null;
    if (!standIn && key && record && material.distribution.length === 1) {
      const why = profileDue(
        material.profile ? readProfile(material.profile) : null,
        material.distribution[0].sha1,
      );
      if (why) {
        try {
          const bytes = await makeProfile({
            api: apiOf(key),
            identifier: conf.identifier,
            certificateSha1: material.distribution[0].sha1,
            name: `Proscenium Mac App Store ${new Date().toISOString().slice(0, 10)}`,
          });
          mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
          writeFileSync(`${STORE_PROFILE}.new`, bytes, { mode: 0o600 });
          renameSync(`${STORE_PROFILE}.new`, STORE_PROFILE);
          material.profile = STORE_PROFILE;
          console.log(`  profile made anew: ${why}`);
        } catch (e) {
          // A key App Store Connect lets make none leaves the profile to a person.
          profileWhy = e.message;
          console.log(`  profile not made: ${e.message}`);
        }
      }
    }
    const missing = missingMaterial({ ...material, key, record }).map((m) =>
      profileWhy && m === "the Mac App Store provisioning profile"
        ? `${m} (the API made none: ${profileWhy})`.slice(0, 300)
        : m,
    );
    if (missing.length) {
      console.log(`  waiting on ${missing.join(", ")}`);
      return result({ state: "waiting", missing });
    }
    const [distribution] = material.distribution;
    const [installer] = material.installer;
    const info = readProfile(material.profile);
    const team = info.team;
    if (distribution.team !== team || installer.team !== team)
      fail(`the store's identities are not team ${team}'s, whose profile this is`);
    console.log(
      `  app       ${distribution.identity}\n  package   ${installer.identity}\n  profile   ${info.name}, until ${info.expires}`,
    );

    // The entitlements this build signs, completed from the profile, and held
    // to it before anything is built.
    mkdirSync(STAGE, { recursive: true, mode: 0o700 });
    copyFileSync(material.profile, STAGED_PROFILE);
    const entitlements = join(STAGE, "Entitlements.appstore.plist");
    copyFileSync(join(ROOT, "src-tauri/Entitlements.plist"), entitlements);
    run("/usr/libexec/PlistBuddy", [
      "-c",
      `Add :com.apple.application-identifier string ${info.appId}`,
      "-c",
      `Add :com.apple.developer.team-identifier string ${team}`,
      entitlements,
    ]);
    const intended = JSON.parse(capture("plutil", ["-convert", "json", "-o", "-", entitlements]));
    assertStoreProfileAuthorizes({
      profile: info,
      signed: intended,
      identifier: conf.identifier,
      team,
      certificate: distribution.sha1,
    });

    step("the store's app: built from this commit");
    const env = { ...process.env, PROSCENIUM_REPORTS: "1" };
    try {
      const roll = await fetchRoll();
      const file = join(scratch(), "roll.json");
      writeFileSync(file, JSON.stringify(roll));
      env.PROSCENIUM_PATRONS_FILE = file;
    } catch (e) {
      console.warn(`  WARNING: no sponsors' roll (${e.message}); this build carries the empty one`);
    }
    const built =
      opt("--app") ??
      join(
        ROOT,
        "src-tauri/target/universal-apple-darwin/release/bundle/macos",
        `${conf.productName}.app`,
      );
    if (opt("--app")) console.log(`  built already: ${built}`);
    else
      run(process.execPath, [join(ROOT, "scripts/build-app.mjs"), "--universal", "--app-store"], {
        cwd: ROOT,
        env,
      });
    const app = join(out, `${conf.productName}.app`);
    run("ditto", [built, app]);

    step(`signed for the store: build ${number}`);
    run("/usr/libexec/PlistBuddy", [
      "-c",
      `Set :CFBundleVersion ${number}`,
      join(app, "Contents/Info.plist"),
    ]);
    copyFileSync(STAGED_PROFILE, join(app, "Contents/embedded.provisionprofile"));
    const exe = join(app, "Contents/MacOS", plist(app, "CFBundleExecutable"));
    const keychain = material.keychain ? ["--keychain", material.keychain] : [];
    // A stand-in's certificate is not Apple's, which Apple's timestamp service
    // has no reason to serve.
    const timestamp = standIn ? "--timestamp=none" : "--timestamp";
    const inherit = join(scratch(), "inherit.plist");
    writeFileSync(
      inherit,
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/><key>com.apple.security.inherit</key><true/></dict></plist>\n`,
    );
    for (const code of nestedCode(app, exe)) {
      run("codesign", [
        "--force",
        "--options",
        "runtime",
        timestamp,
        "--entitlements",
        inherit,
        "--sign",
        distribution.sha1,
        ...keychain,
        code,
      ]);
    }
    run("codesign", [
      "--force",
      "--options",
      "runtime",
      timestamp,
      "--entitlements",
      entitlements,
      "--sign",
      distribution.sha1,
      ...keychain,
      app,
    ]);
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);

    step("the signed app, held to its own profile");
    run(process.execPath, [
      join(ROOT, "scripts/check-bundle.mjs"),
      app,
      "--universal",
      "--release",
      "--app-store",
      // The listing's privacy answers say the store's copy sends reports.
      "--reports",
      "--version",
      version,
    ]);
    if (plist(app, "CFBundleShortVersionString") !== version)
      fail(`the app says ${plist(app, "CFBundleShortVersionString")} to macOS, not ${version}`);
    if (plist(app, "CFBundleVersion") !== number)
      fail(`the app's build is ${plist(app, "CFBundleVersion")}, not ${number}`);
    const signed = JSON.parse(
      capture("plutil", ["-convert", "json", "-o", "-", "-"], {
        input: capture("codesign", ["-d", "--entitlements", "-", "--xml", app]),
      }),
    );
    const prefix = join(scratch(), "signed-certificate-");
    capture("codesign", ["-d", `--extract-certificates=${prefix}`, app]);
    const flags = spawnSync("codesign", ["-dv", app], { encoding: "utf8" }).stderr;
    if (!/flags=0x[0-9a-f]*\(.*runtime.*\)/.test(flags))
      fail("the app is not signed with the hardened runtime");
    assertStoreProfileAuthorizes({
      profile: readProfile(join(app, "Contents/embedded.provisionprofile")),
      signed,
      identifier: conf.identifier,
      team,
      certificate: sha1Of(readFileSync(`${prefix}0`)),
    });
    console.log(
      "  sandboxed, its iCloud container authorised, signed by the profile's certificate",
    );

    step("the installer package, signed");
    const pkg = join(out, `${conf.productName}_${version}_${number}.pkg`);
    if (standIn) {
      // productbuild signs only with an identity macOS trusts, which a
      // stand-in's is not without changing this Mac's trust settings, and
      // macOS 26's xar no longer signs: a stand-in's package goes unsigned,
      // pkgutil must say so, and App Store Connect must refuse it.
      run("productbuild", ["--component", app, "/Applications", pkg]);
    } else
      run("productbuild", [
        "--component",
        app,
        "/Applications",
        "--sign",
        installer.identity,
        ...keychain,
        pkg,
      ]);
    const checked = spawnSync("pkgutil", ["--check-signature", pkg], { encoding: "utf8" });
    console.log(checked.stdout.trim());
    if (standIn) {
      if (!/Status: no signature/i.test(checked.stdout))
        fail("pkgutil does not say the stand-in's package carries no signature");
    } else {
      if (!checked.stdout.includes(installer.identity))
        fail(`pkgutil does not say the package is signed by ${installer.identity}`);
      if (checked.status !== 0 || !/trusted by (?:macOS|Mac OS X)/.test(checked.stdout))
        fail("pkgutil does not say the package's certificate is trusted by macOS");
    }
    const sha256 = createHash("sha256").update(readFileSync(pkg)).digest("hex");
    const said = {
      identity: distribution.identity,
      installer: installer.identity,
      profile: { name: info.name, expires: info.expires },
      package: { name: pkg.split("/").pop(), sha256 },
    };

    step("App Store Connect's validation");
    const validated = altool(key, ["--validate-app", pkg, "-t", "macos"]);
    for (const e of validated.errors) console.log(`  ${e.code ?? "—"}: ${e.message} ${e.reason}`);
    if (standIn) {
      if (validated.ok)
        fail("App Store Connect validated a stand-in's package: nothing it checks held");
      const read = standInRefusal(validated.errors);
      if (!read.expected) fail(read.why);
      console.log("  refused, as a stand-in's package must be");
      return result({ state: "refused-as-expected", ...said, refusal: read.why.slice(0, 400) });
    }
    if (!validated.ok) fail("App Store Connect refused the package (above)");
    console.log("  valid");
    if (!upload) return result({ state: "validated", ...said });

    step("uploaded, and processed");
    const sent = altool(key, ["--upload-package", pkg, "-t", "macos", "--wait"]);
    for (const e of sent.errors) console.log(`  ${e.code ?? "—"}: ${e.message} ${e.reason}`);
    if (!sent.ok) {
      result({ state: "refused", ...said, errors: sent.errors });
      fail("App Store Connect refused the upload (above)");
    }
    console.log(`  delivery ${sent.delivery ?? "(no id said)"}`);
    return result({ state: "uploaded", ...said, delivery: sent.delivery });
  } finally {
    material.cleanup();
    for (const f of [STAGED_PROFILE, join(STAGE, "Entitlements.appstore.plist")])
      rmSync(f, { force: true });
    if (temp) rmSync(temp, { recursive: true, force: true });
    temp = null;
  }
}

/**
 * The store's copy of the release, written and submitted: its notes as What's
 * New (this commit's changelog section, without what is not the store's), the
 * listing (scripts/store/listing.json, as `main` has it, so a mended listing
 * goes with the same build), and the screenshots `store-screenshots.mjs`
 * makes from this commit. A stand-in's is a dry run: everything made and held
 * to its limits, nothing sent.
 */
async function submit() {
  const version = opt("--version");
  const number = bundleVersion(version, Number(opt("--n")));
  const dryRun = args.includes("--dry-run");
  const out = resolve(opt("--out") ?? join(ROOT, ".release-artifacts", `appstore-${version}`));
  const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));

  step("What's New, from the release's notes");
  const said = spawnSync(process.execPath, ["scripts/version.mjs", "notes", version], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const notes = storeNotes(said.status === 0 ? said.stdout : "");
  if (!notes) fail(`the changelog has no notes for ${version}: What's New is made from them`);
  console.log(`  ${notes.length} characters`);

  step("the listing");
  const fromMain = spawnSync("git", ["show", "origin/main:scripts/store/listing.json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const listing = readListing(
    !dryRun && fromMain.status === 0
      ? fromMain.stdout
      : readFileSync(join(ROOT, "scripts/store/listing.json"), "utf8"),
  );
  console.log(
    `  ${listing.locale}, as ${!dryRun && fromMain.status === 0 ? "main" : "this commit"} has it`,
  );

  step("the screenshots, from this commit");
  const shotsDir = join(ROOT, ".store", "screenshots");
  rmSync(shotsDir, { recursive: true, force: true });
  run(process.execPath, [join(ROOT, "scripts/store-screenshots.mjs")], { cwd: ROOT });
  const shots = readdirSync(shotsDir)
    .filter((f) => f.endsWith(".png") && !f.endsWith(".failed.png"))
    .sort()
    .map((fileName) => ({ fileName, bytes: readFileSync(join(shotsDir, fileName)) }));
  if (!shots.length) fail("store-screenshots.mjs made no screenshot");
  console.log(`  ${shots.map((s) => s.fileName).join(", ")}`);

  mkdirSync(out, { recursive: true });
  if (dryRun) {
    writeFileSync(
      join(out, "submitted.json"),
      `${JSON.stringify({ version, build: number, dryRun: true, notes: notes.length, shots: shots.length }, null, 2)}\n`,
    );
    console.log("  a dry run: nothing was sent");
    return;
  }
  const key = apiKey();
  if (!key) fail("the release keychain has no App Store Connect API key");
  step(`${version}, build ${number}: submitted for App Review`);
  const done = await submitVersion({
    api: apiOf(key),
    put: putOf(),
    identifier: conf.identifier,
    version,
    build: number,
    notes,
    listing,
    shots,
  });
  for (const line of done.steps) console.log(`  ${line}`);
  writeFileSync(
    join(out, "submitted.json"),
    `${JSON.stringify({ version, build: number, ...done }, null, 2)}\n`,
  );
  console.log(`  submission ${done.submission}: ${done.state}`);
}

/** App Review's answer for `--version`, as JSON on standard output, for the release machine. */
async function review() {
  const key = apiKey();
  if (!key) fail("the release keychain has no App Store Connect API key");
  const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
  const said = await reviewState({
    api: apiOf(key),
    identifier: conf.identifier,
    version: opt("--version"),
  });
  console.log(JSON.stringify(said));
}

async function material() {
  const m = realMaterial();
  const key = apiKey();
  const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8"));
  const missing = missingMaterial({
    ...m,
    key,
    record: key ? await hasRecord(key, conf.identifier) : true,
  });
  for (const id of [...m.distribution, ...m.installer]) console.log(`identity  ${id.identity}`);
  if (m.profile) {
    const info = readProfile(m.profile);
    console.log(`profile   ${info.name} · ${info.appId} · until ${info.expires}`);
  }
  console.log(
    missing.length ? `missing   ${missing.join("; ")}` : "the store's material is all here",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = args[0];
  const commands = { build, submit, review, material };
  if (!commands[command]) {
    console.error(
      "usage: node scripts/release-app-store.mjs build --version X.Y.Z --n N [--upload | --stand-in] [--out <dir>]\n" +
        "       node scripts/release-app-store.mjs submit --version X.Y.Z --n N [--dry-run] [--out <dir>]\n" +
        "       node scripts/release-app-store.mjs review --version X.Y.Z\n" +
        "       node scripts/release-app-store.mjs material",
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
