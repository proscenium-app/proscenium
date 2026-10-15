// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { commentsState, type CommentThread } from "../comments/plugin";
import { sceneStarts } from "../editor/scene-starts";

export type SceneComments = { total: number; todo: number };

/**
 * The comments in one scene of the outline, and how many of them are to-dos
 * (docs/app/writing/comments.md#COMM-70).
 *
 * The scene is a stretch of the script, from the line it begins at to the line
 * the next one begins at: where the caret is while the inspector shows this
 * scene. A comment is counted when it stands in that stretch, on the scene's
 * own first line too. No title is read. The scene used to be matched by its
 * title against the heading each comment is listed under, which is another
 * reading: a comment under a scene heading inside a titled scene was counted
 * for no scene, and every scene called `SCENE 1` counted the comments of them
 * all.
 *
 * A comment and its replies are one, as the bar's count and the feed's are
 * (docs/app/writing/comments.md#COMM-53); a to-do anywhere in the conversation makes it one.
 */
export function countSceneComments(
  doc: PmNode,
  threads: readonly CommentThread[],
  ordinal: number | null,
): SceneComments {
  const counts = { total: 0, todo: 0 };
  if (ordinal === null) return counts;
  const starts = sceneStarts(doc);
  const from = starts[ordinal];
  if (from === undefined) return counts;
  const to = starts[ordinal + 1] ?? doc.content.size;
  for (const thread of threads) {
    if (thread.root.pos < from || thread.root.pos >= to) continue;
    counts.total += 1;
    if ([thread.root, ...thread.replies].some((entry) => entry.parsed.todo)) counts.todo += 1;
  }
  return counts;
}

function sceneComments(editor: Editor | null, ordinal: number | null): SceneComments {
  const state = editor ? commentsState(editor.state) : undefined;
  if (!editor || !state) return { total: 0, todo: 0 };
  return countSceneComments(editor.state.doc, state.threads, ordinal);
}

/**
 * The scene's comments as the document stands, after every change of it, as
 * the feed follows it. A comment is text, so an undo can take one away and
 * leave the document the size it was: a count keyed on the size stayed at
 * the old number until something else drew the inspector again. The owner
 * draws again only when a number changes.
 */
export function useSceneComments(editor: Editor | null, ordinal: number | null): SceneComments {
  const [counts, setCounts] = useState(() => sceneComments(editor, ordinal));
  useEffect(() => {
    const sync = () =>
      setCounts((prev) => {
        const next = sceneComments(editor, ordinal);
        return prev.total === next.total && prev.todo === next.todo ? prev : next;
      });
    sync();
    if (!editor) return;
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor, ordinal]);
  return counts;
}
