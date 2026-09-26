// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The outline scratchpad: one freeform page per play for thinking about shape.
 *
 * The scene table below it holds what the play IS — acts, scenes, synopses,
 * status. That's structure, and structure is unforgiving: you can't write "what
 * if the brother arrives in act two instead" in a status dropdown. This is the
 * other half — the place notes land before they're anything, kept beside the
 * table rather than in a different app.
 *
 * It is a perfectly ordinary Markdown document (docs/app/keeping-work/storage-and-file-format.md#STOR-D7 documents), typed `outline`,
 * living at `Notes/Outline.md`. A stranger with `cat` finds prose in a notes
 * folder. What's special is only that the Outline surface owns it and there is
 * at most one per play — so the writer never has to decide where the loose
 * thinking goes.
 *
 * Pure helpers only: nothing here reads or writes the vault.
 */
import type { BinderItem } from "./play-file";

/** The title given to the note when the app creates it. */
export const OUTLINE_NOTE_TITLE = "Outline";

/**
 * The play's outline note, or null when it hasn't been started. Walks the whole
 * tree because the writer may have filed it in a folder; takes the FIRST by
 * binder order so a second one (hand-authored, or synced in) is inert rather
 * than ambiguous — a stable choice beats a clever one here.
 */
export function findOutlineNote(binder: BinderItem[]): BinderItem | null {
  for (const item of binder) {
    if (item.type === "outline" && item.path) return item;
    if (item.children) {
      const nested = findOutlineNote(item.children);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Whether a body is worth committing to disk. Guards lazy creation: the note is
 * only born when the writer actually types something, so opening the Outline
 * surface and looking at it never litters the play with an empty file.
 */
export function hasContent(body: string): boolean {
  return body.trim().length > 0;
}
