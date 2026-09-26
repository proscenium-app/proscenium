// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One version everywhere (docs/engineering/release-engineering.md#REL-D8).
 *
 *   bun run version 0.9.0    set it in every file that states it, and turn the
 *                            changelog's Unreleased section into 0.9.0's
 *   bun run check:version    fail if any two files disagree (CI runs this)
 *   node scripts/version.mjs notes 0.9.0
 *                            that version's CHANGELOG section, for the release draft
 *   node scripts/version.mjs next
 *                            the version the Unreleased section will become: the
 *                            patch raised by one, or the version its heading names
 *                            (`## [Unreleased] 1.0.0`). An alpha or beta is a
 *                            pre-release of it, so the release supersedes it
 *
 * The app's version is written in more places than anyone remembers to edit:
 * the frontend's package.json, the crate, the Tauri config (which is what the
 * About box and the updater compare), Cargo.lock (which a `--locked` build
 * refuses to rewrite), and the iPad project Tauri generated. The play file's
 * `generator` stamp reads package.json at build time, so it follows. A version
 * that differs between the updater's manifest and the binary is an update that
 * installs forever, so a mismatch fails the build rather than a release.
 *
 * Numbers are plain x.y.z: CFBundleShortVersionString is three integers, and
 * macOS rejects a bundle that says otherwise. Release candidates are 0.9.x.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every file that states the version: how to read it and how to rewrite it.
 * Each pattern captures (before)(version)(after) so a rewrite touches the
 * number and nothing else — no reformatting of files other tools also write.
 */
const PLACES = [
  { file: "package.json", pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: "src-tauri/tauri.conf.json", pattern: /^(\s*"version":\s*")([^"]+)(")/m },
  { file: "src-tauri/Cargo.toml", pattern: /(\[package\][^[]*?\nversion\s*=\s*")([^"]+)(")/ },
  { file: "src-tauri/Cargo.lock", pattern: /(\[\[package\]\]\nname = "proscenium"\nversion = ")([^"]+)(")/ },
  { file: "src-tauri/gen/apple/project.yml", pattern: /(CFBundleShortVersionString:\s*)([^\s]+)()/ },
  { file: "src-tauri/gen/apple/project.yml", pattern: /(CFBundleVersion:\s*")([^"]+)(")/ },
  {
    file: "src-tauri/gen/apple/proscenium_iOS/Info.plist",
    pattern: /(<key>CFBundleShortVersionString<\/key>\s*<string>)([^<]+)(<\/string>)/,
  },
  {
    file: "src-tauri/gen/apple/proscenium_iOS/Info.plist",
    pattern: /(<key>CFBundleVersion<\/key>\s*<string>)([^<]+)(<\/string>)/,
  },
];

const read = (file) => readFileSync(resolve(ROOT, file), "utf8");

function current() {
  return PLACES.map(({ file, pattern }) => {
    const m = read(file).match(pattern);
    if (!m) throw new Error(`version: cannot find the version in ${file} (pattern ${pattern})`);
    return { file, version: m[2] };
  });
}

function check() {
  const found = current();
  const versions = new Set(found.map((f) => f.version));
  if (versions.size !== 1) {
    console.error("version check: the files disagree —");
    for (const f of found) console.error(`  ${f.version.padEnd(10)} ${f.file}`);
    console.error("  Run `bun run version <x.y.z>` to set them together.");
    process.exit(1);
  }
  const [version] = versions;
  // A heading `next` cannot read would stop the next alpha, so the gate reads it now.
  const upcoming = nextVersion(readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8"), version);
  console.log(`version check: clean (${version} in ${new Set(found.map((f) => f.file)).size} files; next ${upcoming})`);
}

/** Keep a Changelog: Unreleased becomes the release, and a fresh Unreleased opens. */
function cutChangelog(version) {
  const file = resolve(ROOT, "CHANGELOG.md");
  const text = readFileSync(file, "utf8");
  if (new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m").test(text)) {
    console.log(`version: CHANGELOG.md already has a ${version} section — left as it is`);
    return;
  }
  if (!/^## \[Unreleased\]/m.test(text)) {
    throw new Error("version: CHANGELOG.md has no `## [Unreleased]` section to release");
  }
  const date = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local time
  // The heading may have named this version; the fresh Unreleased names none.
  writeFileSync(file, text.replace(/^## \[Unreleased\].*$/m, `## [Unreleased]\n\n## [${version}] - ${date}`));
  console.log(`version: CHANGELOG.md — Unreleased is now ${version} (${date})`);
}

function set(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`version: "${version}" is not x.y.z — macOS reads CFBundleShortVersionString as three integers`);
    process.exit(1);
  }
  const edits = new Map();
  for (const { file, pattern } of PLACES) {
    const text = edits.get(file) ?? read(file);
    if (!pattern.test(text)) throw new Error(`version: cannot find the version in ${file}`);
    edits.set(file, text.replace(pattern, (_, before, _old, after) => `${before}${version}${after}`));
  }
  for (const [file, text] of edits) writeFileSync(resolve(ROOT, file), text);
  console.log(`version: ${version} → ${[...edits.keys()].join(", ")}`);
  cutChangelog(version);
  check();
}

/**
 * One version's release notes, for the GitHub release draft. Fails on a
 * version with no section or an empty one: a release nobody described is a
 * release nobody checked.
 */
function notes(version) {
  const text = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
  const start = text.search(new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m"));
  if (start < 0) {
    console.error(`version: CHANGELOG.md has no section for ${version}`);
    process.exit(1);
  }
  const rest = text.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^## \[/m);
  const body = (end < 0 ? rest : rest.slice(0, end)).replace(/^\[[^\]]+\]: .*$/gm, "").trim();
  if (!body) {
    console.error(`version: the ${version} section of CHANGELOG.md is empty`);
    process.exit(1);
  }
  process.stdout.write(`${body}\n`);
}

const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Whether release `a` is newer than release `b`, both x.y.z. */
function newer(a, b) {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * The version Unreleased becomes, so
 * a track's `X.Y.Z` is newer than the last release and never newer than the
 * next, which supersedes its own pre-releases.
 */
function nextVersion(changelog, current) {
  const heading = changelog.match(/^## \[Unreleased\](.*)$/m);
  if (!heading) throw new Error("version: CHANGELOG.md has no `## [Unreleased]` section");
  const named = heading[1].trim();
  if (!named) {
    const [major, minor, patch] = current.split(".").map(Number);
    return `${major}.${minor}.${patch + 1}`;
  }
  if (!RELEASE.test(named)) throw new Error(`version: the Unreleased heading names "${named}", which is not x.y.z`);
  if (!newer(named, current)) throw new Error(`version: the Unreleased heading names ${named}, which is not newer than ${current}`);
  return named;
}

function next() {
  const [{ version }] = current();
  process.stdout.write(`${nextVersion(readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8"), version)}\n`);
}

const arg = process.argv[2];
if (!arg || arg === "--check") check();
else if (arg === "notes") notes(process.argv[3] ?? "");
else if (arg === "next") next();
else set(arg);
