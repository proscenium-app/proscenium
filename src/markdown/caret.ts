// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The caret a document draws for itself.
 *
 * A page set in a proportional face at 1.65 line spacing shows what the
 * engine's own caret does, and nothing in CSS can change any of it: the system
 * WebKit paints it two pixels wide from the letter boundary rightward, so it
 * leans on the next letter; it is as tall as the font on a block's first line
 * and as tall as the whole line on every line wrapped under it, because its
 * top is taken from the bottom of the line above; and where the engine lays a
 * line out wrong (a list item's first line on a zoomed page, in the WebKit of
 * macOS 26) it is painted where the words should have been rather than where
 * they are.
 *
 * So the page hides that caret (`caret-color: transparent`) and draws one from
 * the text's own geometry, to the convention the editors that draw theirs
 * share:
 *
 *  - two pixels on screen at any zoom, centred on the boundary: one pixel in
 *    the gap either side, on no letter;
 *  - the height of the type it stands in, the same on every line;
 *  - solid the moment the writer types or moves, then a one-second cycle: half
 *    a second solid, a fade out, a fifth of a second off, a fade in. Steady
 *    where the system asks for less motion;
 *  - the colour of the text, so it holds the text's contrast in both schemes
 *    and under every accent.
 *
 * The selection is still the engine's, and so is every key: this draws, and
 * decides nothing. The one thing it has to work out is which side of a line
 * wrap to draw on. The position after the last word of a wrapped line is one
 * place in the document and two on the page, the end of that line and the
 * start of the next, and the engine keeps which it means to itself. It is the
 * end of the line after a key that goes there, after an arrow that came from
 * the line above or below, and after a click on that line; otherwise it is the
 * start of the next, which is where typing shows.
 */
import { commandKey, keyStyle } from "../ui/keys";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** The caret's width on screen, in px, at every zoom. */
export const CARET_WIDTH = 2;

/** A place the caret can stand: the boundary's x, and the top and bottom of the type there. */
export interface Stand {
  left: number;
  top: number;
  bottom: number;
}

/** What the writer last did that says which side of a wrap the caret is on. */
export type Hint =
  | { kind: "line-end" }
  | { kind: "vertical"; direction: -1 | 1; from: Stand }
  | { kind: "point"; y: number }
  | null;

/** Whether two stands are on different lines. */
export function onTwoLines(up: Stand, down: Stand): boolean {
  return down.top - up.top > (up.bottom - up.top) / 2;
}

/**
 * At a wrap, whether the caret is at the end of the upper line (`up`) rather
 * than the start of the lower (`down`). All three stands in one frame.
 */
export function endOfUpperLine(up: Stand, down: Stand, hint: Hint): boolean {
  if (!hint) return false;
  if (hint.kind === "line-end") return true;
  if (hint.kind === "point") return hint.y < down.top;
  // An arrow moves one line: the nearer of the two in its direction, and never
  // the line it left.
  const half = (hint.from.bottom - hint.from.top) / 2;
  if (hint.direction > 0) return up.top - hint.from.top > half;
  return hint.from.top - down.top <= half;
}

/** The frame the caret is placed in: its layer's corner on screen, and how many screen px one of its px is. */
export interface Frame {
  left: number;
  top: number;
  scale: number;
}

/**
 * The caret's box in its layer, from where it stands on screen. `zoom` is the
 * page's, so the bar keeps its width; `dpr` snaps it to the screen's pixels,
 * since a bar that straddles two is drawn grey and three wide.
 */
export function caretBox(stand: Stand, frame: Frame, zoom: number, dpr: number) {
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  const left = snap(stand.left - CARET_WIDTH / 2);
  const top = snap(stand.top);
  // The height is snapped as a height: snapping the two ends apart made the
  // caret a pixel shorter on some lines than on others.
  const height = Math.max(snap(stand.bottom - stand.top), 1);
  return {
    left: (left - frame.left) / frame.scale,
    top: (top - frame.top) / frame.scale,
    height: height / frame.scale,
    width: CARET_WIDTH / (zoom || 1),
  };
}

/** The side of the layer, in its own px, that says what one of them is on screen. */
const RULER = 100;

function effectiveZoom(el: Element | null): number {
  let zoom = 1;
  for (let at = el; at; at = at.parentElement) {
    zoom *= Number.parseFloat(getComputedStyle(at).zoom) || 1;
  }
  return zoom;
}

class CaretView {
  private readonly layer: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly resized: ResizeObserver | null;
  private focused: boolean;
  private hint: Hint = null;
  /** The position the caret is drawn at the end of the upper line for, or -1. */
  private upperAt = -1;
  /** Where it was last drawn, in the layer, for an arrow's "one line from here". */
  private last: Stand | null = null;
  private beat = false;

  constructor(private readonly view: EditorView) {
    const doc = view.dom.ownerDocument;
    this.layer = doc.createElement("div");
    this.layer.className = "prose-caret";
    this.layer.setAttribute("aria-hidden", "true");
    this.bar = doc.createElement("div");
    this.bar.className = "prose-caret__bar";
    this.bar.hidden = true;
    this.layer.append(this.bar);
    this.focused = view.hasFocus() && doc.hasFocus();

    const dom = view.dom;
    dom.addEventListener("keydown", this.onKey, true);
    dom.addEventListener("mousedown", this.onPoint, true);
    dom.addEventListener("focus", this.onFocus);
    dom.addEventListener("blur", this.onBlur);
    doc.defaultView?.addEventListener("resize", this.redraw);
    this.resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(this.redraw);
    this.resized?.observe(dom);
    this.draw(true);
  }

  private onKey = (event: KeyboardEvent) => {
    const { key } = event;
    // A line's end: End, and on a Mac ⌘→ and Control-E too (a PC's Ctrl+→ is a word).
    const mac = keyStyle() === "mac";
    const toEnd =
      key === "End" ||
      (mac && key === "ArrowRight" && event.metaKey) ||
      (mac && key === "e" && event.ctrlKey);
    if (toEnd) this.hint = { kind: "line-end" };
    else if ((key === "ArrowUp" || key === "ArrowDown") && !commandKey(event) && this.last)
      this.hint = { kind: "vertical", direction: key === "ArrowUp" ? -1 : 1, from: this.last };
    else this.hint = null;
  };
  private onPoint = (event: MouseEvent) => {
    const hint: Hint = { kind: "point", y: event.clientY };
    this.hint = hint;
    // A click at the other side of the wrap the caret is already at moves it
    // on the page and nowhere in the document, so no change comes to say so.
    const win = this.view.dom.ownerDocument.defaultView;
    const settle = () => {
      win?.removeEventListener("mouseup", settle, true);
      win?.setTimeout(() => {
        if (this.hint === hint) this.draw(true, true);
      }, 60);
    };
    win?.addEventListener("mouseup", settle, true);
  };
  private onFocus = () => {
    this.focused = true;
    this.draw(true);
  };
  private onBlur = () => {
    this.focused = false;
    this.draw(false);
  };
  private redraw = () => this.draw(false);

  update(view: EditorView, prev: { doc: unknown; selection: unknown }) {
    const moved = prev.doc !== view.state.doc || prev.selection !== view.state.selection;
    if (moved) {
      // A hint speaks for the move it caused, and for that place until the next.
      this.upperAt = -1;
    }
    this.draw(moved, moved);
  }

  destroy() {
    const dom = this.view.dom;
    dom.removeEventListener("keydown", this.onKey, true);
    dom.removeEventListener("mousedown", this.onPoint, true);
    dom.removeEventListener("focus", this.onFocus);
    dom.removeEventListener("blur", this.onBlur);
    dom.ownerDocument.defaultView?.removeEventListener("resize", this.redraw);
    this.resized?.disconnect();
    this.layer.remove();
  }

  /** Where the position stands on screen, both sides of it when it is at a wrap. */
  private stands(head: number): { up: Stand | null; down: Stand } | null {
    const { view } = this;
    let down: Stand | null = null;
    try {
      const at = view.domAtPos(head, 1);
      if (at.node.nodeType === 3) {
        const range = view.dom.ownerDocument.createRange();
        range.setStart(at.node, at.offset);
        range.collapse(true);
        const rects = range.getClientRects();
        const rect = rects.length ? rects[rects.length - 1] : null;
        if (rect && rect.height > 0) down = { left: rect.left, top: rect.top, bottom: rect.bottom };
      }
      down ??= view.coordsAtPos(head, 1);
      const $head = view.state.doc.resolve(head);
      // Only between two runs of text can a line wrap; after a line break the
      // line above is another line of the document, not the other side of this one.
      if (!$head.nodeBefore?.isText || !$head.nodeAfter?.isText) return { up: null, down };
      const up = view.coordsAtPos(head, -1);
      return { up: onTwoLines(up, down) ? up : null, down };
    } catch {
      return down ? { up: null, down } : null;
    }
  }

  private draw(solid: boolean, moved = false) {
    const { view, layer, bar } = this;
    const { selection } = view.state;
    const host = view.dom.parentElement;
    if (host && layer.parentElement !== host) host.append(layer);
    const shown =
      !!host &&
      this.focused &&
      view.editable &&
      selection instanceof TextSelection &&
      selection.empty;
    const at = shown ? this.stands(selection.head) : null;
    if (!at) {
      bar.hidden = true;
      if (moved) this.hint = null;
      return;
    }

    const corner = layer.getBoundingClientRect();
    const frame = { left: corner.left, top: corner.top, scale: corner.width / RULER || 1 };
    const local = (s: Stand): Stand => ({
      left: (s.left - frame.left) / frame.scale,
      top: (s.top - frame.top) / frame.scale,
      bottom: (s.bottom - frame.top) / frame.scale,
    });
    if (moved) {
      // The arrow's "from" was kept in the layer, which a scroll does not move.
      const hint = this.hint;
      const upper =
        !!at.up &&
        (hint?.kind === "vertical"
          ? endOfUpperLine(local(at.up), local(at.down), hint)
          : endOfUpperLine(at.up, at.down, hint));
      this.upperAt = upper ? selection.head : -1;
      this.hint = null;
    }
    const stand = at.up && this.upperAt === selection.head ? at.up : at.down;
    this.last = local(stand);

    const win = view.dom.ownerDocument.defaultView;
    const box = caretBox(stand, frame, effectiveZoom(host), win?.devicePixelRatio || 1);
    bar.style.left = `${box.left}px`;
    bar.style.top = `${box.top}px`;
    bar.style.width = `${box.width}px`;
    bar.style.height = `${box.height}px`;
    bar.hidden = false;
    if (solid) {
      // Two names for one animation: changing the name is what starts it again.
      this.beat = !this.beat;
      bar.dataset.beat = this.beat ? "a" : "b";
    }
  }
}

const key = new PluginKey("documentCaret");

/** The extension the prose editor loads. The class is what hides the engine's caret. */
export const DocumentCaret = Extension.create({
  name: "documentCaret",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: { attributes: { class: "prose--caret-drawn" } },
        view: (view) => new CaretView(view),
      }),
    ];
  },
});
