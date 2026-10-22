// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { announce } from "../ui/announce";

export interface CommentFocus {
  /** What happened, as it is spoken: "Comment saved". */
  action: string;
  /** The comment or reply to return to, by its runtime identity; null for none. */
  id: string | null;
  /** The control on it that takes focus, by its name. */
  control?: string;
  /**
   * Say how many comments are left. A reply made, changed or removed leaves
   * the count as it was, and says nothing of it.
   */
  count?: boolean;
  /** The comment was being made in the script: go back to the script. */
  toScript?: boolean;
}

/** Restore focus after React has replaced a composer or removed a comment.
 * Identity survives position shifts; if the whole margin vanished, use the script. */
export function useCommentFocus(editor: Editor | null, root: RefObject<HTMLElement | null>) {
  const [request, setRequest] = useState<CommentFocus | null>(null);
  useLayoutEffect(() => {
    if (!request || !editor || editor.isDestroyed) return;
    const message = request.id
      ? root.current?.querySelector<HTMLElement>(`[data-message-id="${request.id}"]`)
      : null;
    const target = request.toScript
      ? null
      : (message?.querySelector<HTMLElement>(
          `[aria-label="${request.control ?? "Edit comment"}"]`,
        ) ?? root.current?.querySelector<HTMLElement>("[data-comment-fallback]"));
    if (target) target.focus({ preventScroll: true });
    else editor.commands.focus();
    const count = editor.storage.comments.count;
    announce(
      request.count === false
        ? `${request.action}.`
        : `${request.action}. ${count} comment${count === 1 ? "" : "s"} remaining.`,
    );
  }, [request, editor, root]);
  return (focus: CommentFocus) => setRequest(focus);
}
