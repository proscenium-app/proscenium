// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The forced page break, made visible and removable.
 *
 * A `===` break is a real document node, but it PRINTS nothing — so page view
 * collapses it (`display: none`, from the format's `print: false` rule) the way
 * it collapses every non-printing element, and the writer was left with a break
 * they could feel and never see: no object to click, no obvious key to press,
 * a scene that starts on a new page for no visible reason.
 *
 * The fix is the same one comments use (docs/app/writing/comments.md#COMM-D4): the node stays
 * collapsed so DOM geometry matches the engine, and a WIDGET carries its
 * presence — absolutely positioned with auto offsets, so it renders at its
 * static position while occupying zero width and zero height. It cannot move a
 * wrap or a page break; it just says where one is, and offers to remove it.
 *
 * Backspace at the head of the block after a break already deletes it (the
 * base keymap's atom branch). This adds the affordance a writer can see: click
 * to select it, ✕ to delete it.
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

const KEY = new PluginKey<DecorationSet>("pageBreakHandle");

/** The node at `pos`, verified — a decoration's position can go stale. */
function breakAt(view: EditorView, pos: number): PMNode | null {
  const node = view.state.doc.nodeAt(pos);
  return node && node.type.name === "pageBreak" ? node : null;
}

function handle(view: EditorView, pos: number): HTMLElement {
  const el = document.createElement("span");
  el.className = "pl-pagebreak-handle";
  el.contentEditable = "false";

  const label = document.createElement("span");
  label.className = "pl-pagebreak-handle__label";
  label.textContent = "Page break";
  label.title = "A forced page break — click to select it, ✕ to remove it";
  // Select the node: the click makes it visibly the thing Backspace will take.
  label.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!breakAt(view, pos)) return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    view.focus();
  });

  const remove = document.createElement("button");
  remove.className = "pl-pagebreak-handle__remove";
  remove.type = "button";
  remove.textContent = "✕";
  remove.title = "Remove this page break";
  remove.setAttribute("aria-label", "Remove this page break");
  remove.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const node = breakAt(view, pos);
    if (!node) return;
    view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
    view.focus();
  });

  el.append(label, remove);
  return el;
}

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== "pageBreak") return;
    decos.push(
      Decoration.widget(offset, (view) => handle(view, offset), { side: -1, key: `pb-${offset}` }),
    );
  });
  return decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

export const PageBreakHandle = Extension.create({
  name: "pageBreakHandle",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: KEY,
        state: {
          init: (_config, state) => build(state.doc),
          apply: (tr: Transaction, prev: DecorationSet) => (tr.docChanged ? build(tr.doc) : prev),
        },
        props: {
          decorations(state) {
            return KEY.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
