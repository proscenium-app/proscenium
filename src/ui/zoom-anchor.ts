// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A zoom keeps the writer's place (docs/app/writing/editor-ux.md#EDIT-198).
 *
 * The page's zoom scales its lengths and type (`--page-scale`), so a page at
 * 70% is a shorter page in the same pane. The pane kept its scroll offset in
 * pixels, and the same offset into a shorter script is a later part of it: a
 * step out from the start of Act One showed Act Two, and the scroll bar's
 * thumb jumped down and grew under the pointer. A step back in did not undo it.
 *
 * So the page holds one line still across a change of zoom: the caret's line
 * when the caret is on screen (the line being written stays where the eye is),
 * otherwise the line at the middle of the view. The line is found before the
 * new zoom is drawn and put back at the same height in the pane before it is
 * painted, at the same point along it, so the scroll bar moves with the page.
 *
 * Pixel arithmetic on the scroll offset is not enough: what lies between the
 * pages (the desk between two sheets) and the chrome above the first one do
 * not scale, so on a long play the error grows with every page. A line of the
 * page is a box, wherever the zoom puts it.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";

/** A line held still: where it was in the view, and how far along it. */
export interface ZoomAnchor {
  scroller: HTMLElement;
  line: Element;
  /** Fraction of the line's height the anchor stood at, 0 at its top. */
  along: number;
  /** That point's height in the scroller's view, px from its top edge. */
  viewY: number;
  /** The same across the page, for a page wider than its pane. */
  page: Element;
  across: number;
  viewX: number;
}

/** A box's vertical extent, as `getBoundingClientRect` gives it. */
export interface Span {
  top: number;
  bottom: number;
}

/**
 * The line an anchor at `y` holds: the first whose bottom reaches `y`, so a
 * point in the gap between two lines or two pages takes the line after it;
 * past the last line, the last. -1 when there are no lines.
 */
export function lineAt(lines: readonly Span[], y: number): number {
  if (lines.length === 0) return -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].bottom >= y) return i;
  return lines.length - 1;
}

/** How far along a box a point stands, 0 at its start, clamped to the box. */
export function fractionAlong(start: number, size: number, at: number): number {
  if (size <= 0) return 0;
  return Math.min(1, Math.max(0, (at - start) / size));
}

/** The nearest ancestor that scrolls vertically, or null. */
function scrollerOf(el: Element): HTMLElement | null {
  for (let e = el.parentElement; e; e = e.parentElement) {
    const { overflowY } = getComputedStyle(e);
    if (overflowY === "auto" || overflowY === "scroll") return e;
  }
  return null;
}

/**
 * The page's lines: an editor's blocks (never its widgets, the page chrome
 * between them, which is drawn again as it likes), a plain text box, or else
 * the page itself as one line.
 */
function linesOf(page: Element): Element[] {
  const blocks = page.querySelectorAll(".ProseMirror > :not(.ProseMirror-widget)");
  if (blocks.length > 0) return [...blocks];
  const box = page.querySelector("textarea");
  return [box ?? page];
}

/** The top-level line holding a node of the page, or null. */
function lineHolding(node: Node | null, lines: readonly Element[]): Element | null {
  for (
    let e = node instanceof Element ? node : (node?.parentElement ?? null);
    e;
    e = e.parentElement
  ) {
    if (
      e.parentElement?.classList.contains("ProseMirror") &&
      !e.classList.contains("ProseMirror-widget")
    ) {
      return lines.includes(e) ? e : null;
    }
  }
  return null;
}

/** Where the caret is drawn, when it is in this page and in view; else null. */
function caretIn(
  page: Element,
  view: DOMRect,
  lines: readonly Element[],
): { line: Element; y: number } | null {
  const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || !sel.focusNode || !page.contains(sel.focusNode)) return null;
  const line = lineHolding(sel.focusNode, lines);
  if (!line) return null;
  const range = document.createRange();
  range.setStart(sel.focusNode, sel.focusOffset);
  range.collapse(true);
  const rect = range.getClientRects()[0] ?? line.getBoundingClientRect();
  // A collapsed range in an empty line can come back as nothing at all.
  const y = rect.height > 0 ? rect.top + rect.height / 2 : line.getBoundingClientRect().top;
  return y >= view.top && y <= view.bottom ? { line, y } : null;
}

/** Take the anchor a zoom of `page` will hold, before the new zoom is drawn. */
export function takeZoomAnchor(page: Element): ZoomAnchor | null {
  const scroller = scrollerOf(page);
  if (!scroller || scroller.clientHeight === 0) return null;
  const outer = scroller.getBoundingClientRect();
  // The scroller's own view, inside its border and clear of a scroll bar.
  const top = outer.top + scroller.clientTop;
  const left = outer.left + scroller.clientLeft;
  const view = new DOMRect(left, top, scroller.clientWidth, scroller.clientHeight);
  const lines = linesOf(page);
  const caret = caretIn(page, view, lines);
  let line: Element;
  let y: number;
  if (caret) {
    ({ line, y } = caret);
  } else {
    y = top + scroller.clientHeight / 2;
    const index = lineAt(
      lines.map((l) => l.getBoundingClientRect()),
      y,
    );
    if (index < 0) return null;
    line = lines[index];
  }
  const box = line.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  const sheet = page.getBoundingClientRect();
  const x = left + scroller.clientWidth / 2;
  // The point held is on the line: from the gap between two pages, the top of
  // the line after it, which stays where it was rather than jumping to y.
  const along = fractionAlong(box.top, box.height, y);
  return {
    scroller,
    line,
    along,
    viewY: box.top + along * box.height - top,
    page,
    across: fractionAlong(sheet.left, sheet.width, x),
    viewX: x - left,
  };
}

/** Scroll so the anchor's line is back where it was in the view. */
export function restoreZoomAnchor(a: ZoomAnchor): void {
  if (!a.line.isConnected || !a.scroller.isConnected) return;
  const outer = a.scroller.getBoundingClientRect();
  const top = outer.top + a.scroller.clientTop;
  const left = outer.left + a.scroller.clientLeft;
  const box = a.line.getBoundingClientRect();
  a.scroller.scrollTop += box.top + a.along * box.height - (top + a.viewY);
  if (a.scroller.scrollWidth > a.scroller.clientWidth) {
    const sheet = a.page.getBoundingClientRect();
    a.scroller.scrollLeft += sheet.left + a.across * sheet.width - (left + a.viewX);
  }
}

/**
 * Hold the writer's place in `page` whenever `zoom` changes. The anchor is
 * taken while this render is still being worked out, which is the last moment
 * the page on screen is the old zoom's; it is put back before the new one is
 * painted.
 */
export function useZoomAnchor(page: RefObject<Element | null>, zoom: number): void {
  const drawn = useRef(zoom);
  const anchor = useRef<ZoomAnchor | null>(null);
  if (zoom !== drawn.current && !anchor.current && page.current) {
    anchor.current = takeZoomAnchor(page.current);
  }
  useLayoutEffect(() => {
    if (zoom === drawn.current) return;
    drawn.current = zoom;
    const held = anchor.current;
    anchor.current = null;
    if (held) restoreZoomAnchor(held);
  }, [zoom]);
}
