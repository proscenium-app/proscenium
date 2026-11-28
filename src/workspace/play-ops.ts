// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a writer does to a whole play: copy it, rename it, start a new play
 * from its setup, and hand it on, or take one in, as a single .zip
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-208 to
 * docs/app/keeping-work/storage-and-file-format.md#STOR-200).
 *
 * Everything here but `playZip` runs with the PLAYS FOLDER open, never a play:
 * a play's own vault is rooted inside the folder these change. The caller
 * leaves the play first (useWorkspace's `openAny`), which lands or keeps every
 * word, and comes back to it after.
 *
 * Each new play is written as every new play is (vault-plays.ts): its folder
 * reserved so no two copies can share it, every file created and never
 * written over, and the play file last, because the play file is what makes a
 * folder a play. A copy that stops part of the way leaves a folder that is not
 * a play, and the original exactly as it was.
 */

import { version as APP_VERSION } from "../../package.json";
import { splitTitlePage } from "../fountain";
import { vault } from "../storage";
import { pathKey } from "../storage/path-key";
import { ulid } from "../storage/ulid";
import { fileName, uniqueFileName } from "./filename";
import {
  choosePlayFile,
  commitPlay,
  decodePlayFile,
  isPlayFileName,
  playFileName,
  readPlayFile,
  BASE_SCHEMA,
  serializePlay,
  type BinderItem,
  type PlayFile,
  type ScriptData,
} from "./play-file";

/** The most a play can weigh in a .zip, as an export may (src-tauri/src/export.rs). */
export const PLAY_ZIP_LIMIT = 256 * 1024 * 1024;

/** The earliest date a zip entry can hold, in local time. */
const ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0);

/** A name the Plays folder already has: the writer is asked for another. */
export class PlayNameTaken extends Error {
  constructor(readonly name: string) {
    super(`A play named “${name}” is already in your Plays folder.`);
  }
}

/**
 * Every file of the play at `prefix` ("" for the open play), relative to the
 * play's folder, in a stable order. Hidden files (a Finder's `.DS_Store`), a
 * sync service's own files and the app's momentary temp files are left out:
 * nothing of a play is hidden (docs/app/keeping-work/storage-and-file-format.md#STOR-111).
 */
export async function playFiles(prefix: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string) => {
    const at = [prefix, rel].filter(Boolean).join("/");
    for (const entry of await vault.list(at)) {
      if (entry.name.startsWith(".") || entry.isSyncArtifact) continue;
      const inner = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDir) await walk(inner);
      else out.push(inner);
    }
  };
  await walk("");
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Whether a new play folder may take `name`, as the file system compares names. */
export async function playNameFree(name: string, except?: string): Promise<boolean> {
  const wanted = pathKey(name);
  return !(await vault.list("")).some(
    (entry) =>
      pathKey(entry.name) === wanted && !(except && pathKey(entry.name) === pathKey(except)),
  );
}

/** The play in `dir`: its play file's name, what it holds, and that file's hash. */
async function readPlayIn(dir: string): Promise<{ file: string; data: PlayFile; hash: string }> {
  const names = (await vault.list(dir)).filter((e) => !e.isDir).map((e) => e.name);
  const file = choosePlayFile(dir, names);
  if (!file) throw new Error(`“${dir}” has no play file, so it is not a play.`);
  const read = await readPlayFile(`${dir}/${file}`);
  if (read.status === "unsupported")
    throw new Error(`“${dir}” was saved by a newer Proscenium. Update Proscenium first.`);
  if (read.status !== "valid")
    throw new Error(`The details of “${dir}” could not be read, so it was left as it is.`);
  return { file, data: read.data, hash: read.hash };
}

/** The play's script: the first script in the binder's order. */
export function mainScript(binder: readonly BinderItem[]): BinderItem | null {
  for (const item of binder) {
    if (item.type === "script") return item;
    const inner = item.children ? mainScript(item.children) : null;
    if (inner) return inner;
  }
  return null;
}

/** The binder with one item's path changed. */
function withPath(binder: readonly BinderItem[], id: string, path: string): BinderItem[] {
  return binder.map((item) =>
    item.id === id
      ? { ...item, path }
      : item.children
        ? { ...item, children: withPath(item.children, id, path) }
        : item,
  );
}

/** Write a new play's play file, last, and read it back before the play counts. */
async function writePlayLast(rel: string, play: PlayFile): Promise<void> {
  const text = serializePlay(play);
  await vault.create(rel, text);
  if ((await vault.read(rel)).content !== text)
    throw new Error("The copy could not be verified. The original play is kept.");
}

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function inFolder(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/**
 * The name a new play's folder takes from what the writer typed. Empty when
 * nothing of it can name a folder.
 */
export function playFolderName(typed: string): string {
  // Nothing typed names nothing: `fileName` would call it Untitled.
  return typed.trim() ? fileName(typed.trim()) : "";
}

/**
 * Duplicate Play (docs/app/keeping-work/storage-and-file-format.md#STOR-197):
 * every file of the play in `dir`, byte for byte, in a new folder named
 * `name`, with a play file of its own. The copy is a new play: a fresh id, so
 * it never shares Versions, Changes or recovery with the original, and today
 * as the day it was made. Its script, where it is named for the play, takes
 * the copy's name, so the copy's script is named for its play as a new play's
 * is. Returns the copy's folder.
 */
export async function duplicatePlay(dir: string, name: string, nowIso: string): Promise<string> {
  const target = playFolderName(name);
  if (!target) throw new Error("Give the copy a name.");
  if (!(await playNameFree(target))) throw new PlayNameTaken(target);
  const { data } = await readPlayIn(dir);
  const files = await playFiles(dir);

  const carried = typeof data.renamedFrom === "string" ? data.renamedFrom : null;
  const script = data.binder.find(
    (item) =>
      item.type === "script" &&
      [dir, carried].some((n) => n !== null && pathKey(item.path) === pathKey(`${n}.fountain`)),
  );
  const scriptTo = `${target}.fountain`;
  const renameScript =
    !!script && !files.some((f) => f !== script.path && pathKey(f) === pathKey(scriptTo));

  await vault.reserveDir(target);
  for (const file of files) {
    // The play file is written last, new; another one beside it is a sync
    // service's second copy
    // (docs/app/keeping-work/storage-and-file-format.md#STOR-58), and a copy of
    // the play takes the play.
    if (!file.includes("/") && isPlayFileName(file)) continue;
    const to = renameScript && file === script!.path ? scriptTo : file;
    await vault.copyFile(`${dir}/${file}`, `${target}/${to}`);
  }
  const { renamedFrom: _followed, ...rest } = data;
  void _followed;
  await writePlayLast(`${target}/${playFileName(target)}`, {
    ...rest,
    id: ulid(),
    created: nowIso,
    modified: nowIso,
    generator: { ...data.generator, app: "Proscenium", version: APP_VERSION },
    binder: renameScript ? withPath(data.binder, script!.id, scriptTo) : data.binder,
  });
  return target;
}

/** Two titles the same to a reader: emphasis, spacing and case aside. */
export function sameTitle(a: string | undefined, b: string): boolean {
  const plain = (s: string) =>
    s.normalize("NFC").replace(/[*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return a !== undefined && plain(a) === plain(b);
}

const KEY_RE = /^([A-Za-z][A-Za-z0-9 ]*?):[ \t]*(.*)$/;
const INDENT_RE = /^( {3,}|\t)/;

/**
 * A script's title page with its title set to `title`, and the keys named in
 * `drop` taken off. Only those lines change: every other key stays as the
 * writer wrote it. A script with no title page gets one holding the title.
 */
export function withTitle(source: string, title: string, drop: readonly string[] = []): string {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const opens = lines.length > 0 && KEY_RE.test(lines[0]) && !INDENT_RE.test(lines[0]);
  const hasPage = opens && Object.keys(splitTitlePage(lines.join("\n")).frontMatter).length > 0;
  if (!hasPage) return [`Title: ${title}`, "", ...lines].join(eol);
  let end = 0;
  while (end < lines.length && lines[end].trim() !== "") end += 1;
  const out: string[] = [];
  let titled = false;
  for (let i = 0; i < end; ) {
    const key = KEY_RE.exec(lines[i])?.[1]?.trim().toLowerCase();
    let next = i + 1;
    while (next < end && INDENT_RE.test(lines[next])) next += 1;
    if (key === "title") {
      if (!titled) out.push(`Title: ${title}`);
      titled = true;
    } else if (!key || !drop.includes(key)) {
      out.push(...lines.slice(i, next));
    }
    i = next;
  }
  if (!titled) out.unshift(`Title: ${title}`);
  return [...out, ...lines.slice(end)].join(eol);
}

/**
 * What Rename Play needs to ask: the title on the play's title page, and
 * whether it is the play's name, so the new name can take its place there.
 * `prefix` is "" for the open play, or the play's folder in the Plays folder.
 */
export async function titleFacts(
  prefix: string,
  playFile: string,
  name: string,
): Promise<{ title: string | null; isName: boolean }> {
  const at = (p: string) => (prefix ? `${prefix}/${p}` : p);
  const read = await readPlayFile(at(playFile));
  if (read.status !== "valid") return { title: null, isName: false };
  const script = mainScript(read.data.binder);
  if (!script) return { title: null, isName: false };
  try {
    const { content } = await vault.read(at(script.path));
    const title = splitTitlePage(content.replace(/\r\n?/g, "\n")).frontMatter.title ?? null;
    return { title, isName: title !== null && sameTitle(title, name) };
  } catch {
    return { title: null, isName: false };
  }
}

/**
 * Rename Play (docs/app/keeping-work/storage-and-file-format.md#STOR-208):
 * the play's folder and its play file take the new name together, as
 * docs/app/keeping-work/storage-and-file-format.md#STOR-35 says they are
 * always named. With `title`, the play's title page shows the new name too.
 * The script named for the play follows when the play next opens, by the
 * binder's own rename, which keeps its cards and comments with it: the play
 * file says which name it still has (`renamedFrom`). Returns the new folder.
 */
export async function renamePlay(
  dir: string,
  name: string,
  options: { title: boolean },
  nowIso: string,
): Promise<string> {
  const target = playFolderName(name);
  if (!target) throw new Error("Give the play a name.");
  if (target === dir) return dir;
  if (!(await playNameFree(target, dir))) throw new PlayNameTaken(target);
  const { file, data } = await readPlayIn(dir);
  const script = mainScript(data.binder);

  // A case-only change is a rename to a name the file system calls the same:
  // the vault goes through a name of its own between the two.
  await vault.rename(dir, target);
  const playFile = playFileName(target);
  if (file !== playFile) await vault.rename(`${target}/${file}`, `${target}/${playFile}`);

  if (options.title && script) {
    const rel = `${target}/${script.path}`;
    const { content, hash } = await vault.read(rel);
    const out = await vault.write(rel, withTitle(content, name.trim()), hash);
    if (out.status !== "ok")
      throw new Error(
        `“${target}” is renamed, but its title page changed as it was being written.`,
      );
  }

  // The name the play's script still carries: the oldest one, through any
  // number of renames before the play is opened again.
  const carried = typeof data.renamedFrom === "string" ? data.renamedFrom : dir;
  const named = data.binder.some(
    (item) => item.type === "script" && pathKey(item.path) === pathKey(`${carried}.fountain`),
  );
  const follow = named && carried !== target ? carried : undefined;
  if (follow !== data.renamedFrom) {
    const read = await readPlayFile(`${target}/${playFile}`);
    if (read.status === "valid")
      await commitPlay(
        `${target}/${playFile}`,
        { data: read.data, hash: read.hash },
        (prior) => {
          const { renamedFrom: _old, ...rest } = prior ?? read.data;
          void _old;
          return follow ? { ...rest, renamedFrom: follow } : rest;
        },
        nowIso,
      );
  }
  return target;
}

/**
 * The script a rename left behind: the top-level script still named
 * `renamedFrom`, which takes the play's name now. Null when there is none, or
 * when the play's name is already taken by another file beside it.
 */
export function scriptToFollow(
  play: PlayFile,
  folder: string,
): { id: string; from: string } | null {
  const from = typeof play.renamedFrom === "string" ? play.renamedFrom : null;
  if (!from || from === folder) return null;
  const script = play.binder.find(
    (item) => item.type === "script" && pathKey(item.path) === pathKey(`${from}.fountain`),
  );
  if (!script) return null;
  const taken = play.binder.some(
    (item) => item.id !== script.id && pathKey(item.path) === pathKey(`${folder}.fountain`),
  );
  return taken ? null : { id: script.id, from };
}

/** The opening of a new play's script, under its title page (vault-plays.ts). */
const NEW_PLAY_BODY = "# ACT ONE\n\n## Scene 1\n\nA bare stage.\n";

/**
 * New Play Like This (docs/app/keeping-work/storage-and-file-format.md#STOR-198):
 * a new play named `name` with the setup of the play in `dir` and none of its
 * writing. It keeps the format, language and settings, the binder's folders
 * (empty), and the pages before and after the script, as they are. Its script
 * opens with the old script's title page (the credit, the author, the
 * contact), the new title and no draft date, then a new play's first scene.
 */
export async function newPlayLike(
  dir: string,
  name: string,
  nowIso: string,
  status: string | null,
): Promise<string> {
  const target = playFolderName(name);
  if (!target) throw new Error("Give the new play a name.");
  if (!(await playNameFree(target))) throw new PlayNameTaken(target);
  const { data } = await readPlayIn(dir);
  const main = mainScript(data.binder);
  const claims: ScriptData | undefined = main ? data.scripts[main.id] : undefined;
  const pageFolders = new Set(
    [claims?.frontMatter?.folder, claims?.backMatter?.folder].filter(
      (id): id is string => typeof id === "string",
    ),
  );

  let titled = `Title: ${name.trim()}\nCredit: a play by\n\n${NEW_PLAY_BODY}`;
  if (main) {
    try {
      const { content } = await vault.read(`${dir}/${main.path}`);
      const { frontMatter } = splitTitlePage(content.replace(/\r\n?/g, "\n"));
      if (Object.keys(frontMatter).length) {
        const page = withTitle(content.replace(/\r\n?/g, "\n"), name.trim(), [
          "draft date",
          "date",
        ]);
        titled = `${splitHead(page)}\n\n${NEW_PLAY_BODY}`;
      }
    } catch {
      /* A script that cannot be read gives a new play's title page. */
    }
  }

  const scriptId = ulid();
  const scriptPath = inFolder(main ? folderOf(main.path) : "", `${target}.fountain`);
  const folderIds = new Map<string, string>();
  const pages: string[] = [];
  const build = (items: readonly BinderItem[], pagesHere: boolean): BinderItem[] =>
    items.flatMap((item): BinderItem[] => {
      if (item.type === "folder") {
        const id = ulid();
        folderIds.set(item.id, id);
        const inside = pagesHere || pageFolders.has(item.id);
        return [{ ...item, id, children: build(item.children ?? [], inside) }];
      }
      if (main && item.id === main.id) return [{ id: scriptId, type: "script", path: scriptPath }];
      if (pagesHere && item.type !== "script") {
        pages.push(item.path);
        return [{ ...item, id: ulid() }];
      }
      return [];
    });
  let binder = build(data.binder, false);
  if (!main) binder = [{ id: scriptId, type: "script", path: scriptPath }, ...binder];

  const there = new Set((await playFiles(dir)).map(pathKey));
  const missing = new Set(pages.filter((p) => !there.has(pathKey(p))));
  if (missing.size) binder = dropPaths(binder, missing);

  await vault.reserveDir(target);
  for (const page of pages) {
    if (!missing.has(page)) await vault.copyFile(`${dir}/${page}`, `${target}/${page}`);
  }
  await vault.create(`${target}/${scriptPath}`, titled);
  const front = claims?.frontMatter?.folder;
  const back = claims?.backMatter?.folder;
  await writePlayLast(`${target}/${playFileName(target)}`, {
    kind: data.kind,
    schemaVersion: BASE_SCHEMA,
    id: ulid(),
    ...(status ? { status } : {}),
    created: nowIso,
    modified: nowIso,
    generator: { app: "Proscenium", version: APP_VERSION },
    settings: { ...data.settings },
    binder,
    scripts: {
      [scriptId]: {
        scenes: [],
        orphans: [],
        ...(front && folderIds.has(front)
          ? { frontMatter: { folder: folderIds.get(front)! } }
          : {}),
        ...(back && folderIds.has(back) ? { backMatter: { folder: folderIds.get(back)! } } : {}),
      },
    },
  });
  return target;
}

/** The title page alone: the lines before its first blank one. */
function splitHead(source: string): string {
  const lines = source.split("\n");
  let end = 0;
  while (end < lines.length && lines[end].trim() !== "") end += 1;
  return lines.slice(0, end).join("\n");
}

function dropPaths(binder: readonly BinderItem[], paths: ReadonlySet<string>): BinderItem[] {
  return binder
    .filter((item) => !paths.has(item.path))
    .map((item) => (item.children ? { ...item, children: dropPaths(item.children, paths) } : item));
}

function fromBase64(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * Export Play (docs/app/keeping-work/storage-and-file-format.md#STOR-199):
 * every file of the play at `prefix` ("" for the open play), byte for byte,
 * in one .zip whose one folder is the play's, named `folder`. Unzipped, it is
 * the play folder as it was, ready to go in any Plays folder.
 */
export async function playZip(prefix: string, folder: string): Promise<Uint8Array> {
  const { zipSync } = await import("fflate");
  const at = (p: string) => (prefix ? `${prefix}/${p}` : p);
  let total = 0;
  const entries: { path: string; data: Uint8Array }[] = [];
  for (const file of await playFiles(prefix)) {
    let base64: string;
    try {
      base64 = await vault.readBinary(at(file));
    } catch (error) {
      throw new Error(`“${file}” could not be read, so nothing was exported. ${String(error)}`);
    }
    const data = fromBase64(base64);
    total += data.length;
    if (total > PLAY_ZIP_LIMIT)
      throw new Error("This play is larger than 256 MB, which is more than one .zip can take.");
    entries.push({ path: `${folder}/${file}`, data });
  }
  // Each file deflated, dated as a zip entry can be and never "now", so the
  // same play makes the same .zip.
  const zippable: Record<string, [Uint8Array, { level: 6; mtime: Date }]> = {};
  for (const { path, data } of entries) zippable[path] = [data, { level: 6, mtime: ZIP_DATE }];
  return zipSync(zippable);
}

/** What a .zip holds when it holds a play: its folder's name, and its files by path in it. */
export interface ZippedPlay {
  folder: string;
  playFile: string;
  files: Map<string, Uint8Array>;
}

/**
 * The play inside a .zip, or null when it holds none: a play's folder at its
 * top (as Export Play and Finder's Compress make one), or a play's files at
 * its top. A path that climbs out (`..`), or starts at a root, refuses the
 * whole .zip. A Mac's `__MACOSX` folder and hidden files are left out.
 */
export async function readZippedPlay(bytes: Uint8Array): Promise<ZippedPlay | null> {
  const { unzipSync } = await import("fflate");
  let total = 0;
  const raw = unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize;
      if (total > PLAY_ZIP_LIMIT)
        throw new Error("This .zip unpacks to more than 256 MB, more than a play can be.");
      return true;
    },
  });
  const files = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(raw)) {
    if (path.endsWith("/")) continue;
    const parts = path.split("/");
    if (path.startsWith("/") || path.includes("\\") || parts.some((p) => p === ".." || p === "."))
      throw new Error("This .zip names a file outside its own folder, so it was not opened.");
    if (parts[0] === "__MACOSX" || parts.some((p) => p.startsWith("."))) continue;
    files.set(path.normalize("NFC"), data);
  }
  const tops = new Set([...files.keys()].map((p) => (p.includes("/") ? p.split("/")[0] : "")));
  if (tops.size === 1 && !tops.has("")) {
    const [folder] = tops;
    const inside = new Map<string, Uint8Array>();
    for (const [path, data] of files) inside.set(path.slice(folder.length + 1), data);
    const playFile = choosePlayFile(
      folder,
      [...inside.keys()].filter((p) => !p.includes("/")),
    );
    return playFile ? { folder, playFile, files: inside } : null;
  }
  const loose = [...files.keys()].filter((p) => !p.includes("/") && isPlayFileName(p));
  if (loose.length === 0) return null;
  const folder = loose.sort()[0].replace(/\.proscenium$/, "");
  const playFile = choosePlayFile(folder, loose)!;
  return { folder, playFile, files };
}

/**
 * Add a play from a .zip to the Plays folder
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-200): its files, as
 * they are, in a new folder named for the play (a number after it when the
 * name is taken), the play file last. Nothing already in the Plays folder is
 * written over. The play keeps its id unless a play there has it already,
 * when it takes a new one, so the two never share Versions. Returns the folder.
 */
export async function addZippedPlay(
  zipped: ZippedPlay,
  idsInUse: ReadonlySet<string>,
): Promise<string> {
  const decoded = decodePlayFile(new TextDecoder().decode(zipped.files.get(zipped.playFile)!), "");
  if (decoded.status !== "valid" && decoded.status !== "unsupported")
    throw new Error("The play's details in this .zip could not be read, so it was not added.");
  const play = decoded.data;
  const target = uniqueFileName(
    playFolderName(zipped.folder) || "Play",
    (await vault.list("")).map((e) => e.name),
  );
  await vault.reserveDir(target);
  for (const [path, data] of zipped.files) {
    if (!path.includes("/") && isPlayFileName(path)) continue;
    await vault.createBinary(`${target}/${path}`, toBase64(data));
  }
  const fresh = idsInUse.has(play.id);
  const rel = `${target}/${playFileName(target)}`;
  if (fresh) await writePlayLast(rel, { ...play, id: ulid() });
  else await vault.createBinary(rel, toBase64(zipped.files.get(zipped.playFile)!));
  return target;
}
