// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Disk-vs-binder reconciliation (docs/app/keeping-work/storage-and-file-format.md#STOR-D8).
 *
 * **The binder is the folder.** Every directory in the play is a binder folder,
 * every `.fountain` is a script, every `.md` is a document, everything else is
 * a reference. There are no reserved folder names and nothing is ignored by
 * name — what the writer sees in Finder and what they see in the binder are the
 * same tree. `archive/`, `exports/` and `chats/` were special before 1.0; they
 * are ordinary folders now.
 *
 * Disk is truth for EXISTENCE and CONTENT. The binder is truth for ORDER,
 * NESTING INTENT and CARD METADATA. The asymmetries in docs/app/keeping-work/storage-and-file-format.md#STOR-D8 are all here:
 *
 *  - A file with no entry is filed automatically, at the end of the folder it
 *    sits in. There is no "unfiled" state for the writer to learn.
 *  - A folder entry whose directory does not exist is an EMPTY folder, not a
 *    missing one — folders are create-on-demand (docs/app/keeping-work/storage-and-file-format.md#STOR-D3), so this is the normal
 *    state of a new play's Characters and Notes.
 *  - A script entry whose file is gone STAYS, surfaced. It carries card
 *    metadata and a version ring, and a script vanishing is exactly when the
 *    app should say something.
 *  - A document or reference entry whose file is gone is removed, and the
 *    removal is listed under Changes so the writer can see it happened.
 *
 * The app never deletes a file to fix a mismatch, and never removes a script
 * entry on its own.
 */
import { inferType } from "../materials";
import { vault } from "../storage";
import { matchingPath, pathKey } from "../storage/path-key";
import { split as splitFrontMatter } from "./front-matter";
import { flatten } from "./binder";
import { isPlayFileName, type BinderItem, type BinderItemType } from "./play-file";
import { isProviderConflictCopy } from "./sync-names";
import { isUlid, ulid } from "./ulid";

/**
 * The atomic-write temp sibling (docs/app/keeping-work/storage-and-file-format.md#STOR-D9): `.<name>.<random>.tmp`, hidden,
 * in the target's own directory, alive for milliseconds. The watcher and the
 * reconciler both ignore it — otherwise every save would flicker a phantom
 * binder row.
 */
export function isTempSibling(name: string): boolean {
  return /^\..+\.[A-Za-z0-9]+\.tmp$/.test(name);
}

/**
 * Files that are never binder items.
 *
 * Dotfiles wholesale, and that is load-bearing rather than tidy-minded:
 * `.DS_Store` was once filed as a `reference` with the title `titleFromPath`
 * returns for a name that is all extension — the empty string — leaving a
 * nameless, un-clickable row in the binder pointing at it. A hidden file is the
 * OS's or a tool's, never the writer's document.
 *
 * The play file itself is not a binder item either: it is the app's, it is
 * shown by Finder with its own icon, and a row for it in its own binder would
 * be a loop.
 */
export function ignoredFile(name: string): boolean {
  return (
    name.startsWith(".") ||
    isTempSibling(name) ||
    isPlayFileName(name) ||
    isProviderConflictCopy(name)
  );
}

/** Directories that are never binder folders: hidden ones, and nothing else. */
export function ignoredDir(name: string): boolean {
  return name.startsWith(".");
}

export interface DiskNode {
  /** Path relative to the play folder, forward-slash. */
  path: string;
  isDir: boolean;
}

export interface Reconciliation {
  /** The binder with everything on disk filed into it. */
  binder: BinderItem[];
  /** Ids the app added for the writer — shown with a dot until acknowledged. */
  added: string[];
  /** Script entries whose file is gone. Kept in the binder, surfaced. */
  missing: BinderItem[];
  /** Document/reference entries whose file is gone. Removed; listed in Changes. */
  removed: BinderItem[];
  /** Existing identities whose actual disk spelling or location changed. */
  updated: string[];
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * File everything on disk into `binder`, and resolve entries whose file is
 * gone. Pure: `disk` is the walk's result and `typeOf` has already read any
 * front matter. The caller performs no I/O on our behalf beyond that.
 *
 * Directories are created as binder folders before files are filed, deepest
 * last, so a file always finds the folder it belongs in.
 */
export function reconcile(
  binder: BinderItem[],
  disk: DiskNode[],
  typeOf: (path: string) => BinderItemType,
  mintId: () => string = ulid,
  /** False when some folder could not be listed: then nothing is missing or removed, as an unlisted folder is not an empty one. */
  complete = true,
  identityOf: (path: string) => string | undefined = () => undefined,
): Reconciliation {
  const added: string[] = [];
  const updated: string[] = [];
  const presentIds = new Set<string>();
  // A working copy of the tree, indexed by path so a folder can be found fast.
  const byPath = new Map<string, BinderItem>();
  const clone = (items: BinderItem[]): BinderItem[] =>
    items.map((it) => {
      const copy: BinderItem = it.children
        ? { ...it, children: clone(it.children) }
        : { ...it };
      if (copy.path) byPath.set(copy.path, copy);
      return copy;
    });
  const next = clone(binder);
  const diskKeys = new Map<string, Set<string>>();
  for (const node of disk) {
    const key = pathKey(node.path);
    const paths = diskKeys.get(key) ?? new Set<string>();
    paths.add(node.path); diskKeys.set(key, paths);
  }
  // Bucket by the shared key, retaining exact spellings in a collision bucket.
  const buckets = new Map<string, string[]>();
  const index = (path: string) => {
    const key = pathKey(path);
    const bucket = buckets.get(key) ?? [];
    if (!bucket.includes(path)) bucket.push(path);
    buckets.set(key, bucket);
  };
  for (const path of byPath.keys()) index(path);
  const lookup = (path: string) => {
    if ((diskKeys.get(pathKey(path))?.size ?? 0) > 1) return byPath.get(path);
    const match = matchingPath(path, buckets.get(pathKey(path)) ?? []);
    return match === undefined ? undefined : byPath.get(match);
  };
  const onDisk = (path: string) => {
    const paths = diskKeys.get(pathKey(path));
    return paths !== undefined && (paths.size === 1 || paths.has(path));
  };
  const byId = new Map(flatten(next).map((item) => [item.id, item]));
  const claims = new Map<string, string[]>();
  for (const node of disk) {
    if (node.isDir) continue;
    const id = identityOf(node.path);
    if (id && (isUlid(id) || byId.has(id))) claims.set(id, [...(claims.get(id) ?? []), node.path]);
  }
  const detach = (items: BinderItem[], id: string): void => {
    const at = items.findIndex((item) => item.id === id);
    if (at >= 0) { items.splice(at, 1); return; }
    for (const item of items) if (item.children) detach(item.children, id);
  };
  const adoptSpelling = (item: BinderItem, path: string) => {
    if (item.path === path) return;
    byPath.delete(item.path);
    const old = buckets.get(pathKey(item.path));
    if (old) old.splice(old.indexOf(item.path), 1);
    item.path = path;
    byPath.set(path, item); index(path);
    updated.push(item.id);
  };

  /** Append `item` into the folder at `dir` (or the root when dir is ""). */
  const appendAt = (dir: string, item: BinderItem): void => {
    if (!dir) {
      next.push(item);
      return;
    }
    const parent = lookup(dir);
    if (parent && parent.type === "folder") {
      parent.children = [...(parent.children ?? []), item];
      return;
    }
    // No folder for this directory (it was ignored, or the entry is a leaf of
    // the wrong type). Filing at the root beats dropping the file.
    next.push(item);
  };

  // Folders first, shallowest first, so a nested directory's parent exists by
  // the time it is filed.
  const dirs = disk.filter((d) => d.isDir).sort((a, b) => a.path.localeCompare(b.path));
  for (const d of dirs) {
    const existing = lookup(d.path);
    if (existing) { adoptSpelling(existing, d.path); presentIds.add(existing.id); continue; }
    const item: BinderItem = {
      id: mintId(),
      type: "folder",
      path: d.path,
      children: [],
    };
    byPath.set(d.path, item);
    byId.set(item.id, item); index(d.path);
    appendAt(dirOf(d.path), item);
    added.push(item.id);
    presentIds.add(item.id);
  }

  const files = disk.filter((d) => !d.isDir).sort((a, b) => a.path.localeCompare(b.path));
  for (const f of files) {
    const existing = lookup(f.path);
    if (existing) { adoptSpelling(existing, f.path); presentIds.add(existing.id); continue; }
    const type = typeOf(f.path);
    const declared = identityOf(f.path);
    const unique = declared !== undefined && claims.get(declared)?.length === 1;
    const prior = declared === undefined ? undefined : byId.get(declared);
    const typed = type === "character" || type === "document" || type === "outline";
    if (typed && unique && prior && prior.type === type && complete && !onDisk(prior.path)) {
      detach(next, prior.id);
      adoptSpelling(prior, f.path);
      appendAt(dirOf(f.path), prior);
      presentIds.add(prior.id);
      continue;
    }
    const id = typed && unique && !prior ? declared! : mintId();
    const item: BinderItem = { id, type, path: f.path };
    byPath.set(f.path, item);
    byId.set(item.id, item); index(f.path);
    appendAt(dirOf(f.path), item);
    added.push(item.id);
    presentIds.add(item.id);
  }

  // Now resolve entries whose file is gone. A folder is exempt: an entry with
  // no directory is an empty folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D3), which is the normal state of a new
  // play's Characters and Notes.
  const missing: BinderItem[] = [];
  const removed: BinderItem[] = [];
  const prune = (items: BinderItem[]): BinderItem[] => {
    const out: BinderItem[] = [];
    for (const it of items) {
      if (it.children) it.children = prune(it.children);
      // An incomplete walk says nothing about what is gone: a folder that
      // could not be listed — permissions, a drive on its way out — used to
      // read as empty, and its sheets as deleted.
      if (it.type === "folder" || presentIds.has(it.id) || !complete) {
        out.push(it);
        continue;
      }
      if (it.type === "script") {
        // Kept. It carries cards and a version ring, and a script vanishing is
        // exactly when the app should speak up rather than tidy up.
        missing.push(it);
        out.push(it);
        continue;
      }
      removed.push(it);
    }
    return out;
  };

  return { binder: prune(next), added, missing, removed, updated };
}

/** Every path the binder currently names (leaves and folders). */
export function binderPaths(binder: BinderItem[]): Set<string> {
  return new Set(flatten(binder).map((i) => i.path).filter(Boolean));
}

export interface DiskWalk {
  nodes: DiskNode[];
  /** False when a folder could not be listed, so absence proves nothing. */
  complete: boolean;
}

/**
 * Walk the whole play folder. Returns every directory and every file that is
 * not ignored, as paths relative to the play folder, and whether every folder
 * answered.
 */
export async function walkPlay(): Promise<DiskWalk> {
  const out: DiskNode[] = [];
  let complete = true;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await vault.list(dir);
    } catch (e) {
      // A folder that is not there is empty (docs/app/keeping-work/storage-and-file-format.md#STOR-D3: a binder folder is a row
      // until its first file). One that cannot be read is unknown.
      if (!/no such file|not found|ENOENT|os error 2\b/i.test(String(e))) complete = false;
      return;
    }
    for (const e of entries) {
      if (e.isDir) {
        if (ignoredDir(e.name)) continue;
        out.push({ path: e.relPath, isDir: true });
        await walk(e.relPath);
      } else if (!ignoredFile(e.name)) {
        out.push({ path: e.relPath, isDir: false });
      }
    }
  }
  await walk("");
  return { nodes: out, complete };
}

/**
 * The whole reconciliation, with the I/O around it: walk the folder, read each
 * new Markdown file's front matter so its own `type:` can win, then file.
 */
export async function reconcileBinder(
  binder: BinderItem[],
): Promise<Reconciliation> {
  const { nodes: disk, complete } = await walkPlay();
  const known = new Set([...binderPaths(binder)].map(pathKey));
  const knownIds = new Set(flatten(binder).map((item) => item.id));

  // Only unfiled Markdown needs reading; everything else types by extension.
  const types = new Map<string, BinderItemType>();
  const ids = new Map<string, string>();
  for (const node of disk) {
    if (node.isDir || known.has(pathKey(node.path))) continue;
    let content: string | null = null;
    if (/\.(md|markdown)$/i.test(node.path)) {
      try {
        content = (await vault.read(node.path)).content;
        const fields = splitFrontMatter(content).fields;
        if (fields.type && fields.id && (isUlid(fields.id) || knownIds.has(fields.id))) ids.set(node.path, fields.id);
      } catch {
        content = null; // unreadable (evicted, binary): type it by name
      }
    }
    types.set(node.path, inferType(node.path, content));
  }

  return reconcile(binder, disk, (p) => types.get(p) ?? inferType(p, null), ulid, complete, (p) => ids.get(p));
}
