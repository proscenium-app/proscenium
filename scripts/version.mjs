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
 *   node scripts/version.mjs line 1.0.1
 *                            a release on its line: every file says 1.0.1, and
 *                            Unreleased's entries become 1.0.1's section with no
 *                            date, under a fresh Unreleased. The same change is
 *                            made where the line is cut and on main, so main's
 *                            next is 1.0.2 and the line's betas are 1.0.1's
 *   node scripts/version.mjs date 1.0.1 [--on 2026-10-14]
 *                            the release's one change on its line: its section's
 *                            date. What went out as a beta goes out as the release
 *   node scripts/version.mjs lineof
 *                            the release this checkout is the line of, or nothing
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
  {
    file: "src-tauri/Cargo.lock",
    pattern: /(\[\[package\]\]\nname = "proscenium"\nversion = ")([^"]+)(")/,
  },
  {
    file: "src-tauri/gen/apple/project.yml",
    pattern: /(CFBundleShortVersionString:\s*)([^\s]+)()/,
  },
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
  console.log(
    `version check: clean (${version} in ${new Set(found.map((f) => f.file)).size} files; next ${upcoming})`,
  );
}

const escaped = (version) => version.replace(/\./g, "\\.");

/**
 * A release on its line: Unreleased's entries become `version`'s section, with
 * no date because the release is not out, and a fresh Unreleased opens above.
 */
export function lineChangelog(text, version) {
  if (new RegExp(`^## \\[${escaped(version)}\\]`, "m").test(text))
    throw new Error(`version: CHANGELOG.md already has a ${version} section`);
  if (!/^## \[Unreleased\]/m.test(text))
    throw new Error("version: CHANGELOG.md has no `## [Unreleased]` section to put on a line");
  return text.replace(/^## \[Unreleased\].*$/m, `## [Unreleased]\n\n## [${version}]`);
}

/** The release's one change on its line: the date on its undated section. */
export function datedChangelog(text, version, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`version: ${date} is not YYYY-MM-DD`);
  const undated = new RegExp(`^## \\[${escaped(version)}\\][ \\t]*$`, "m");
  if (!undated.test(text))
    throw new Error(`version: CHANGELOG.md has no undated ${version} section to date`);
  return text.replace(undated, `## [${version}] - ${date}`);
}

/**
 * A fix carried to a line: what it added under Unreleased moves into the
 * line's own `version` section, each entry under its kind (`### Fixed`…),
 * so the release's notes hold it and Unreleased stays empty on the line.
 */
export function unreleasedInto(text, version) {
  const lines = text.split("\n");
  const at = (re, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l));
  const u = at(/^## \[Unreleased\]/);
  const v = at(new RegExp(`^## \\[${escaped(version)}\\]`));
  if (u < 0 || v < 0 || v < u) return text;
  const moved = lines.slice(u + 1, v).filter((l) => l.trim());
  if (!moved.length) return text;
  // Unreleased's entries, by kind.
  const kinds = new Map();
  let kind = "### Fixed";
  for (const l of moved) {
    if (/^### /.test(l)) kind = l.trim();
    else kinds.set(kind, [...(kinds.get(kind) ?? []), l]);
  }
  const end = at(/^## \[/, v + 1);
  const section = lines.slice(v + 1, end < 0 ? lines.length : end);
  for (const [k, entries] of kinds) {
    const h = section.findIndex((l) => l.trim() === k);
    if (h < 0) section.push("", k, "", ...entries);
    else {
      let i = h + 1;
      while (i < section.length && !/^### /.test(section[i])) i++;
      while (i > h + 1 && !section[i - 1].trim()) i--;
      section.splice(i, 0, ...entries);
    }
  }
  const tidy = section
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "\n")
    .split("\n");
  // The next section keeps its blank line above it.
  if (end >= 0 && tidy.at(-1) !== "") tidy.push("");
  return [
    ...lines.slice(0, u + 1),
    "",
    ...lines.slice(v, v + 1),
    ...tidy,
    ...(end < 0 ? [] : lines.slice(end)),
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** The release a checkout is the line of: its files' version, when its section has no date yet. */
export function lineVersion(text, version) {
  return new RegExp(`^## \\[${escaped(version)}\\][ \\t]*$`, "m").test(text) ? version : null;
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
  writeFileSync(
    file,
    text.replace(/^## \[Unreleased\].*$/m, `## [Unreleased]\n\n## [${version}] - ${date}`),
  );
  console.log(`version: CHANGELOG.md — Unreleased is now ${version} (${date})`);
}

function writeFiles(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(
      `version: "${version}" is not x.y.z — macOS reads CFBundleShortVersionString as three integers`,
    );
    process.exit(1);
  }
  const edits = new Map();
  for (const { file, pattern } of PLACES) {
    const text = edits.get(file) ?? read(file);
    if (!pattern.test(text)) throw new Error(`version: cannot find the version in ${file}`);
    edits.set(
      file,
      text.replace(pattern, (_, before, _old, after) => `${before}${version}${after}`),
    );
  }
  for (const [file, text] of edits) writeFileSync(resolve(ROOT, file), text);
  console.log(`version: ${version} → ${[...edits.keys()].join(", ")}`);
}

function set(version) {
  writeFiles(version);
  cutChangelog(version);
  check();
}

/** The first beta's change, where the line is cut and on main alike. */
function line(version) {
  const changelog = resolve(ROOT, "CHANGELOG.md");
  const [{ version: now }] = current();
  const upcoming = nextVersion(readFileSync(changelog, "utf8"), now);
  if (version !== upcoming)
    throw new Error(`version: the next release is ${upcoming}, so ${version} cannot go on a line`);
  writeFiles(version);
  writeFileSync(changelog, lineChangelog(readFileSync(changelog, "utf8"), version));
  console.log(`version: ${version} is on its line; Unreleased is open for what comes after it`);
  check();
}

/** The release's one change on its line. */
function date(version, on) {
  const changelog = resolve(ROOT, "CHANGELOG.md");
  const [{ version: now }] = current();
  if (now !== version) throw new Error(`version: the files say ${now}, not ${version}`);
  const day = on ?? new Date().toLocaleDateString("en-CA");
  writeFileSync(changelog, datedChangelog(readFileSync(changelog, "utf8"), version, day));
  console.log(`version: CHANGELOG.md — ${version} is dated ${day}`);
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
  if (!RELEASE.test(named))
    throw new Error(`version: the Unreleased heading names "${named}", which is not x.y.z`);
  if (!newer(named, current))
    throw new Error(
      `version: the Unreleased heading names ${named}, which is not newer than ${current}`,
    );
  return named;
}

function next() {
  const [{ version }] = current();
  process.stdout.write(
    `${nextVersion(readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8"), version)}\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [arg, value, ...rest] = process.argv.slice(2);
  const on = rest.includes("--on") ? rest[rest.indexOf("--on") + 1] : undefined;
  try {
    if (!arg || arg === "--check") check();
    else if (arg === "notes") notes(value ?? "");
    else if (arg === "next") next();
    else if (arg === "line") line(value ?? "");
    else if (arg === "date") date(value ?? "", on);
    else if (arg === "lineof") {
      const [{ version: now }] = current();
      const of = lineVersion(readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8"), now);
      if (of) process.stdout.write(`${of}\n`);
    } else set(arg);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
