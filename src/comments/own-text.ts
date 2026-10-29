// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A line's own text: what the writer typed on it, without the comments on it
 * (docs/app/writing/comments.md#COMM-67).
 *
 * A comment stands in a line and is no part of what the line says. The
 * editor's `textContent` runs the two together, so a cue of `MARA` with a
 * comment on it read as a speaker called "MARARobin: rename?", and a heading
 * with one carried the comment's words into every label made from it. Anything
 * that reads a line for what it says (who speaks, which scene this is, whether
 * a name was just typed) reads it here.
 *
 * Works on the editor's nodes and needs nothing else of the editor.
 */
import type { Node as PMNode } from "@tiptap/pm/model";

/** The text typed directly on a line. A note's text is the note's. */
export function ownText(line: PMNode): string {
  let text = "";
  line.forEach((child) => {
    if (child.isText) text += child.text ?? "";
  });
  return text;
}

/**
 * A comment's text as the script holds it
 * (docs/app/writing/comments.md#COMM-73). On the page a line break is a node
 * (editor/bridge.ts), which `textContent` leaves out: a comment of two lines
 * read `Sam: onetwo` once the script had been opened again, on its card and
 * in the field that edits it, and an edit saved it so.
 */
export function commentText(note: PMNode): string {
  let text = "";
  note.forEach((child) => {
    text += child.type.name === "lineBreak" ? "\n" : child.textContent;
  });
  return text;
}

/** How much of a line's own text stands before `offset`, an offset into the line's content. */
export function ownOffset(line: PMNode, offset: number): number {
  let own = 0;
  line.forEach((child, start) => {
    if (child.isText) own += Math.max(0, Math.min(child.nodeSize, offset - start));
  });
  return own;
}

/**
 * Where the first `length` characters of a line's own text stand, as offsets
 * into its content, or null when something that is not text (a comment, a line
 * break) stands among them: whatever replaced that stretch would take the
 * comment with it. A comment in front of the text or after the stretch is left
 * outside it.
 */
export function ownStretch(line: PMNode, length: number): { from: number; to: number } | null {
  let own = 0;
  let from: number | null = null;
  let to: number | null = null;
  let broken = false;
  line.forEach((child, at) => {
    if (to !== null || length <= 0) return;
    if (!child.isText) {
      if (from !== null) broken = true;
      return;
    }
    if (from === null) from = at;
    if (own + child.nodeSize >= length) to = at + (length - own);
    own += child.nodeSize;
  });
  return broken || from === null || to === null ? null : { from, to };
}
