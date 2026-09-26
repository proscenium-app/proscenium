// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Live pagination for the editor (docs/app/writing/editor-ux.md#EDIT-D106,
 * open-questions Q6). The document is never mutated: the layout engine
 * (src/layout) decides where pages break, and this extension draws the
 * inter-page chrome — sheet bottom, desk band, next sheet's top margin with
 * its header, and the re-printed "CUE (CONT'D)" — as ProseMirror widget
 * decorations at the engine's break positions. The same engine output drives
 * PDF export, so what you see is what prints.
 *
 * Total/current page counts are computed even when the page view is off (the
 * galley still shows "p. N / M"). Only the drawn chrome
 * is gated by `enabled`.
 */
import { styleSegments } from "../pdf/plan";
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

import type { BlockType, FrontMatter } from "../fountain/model";
import { besidePairs, runInPairs } from "../layout/engine";
import { elementColumnIn } from "../format/spec";
import { inchesToCh, type FormatSpec } from "../format";
import {
  buildLayoutBlock,
  paginate,
  paginateFrontMatter,
  type FrontMatterPage,
  type FrontMatterLine,
  type LayoutBlock,
  type LayoutMeta,
  type LayoutResult,
  type RawPiece,
} from "../layout";

export interface PaginationConfig {
  enabled: boolean;
  spec: FormatSpec | null;
  meta: LayoutMeta;
  /** Canonical front matter; the shared engine supplies every sheet. */
  frontMatter?: FrontMatter | null;
  /** Clicking the title sheet opens the Title Page editor. */
  onTitlePageClick?: (() => void) | null;
}

export interface PaginationStorage {
  /** Total pages of the current layout (1-based; 0 before first layout). */
  total: number;
  /** Page the caret is on, 1-based. */
  current: number;
}

const KEY = new PluginKey<PluginState>("pagination");
const RELAYOUT_DEBOUNCE_MS = 120;

interface PluginState {
  config: PaginationConfig;
  deco: DecorationSet;
  /** Doc position where each page starts (index 0 = page 1 = pos 0). */
  pageStarts: number[];
  stale: boolean;
}

interface ConfigMeta {
  kind: "config";
  config: PaginationConfig;
}
interface LayoutMetaMsg {
  kind: "layout";
  deco: DecorationSet;
  pageStarts: number[];
  total: number;
}

type Meta = ConfigMeta | LayoutMetaMsg;

/** Extract engine blocks from the live doc; srcStart carries PM positions. */
function blocksFromPmDoc(doc: PMNode, spec: FormatSpec): {
  blocks: LayoutBlock[];
  blockPos: number[];
} {
  const blocks: LayoutBlock[] = [];
  const blockPos: number[] = [];
  doc.forEach((node, offset, index) => {
    blockPos[index] = offset;
    // A comment-only block ([[ ]] on its own line) prints NOTHING — skipping
    // it entirely is what keeps a comment from ever moving a page break. The
    // page view hides the whole block to match (css.ts `.pl-commentonly`).
    let hasNote = false;
    let hasText = false;
    node.forEach((child) => {
      if (child.type.name === "note") hasNote = true;
      else if (child.isText && child.text) hasText = true;
    });
    if (hasNote && !hasText) return;
    const pieces: RawPiece[] = [];
    node.forEach((child, childOffset) => {
      if (child.isText && child.text) {
        const marks = child.marks;
        pieces.push({
          text: child.text,
          bold: marks.some((m) => m.type.name === "strong"),
          italic: marks.some((m) => m.type.name === "em"),
          underline: marks.some((m) => m.type.name === "underline"),
          srcStart: offset + 1 + childOffset,
        });
      }
      // note nodes are print-invisible: contribute nothing.
    });
    const built = buildLayoutBlock({
      type: node.type.name as BlockType,
      pieces,
      spec,
      sourceIndex: index,
      extension:
        node.type.name === "character" ? ((node.attrs.extension as string | null) ?? null) : null,
      dual: node.type.name === "character" && node.attrs.dual === true,
    });
    if (built) blocks.push(built);
  });
  return { blocks, blockPos };
}

function el(className: string, parent?: HTMLElement): HTMLElement {
  const div = document.createElement("div");
  div.className = className;
  parent?.appendChild(div);
  return div;
}

/** The element that ends a dual pair's float context (see dualChainDecorations). */
function dualClearWidget(): HTMLElement {
  const el = document.createElement("div");
  el.className = "pm-dual-clear";
  return el;
}

/**
 * Dual-dialogue chains as node decorations (stage-format.css floats them into
 * half-columns). Applied in the galley AND the page view — the engine treats a
 * pair as one unsplittable unit, so no page break can land inside and the CSS
 * rendering can never disagree with the engine's break positions.
 */
function dualChainDecorations(doc: PMNode): Decoration[] {
  interface Blk {
    name: string;
    dual: boolean;
    from: number;
    to: number;
  }
  const blks: Blk[] = [];
  doc.forEach((node, offset) => {
    blks.push({
      name: node.type.name,
      dual: node.attrs?.dual === true,
      from: offset,
      to: offset + node.nodeSize,
    });
  });
  const isDlg = (n: string) => n === "dialogue" || n === "parenthetical" || n === "lyric";
  const chainEnd = (from: number): number => {
    let end = from + 1;
    while (end < blks.length && isDlg(blks[end].name)) end++;
    return end;
  };
  const out: Decoration[] = [];
  let i = 0;
  while (i < blks.length) {
    const b = blks[i];
    if (b.name === "character" && !b.dual) {
      const leftEnd = chainEnd(i);
      const rightCue = blks[leftEnd];
      if (rightCue && rightCue.name === "character" && rightCue.dual) {
        const rightEnd = chainEnd(leftEnd);
        for (let k = i; k < leftEnd; k++) {
          out.push(Decoration.node(blks[k].from, blks[k].to, { class: "pm-dual pm-dual--left" }));
        }
        for (let k = leftEnd; k < rightEnd; k++) {
          out.push(Decoration.node(blks[k].from, blks[k].to, { class: "pm-dual pm-dual--right" }));
        }
        if (blks[rightEnd]) {
          // A zero-height clearing WIDGET between the pair and what follows —
          // not `clear` on the next block itself. Clearance on an element
          // swallows that element's own margin-top (the gap the format's
          // spacingBefore should have made):
          // with the LEFT column taller, the next block sat tight against it.
          // The widget takes the clearance instead, and the next block's
          // margin then applies normally below the float.
          const at = blks[rightEnd].from;
          out.push(
            Decoration.widget(at, dualClearWidget, { side: -1, key: `dual-clear-${at}` }),
          );
        }
        i = rightEnd;
        continue;
      }
    }
    i++;
  }
  return out;
}

type Slots = { left?: string; center?: string; right?: string };

/** A header or footer row: left, centre and right slots across the text block. */
function marginSlots(className: string, slots: Slots, parent: HTMLElement): HTMLElement {
  const row = el(className, parent);
  for (const slot of ["left", "center", "right"] as const) {
    const span = document.createElement("span");
    span.className = `pgchrome__slot pgchrome__slot--${slot}`;
    span.textContent = slots[slot] ?? "";
    row.appendChild(span);
  }
  return row;
}

/** The inter-page chrome drawn at a break: previous sheet's remainder and its
 * footer, the desk band, the next sheet's top margin + header, and any
 * (CONT'D) cue. */
function breakWidget(args: {
  fillRows: number;
  header: Slots | null;
  /** The footer of the page this break ENDS. */
  footer: Slots | null;
  contd: string | null;
}): HTMLElement {
  const root = el("pgchrome");
  root.contentEditable = "false";
  el("pgchrome__fill", root).style.height = `${Math.max(0, args.fillRows)}lh`;
  const bottom = el("pgchrome__botmargin", root);
  if (args.footer) marginSlots("pgchrome__footer", args.footer, bottom);
  el("pgchrome__band", root);
  const top = el("pgchrome__topmargin", root);
  if (args.header) marginSlots("pgchrome__header", args.header, top);
  if (args.contd) {
    const cue = el("pl pl-character pgchrome__contd", root);
    cue.textContent = args.contd;
  }
  return root;
}

/** Draw a shared engine page before the script, with the normal sheet band.
 * Its positioned text never wraps or makes a pagination decision in the DOM. */
function frontMatterWidget(page: FrontMatterPage, spec: FormatSpec, onClick: (() => void) | null): HTMLElement {
  const root = el(`pgchrome pgchrome--${page.kind === "title" ? "title" : "front"}`);
  root.contentEditable = "false";
  const sheet = el(page.kind === "title" ? "titlesheet" : "frontsheet", root);
  sheet.dataset.frontKind = page.kind;
  if (page.kind === "title" && onClick) {
    sheet.classList.add("titlesheet--editable");
    sheet.title = "Edit title page";
    sheet.addEventListener("mousedown", (event) => { event.preventDefault(); onClick(); });
  }
  frontMatterLines(page.lines, sheet, spec);
  el("pgchrome__botmargin", root);
  el("pgchrome__band", root);
  el("pgchrome__topmargin", root);
  return root;
}

function frontMatterLines(lines: FrontMatterLine[], sheet: HTMLElement, spec: FormatSpec): void {
  for (const line of lines) {
    const text = el("frontsheet__line", sheet);
    for (const segment of styleSegments(line.text, line.runs ?? [], {
      bold: line.fontStyle === "bold" || line.fontStyle === "bold-italic",
      italic: line.fontStyle === "italic" || line.fontStyle === "bold-italic",
    })) {
      const span = document.createElement("span"); span.textContent = segment.text;
      span.style.fontWeight = segment.bold ? "700" : "400";
      span.style.fontStyle = segment.italic ? "italic" : "normal";
      text.appendChild(span);
    }
    text.style.top = `calc(${line.row} * var(--fmt-line))`;
    text.style.left = `${inchesToCh(spec, line.xIn)}ch`;
    text.style.fontWeight = line.fontStyle === "bold" || line.fontStyle === "bold-italic" ? "700" : "400";
    text.style.fontStyle = line.fontStyle === "italic" || line.fontStyle === "bold-italic" ? "italic" : "normal";
    text.dataset.frontParagraph = line.paragraphId;
  }
}

/** Opening metadata shares numbered sheets with the script. Overflow sheets
 * use the same page furniture; the last fragment stops at the first body row. */
function introWidget(layout: LayoutResult, spec: FormatSpec, bodyPage: number): HTMLElement {
  const root = el("pgchrome pgchrome--intro");
  root.contentEditable = "false";
  for (let index = 0; index <= bodyPage; index++) {
    const page = layout.pages[index];
    const sheet = el("frontsheet", root);
    const height = index < bodyPage ? layout.maxRows : page.lines[0]?.row ?? page.usedRows;
    sheet.style.height = `calc(${height} * var(--fmt-line))`;
    frontMatterLines(page.intro ?? [], sheet, spec);
    if (index < bodyPage) root.appendChild(breakWidget({
      fillRows: 0, footer: page.footer, header: layout.pages[index + 1].header, contd: null,
    }));
  }
  return root;
}

/** A first-page header (formats that don't suppress it) drawn into the top
 * margin, and the last sheet's bottom fill with that sheet's footer. */
function edgeWidget(kind: "first-header" | "fill", args: {
  fillRows?: number;
  header?: Slots | null;
  footer?: Slots | null;
}): HTMLElement {
  const root = el("pgchrome");
  root.contentEditable = "false";
  if (kind === "first-header" && args.header) {
    marginSlots("pgchrome__header", args.header, el("pgchrome__firstheader", root));
  }
  if (kind === "fill") {
    el("pgchrome__fill", root).style.height = `${Math.max(0, args.fillRows ?? 0)}lh`;
    // The last sheet's bottom margin is the page's own padding, not chrome, so
    // its footer hangs from a zero-height anchor down into it.
    if (args.footer) marginSlots("pgchrome__footer", args.footer, el("pgchrome__lastfooter", root));
  }
  return root;
}

function computeLayout(
  doc: PMNode,
  config: PaginationConfig,
): { deco: DecorationSet; pageStarts: number[]; total: number } {
  if (!config.spec) return { deco: DecorationSet.empty, pageStarts: [0], total: 0 };
  const { blocks, blockPos } = blocksFromPmDoc(doc, config.spec);
  const layout: LayoutResult = paginate(blocks, config.spec, {
    ...config.meta,
    frontMatter: config.frontMatter === undefined ? config.meta.frontMatter : config.frontMatter,
  });
  const { pages } = layout;

  const pageStarts = pages.map((page) => {
    if (!page.breakBefore) return 0;
    return page.breakBefore.srcOffset ?? blockPos[page.breakBefore.sourceIndex] ?? 0;
  });

  // Dual pairs render side by side in BOTH views (page chrome is what
  // `enabled` gates; simultaneous speech is document semantics).
  const dualDecos = dualChainDecorations(doc);
  const runIns = runInPairs(blocks, config.spec);
  for (const source of besidePairs(blocks, config.spec)) {
    const at = blockPos[source];
    const node = doc.child(source);
    if (dualDecos.some((d) => d.from === at && d.to === at + node.nodeSize)) continue;
    dualDecos.push(Decoration.node(at, at + node.nodeSize, { class: "pm-beside" }));
    const index = blocks.findIndex((b) => b.sourceIndex === source);
    const next = blocks[index + 1], previous = blocks[index - 1];
    const firstRow = pages.flatMap((p) => p.lines).find((line) => line.sourceIndex === source)?.row;
    const gap = index === 0 || config.enabled && firstRow === 0 ? 0
      : Math.max(previous ? config.spec.elements[previous.type].spacingAfter : 0, config.spec.elements[blocks[index].type].spacingBefore);
    // Floats do not collapse margins like regular paragraphs. Give the pair
    // one measured gap, outside both blocks, so both begin on the same row.
    if (previous) {
      const priorAt = blockPos[previous.sourceIndex];
      dualDecos.push(Decoration.node(priorAt, priorAt + doc.child(previous.sourceIndex).nodeSize, { class: "pm-before-beside" }));
    }
    dualDecos.push(Decoration.widget(at, () => {
      const spacer = document.createElement("div");
      spacer.className = "pm-beside-gap";
      spacer.style.height = `calc(${gap} * var(--fmt-line))`;
      return spacer;
    }, { side: -1, key: `beside-gap-${source}-${gap}` }));
    dualDecos.push(Decoration.node(blockPos[next.sourceIndex], blockPos[next.sourceIndex] + doc.child(next.sourceIndex).nodeSize, { class: "pm-beside-body" }));
    const tail = runIns.has(next.sourceIndex) ? blocks[index + 2] : next;
    const end = blockPos[tail.sourceIndex] + doc.child(tail.sourceIndex).nodeSize;
    dualDecos.push(Decoration.widget(end, () => {
      const clear = document.createElement("div");
      clear.className = "pm-beside-clear";
      return clear;
    }, { side: -1, key: `beside-clear-${source}` }));
  }
  const beside = besidePairs(blocks, config.spec);
  for (const source of runIns) {
    const index = blocks.findIndex((b) => b.sourceIndex === source);
    const block = blocks[index], previous = blocks[index - 1], next = blocks[index + 1];
    const col = elementColumnIn(config.spec, block.type);
    const previousCol = previous && beside.has(previous.sourceIndex) ? elementColumnIn(config.spec, previous.type) : null;
    const left = col.leftIn - (previousCol ? previousCol.leftIn + previousCol.widthIn : 0);
    const at = blockPos[source];
    dualDecos.push(Decoration.node(at, at + doc.child(source).nodeSize, {
      class: "pm-run-in",
      style: `margin-left:${inchesToCh(config.spec, left)}ch;width:${block.text.length}ch;max-width:${block.text.length}ch;`,
    }));
    dualDecos.push(Decoration.node(blockPos[next.sourceIndex], blockPos[next.sourceIndex] + doc.child(next.sourceIndex).nodeSize, { class: "pm-run-in-body" }));
  }

  if (!config.enabled) {
    return {
      deco: dualDecos.length ? DecorationSet.create(doc, dualDecos) : DecorationSet.empty,
      pageStarts,
      total: pages.length,
    };
  }

  const decorations: Decoration[] = [...dualDecos];
  for (const [index, page] of paginateFrontMatter(config.frontMatter, config.spec).entries()) {
    decorations.push(Decoration.widget(0,
      () => frontMatterWidget(page, config.spec!, config.onTitlePageClick ?? null),
      { side: -1, key: `pg-front-${index}-${JSON.stringify(page)}` },
    ));
  }
  if (pages[0]?.header) {
    decorations.push(
      Decoration.widget(0, () => edgeWidget("first-header", { header: pages[0].header }), {
        side: -1,
        key: `pg-first-${JSON.stringify(pages[0].header)}`,
      }),
    );
  }
  const hasIntro = pages.some((page) => page.intro?.length);
  const firstBody = pages.findIndex((page) => page.lines.length);
  const bodyPage = firstBody < 0 ? pages.length - 1 : firstBody;
  if (hasIntro) {
    decorations.push(Decoration.widget(0, () => introWidget(layout, config.spec!, bodyPage), {
      side: -1, key: `pg-intro-${JSON.stringify(pages.slice(0, bodyPage + 1))}`,
    }));
    const first = pages[bodyPage].lines[0];
    if (first && first.sourceIndex >= 0) {
      const at = blockPos[first.sourceIndex];
      decorations.push(Decoration.node(at, at + doc.child(first.sourceIndex).nodeSize, { class: "pm-after-intro" }));
    }
  }
  for (let i = hasIntro ? bodyPage + 1 : 1; i < pages.length; i++) {
    const page = pages[i];
    const prev = pages[i - 1];
    const pos = pageStarts[i];
    const contd = page.breakBefore?.contd ?? null;
    const header = page.header;
    const footer = prev.footer;
    const fillRows = prev.fillRows;
    decorations.push(
      Decoration.widget(pos, () => breakWidget({ fillRows, header, footer, contd }), {
        side: -1,
        key: `pg-${i}-${pos}-${fillRows}-${contd ?? ""}-${JSON.stringify(header)}-${JSON.stringify(footer)}`,
      }),
    );
  }
  const last = pages[pages.length - 1];
  if (last) {
    const footer = last.footer;
    decorations.push(
      Decoration.widget(doc.content.size, () => edgeWidget("fill", { fillRows: last.fillRows, footer }), {
        side: 1,
        key: `pg-last-${last.fillRows}-${JSON.stringify(footer)}`,
      }),
    );
  }
  return { deco: DecorationSet.create(doc, decorations), pageStarts, total: pages.length };
}

/**
 * Whether the page layout has still to catch up with the document: a relayout
 * is due (it runs RELAYOUT_DEBOUNCE_MS after the last change). Until it lands,
 * page breaks, headers and the script's height are the old ones, and anything
 * scrolled into place is about to move.
 */
export function layoutPending(state: EditorState): boolean {
  return KEY.getState(state)?.stale ?? false;
}

function currentPage(pageStarts: number[], pos: number): number {
  let page = 1;
  for (let i = 1; i < pageStarts.length; i++) {
    if (pos >= pageStarts[i]) page = i + 1;
    else break;
  }
  return page;
}

export const Pagination = Extension.create<Record<string, never>, PaginationStorage>({
  name: "pagination",

  addStorage() {
    return { total: 0, current: 1 };
  },

  addCommands() {
    return {
      setPagination:
        (config: PaginationConfig) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            const meta: ConfigMeta = { kind: "config", config };
            dispatch(tr.setMeta(KEY, meta));
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (view: EditorView) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const state = KEY.getState(view.state);
        if (!state?.stale) return;
        const { deco, pageStarts, total } = computeLayout(view.state.doc, state.config);
        const meta: LayoutMetaMsg = { kind: "layout", deco, pageStarts, total };
        view.dispatch(view.state.tr.setMeta(KEY, meta));
      }, RELAYOUT_DEBOUNCE_MS);
    };

    return [
      new Plugin<PluginState>({
        key: KEY,
        state: {
          init: () => ({
            config: { enabled: false, spec: null, meta: {} },
            deco: DecorationSet.empty,
            pageStarts: [0],
            stale: true,
          }),
          apply: (tr: Transaction, prev: PluginState): PluginState => {
            const meta = tr.getMeta(KEY) as Meta | undefined;
            let next = prev;
            if (meta?.kind === "config") {
              next = { ...prev, config: { frontMatter: null, ...meta.config }, stale: true };
            } else if (meta?.kind === "layout") {
              next = { ...prev, deco: meta.deco, pageStarts: meta.pageStarts, stale: false };
              storage.total = meta.total;
            }
            if (tr.docChanged) {
              next = {
                ...next,
                deco: next.deco.map(tr.mapping, tr.doc),
                stale: true,
              };
            }
            storage.current = currentPage(next.pageStarts, tr.selection.from);
            return next;
          },
        },
        props: {
          decorations(state) {
            return KEY.getState(state)?.deco ?? DecorationSet.empty;
          },
        },
        view: (view) => {
          schedule(view);
          return {
            update: (v) => {
              const state = KEY.getState(v.state);
              if (state?.stale) schedule(v);
            },
            destroy: () => {
              if (timer) clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pagination: {
      /** Reconfigure live pagination (spec / meta / page-view on-off). */
      setPagination: (config: PaginationConfig) => ReturnType;
    };
  }
  interface Storage {
    pagination: PaginationStorage;
  }
}
