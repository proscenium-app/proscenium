// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Proscenium’s Trash, the page's half (docs/engineering/cross-platform.md#PLAT-16):
 * what a delete says of what it deletes, so Put Back can return it where it
 * was, and Put Back itself.
 *
 * Rust keeps the bytes, where each came from, and a note it never reads
 * (src-tauri/src/vault/ring.rs). The note is the page's: what the thing was,
 * which play it was in, and for a binder row the row itself, where it stood
 * and its scripts' cards, which is what Undo restores, kept for as long as the
 * trash keeps the file. A delete where the system has a trash of its own
 * sends the note too, and nothing keeps it.
 */
import { appTrash, type TrashEntry } from "../storage/ipc";
import { findItem, flatten, titleOf } from "./binder";
import { restoreSubtree } from "./binder-rebase";
import { titleFromFileName } from "./filename";
import { commitPlay, readPlayFile, type BinderItem, type ScriptData } from "./play-file";
import type { VaultPlay } from "./vault-plays";

/** What the page says of a delete, kept beside it in Proscenium’s Trash. */
export interface TrashNote {
  v: 1;
  /** What the writer called it. */
  title: string;
  /** A binder row's type, or "practice" or "format". */
  kind: string;
  /** The play it was in, as it was named when it was deleted. */
  play?: { id: string; title: string };
  /** The binder row as it stood, and its scripts' cards: what Put Back restores. */
  row?: {
    item: BinderItem;
    parentId: string | null;
    index: number;
    scripts: Record<string, ScriptData>;
  };
}

/**
 * The note for a binder row about to be deleted: the row, where it stands,
 * and the cards of every script going with it. `playPath` is the play file's
 * name in its folder, whose name is the play's.
 */
export function rowNote(
  play: { id: string; binder: BinderItem[]; scripts: Record<string, ScriptData> },
  playPath: string,
  id: string,
): string | undefined {
  const at = findItem(play.binder, id);
  if (!at) return undefined;
  const scripts: Record<string, ScriptData> = {};
  for (const row of flatten([at.item]))
    if (row.type === "script" && play.scripts[row.id]) scripts[row.id] = play.scripts[row.id];
  const note: TrashNote = {
    v: 1,
    title: titleOf(at.item),
    kind: at.item.type,
    play: { id: play.id, title: titleFromFileName(playPath) },
    row: { item: at.item, parentId: at.parentId, index: at.index, scripts },
  };
  return JSON.stringify(note);
}

/** The note for a practice play moved there from Help & Tutorials. */
export const practiceNote = (): string =>
  JSON.stringify({ v: 1, title: "Practice Play", kind: "practice" } satisfies TrashNote);

/** The note for one of the writer's formats, by the name the writer gave it. */
export const formatNote = (name: string): string =>
  JSON.stringify({ v: 1, title: name, kind: "format" } satisfies TrashNote);

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** What the page said of an entry, or null for one that said nothing it can read. */
export function noteOf(entry: Pick<TrashEntry, "note">): TrashNote | null {
  if (!entry.note) return null;
  try {
    const note: unknown = JSON.parse(entry.note);
    if (!record(note) || note.v !== 1 || typeof note.title !== "string") return null;
    return note as unknown as TrashNote;
  } catch {
    return null;
  }
}

/** A row the note keeps, as the binder shapes one: an id, a type and a path. */
function rowIn(note: TrashNote | null): NonNullable<TrashNote["row"]> | null {
  const row = note?.row;
  if (!row || !record(row.item)) return null;
  const item = row.item;
  if (typeof item.id !== "string" || typeof item.path !== "string" || !item.type) return null;
  if (row.parentId !== null && typeof row.parentId !== "string") return null;
  return { ...row, index: Number.isInteger(row.index) ? row.index : 0, scripts: row.scripts ?? {} };
}

const KINDS: Record<string, string> = {
  script: "A script",
  document: "A document",
  character: "A character",
  outline: "An outline",
  reference: "A file",
  folder: "A folder",
};

/** The play an entry of a play's ring belongs to, among the plays listed now. */
function playOf(entry: TrashEntry, plays: readonly VaultPlay[]): VaultPlay | undefined {
  const ring = entry.ring;
  return ring.kind === "play" ? plays.find((p) => p.id === ring.playId) : undefined;
}

/** What an entry is called, for the writer. */
export function trashTitle(entry: TrashEntry): string {
  const note = noteOf(entry);
  if (note?.title) return note.title;
  if (entry.ring.kind === "practice") return "Practice Play";
  return entry.isDir ? entry.original : titleFromFileName(entry.original);
}

/**
 * What an entry was and where it was, in a line: "A document in “Tide”", "A
 * play", "Practice from Help & Tutorials", "A format". The play is named as it
 * is listed now, or as it was named when the delete was made.
 */
export function trashWhat(entry: TrashEntry, plays: readonly VaultPlay[]): string {
  const note = noteOf(entry);
  switch (entry.ring.kind) {
    case "practice":
      return "Practice from Help & Tutorials";
    case "formats":
      return "A format";
    case "plays":
      return entry.isPlay ? "A play" : `${entry.isDir ? "A folder" : "A file"} in the Plays folder`;
    case "play": {
      const kind = KINDS[note?.kind ?? ""] ?? (entry.isDir ? "A folder" : "A file");
      const play = playOf(entry, plays)?.title ?? note?.play?.title;
      return play ? `${kind} in “${play}”` : `${kind} in a play`;
    }
  }
}

/** A row's paths, and its children's, moved from where it was to where it landed. */
export function movedTo(item: BinderItem, from: string, to: string): BinderItem {
  const path =
    item.path === from
      ? to
      : item.path.startsWith(`${from}/`)
        ? to + item.path.slice(from.length)
        : item.path;
  return {
    ...item,
    path,
    ...(item.children ? { children: item.children.map((c) => movedTo(c, from, to)) } : {}),
  };
}

/**
 * The binder row back where it stood, in the play's file, through the guarded
 * write. Best effort: where the row cannot stand there now (its folder's row
 * has gone, the play has changed shape), the binder files it when the play
 * next opens, at the end of the folder it is in (binder-reconcile.ts).
 */
async function restoreRow(
  play: VaultPlay,
  note: TrashNote | null,
  landed: string,
  nowIso: string,
): Promise<void> {
  const row = rowIn(note);
  if (!row) return;
  const item = movedTo(row.item, row.item.path, landed);
  const file = `${play.dir}/${play.file}`;
  try {
    const loaded = await readPlayFile(file);
    if (loaded.status !== "valid") return;
    await commitPlay(
      file,
      loaded,
      (prior) => restoreSubtree(prior ?? loaded.data, item, row.parentId, row.index, row.scripts),
      nowIso,
    );
  } catch {
    /* filed by the play's next open instead */
  }
}

/** What a put back did, in a sentence, and what it changed beside the trash. */
export type PutBackOutcome =
  | { ok: true; said: string; changed?: "plays" | "practice" | "formats" }
  | { ok: false; said: string };

/**
 * Put one entry back where it came from, from the Plays screen, whose open
 * folder is the Plays folder: a play's into that play, found by its id among
 * `plays` (it may have been renamed since), at the place it was, with its
 * binder row; a whole play into the Plays folder; practice into Help &
 * Tutorials; a format into the formats. Never over anything: a taken name
 * gives way to "<name> (put back)", and the sentence says so.
 */
export async function putBackEntry(
  entry: TrashEntry,
  plays: readonly VaultPlay[],
  nowIso: string,
): Promise<PutBackOutcome> {
  const note = noteOf(entry);
  const title = trashTitle(entry);
  const stays = "It stays in Proscenium’s Trash.";
  try {
    switch (entry.ring.kind) {
      case "play": {
        const play = playOf(entry, plays);
        if (!play) {
          const was = note?.play?.title;
          return {
            ok: false,
            said: `“${title}” goes back into ${was ? `“${was}”` : "its play"}, which isn't in this Plays folder. ${stays}`,
          };
        }
        // One kept before the ring said where goes into the play's own folder.
        const rel = entry.rel ?? entry.original;
        const back = await appTrash.putBack(entry.ring, entry.name, `${play.dir}/${rel}`);
        const landed = back.rel.slice(play.dir.length + 1);
        await restoreRow(play, note, landed, nowIso);
        return {
          ok: true,
          said: back.renamed
            ? `“${title}” is back in “${play.title}”, as “${nameOf(landed, entry.isDir)}”: something there already had its name.`
            : `“${title}” is back in “${play.title}”.`,
        };
      }
      case "plays": {
        const back = await appTrash.putBack(entry.ring, entry.name, entry.rel ?? entry.original);
        return {
          ok: true,
          changed: "plays",
          said: back.renamed
            ? `“${title}” is back in your Plays folder, as “${nameOf(back.rel, entry.isDir)}”: something there already had its name.`
            : `“${title}” is back in your Plays folder.`,
        };
      }
      case "practice":
        await appTrash.putBack(entry.ring, entry.name, null);
        return {
          ok: true,
          changed: "practice",
          said: "Your practice is back in Help & Tutorials, under Saved Practice.",
        };
      case "formats": {
        const back = await appTrash.putBack(entry.ring, entry.name, null);
        return {
          ok: true,
          changed: "formats",
          said: back.renamed
            ? `“${title}” is back in your formats, beside one that has its name.`
            : `“${title}” is back in your formats.`,
        };
      }
    }
  } catch (e) {
    const why = String(e).replace(/^Error:\s*/, "");
    return { ok: false, said: `“${title}” couldn't be put back. ${why} ${stays}` };
  }
}

/** The last part of a path as the writer reads it: a file without its extension. */
function nameOf(rel: string, isDir: boolean): string {
  const leaf = rel.slice(rel.lastIndexOf("/") + 1);
  return isDir ? leaf : titleFromFileName(leaf);
}
