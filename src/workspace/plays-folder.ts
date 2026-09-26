// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What may be the Plays folder, and the one sentence that says where the plays
 * live (docs/app/keeping-work/storage-and-file-format.md#STOR-D2, docs/app/keeping-work/storage-and-file-format.md#STOR-D11). Pure; the facts come from Rust (`vault_folder_facts`).
 *
 * Refused, in words a writer can act on:
 *
 *  - **a play** — new plays would be made inside it, and a play's binder is its
 *    folder, so the play would swallow them;
 *  - **a folder inside a play** — the same, one level down;
 *  - **a folder two providers both manage** — when one clears a file to save
 *    space, the other can take the cleared file as deleted;
 *  - **a folder inside the Plays folder already open**, when choosing with the
 *    panel and that folder holds plays — a Plays folder nested in another. Not
 *    when a play opened from Finder names its own folder: the writer asked for
 *    that play, and nesting costs tidiness, never a file. Not when the open one
 *    holds no plays either: there is nothing to nest under, and a writer who
 *    chose one folder too high was refused the folder their plays were in.
 *
 * **Suggested, never refused:** a folder that holds no plays while some of its
 * own folders do (`playsFolderHint`). Re-choosing a Plays folder on 2026-09-13,
 * a writer picked the folder above it. The Plays screen said "No plays here
 * yet", and the sample play they opened from there went into that folder. An
 * empty folder is still a fine new Plays folder, so the screen asks rather than
 * refuses.
 *
 * Vocabulary (docs/app/keeping-work/storage-and-file-format.md#STOR-D1): Plays folder, play — never vault, never sync.
 */
import type { FolderFacts } from "../storage";
import { isInside } from "./open-route";

export type { FolderFacts };

/** The Plays folder open now, as nesting is judged against it. */
export interface OpenPlaysFolder {
  path: string;
  /** How many plays it holds. */
  plays: number;
}

const NAMES: Record<string, string> = {
  icloud: "iCloud Drive",
  dropbox: "Dropbox",
  syncthing: "Syncthing",
  onedrive: "OneDrive",
  "google-drive": "Google Drive",
  box: "Box",
};

/** A provider id as a writer knows it. */
export function providerName(id: string): string {
  return NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function nameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/**
 * Why `facts` cannot be the Plays folder, or null when it can. `open` is the
 * Plays folder open now, checked for nesting only when given, and only when it
 * holds plays.
 */
export function playsFolderRefusal(facts: FolderFacts, open: OpenPlaysFolder | null): string | null {
  if (facts.isPlay) {
    return `“${nameOf(facts.path)}” is a play. Choose the folder that holds your plays.`;
  }
  if (facts.insidePlay) {
    return `That folder is inside the play “${nameOf(facts.insidePlay)}”. Choose a folder that isn't inside a play.`;
  }
  if (facts.providers.length >= 2) {
    const [a, b] = facts.providers.map(providerName);
    return `That folder is in both ${a} and ${b}. When one of them clears a file to save space, the other can take it as deleted. Choose a folder only one of them keeps.`;
  }
  if (open && open.plays > 0 && isInside(facts.path, open.path)) {
    return `That folder is inside your Plays folder, “${nameOf(open.path)}”. Choose the Plays folder itself, or a folder outside it.`;
  }
  return null;
}

/** A folder inside the Plays folder that holds plays of its own (vault-plays.ts). */
export interface FolderOfPlays {
  /** Its name inside the Plays folder. */
  dir: string;
  /** How many plays it holds, by the Plays screen's own rule (docs/app/keeping-work/storage-and-file-format.md#STOR-D2). */
  plays: number;
}

/** What the Plays screen says and offers when the Plays folder looks one level too high. */
export interface PlaysFolderHint {
  /** The folders offered in its place, most plays first. */
  folders: FolderOfPlays[];
  sentence: string;
}

/** The most folders the Plays screen names and offers; any more are counted. */
const MOST_OFFERED = 3;

/**
 * Whether the Plays folder looks chosen one level too high: it holds no plays,
 * and one or more of its own folders do. Null otherwise. An empty folder with
 * nothing like that inside it is simply a new Plays folder.
 */
export function playsFolderHint(playsHere: number, below: FolderOfPlays[]): PlaysFolderHint | null {
  if (playsHere > 0) return null;
  const holding = below
    .filter((f) => f.plays > 0)
    .sort((a, b) => b.plays - a.plays || a.dir.localeCompare(b.dir));
  if (holding.length === 0) return null;
  const folders = holding.slice(0, MOST_OFFERED);
  const names = folders.map((f) => `“${f.dir}”`);
  const others = holding.length - folders.length;
  if (others > 0) names.push(`${others} other ${others === 1 ? "folder" : "folders"}`);
  return { folders, sentence: `Your plays look like they are in ${listOf(names)} inside this folder.` };
}

/** “A” · “A” and “B” · “A”, “B”, and “C” — the app's own list punctuation. */
function listOf(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** The provider that keeps the Plays folder, for diagnostics: an id, or `local`. */
export function providerKind(providers: string[]): string {
  return providers[0] ?? "local";
}

/**
 * Where the plays live, in one sentence (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). The last one is the
 * sentence that must exist: a writer whose plays are on this Mac alone should
 * never learn it from a backup they did not have.
 */
export function wherePlaysLive(providers: string[]): string {
  const id = providers[0];
  if (!id) {
    return "Your plays live in a folder on this Mac only. They will not appear on other devices.";
  }
  if (id === "syncthing") {
    return "Your plays live in a Syncthing folder and appear on the devices it shares with.";
  }
  return `Your plays live in ${providerName(id)} and appear on your other devices.`;
}
