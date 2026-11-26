// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An editor that has the keyboard has a caret in the page
 * (docs/app/writing/editor-ux.md#EDIT-212).
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
 *
 * **A press on a page that holds no line keeps the caret where it stands.**
 * A page before the script, a band between pages: a block the editor draws
 * between its lines, with no text a caret could stand in. A press there gave
 * the browser the caret to place, and on Windows it put it at the very top of
 * the script, which the press's focus then kept: a click on the Characters
 * page sent the caret from where the writer left it to the act's heading,
 * and the inspector said "No scene here". So such a press is not the
 * browser's: the editor takes the keyboard by its own call, which writes its
 * own caret into the page, where the writer left it.
 *
 * **And that focus leaves the page where it stands.** WebKit scrolls a
 * selection written into the page into view, so the editor's own focus took
 * the writer to wherever the caret was: the first press of a double-click on
 * the Characters page scrolled the script to the scene the caret stood in,
 * and the second press landed on that scene, so the page never opened. An
 * editor that already has the keyboard is not focused again, since the press
 * is the browser's no more and moves nothing; one that has not is focused
 * with every scroller around it put back as it stood.
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

/** As much of a page's node as a press's place reads. */
export interface PressedNode {
  readonly nodeType: number;
  readonly parentNode: unknown;
  getAttribute?(name: string): string | null;
  matches?(selector: string): boolean;
}

/** What inside a drawn block takes a press of its own. */
const OWN_PRESS = "input, textarea, select, button, a[href], [tabindex]";

/**
 * Whether a press on `target` lands on a block the editor draws between its
 * lines (`contenteditable="false"`, a child of the editor's element `root`),
 * not on a control or a field of its own inside it: a place with no line for
 * the browser to put a caret on.
 */
export function pressHoldsNoLine(target: unknown, root: unknown): boolean {
  let at = target as PressedNode | null | undefined;
  if (at?.nodeType !== 1) return false;
  for (; at && at.parentNode !== root; at = at.parentNode as PressedNode | null) {
    if (at.nodeType !== 1 || typeof at.matches !== "function") return false;
    if (at.matches(OWN_PRESS) || at.getAttribute?.("contenteditable") === "true") return false;
  }
  return !!at && at.getAttribute?.("contenteditable") === "false" && !at.matches?.(OWN_PRESS);
}

/** As much of an element around the editor as its place in the page reads. */
export interface Scroller {
  readonly nodeType: number;
  readonly parentNode: unknown;
  scrollTop: number;
  scrollLeft: number;
}

/** As much of a view as a focus in place reads. */
export interface InPlaceView {
  readonly dom: unknown;
  hasFocus(): boolean;
  focus(): void;
}

/**
 * The editor given the keyboard by its own call, the page left where it
 * stands: nothing done for an editor that has it, and every element around
 * the editor scrolled back to where it was before the focus. True if it was
 * focused.
 */
export function focusInPlace(view: InPlaceView): boolean {
  if (view.hasFocus()) return false;
  const places: { at: Scroller; top: number; left: number }[] = [];
  for (let at = view.dom as Scroller | null; at?.nodeType === 1; at = at.parentNode as Scroller) {
    places.push({ at, top: at.scrollTop, left: at.scrollLeft });
  }
  view.focus();
  for (const { at, top, left } of places) {
    if (at.scrollTop !== top) at.scrollTop = top;
    if (at.scrollLeft !== left) at.scrollLeft = left;
  }
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
            mousedown: (view, event) => {
              if (event.button !== 0 || !pressHoldsNoLine(event.target, view.dom))
                return press(view);
              // The browser neither focuses nor places a caret; the editor
              // focuses by its own call, its caret written where it stands,
              // and the page left where it stands.
              event.preventDefault();
              pressed.delete(view);
              focusInPlace(view);
              return false;
            },
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
