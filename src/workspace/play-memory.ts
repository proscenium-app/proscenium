// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the window remembers of one play, by the play's folder: how its panes
 * were laid out, and which of its binder's folders were open. The one place
 * those keys are spelled, so a play that is renamed or copied
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-208,
 * docs/app/keeping-work/storage-and-file-format.md#STOR-197) keeps how the
 * writer left it.
 */

import { joinPath } from "../storage/path-key";

/** The pane layout of the play at `root`, its folder's full path (src/app/use-panes.ts). */
export const panesKey = (root: string) => `proscenium:panes:v2:${root}`;
/** The v1 `{split, surface, ratio}` layout, read once and migrated. */
export const legacyPanesKey = (root: string) => `proscenium:panes:${root}`;
/** Which binder folders are open, for the play whose folder is named `title` (BinderView.tsx). */
export const expandedKey = (title: string) => `proscenium.binder.expanded:${title}`;

/**
 * Carry what the window remembers of the play `from` (a folder in the Plays
 * folder at `base`) to the play `to`: moved for a rename, copied for a copy.
 * Storage that refuses keeps what it had; nothing here can stop the play.
 */
export function carryPlayMemory(base: string, from: string, to: string, move: boolean): void {
  try {
    const pairs: [string, string][] = [
      [panesKey(joinPath(base, from)), panesKey(joinPath(base, to))],
      [expandedKey(from), expandedKey(to)],
    ];
    for (const [old, next] of pairs) {
      const value = localStorage.getItem(old);
      if (value === null) continue;
      localStorage.setItem(next, value);
      if (move && old !== next) localStorage.removeItem(old);
    }
  } catch {
    /* storage refused: the play opens with its layout reset */
  }
}
