// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Make the updater's signing key, once, with the maintainer at the keyboard
 * (docs/engineering/release-engineering.md#REL-D6, docs/engineering/release-engineering.md#SHIP-D100 "The updater key").
 *
 *   node scripts/updater-keygen.mjs
 *   node scripts/updater-keygen.mjs --restore <proscenium-updater.key>
 *       put a backed-up private key back into the keychain, after proving it
 *       is the key this app's installed copies trust
 *
 * Every update Proscenium installs is checked against the public half of this
 * key, which ships inside the app. The private half signs each release. It
 * cannot be recovered, and every installed copy trusts only it: lose it and
 * those copies can never be updated again. So:
 *
 *   - the private key goes into this Mac's login keychain, where
 *     scripts/release.mjs signs with it, and into a file on the Desktop, in a
 *     folder only this user can read, until scripts/keys-archive.mjs seals it
 *     into the encrypted archive in Drive. NOTHING of it is printed: the CLI's
 *     own output goes nowhere, because without an output file it prints the key;
 *   - the public key goes into tauri.conf.json and is printed, since it is
 *     meant to be public;
 *   - it refuses when tauri.conf.json already holds a public key, when the
 *     keychain already holds a private one, and when the file exists. A second
 *     key would strand every copy that trusts the first.
 *
 * There is no password: the key is the secret, kept in the keychains and the
 * Drive archive. The Desktop copy goes to the Trash once the archive is made.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FOR_ARCHIVE, has, load, minisignKeyId, store } from "./release-keychain.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONF = join(ROOT, "src-tauri/tauri.conf.json");
const KEY = join(FOR_ARCHIVE, "proscenium-updater.key");

if (process.argv[2] === "--restore") {
  restore(process.argv[3]);
  process.exit(0);
}

const text = readFileSync(CONF, "utf8");
const PLACEHOLDER = /("pubkey":\s*)""/;
if (JSON.parse(text).plugins?.updater?.pubkey) {
  console.error(
    "updater-keygen: tauri.conf.json already has an updater public key. Installed copies trust it,\n" +
      "                and a new key would strand them. Rotating a key is a release of its own — see docs/engineering/release-engineering.md#SHIP-D100.",
  );
  process.exit(1);
}
if (has("TAURI_SIGNING_PRIVATE_KEY")) {
  console.error(
    "updater-keygen: the login keychain already holds an updater private key (Proscenium release).\n" +
      "                Find out which public key it belongs to before making another.",
  );
  process.exit(1);
}
if (existsSync(KEY)) {
  console.error(`updater-keygen: ${KEY} already exists — refusing to overwrite a private key.`);
  process.exit(1);
}
// Checked before a key exists, so a key is never made that nothing trusts.
if (!PLACEHOLDER.test(text)) {
  console.error('updater-keygen: could not find `"pubkey": ""` in tauri.conf.json to fill in');
  process.exit(1);
}

mkdirSync(FOR_ARCHIVE, { recursive: true });
chmodSync(FOR_ARCHIVE, 0o700);
execFileSync(
  join(ROOT, "node_modules/.bin/tauri"),
  ["signer", "generate", "--ci", "--write-keys", KEY],
  {
    cwd: ROOT,
    // Never inherit: this CLI's output is the one place a key could reach a
    // terminal or a transcript.
    stdio: "ignore",
    env: { ...process.env, CI: "true" },
  },
);
chmodSync(KEY, 0o600);

const pubkey = readFileSync(`${KEY}.pub`, "utf8").trim();
if (!pubkey) {
  console.error("updater-keygen: no public key was written");
  process.exit(1);
}
writeFileSync(CONF, text.replace(PLACEHOLDER, `$1${JSON.stringify(pubkey)}`));
store("TAURI_SIGNING_PRIVATE_KEY", readFileSync(KEY));

console.log(
  [
    "updater-keygen: done.",
    "",
    "  Private key: in the login keychain (Proscenium release), where release builds sign with it, and in",
    `    ${KEY}`,
    "    1. Seal it into the Drive archive now: node scripts/keys-archive.mjs",
    "    2. Then the Desktop folder can go to the Trash.",
    "",
    "  Public key (not secret), now in tauri.conf.json → plugins.updater.pubkey:",
    `    ${pubkey}`,
    "",
    "  Commit tauri.conf.json. Every build from that commit on can verify updates.",
  ].join("\n"),
);

/**
 * Put a backed-up private key back into the keychain.
 *
 * The day this runs is the day a Mac was lost, and the one mistake that day
 * can make worse is restoring the WRONG key: it would sign updates that every
 * installed copy refuses, and nothing would say so until a writer's update
 * failed. So before the key goes anywhere it signs a probe, and the key id in
 * that signature must be the key id of the public key this app ships with —
 * the same check the release makes of every archive it signs.
 *
 * The key reaches the signer as a path in its environment, never as a
 * command-line argument, and nothing of it is printed.
 */
function restore(file) {
  if (!file || !existsSync(file)) {
    console.error("usage: node scripts/updater-keygen.mjs --restore <proscenium-updater.key>");
    process.exit(2);
  }
  const pubkey = JSON.parse(readFileSync(CONF, "utf8")).plugins?.updater?.pubkey;
  if (!pubkey) {
    console.error(
      "updater-keygen: tauri.conf.json has no updater public key to check a restored key against",
    );
    process.exit(1);
  }
  const bytes = readFileSync(file);
  const dir = mkdtempSync(join(tmpdir(), "proscenium-restore-"));
  try {
    const probe = join(dir, "probe");
    writeFileSync(probe, "proscenium: an updater key, restored\n");
    const env = {
      ...process.env,
      CI: "true",
      TAURI_SIGNING_PRIVATE_KEY_PATH: resolve(file),
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
    };
    delete env.TAURI_SIGNING_PRIVATE_KEY;
    const signed = spawnSync(join(ROOT, "node_modules/.bin/tauri"), ["signer", "sign", probe], {
      cwd: ROOT,
      stdio: "ignore",
      env,
    });
    if (signed.status !== 0 || !existsSync(`${probe}.sig`)) {
      console.error(
        "updater-keygen: that file could not sign anything — it is not a Tauri updater private key, or it is damaged",
      );
      process.exit(1);
    }
    const signedWith = minisignKeyId(readFileSync(`${probe}.sig`, "utf8"), "the probe's signature");
    const trusted = minisignKeyId(pubkey, "plugins.updater.pubkey");
    if (signedWith !== trusted) {
      console.error(
        `updater-keygen: that key is ${signedWith}, but this app trusts ${trusted}.\n` +
          "                Installed copies would refuse every update it signed. Nothing was stored.",
      );
      process.exit(1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (has("TAURI_SIGNING_PRIVATE_KEY")) {
    if (Buffer.compare(load("TAURI_SIGNING_PRIVATE_KEY"), bytes) === 0) {
      console.log(
        "updater-keygen: that is the key installed copies trust, and the keychain already holds it. Nothing changed.",
      );
      return;
    }
    console.error(
      "updater-keygen: the keychain already holds a DIFFERENT updater private key. Find out which one the\n" +
        "                releases were signed with before replacing anything. Nothing was stored.",
    );
    process.exit(1);
  }
  store("TAURI_SIGNING_PRIVATE_KEY", bytes);
  console.log(
    "updater-keygen: restored — it is the key installed copies trust, and it is in the keychain.",
  );
}
