// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Refresh dictionaries/ from the American and British dictionary packages.
 *
 * The app loads the CHECKED-IN copies (src/spell/dictionary.ts imports them as
 * Vite assets), the same way the format system loads formats/*.json from the
 * repo root — a build must not depend on node_modules layout, and the exact
 * word list the app ships is a reviewable file rather than a resolved version
 * range. `dictionary-en` stays a devDependency so this stays runnable, and its
 * license travels with the data.
 *
 *   bun run dict:sync
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const [pkg, prefix, license] of [["dictionary-en", "en", "LICENSE"], ["dictionary-en-gb", "en-GB", "LICENSE-en-GB"]]) {
  const src = join(root, "node_modules", pkg);
  const out = join(root, "dictionaries");
  mkdirSync(out, { recursive: true });

  const version = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).version;
  for (const [from, to] of [
    ["index.aff", `${prefix}.aff`],
    ["index.dic", `${prefix}.dic`],
    ["license", license],
  ]) {
    copyFileSync(join(src, from), join(out, to));
    console.log(`dictionaries/${to} ← ${pkg}@${version}/${from}`);
  }
}
