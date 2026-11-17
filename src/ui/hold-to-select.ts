// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Words outside the editor that has the keyboard, selectable by a finger held
 * on them.
 *
 * On an iPad WebKit lets a long press select only inside the editable element
 * that has the focus, and gives the lift a click. While the script had the
 * keyboard, which is nearly always while writing, a comment's words could not
 * be selected, and a long press in the comments feed jumped to the script, as
 * a tap on them does. Letting the editor go while the finger is down, as this
 * does a moment after it came down, is not enough on its own: iPadOS chose
 * how the press selects as the touch began. So a press held as long as the
 * system's long press that lifts with nothing selected selects the word under
 * the finger itself, and the click its lift brings does not go on to jump. A
 * quick tap is left as it was: its click, and the keyboard, stay.
 */

/** How long a finger stays down before the editor with the keyboard is let go. */
export const LET_GO_AFTER_MS = 200;
/** A finger down this long is a long press, which selects the word under it. */
export const LONG_PRESS_MS = 450;
/** A finger that moved this far is scrolling, not holding. */
const SLOP_PX = 10;
/** How long a finger may stay down before its hold is given up. */
const HELD_AT_MOST_MS = 5000;
/** How long after the lift the click it brings may come. */
const CLICK_AFTER_LIFT_MS = 400;

function editable(el: Element | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    (el.isContentEditable || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)
  );
}

/** The word in `text` at `offset`, as its start and end, or null where there is none. */
export function wordAround(text: string, offset: number): { start: number; end: number } | null {
  const words = [...text.matchAll(/[\p{L}\p{N}’']+/gu)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  return (
    words.find((w) => w.start <= offset && offset < w.end) ??
    words.find((w) => w.end === offset) ??
    words.find((w) => w.start === offset) ??
    null
  );
}

/** Where a caret would be at a point in the page. */
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const page = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  const range = page.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
  const at = page.caretPositionFromPoint?.(x, y);
  return at ? { node: at.offsetNode, offset: at.offset } : null;
}

/** The click a lift brings, kept from going on, once. */
function keepNextClick(): void {
  const keep = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const done = () => {
    clearTimeout(lapse);
    window.removeEventListener("click", keep, true);
  };
  const lapse = setTimeout(done, CLICK_AFTER_LIFT_MS);
  window.addEventListener("click", keep, true);
}

/** The word under a point in `words` selected, where nothing in them is; says whether. */
function selectWordAt(words: Element, x: number, y: number): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  if (!selection.isCollapsed && selection.anchorNode && words.contains(selection.anchorNode))
    return false;
  const at = caretAt(x, y);
  if (!at || at.node.nodeType !== Node.TEXT_NODE || !words.contains(at.node)) return false;
  const word = wordAround((at.node as Text).data, at.offset);
  if (!word) return false;
  selection.setBaseAndExtent(at.node, word.start, at.node, word.end);
  return true;
}

/** For `onPointerDown` on words a finger may hold to select. */
export function letEditorGoOnHold(event: {
  pointerType: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
}): void {
  if (event.pointerType !== "touch") return;
  const editor = document.activeElement;
  if (!editable(editor)) return;
  const words = event.currentTarget;
  if (!(words instanceof Element) || editor.contains(words)) return;
  const finger = event.pointerId;
  const x = event.clientX;
  const y = event.clientY;
  const down = performance.now();
  const letGo = () => {
    if (document.activeElement !== editor) return;
    // The editor's selection goes first: WebKit gives the focus back to an
    // editor whose selection is set in it, and the editor sets its own again
    // as it hears that it lost the focus.
    if (editor.isContentEditable) window.getSelection()?.removeAllRanges();
    editor.blur();
  };
  // This finger's own lift and moves alone: WebKit moves a mouse of its own
  // when the page changes under a pointer that stays still, far from the finger.
  const lifted = (e: PointerEvent) => {
    if (e.pointerId !== finger) return;
    stop();
    // The system took a finger that held still: its own long press is on the
    // way, and the words under it are the ones to select.
    if (e.type === "pointercancel") {
      letGo();
      return;
    }
    // A long press that selected nothing: the word under it, and not the jump.
    if (performance.now() - down >= LONG_PRESS_MS && selectWordAt(words, x, y)) keepNextClick();
  };
  const moved = (e: PointerEvent) => {
    if (e.pointerId === finger && Math.hypot(e.clientX - x, e.clientY - y) > SLOP_PX) stop();
  };
  const stop = () => {
    clearTimeout(timer);
    clearTimeout(lapse);
    window.removeEventListener("pointerup", lifted, true);
    window.removeEventListener("pointercancel", lifted, true);
    window.removeEventListener("pointermove", moved, true);
  };
  const timer = setTimeout(letGo, LET_GO_AFTER_MS);
  const lapse = setTimeout(() => stop(), HELD_AT_MOST_MS);
  window.addEventListener("pointerup", lifted, true);
  window.addEventListener("pointercancel", lifted, true);
  window.addEventListener("pointermove", moved, true);
}
