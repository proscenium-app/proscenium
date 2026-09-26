// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure binder-tree operations (no I/O). Mirrors the conflict-floor.ts pattern: a
 * pure, unit-tested core; binder-apply.ts is the side-effecting half that maps
 * these to disk (docs/app/organizing/workspace-model.md#WORK-D100 "Disk mapping of binder operations").
 *
 * These ops change STRUCTURE only — order and nesting. A title is not a field
 * any more: the filename IS the title (docs/app/keeping-work/storage-and-file-format.md#STOR-D4), so renaming is a path
 * change that binder-apply performs on disk and writes back with `patch`.
 * Identity (`id`) is never changed, so card data and references survive.
 */
import { titleFromFileName } from "./filename";
import type { BinderItem } from "./play-file";

function clamp(i: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, i));
}

export interface BinderLocation {
  item: BinderItem;
  /** Parent item id, or null when the item is at the binder root. */
  parentId: string | null;
  index: number;
}

/** Locate an item anywhere in the tree (depth-first). */
export function findItem(
  binder: BinderItem[],
  id: string,
  parentId: string | null = null,
): BinderLocation | null {
  for (let i = 0; i < binder.length; i++) {
    const item = binder[i];
    if (item.id === id) return { item, parentId, index: i };
    if (item.children) {
      const found = findItem(item.children, id, item.id);
      if (found) return found;
    }
  }
  return null;
}

/** Replace the array that directly contains `id`, rebuilding ancestors. */
function transformContaining(
  binder: BinderItem[],
  id: string,
  fn: (arr: BinderItem[]) => BinderItem[],
): BinderItem[] {
  if (binder.some((x) => x.id === id)) return fn(binder);
  return binder.map((item) =>
    item.children
      ? { ...item, children: transformContaining(item.children, id, fn) }
      : item,
  );
}

/** Reorder an item within its current parent. */
export function reorder(
  binder: BinderItem[],
  id: string,
  toIndex: number,
): BinderItem[] {
  return transformContaining(binder, id, (arr) => {
    const i = arr.findIndex((x) => x.id === id);
    if (i === -1) return arr;
    const next = arr.slice();
    const [item] = next.splice(i, 1);
    next.splice(clamp(toIndex, 0, next.length), 0, item);
    return next;
  });
}

/** Remove an item (and its subtree); returns the new tree and the removed item. */
export function removeItem(
  binder: BinderItem[],
  id: string,
): { binder: BinderItem[]; removed: BinderItem | null } {
  let removed: BinderItem | null = null;
  const recur = (arr: BinderItem[]): BinderItem[] => {
    const out: BinderItem[] = [];
    for (const it of arr) {
      if (it.id === id) {
        removed = it;
        continue;
      }
      out.push(it.children ? { ...it, children: recur(it.children) } : it);
    }
    return out;
  };
  return { binder: recur(binder), removed };
}

/** Insert an item under `parentId` (null = root) at `atIndex`. */
export function insert(
  binder: BinderItem[],
  parentId: string | null,
  item: BinderItem,
  atIndex: number,
): BinderItem[] {
  if (parentId === null) {
    const next = binder.slice();
    next.splice(clamp(atIndex, 0, next.length), 0, item);
    return next;
  }
  return binder.map((it) => {
    if (it.id === parentId) {
      const kids = (it.children ?? []).slice();
      kids.splice(clamp(atIndex, 0, kids.length), 0, item);
      return { ...it, children: kids };
    }
    return it.children
      ? { ...it, children: insert(it.children, parentId, item, atIndex) }
      : it;
  });
}

/** Move an item to a new parent (null = root) at `atIndex`. */
export function move(
  binder: BinderItem[],
  id: string,
  newParentId: string | null,
  atIndex: number,
): BinderItem[] {
  const loc = findItem(binder, id);
  if (!loc) return binder;
  // Disallow moving a folder into its own subtree.
  if (newParentId && isAncestor(binder, id, newParentId)) return binder;
  if (newParentId && findItem(binder, newParentId)?.item.type !== "folder") return binder;
  const { binder: without, removed } = removeItem(binder, id);
  if (!removed) return binder;
  return insert(without, newParentId, removed, atIndex);
}

/** True if `ancestorId` is `id` or contains `id` in its subtree. */
export function isAncestor(
  binder: BinderItem[],
  ancestorId: string,
  id: string,
): boolean {
  const loc = findItem(binder, ancestorId);
  if (!loc) return false;
  if (ancestorId === id) return true;
  const walk = (items?: BinderItem[]): boolean =>
    !!items &&
    items.some((it) => it.id === id || walk(it.children));
  return walk(loc.item.children);
}

/** Patch arbitrary fields of an item (used by binder-apply to set new paths). */
export function patch(
  binder: BinderItem[],
  id: string,
  fields: Partial<BinderItem>,
): BinderItem[] {
  return binder.map((it) => {
    if (it.id === id) return { ...it, ...fields };
    return it.children ? { ...it, children: patch(it.children, id, fields) } : it;
  });
}

/** Flatten the tree to leaf items that carry a `path` (for disk reconciliation). */
export function flatten(binder: BinderItem[]): BinderItem[] {
  const out: BinderItem[] = [];
  const walk = (items: BinderItem[]) => {
    for (const it of items) {
      out.push(it);
      if (it.children) walk(it.children);
    }
  };
  walk(binder);
  return out;
}

/** Where a dragged row lands relative to the row it was dropped on. */
export type DropWhere = "before" | "after" | "inside";

export interface DropPlan {
  parentId: string | null;
  atIndex: number;
}

/**
 * Resolve a drop gesture into the single `(parent, index)` a move needs.
 *
 * This is separate from the component because the arithmetic is where drag-drop
 * goes wrong, and it goes wrong invisibly. `atIndex` is a position in the array
 * AFTER the dragged item has been spliced out of it, so dropping a row onto the
 * one below it inside the same folder has to subtract one — get that wrong and
 * the row simply doesn't move, which reads to the writer as "drag is broken"
 * rather than "off by one".
 *
 * Returns null when the gesture is a no-op or illegal (onto itself, into its
 * own subtree, into a leaf, or back exactly where it already sits) so the
 * caller can show a no-drop cursor instead of writing the manifest for nothing.
 */
export function dropPlan(
  binder: BinderItem[],
  dragId: string,
  targetId: string | null,
  where: DropWhere,
): DropPlan | null {
  if (dragId === targetId) return null;
  const src = findItem(binder, dragId);
  if (!src) return null;

  // The tree's empty space: file it at the root, at the end.
  if (targetId === null) {
    if (src.parentId === null && src.index === binder.length - 1) return null;
    return { parentId: null, atIndex: binder.length };
  }
  // A folder cannot become its own descendant, and neither can it be dropped
  // between two of its own children.
  if (isAncestor(binder, dragId, targetId)) return null;

  const dst = findItem(binder, targetId);
  if (!dst) return null;

  if (where === "inside") {
    if (dst.item.type !== "folder") return null;
    const n = dst.item.children?.length ?? 0;
    if (src.parentId === targetId && src.index === n - 1) return null;
    return { parentId: targetId, atIndex: n };
  }

  const sameParent = src.parentId === dst.parentId;
  let at = dst.index + (where === "after" ? 1 : 0);
  if (sameParent && src.index < at) at -= 1;
  if (sameParent && at === src.index) return null;
  return { parentId: dst.parentId, atIndex: at };
}

/** An item's title: the last path segment, without its extension (docs/app/keeping-work/storage-and-file-format.md#STOR-D4). */
export function titleOf(item: BinderItem): string {
  return titleFromFileName(item.path);
}

/**
 * The subtree of `binder` whose titles match `query`, with every ancestor of a
 * match kept so a hit is never orphaned from the folder it lives in. A folder
 * that matches keeps all of its children — you searched for the folder.
 */
export function filterBinder(binder: BinderItem[], query: string): BinderItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return binder;
  const walk = (items: BinderItem[]): BinderItem[] => {
    const out: BinderItem[] = [];
    for (const it of items) {
      const hit = titleOf(it).toLowerCase().includes(q);
      if (hit) {
        out.push(it);
        continue;
      }
      const kids = it.children ? walk(it.children) : [];
      if (kids.length) out.push({ ...it, children: kids });
    }
    return out;
  };
  return walk(binder);
}

/** Every folder id in the tree — what "expand all" needs to open. */
export function folderIds(binder: BinderItem[], into: string[] = []): string[] {
  for (const it of binder) {
    if (it.type === "folder") into.push(it.id);
    if (it.children) folderIds(it.children, into);
  }
  return into;
}

/**
 * The ids of every folder between the root and `id`, outermost first.
 *
 * The binder needs this to guarantee a row is actually LOOKABLE-AT: creating a
 * document inside a collapsed folder used to put it on disk, select it, and
 * open it in rename mode behind a closed disclosure — the writer saw nothing
 * happen and typed a name into a field that was not on screen.
 */
export function ancestorsOf(binder: BinderItem[], id: string): string[] {
  const path: string[] = [];
  const walk = (items: BinderItem[], trail: string[]): boolean => {
    for (const it of items) {
      if (it.id === id) {
        path.push(...trail);
        return true;
      }
      if (it.children && walk(it.children, [...trail, it.id])) return true;
    }
    return false;
  };
  walk(binder, []);
  return path;
}
