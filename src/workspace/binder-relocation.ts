// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { vault } from "../storage";
import { replacePathPrefix, samePath } from "../storage/path-key";
import type { PendingMove } from "../storage/ipc";
import { findItem, isAncestor, move } from "./binder";
import { BINDER_CHANGED, requireParent } from "./binder-rebase";
import { commitPlay, type BinderItem, type Loaded, type PlayFile } from "./play-file";

export interface BinderRelocation {
  version: 1;
  itemId: string;
  from: string;
  to: string;
  /** Absent for a rename; present (including null) for a move. */
  parentId?: string | null;
  parentPath?: string;
  index?: number;
}

function rewrite(item: BinderItem, from: string, to: string): BinderItem {
  const path = replacePathPrefix(item.path, from, to);
  return {
    ...item,
    path,
    ...(item.children ? { children: item.children.map((child) => rewrite(child, from, to)) } : {}),
  };
}

/** One identity is relocated on the current tree; concurrent rows and notes stay. */
export function applyRelocation(play: PlayFile, op: BinderRelocation): PlayFile {
  const current = findItem(play.binder, op.itemId);
  if (!current || ![op.from, op.to].some((path) => samePath(path, current.item.path)))
    throw new Error(BINDER_CHANGED);
  const walk = (rows: BinderItem[]): BinderItem[] =>
    rows.map((row) =>
      row.id === op.itemId
        ? rewrite(row, op.from, op.to)
        : row.children
          ? { ...row, children: walk(row.children) }
          : row,
    );
  let binder = walk(play.binder);
  if (op.parentId !== undefined) {
    requireParent(binder, op.parentId, op.parentPath);
    if (op.parentId && isAncestor(binder, op.itemId, op.parentId)) throw new Error(BINDER_CHANGED);
    binder = move(binder, op.itemId, op.parentId, op.index ?? Number.MAX_SAFE_INTEGER);
  }
  return { ...play, binder };
}

export function decodeRelocation(pending: PendingMove): BinderRelocation {
  if (!pending.payload) throw new Error("The unfinished move has no binder details.");
  const value: unknown = JSON.parse(pending.payload);
  if (!value || typeof value !== "object")
    throw new Error("The unfinished move details could not be read.");
  const op = value as Partial<BinderRelocation>;
  if (
    op.version !== 1 ||
    typeof op.itemId !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(op.itemId) ||
    op.from !== pending.from ||
    op.to !== pending.to ||
    (op.parentId !== undefined && op.parentId !== null && typeof op.parentId !== "string") ||
    (op.parentPath !== undefined && typeof op.parentPath !== "string") ||
    (op.index !== undefined && (!Number.isInteger(op.index) || op.index < 0))
  ) {
    throw new Error("The unfinished move details do not match the file operation.");
  }
  return op as BinderRelocation;
}

/** Finish interrupted file-plus-metadata operations before opening any editor. */
export async function recoverBinderMoves(
  playPath: string,
  loaded: Loaded<PlayFile>,
  pending: PendingMove[],
): Promise<Loaded<PlayFile>> {
  let current = loaded;
  for (const intent of pending) {
    if (!intent.manifest || !samePath(intent.manifest, playPath))
      throw new Error("An unfinished move names a different play file. Its record has been kept.");
    const op = decodeRelocation(intent);
    const out = await commitPlay(
      playPath,
      current,
      (prior) => applyRelocation(prior ?? current.data, op),
      new Date().toISOString(),
    );
    if (out.status !== "ok")
      throw new Error(
        "The unfinished file move could not be saved in the play's details. Try opening the play again.",
      );
    // Native finish also syncs the metadata file and its directory, including
    // when the commit was already present before the crash and is now a no-op.
    await vault.finishMove(intent.id);
    current = { data: out.data, hash: out.hash };
  }
  return current;
}
