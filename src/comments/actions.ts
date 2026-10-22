// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the margin and the feed do to a comment (docs/app/writing/comments.md#COMM-D5,
 * docs/app/writing/comments.md#COMM-D10). A comment is script text, so each of these is an
 * ordinary edit of the document: one transaction, one step of undo, saved by
 * the autosave that saves a typed word. There is nothing else to keep in step.
 *
 * Both surfaces call these and nothing of their own, so the two cannot come to
 * treat a comment differently.
 */
import type { Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { commentsState, type CommentThread } from "./plugin";
import { COMMENT_RANGE_END } from "./ranges";

/** The comment node at `pos`, verified — positions go stale across edits. */
export function noteAt(editor: Editor, pos: number): PMNode | null {
  const node = editor.state.doc.nodeAt(pos);
  return node && node.type.name === "note" ? node : null;
}

/** The thread whose comment is at `rootPos`, as the document stands now. */
export function threadAt(editor: Editor, rootPos: number): CommentThread | null {
  return commentsState(editor.state)?.threads.find((thread) => thread.root.pos === rootPos) ?? null;
}

/**
 * A note holds no blank lines: one would end it when the script is read back
 * (docs/app/writing/comments.md#COMM-74). A line of spaces is a blank line
 * too, to whatever reads the script.
 */
export function commentDraft(draft: string): string {
  return draft.replace(/\n(?:[^\S\n]*\n)+/g, "\n").trim();
}

/**
 * A comment's words as the page holds them: a line break is a node there
 * (editor/bridge.ts), which is what the script's newline is read back as. A
 * comment saved with a newline in its text was one page before the script was
 * opened again and another after.
 */
export function commentContent(schema: Schema, text: string): Fragment {
  const lineBreak = schema.nodes.lineBreak;
  if (!lineBreak) return Fragment.from(schema.text(text));
  const nodes: PMNode[] = [];
  text.split("\n").forEach((line, i) => {
    if (i > 0) nodes.push(lineBreak.create());
    if (line) nodes.push(schema.text(line));
  });
  return Fragment.fromArray(nodes);
}

/**
 * Take `from`–`to` out of its block. A line that held nothing but the comments
 * going — a standalone comment, alone or with its replies — goes with them: it
 * never printed, and an empty line left behind would.
 */
function removeRange(tr: Transaction, from: number, to: number): void {
  const $from = tr.doc.resolve(from);
  const whole = from === $from.start() && to === $from.end();
  // The script's only line stays, empty: a script holds at least one.
  const last = $from.depth === 1 && tr.doc.childCount === 1;
  if (whole && !last) tr.delete($from.before(), $from.after());
  else tr.delete(from, to);
}

/** Replace a comment's text. False when the comment is no longer there. */
export function saveCommentText(editor: Editor, pos: number, text: string): boolean {
  const node = noteAt(editor, pos);
  if (!node || !text) return false;
  return editor
    .chain()
    .command(({ tr, state, dispatch }) => {
      if (dispatch) {
        tr.replaceWith(pos + 1, pos + node.nodeSize - 1, commentContent(state.schema, text));
      }
      return true;
    })
    .run();
}

/**
 * Take one comment out: a reply, or a comment whose replies stay. The first
 * reply is the comment from then on (docs/app/writing/comments.md#COMM-55), and
 * what the comment was about is what it is about: the range goes to it.
 */
export function deleteComment(editor: Editor, pos: number): boolean {
  const node = noteAt(editor, pos);
  if (!node) return false;
  const heir = threadAt(editor, pos)?.replies[0];
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) takeCommentOut(tr, pos, heir?.pos ?? null);
      return true;
    })
    .run();
}

/**
 * The step `deleteComment` makes: the comment at `pos` out of the document,
 * its range handed to the reply at `heirPos` when there is one.
 */
export function takeCommentOut(tr: Transaction, pos: number, heirPos: number | null): void {
  const node = tr.doc.nodeAt(pos);
  if (node?.type.name !== "note") return;
  const range = node.marks.filter((mark) => mark.type.name === COMMENT_RANGE_END);
  const reply = heirPos !== null && range.length ? tr.doc.nodeAt(heirPos) : null;
  if (heirPos !== null && reply?.type.name === "note") {
    // The reply stands after the comment, so marking it first leaves the
    // comment where it was.
    const marks = range.reduce((set, mark) => mark.addToSet(set), reply.marks);
    tr.setNodeMarkup(heirPos, undefined, undefined, marks);
  }
  removeRange(tr, pos, pos + node.nodeSize);
}

/**
 * Resolve a conversation: the comment and every reply under it, with the white
 * space that was between them. Delete IS resolve — the trail is the history
 * ring and the ledger (docs/app/writing/comments.md#COMM-30).
 */
export function resolveThread(editor: Editor, rootPos: number): boolean {
  const thread = threadAt(editor, rootPos);
  if (!thread) return false;
  return editor
    .chain()
    .command(({ tr, dispatch }) => {
      if (dispatch) removeRange(tr, thread.root.pos, thread.end);
      return true;
    })
    .run();
}

/**
 * Answer a comment: a note directly after the last one in its thread, which is
 * all a reply is in the script (docs/app/writing/comments.md#COMM-50). Returns where it
 * went, or null when the comment is no longer there.
 */
export function addReply(editor: Editor, rootPos: number, text: string): number | null {
  const thread = threadAt(editor, rootPos);
  const noteType = editor.state.schema.nodes.note;
  if (!thread || !noteType || !text) return null;
  const at = thread.end;
  const done = editor
    .chain()
    .command(({ tr, state, dispatch }) => {
      if (dispatch) tr.insert(at, noteType.create(null, commentContent(state.schema, text)));
      return true;
    })
    .run();
  return done ? at : null;
}
