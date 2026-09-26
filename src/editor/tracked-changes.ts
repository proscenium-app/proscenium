// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The tracked-changes decoration plugin.
 *
 * Renders a `TrackedMarks` set over the open script: added blocks get a tint
 * and a left rule, removed lines appear as struck-through widgets at the
 * position they were cut from.
 *
 * DECORATIONS ONLY. This plugin never dispatches a document transaction, so
 * the marks cannot become part of the play, cannot be serialized into the
 * `.fountain`, and cannot survive being switched off. That is what lets an
 * "editing mode" exist over a file format with no representation for one.
 */
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { emptyMarks, type TrackedMarks } from "../review/tracked";

export const trackedChangesKey = new PluginKey<TrackedMarks>("prosceniumTrackedChanges");

/** A struck-through line the change removed. Display only — never editable. */
function removedWidget(lines: string[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "tracked__removed";
  box.setAttribute("contenteditable", "false");
  for (const line of lines) {
    const row = document.createElement("del");
    row.className = "tracked__removedline";
    // textContent, never innerHTML: this text came from a file something else
    // wrote.
    row.textContent = line || " ";
    box.appendChild(row);
  }
  return box;
}

function build(doc: PMNode, marks: TrackedMarks): DecorationSet {
  if (marks.added.size === 0 && marks.removedBefore.size === 0) {
    return DecorationSet.empty;
  }
  const decos: Decoration[] = [];
  let block = 0;
  doc.forEach((node, offset) => {
    if (marks.added.has(block)) {
      decos.push(Decoration.node(offset, offset + node.nodeSize, { class: "tracked-added" }));
    }
    const removed = marks.removedBefore.get(block);
    if (removed?.length) {
      decos.push(Decoration.widget(offset, () => removedWidget(removed), { side: -1 }));
    }
    block += 1;
  });
  // Anything removed past the end of the document has nowhere to attach above,
  // so it hangs off the last position rather than being dropped.
  const tail = marks.removedBefore.get(block);
  if (tail?.length) {
    decos.push(
      Decoration.widget(Math.max(0, doc.content.size), () => removedWidget(tail), { side: 1 }),
    );
  }
  return DecorationSet.create(doc, decos);
}

/**
 * Marks live in PLUGIN STATE, updated by a meta transaction — not in
 * `this.options`. TipTap's `addProseMirrorPlugins` closes over an options
 * object that is not the same reference `extensionManager.extensions[i].options`
 * exposes, so mutating the latter never reached the decoration function and the
 * layer silently rendered nothing. Plugin state is the idiomatic channel and has
 * no such ambiguity.
 */
export const TrackedChanges = Extension.create({
  name: "prosceniumTrackedChanges",

  addProseMirrorPlugins() {
    return [
      new Plugin<TrackedMarks>({
        key: trackedChangesKey,
        state: {
          init: () => emptyMarks(),
          apply(tr, value) {
            const next = tr.getMeta(trackedChangesKey) as TrackedMarks | undefined;
            return next ?? value;
          },
        },
        props: {
          decorations(state) {
            return build(state.doc, trackedChangesKey.getState(state) ?? emptyMarks());
          },
        },
      }),
    ];
  },
});

/** Push a new set of marks into an editor's decoration layer. */
export function setTrackedMarks(editor: Editor, marks: TrackedMarks): void {
  editor.view.dispatch(editor.state.tr.setMeta(trackedChangesKey, marks));
}
