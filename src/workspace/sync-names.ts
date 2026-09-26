// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recognizing what a sync provider left behind (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
 *
 * The app never syncs. It reads and writes a folder that something else syncs,
 * and it has to stay correct while that happens. Where a provider's naming is
 * documented and stable, its conflict copy is recognized as *another version of
 * X* — never listed as a script, never opened as the play's own file — and
 * surfaced under Changes with compare, keep this one, and move to trash.
 *
 * Where it is not stable, the copy is indistinguishable from a file the writer
 * made, and pretending otherwise would hide real work. iCloud (`<name> 2`),
 * OneDrive (`<name>-<Device>`) and Google Drive (`<name> (1)`) therefore appear
 * as ordinary documents in the binder, which is honest — the writer handles
 * them exactly as they would in Finder.
 *
 * Kept as a module of its own because both the reconciler and the Changes
 * surface need it, and because the Rust watcher carries the same list
 * (`src-tauri/src/vault/sync_names.rs`). If one side learns a pattern the other
 * has not, a conflict copy becomes a script in the binder.
 */

/**
 * Syncthing: `<name>.sync-conflict-YYYYMMDD-HHMMSS-<7 chars>.<ext>`.
 * Its bookkeeping is separate (`isProviderArtifact`).
 */
const SYNCTHING = /\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}\./;

/**
 * Dropbox: `<name> (<who>'s conflicted copy <date>).<ext>`, the English form.
 * A localized form is an ordinary file — guessing at translations would start
 * hiding files a writer named themselves.
 */
const DROPBOX = /\s\(.+conflicted copy \d{4}-\d{2}-\d{2}\)/i;

/** True for a conflict copy whose provider names it unambiguously. */
export function isProviderConflictCopy(name: string): boolean {
  return SYNCTHING.test(name) || DROPBOX.test(name);
}

/** Syncthing's own bookkeeping — not a conflict copy, and never a binder item. */
export function isProviderArtifact(name: string): boolean {
  return (
    name === ".stfolder" ||
    name === ".stversions" ||
    name === ".stignore" ||
    (name.startsWith("~syncthing~") && name.endsWith(".tmp"))
  );
}

/**
 * The file a conflict copy is a copy OF, or null when the name is not one.
 * Used to phrase "another version of <script>" rather than showing the raw
 * name, and to group several copies of the same file together.
 */
export function conflictOriginal(name: string): string | null {
  const sync = name.match(/^(.*)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]{7}(\..*)$/);
  if (sync) return `${sync[1]}${sync[2]}`;
  const drop = name.match(/^(.*)\s\(.+conflicted copy \d{4}-\d{2}-\d{2}\)(\..*)?$/i);
  if (drop) return `${drop[1]}${drop[2] ?? ""}`;
  return null;
}
