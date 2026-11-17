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
 */
import type { Editor } from "@tiptap/core";

const open = new WeakMap<Editor, Set<() => void>>();

/** Hold a surface's open field for `editor`; the returned function lets it go. */
export function holdOpenComment(editor: Editor, settle: () => void): () => void {
  let held = open.get(editor);
  if (!held) {
    held = new Set();
    open.set(editor, held);
  }
  held.add(settle);
  return () => {
    open.get(editor)?.delete(settle);
  };
}

/**
 * Settle every field open on `editor`: words typed are saved as their comment
 * or reply, and a new comment with none is taken out, as Esc takes it out.
 */
export function settleOpenComments(editor: Editor): void {
  if (editor.isDestroyed) return;
  for (const settle of [...(open.get(editor) ?? [])]) settle();
}
