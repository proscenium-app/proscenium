// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A finger's press on the format bar leaves the caret where it was
 * (docs/app/organizing/workspace-model.md#WORK-51).
 *
 * On an iPad, with a document's page holding the keyboard, a finger landing
 * on the bar put the page's caret at the document's start, before the tap's
 * click came. The list's numbering, which the bar shows only while the caret
 * is in a numbered list, went away with its menu as the menu opened, and a
 * format chosen on the bar would have gone to the first line. So while a
 * finger presses the bar, a caret somewhere else that the editor would read
 * from the page is refused, and ProseMirror puts the page's caret back where
 * the editor has it. The bar's own commands move no caret without changing
 * the words, so nothing of theirs is refused.
 *
 * A press lasts from the touch to a moment after its click, or after a lift
 * that brought none. Another touch, or a key, ends it at once: the writer
 * moving the caret on purpose.
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Selection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** How long after its click a press still holds the caret. */
export const AFTER_THE_CLICK_MS = 300;
/** How long after a lift that brought no click a press still holds the caret. */
export const AFTER_A_LIFT_MS = 400;
/** The longest a press holds the caret. */
const HELD_AT_MOST_MS = 5000;

/** What a press holds: the caret, and the words it is in. */
export interface HeldCaret {
  readonly kept: Selection;
  readonly doc: PMNode;
}

interface Press extends HeldCaret {
  end(): void;
}

const presses = new WeakMap<EditorView, Press>();

/** Whether `tr` would move the caret `held` keeps, changing nothing else. */
export function movesHeldCaret(held: HeldCaret | undefined, tr: Transaction): boolean {
  if (!held || tr.docChanged || !tr.selectionSet) return false;
  // The words changed since the press began: the caret it keeps is not theirs.
  if (tr.before !== held.doc) return false;
  return !tr.selection.eq(held.kept);
}

/** The editor's side: a caret moved during a press on the bar is refused. */
export const BarPress = Extension.create({
  name: "barPress",
  addProseMirrorPlugins() {
    let view: EditorView | null = null;
    return [
      new Plugin({
        key: new PluginKey("barPress"),
        view(editorView) {
          view = editorView;
          return {
            destroy() {
              presses.get(editorView)?.end();
              view = null;
            },
          };
        },
        filterTransaction: (tr) => !movesHeldCaret(view ? presses.get(view) : undefined, tr),
      }),
    ];
  },
});

/** For the bar's `onPointerDownCapture`: a finger's press holds the editor's caret. */
export function holdCaretThroughPress(view: EditorView, event: PointerEvent): void {
  if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
  if (view.isDestroyed) return;
  presses.get(view)?.end();
  const finger = event.pointerId;
  let after = 0;
  const end = () => {
    window.clearTimeout(after);
    window.clearTimeout(lapse);
    window.removeEventListener("pointerdown", another, true);
    window.removeEventListener("pointerup", lifted, true);
    window.removeEventListener("pointercancel", lifted, true);
    window.removeEventListener("click", clicked, true);
    window.removeEventListener("keydown", end, true);
    if (presses.get(view) === press) presses.delete(view);
  };
  const press: Press = { kept: view.state.selection, doc: view.state.doc, end };
  const another = (e: PointerEvent) => {
    if (e !== event) end();
  };
  // The system may take a finger it holds for its own: its cancel is a lift.
  const lifted = (e: PointerEvent) => {
    if (e.pointerId !== finger) return;
    window.clearTimeout(after);
    after = window.setTimeout(end, AFTER_A_LIFT_MS);
  };
  const clicked = () => {
    window.clearTimeout(after);
    after = window.setTimeout(end, AFTER_THE_CLICK_MS);
  };
  const lapse = window.setTimeout(end, HELD_AT_MOST_MS);
  presses.set(view, press);
  window.addEventListener("pointerdown", another, true);
  window.addEventListener("pointerup", lifted, true);
  window.addEventListener("pointercancel", lifted, true);
  window.addEventListener("click", clicked, true);
  window.addEventListener("keydown", end, true);
}
