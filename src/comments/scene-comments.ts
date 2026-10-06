// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { commentsState } from "./plugin";

export type SceneComments = { total: number; todo: number };

/** The comments under one scene heading, and how many of them are to-dos. */
export function countSceneComments(editor: Editor | null, heading: string | null): SceneComments {
  const state = editor ? commentsState(editor.state) : undefined;
  if (!state || heading === null) return { total: 0, todo: 0 };
  let total = 0;
  let todo = 0;
  for (const entry of state.entries) {
    if (entry.scene !== heading) continue;
    total += 1;
    if (entry.parsed.todo) todo += 1;
  }
  return { total, todo };
}

/**
 * The scene's comments as the document stands, after every change of it, as
 * the feed follows it. A comment is text, so an undo can take one away and
 * leave the document the size it was: a count keyed on the size stayed at
 * the old number until something else drew the inspector again. The owner
 * draws again only when a number changes.
 */
export function useSceneComments(editor: Editor | null, heading: string | null): SceneComments {
  const [counts, setCounts] = useState(() => countSceneComments(editor, heading));
  useEffect(() => {
    const sync = () =>
      setCounts((prev) => {
        const next = countSceneComments(editor, heading);
        return prev.total === next.total && prev.todo === next.todo ? prev : next;
      });
    sync();
    if (!editor) return;
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor, heading]);
  return counts;
}
