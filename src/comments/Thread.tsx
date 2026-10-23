// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One conversation: a comment and the replies under it, as the margin's card
 * and the feed's row both show it (docs/app/writing/comments.md#COMM-D10).
 *
 * Reading, changing, answering and resolving are the same here wherever the
 * conversation is shown, because this is the only place they are drawn. What a
 * surface adds is where the conversation sits and what a click on it means.
 */
import { keys } from "../ui/keys";
import { useRef, type MouseEvent } from "react";
import type { Editor } from "@tiptap/core";
import { CheckIcon, PencilIcon, ReplyIcon, ShowInScriptIcon, TrashIcon } from "../ui/Icons";
import { commentNameInput } from "./model";
import type { CommentThread, PmCommentEntry } from "./plugin";
import type { ThreadEditing } from "./use-thread-editing";

/** Is this thread the one with a field open in it? Its surface leaves its clicks alone. */
export function threadIsBusy(thread: CommentThread, editing: ThreadEditing): boolean {
  return (
    editing.replyingId === thread.root.id ||
    [thread.root, ...thread.replies].some((entry) => entry.id === editing.editingId)
  );
}

/**
 * The field a comment is typed in: a new comment, an answer, or a change to
 * either. A new comment and an answer carry the name they will be signed with
 * (docs/app/writing/comments.md#COMM-52); a change shows the comment as the script
 * holds it, signature and all, so the name is edited there with the words.
 */
function Composer({
  kind,
  editing,
  onSave,
  onCancel,
}: {
  kind: "new" | "reply" | "comment-edit" | "reply-edit";
  editing: ThreadEditing;
  onSave: () => void;
  onCancel: () => void;
}) {
  const field = useRef<HTMLTextAreaElement | null>(null);
  const signs = kind === "new" || kind === "reply";
  const label = {
    new: "New comment",
    reply: "Reply",
    "comment-edit": "Edit comment",
    "reply-edit": "Edit reply",
  }[kind];
  return (
    <div className="cthread__edit">
      {signs && (
        <input
          className="cthread__name"
          aria-label="Your name"
          placeholder="Your name"
          title="Signs your comments and replies. Leave it empty to add them unsigned."
          value={editing.name}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => editing.setName(commentNameInput(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              field.current?.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
      )}
      <textarea
        ref={field}
        className="cthread__field"
        value={editing.draft}
        // The field is opened by the writer's own act, and is where they type next.
        autoFocus
        rows={3}
        placeholder={kind === "reply" ? "Reply…" : "Comment…"}
        aria-label={label}
        onChange={(e) => editing.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="cthread__editrow">
        <button type="button" className="is-default" onClick={onSave} title={keys("⌘⏎")}>
          {kind === "reply" ? "Reply" : "Save"}
        </button>
        <button type="button" onClick={onCancel} title="Esc">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function ThreadView({
  editor,
  thread,
  editing,
  onShow,
  onWordsClick,
}: {
  editor: Editor;
  thread: CommentThread;
  editing: ThreadEditing;
  /** The feed's own action: show this comment in the script. */
  onShow?: () => void;
  /** A click on a comment's words, where the surface gives one a meaning. */
  onWordsClick?: (event: MouseEvent<HTMLElement>) => void;
}) {
  const { root } = thread;
  const doom = {
    onMouseEnter: () => editor.commands.doomComment(root.pos),
    onMouseLeave: () => editor.commands.doomComment(null),
    onFocus: () => editor.commands.doomComment(root.pos),
    onBlur: () => editor.commands.doomComment(null),
  };
  // A press on a control is not a press on the card: the card would take the
  // reading focus, and its surface would treat it as a click on the comment.
  const own = { onMouseDown: (e: MouseEvent) => e.stopPropagation() };

  const message = (entry: PmCommentEntry, reply: boolean) => {
    const open = editing.editingId === entry.id;
    const fresh = open && editing.isNew;
    return (
      <div
        key={entry.id}
        className={`cthread__msg${reply ? " is-reply" : ""}`}
        data-message-id={entry.id}
      >
        {/* A comment being made has no author yet: the name field says who. */}
        {!fresh && (
          <header className="cthread__head">
            <span className="cthread__author">
              {entry.parsed.author ?? (entry.parsed.todo ? "" : reply ? "Reply" : "Comment")}
            </span>
            {entry.parsed.todo && <span className="comments-chip is-todo">todo</span>}
            {!open && (
              <span className="cthread__actions">
                {!reply && onShow && (
                  <button
                    type="button"
                    {...own}
                    onClick={onShow}
                    title="Show in the script"
                    aria-label="Show comment in the script"
                  >
                    <ShowInScriptIcon size={13} />
                  </button>
                )}
                {!reply && (
                  <button
                    type="button"
                    {...own}
                    onClick={() => editing.beginReply(thread)}
                    title="Reply"
                    aria-label="Reply to comment"
                  >
                    <ReplyIcon size={13} />
                  </button>
                )}
                <button
                  type="button"
                  {...own}
                  onClick={() => editing.beginEdit(entry)}
                  title="Edit"
                  aria-label={reply ? "Edit reply" : "Edit comment"}
                >
                  <PencilIcon size={13} />
                </button>
                {reply ? (
                  <button
                    type="button"
                    {...own}
                    onClick={() => editing.deleteReply(entry)}
                    title="Delete this reply. History keeps it."
                    aria-label="Delete reply"
                  >
                    <TrashIcon size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    {...own}
                    onClick={() => editing.resolve(root.id)}
                    {...doom}
                    title={
                      thread.replies.length
                        ? "Resolve this comment and its replies. History keeps them."
                        : "Resolve. History keeps it."
                    }
                    aria-label="Resolve comment"
                  >
                    <CheckIcon size={13} />
                  </button>
                )}
              </span>
            )}
          </header>
        )}
        {open ? (
          <Composer
            kind={fresh ? "new" : reply ? "reply-edit" : "comment-edit"}
            editing={editing}
            onSave={() => editing.saveEdit(entry.id)}
            onCancel={() => editing.cancelEdit(entry.id)}
          />
        ) : (
          // The words can be selected and copied, which a button's cannot; the
          // keyboard's way to what a click does here is the Show control.
          <p className="cthread__body" onClick={onWordsClick}>
            {entry.parsed.body || <em>(empty)</em>}
          </p>
        )}
      </div>
    );
  };

  return (
    <>
      {message(root, false)}
      {thread.replies.map((reply) => message(reply, true))}
      {editing.replyingId === root.id && (
        <div className="cthread__msg is-reply">
          <Composer
            kind="reply"
            editing={editing}
            onSave={() => editing.saveReply(root.id)}
            onCancel={() => editing.cancelReply(root.id)}
          />
        </div>
      )}
    </>
  );
}
