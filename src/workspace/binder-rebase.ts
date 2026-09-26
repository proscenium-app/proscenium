// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { samePath } from "../storage/path-key";
import { findItem, flatten, insert, move, patch, removeItem } from "./binder";
import type { BinderItem, PlayFile, ScriptData } from "./play-file";

export const BINDER_CHANGED = "This play's files changed during that edit. Try again.";

export function requireParent(
  binder: BinderItem[],
  parentId: string | null,
  expectedPath?: string,
): void {
  if (parentId === null) return;
  const parent = findItem(binder, parentId)?.item;
  if (
    parent?.type !== "folder" ||
    (expectedPath !== undefined && !samePath(parent.path, expectedPath))
  ) {
    throw new Error(BINDER_CHANGED);
  }
}

/** A removed subtree may not silently take newly arrived descendants with it. */
export function removeKnown(binder: BinderItem[], item: BinderItem): BinderItem[] {
  const current = findItem(binder, item.id)?.item;
  if (!current) return binder;
  const known = new Set(flatten([item]).map((row) => row.id));
  if (!samePath(current.path, item.path) || flatten([current]).some((row) => !known.has(row.id))) {
    throw new Error(BINDER_CHANGED);
  }
  return removeItem(binder, item.id).binder;
}

/** Undo restores this identity and its records, never a snapshot of other rows. */
export function restoreSubtree(
  play: PlayFile,
  item: BinderItem,
  parentId: string | null,
  index: number,
  records: Record<string, ScriptData>,
): PlayFile {
  requireParent(play.binder, parentId);
  const existing = flatten(play.binder);
  const restored = flatten([item]);
  if (
    restored.some((row) =>
      existing.some((other) => other.id === row.id || samePath(other.path, row.path)),
    )
  ) {
    throw new Error(BINDER_CHANGED);
  }
  const scripts = { ...play.scripts };
  for (const row of restored) {
    if (row.type === "script" && records[row.id] && !scripts[row.id])
      scripts[row.id] = records[row.id];
  }
  return { ...play, binder: insert(play.binder, parentId, item, index), scripts };
}

/** Replay a disk-reconciliation plan by identity on a freshly loaded manifest. */
export function reconcileDelta(
  before: BinderItem[],
  planned: BinderItem[],
  fresh: BinderItem[],
): BinderItem[] {
  const oldRows = flatten(before);
  const newRows = flatten(planned);
  const oldIds = new Set(oldRows.map((row) => row.id));
  const newIds = new Set(newRows.map((row) => row.id));
  let binder = fresh;
  for (const row of oldRows) {
    if (!newIds.has(row.id)) binder = removeKnown(binder, row);
  }
  for (const row of newRows) {
    const old = findItem(before, row.id);
    const desired = findItem(planned, row.id)!;
    const current = findItem(binder, row.id);
    if (!oldIds.has(row.id)) {
      if (current) {
        if (!samePath(current.item.path, row.path)) throw new Error(BINDER_CHANGED);
        continue;
      }
      requireParent(binder, desired.parentId);
      if (flatten(binder).some((other) => samePath(other.path, row.path))) {
        throw new Error(BINDER_CHANGED);
      }
      binder = insert(
        binder,
        desired.parentId,
        row.children ? { ...row, children: [] } : row,
        desired.index,
      );
      continue;
    }
    if (!old || !current) continue; // A simultaneous explicit removal wins.
    if (old.item.path !== row.path) {
      if (!samePath(current.item.path, old.item.path) && !samePath(current.item.path, row.path))
        throw new Error(BINDER_CHANGED);
      binder = patch(binder, row.id, { path: row.path });
    }
    if (old.parentId !== desired.parentId) {
      if (current.parentId !== old.parentId && current.parentId !== desired.parentId)
        throw new Error(BINDER_CHANGED);
      requireParent(binder, desired.parentId);
      binder = move(binder, row.id, desired.parentId, desired.index);
    }
  }
  return binder;
}
