// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the status line makes of each report about the folder it watches
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-86): whether it shows
 * "Checking file changes…", and what it says aloud.
 *
 * Every watcher starts as `restarting` and turns `watching` once it is set
 * up, so a folder just opened reports a start, not a lost connection. Taken
 * for a recovery, the start said "Checking file changes" and "File changes
 * are up to date" each time a play or a practice opened, and on a slow
 * machine those words took the place of what was being said just then, a
 * lesson's step among them. So the first moments of a folder never watched
 * are its start: nothing is shown or said, and a start that outlasts them is
 * shown and said as any other.
 */

import type { WatchHealth } from "../storage/ipc";

/** How long a folder's first watch may take before it is shown as checking. */
export const START_GRACE_MS = 2000;

export const CHECKING = "Checking file changes. Proscenium is reconnecting to this folder.";
export const UP_TO_DATE = "File changes are up to date.";

/** Where the status line stands with one folder. */
export interface Heard {
  /** The folder has been watched at least once since it was opened. */
  watched: boolean;
  /** "Checking" was said, and "up to date" is owed. */
  said: boolean;
}

export const FRESH: Heard = { watched: false, said: false };

/**
 * One report, `msSinceOpen` after the folder was opened. `wait` is set while
 * the report is a start inside its grace: the report is neither shown nor
 * said, and the status is asked again after `wait` ms.
 */
export function hear(
  was: Heard,
  status: WatchHealth["status"] | null,
  msSinceOpen: number,
): { now: Heard; say: string | null; wait: number | null } {
  if (status === "restarting" && !was.watched && msSinceOpen < START_GRACE_MS)
    return { now: was, say: null, wait: START_GRACE_MS - msSinceOpen };
  if (status === null || status === "watching")
    return {
      now: { watched: was.watched || status === "watching", said: false },
      say: was.said ? UP_TO_DATE : null,
      wait: null,
    };
  return { now: { ...was, said: true }, say: was.said ? null : CHECKING, wait: null };
}
