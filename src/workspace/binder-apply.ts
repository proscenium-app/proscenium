// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side-effecting half of binder editing: maps a structural op (binder.ts)
 * to atomic disk operations and a guarded play-file write. The ONLY
 * orchestrator of binder I/O.
 *
 * Guarantees: file moves are atomic (vault.rename); deletes go to the OS trash
 * (vault.trash), never a silent unlink; the play-file write rebases once on a
 * stale hash rather than re-asserting it (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
 *
 * Binder paths are relative to the PLAY FOLDER, and the vault is opened at the
 * play folder, so a binder path is a vault path. There is no sub-project
 * prefix any more, and no sidecar to keep in step with a script.
 *
 * **Folders are create-on-demand** (docs/app/keeping-work/storage-and-file-format.md#STOR-D3, docs/app/keeping-work/storage-and-file-format.md#STOR-111). Making a folder adds a binder row
 * and writes nothing; the directory appears when the first file lands in it,
 * because every write creates its parents. The app never scaffolds an empty
 * directory.
 *
 * The caller (workspace store) must flush/close any open editor session for a
 * path before deleting or moving it (the open buffer isn't covered by trash).
 */
import { samePath as sameFileOnDisk } from "../storage/path-key";
import { vault } from "../storage";
import { defaultDirFor, normalizeType, renderTemplate } from "../materials";
import {
  findItem,
  flatten,
  insert,
  isAncestor,
  reorder,
} from "./binder";
import {
  commitPlay,
  readPlayFile,
  withBinder,
  type BinderItem,
  type BinderItemType,
  type PlayFile,
  type ScriptData,
} from "./play-file";
import { fileName, titleFromFileName } from "./filename";
import { ulid } from "./ulid";
import { BINDER_CHANGED, reconcileDelta, removeKnown, requireParent, restoreSubtree } from "./binder-rebase";
import { applyRelocation, type BinderRelocation } from "./binder-relocation";

// --- path helpers ---
function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}
function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i);
}
function joinp(...parts: string[]): string {
  return parts.filter((p) => p !== "").join("/");
}

export interface BinderContext {
  /** Play-folder-relative path of the play file (`<Play>.proscenium`). */
  playPath: string;
  play: PlayFile;
  /** Last-known hash of the play file (the guarded write's expectation). */
  hash: string;
}

export type ApplyResult =
  | { ok: true; play: PlayFile; hash: string; createdId?: string }
  | { ok: false; reason: "collision" | "error"; message?: string; blocked?: boolean };

/**
 * Commit a reconciliation plan as individual identity edits against the fresh
 * binder. This never treats a cached tree as the replacement for a newer one.
 */
export async function commitBinder(
  ctx: BinderContext,
  binder: BinderItem[],
): Promise<ApplyResult> {
  return commit(ctx, (play) => withBinder(play, reconcileDelta(ctx.play.binder, binder, play.binder)));
}

export function restoreBinderItem(ctx: BinderContext, item: BinderItem, parentId: string | null,
  index: number, records: Record<string, ScriptData>): Promise<ApplyResult> {
  return commit(ctx, (play) => restoreSubtree(play, item, parentId, index, records));
}

async function commit(
  ctx: BinderContext,
  build: (play: PlayFile) => PlayFile,
): Promise<ApplyResult> {
  try {
    const out = await commitPlay(
      ctx.playPath,
      { data: ctx.play, hash: ctx.hash },
      (prior) => build(prior ?? ctx.play),
      new Date().toISOString(),
    );
    if (out.status === "ok") return { ok: true, play: out.data, hash: out.hash };
    if (out.status === "read-only") {
      return { ok: false, reason: "error", message: "This play was saved by a newer Proscenium, so it opens read-only." };
    }
    return { ok: false, reason: "collision" };
  } catch (e) {
    return { ok: false, reason: "error", message: String(e) };
  }
}

/**
 * A free path in the same directory (docs/app/keeping-work/storage-and-file-format.md#STOR-D4: never two paths differing only by
 * case). Suffixes read as `Scene 2.md`, `Scene 3.md` — a space and a number,
 * the way Finder disambiguates. A filename is the writer's own
 * title, so a hyphen would look like part of the name.
 *
 * `selfPath` is the item being renamed or moved. Its own file is never in its
 * way — including under another case: renaming "charlie" to "Charlie" asks
 * whether `Charlie.md` exists, and on a Mac it does, because it is the same
 * file. Counting that as taken used to make it "Charlie 2".
 */
async function freshPath(binderPath: string, selfPath?: string): Promise<string> {
  const dir = dirname(binderPath);
  const ext = extname(binderPath);
  const base = basename(binderPath).slice(0, basename(binderPath).length - ext.length);
  let candidate = binderPath;
  let n = 2;
  const isSelf = (p: string) => selfPath !== undefined && sameFileOnDisk(p, selfPath);
  while (!isSelf(candidate) && (await vault.exists(candidate))) {
    candidate = joinp(dir, `${base} ${n}${ext}`);
    n += 1;
  }
  return candidate;
}

function addAt(ctx: BinderContext, parentId: string | null, item: BinderItem, atIndex: number): Promise<ApplyResult> {
  const parentPath = parentId ? findItem(ctx.play.binder, parentId)?.item.path : undefined;
  return commit(ctx, (play) => {
    requireParent(play.binder, parentId, parentPath);
    if (flatten(play.binder).some((row) => row.id === item.id || sameFileOnDisk(row.path, item.path))) {
      throw new Error(BINDER_CHANGED);
    }
    return withBinder(play, insert(play.binder, parentId, item, atIndex));
  });
}

async function commitRelocation(ctx: BinderContext, op: BinderRelocation): Promise<ApplyResult> {
  const item = findItem(ctx.play.binder, op.itemId)?.item;
  const exists = await vault.exists(op.from);
  if (op.from === op.to || (!exists && item?.type === "folder")) {
    return commit(ctx, (play) => applyRelocation(play, op));
  }
  if (!exists) return { ok: false, reason: "error", message: "This file is no longer at its original name. Reopen the play before moving it." };
  const blocked = (error: unknown): ApplyResult => ({ ok: false, reason: "error", blocked: true,
    message: `The file move needs to finish before writing can continue. Reopen the play. ${String(error)}` });
  let started;
  try { started = await vault.beginMove(op.from, op.to, ctx.playPath, JSON.stringify(op)); }
  catch (error) { return blocked(error); }
  if (started.status === "refused") return { ok: false, reason: "error", message: started.message, blocked: started.blocked };
  const result = await commit(ctx, (play) => applyRelocation(play, op));
  if (result.ok) {
    try { await vault.finishMove(started.intent.id); return result; }
    catch (error) { return blocked(error); }
  }
  // A refusal may have happened after the metadata rename. Roll back only
  // when the original location is still what the actual manifest names.
  const fresh = await readPlayFile(ctx.playPath);
  if (fresh.status !== "valid" || findItem(fresh.data.binder, op.itemId)?.item.path !== op.from) {
    return blocked("The play's details could not confirm the original location.");
  }
  try {
    await vault.rollbackMove(started.intent.id);
    const after = await readPlayFile(ctx.playPath);
    if (after.status !== "valid" || after.hash !== fresh.hash) return blocked("The play's details changed during recovery.");
    await vault.finishMove(started.intent.id);
    return result;
  } catch (error) { return blocked(error); }
}

// --- operations ---

/** Reorder within the current parent. No file moves — rewrite the play file. */
export function reorderItem(
  ctx: BinderContext,
  id: string,
  toIndex: number,
): Promise<ApplyResult> {
  return commit(ctx, (play) => {
    if (!findItem(play.binder, id)) throw new Error(BINDER_CHANGED);
    return withBinder(play, reorder(play.binder, id, toIndex));
  });
}

/**
 * Rename: the title and the filename are the same act, because they are the
 * same name (docs/app/keeping-work/storage-and-file-format.md#STOR-D4). A folder renames its directory too, when it has one.
 */
export async function renameItem(
  ctx: BinderContext,
  id: string,
  title: string,
): Promise<ApplyResult> {
  const loc = findItem(ctx.play.binder, id);
  if (!loc) return { ok: false, reason: "error", message: "item not found" };
  const item = loc.item;
  const ext = item.type === "folder" ? "" : extname(item.path) || ".md";
  const desired = joinp(dirname(item.path), fileName(title) + ext);
  const target = desired === item.path ? item.path : await freshPath(desired, item.path);
  return commitRelocation(ctx, { version: 1, itemId: id, from: item.path, to: target });
}

/** Move an item to a new parent folder (or root), relocating its file(s). */
export async function moveItem(
  ctx: BinderContext,
  id: string,
  newParentId: string | null,
  atIndex: number,
): Promise<ApplyResult> {
  const loc = findItem(ctx.play.binder, id);
  if (!loc) return { ok: false, reason: "error", message: "item not found" };
  if (newParentId && isAncestor(ctx.play.binder, id, newParentId)) {
    return { ok: false, reason: "error", message: "cannot move into own subtree" };
  }
  const item = loc.item;
  requireParent(ctx.play.binder, newParentId);
  const parentDir = newParentId
    ? (findItem(ctx.play.binder, newParentId)?.item.path ?? "")
    : "";
  const target = await freshPath(joinp(parentDir, basename(item.path)), item.path);
  return commitRelocation(ctx, { version: 1, itemId: id, from: item.path, to: target,
    parentId: newParentId, parentPath: parentDir, index: Number.isFinite(atIndex) ? atIndex : Number.MAX_SAFE_INTEGER });
}

/**
 * Create a new folder under `parentId` (or root), at `atIndex`.
 *
 * Writes nothing. A binder folder is a row; the directory is created when the
 * first file lands in it, because every write creates its parents (docs/app/keeping-work/storage-and-file-format.md#STOR-D3, docs/app/keeping-work/storage-and-file-format.md#STOR-111).
 *
 * `atIndex` defaults to the end, but the binder passes the slot just after
 * whatever is selected — the rule that matches intent: a
 * writer who clicks New while looking at Act Two wants the new thing beside
 * Act Two, not at the bottom of a list they have to scroll to find.
 */
export async function newFolder(
  ctx: BinderContext,
  parentId: string | null,
  title: string,
  atIndex = Infinity,
): Promise<ApplyResult> {
  const parentDir = parentId
    ? (findItem(ctx.play.binder, parentId)?.item.path ?? "")
    : "";
  const path = await freshPath(joinp(parentDir, fileName(title)));
  const id = ulid();
  const item: BinderItem = { id, type: "folder", path, children: [] };
  const res = await addAt(ctx, parentId, item, atIndex);
  return res.ok ? { ...res, createdId: id } : res;
}

/**
 * A minimal but valid stage script: a title page and one act/scene so the
 * corkboard has a card to land on. Kept in canonical form (no empty title-page
 * fields) so the first autosave is a true no-op round-trip.
 */
function starterFountain(title: string): string {
  return `Title: ${title}\nCredit: a play by\n\n# ACT ONE\n\n## Scene 1\n\nA bare stage.\n`;
}

/**
 * Create a new script: a `.fountain` and a binder entry.
 *
 * It lands beside the main script at the play root unless the writer made it
 * inside a folder — there is no `script/` folder and no sub-project layer (docs/app/keeping-work/storage-and-file-format.md#STOR-D3).
 * Its card data is born empty and `scripts[id]` fills in on first reconcile.
 */
export async function newScript(
  ctx: BinderContext,
  parentId: string | null,
  title: string,
  atIndex = Infinity,
): Promise<ApplyResult> {
  const parentDir = parentId
    ? (findItem(ctx.play.binder, parentId)?.item.path ?? "")
    : "";
  const id = ulid();
  const path = await freshPath(joinp(parentDir, fileName(title) + ".fountain"));
  // Created, not written: a file that arrived at that name since `freshPath`
  // looked is left alone, never replaced by starter text. A refusal throws, as a write's did,
  // so the caller can say why in the disk's own words.
  await vault.create(path, starterFountain(titleFromFileName(path)));
  const item: BinderItem = { id, type: "script", path };
  const res = await addAt(ctx, parentId, item, atIndex);
  return res.ok ? { ...res, createdId: id } : res;
}

/**
 * Create a new Markdown document from its schema (src/materials/schema.ts).
 *
 * A `document` — which is nearly everything a writer makes — is born as an
 * EMPTY file: the template renders to zero bytes, so the writer's first
 * keystroke is the first byte. A `character` still gets its front matter and
 * its empty sections, because something reads them.
 */
export async function newMaterial(
  ctx: BinderContext,
  parentId: string | null,
  type: BinderItemType,
  title: string,
  atIndex = Infinity,
): Promise<ApplyResult> {
  const kind = normalizeType(type);
  const parentDir = parentId
    ? (findItem(ctx.play.binder, parentId)?.item.path ?? "")
    : defaultDirFor(kind);
  const id = ulid();
  const path = await freshPath(joinp(parentDir, fileName(title) + ".md"));
  const name = titleFromFileName(path);
  const body = renderTemplate({
    type: kind,
    id,
    title: name,
    created: new Date().toISOString(),
  });
  await vault.create(path, body);
  const item: BinderItem = { id, type: kind, path };
  const res = await addAt(ctx, parentId, item, atIndex);
  return res.ok ? { ...res, createdId: id } : res;
}

/**
 * Duplicate an item beside itself — the copy every file manager has and the
 * binder did not, so the only way to try a rewrite of a scene without losing
 * the original was to leave the app.
 *
 * Files only: duplicating a folder means copying a subtree, and the vault's
 * byte-level API has no recursive copy behind it. Better to not offer it than
 * to offer half of it.
 */
export async function duplicateItem(
  ctx: BinderContext,
  id: string,
): Promise<ApplyResult> {
  const loc = findItem(ctx.play.binder, id);
  if (!loc) return { ok: false, reason: "error", message: "item not found" };
  const item = loc.item;
  if (item.type === "folder") {
    return { ok: false, reason: "error", message: "only files can be duplicated" };
  }

  const ext = extname(item.path) || ".md";
  const stem = titleFromFileName(item.path);
  const path = await freshPath(joinp(dirname(item.path), `${stem} copy${ext}`));
  const newId = ulid();

  try {
    const { content } = await vault.read(item.path);
    await vault.create(path, content);
  } catch (e) {
    return { ok: false, reason: "error", message: String(e) };
  }

  // The copy's cards start empty: scene ids are unique to a script, so sharing
  // them between two scripts would give one scene two boards.
  const copy: BinderItem = { id: newId, type: item.type, path };
  const res = await addAt(ctx, loc.parentId, copy, loc.index + 1);
  return res.ok ? { ...res, createdId: newId } : res;
}

/**
 * Delete: trash the file(s), then drop the binder entry (never a silent
 * unlink). The caller must close/flush any open editor session for this path
 * first. A folder with no directory has nothing to trash — its row goes.
 */
export async function deleteItem(
  ctx: BinderContext,
  id: string,
): Promise<ApplyResult> {
  const loc = findItem(ctx.play.binder, id);
  if (!loc) return { ok: false, reason: "error", message: "item not found" };
  const item = loc.item;
  try {
    if (await vault.exists(item.path)) {
      await vault.trash(item.path); // a folder trashes its whole subtree
    }
  } catch (e) {
    // Trash backend unavailable → do NOT orphan: keep the entry, report.
    return { ok: false, reason: "error", message: `could not trash: ${e}` };
  }
  const deletedIds = new Set(flatten([item]).map((row) => row.id));
  return commit(ctx, (play) => {
    const binder = removeKnown(play.binder, item);
    // Only this operation's explicit removals authorise pruning canonical notes.
    const scripts = Object.fromEntries(Object.entries(play.scripts).filter(([key]) => !deletedIds.has(key)));
    return { ...play, binder, scripts };
  });
}
