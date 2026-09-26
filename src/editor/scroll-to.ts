// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bring a document position into view.
 *
 * ProseMirror's own `tr.scrollIntoView()` does nothing in this layout — measured:
 * the scroller stays at 0 while the target sits 3,900px down, and it behaves the
 * same whatever `.play-page`'s overflow is set to. That silently broke the
 * board/outline → scene jump (`openScene` looked like it did nothing but switch
 * surfaces), and it would have broken find's next/previous the same way. Rather
 * than keep guessing at prosemirror-view's internals, the scroll is explicit:
 * ask the view where the position is, find the element that actually scrolls, and
 * move it.
 *
 * Works in page view, where the pagination chrome (page breaks, headers, the
 * re-printed CONT'D cue) changes the geometry — `coordsAtPos` measures the
 * rendered document, so the widgets are already accounted for.
 */
import type { EditorView } from "@tiptap/pm/view";

/** The nearest ancestor that genuinely scrolls (the editor frame, in practice). */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p: HTMLElement | null = el.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight) {
      return p;
    }
  }
  return null;
}

/** Keep this much clear above/below the target so it never hugs an edge. */
const MARGIN_PX = 96;

export interface ScrollToOptions {
  /** Centre the position instead of just bringing it inside the margin. */
  center?: boolean;
  /**
   * Leave a position inside the margin where it is, and centre one outside it.
   * Brought only to the margin, a line lands under the toolbar with the lines
   * before it hidden.
   */
  centerIfHidden?: boolean;
}

export function scrollPosIntoView(
  view: EditorView,
  pos: number,
  opts: ScrollToOptions = {},
): void {
  const scroller = scrollParent(view.dom);
  if (!scroller) return;
  let coords: { top: number; bottom: number };
  try {
    coords = view.coordsAtPos(pos);
  } catch {
    return; // a position that no longer resolves: nothing to scroll to
  }
  const box = scroller.getBoundingClientRect();
  const alreadyVisible =
    coords.top >= box.top + MARGIN_PX && coords.bottom <= box.bottom - MARGIN_PX;
  if (alreadyVisible && !opts.center) return;
  const offsetInScroller = coords.top - box.top + scroller.scrollTop;
  const lead = opts.center || opts.centerIfHidden ? box.height / 2 : MARGIN_PX;
  scroller.scrollTop = Math.max(0, offsetInScroller - lead);
}
