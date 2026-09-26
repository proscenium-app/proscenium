#!/usr/bin/env bun
// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Repair the in-prose path references that the layout migration invalidated.
 *
 * The writer's own notes cross-reference each other by path — "see
 * **materials/retreat-center.md**", "full text: materials/parked-childhood-
 * bedroom.fountain". Moving those files into their type homes turned every one
 * of those pointers into a dead end, for a human and for an agent alike. The
 * migration broke them, so the migration repairs them.
 *
 * Deliberately narrow. It rewrites ONLY exact old→new paths that the migration
 * actually moved, learned by diffing a pre-migration backup's binder against
 * the live one BY ID, so nothing is guessed from a pattern. It never touches:
 *
 *   - `archive/` and `chats/` — historical records. A transcript that said
 *     `materials/x` was TRUE when it was written; editing it is falsifying a log.
 *   - `AGENTS.md` / `CLAUDE.md` — generated on open from the live binder.
 *   - anything whose text does not contain a path that moved.
 *
 * Dry run by default:
 *   bun scripts/fix-moved-references.ts <backup-root> <live-root> [--apply]
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BinderItem, Subproject } from "../src/workspace/manifest-io";

const SKIP_DIRS = new Set(["archive", "chats", "exports", ".proscenium"]);
const SKIP_FILES = new Set(["AGENTS.md", "CLAUDE.md"]);

function leafPaths(items: BinderItem[], into: Map<string, string>): void {
  for (const it of items) {
    if (it.type === "folder") leafPaths(it.children ?? [], into);
    else if (it.path) into.set(it.id, it.path);
  }
}

async function binderPaths(root: string, play: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const sub = JSON.parse(
      await readFile(join(root, play, "subproject.json"), "utf8"),
    ) as Subproject;
    leafPaths(sub.binder, out);
  } catch {
    /* no manifest — nothing to learn */
  }
  return out;
}

async function textFiles(root: string, rel: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) {
        out.push(...(await textFiles(root, childRel)));
      }
    } else if (/\.(md|markdown|fountain)$/i.test(e.name) && !SKIP_FILES.has(e.name)) {
      out.push(childRel);
    }
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const [backup, live] = args.filter((a) => !a.startsWith("--"));
  if (!backup || !live) {
    console.error("usage: bun scripts/fix-moved-references.ts <backup> <live> [--apply]");
    process.exit(1);
  }

  const plays = (await readdir(live, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();

  let edits = 0;
  for (const play of plays) {
    const before = await binderPaths(backup, play);
    const after = await binderPaths(live, play);

    // old → new, only where the path actually changed.
    const moved = new Map<string, string>();
    for (const [id, oldPath] of before) {
      const newPath = after.get(id);
      if (newPath && newPath !== oldPath) moved.set(oldPath, newPath);
    }
    if (moved.size === 0) continue;

    // Longest old path first, so a prefix can never eat a longer match.
    const pairs = [...moved.entries()].sort((a, b) => b[0].length - a[0].length);

    // `textFiles` returns paths already relative to `live` (they carry the
    // play prefix), so this joins once, not twice.
    for (const rel of await textFiles(live, play)) {
      const full = join(live, rel);
      const original = await readFile(full, "utf8");
      let next = original;
      const hits: string[] = [];
      for (const [oldPath, newPath] of pairs) {
        if (!next.includes(oldPath)) continue;
        const count = next.split(oldPath).length - 1;
        next = next.split(oldPath).join(newPath);
        hits.push(`${oldPath} → ${newPath}${count > 1 ? ` (×${count})` : ""}`);
      }
      if (next === original) continue;
      edits += 1;
      console.log(`\n${rel}`);
      for (const h of hits) console.log(`   ${h}`);
      if (apply) await writeFile(full, next);
    }
  }

  console.log(
    `\n${apply ? "Rewrote" : "Would rewrite"} ${edits} file${edits === 1 ? "" : "s"}.` +
      (apply ? "" : "  Re-run with --apply to write."),
  );
}

await main();
