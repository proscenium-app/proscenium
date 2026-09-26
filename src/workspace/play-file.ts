// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The play file — `<Play>.proscenium` (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
 *
 * One JSON file per play. It absorbs what used to be three: the workspace
 * manifest (`project.json`), the binder (`subproject.json`), and every
 * per-script card index (`*.index.json`). This module is the ONLY reader and
 * writer of it.
 *
 * What it owns is narrow on purpose: order, nesting intent, card metadata,
 * settings. Existence and content come from disk (docs/app/keeping-work/storage-and-file-format.md#STOR-D8), and the title of
 * anything is its filename (docs/app/keeping-work/storage-and-file-format.md#STOR-D4) — which is why a binder entry carries no
 * `title` and the file carries no play title at all.
 *
 * What is deliberately absent: `_act`, `_heading`, `_synopsis`, `sourceHash`,
 * and a per-script `modified`. All are derivable from the script, and a file
 * that rewrites on every keystroke is a file that conflicts under folder sync.
 * The derived half lives in memory as `SceneCard` (card-reconcile.ts) and in
 * the app's cache (docs/app/keeping-work/storage-and-file-format.md#STOR-D10), never here.
 */
import { vault, type WriteOutcome } from "../storage";
import { PLAY_TMPL, parseJson, stringifyCanonical } from "./json-io";
import { canonicalLanguage } from "./language";

/** The extension that makes a directory a play (docs/app/keeping-work/storage-and-file-format.md#STOR-21 discovery). */
export const PLAY_EXT = ".proscenium";

export const PLAY_KIND = "proscenium/play";

export const SCHEMA_VERSION = 1;

/**
 * What a binder row is.
 *
 * Five kinds mean something: a `script` (a .fountain), a `folder`, a
 * `character` (the Cast surface reads it and the app maintains a section
 * inside it), an `outline` (the Outline surface's scratchpad), and a
 * `reference` (anything that opens outside the app). Everything else the
 * writer makes is a `document` — a blank .md page.
 *
 * `note` | `research` | `logline` were the pre-1.0 names. They are gone: no
 * play file on disk says them, because no play file predates this schema.
 */
export type BinderItemType =
  | "script"
  | "folder"
  | "character"
  | "document"
  | "outline"
  | "reference";

/**
 * One binder row.
 *
 * `path` is relative to the PLAY FOLDER, forward-slash, and folders carry one
 * too (a folder is a real directory). There is no `title`: the title is the
 * filename (docs/app/keeping-work/storage-and-file-format.md#STOR-D4). There is no `index`: card data lives in `scripts` (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
 */
export interface BinderItem {
  id: string;
  type: BinderItemType;
  path: string;
  children?: BinderItem[];
  [k: string]: unknown; // preserve-unknown passthrough
}

export type CardColor =
  | "cream"
  | "oxide"
  | "ink"
  | "sea"
  | "moss"
  | "amber"
  | "ash";

export type CardStatus = string;

export interface Card {
  color: CardColor;
  status: CardStatus;
  label: string;
  boardNote: string;
  [k: string]: unknown; // preserve-unknown
}

export interface SceneAnchor {
  ordinal: number;
  headingHash: string;
  embeddedId: string | null;
}

/**
 * A scene's stored record: identity, how it binds to a scene in the script,
 * and the four card fields Fountain cannot express. Nothing derived.
 */
export interface SceneRecord {
  id: string;
  anchor: SceneAnchor;
  card: Card;
  [k: string]: unknown;
}

/** Everything the play file holds about one script, keyed by its binder id. */
export interface ScriptData {
  scenes: SceneRecord[];
  orphans: SceneRecord[];
  /**
   * ALL-CAPS cue names the writer has deliberately left off the printed cast
   * page. Canonical here because Fountain has nowhere to put it: the script
   * says VOICE speaks, and only this says "don't list VOICE". Without it,
   * auto-add would undo every removal the moment it was made.
   */
  castHidden?: string[];
  [k: string]: unknown;
}

export interface PlaySettings {
  /** BCP 47 writing, spelling and PDF language; absent means en-US. */
  language?: string;
  /** A format id from `formats/` — never format values. */
  format?: string;
  /** How a card binds to its scene (docs/app/keeping-work/storage-and-file-format.md#STOR-D6). */
  sceneAnchors?: "manifest" | "embedded";
  autosave?: { debounceMs: number; maxWaitMs: number };
  [k: string]: unknown;
}

export interface PlayFile {
  kind: typeof PLAY_KIND;
  schemaVersion: number;
  id: string;
  /** Free-form workflow label shown on the Plays screen. */
  status?: string;
  /** One line, shown on the Plays screen, editable there. */
  logline?: string;
  created: string;
  modified: string;
  generator: { app: string; version: string; [k: string]: unknown };
  settings: PlaySettings;
  binder: BinderItem[];
  /** Keyed by the script's BINDER id. */
  scripts: Record<string, ScriptData>;
  [k: string]: unknown;
}

export interface Loaded<T> {
  data: T;
  hash: string;
}

export function defaultCard(): Card {
  return { color: "cream", status: "", label: "", boardNote: "" };
}

export function emptyScriptData(): ScriptData {
  return { scenes: [], orphans: [] };
}

/** The play file's name for a play folder: `<folder name>.proscenium` (docs/app/keeping-work/storage-and-file-format.md#STOR-D4). */
export function playFileName(folderName: string): string {
  return `${folderName}${PLAY_EXT}`;
}

export function isPlayFileName(name: string): boolean {
  return name.endsWith(PLAY_EXT) && name.length > PLAY_EXT.length;
}

/**
 * Which of a folder's `.proscenium` files IS the play (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
 *
 * The one named for the folder wins. When that is absent — a folder renamed in
 * Finder — the single remaining one is adopted and the caller renames it to
 * match. Several with no match is ambiguous, and picking by sort order at
 * least makes it deterministic; the others are surfaced under Changes as other
 * versions of the play file, never merged and never removed.
 */
export function choosePlayFile(
  folderName: string,
  names: string[],
): string | null {
  const candidates = names.filter(isPlayFileName).sort();
  if (candidates.length === 0) return null;
  const wanted = playFileName(folderName);
  return candidates.includes(wanted) ? wanted : candidates[0];
}

export function isReadOnly(schemaVersion: unknown): boolean {
  return typeof schemaVersion === "number" && schemaVersion > SCHEMA_VERSION;
}

export function serializePlay(play: PlayFile): string {
  return stringifyCanonical(play, PLAY_TMPL);
}

export type PlayRead =
  | ({ status: "valid" | "unsupported"; raw: string } & Loaded<PlayFile>)
  | { status: "malformed"; raw: string; hash: string; message: string }
  | { status: "absent" | "unreadable"; message: string };

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/** Validate known shapes without normalising away malformed data or unknown keys. */
export function validPlayShape(value: unknown): value is PlayFile {
  if (!object(value) || value.kind !== PLAY_KIND || !id(value.id) ||
      !Number.isInteger(value.schemaVersion) || Number(value.schemaVersion) < 1 ||
      typeof value.created !== "string" || typeof value.modified !== "string" ||
      !object(value.generator) || typeof value.generator.app !== "string" || typeof value.generator.version !== "string" ||
      !object(value.settings) || !object(value.scripts)) return false;
  for (const key of ["status", "logline"]) if (value[key] !== undefined && typeof value[key] !== "string") return false;
  const settings = value.settings;
  if (settings.format !== undefined && typeof settings.format !== "string") return false;
  if (settings.language !== undefined &&
      (typeof settings.language !== "string" || !canonicalLanguage(settings.language))) return false;
  if (settings.sceneAnchors !== undefined && !["manifest", "embedded"].includes(String(settings.sceneAnchors))) return false;
  if (settings.autosave !== undefined) {
    if (!object(settings.autosave)) return false;
    for (const key of ["debounceMs", "maxWaitMs"]) {
      if (typeof settings.autosave[key] !== "number" || !Number.isFinite(settings.autosave[key]) || settings.autosave[key] < 0) return false;
    }
  }
  const ids = new Set<string>();
  const binder = (items: unknown, depth = 0): boolean => Array.isArray(items) && depth < 128 && items.every((item) => {
    if (!object(item) || !id(item.id) || ids.has(item.id) || typeof item.path !== "string" || !item.path ||
        item.path.startsWith("/") || item.path.split("/").some((part) => part === "..") ||
        !["script", "folder", "character", "document", "outline", "reference"].includes(String(item.type))) return false;
    ids.add(item.id);
    return item.children === undefined || (item.type === "folder" && binder(item.children, depth + 1));
  });
  if (!binder(value.binder)) return false;
  const scene = (s: unknown): boolean => {
    if (!object(s) || !id(s.id) || !object(s.anchor) || !object(s.card)) return false;
    const a = s.anchor, c = s.card;
    return Number.isInteger(a.ordinal) && Number(a.ordinal) >= 0 && typeof a.headingHash === "string" &&
      (a.embeddedId === null || typeof a.embeddedId === "string") &&
      ["cream", "oxide", "ink", "sea", "moss", "amber", "ash"].includes(String(c.color)) &&
      typeof c.status === "string" && c.status.length <= 40 && !/\p{Cc}/u.test(c.status) &&
      typeof c.label === "string" && typeof c.boardNote === "string";
  };
  return Object.entries(value.scripts).every(([key, script]) => id(key) && object(script) &&
    Array.isArray(script.scenes) && script.scenes.every(scene) && Array.isArray(script.orphans) && script.orphans.every(scene) &&
    (script.castHidden === undefined || strings(script.castHidden)));
}

export function decodePlayFile(raw: string, hash: string): PlayRead {
  try {
    const data: unknown = parseJson(raw);
    if (!validPlayShape(data)) return { status: "malformed", raw, hash, message: "This play's details need repair." };
    return { status: isReadOnly(data.schemaVersion) ? "unsupported" : "valid", data, hash, raw };
  } catch {
    return { status: "malformed", raw, hash, message: "This play's details need repair." };
  }
}

/** Absence is different from a file whose bytes cannot be safely interpreted. */
export async function readPlayFile(rel: string): Promise<PlayRead> {
  try {
    const { content, hash } = await vault.read(rel);
    return decodePlayFile(content, hash);
  } catch (e) {
    const message = String(e);
    return { status: /ENOENT|no such file|os error 2\b/i.test(message) ? "absent" : "unreadable", message };
  }
}

export function writePlayFile(
  rel: string,
  play: PlayFile,
  expected: string | null,
): Promise<WriteOutcome> {
  /*
   * `derived: true` selects the STALE policy (docs/app/keeping-work/storage-and-file-format.md#STOR-D9): a mismatch reports
   * disk truth and writes nothing, rather than preserving our bytes anywhere.
   *
   * The play file is not derived — it is canonical — but it is the one file
   * with several legitimate writers (the reconciler, a card edit, a sync), and
   * docs/app/keeping-work/storage-and-file-format.md#STOR-D9 gives it the rebase-once path for exactly that reason. `commitPlay`
   * below is the rebase; nothing else may call this without one.
   */
  return vault.write(rel, serializePlay(play), expected, true);
}

/** Whether two play files differ in anything but `modified` (docs/app/keeping-work/storage-and-file-format.md#STOR-D5). */
export function sameIgnoringModified(a: PlayFile, b: PlayFile): boolean {
  const strip = (p: PlayFile) => {
    const { modified, ...rest } = p;
    void modified;
    return rest;
  };
  return (
    stringifyCanonical(strip(a), PLAY_TMPL) ===
    stringifyCanonical(strip(b), PLAY_TMPL)
  );
}

export type PlayCommit =
  | { status: "ok"; data: PlayFile; hash: string }
  /**
   * Not written. `data`/`hash` are what is actually on disk now — adopt them.
   * Re-asserting the old expectation is exactly what looped before.
   */
  | { status: "stale"; data: PlayFile | null; hash: string | null }
  /** Not written: the file is from a newer Proscenium (docs/app/keeping-work/storage-and-file-format.md#STOR-D14), here or after a re-read. */
  | { status: "read-only" };

/**
 * Commit a change to the play file under optimistic concurrency, rebasing once
 * instead of re-asserting a stale hash (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
 *
 * The file has several legitimate writers: our own reconcile, a card edit,
 * another tool, any sync. When one of them writes it, the thing that is wrong
 * is our cached hash, not the disk. The pre-1.0 code re-asserted that stale
 * hash on every autosave tick, so every tick collided and preserved our bytes
 * to a fresh sibling — 48 `*-conflict-*.json` files in one sitting, with the
 * canonical index frozen at the other writer's version (2026-07-26,
 * conflict-repro.log).
 *
 * So: on mismatch, re-read disk, rebuild the intended change on top of what is
 * really there, write once more. `build` must therefore be replayable against
 * a different base. One retry only — a second mismatch is genuine contention,
 * and the caller reports it rather than looping.
 *
 * `modified` moves only when something other than `modified` changed, so a
 * synced play file stays quiet while the writer types (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
 */
export async function commitPlay(
  rel: string,
  base: Loaded<PlayFile> | null,
  build: (prior: PlayFile | null) => PlayFile,
  nowIso: string,
): Promise<PlayCommit> {
  let priorData = base?.data ?? null;
  let priorHash: string | null = base?.hash ?? ""; // absent base authorises creation only
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Checked on every attempt: a rebase re-reads the file, and what arrived
    // there may be from a newer app (docs/app/keeping-work/storage-and-file-format.md#STOR-57).
    if (isReadOnly(priorData?.schemaVersion)) return { status: "read-only" };
    const next = build(priorData);
    if (priorData && sameIgnoringModified(priorData, next)) {
      // Nothing this file owns actually changed. Writing would only move
      // `modified` and produce a file event in a watched, synced tree.
      return { status: "ok", data: priorData, hash: priorHash ?? "" };
    }
    next.modified = nowIso;
    const out = await writePlayFile(rel, next, priorHash);
    if (out.status === "ok") return { status: "ok", data: next, hash: out.hash };
    const fresh = await readPlayFile(rel);
    if (fresh.status === "unsupported") return { status: "read-only" };
    // A failed decode is never permission to write with the collision's raw
    // hash. Keep those bytes untouched, and let the protected view explain it.
    if (fresh.status !== "valid") return { status: "stale", data: null, hash: null };
    priorData = fresh.data;
    priorHash = fresh.hash;
  }
  return { status: "stale", data: priorData, hash: priorHash };
}

/** The script data for a binder id, or an empty one. Never mutates the file. */
export function scriptDataFor(play: PlayFile | null, binderId: string): ScriptData {
  const found = play?.scripts?.[binderId];
  if (!found) return emptyScriptData();
  return {
    ...found,
    scenes: Array.isArray(found.scenes) ? found.scenes : [],
    orphans: Array.isArray(found.orphans) ? found.orphans : [],
  };
}

/** A copy of `play` with one script's data replaced. */
export function withScriptData(
  play: PlayFile,
  binderId: string,
  data: ScriptData,
): PlayFile {
  return { ...play, scripts: { ...play.scripts, [binderId]: data } };
}

/** A copy of `play` with the binder replaced. */
export function withBinder(play: PlayFile, binder: BinderItem[]): PlayFile {
  return { ...play, binder };
}

/**
 * Drop `scripts` entries whose binder id is no longer a script in the binder.
 *
 * Card metadata is only reachable through its binder row, so an entry with no
 * row is unreachable by definition. This runs when the binder is committed,
 * not on read — a script that is missing from disk keeps both its row and its
 * cards (docs/app/keeping-work/storage-and-file-format.md#STOR-D8), and only an actual removal from the binder clears them.
 */
export function pruneScripts(play: PlayFile): PlayFile {
  const live = new Set<string>();
  const walk = (items: BinderItem[]) => {
    for (const it of items) {
      if (it.type === "script") live.add(it.id);
      if (it.children) walk(it.children);
    }
  };
  walk(play.binder);
  const scripts: Record<string, ScriptData> = {};
  for (const [id, data] of Object.entries(play.scripts)) {
    if (live.has(id)) scripts[id] = data;
  }
  return { ...play, scripts };
}
