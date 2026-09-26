// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shape a new play starts with (docs/app/keeping-work/storage-and-file-format.md#STOR-D3).
 *
 * **A new play is two files**: the script and the play file. Nothing else is
 * written — no directories, no `.gitkeep`, nothing hidden (docs/app/keeping-work/storage-and-file-format.md#STOR-111). The binder
 * still shows Characters and Notes, because a writer opening a new play should
 * be able to see where a character sheet is meant to go before they have one;
 * the directory appears when the first file lands there (create-on-demand).
 *
 * The homes are derived from `SCHEMAS` rather than restated, for the same
 * reason the folders are create-on-demand: `newMaterial` files by
 * `defaultDirFor(type)`, so a hand-kept second list would be one edit away
 * from offering a folder that new material never lands in.
 */
import { SCHEMAS } from "../materials/schema";
import type { BinderItem } from "./play-file";
import { ulid } from "./ulid";

/**
 * The folders a new play's binder shows, in order — one per DISTINCT schema
 * home. Since the taxonomy collapsed there are two: `Characters` and `Notes`.
 *
 * Capitalized, because the folder name is what Finder shows and what the
 * binder shows, and they are the same string now (docs/app/keeping-work/storage-and-file-format.md#STOR-D4). A play made before 1.0
 * whose folders are lowercase keeps them; nothing renames a writer's folder.
 */
export const MATERIAL_FOLDERS: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of SCHEMAS) {
    if (!s.dir || seen.has(s.dir)) continue;
    seen.add(s.dir);
    out.push(s.dir);
  }
  return out;
})();

/**
 * The binder a fresh play starts with: the script, then a folder per material
 * home. The folders have no directory on disk yet, and that is the point — the
 * same argument the material templates make with their empty sections.
 */
export function startingBinder(script: BinderItem): BinderItem[] {
  return [
    script,
    ...MATERIAL_FOLDERS.map((dir) => ({
      id: ulid(),
      type: "folder" as const,
      path: dir,
      children: [],
    })),
  ];
}
