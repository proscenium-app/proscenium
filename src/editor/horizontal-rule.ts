// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A press on a horizontal line selects it (docs/app/writing/editor-ux.md#EDIT-213),
 * so Backspace or Delete takes it away and the selection outline shows which
 * line it is.
 *
 * The line is drawn between the script's lines with no text of its own, and a
 * press on such a block is CaretOnFocus's: it keeps the caret where it stands
 * and says the press is handled, which ends every handler after it. So this
 * one runs ahead of it, by priority: TipTap runs a later extension's handlers
 * first, and a higher priority before both. It is an extension of its own, not
 * the node's, because a node's priority also orders the schema, whose first
 * block is the one ProseMirror makes when nobody names one (schema.ts).
 */
import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** The document position of the line whose element is `line`, or -1. */
export function lineAt(view: EditorView, line: Element): number {
  let at = -1;
  view.state.doc.forEach((node, offset) => {
    if (at < 0 && node.type.name === "horizontalRule" && view.nodeDOM(offset) === line) at = offset;
  });
  return at;
}

export const HorizontalRulePress = Extension.create({
  name: "horizontalRulePress",
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("horizontalRulePress"),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              if (!view.editable || event.button !== 0) return false;
              if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
              const line = (event.target as Element | null)?.closest?.(".pl-horizontalRule");
              if (!line || !view.dom.contains(line)) return false;
              const at = lineAt(view, line);
              if (at < 0) return false;
              // Neither the browser's caret nor its focus: the editor's own.
              event.preventDefault();
              view.focus();
              view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)));
              return true;
            },
          },
        },
      }),
    ];
  },
});
