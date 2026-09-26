// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What was just made opens for the writer, and the cursor goes onto its page
 * (docs/app/preferences-and-help/accessibility.md#A11Y-4).
 *
 * Opening used to live in the binder's reveal effect, which runs only while the
 * binder is mounted: a sheet the Cast made with the binder closed was created
 * and never shown. It is opened here now, wherever it was made, and the page is
 * asked for the cursor at once unless the binder names the item first — then
 * the binder asks, when ⏎ or ⎋ leaves the name (BinderView).
 *
 * The script is a page too. Each sheet offers itself (MaterialEditor); the one
 * editor that holds the open script is offered here, for the binder item whose
 * words it holds, with the caret at the end of them.
 */
import { useEffect, useMemo, useRef } from "react";
import { TextSelection } from "@tiptap/pm/state";
import { onScreen, requestPageFocus, usePageTarget } from "../ui";
import { binder as tree, type BinderItem } from "../workspace";
import { findBinderItem } from "./use-workspace-panes";
import type { CreatedItem, Workspace } from "./useWorkspace";

export function useCreatedPages(
  ws: Pick<Workspace, "justCreated" | "consumeCreated" | "binder" | "editor" | "scriptPath">,
  open: (item: BinderItem) => void,
) {
  const { justCreated, consumeCreated, binder, editor, scriptPath } = ws;

  const opened = useRef<CreatedItem | null>(null);
  useEffect(() => {
    if (!justCreated || opened.current === justCreated) return;
    // The binder state can arrive a render after the id; this runs again then.
    const item = findBinderItem(binder, justCreated.id);
    if (!item) return;
    opened.current = justCreated;
    if (item.type !== "folder") open(item);
    if (!justCreated.name) {
      requestPageFocus(item.id);
      // After the binder's own effect has opened the item's folders: a child's
      // effects run before this one, in the same commit.
      consumeCreated();
    }
  }, [justCreated, binder, open, consumeCreated]);

  const scriptId = useMemo(
    () =>
      scriptPath
        ? (tree.flatten(binder).find((it) => it.type === "script" && it.path === scriptPath)?.id ??
          null)
        : null,
    [binder, scriptPath],
  );
  usePageTarget(
    scriptId,
    editor && {
      hasFocus: () => editor.view.hasFocus(),
      ready: () => !editor.isDestroyed && onScreen(editor.view.dom),
      focus: () => {
        const { state } = editor;
        editor.view.dispatch(
          state.tr.setSelection(TextSelection.atEnd(state.doc)).setMeta("addToHistory", false),
        );
        editor.view.focus();
        editor.commands.scrollIntoView();
      },
    },
  );
}
