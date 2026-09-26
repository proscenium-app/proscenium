// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * check:names — no other writing app is named outside the import tool
 * (AGENTS.md, "Load-bearing rules"; the maintainer, 2026-09-17).
 *
 * Proscenium says what a behaviour is on its own terms. A comment, a test name,
 * a doc or the README that explains one as another app's feature, or the whole
 * app as another app "for plays", is what this gate refuses. A file format is
 * named by its extension (`.fdx`); the format's own root tag, `<FinalDraft>`,
 * has no space and does not match.
 *
 * The import tool keeps the names, because a writer needs them to find a source
 * app's export menu: everything under `src/import/`, its spec, the `.fdx`
 * document type in tauri.conf.json, the site copy's import answers, and the
 * accessibility trees of the import tool's screens in scripts/aria/. A line
 * anywhere else that has to name one — a smoke check driving the import tool by
 * the label a writer sees — says `names: import tool` in a comment.
 *
 * It reads tracked files and the untracked ones git does not ignore, so a new
 * doc fails here before it is committed. Word lists and the sample plays are
 * prose, not references; binary files are skipped. The list is the names that
 * mean nothing but an app: a name that is also a common word would fail honest
 * prose, so the rule in AGENTS.md covers those, and review does.
 *
 *   bun run check:names
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const NAMES =
  /\b(?:Scrivener|Writer ?Duet|WriterSolo|Final Draft|Celtx|Arc Studio|Adobe Story|Movie Magic Screenwriter|Trelby|Afterwriting|iA Writer|Highland (?:Pro|2)|KIT Scenarist)\b|\b(?:literatureandlatte|finaldraft|writerduet|celtx)\.com\b/g;

/** Paths that may name them: a directory ends in `/`. */
const EXEMPT = [
  "src/import/",
  "docs/app/importing/document-import.md",
  "src-tauri/tauri.conf.json",
  "dictionaries/",
  "sample-vault/",
  "scripts/check-names.mjs",
];
const MARKER = "names: import tool";

/**
 * The accessibility trees of the import tool's own screens (scripts/aria/),
 * which read out the names that screen shows a writer.
 */
const IMPORT_TOOL_TREES = /^scripts\/aria\/(?:native\/)?(?:document-import|fdx-import)[a-z0-9-]*(?:\.[a-z]+)*\.yml$/;

const exempt = (rel) => IMPORT_TOOL_TREES.test(rel) || EXEMPT.some((p) => (p.endsWith("/") ? rel.startsWith(p) : rel === p));

function listed(...args) {
  return execFileSync("git", ["ls-files", "-z", ...args], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

/** The names on each line of `text`, as `{ line, name }`. */
export function namesIn(text) {
  const found = [];
  text.split("\n").forEach((line, i) => {
    if (line.includes(MARKER)) return;
    for (const match of line.matchAll(NAMES)) found.push({ line: i + 1, name: match[0] });
  });
  return found;
}

function main() {
  const failures = [];
  const paths = [...new Set([...listed("--cached"), ...listed("--others", "--exclude-standard")])];
  let scanned = 0;
  for (const rel of paths) {
    if (exempt(rel)) continue;
    let bytes;
    try {
      bytes = readFileSync(join(ROOT, rel));
    } catch {
      continue; // deleted in the working tree, or a directory git lists (a nested checkout)
    }
    if (bytes.includes(0)) continue;
    scanned++;
    for (const { line, name } of namesIn(bytes.toString("utf8"))) failures.push(`  ${rel}:${line}  ${name}`);
  }
  if (failures.length) {
    console.error(
      [
        `check:names: ${failures.length} other writing app${failures.length === 1 ? "" : "s"} named outside the import tool:`,
        ...failures,
        "Say what the behaviour is on its own terms, and name a file format by its extension. A line that drives",
        `the import tool by the name a writer sees says "${MARKER}" in a comment (AGENTS.md, Load-bearing rules).`,
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log(`check:names: ${scanned} files, no other writing app named outside the import tool`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
