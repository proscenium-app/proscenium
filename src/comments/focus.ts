// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { commentsState } from "./plugin";
import { announce } from "../ui/announce";

/** Restore focus after React has replaced a composer or removed a comment.
 * Identity survives position shifts; if the whole margin vanished, use the script. */
export function useCommentFocus(editor: Editor | null, root: RefObject<HTMLElement | null>) {
  const [request, setRequest] = useState<{ id: string | null; action: string } | null>(null);
  useLayoutEffect(() => {
    if (!request || !editor || editor.isDestroyed) return;
    const row = request.id ? root.current?.querySelector<HTMLElement>(`[data-comment-id="${request.id}"]`) : null;
    const target = row?.querySelector<HTMLElement>('[aria-label="Edit comment"]') ??
      root.current?.querySelector<HTMLElement>("[data-comment-fallback]");
    if (target) target.focus({ preventScroll: true });
    else editor.commands.focus();
    const count = commentsState(editor.state)?.entries.length ?? 0;
    announce(`${request.action}. ${count} comment${count === 1 ? "" : "s"} remaining.`);
  }, [request, editor, root]);
  return (action: string, id: string | null) => setRequest({ action, id });
}
