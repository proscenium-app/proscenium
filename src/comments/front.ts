// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Words typed in front of a stretch are not the stretch
 * (docs/app/writing/comments.md#COMM-62), however they reached the editor.
 *
 * ProseMirror's own typing takes a word's marks from the text before the
 * caret, so a word typed where a stretch begins stays out of it. On an iPad
 * the word typed after a tap at a stretch's first word went into the
 * stretch's own element in the page, and the editor read it back as part of
 * the stretch. So a pure insertion made exactly where a stretch began, that
 * came out carrying that stretch, is let out of it again. Words typed over
 * the stretch's own words, inside it or at its end, and the history's undo
 * and redo, are left as they are.
 */
import type { Mark, MarkType, Node as PMNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";
import { COMMENT_RANGE } from "./ranges";

/** The history's own undo and redo, which put back what was there. */
const fromHistory = (tr: Transaction) => !!tr.getMeta("history$");

/** The stretches that begin exactly at `pos` in `doc`. */
function stretchesFrom(doc: PMNode, pos: number, type: MarkType): readonly Mark[] {
  const $pos = doc.resolve(pos);
  const after = $pos.nodeAfter;
  if (!after) return [];
  const before = $pos.nodeBefore;
  return after.marks.filter((m) => m.type === type && !(before && m.isInSet(before.marks)));
}

/**
 * Lets out of a stretch the words inserted exactly at its start by
 * `transactions`, onto `into`, a transaction on `state` (the state they made).
 * Says whether it took any.
 */
export function keepFrontOutside(
  transactions: readonly Transaction[],
  state: EditorState,
  into: Transaction,
): boolean {
  const type = state.schema.marks[COMMENT_RANGE];
  if (!type) return false;
  let took = false;
  transactions.forEach((tr, t) => {
    if (fromHistory(tr)) return;
    tr.mapping.maps.forEach((map, i) => {
      const before = tr.docs[i];
      if (!before) return;
      // From just after this step to the state: the rest of its own
      // transaction, then each transaction after it.
      const rest = new Mapping();
      for (const later of tr.mapping.maps.slice(i + 1)) rest.appendMap(later);
      for (const later of transactions.slice(t + 1)) rest.appendMapping(later.mapping);
      map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        if (oldStart !== oldEnd || newEnd <= newStart) return;
        for (const stretch of stretchesFrom(before, oldStart, type)) {
          const from = rest.map(newStart, 1);
          const to = rest.map(newEnd, -1);
          if (to > from && into.doc.rangeHasMark(from, to, stretch)) {
            into.removeMark(from, to, stretch);
            took = true;
          }
        }
      });
    });
  });
  return took;
}

/**
 * A caret where a stretch begins stands in the words before it, in the page
 * as in the play. On an iPad a tap at a stretch's first word put the caret
 * inside the stretch's own element, WebKit typed into the stretch there, and
 * the editor read the word back as the stretch's, to let it out again. The
 * page's caret is moved to the same place on the other side of the element's
 * edge, so the word is typed in front of the stretch to begin with; the
 * play's caret is where it was. For a plugin view's `update`.
 */
export function caretBeforeStretch(view: EditorView): void {
  const { selection } = view.state;
  if (!selection.empty || !view.hasFocus()) return;
  const type = view.state.schema.marks[COMMENT_RANGE];
  if (!type || !stretchesFrom(view.state.doc, selection.head, type).length) return;
  if (!selection.$head.nodeBefore?.isText) return;
  const page = view.dom.ownerDocument.getSelection();
  const at = page?.anchorNode;
  if (!page || !page.isCollapsed || !at) return;
  const inStretch = (at.nodeType === 3 ? at.parentElement : (at as Element))?.closest?.(
    "[data-comment-range]",
  );
  if (!inStretch || !view.dom.contains(inStretch)) return;
  // The words before it: the text just ahead of the caret in the page, outside
  // the stretch's element, whose end is the same place in the play.
  const walk = view.dom.ownerDocument.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT);
  walk.currentNode = at;
  const before = walk.previousNode() as Text | null;
  if (!before || inStretch.contains(before)) return;
  try {
    if (view.posAtDOM(before, before.length) !== selection.head) return;
  } catch {
    return;
  }
  page.collapse(before, before.length);
}
