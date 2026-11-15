// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An editor that has the keyboard has a caret in the page
 * (docs/app/writing/editor-ux.md#EDIT-200).
 *
 * A page before the script (its characters, its opening notes) takes a tap or
 * a click, a second one opening it, and holds no text a caret could stand in.
 * Touched first in a play whose editor had not yet held a caret, it gave the
 * editor focus and the page no selection. ProseMirror puts its own caret back
 * when the editor takes focus only if the page's selection has changed since
 * it last read one, and from none to none it had not. An iPad's keyboard then
 * sent each key and typed nothing: a Return came back by ProseMirror's own
 * fallback 200 ms on, and every word before it was lost.
 *
 * So the editor puts its caret back itself: a moment after it takes focus, as
 * ProseMirror's own check waits, so a tap's own caret lands first; and at a
 * key, before the key is read. Where the page already holds a selection in the
 * editor, nothing is done.
 *
 * **And the press that gives it focus is never undone**
 * (docs/app/writing/editor-ux.md#EDIT-211). ProseMirror looks at the page
 * 20 ms after the editor takes focus and, if the page holds a selection it
 * has not read yet, writes its own over it. That look is for a browser that
 * moves the caret when the editor is reached by a key; but it hears of a
 * click's caret by `selectionchange`, and a busy page (the work a focus
 * starts, a long play) could deliver that later than the look: the click was
 * undone and the caret went back to where it stood before the editor lost
 * focus. A writer clicked the first line of a speech and the caret went to
 * the parenthetical above, where it had been; a drag highlighted from there.
 * A second click inside the 20 ms was undone the same way. Reading the page
 * just before the look was not enough: two timers due together are two
 * tasks, and a click can land between them.
 *
 * So a focus that comes with a press on the editor (a mouse, a finger, a pen)
 * is taken here: the editor is marked focused as ProseMirror marks it, and
 * ProseMirror's look is never set, so the press's caret is read when the
 * page reports it, however late. A focus by key, or by the app's own call, is
 * left to ProseMirror as it was.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** ProseMirror's own wait between focus and its look at the page's selection. */
export const AFTER_FOCUS_MS = 20;

/** As much of a ProseMirror view as the caret's return reads. */
export interface FocusedView {
  readonly isDestroyed: boolean;
  readonly editable: boolean;
  /** The editor's element, and through it the page's selection. */
  readonly dom: {
    contains(node: unknown): boolean;
    readonly ownerDocument: { getSelection(): { anchorNode: AnyNode | null } | null };
  };
  hasFocus(): boolean;
  focus(): void;
}

/**
 * How long after a press a focus is the press's. The focus comes in the
 * press's own default action with a mouse; with a finger, at the lift.
 */
export const PRESS_FOCUS_MS = 1000;

/**
 * The parts of a ProseMirror view its own focus handler writes. Not in
 * ProseMirror's published types; present on every view it draws.
 */
export interface PressFocusView {
  readonly dom: { readonly classList: { add(name: string): void } };
  focused?: boolean;
  readonly input?: { lastFocus: number };
  readonly domObserver?: { stop(): void; start(): void };
}

interface AnyNode {
  nodeType: number;
  parentNode: unknown;
}

const TEXT_NODE = 3;

/** Whether the page's selection stands in the editor. */
export function caretInEditor(view: FocusedView): boolean {
  const at = view.dom.ownerDocument.getSelection()?.anchorNode;
  if (!at) return false;
  return view.dom.contains(at.nodeType === TEXT_NODE ? at.parentNode : at);
}

/**
 * The editor's own caret, written into the page, when the editor has the
 * keyboard and the page holds no selection in it. True if it was.
 */
export function returnCaret(view: FocusedView): boolean {
  if (view.isDestroyed || !view.editable || !view.hasFocus() || caretInEditor(view)) return false;
  // ProseMirror's focus writes its selection into the page; the editor
  // already has the keyboard, so nothing else moves.
  view.focus();
  return true;
}

/**
 * A focus that came with a press, taken as ProseMirror's own focus handler
 * takes one, without its look at the page 20 ms on. True if it was taken, and
 * ProseMirror's handler is to be skipped; false leaves the focus to it: no
 * press just before, an editor already marked focused, or a view without the
 * parts ProseMirror's handler writes.
 */
export function takeFocusFromPress(view: PressFocusView, pressedAt: number, now: number): boolean {
  if (!(now - pressedAt >= 0 && now - pressedAt <= PRESS_FOCUS_MS)) return false;
  const { input, domObserver } = view;
  if (view.focused !== false || !input || typeof domObserver?.stop !== "function") return false;
  input.lastFocus = now;
  domObserver.stop();
  view.dom.classList.add("ProseMirror-focused");
  domObserver.start();
  view.focused = true;
  return true;
}

export const caretOnFocusKey = new PluginKey("caretOnFocus");

export const CaretOnFocus = Extension.create({
  name: "caretOnFocus",
  addProseMirrorPlugins() {
    /** When each editor was last pressed. */
    const pressed = new WeakMap<object, number>();
    const press = (view: object) => {
      pressed.set(view, Date.now());
      return false;
    };
    return [
      new Plugin({
        key: caretOnFocusKey,
        props: {
          handleDOMEvents: {
            mousedown: press,
            pointerdown: press,
            focus: (view) => {
              setTimeout(() => returnCaret(view), AFTER_FOCUS_MS);
              return takeFocusFromPress(
                view as unknown as PressFocusView,
                pressed.get(view) ?? Number.NEGATIVE_INFINITY,
                Date.now(),
              );
            },
            keydown: (view) => {
              returnCaret(view);
              return false;
            },
          },
        },
      }),
    ];
  },
});
