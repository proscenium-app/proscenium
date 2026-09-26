// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D2): any folder, whose children that are plays are
 * shown and whose other children are ignored.
 *
 * **Discovery is one rule.** A directory is a play iff it directly contains a
 * file with the `.proscenium` extension. No file at the root lists the plays;
 * the folder does. Nothing is written at the Plays folder root, ever — no
 * index, no README, no marker, no cache — so a freshly chosen Plays folder is
 * an empty folder and stays that way until the first play is created.
 */
import { DEFAULT_FORMAT_ID } from "../format";
import { vault, type VaultEntry } from "../storage";
import { DEFAULT_PLAY_STATUSES } from "../storage/settings-model";
import { matchingPath } from "../storage/path-key";
import { fileName, uniqueFileName } from "./filename";
import {
  PLAY_KIND,
  SCHEMA_VERSION,
  choosePlayFile,
  isPlayFileName,
  playFileName,
  readPlayFile,
  serializePlay,
  type BinderItem,
  type PlayFile,
} from "./play-file";
import { startingBinder } from "./play-shape";
import type { FolderOfPlays } from "./plays-folder";
import { ulid } from "./ulid";
import type { KeptFile } from "../storage/import-bytes";
// The `generator` stamp says which version wrote the file (docs/app/keeping-work/storage-and-file-format.md#STOR-D5), so it is
// the app's one version (`bun run version`), not a literal: it said 1.0.0 while
// the app was 0.1.0, and a 0.9 release candidate would have claimed 1.0.
import { version as APP_VERSION } from "../../package.json";

/** One play discovered in the Plays folder. */
export interface VaultPlay {
  /** Child directory name, relative to the Plays folder root. */
  dir: string;
  /** The play's name — which is the folder's name (docs/app/keeping-work/storage-and-file-format.md#STOR-34). */
  title: string;
  id: string;
  /** The play file's own name, which may differ after a rename in Finder. */
  file: string;
  /** Optional workflow label carried in the play file. */
  status?: string;
  logline?: string;
  modified?: string;
  /**
   * The play's first script, from the Plays folder: what Progress counts the
   * pages of (docs/app/keeping-work/storage-and-file-format.md#STOR-121). Only the first counts, as the scene count did.
   */
  script?: string;
  /**
   * That script file's own modified time, when the filesystem said: the key
   * its page count is cached under, so a play is counted again only when its
   * script changed, here or on another device.
   */
  scriptModified?: string;
  /** The format id the play file names — so deleting a format can say which plays used it. */
  format?: string;
  /** Extension-discovered plays remain visible when their metadata needs repair. */
  problem?: "malformed" | "unreadable" | "absent";
}

/** The first script item in binder order. */
function firstScript(items: BinderItem[]): BinderItem | null {
  for (const it of items) {
    if (it.type === "script") return it;
    if (it.children) {
      const nested = firstScript(it.children);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * When the SCRIPT FILE was last written, from the filesystem itself.
 *
 * The only timestamp that moves when something other than the app writes the
 * play — an iPad edit, another tool, a sync, a hand copy. The play file's own
 * `modified` deliberately does NOT move when the writer types (docs/app/keeping-work/storage-and-file-format.md#STOR-D5), so it is a
 * last-resort fallback for a play with no script, never the answer.
 *
 * Measured on a real vault before this existed: one play's script was
 * written four days after the row said; another's manifest was stamped ten
 * days after its script had last been touched. The column was ten days wrong
 * in both directions at once.
 */
async function scriptMtime(dir: string, scriptRel: string): Promise<string | null> {
  try {
    const slash = scriptRel.lastIndexOf("/");
    const scriptDir = slash === -1 ? dir : `${dir}/${scriptRel.slice(0, slash)}`;
    const name = slash === -1 ? scriptRel : scriptRel.slice(slash + 1);
    const entries = (await vault.list(scriptDir)).filter((e) => !e.isDir);
    const actual = matchingPath(
      name,
      entries.map((e) => e.name),
    );
    const entry = entries.find((e) => e.name === actual);
    return entry?.modifiedMs ? new Date(entry.modifiedMs).toISOString() : null;
  } catch {
    return null; // docs/app/keeping-work/storage-and-file-format.md#STOR-107 — a dashboard column never breaks discovery
  }
}

/**
 * Read one directory as a play: a child of the Plays folder, or one folder
 * further down when looking for plays below it. Null unless it directly
 * contains a `.proscenium` file. Bad bytes never hide its folder.
 */
async function peekPlay(dir: string): Promise<VaultPlay | null> {
  try {
    const name = dir.slice(dir.lastIndexOf("/") + 1);
    const names = (await vault.list(dir)).filter((e) => !e.isDir).map((e) => e.name);
    const file = choosePlayFile(name, names);
    if (!file) return null;

    const loaded = await readPlayFile(dir + "/" + file);
    if (loaded.status !== "valid" && loaded.status !== "unsupported") {
      return { dir, title: name, id: dir, file, problem: loaded.status };
    }
    const play = loaded.data;

    const binder = Array.isArray(play.binder) ? play.binder : [];
    const script = firstScript(binder);
    const fileTime = script?.path ? await scriptMtime(dir, script.path) : null;

    return {
      dir,
      // The filename IS the title (docs/app/keeping-work/storage-and-file-format.md#STOR-34): the folder's name is the play's name.
      title: name,
      id: typeof play.id === "string" ? play.id : dir,
      file,
      status: typeof play.status === "string" ? play.status : undefined,
      logline: typeof play.logline === "string" ? play.logline : undefined,
      modified: fileTime ?? (typeof play.modified === "string" ? play.modified : undefined),
      format: typeof play.settings?.format === "string" ? play.settings.format : undefined,
      ...(script?.path ? { script: `${dir}/${script.path}` } : {}),
      ...(fileTime ? { scriptModified: fileTime } : {}),
    };
  } catch {
    return null; // docs/app/keeping-work/storage-and-file-format.md#STOR-107 — a malformed play file never breaks discovery
  }
}

/** The folders in a listing that discovery looks into: never hidden, never a provider's own. */
function foldersIn(entries: VaultEntry[]): VaultEntry[] {
  return entries.filter((e) => e.isDir && !e.isSyncArtifact && !e.name.startsWith("."));
}

/** The plays among `folders`, which sit directly inside `within` ("" is the Plays folder). */
async function playsAmong(within: string, folders: VaultEntry[]): Promise<VaultPlay[]> {
  const peeked = await Promise.all(
    folders.map((f) => peekPlay(within ? `${within}/${f.name}` : f.name)),
  );
  return peeked.filter((p): p is VaultPlay => p !== null);
}

/**
 * Scan the Plays folder's immediate children for plays. Most recently modified
 * first (a writer wants the play they were just working on on top).
 */
export async function discoverPlays(): Promise<VaultPlay[]> {
  const plays = await playsAmong("", foldersIn(await vault.list("")));
  return plays.sort((a, b) => {
    if (a.modified !== b.modified) {
      return (b.modified ?? "").localeCompare(a.modified ?? "");
    }
    return a.title.localeCompare(b.title);
  });
}

/**
 * The most folders looking one folder down will list. A Plays folder chosen one
 * level too high holds a few folders; a home folder chosen by mistake holds
 * hundreds, and a hint is not worth a walk through ~/Library.
 */
export const LOOK_BELOW = 200;

/**
 * The folders inside the open Plays folder that hold plays of their own, by the
 * rule `discoverPlays` uses, one folder down. This is for a Plays folder chosen
 * one level too high (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
 *
 * Best-effort, and it never throws. A folder that cannot be listed (not granted
 * under the App Sandbox, not downloaded yet, gone) is passed over. The folders
 * holding the fewest folders are looked into first, so a small folder of plays
 * is found before a large folder of something else spends the budget. Nothing
 * waits on it: a listing can be slow, so the caller runs it in the background.
 */
export async function discoverPlaysBelow(most: number = LOOK_BELOW): Promise<FolderOfPlays[]> {
  let left = most;

  let children: VaultEntry[];
  try {
    children = foldersIn(await vault.list(""));
  } catch {
    return [];
  }
  // One listing each, as many as the budget allows, to see how many folders
  // each one holds.
  const looked = children.sort((a, b) => a.name.localeCompare(b.name)).slice(0, left);
  left -= looked.length;
  const sized = await Promise.all(
    looked.map(async (child) => {
      try {
        return { dir: child.name, folders: foldersIn(await vault.list(child.name)) };
      } catch {
        return { dir: child.name, folders: [] };
      }
    }),
  );

  const found: FolderOfPlays[] = [];
  const smallestFirst = sized
    .filter((s) => s.folders.length > 0)
    .sort((a, b) => a.folders.length - b.folders.length || a.dir.localeCompare(b.dir));
  for (const { dir, folders } of smallestFirst) {
    // Out of listings: every folder after this one holds at least as many.
    if (folders.length > left) break;
    left -= folders.length;
    const plays = (await playsAmong(dir, folders)).length;
    if (plays > 0) found.push({ dir, plays });
  }
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * Update a play's Plays-screen metadata (status / logline) without opening it.
 * Guarded write; keeps canonical key order and moves `modified`, which is
 * correct here — this is a change to something the play file owns.
 */
export async function updatePlayMeta(
  dir: string,
  file: string,
  patch: { status?: string; logline?: string },
  nowIso: string,
): Promise<boolean> {
  const rel = `${dir}/${file}`;
  try {
    const loaded = await readPlayFile(rel);
    if (loaded.status !== "valid") return false;
    const { data: play, hash } = loaded;
    if (patch.status !== undefined) {
      if (patch.status) play.status = patch.status;
      else delete play.status;
    }
    play.modified = nowIso;
    if (patch.logline !== undefined) {
      if (patch.logline) play.logline = patch.logline;
      else delete play.logline;
    }
    const out = await vault.write(rel, serializePlay(play), hash);
    return out.status === "ok";
  } catch {
    return false;
  }
}

function starterFountain(title: string): string {
  return `Title: ${title}\nCredit: a play by\n\n# ACT ONE\n\n## Scene 1\n\nA bare stage.\n`;
}

/**
 * Write a whole play into `dir` (a child of the open Plays folder).
 *
 * **A new play is two files** (docs/app/keeping-work/storage-and-file-format.md#STOR-D3): the script and the play file. No
 * directories are scaffolded — the binder shows Characters and Notes so the
 * writer can see where things go, and each directory is created when its first
 * file lands. Nothing hidden, no `.gitkeep`, nothing the writer did not ask
 * for (docs/app/keeping-work/storage-and-file-format.md#STOR-111).
 *
 * The play file is written LAST, because it is the discovery signal: a
 * half-scaffolded directory must never list as a play.
 */
export async function scaffoldPlayAt(
  dir: string,
  title: string,
  nowIso: string,
  script?: string,
  /** The format the play starts in — Settings › Formats' Default for New Plays. */
  format: string = DEFAULT_FORMAT_ID,
  /**
   * The status it starts as: the first in Settings › General's list
   * (docs/app/preferences-and-help/settings.md#SET-7), or none when the writer has emptied the list.
   */
  status: string | null = DEFAULT_PLAY_STATUSES[0],
  original?: KeptFile,
): Promise<{ scriptPath: string; playPath: string }> {
  const at = (p: string) => (dir ? `${dir}/${p}` : p);
  const scriptId = ulid();
  const scriptRel = `${title}.fountain`;

  // Created, never written over: a name that turned out to be taken leaves
  // whatever is there untouched and fails the scaffold instead.
  await vault.create(at(scriptRel), script ?? starterFountain(title));

  // Save the source before publishing the manifest. A failed copy leaves an
  // incomplete folder, never a discoverable play that claims to keep its source.
  if (original) {
    const ext = original.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
    const safeName =
      fileName(original.name.slice(0, original.name.length - ext.length || undefined)) + ext;
    const path = at(`Originals/${safeName}`);
    if (original.base64 !== undefined) await vault.createBinary(path, original.base64);
    else await vault.create(path, original.content);
  }

  const play: PlayFile = {
    kind: PLAY_KIND,
    schemaVersion: SCHEMA_VERSION,
    id: ulid(),
    ...(status ? { status } : {}),
    created: nowIso,
    modified: nowIso,
    generator: { app: "Proscenium", version: APP_VERSION },
    settings: {
      format,
      sceneAnchors: "manifest",
      autosave: { debounceMs: 600, maxWaitMs: 2000 },
    },
    binder: startingBinder({ id: scriptId, type: "script", path: scriptRel }),
    scripts: { [scriptId]: { scenes: [], orphans: [] } },
  };
  const playRel = playFileName(title);
  await vault.create(at(playRel), serializePlay(play));

  return { scriptPath: at(scriptRel), playPath: at(playRel) };
}

/**
 * Create a new play in the open Plays folder. Returns its directory and the
 * script inside it, because a play created from an imported draft has to
 * overwrite that one file — and computing its path a second time at the call
 * site is how two places end up disagreeing about a play's shape.
 */
export async function scaffoldPlayInVault(
  title: string,
  nowIso: string,
  script?: string,
  format?: string,
  status?: string | null,
  original?: KeptFile,
): Promise<{ dir: string; script: string }> {
  const wanted = fileName(title.trim() || "Untitled Play");
  const taken = (await vault.list("")).map((e) => e.name);
  const dir = uniqueFileName(wanted, taken);
  const { scriptPath } = await scaffoldPlayAt(dir, dir, nowIso, script, format, status, original);
  return { dir, script: scriptPath };
}

/**
 * The play file's name inside an opened play folder, adopting a rename made in
 * Finder. Discovery is by extension, so a mismatch never hides a play; the app
 * renames the file to match the folder on open and records it under Changes.
 */
export async function resolvePlayFile(folderName: string): Promise<string | null> {
  const names = (await vault.list("")).filter((e) => !e.isDir).map((e) => e.name);
  return choosePlayFile(folderName, names);
}

/** Every `.proscenium` file in the open play folder, for the several-files case. */
export async function allPlayFiles(): Promise<string[]> {
  const names = (await vault.list("")).filter((e) => !e.isDir).map((e) => e.name);
  return names.filter(isPlayFileName).sort();
}
