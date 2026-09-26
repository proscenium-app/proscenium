// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Alpha's key: the one thing a copy needs for the Worker to answer it on the
 * alpha track, which is otherwise an unknown track's bare 404.
 *
 *   node scripts/track-key.mjs status   whether this Mac's settings.json holds a key, and
 *                                       whether Proscenium or a call is running; never the key
 *   node scripts/track-key.mjs issue    ONLY on the maintainer's yes: make a new key, file its
 *                                       SHA-256 as the Worker secret ALPHA_KEY_SHA256, and
 *                                       write the key into this Mac's settings.json
 *
 * The key is made, hashed and written inside this one process. It is never
 * printed, never an argument and never on a clipboard: its hash reaches
 * Wrangler on stdin through scripts/edge-wrangler.mjs, as the Sentry DSN did,
 * and the key itself goes only into settings.json (`updateTrackKey`,
 * docs/app/preferences-and-help/settings.md#SET-37). So there is no copy to
 * archive: a lost key is replaced by issuing another, which retires the old
 * one at once.
 *
 * settings.json is written only while Proscenium is not running, because the
 * app reads and rewrites that file, and never while a call is live. A new key
 * with the old one still in a copy means that copy's alpha checks are refused
 * until it holds the new one, so issue stops before filing anything when it
 * cannot write the file.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** settings.rs's name for it, and its shape: 32 random bytes, base64url, unpadded. */
export const SETTINGS_KEY = "updateTrackKey";
export const KEY_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const SECRET = "ALPHA_KEY_SHA256";
const SETTINGS = join(homedir(), "Library/Application Support/org.habiby.proscenium/settings.json");
const USAGE = "usage: node scripts/track-key.mjs status | issue";

export function mintKey() {
  const key = randomBytes(32).toString("base64url");
  if (!KEY_SHAPE.test(key))
    throw new Error("A new key came out the wrong shape. Nothing was filed.");
  return key;
}

/** What the Worker holds: the key's SHA-256, as lowercase hex (services/edge/src/updates.ts). */
export function keyHash(key) {
  return createHash("sha256").update(key).digest("hex");
}

/** The settings object at `path`. A file that is not one JSON object is refused, never replaced. */
export function readSettings(path) {
  let value;
  // Not JSON.parse's own message: it quotes the text, which may hold a key.
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${path} could not be read as JSON. Nothing was written.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} is not a settings object. Nothing was written.`);
  return value;
}

/** Whether `path` holds a key of the right shape: all `status` says of it. */
export function holdsKey(path) {
  return KEY_SHAPE.test(readSettings(path)[SETTINGS_KEY] ?? "");
}

/**
 * Put `key` into the settings at `path`, every other key as it was: a temp
 * file beside it with the same mode, flushed, then renamed over it, as
 * settings.rs writes it.
 */
export function writeKey(path, key) {
  if (!KEY_SHAPE.test(key)) throw new Error("That is not a key. Nothing was written.");
  const settings = readSettings(path);
  settings[SETTINGS_KEY] = key;
  const temp = join(dirname(path), `.settings.json.${process.pid}.tmp`);
  const fd = openSync(temp, "wx", statSync(path).mode & 0o777);
  try {
    writeSync(fd, JSON.stringify(settings, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
}

function running(name) {
  // pgrep exits 1 when nothing matches.
  return spawnSync("pgrep", ["-ix", name], { encoding: "utf8" }).status === 0;
}

/** Why settings.json may not be written now, or null. */
function busy() {
  if (running("proscenium"))
    return "Proscenium is running. Quit it first: it reads and rewrites settings.json.";
  if (running("CptHost")) return "A call is live. Wait until it ends.";
  return null;
}

function status() {
  console.log(
    holdsKey(SETTINGS) ? "settings.json holds an alpha key." : "settings.json holds no alpha key.",
  );
  console.log(busy() ?? "Proscenium is not running and no call is live: a key can be written.");
}

function issue() {
  holdsKey(SETTINGS); // the file reads as settings, or nothing goes further
  const before = busy();
  if (before) throw new Error(`${before} Nothing was filed.`);
  const key = mintKey();
  const filed = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./edge-wrangler.mjs", import.meta.url)), "secret", SECRET],
    {
      input: keyHash(key),
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (filed.status !== 0)
    throw new Error(`The Worker secret ${SECRET} was not filed. settings.json is unchanged.`);
  const after = busy();
  if (after)
    throw new Error(
      `${after} The Worker holds the new key's hash but settings.json does not hold the key: issue again once it is clear.`,
    );
  writeKey(SETTINGS, key);
  console.log(
    `A new alpha key is in settings.json, and its hash is the Worker's ${SECRET}. Neither was displayed; the last key no longer works.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    if (process.platform !== "darwin") throw new Error("This writes a Mac's Proscenium settings.");
    if (command === "status" && rest.length === 0) status();
    else if (command === "issue" && rest.length === 0) issue();
    else throw new Error(USAGE);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The track key command failed.");
    process.exitCode = 1;
  }
}
