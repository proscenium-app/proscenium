// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A click is never undone by an update that happens to arrive with it
 * (docs/app/writing/editor-ux.md#EDIT-211).
 *
 * A click moves the browser's selection at once, and the editor hears of it a
 * moment later, from `selectionchange`. ProseMirror writes its own selection
 * back into the page whenever an update changes the document or its
 * decorations, and plenty of updates arrive on their own: the page's sheets
 * drawn again 120 ms after an edit, a spelling pass, a comment or a change
 * mark drawn again. One that landed before the editor had heard of a click
 * put the old selection back over it, so the caret stayed where it was: a
 * click on a speech left it in the parenthetical above, and a drag's
 * highlight was taken back the moment the button was let go. On a busy page
 * `selectionchange` comes late, and the race was there to lose.
 *
 * So every update that does not choose a selection of its own takes the one
 * the browser is holding, when the browser holds one the editor has not read
 * yet and a pointer put it there (`byPointer`): an editor given focus by the
 * app's own call holds the browser's caret at its very start for a moment,
 * which ProseMirror answers with its own selection, and carried, it put the
 * caret at the top of the play. A press on a block the editor draws between
 * its lines is such a focus, not a pointer's (`pointerSelects`). The decision is `carryPending`, pure; reading the page is
 * `pendingSelection`, which asks ProseMirror's own record of the selection it
 * last read, so a selection only drawn differently (the same place, another
 * node) is never mistaken for a new one.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { pressHoldsNoLine } from "./caret-on-focus";

/** A selection the browser holds, as positions in the document it was read against. */
export interface Pending {
  anchor: number;
  head: number;
}

/**
 * `tr` carrying the pending selection: unchanged when there is none, when the
 * transaction sets a selection itself (a command's choice wins), or when the
 * positions do not resolve to text after the change.
 */
export function carryPending(tr: Transaction, pending: Pending | null): Transaction {
  if (!pending || tr.selectionSet) return tr;
  const size = tr.before.content.size;
  if (pending.anchor < 0 || pending.head < 0 || pending.anchor > size || pending.head > size)
    return tr;
  const $anchor = tr.doc.resolve(tr.mapping.map(pending.anchor));
  const $head = tr.doc.resolve(tr.mapping.map(pending.head));
  if (!$anchor.parent.inlineContent || !$head.parent.inlineContent) return tr;
  const sel = TextSelection.between($anchor, $head);
  if (sel.anchor === tr.selection.anchor && sel.head === tr.selection.head) return tr;
  return tr.setSelection(sel);
}

/**
 * The parts of a ProseMirror view that say what the browser holds and what
 * ProseMirror last read. Not in its published types; present on every view.
 */
interface ViewInternals {
  composing: boolean;
  domSelectionRange(): {
    anchorNode: Node | null;
    anchorOffset: number;
    focusNode: Node | null;
    focusOffset: number;
  };
  domObserver?: { currentSelection?: { eq(sel: unknown): boolean } };
  docView?: {
    nearestDesc(node: Node): { ignoreMutation(m: { type: string; target: Node }): boolean } | null;
  };
}

/**
 * Whether ProseMirror leaves a page selection alone (one in a sheet before the
 * script, a widget's own field): its own rule, asked of the view description
 * holding the selection, without the note its observer makes when it asks.
 */
function ignored(v: ViewInternals, dom: ReturnType<ViewInternals["domSelectionRange"]>): boolean {
  if (!dom.focusNode || !dom.anchorNode || typeof v.docView?.nearestDesc !== "function")
    return true;
  const around = new Set<Node>();
  for (let n: Node | null = dom.focusNode; n; n = n.parentNode) around.add(n);
  let container: Node | null = dom.anchorNode;
  while (container && !around.has(container)) container = container.parentNode;
  if (!container) return true;
  const desc = v.docView.nearestDesc(container);
  const target = container.nodeType === 3 ? container.parentNode : container;
  return !!(desc && target && desc.ignoreMutation({ type: "selection", target }));
}

/**
 * The selection the browser holds in the editor that ProseMirror has not read
 * yet, or null. Not during a composition, where the input method owns it.
 */
export function pendingSelection(view: EditorView): Pending | null {
  const v = view as unknown as ViewInternals;
  if (v.composing || !view.hasFocus()) return null;
  const last = v.domObserver?.currentSelection;
  if (typeof last?.eq !== "function") return null;
  const dom = v.domSelectionRange();
  if (!dom.anchorNode || !dom.focusNode || last.eq(dom)) return null;
  if (!view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return null;
  // A selection ProseMirror would not read (in a sheet before the script, a
  // widget's own field) is not one to carry: it stays the page's alone.
  if (ignored(v, dom)) return null;
  try {
    const anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
    const head = view.posAtDOM(dom.focusNode, dom.focusOffset);
    return anchor < 0 || head < 0 ? null : { anchor, head };
  } catch {
    // A node ProseMirror draws no position for (a widget's own DOM).
    return null;
  }
}

/**
 * How long after a pointer pressed or let go in the editor a selection the
 * browser holds is the pointer's. A page held up by work can be late with
 * `selectionchange` by this much and more.
 */
export const POINTER_SELECTION_MS = 1000;

/**
 * Whether a selection the browser holds now is a pointer's to carry. Only a
 * press or a lift just before: a focus by key or by the app's own call can
 * leave the browser's caret at the very start of the editor, which
 * ProseMirror answers with its own selection and which must never be carried
 * over it.
 */
export function byPointer(pointerAt: number, now: number): boolean {
  return now - pointerAt >= 0 && now - pointerAt <= POINTER_SELECTION_MS;
}

/**
 * Whether a press or a lift could put the browser's selection in the editor.
 * Not the primary button on a block the editor draws between its lines (a page
 * before the script, a band between pages): that press is not the browser's,
 * and the editor takes the keyboard by its own call (caret-on-focus.ts). The
 * browser's caret then stands at the very start of the editor for a moment,
 * and in Chromium the editor's focus update came inside the press's second:
 * carried, it sent the caret from where the writer left it to the top of the
 * script, and the words typed landed there.
 */
export function pointerSelects(event: { button: number; target: unknown }, root: unknown): boolean {
  return !(event.button === 0 && pressHoldsNoLine(event.target, root));
}

const KEY = new PluginKey("pendingSelection");

export const PendingSelection = Extension.create({
  name: "pendingSelection",
  addProseMirrorPlugins() {
    /** When a pointer last pressed or let go in this editor. */
    let pointerAt = Number.NEGATIVE_INFINITY;
    const pointer = (view: EditorView, event: MouseEvent) => {
      // A press with no line under it ends any pointer's claim before it.
      pointerAt = pointerSelects(event, view.dom) ? Date.now() : Number.NEGATIVE_INFINITY;
      return false;
    };
    return [
      new Plugin({
        key: KEY,
        props: {
          handleDOMEvents: {
            mousedown: pointer,
            pointerdown: pointer,
            mouseup: pointer,
            pointerup: pointer,
          },
        },
        view(view) {
          // Not Object.hasOwn: the oldest macOS the app runs on predates it.
          const own = Object.prototype.hasOwnProperty.call(view, "dispatch");
          const dispatch = view.dispatch;
          view.dispatch = (tr: Transaction) => {
            const carry = !tr.selectionSet && byPointer(pointerAt, Date.now());
            dispatch.call(view, carry ? carryPending(tr, pendingSelection(view)) : tr);
          };
          return {
            destroy() {
              if (own) view.dispatch = dispatch;
              else delete (view as { dispatch?: unknown }).dispatch;
            },
          };
        },
      }),
    ];
  },
});
