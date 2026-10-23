// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sheets the cast binds to (docs/app/organizing/workspace-model.md#WORK-84).
 *
 * A character's sheet is the one the play keeps in its Characters folder, at
 * any depth under it. A sheet filed anywhere else is a file like any other: it
 * opens from the binder, and nothing reads it for the cast. The usual one is an
 * old sheet put away with an earlier draft. It still says `type: character` and
 * still carries the name, and binding to it had the Cast open a weeks-old sheet
 * as the character's own while the Characters folder sat empty, and had the
 * Appearances pass rewrite a filed-away sheet from the current script.
 */
import { pathKey } from "../storage/path-key";
import type { BinderItem } from "../workspace";
import { titleFromFileName } from "../workspace/filename";
import { defaultDirFor } from "./schema";

/** Whether `item` is a character sheet the cast reads: one under the play's Characters folder. */
export function isCastSheet(item: BinderItem): boolean {
  if (item.type !== "character") return false;
  const parts = item.path.split("/");
  return parts.length > 1 && pathKey(parts[0]) === pathKey(defaultDirFor("character"));
}

/** Every cast sheet in a binder tree, in binder order. */
export function castSheets(items: BinderItem[], out: BinderItem[] = []): BinderItem[] {
  for (const item of items) {
    if (item.children) castSheets(item.children, out);
    else if (isCastSheet(item)) out.push(item);
  }
  return out;
}

/** The cast sheet for a cue name ("MARA"), or null when the Characters folder has none. */
export function castSheetFor(binder: BinderItem[], name: string): BinderItem | null {
  const target = name.trim().toUpperCase();
  if (!target) return null;
  return (
    castSheets(binder).find((it) => titleFromFileName(it.path).trim().toUpperCase() === target) ??
    null
  );
}
