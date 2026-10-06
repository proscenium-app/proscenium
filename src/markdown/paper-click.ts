// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A click on the paper rather than on a word: a margin, the gap between two
 * blocks, the blank sheet under the last line.
 *
 * The browser decides where such a click puts the caret, and decides badly: a
 * click in the right margin beside a line went to the start of the block, and
 * one under the last line to wherever the engine's nearest node happened to
 * be. A page answers the way paper does. Beside a line is that line, at the
 * end the click was nearer; under the last line is the end of the document;
 * above the first is the first line.
 *
 * Only a click whose target is the editor's own element comes here, so a click
 * on any word is still the browser's, and a drag that starts in a margin still
 * selects: ProseMirror calls this on a click, never on a drag.
 */
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export function paperClick(view: EditorView, _pos: number, event: MouseEvent): boolean {
  const root = view.dom;
  const first = root.firstElementChild;
  const last = root.lastElementChild;
  if (event.target !== root || !first || !last || event.button !== 0) return false;

  const { doc } = view.state;
  const bottom = last.getBoundingClientRect().bottom;
  let selection: Selection | null = null;
  if (event.clientY >= bottom) {
    selection = Selection.atEnd(doc);
  } else {
    const box = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const left = box.left + Number.parseFloat(style.paddingLeft) + 1;
    const right = box.right - Number.parseFloat(style.paddingRight) - 1;
    const top = first.getBoundingClientRect().top + 1;
    const at = view.posAtCoords({
      left: Math.min(Math.max(event.clientX, left), Math.max(left, right)),
      top: Math.min(Math.max(event.clientY, top), bottom - 1),
    });
    if (at) selection = TextSelection.near(doc.resolve(at.pos));
  }
  if (!selection) return false;
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  view.focus();
  return true;
}
