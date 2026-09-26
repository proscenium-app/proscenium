// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a file opened from Finder IS, and so where it goes (docs/app/keeping-work/storage-and-file-format.md#STOR-D5, docs/app/keeping-work/storage-and-file-format.md#STOR-D12;
 * docs/app/importing/document-import.md#IMPT-36). Pure: Rust reports what is on disk around the path
 * (`opens.rs`), this decides what it means, and the tests need no disk.
 *
 *  - **play** — a `.proscenium` file, or a play's folder: open that play.
 *  - **script-in-play** — a `.fountain` inside a play: open the play with that
 *    script in front.
 *  - **loose-script** — a `.fountain` no play holds: offer to make a play from
 *    it, with the script copied in (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). The original is never moved.
 *  - **final-draft** — a `.fdx`: it becomes a new play, with the `.fdx` kept
 *    beside the script (docs/app/importing/document-import.md#IMPT-35). One inside a play's folder is
 *    that play's document, and opening it opens the play instead — converting
 *    the copy a play keeps would make a second play out of the first.
 *  - **unknown** — anything else, including a file that is not there any more.
 *
 * A play is the NEAREST folder above the file that directly holds a
 * `.proscenium` file; its Plays folder is that folder's parent (docs/app/keeping-work/storage-and-file-format.md#STOR-D2). Whether
 * that is the Plays folder the app has open is a separate question
 * (`inPlaysFolder`), because the answer to it is a prompt, not a route.
 */
import type { OpenedFacts } from "../storage";
import { isPlayFileName } from "./play-file";
import { pathKey, samePath } from "../storage/path-key";
import { isImportFile } from "../import/formats";
export { samePath } from "../storage/path-key";

export type { OpenedFacts };

/** Where a play is: its folder, the Plays folder around it, and its folder's name. */
export interface PlayLocation {
  playDir: string;
  playsFolder: string;
  /** The play folder's own name — which is the play's name (docs/app/keeping-work/storage-and-file-format.md#STOR-D4). */
  dirName: string;
}

export type OpenRoute =
  | ({ kind: "play" } & PlayLocation)
  | ({ kind: "script-in-play"; script: string } & PlayLocation)
  | { kind: "loose-script"; path: string; name: string }
  | { kind: "final-draft"; path: string; name: string; inPlay: PlayLocation | null }
  | { kind: "document-import"; path: string; name: string; inPlay: PlayLocation | null }
  | { kind: "unknown"; path: string; name: string };

function baseName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i <= 0 ? "/" : trimmed.slice(0, i);
}

/**
 * Two paths name the same folder. NFC because macOS hands out decomposed
 * names and a string typed or stored elsewhere is composed; case-insensitive
 * because the Mac's volumes are (docs/app/keeping-work/storage-and-file-format.md#STOR-D4) — a false match needs two folders
 * whose names differ only by case, which the app never creates.
 */

/** `child` sits inside `folder` (not equal to it). */
export function isInside(child: string, folder: string): boolean {
  const f = pathKey(folder);
  return pathKey(child).startsWith(f === "" ? "/" : `${f}/`);
}

function locate(dir: string): PlayLocation {
  return { playDir: dir, playsFolder: parentOf(dir), dirName: baseName(dir) };
}

export function classifyOpened(facts: OpenedFacts): OpenRoute {
  const name = baseName(facts.path);
  if (!facts.exists) return { kind: "unknown", path: facts.path, name };

  const nearest = facts.playDirs.find((d) => d.playFiles.some(isPlayFileName)) ?? null;

  if (facts.isDir) {
    if (/\.(pages|scriv)$/i.test(name))
      return {
        kind: "document-import",
        path: facts.path,
        name,
        inPlay: nearest ? locate(nearest.dir) : null,
      };
    // A play's own folder, dropped on the Dock icon or opened with Proscenium.
    return nearest && samePath(nearest.dir, facts.path)
      ? { kind: "play", ...locate(nearest.dir) }
      : { kind: "unknown", path: facts.path, name };
  }

  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  // Only a play file that sits in the play's own folder is the play: a stray
  // `.proscenium` deeper in a play is a file in that play, not another play.
  if (isPlayFileName(name) && nearest && samePath(nearest.dir, parentOf(facts.path))) {
    return { kind: "play", ...locate(nearest.dir) };
  }
  if (ext === "fountain") {
    if (!nearest) return { kind: "loose-script", path: facts.path, name };
    const script = facts.path.slice(nearest.dir.replace(/\/+$/, "").length + 1);
    return { kind: "script-in-play", script, ...locate(nearest.dir) };
  }
  if (ext === "fdx") {
    return {
      kind: "final-draft",
      path: facts.path,
      name,
      inPlay: nearest ? locate(nearest.dir) : null,
    };
  }
  if (isImportFile(name))
    return {
      kind: "document-import",
      path: facts.path,
      name,
      inPlay: nearest ? locate(nearest.dir) : null,
    };
  return { kind: "unknown", path: facts.path, name };
}

/**
 * Is this play in the Plays folder the app has open? A play is shown by the
 * Plays screen only when it is a DIRECT child of that folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D2 discovery).
 */
export function inPlaysFolder(play: PlayLocation, playsRoot: string | null): boolean {
  return playsRoot !== null && samePath(play.playsFolder, playsRoot);
}
