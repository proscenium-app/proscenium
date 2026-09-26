// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The off-site copy of the two keys that cannot be made again
 * (docs/engineering/release-engineering.md#SHIP-D100).
 *
 *   node scripts/keys-archive.mjs            make the archive on the Desktop
 *   node scripts/keys-archive.mjs --verify <file>   prove an archive still opens
 *
 * **What is in it, and why only these two.** The updater private key signs
 * every update; lose it and no installed copy can ever be updated again, and
 * every writer has to download Proscenium by hand. The notarization `.p8`
 * Apple offers exactly once, at the moment it is created, and never again.
 * Everything else is replaceable: a certificate is made again in Xcode, a
 * profile is downloaded again, a Cloudflare token is revoked and reissued.
 * So the archive holds what cannot be remade, and nothing else — a smaller
 * archive is a smaller thing to lose control of.
 *
 * **It is built from the keychain, not from the Desktop folder,** so it keeps
 * working after that folder is thrown away, and so the copy it makes is
 * provably the copy the release actually signs with.
 *
 * **The passphrase is typed into a dialog and stored nowhere** — not in this
 * process's arguments, not in a file, not in a transcript. The maintainer makes it in
 * a password manager first and pastes it here, twice, so a truncated
 * paste cannot produce an archive that opens for nobody.
 *
 * **Why openssl rather than age or gpg.** The day this archive is needed is
 * the day a Mac is gone, and on that day the only tools that certainly exist
 * are the ones macOS ships. `openssl enc` is one of them; age and gpg both
 * have to be installed before they can rescue anything. The cost of that
 * choice is stated plainly: `openssl enc` authenticates nothing, so a damaged
 * or altered archive decrypts to rubbish rather than refusing. The SHA-256
 * printed when it is made, and kept in the plain-text note beside it in
 * Drive, is what turns that into a question anyone can answer.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "./release-keychain.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

/** AES-256 with a slow key derivation, so a weak passphrase still costs. */
const CIPHER = ["-aes-256-cbc", "-md", "sha512", "-pbkdf2", "-iter", "600000", "-salt"];

/** A line the maintainer types into a dialog that hides it; it reaches no other place. */
function ask(prompt) {
  const script = `text returned of (display dialog ${JSON.stringify(prompt)} default answer "" with hidden answer with title "Proscenium key archive" buttons {"Cancel", "Continue"} default button "Continue")`;
  const result = spawnSync("osascript", ["-e", script], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error("keys-archive: the dialog was cancelled — nothing was written");
  return result.stdout.replace(/\n$/, "");
}

function passphrase() {
  const first = ask(
    "Paste the passphrase for the key archive.\n\nMake it in your password manager first, so it is kept somewhere other than this Mac.",
  );
  if (first.length < 12)
    throw new Error("keys-archive: that passphrase is under 12 characters. Nothing was written.");
  if (
    ask("Paste it once more, so a short paste cannot make an archive nobody can open.") !== first
  ) {
    throw new Error("keys-archive: the two did not match. Nothing was written.");
  }
  return first;
}

/**
 * The passphrase goes down a pipe `openssl` is told to read — `-pass stdin`,
 * with stdin carrying nothing else — so it is never a command-line argument
 * that another account could read out of the process list. The file being
 * worked on is named by `-in`, so the two never mix.
 */
function crypt(mode, input, output, pass) {
  const result = spawnSync(
    "openssl",
    ["enc", mode, ...CIPHER, "-in", input, "-out", output, "-pass", "stdin"],
    {
      input: `${pass}\n`,
      stdio: ["pipe", "ignore", "pipe"],
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `keys-archive: openssl refused (${result.stderr?.toString().trim().split("\n")[0] ?? "no reason given"})`,
    );
  }
}

const RESTORE = `# Proscenium — the keys that cannot be made again

This archive holds the two secrets Proscenium cannot replace.

## proscenium-updater.key

Every Proscenium update is signed with this key, and every installed copy
refuses an update that is not. **If it is lost, no copy already on anyone's Mac
can ever be updated again** — every writer would have to download Proscenium by
hand, forever. It cannot be reissued; there is nobody to reissue it.

To put it back: \`node scripts/updater-keygen.mjs --restore proscenium-updater.key\`,
or store it by hand as the login-keychain item \`TAURI_SIGNING_PRIVATE_KEY\`
under the service "Proscenium release".

\`proscenium-updater.key.pub\` is its public half, the one compiled into the app.
It is not secret; it is here so the private key can be matched to the builds
that trust it.

## AuthKey_*.p8, with its Key ID and Issuer ID

Apple's notarization key. Apple offers the file exactly once, when it is
created, and never again. Without it nothing can be notarized, and macOS warns
about every copy of Proscenium a writer downloads.

It *can* be replaced: revoke it at appstoreconnect.apple.com and make another
(App Store Connect → Users and Access → Integrations → Team Keys). Replacing it
is an afternoon; the updater key above has no replacement at all.

## What is deliberately not here

The Developer ID certificate (make a new one in Xcode, then a new provisioning
profile), the provisioning profile (download it again), and the Cloudflare
token (revoke and reissue). A smaller archive is a smaller thing to lose
control of.
`;

function make() {
  const keyId = load("APPLE_API_KEY")?.toString();
  const issuer = load("APPLE_API_ISSUER")?.toString();
  const p8 = load("APPLE_API_KEY_P8");
  const updater = load("TAURI_SIGNING_PRIVATE_KEY");
  const missing = [
    ["the notarization Key ID", keyId],
    ["the notarization Issuer ID", issuer],
    ["the notarization key", p8],
    ["the updater private key", updater],
  ]
    .filter(([, v]) => !v)
    .map(([what]) => what);
  if (missing.length)
    throw new Error(`keys-archive: this keychain has no ${missing.join(", no ")}`);

  const pub =
    JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8")).plugins?.updater
      ?.pubkey ?? "";
  const pass = passphrase();

  const dir = mkdtempSync(join(tmpdir(), "proscenium-archive-"));
  const out = join(
    homedir(),
    "Desktop",
    `proscenium-keys-${new Date().toISOString().slice(0, 10)}.tar.enc`,
  );
  try {
    const stage = join(dir, "proscenium-keys");
    mkdirSync(stage, { mode: 0o700 });
    writeFileSync(join(stage, `AuthKey_${keyId}.p8`), p8, { mode: 0o600 });
    writeFileSync(join(stage, "notarization.txt"), `Key ID:    ${keyId}\nIssuer ID: ${issuer}\n`, {
      mode: 0o600,
    });
    writeFileSync(join(stage, "proscenium-updater.key"), updater, { mode: 0o600 });
    if (pub) writeFileSync(join(stage, "proscenium-updater.key.pub"), `${pub}\n`, { mode: 0o600 });
    writeFileSync(join(stage, "RESTORE.md"), RESTORE, { mode: 0o600 });

    const tar = join(dir, "keys.tar");
    execFileSync("tar", ["-cf", tar, "-C", dir, "proscenium-keys"]);
    crypt("-e", tar, out, pass);

    // An archive nobody has opened is a hope, not a backup.
    const back = join(dir, "roundtrip.tar");
    crypt("-d", out, back, pass);
    const listed = execFileSync("tar", ["-tf", back], { encoding: "utf8" })
      .trim()
      .split("\n").length;
    const original = execFileSync("tar", ["-tf", tar], { encoding: "utf8" })
      .trim()
      .split("\n").length;
    if (
      listed !== original ||
      createHash("sha256").update(readFileSync(back)).digest("hex") !==
        createHash("sha256").update(readFileSync(tar)).digest("hex")
    ) {
      rmSync(out, { force: true });
      throw new Error(
        "keys-archive: the archive did not decrypt back to what went in. Nothing was kept.",
      );
    }

    const sha = createHash("sha256").update(readFileSync(out)).digest("hex");
    console.log(
      [
        `keys-archive: ${out}`,
        `  ${readFileSync(out).length} bytes · sha256 ${sha}`,
        "  opened again with its own passphrase and checked byte for byte.",
        "",
        "  To open it on any Mac, with no tool installed:",
        `    openssl enc -d ${CIPHER.join(" ")} -in ${basename(out)} -pass stdin | tar -xf -`,
      ].join("\n"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function verify(file) {
  if (!file || !existsSync(file))
    throw new Error("usage: node scripts/keys-archive.mjs --verify <archive>");
  const pass = ask("Paste the archive's passphrase, to check it still opens.");
  const dir = mkdtempSync(join(tmpdir(), "proscenium-verify-"));
  try {
    const tar = join(dir, "out.tar");
    crypt("-d", file, tar, pass);
    const names = execFileSync("tar", ["-tf", tar], { encoding: "utf8" }).trim().split("\n");
    console.log(`keys-archive: ${basename(file)} opens. It holds:`);
    for (const n of names.filter((n) => !n.endsWith("/"))) console.log(`  ${n}`);
    console.log(`  sha256 ${createHash("sha256").update(readFileSync(file)).digest("hex")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (args[0] === "--verify") verify(args[1]);
    else make();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
