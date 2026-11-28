// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A comment field still open when the script is left
 * (docs/app/writing/comments.md#COMM-76). A new comment is in the script from
 * the moment it is made, as a note holding placeholder text, and the words
 * typed for it are in its field until it is saved. Leaving the script took the
 * field away and left the note: the script was saved with a comment reading
 * "comment", and the words were gone.
 *
 * Each surface with a field open holds it here, and the workspace settles them
 * before it lands the script it is leaving, so what is settled is in the last
 * write.
 *
 * And a new comment typed on one surface that the other takes over
 * (docs/app/writing/comments.md#COMM-79): the margin's card loses its room
 * while the comment is being typed, and the feed is where it is typed now. The
 * feed opened an empty field of its own and the card kept its words out of
 * sight, so the comment had two fields, and the words were in the one that
 * could not be seen; with the room back, both were open. The surface taking a
 * new comment over takes its words from the one that had it, which closes its
 * field: one field, wherever the comment is typed.
 */
import type { Editor } from "@tiptap/core";

/** What a surface's open field can be asked for. */
export interface OpenField {
  /** Save what was typed, or take out a new comment with none, as Esc does. */
  settle: () => void;
  /**
   * The words and the name typed for the new comment `id`, given up: the field
   * closes here. Null when no field here is making that comment.
   */
  handOver: (id: string) => { draft: string; name: string } | null;
}

const open = new WeakMap<Editor, Set<OpenField>>();

/** Hold a surface's open field for `editor`; the returned function lets it go. */
export function holdOpenComment(editor: Editor, field: OpenField): () => void {
  let held = open.get(editor);
  if (!held) {
    held = new Set();
    open.set(editor, held);
  }
  held.add(field);
  return () => {
    open.get(editor)?.delete(field);
  };
}

/**
 * Settle every field open on `editor`: words typed are saved as their comment
 * or reply, and a new comment with none is taken out, as Esc takes it out.
 */
export function settleOpenComments(editor: Editor): void {
  if (editor.isDestroyed) return;
  for (const field of [...(open.get(editor) ?? [])]) field.settle();
}

/**
 * Take the new comment `id` over from whichever surface is making it: its
 * words and name, and its field closed there. Null when none is.
 */
export function takeNewComment(editor: Editor, id: string): { draft: string; name: string } | null {
  for (const field of [...(open.get(editor) ?? [])]) {
    const words = field.handOver(id);
    if (words) return words;
  }
  return null;
}
