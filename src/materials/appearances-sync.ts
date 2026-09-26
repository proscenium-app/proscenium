// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Keep each character sheet's `## Appearances` section current from the script.
 *
 * Runs on a slow debounce after the script reparses. Three rules make it safe
 * to point at the writer's own prose:
 *
 *  1. It only ever rewrites BETWEEN the `## Appearances` heading and the next
 *     heading (managed.ts). Every other byte is passed through.
 *  2. A byte-identical result is not written, so a play whose cast has not
 *     moved costs one read per sheet and no file events at all.
 *  3. A write that does not land is DROPPED, not retried and not pinned. The
 *     only thing this contributes is a regenerable list, so if someone else
 *     wrote the sheet in between we recompute on the next cycle. Pinning a
 *     version to save a list we can rebuild in a millisecond would be a bad
 *     trade, and it would fill Versions with noise.
 */
import { vault } from "../storage";
import { titleFromFileName } from "../workspace/filename";
import type { BinderItem, SceneAppearance } from "../workspace";
import { hasManagedSection, renderAppearances, writeManagedSection } from "./managed";

const HEADING = "Appearances";

export interface AppearanceSyncResult {
  written: string[];
  skipped: number;
}

/** Every `character` item in a binder tree, flattened. */
function characters(items: BinderItem[], out: BinderItem[] = []): BinderItem[] {
  for (const item of items) {
    if (item.type === "folder") {
      if (item.children) characters(item.children, out);
    } else if (item.type === "character") {
      out.push(item);
    }
  }
  return out;
}

/**
 * The cue name a sheet stands for. The sheet's filename is its title
 * ("Charlie.md"); the script speaks in ALL CAPS ("CHARLIE"), and `aka` covers
 * the case where the sheet is filed under a name the script does not use.
 */
function cueNamesFor(item: BinderItem, frontMatterAka?: string): string[] {
  const names = [titleFromFileName(item.path), ...(frontMatterAka ?? "").split(",")];
  return names.map((n) => n.trim().toUpperCase()).filter(Boolean);
}

function akaOf(content: string): string | undefined {
  const m = content.match(/^aka:\s*(.*)$/m);
  return m?.[1]?.trim() || undefined;
}

/**
 * Update every character sheet that declares the section. `appearances` is the
 * map computeAppearances() returns: UPPERCASE cue name → scenes.
 *
 * `onWrote` lets the caller adopt a sheet it currently has open, so the buffer
 * on screen matches disk without waiting for a watcher (which browser dev and
 * iOS do not have).
 */
export async function syncAppearances(args: {
  binder: BinderItem[];
  appearances: Map<string, SceneAppearance[]>;
  onWrote?: (path: string, content: string, hash: string) => void;
  /** Leave this sheet for a later pass (one open with words not yet saved). */
  skip?: (path: string) => boolean;
}): Promise<AppearanceSyncResult> {
  const written: string[] = [];
  let skipped = 0;

  for (const item of characters(args.binder)) {
    const rel = item.path;
    if (args.skip?.(rel)) continue;
    try {
      if (!(await vault.exists(rel))) continue;
      const { content, hash } = await vault.read(rel);
      if (!hasManagedSection(content, HEADING)) {
        skipped += 1;
        continue;
      }

      const names = cueNamesFor(item, akaOf(content));
      const scenes = names.flatMap((n) => args.appearances.get(n) ?? []);
      // De-dup + document order, in case `aka` overlaps the title.
      const seen = new Set<number>();
      const ordered = scenes
        .filter((s) => (seen.has(s.ordinal) ? false : (seen.add(s.ordinal), true)))
        .sort((a, b) => a.ordinal - b.ordinal);

      const next = writeManagedSection(content, HEADING, renderAppearances(ordered));
      if (next === content) continue; // nothing moved — no write, no file event

      const out = await vault.write(rel, next, hash);
      if (out.status === "ok") {
        written.push(rel);
        args.onWrote?.(rel, next, out.hash);
      }
      // A collision means someone else wrote it. Ours is regenerable — drop it
      // and recompute on the next pass rather than fighting for the file.
    } catch {
      // A sheet that will not read (evicted from iCloud, malformed) must never
      // break a save. It syncs on a later pass (docs/app/keeping-work/storage-and-file-format.md#STOR-107).
    }
  }
  return { written, skipped };
}
