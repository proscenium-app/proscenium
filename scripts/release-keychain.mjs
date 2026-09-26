// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The release's signing material on this Mac (docs/engineering/release-engineering.md#SHIP-D100, "Signing on this Mac").
 *
 *   node scripts/release-keychain.mjs status    what is in place: names, dates, present or not — never a value
 *   node scripts/release-keychain.mjs status --apple   …and whether Apple still accepts the notarization key
 *   node scripts/release-keychain.mjs notary    file the notarization key from ~/Downloads, asking the maintainer for its Issuer ID
 *   node scripts/release-keychain.mjs profile   file the Developer ID provisioning profile from ~/Downloads
 *   node scripts/release-keychain.mjs cloudflare file a just-copied deploy token without displaying it
 *   node scripts/release-keychain.mjs log <id>  Apple's reasons for a notarization submission, with the stored key
 *   node scripts/release-keychain.mjs move --host <user@host>
 *                                               copy every item to the build host's own keychain, over SSH
 *   node scripts/release-keychain.mjs secrets   set the GitHub Actions secrets from this keychain, printing none
 *
 * Signed builds are made on the build host, by scripts/release.mjs, from a
 * keychain of its own that a headless runner can unlock (`move`). This Mac
 * keeps its copies, and signs when asked to directly. What CI would hold as
 * Actions secrets lives in a keychain either way:
 *
 *   - the Developer ID Application certificate and its private key, in the
 *     login keychain, where Xcode puts them when the maintainer creates the certificate;
 *   - the notarization key, its Key ID and its Issuer ID, the updater's private
 *     key (scripts/updater-keygen.mjs) and the scoped Cloudflare deploy token, as items of the login keychain under the service
 *     "Proscenium release", each named for the environment variable CI would
 *     give it;
 *   - the provisioning profile, which is not secret, as a file in
 *     ~/Library/Application Support/Proscenium Release/.
 *
 * **Nothing here prints a secret or logs one.** A value travels from a file or
 * a dialog into the keychain over a pipe to `security -i`, and from the
 * keychain into the one process that needs it. An agent runs these commands,
 * and a transcript is not a place for a key. The keychain rather than a file
 * also keeps them out of every glob a careless `cat` could sweep. The one
 * exception to "never on a command line" is notarytool, which takes the Key ID
 * and Issuer ID only as arguments; they are identifiers, and the key itself
 * stays in a file only this user can read.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export const SERVICE = "Proscenium release";
export const PROFILE_DIR = join(homedir(), "Library/Application Support/Proscenium Release");
export const PROFILE = join(PROFILE_DIR, "Proscenium_Developer_ID.provisionprofile");

/**
 * Which keychain holds the items. Unset on the maintainer's Mac: the login keychain,
 * where Xcode put the certificate and where a person is present to unlock it.
 * Set on the build host, where a login keychain is locked over SSH and can
 * only be opened by a password nobody is there to type — so a keychain of its
 * own takes its place, and `move` fills it.
 */
export const KEYCHAIN = process.env.PROSCENIUM_KEYCHAIN || null;

/** The build host's side of `move`, by the name each thing has there. */
export const HOST_KEYCHAIN = "proscenium-release.keychain";
const HOST_PASSWORD = ".proscenium/release-keychain-password";
/** The build host `move` fills, as user@host; this repository names no machine. */
const DEFAULT_HOST = process.env.PROSCENIUM_BUILD_HOST;
/** Where every Mac keeps the certificate authorities it came with. */
const SYSTEM_ROOTS = "/System/Library/Keychains/SystemRootCertificates.keychain";

/**
 * Run `security` with its commands on stdin. `security -i` reads a command
 * line from stdin, so a passphrase, a key or a token never reaches the
 * process list, where every other account on a shared machine can read it.
 */
function security(commands, { capture = false } = {}) {
  const result = spawnSync("security", ["-i"], {
    input: commands.endsWith("\n") ? commands : `${commands}\n`,
    stdio: ["pipe", capture ? "pipe" : "ignore", "ignore"],
    ...(capture ? { maxBuffer: 64 * 1024 * 1024 } : {}),
  });
  return result;
}

/** `-k <keychain>`, or nothing at all on a Mac whose login keychain is open. */
function into() {
  return KEYCHAIN ? ` ${JSON.stringify(KEYCHAIN)}` : "";
}

/**
 * Where a new key file waits, only until scripts/keys-archive.mjs has sealed
 * it into the encrypted archive in Drive; then the folder goes to the Trash.
 */
export const FOR_ARCHIVE = join(homedir(), "Desktop", "Proscenium keys to archive");

/** The keychain items, by the environment variable CI would hold each in. */
export const ITEMS = {
  APPLE_API_KEY: "notarization Key ID",
  APPLE_API_ISSUER: "notarization Issuer ID",
  APPLE_API_KEY_P8: "notarization key, the .p8 file",
  TAURI_SIGNING_PRIVATE_KEY: "updater private key",
  CLOUDFLARE_API_TOKEN: "Proscenium Worker deploy token",
};

const DEVELOPER_ID = /\b([0-9A-F]{40}) "(Developer ID Application: (.+) \(([A-Z0-9]{10})\))"/;

/**
 * Store a value, base64 so every item is one line whatever the file held. The
 * value goes over stdin: `security -i` reads commands from it, so nothing
 * reaches a process list. Refuses to replace an item unless told to, so a key
 * that installed copies already trust is never overwritten by accident.
 */
export function store(name, bytes, { replace = false } = {}) {
  if (!(name in ITEMS)) throw new Error(`release-keychain: no item called ${name}`);
  if (has(name) && !replace) throw new Error(`release-keychain: the keychain already holds ${ITEMS[name]} (${name})`);
  const encoded = Buffer.from(bytes).toString("base64");
  unlock();
  // Errors are named by exit status only: security's messages are not known
  // to leave the command they failed on out.
  const result = security(
    `add-generic-password ${replace ? "-U " : ""}-s "${SERVICE}" -a ${name} -l "${SERVICE}: ${ITEMS[name]}" -w ${encoded}${into()}`,
  );
  if (result.status !== 0) throw new Error(`release-keychain: could not store ${name} (security exited ${result.status})`);
}

export function has(name) {
  unlock();
  return security(`find-generic-password -s "${SERVICE}" -a ${name}${into()}`).status === 0;
}

/** The stored bytes, or null. For handing to a child process — never print it. */
export function load(name) {
  unlock();
  const result = security(`find-generic-password -s "${SERVICE}" -a ${name} -w${into()}`, { capture: true });
  return result.status === 0 ? Buffer.from(result.stdout.toString().trim(), "base64") : null;
}

/**
 * Open the build host's keychain with the password in the file beside it, so a
 * runner nobody is sitting at can sign. A no-op on a Mac, whose login keychain
 * a person has already unlocked by logging in.
 */
function unlock() {
  if (!KEYCHAIN) return;
  const file = join(homedir(), HOST_PASSWORD);
  if (!existsSync(file)) {
    throw new Error(`release-keychain: no password for ${KEYCHAIN} at ~/${HOST_PASSWORD} — run \`move\` from the Mac that holds the keys`);
  }
  const password = readFileSync(file, "utf8").trim();
  if (security(`unlock-keychain -p ${JSON.stringify(password)} ${JSON.stringify(KEYCHAIN)}`).status !== 0) {
    throw new Error(`release-keychain: could not unlock ${KEYCHAIN}`);
  }
}

/** The token's Copy button is used with the maintainer's explicit yes. The value stays
 * between the clipboard, this process and the login keychain, never a tool result. */
function cloudflare() {
  const token = execFileSync("pbpaste", [], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(token)) throw new Error("The clipboard does not hold a deploy token. Nothing was stored.");
  store("CLOUDFLARE_API_TOKEN", token);
  execFileSync("pbcopy", [], { input: "", stdio: ["pipe", "ignore", "ignore"] });
  console.log("The Proscenium Worker deploy token is in the login keychain; the clipboard is clear.");
}

/**
 * The key id inside a minisign signature or public key, as Tauri stores them:
 * base64 of the whole file, whose second line is base64 of
 * `<2 bytes algorithm><8 bytes key id><…>`.
 */
export function minisignKeyId(encodedFile, what) {
  const text = Buffer.from(encodedFile.trim(), "base64").toString("utf8");
  const line = text.split("\n").find((l) => l.trim() && !/^(un)?trusted comment/.test(l));
  if (!line) throw new Error(`${what} does not look like a minisign file`);
  return Buffer.from(line.trim(), "base64").subarray(2, 10).toString("hex");
}

/** Every valid Developer ID Application identity in the keychains. Public names, not keys. */
export function developerIds() {
  unlock();
  const out = execFileSync("security", ["find-identity", "-v", "-p", "codesigning", ...(KEYCHAIN ? [KEYCHAIN] : [])], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((line) => line.match(DEVELOPER_ID))
    .filter(Boolean)
    .map((m) => ({ sha1: m[1], identity: m[2], name: m[3], team: m[4] }));
}

/**
 * What a provisioning profile authorises, from its signed plist. The profile
 * is not secret, but nothing of it is printed beyond identifiers and a date.
 * `certificates` are the SHA-1 fingerprints of the certificates it names, as
 * `security find-identity` prints them: a profile made for an old certificate
 * does not authorise a build signed with a new one.
 */
export function readProfile(path) {
  const dir = mkdtempSync(join(tmpdir(), "proscenium-profile-"));
  const plist = join(dir, "profile.plist");
  try {
    execFileSync("security", ["cms", "-D", "-i", path, "-o", plist], { stdio: "ignore" });
    const get = (key) => {
      try {
        return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plist], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        return null;
      }
    };
    const certificates = [];
    for (let i = 0; i < 20; i++) {
      const der = get(`DeveloperCertificates.${i}`);
      if (!der) break;
      certificates.push(createHash("sha1").update(Buffer.from(der, "base64")).digest("hex").toUpperCase());
    }
    return {
      certificates,
      entitlements: JSON.parse(execFileSync("plutil", ["-extract", "Entitlements", "json", "-o", "-", plist], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      })),
      appId: get("Entitlements.com\\.apple\\.application-identifier"),
      team: get("Entitlements.com\\.apple\\.developer\\.team-identifier"),
      expires: get("ExpirationDate"),
      allDevices: get("ProvisionsAllDevices") === "true",
      name: get("Name"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function identifier() {
  return JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8")).identifier;
}

/** The one file matching `test` in ~/Downloads, or a clear refusal. */
function downloaded(test, what) {
  const downloads = join(homedir(), "Downloads");
  const found = readdirSync(downloads)
    .filter(test)
    .map((f) => join(downloads, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (found.length === 0) throw new Error(`release-keychain: no ${what} in ~/Downloads`);
  if (found.length > 1) {
    throw new Error(`release-keychain: ${found.length} files that look like ${what} in ~/Downloads — leave only the new one`);
  }
  return found[0];
}

/** A line of text from the maintainer, typed into a dialog that hides it. */
function ask(prompt) {
  const script = `text returned of (display dialog ${JSON.stringify(prompt)} default answer "" with hidden answer with title "Proscenium release setup" buttons {"Cancel", "Save"} default button "Save")`;
  const result = spawnSync("osascript", ["-e", script], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
  if (result.status !== 0) throw new Error("release-keychain: the dialog was cancelled");
  return result.stdout.trim();
}

function moveForSafekeeping(file) {
  mkdirSync(FOR_ARCHIVE, { recursive: true, mode: 0o700 });
  const to = join(FOR_ARCHIVE, basename(file));
  renameSync(file, to);
  return to;
}

function notary() {
  const p8 = downloaded((f) => /^AuthKey_[A-Z0-9]{10}\.p8$/.test(f), "App Store Connect API key (AuthKey_….p8)");
  const keyId = basename(p8).slice("AuthKey_".length, -".p8".length);
  const issuer = ask(
    "Paste the Issuer ID.\n\nIt is shown above the list of keys in App Store Connect → Users and Access → Integrations → App Store Connect API.",
  );
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuer)) {
    throw new Error("release-keychain: that is not an Issuer ID (it looks like 69a6de70-…-…, 36 characters). Nothing was stored.");
  }
  // Ask Apple before storing anything: a key that cannot list its own
  // submissions cannot notarize either.
  const check = spawnSync(
    "xcrun",
    ["notarytool", "history", "--key", p8, "--key-id", keyId, "--issuer", issuer, "--output-format", "json"],
    { stdio: "ignore" },
  );
  if (check.status !== 0) {
    throw new Error(
      "release-keychain: Apple refused that key and Issuer ID (notarytool history failed). Check the key is a Team key with Developer access. Nothing was stored.",
    );
  }
  store("APPLE_API_KEY", keyId, { replace: true });
  store("APPLE_API_ISSUER", issuer, { replace: true });
  store("APPLE_API_KEY_P8", readFileSync(p8), { replace: true });
  const kept = moveForSafekeeping(p8);
  console.log(
    [
      "release-keychain: the notarization key works, and is in the login keychain.",
      `  The .p8 file is now in ${dirname(kept)}.`,
      "  Apple will never offer it again: run `node scripts/keys-archive.mjs` to seal it into the Drive archive,",
      "  then that folder can go to the Trash.",
    ].join("\n"),
  );
}

function profile() {
  const file = downloaded((f) => f.endsWith(".provisionprofile"), "provisioning profile (.provisionprofile)");
  const info = readProfile(file);
  const want = identifier();
  if (!info.appId?.endsWith(`.${want}`)) {
    throw new Error(`release-keychain: that profile is for ${info.appId ?? "no app"}, not ${want}`);
  }
  if (!info.allDevices) {
    throw new Error("release-keychain: that is not a Developer ID profile (it names devices) — make a Developer ID one");
  }
  // Not secret, and made again from the developer website whenever needed,
  // so it is filed rather than archived.
  mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 });
  renameSync(file, PROFILE);
  console.log(`release-keychain: profile "${info.name}" for ${info.appId}, until ${info.expires}\n  filed at ${PROFILE}`);
}

/** Why Apple accepted or rejected a submission: the log names each file and problem. */
function notaryLog(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? "")) {
    throw new Error("usage: node scripts/release-keychain.mjs log <submission id from the release output>");
  }
  const keyId = load("APPLE_API_KEY")?.toString();
  const issuer = load("APPLE_API_ISSUER")?.toString();
  const p8 = load("APPLE_API_KEY_P8");
  if (!keyId || !issuer || !p8) throw new Error("release-keychain: no notarization key in the keychain (run notary first)");
  const dir = mkdtempSync(join(tmpdir(), "proscenium-notary-"));
  try {
    const key = join(dir, `AuthKey_${keyId}.p8`);
    writeFileSync(key, p8, { mode: 0o600 });
    const result = spawnSync("xcrun", ["notarytool", "log", id, "--key", key, "--key-id", keyId, "--issuer", issuer], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (result.status !== 0) throw new Error(`release-keychain: notarytool log failed (exit ${result.status})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- moving the material to the build host -----------------------------------

/**
 * Give the build host its own copy of everything a release is signed with.
 *
 * Signing has to happen where the gates and the native self-test already run,
 * and over SSH a login keychain is locked by a password nobody is there to
 * type. So the host gets a keychain of its own, opened by a password in a
 * 0600 file in its home — the same class of secret as everything else that
 * account keeps, and the honest cost of signing on a machine nobody sits at.
 * This Mac keeps its copies: losing the host never loses the ability to sign.
 *
 * Nothing is printed, and nothing reaches a process list on either Mac. The
 * certificate goes over the wire wrapped in a passphrase this function makes
 * and throws away, which exists only to satisfy PKCS#12 between one `security
 * export` and one `security import`; both read it from stdin or a file. The
 * temporary files on the host are removed whether or not the import worked.
 */
function move() {
  if (KEYCHAIN) throw new Error("release-keychain: `move` runs on the Mac that holds the originals, not on the build host");
  const host = opt("--host") ?? DEFAULT_HOST;
  if (!host) throw new Error("release-keychain: `move` needs the build host, as --host user@host or PROSCENIUM_BUILD_HOST");

  // `security export -t identities` takes EVERY identity in the keychain.
  // With a second one present it would travel too, silently, and nothing
  // downstream would say so — so refuse rather than guess which was meant.
  const ids = developerIds();
  if (ids.length !== 1) {
    throw new Error(
      ids.length === 0
        ? "release-keychain: no Developer ID Application identity to move (docs/engineering/release-engineering.md#SHIP-D2)"
        : `release-keychain: this keychain holds ${ids.length} identities; move exports all of them. Narrow it first.`,
    );
  }
  const missing = Object.keys(ITEMS).filter((name) => !has(name));
  if (missing.length) throw new Error(`release-keychain: nothing to move for ${missing.join(", ")} — this Mac does not have them`);
  if (!existsSync(PROFILE)) throw new Error(`release-keychain: no provisioning profile at ${PROFILE}`);

  console.log(`release-keychain: moving to ${host}`);
  console.log(`  identity  ${ids[0].identity}`);

  const dir = remote(host, SETUP, { capture: true }).trim();
  if (!dir.startsWith("/")) throw new Error(`release-keychain: the build host did not open a working directory (${dir || "no answer"})`);
  try {
    // The certificate and its private key. macOS asks the maintainer before letting the
    // key leave the keychain; that dialog is the only part of this they click.
    console.log("  exporting the certificate — click Allow on the dialog macOS shows");
    const passphrase = randomBytes(33).toString("base64url");
    const staging = mkdtempSync(join(tmpdir(), "proscenium-move-"));
    try {
      const p12 = join(staging, "id.p12");
      const exported = security(
        `export -k login.keychain-db -t identities -f pkcs12 -P ${JSON.stringify(passphrase)} -o ${JSON.stringify(p12)}`,
      );
      if (exported.status !== 0 || !existsSync(p12)) {
        throw new Error("release-keychain: the certificate could not be exported — was the dialog denied?");
      }
      send(host, join(dir, "id.p12"), readFileSync(p12));
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
    send(host, join(dir, "id.pass"), passphrase);

    // Apple's intermediate, which Xcode installs and a host without Xcode has
    // never seen. Without it the certificate imports, the private key imports,
    // and NO VALID IDENTITY exists — which reads exactly like a key that never
    // arrived. Taken from this keychain rather than fetched, so what the host
    // trusts is provably the chain that issued this certificate.
    send(host, join(dir, "chain.pem"), chain(ids[0]));

    // The four keychain items, and the profile, which is not secret.
    for (const name of Object.keys(ITEMS)) send(host, join(dir, name), load(name));
    send(host, join(dir, "profile"), readFileSync(PROFILE));

    console.log(remote(host, install(dir), { capture: true }).trimEnd());
  } finally {
    remote(host, `rm -rf -- ${q(dir)}`);
  }
}

/** Shell-safe: ssh flattens its arguments into one string for the remote shell. */
const q = (value) => `'${String(value).replace(/'/g, "'\\\\''")}'`;

/** Make the keychain if it is not there, open it, and answer with a working directory. */
const SETUP = `set -eu
umask 077
mkdir -p "$HOME/.proscenium"
PW="$HOME/${HOST_PASSWORD}"
KC="$HOME/Library/Keychains/${HOST_KEYCHAIN}-db"
if [ ! -f "$PW" ]; then
  LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 44 > "$PW"
  chmod 600 "$PW"
fi
if [ ! -f "$KC" ]; then
  printf 'create-keychain -p "%s" ${HOST_KEYCHAIN}\\n' "$(cat "$PW")" | security -i
fi
printf 'unlock-keychain -p "%s" ${HOST_KEYCHAIN}\\n' "$(cat "$PW")" | security -i
# No -t: it must never re-lock behind a runner's back, mid-build.
security set-keychain-settings ${HOST_KEYCHAIN}
# Additive, and left in place. Adding and removing it per job would leave this
# account's search list broken by any job that died in the middle; an entry
# holding nothing but Proscenium's own items is the safer resting state.
if ! security list-keychains -d user | grep -q ${HOST_KEYCHAIN}; then
  security list-keychains -d user -s ${HOST_KEYCHAIN} $(security list-keychains -d user | sed 's/["[:space:]]//g' | tr '\\n' ' ')
fi
mktemp -d "\${TMPDIR:-/tmp}/proscenium-move-XXXXXX"
`;

/**
 * Import everything that was just sent, then say what is in place. The imports
 * tolerate an item that is already there, because a second `move` must be
 * harmless; what is not tolerated is the end state being wrong, which the
 * verification below fails on.
 */
function install(dir) {
  const names = Object.keys(ITEMS);
  return `set -eu
umask 077
DIR=${q(dir)}
PW="$HOME/${HOST_PASSWORD}"
printf 'unlock-keychain -p "%s" ${HOST_KEYCHAIN}\\n' "$(cat "$PW")" | security -i

security import "$DIR/chain.pem" -k ${HOST_KEYCHAIN} -f pemseq >/dev/null 2>&1 || true
# -T codesign and the partition list together are what stop macOS stopping a
# headless build to ask whether codesign may use the key.
printf 'import "%s" -k ${HOST_KEYCHAIN} -f pkcs12 -P "%s" -T /usr/bin/codesign -T /usr/bin/security\\n' \\
  "$DIR/id.p12" "$(cat "$DIR/id.pass")" | security -i >/dev/null 2>&1 || true
printf 'set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "%s" ${HOST_KEYCHAIN}\\n' "$(cat "$PW")" \\
  | security -i >/dev/null 2>&1 || true

${names
  .map(
    (name) => `printf 'add-generic-password -U -s "${SERVICE}" -a "${name}" -l "${SERVICE}: ${ITEMS[name]}" -w "%s" ${HOST_KEYCHAIN}\\n' \\
  "$(base64 < "$DIR/${name}" | tr -d '\\n')" | security -i`,
  )
  .join("\n")}

mkdir -p "$HOME/Library/Application Support/Proscenium Release"
cp "$DIR/profile" "$HOME/Library/Application Support/Proscenium Release/Proscenium_Developer_ID.provisionprofile"

echo "  on the build host:"
identity=$(security find-identity -v -p codesigning ${HOST_KEYCHAIN} | sed -n 's/^ *1) [0-9A-F]* "\\(.*\\)"$/\\1/p')
if [ -z "$identity" ]; then
  echo "    NO VALID IDENTITY — the certificate is there but nothing can sign with it" >&2
  security find-identity ${HOST_KEYCHAIN} >&2
  exit 1
fi
echo "    identity  $identity"

# The only proof that matters: the identity, its chain and the partition list
# all have to be right for an unattended codesign to succeed and for what it
# produces to chain to Apple.
cp /bin/echo "$DIR/probe"
codesign --force --timestamp=none --keychain ${HOST_KEYCHAIN} -s "$identity" "$DIR/probe" 2>/dev/null
codesign -dvvv "$DIR/probe" 2>&1 | sed -n 's/^Authority=/    chain     /p'
if ! codesign -dvvv "$DIR/probe" 2>&1 | grep -q "^Authority=Apple Root CA$"; then
  echo "    the test signature does not chain to Apple Root CA" >&2
  exit 1
fi
${names.map((name) => `printf 'find-generic-password -s "${SERVICE}" -a "${name}" ${HOST_KEYCHAIN}\\n' | security -i >/dev/null 2>&1 \\
  && echo "    present   ${name}" || echo "    MISSING   ${name}"`).join("\n")}
`;
}

/**
 * The intermediate that issued this certificate, as PEM.
 *
 * Xcode installs Apple's Developer ID G2 intermediate on a Mac that has Xcode;
 * a build host that does not have Xcode has never seen it, and macOS fetches
 * it silently the first time it evaluates a chain. Without it the certificate
 * imports, the private key imports, and `find-identity -v` reports nothing —
 * a state that reads exactly like a key that never arrived.
 *
 * The address comes out of the certificate itself rather than being written
 * down here, and what comes back is trusted for one reason only: it verifies
 * the signature on the certificate already in this keychain. Not because of
 * the host it came from, and not because of its name.
 */
function chain(identity) {
  const dir = mkdtempSync(join(tmpdir(), "proscenium-chain-"));
  try {
    const leaf = join(dir, "leaf.pem");
    writeFileSync(leaf, execFileSync("security", ["find-certificate", "-c", identity.identity, "-p"], { encoding: "utf8" }));
    const url = execFileSync("openssl", ["x509", "-in", leaf, "-noout", "-text"], { encoding: "utf8" })
      .match(/CA Issuers - URI:(\S+)/)?.[1];
    if (!url) throw new Error("release-keychain: the certificate names no issuer to fetch");
    const host = new URL(url).hostname;
    if (host !== "certs.apple.com") {
      throw new Error(`release-keychain: the certificate points its issuer at ${host}, which is not Apple`);
    }
    const der = join(dir, "ca.der");
    const pem = join(dir, "ca.pem");
    const roots = join(dir, "roots.pem");
    execFileSync("curl", ["-fsS", "--max-time", "30", "-o", der, url]);
    execFileSync("openssl", ["x509", "-inform", "DER", "-in", der, "-out", pem]);

    // `openssl verify` cannot judge the leaf: an Apple code-signing
    // certificate carries a critical Apple extension that generic OpenSSL
    // refuses to parse (error 34). So the fetched certificate is checked two
    // ways that OpenSSL can judge, and the decisive proof is on the host —
    // a real signature that has to chain to Apple Root CA or `move` fails.
    writeFileSync(
      roots,
      execFileSync("security", ["find-certificate", "-a", "-c", "Apple Root CA", "-p", SYSTEM_ROOTS], { encoding: "utf8" }),
    );
    try {
      execFileSync("openssl", ["verify", "-CAfile", roots, pem], { stdio: "ignore" });
    } catch {
      throw new Error(`release-keychain: what ${url} served is not issued by Apple Root CA — nothing was sent`);
    }
    const id = (file, field) =>
      execFileSync("openssl", ["x509", "-in", file, "-noout", "-text"], { encoding: "utf8" })
        .split("\n")
        .reduce((found, line, i, all) => found ?? (line.includes(field) ? all[i + 1]?.replace(/[\s]|keyid:/g, "") : null), null);
    if (!id(leaf, "Authority Key Identifier") || id(leaf, "Authority Key Identifier") !== id(pem, "Subject Key Identifier")) {
      throw new Error(`release-keychain: what ${url} served did not issue this certificate — nothing was sent`);
    }
    return readFileSync(pem);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A script on the host's stdin, so nothing of it reaches a command line. */
function remote(host, script, { capture = false } = {}) {
  const result = spawnSync("ssh", [host, "bash -s"], {
    input: script,
    stdio: ["pipe", capture ? "pipe" : "inherit", "inherit"],
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`release-keychain: the build host refused (ssh exited ${result.status})`);
  return capture ? result.stdout : "";
}

/**
 * Bytes into a file on the host. The value travels as the connection's own
 * data, so it is a shell word nowhere and a process-list entry nowhere; the
 * path is the only thing named on a command line, and a path is not a secret.
 */
function send(host, path, bytes) {
  const write = spawnSync("ssh", [host, `umask 077 && cat > ${q(path)}`], {
    input: Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes)),
    stdio: ["pipe", "ignore", "inherit"],
  });
  if (write.status !== 0) throw new Error(`release-keychain: could not write ${path} on the build host`);
}

/**
 * The certificate inside a PKCS#12 file, as PEM, or null if it cannot be read.
 *
 * macOS writes PKCS#12 with the legacy algorithms (RC2 and 3DES, a SHA-1 MAC),
 * and OpenSSL 3 refuses those unless told `-legacy`. The obvious fix — re-wrap
 * it in OpenSSL's modern defaults — breaks the other side: `security import`,
 * which tauri's bundler uses to put the certificate into a keychain, refuses
 * a modern OpenSSL PKCS#12 (-26276, seen on macOS 26). So the file stays in the
 * format macOS writes, and the reader tries both.
 */
export function p12Leaf(p12, password) {
  for (const extra of [[], ["-legacy"]]) {
    const read = spawnSync("openssl", ["pkcs12", ...extra, "-in", p12, "-clcerts", "-nokeys", "-passin", "stdin"], {
      input: `${password}\n`,
      stdio: ["pipe", "pipe", "ignore"],
    });
    if (read.status === 0 && read.stdout.length) return read.stdout;
  }
  return null;
}

// --- the redundant copy in GitHub -------------------------------------------

/** The private repository the pipeline runs in. */
const REPOSITORY = "proscenium-app/backstage";

/**
 * Put the release's signing material into the repository's Actions secrets,
 * under the names release.mjs reads in CI (docs/engineering/release-engineering.md#SHIP-D112).
 *
 * No runner uses them: the build host signs from its own keychain. They are
 * the copy that survives losing both Macs AND the Drive archive's passphrase,
 * and the one that lets a signed build be made from any Mac that can reach
 * GitHub, which makes them worth having only if they would actually work.
 * So the certificate is checked the way release.mjs checks it in CI, by
 * reading its leaf back out with openssl, before anything is uploaded.
 *
 * `gh secret set` reads each value from stdin and encrypts it on this Mac with
 * the repository's public key before it leaves. Nothing reaches a clipboard —
 * which Universal Clipboard would sync to every device on the Apple Account —
 * a screen, or a process list.
 */
function secrets() {
  if (KEYCHAIN) throw new Error("release-keychain: `secrets` runs on the Mac that holds the originals");
  if (spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status !== 0) throw new Error("release-keychain: gh is not signed in");
  const ids = developerIds();
  if (ids.length !== 1) throw new Error(`release-keychain: expected one Developer ID identity, found ${ids.length}`);
  const missing = ["APPLE_API_KEY", "APPLE_API_ISSUER", "APPLE_API_KEY_P8", "TAURI_SIGNING_PRIVATE_KEY"].filter((n) => !has(n));
  if (missing.length) throw new Error(`release-keychain: this keychain has no ${missing.join(", ")}`);
  if (!existsSync(PROFILE)) throw new Error(`release-keychain: no provisioning profile at ${PROFILE}`);

  const dir = mkdtempSync(join(tmpdir(), "proscenium-secrets-"));
  try {
    console.log("release-keychain: exporting the certificate — click Allow on the dialog macOS shows");
    const password = randomBytes(33).toString("base64url");
    const p12 = join(dir, "id.p12");
    const exported = security(`export -k login.keychain-db -t identities -f pkcs12 -P ${JSON.stringify(password)} -o ${JSON.stringify(p12)}`);
    if (exported.status !== 0 || !existsSync(p12)) throw new Error("release-keychain: the certificate could not be exported — was the dialog denied?");

    // Exactly the read release.mjs makes of APPLE_CERTIFICATE in CI.
    const leaf = p12Leaf(p12, password);
    if (!leaf) throw new Error("release-keychain: openssl cannot read the exported certificate, so CI could not either. Nothing was uploaded.");
    const sha1 = createHash("sha1").update(new X509Certificate(leaf).raw).digest("hex").toUpperCase();
    if (sha1 !== ids[0].sha1) throw new Error("release-keychain: the exported certificate is not the one in the keychain. Nothing was uploaded.");

    const values = {
      APPLE_CERTIFICATE: readFileSync(p12).toString("base64"),
      APPLE_CERTIFICATE_PASSWORD: password,
      APPLE_API_KEY: load("APPLE_API_KEY").toString(),
      APPLE_API_ISSUER: load("APPLE_API_ISSUER").toString(),
      APPLE_API_KEY_P8: load("APPLE_API_KEY_P8").toString(),
      APPLE_PROVISIONING_PROFILE: readFileSync(PROFILE).toString("base64"),
      TAURI_SIGNING_PRIVATE_KEY: load("TAURI_SIGNING_PRIVATE_KEY").toString(),
    };
    for (const [name, value] of Object.entries(values)) {
      const set = spawnSync("gh", ["secret", "set", name, "--repo", REPOSITORY], { input: value, stdio: ["pipe", "ignore", "ignore"] });
      if (set.status !== 0) throw new Error(`release-keychain: GitHub refused ${name} (gh exited ${set.status})`);
      console.log(`  secret    ${name}`);
    }
    // A public name, printed by `status` itself: a variable, not a secret.
    const variable = spawnSync("gh", ["variable", "set", "APPLE_SIGNING_IDENTITY", "--repo", REPOSITORY, "--body", ids[0].identity], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    if (variable.status !== 0) throw new Error("release-keychain: GitHub refused the APPLE_SIGNING_IDENTITY variable");
    console.log(`  variable  APPLE_SIGNING_IDENTITY = ${ids[0].identity}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Ask Apple whether the stored notarization key still works. A key that cannot
 * list its own submissions cannot notarize either, and finding that out here
 * costs seconds — finding it out in a release costs the build that preceded it.
 */
function askApple() {
  const keyId = load("APPLE_API_KEY")?.toString();
  const issuer = load("APPLE_API_ISSUER")?.toString();
  const p8 = load("APPLE_API_KEY_P8");
  if (!keyId || !issuer || !p8) return "no notarization key stored";
  const dir = mkdtempSync(join(tmpdir(), "proscenium-notary-"));
  try {
    const key = join(dir, `AuthKey_${keyId}.p8`);
    writeFileSync(key, p8, { mode: 0o600 });
    const asked = spawnSync(
      "xcrun",
      ["notarytool", "history", "--key", key, "--key-id", keyId, "--issuer", issuer, "--output-format", "json"],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    return asked.status === 0 ? "Apple accepts this notarization key" : "APPLE REFUSED this notarization key";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function status() {
  const lines = [];
  const ids = developerIds();
  lines.push(
    ids.length
      ? `certificate   ${ids.map((i) => i.identity).join("; ")}`
      : "certificate   MISSING — no Developer ID Application identity in the keychains (docs/engineering/release-engineering.md#SHIP-D2)",
  );
  for (const [name, what] of Object.entries(ITEMS)) {
    lines.push(`${has(name) ? "present " : "MISSING "} ${name.padEnd(26)} ${what}`);
  }
  if (existsSync(PROFILE)) {
    const info = readProfile(PROFILE);
    lines.push(`profile       ${info.name} · ${info.appId} · until ${info.expires}`);
  } else {
    lines.push(`profile       MISSING — ${PROFILE}`);
  }
  if (args.includes("--apple")) lines.push(`notarization  ${askApple()}`);
  console.log(lines.join("\n"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === "notary") notary();
    else if (command === "profile") profile();
    else if (command === "cloudflare") cloudflare();
    else if (command === "move") move();
    else if (command === "secrets") secrets();
    else if (command === "status") status();
    else if (command === "log") notaryLog(process.argv[3]);
    else {
      console.error(
        "usage: node scripts/release-keychain.mjs status | notary | profile | cloudflare | move [--host <ssh host>] | secrets | log <submission id>",
      );
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
