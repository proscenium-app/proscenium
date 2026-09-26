// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { pathKey } from "../storage/path-key";

/**
 * A material's filename IS its title, not a slug derived from
 * one.
 *
 * The app used to keep two names for every file: a `title` in the manifest and
 * in front-matter, and a `slug(title)` filename underneath it. That is two
 * names for one thing, and they drift the moment anything renames one half —
 * a sheet called "Act two, the problem" sat at `act-two-the-problem.md`, so the
 * binder, the file, and the front-matter each said something slightly
 * different, and a writer looking at the folder in Finder could not tell which
 * row it was. There is now ONE name. `fileName()` is the only transform, and it
 * removes only what a filesystem cannot hold.
 *
 * Scripts keep this rule too: `The Weight of Water.fountain`, not
 * `the-weight-of-water.fountain`. So does the PLAY FOLDER and the play file
 * named for it. Slugs are gone from the layout entirely (docs/app/keeping-work/storage-and-file-format.md#STOR-D4): there is
 * no path in a play that is not the writer's own words.
 */

/**
 * Characters a name may not contain. `/` and `\` would make a path, `:` is a
 * separator on Apple's older APIs and still confuses iCloud, and the rest are
 * illegal on Windows — a vault syncs, so a name that is fine here has to be
 * fine there too.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** Reserved device names on Windows; harmless here, fatal on a synced copy. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Longest stem we will write. HFS+/APFS allow 255 bytes; leave room for `.proscenium`. */
const MAX = 120;

/**
 * The filename a title becomes: itself, minus what a filesystem cannot hold.
 *
 * Spaces and capitals survive — they are the writer's, and they read. Leading
 * dots do not (that would hide the file, and the reconciler skips dotfiles, so
 * a note named ".idea" would vanish from the binder the moment it was written).
 */
export function fileName(title: string): string {
  let s = title
    .normalize("NFC")
    .replace(ILLEGAL, "")
    .replace(/\s+/g, " ")
    .trim()
    // A trailing dot or space is silently dropped by Windows, which would make
    // the name on disk differ from the name in the binder — the drift this
    // module exists to prevent.
    .replace(/[. ]+$/, "")
    .replace(/^\.+/, "")
    .trim();
  if (s.length > MAX) s = s.slice(0, MAX).trim();
  if (!s) return "Untitled";
  // Windows reads `CON.txt` as the CON device too: the stem before the first
  // dot is what is reserved, not the whole name.
  if (RESERVED.test(s.split(".")[0]!)) s = s.replace(/^[^.]+/, (stem) => `${stem}-file`);
  return s;
}

/** The title a filename carries: the stem, verbatim. The inverse of `fileName`. */
export function titleFromFileName(pathOrName: string): string {
  const base = pathOrName.slice(pathOrName.lastIndexOf("/") + 1);
  // `.index.json` and friends: strip only the LAST extension, so a file called
  // "Notes on 1953.md" keeps its year.
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem || base;
}

/**
 * True when `title` is already exactly what its file is called — the check the
 * rename path uses to decide whether disk has to move at all.
 */
export function nameMatchesTitle(path: string, title: string): boolean {
  return titleFromFileName(path) === fileName(title);
}

/**
 * A name that does not collide with `taken`, comparing the way the Mac's
 * volumes do: case-insensitively — we never create two paths differing only by
 * case (docs/app/keeping-work/storage-and-file-format.md#STOR-D4) — and in one Unicode form. "Pièce" typed here is composed;
 * the same name listed off a disk can come back decomposed, and APFS treats the
 * two as one file, so a comparison that saw two names would hand back a name
 * that is already taken. Appends " 2", " 3", … rather than a hyphen, because
 * this is a title a writer reads.
 */
export function uniqueFileName(name: string, taken: Iterable<string>): string {
  const seen = new Set([...taken].map(pathKey));
  const base = fileName(name);
  if (!seen.has(pathKey(base))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!seen.has(pathKey(candidate))) return candidate;
  }
}
