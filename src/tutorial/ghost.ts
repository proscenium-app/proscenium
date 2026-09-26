// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * "Type here" drawn in the script itself (docs/app/preferences-and-help/tutorials.md#TUT-8): the line the
 * guide means is lit, the suggestion shows faintly where the letters will go,
 * and the key that finishes the line sits after it as a key cap.
 *
 * All of it is decoration. Nothing enters the document, the undo history, the
 * file or the pagination's text; the widget is hidden from assistive
 * technology, because the card's own words already say it. The guide changes
 * what is drawn with a meta-only transaction (`showGhost`), which changes
 * neither the document nor the selection.
 */
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

export interface Ghost { index: number; text: string; key?: string }
/** The line the guide points at, with or without a suggestion. */
export interface Lit { line: number | null; ghost: Ghost | null }

export const ghostKey = new PluginKey<Lit>("tutorial-ghost");
const NONE: Lit = {line: null, ghost: null};

/** The position before top-level block `index`, or null past the end. */
export function blockPos(state: EditorState, index: number): number | null {
  if (index < 0 || index >= state.doc.childCount) return null;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return pos;
}

function widget(ghost: Ghost): HTMLElement {
  const span = document.createElement("span");
  span.className = "tutorial-ghost";
  span.setAttribute("aria-hidden", "true");
  span.contentEditable = "false";
  if (ghost.text) {
    const text = document.createElement("span");
    text.className = "tutorial-ghost__text";
    text.textContent = ghost.text;
    span.append(text);
  }
  if (ghost.key) {
    const key = document.createElement("kbd");
    key.className = "tutorial-ghost__key";
    key.textContent = ghost.key === "Return" ? "⏎ Return" : ghost.key;
    span.append(key);
  }
  return span;
}

export function decorationsFor(state: EditorState, lit: Lit): DecorationSet {
  const out: Decoration[] = [];
  const line = lit.line === null ? null : blockPos(state, lit.line);
  if (line !== null && lit.line !== null) {
    const node = state.doc.child(lit.line);
    out.push(Decoration.node(line, line + node.nodeSize, {class: "tutorial-line"}));
  }
  const g = lit.ghost;
  const at = g ? blockPos(state, g.index) : null;
  if (g && at !== null && (g.text || g.key)) {
    const node = state.doc.child(g.index);
    if (node.isTextblock) out.push(Decoration.widget(at + 1 + node.content.size, () => widget(g),
      {side: 1, ignoreSelection: true, key: `tutorial-ghost:${g.text}:${g.key ?? ""}`}));
  }
  return out.length ? DecorationSet.create(state.doc, out) : DecorationSet.empty;
}

export const ghostPlugin = () => new Plugin<Lit>({
  key: ghostKey,
  state: {
    init: () => NONE,
    apply: (tr, value) => (tr.getMeta(ghostKey) as Lit | undefined) ?? value,
  },
  props: {decorations: state => decorationsFor(state, ghostKey.getState(state) ?? NONE)},
});

const same = (a: Lit, b: Lit) => a.line === b.line && a.ghost?.index === b.ghost?.index
  && a.ghost?.text === b.ghost?.text && a.ghost?.key === b.ghost?.key;
/** Draw (or clear) the lit line and suggestion; a no-op when nothing changed. */
export function showGhost(view: EditorView, lit: Lit = NONE) {
  const now = ghostKey.getState(view.state);
  if (!now || same(now, lit)) return;
  view.dispatch(view.state.tr.setMeta(ghostKey, lit).setMeta("addToHistory", false));
}
