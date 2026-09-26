// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the app itself landed on disk, said once, by the guarded write.
 *
 * Changes decides whether a file changed by comparing it with a baseline: the
 * last text this device showed the writer or wrote itself (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). Each
 * write site used to move that baseline by hand, and five never did — the
 * Appearances sync, a board move or restore, Keep This, keeping another
 * version, the outline notes. Nothing noticed while only the watcher reported,
 * because it drops the app's own writes; once returning to the app re-read the
 * open files (docs/app/keeping-work/storage-and-file-format.md#STOR-86), the next look at each of those files listed Proscenium's
 * own words as "Changed somewhere else". Every one of them goes through
 * `vault.write`, so that is where it is said, and a new writer cannot forget.
 */

export interface OwnWrite {
  /** The play whose folder the vault was open at when the write was sent. */
  playId: string;
  /** Play-relative path, as written. */
  rel: string;
  /** The bytes that landed. */
  content: string;
}

const followers = new Set<(write: OwnWrite) => void>();
let openPlay: string | null = null;

/** The vault now points at this play's folder, or at no play (null). */
export function vaultOpenedAt(playId: string | null): void {
  openPlay = playId;
}

/**
 * Called as a guarded write is sent; the result is called with whether it
 * landed. The play is taken NOW: a write still out when another play opens
 * landed in the folder it was sent to, and that is the play it belongs to.
 * Writes to the Plays folder itself belong to no play and are not reported.
 */
export function sendingWrite(rel: string, content: string): (landed: boolean) => void {
  const playId = openPlay;
  return (landed) => {
    if (!landed || playId === null) return;
    for (const follow of followers) {
      try {
        follow({ playId, rel, content });
      } catch {
        // Following a write is bookkeeping. It never fails the write.
      }
    }
  };
}

/** Hear every write the app lands. Returns the unsubscribe. */
export function onOwnWrite(follow: (write: OwnWrite) => void): () => void {
  followers.add(follow);
  return () => {
    followers.delete(follow);
  };
}
