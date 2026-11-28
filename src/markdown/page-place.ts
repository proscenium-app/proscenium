// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a writer put a block of a page, in the page's own editor
 * (docs/app/formatting/formats-and-layout.md#FMT-182).
 *
 * A paragraph or a heading of a page file can say the blank rows above it, the
 * cell its lines start at, and that it stands beside the block before it
 * (`Place`, page-fields.ts; doc.ts reads and writes them as the attributes
 * here). A sheet's stylesheet sets the first two from the element itself. The
 * third cannot be styled from the element: a block beside another starts as
 * many rows up as that other is tall, which only the page knows once it is
 * drawn. So this file measures: after every change it reads where the blocks
 * stand and gives each block beside another the margin that puts it on its
 * row, and the rule under a page's head the margin that starts the page's own
 * first line where the layout puts it.
 *
 * The measuring agrees with the paginator on a page whose lines do not wrap,
 * as the rest of the sheet does (docs/app/formatting/formats-and-layout.md#FMT-177):
 * a block whose words would meet the words beside it is set under them, as it
 * prints.
 */
import { Extension, Node } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/** The node a page's head ends at, as doc.ts reads and writes it. */
export const HEAD_NODE = "head";

/** What the head's rule says, and what it is called to a screen reader. */
export const HEAD_LABEL = "Top of the page";

/** The class of the sheet a page is set on as it prints: only there is anything measured. */
const SHEET = ".frontpage-editor--sheet";

/**
 * Where a page's head ends: a hairline across the page with its name on it,
 * neither of them words of the page. What stands above it is set from the top
 * of the sheet. One object, selected and deleted whole; a screen reader hears
 * a separator called "Top of the page".
 */
export const PageHead = Node.create({
  name: HEAD_NODE,
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-page-head]" }];
  },

  renderHTML() {
    return [
      "div",
      { "data-page-head": "", class: "pagehead", role: "separator", "aria-label": HEAD_LABEL },
      ["span", { class: "pagefoot__caption", "aria-hidden": "true" }, HEAD_LABEL],
    ];
  },
});

const count = (value: string | null): number | null => {
  const n = value === null ? Number.NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** The margins measuring gave each block, by where the block starts. */
type Margins = Map<number, string>;

/**
 * What measuring last gave the page: the margins as decorations, and what
 * they were, said in one line. The line is forgotten at any change to the
 * page's words, since a change can drop a decoration with the block it was
 * on: the next reading then gives every margin again, the same or not.
 */
interface Measured {
  set: DecorationSet;
  said: string | null;
}

const measured = new PluginKey<Measured>("pagePlace");

const px = (value: string) => Number.parseFloat(value) || 0;
const half = (value: number) => Math.round(value * 2) / 2;

/** Each line of an element's words, as the boxes they are drawn in. */
function wordBoxes(el: Element): DOMRect[] {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()].filter((box) => box.width > 0.5 && box.height > 0.5);
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const meet = (a: Box, b: Box) =>
  a.left < b.right + 2 && b.left < a.right + 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2;

/**
 * The margins the page's blocks need, read from where they stand now. Each is
 * worked out from the block's place without the margin it has, so a second
 * reading of a page already set gives the same answer.
 */
function margins(view: EditorView): Margins {
  const out: Margins = new Map();
  const root = view.dom as HTMLElement;
  if (!root.closest(SHEET)) return out;
  // Most pages have nothing to measure: no head, and no block beside another.
  let any = false;
  view.state.doc.forEach((node) => {
    if (node.type.name === HEAD_NODE || node.attrs.placeBeside === true) any = true;
  });
  if (!any) return out;
  const style = getComputedStyle(root);
  const line = px(style.lineHeight);
  if (!line) return out;
  const top = root.getBoundingClientRect().top;
  /** The block before, where a block beside it starts from, and what the two of them take. */
  let before: { top: number } | null = null;
  let taken: Box[] = [];
  let under = 0;
  view.state.doc.forEach((node, pos) => {
    const el = view.nodeDOM(pos);
    if (!(el instanceof HTMLElement)) return;
    const box = el.getBoundingClientRect();
    if (node.type.name === HEAD_NODE) {
      // The page's own first line starts where the layout puts it, or under
      // a head that reaches further.
      const rows = px(style.getPropertyValue("--page-top-rows"));
      const natural = box.top - top - px(el.style.marginTop);
      const gap = half(Math.max(0, rows * line - natural));
      if (gap) out.set(pos, `margin-top:${gap}px`);
      before = null;
      return;
    }
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      before = null;
      taken = [];
      return;
    }
    const rows = typeof node.attrs.placeRows === "number" ? node.attrs.placeRows : 0;
    if (node.attrs.placeBeside === true && before) {
      const shift = before.top + rows * line - box.top;
      const boxes: Box[] = wordBoxes(el).map((b) => ({
        left: b.left,
        right: b.right,
        top: b.top + shift,
        bottom: b.bottom + shift,
      }));
      if (!boxes.some((b) => taken.some((other) => meet(b, other)))) {
        const bottom = box.bottom + shift;
        const up = half(px(el.style.marginTop) + shift);
        const down = half(Math.max(0, under - bottom));
        out.set(pos, `margin-top:${up}px;margin-bottom:${down}px`);
        taken.push(...boxes);
        under = Math.max(under, bottom);
        before = { top: before.top + rows * line };
        return;
      }
    }
    before = { top: box.top };
    taken = wordBoxes(el);
    under = box.bottom;
  });
  return out;
}

const signature = (found: Margins) => [...found].map(([pos, css]) => `${pos}:${css}`).join("|");

function decorations(doc: PmNode, found: Margins): DecorationSet {
  const set: Decoration[] = [];
  doc.forEach((node, pos) => {
    const css = found.get(pos);
    if (css) set.push(Decoration.node(pos, pos + node.nodeSize, { style: css }));
  });
  return DecorationSet.create(doc, set);
}

/**
 * A page's places: the attributes a paragraph or a heading keeps them in, and
 * the measuring that sets a block beside another and a page's own first line
 * under its head.
 */
export const PagePlace = Extension.create({
  name: "pagePlace",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          placeRows: {
            default: null,
            // A line made by Return under a placed one stands where any line does.
            keepOnSplit: false,
            parseHTML: (el) => count(el.getAttribute("data-place-rows")),
            renderHTML: (attrs) =>
              typeof attrs.placeRows === "number"
                ? { "data-place-rows": attrs.placeRows, style: `--place-rows: ${attrs.placeRows}` }
                : {},
          },
          placeCell: {
            default: null,
            // Return under a line at a cell starts the next at that cell.
            keepOnSplit: true,
            parseHTML: (el) => count(el.getAttribute("data-place-cell")),
            renderHTML: (attrs) =>
              typeof attrs.placeCell === "number"
                ? { "data-place-cell": attrs.placeCell, style: `--place-cell: ${attrs.placeCell}` }
                : {},
          },
          placeBeside: {
            default: false,
            keepOnSplit: false,
            parseHTML: (el) => el.hasAttribute("data-place-beside"),
            renderHTML: (attrs) => (attrs.placeBeside === true ? { "data-place-beside": "" } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<Measured>({
        key: measured,
        state: {
          init: () => ({ set: DecorationSet.empty, said: "" }),
          apply(tr, was) {
            const found = tr.getMeta(measured) as Margins | undefined;
            if (found) return { set: decorations(tr.doc, found), said: signature(found) };
            if (!tr.docChanged) return was;
            return { set: was.set.map(tr.mapping, tr.doc), said: null };
          },
        },
        props: {
          decorations: (state) => measured.getState(state)?.set,
          // A page with a head starts from the top of its sheet.
          attributes: (state) => {
            let head = false;
            state.doc.forEach((node) => {
              if (node.type.name === HEAD_NODE) head = true;
            });
            return (head ? { class: "prose--head" } : {}) as Record<string, string>;
          },
        },
        // A line set by an alignment is no longer at a cell: the bar's Align
        // Left, Center and Align Right take a block the writer put at a cell
        // back to the sheet's own columns.
        appendTransaction(transactions, before, after) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (before.doc.childCount !== after.doc.childCount) return null;
          let tr = null;
          let pos = 0;
          for (let i = 0; i < after.doc.childCount; i++) {
            const now = after.doc.child(i);
            const was = before.doc.child(i);
            if (
              now.type === was.type &&
              typeof now.attrs.placeCell === "number" &&
              now.attrs.placeCell === was.attrs.placeCell &&
              now.attrs.textAlign !== was.attrs.textAlign &&
              now.content.eq(was.content)
            )
              tr = (tr ?? after.tr).setNodeAttribute(pos, "placeCell", null);
            pos += now.nodeSize;
          }
          return tr;
        },
        view(view) {
          let waiting = false;
          let gone = false;
          const read = () => {
            waiting = false;
            if (gone || view.isDestroyed) return;
            const found = margins(view);
            const was = measured.getState(view.state);
            // What was given still stands; or the page changed, and there is
            // nothing to give and nothing given to take back, as on most pages.
            if (was?.said === signature(found)) return;
            if (was?.said == null && !found.size && !was?.set.find().length) return;
            view.dispatch(view.state.tr.setMeta(measured, found).setMeta("addToHistory", false));
          };
          // After the change is drawn, and never from inside the drawing.
          const soon = () => {
            if (waiting) return;
            waiting = true;
            void Promise.resolve().then(read);
          };
          // A field's own words change with no change to the page, and a sheet
          // can be resized: both move what stands beside what.
          const root = view.dom;
          root.addEventListener("input", soon);
          const sized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
          sized?.observe(root);
          soon();
          return {
            update: soon,
            destroy() {
              gone = true;
              root.removeEventListener("input", soon);
              sized?.disconnect();
            },
          };
        },
      }),
    ];
  },
});
