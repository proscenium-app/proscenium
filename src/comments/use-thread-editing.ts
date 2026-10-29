// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a writer can be in the middle of on a comment surface — changing a
 * comment, making one, answering one — and what each of those does when it is
 * saved or abandoned (docs/app/writing/comments.md#COMM-D5, docs/app/writing/comments.md#COMM-D10).
 *
 * The margin and the feed each hold one of these. They used to hold two copies
 * of the same save and resolve, which is how one surface came to focus the
 * comment it edited and the other not.
 */
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { addReply, commentDraft, deleteComment, resolveThread, saveCommentText } from "./actions";
import type { CommentFocus } from "./focus";
import { cleanCommentName, signComment } from "./model";
import { commentsState, type CommentThread, type PmCommentEntry } from "./plugin";
import { settingsStore, updateSettings } from "../ui/settings-store";

export interface ThreadEditing {
  /** The comment or reply whose words are open in a field, by identity. */
  editingId: string | null;
  /** `editingId` is a comment that was just made: its first save signs it. */
  isNew: boolean;
  /** The conversation being answered, by its comment's identity. */
  replyingId: string | null;
  draft: string;
  setDraft: (draft: string) => void;
  /** The name field of a new comment or a reply. */
  name: string;
  setName: (name: string) => void;
  beginEdit: (entry: PmCommentEntry) => void;
  saveEdit: (id: string) => void;
  cancelEdit: (id: string) => void;
  beginReply: (thread: CommentThread) => void;
  saveReply: (rootId: string) => void;
  cancelReply: (rootId: string) => void;
  deleteReply: (entry: PmCommentEntry) => void;
  resolve: (rootId: string) => void;
}

export function useThreadEditing({
  editor,
  threads,
  takesNew,
  request,
  complete,
}: {
  editor: Editor | null;
  /** The conversations this surface shows, in order: where focus goes when one is resolved. */
  threads: readonly CommentThread[];
  /**
   * A comment made in the script (⌘⌥M) is typed here: in the margin when it
   * has room, in the feed when it has not (docs/app/writing/comments.md#COMM-56).
   */
  takesNew: boolean;
  /** The script's request, as this surface last read it: what re-runs the check below. */
  request: { focusPos: number | null; composing: boolean; replying: boolean };
  complete: (focus: CommentFocus) => void;
}): ThreadEditing {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newId, setNewId] = useState<string | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");

  const live = () => (editor ? commentsState(editor.state) : undefined);
  const entryOf = (id: string) => live()?.entries.find((entry) => entry.id === id);
  const threadOf = (rootId: string) => live()?.threads.find((thread) => thread.root.id === rootId);
  const isReply = (entry: PmCommentEntry) => entry.root !== entry.pos;

  const close = () => {
    setEditingId(null);
    setNewId(null);
    setReplyingId(null);
    setDraft("");
  };

  /** The name as the field holds it, kept for the next comment. */
  const signature = (): string => {
    const who = cleanCommentName(name);
    if (who !== settingsStore.getSnapshot().commentName) updateSettings({ commentName: who });
    return who;
  };

  const beginReply = (thread: CommentThread) => {
    setReplyingId(thread.root.id);
    setEditingId(null);
    setNewId(null);
    setDraft("");
    setName(settingsStore.getSnapshot().commentName);
    // Also ends the script's request to answer it: it has been taken.
    editor?.commands.focusComment(thread.root.pos);
  };

  // A comment just made opens for typing, and one asked for where a comment
  // already is opens that comment's reply. The request is read from the editor
  // itself, not from this surface's copy of it: the copy is a frame behind, and
  // a comment saved in that frame would open again.
  useEffect(() => {
    if (!editor || !takesNew) return;
    const asked = editor.storage.comments;
    if (asked.focusPos === null || (!asked.composing && !asked.replying)) return;
    const thread = live()?.threads.find((t) => t.root.pos === asked.focusPos);
    if (!thread) return;
    if (asked.replying) {
      if (replyingId !== thread.root.id) beginReply(thread);
      return;
    }
    if (editingId === thread.root.id) return;
    setEditingId(thread.root.id);
    setNewId(thread.root.id);
    setReplyingId(null);
    setDraft("");
    setName(settingsStore.getSnapshot().commentName);
    // `live` and `beginReply` read the editor; the request is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, takesNew, request.focusPos, request.composing, request.replying]);

  const gone = () => {
    close();
    complete({ action: "Comment is no longer here", id: null });
  };

  const beginEdit = (entry: PmCommentEntry) => {
    editor?.commands.focusComment(entry.root);
    setEditingId(entry.id);
    setNewId(null);
    setReplyingId(null);
    setDraft(entry.text);
  };

  const deleteReply = (entry: PmCommentEntry) => {
    if (!editor) return;
    const root = live()?.entries.find((e) => e.pos === entry.root);
    if (editingId === entry.id) close();
    deleteComment(editor, entry.pos);
    complete({
      action: "Reply deleted",
      id: root?.id ?? null,
      control: "Reply to comment",
      count: false,
    });
  };

  const resolve = (rootId: string) => {
    if (!editor) return;
    const thread = threadOf(rootId);
    if (!thread) return;
    const index = threads.findIndex((t) => t.root.id === rootId);
    const next = threads[index + 1] ?? threads[index - 1];
    const inThread = [thread.root, ...thread.replies].some((entry) => entry.id === editingId);
    if (inThread || replyingId === rootId) close();
    resolveThread(editor, thread.root.pos);
    editor.commands.doomComment(null);
    editor.commands.hoverComment(null);
    editor.commands.focusComment(null);
    complete({ action: "Comment resolved", id: next?.root.id ?? null });
  };

  const saveEdit = (id: string) => {
    if (!editor) return;
    const entry = entryOf(id);
    if (!entry) return gone();
    const text = commentDraft(draft);
    const wasNew = newId === id;
    const reply = isReply(entry);
    if (!text) {
      // A comment that was being made and has no words was never made.
      if (wasNew) return cancelEdit(id);
      // A comment saved with nothing in it is taken out.
      if (reply) return deleteReply(entry);
      const thread = live()?.threads.find((t) => t.root.pos === entry.pos);
      if (!thread?.replies.length) return resolve(id);
      // Its replies stay, and the first of them is the comment now.
      close();
      deleteComment(editor, entry.pos);
      complete({ action: "Comment deleted", id: thread.replies[0].id });
      return;
    }
    const who = wasNew ? signature() : "";
    close();
    saveCommentText(editor, entry.pos, wasNew ? signComment(text, who) : text);
    // A comment that was being made is made: the script's request is answered.
    if (wasNew) editor.commands.focusComment(entry.root);
    complete({
      action: reply ? "Reply saved" : "Comment saved",
      id,
      control: reply ? "Edit reply" : "Edit comment",
      count: !reply,
    });
  };

  const cancelEdit = (id: string) => {
    if (!editor) return;
    const entry = entryOf(id);
    const wasNew = newId === id;
    close();
    if (wasNew) {
      // Nothing was written: the placeholder goes, and the writer is back in the script.
      if (entry) deleteComment(editor, entry.pos);
      editor.commands.hoverComment(null);
      editor.commands.focusComment(null);
      complete({ action: "Comment discarded", id: null, toScript: true });
      return;
    }
    const reply = !!entry && isReply(entry);
    complete({
      action: reply ? "Reply edit cancelled" : "Comment edit cancelled",
      id,
      control: reply ? "Edit reply" : "Edit comment",
      count: !reply,
    });
  };

  const cancelReply = (rootId: string) => {
    close();
    complete({ action: "Reply cancelled", id: rootId, control: "Reply to comment", count: false });
  };

  const saveReply = (rootId: string) => {
    if (!editor) return;
    const thread = threadOf(rootId);
    if (!thread) return gone();
    const text = commentDraft(draft);
    if (!text) return cancelReply(rootId);
    const who = signature();
    close();
    addReply(editor, thread.root.pos, signComment(text, who));
    complete({ action: "Reply added", id: rootId, control: "Reply to comment", count: false });
  };

  return {
    editingId,
    isNew: editingId !== null && editingId === newId,
    replyingId,
    draft,
    setDraft,
    name,
    setName,
    beginEdit,
    saveEdit,
    cancelEdit,
    beginReply,
    saveReply,
    cancelReply,
    deleteReply,
    resolve,
  };
}
