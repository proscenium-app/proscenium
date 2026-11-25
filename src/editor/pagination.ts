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
import { frontSheetLabel, styleSegments } from "../pdf/plan";
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
  backPageList,
  buildLayoutBlock,
  frontPageList,
  legacyPageFiles,
  paginate,
  paginateBackMatter,
  paginateFrontMatter,
  type FrontMatterPage,
  type FrontMatterLine,
  type LayoutBlock,
  type LayoutMeta,
  type LayoutPage,
  type LayoutResult,
  type RawPiece,
} from "../layout";
import { remainderHeight, textRowsOf } from "./line-shortfall";
import { afterTap } from "../ui/finger";
import { LINE_BREAK } from "./bridge";

export interface PaginationConfig {
  enabled: boolean;
  spec: FormatSpec | null;
  meta: LayoutMeta;
  /** Canonical front matter; the shared engine supplies every sheet. */
  frontMatter?: FrontMatter | null;
  /**
   * One click on any page before the script edits it where it stands
   * (docs/app/formatting/formats-and-layout.md#FMT-169), with the page's
   * source (`FrontMatterPage.source`) and the engine's id of the paragraph
   * hit, or null between lines.
   */
  onFrontPageOpen?: ((source: string, paragraphId: string | null) => void) | null;
  /**
   * Add Page, offered beside the pages themselves
   * (docs/app/formatting/formats-and-layout.md#FMT-175): in the gap between
   * the last page before the script and the script's first sheet, and under
   * the last sheet for a page after the script. Null where the play cannot be
   * written.
   */
  onAddPage?: ((side: "front" | "back") => void) | null;
  /**
   * A page before the script being edited where it stands
   * (docs/app/formatting/formats-and-layout.md#FMT-165): its sheets are not
   * drawn, and in their place stands `root`, the sheet an editor is mounted
   * in, kept through every layout until the editing ends.
   */
  editingFront?: FrontEdit | null;
}

/** The front sheets whose text is written in Opening Pages' prose editors. */
export type NotesSheetKind = "setting" | "production";

/** The pages before the script that are edited on the page itself. */
export type FrontEditKind = "characters" | NotesSheetKind;

export interface FrontEdit {
  /** The page's source (`FrontMatterPage.source`). */
  source: string;
  /** From `frontEditHost`: drawn in the page's place, the same element every time. */
  root: HTMLElement;
  /**
   * The page is one after the script: its sheet stands after the script's
   * last. Said by whoever opens it, since a page just added is edited before
   * its folder has been read.
   */
  back?: boolean;
}

/** Which side of the script the editing sheet was last drawn on: `data-side` on its root. */
export const EDIT_SIDE = "side";

/** What a writer is told an empty Author field is for, on the sheet as in the editor. */
export const AUTHOR_PROMPT = "Author's name";

/**
 * A sheet before the script with the page's own chrome around it, and the
 * element inside it an editor is mounted in. Made once per editing surface.
 */
export function frontEditHost(): {
  root: HTMLElement;
  mount: HTMLElement;
  /** Stand the sheet as a page after the script does: under the gap, not over it. */
  place: (back: boolean) => void;
} {
  const root = el("pgchrome pgchrome--front pgchrome--editing");
  root.contentEditable = "false";
  const mount = el("frontsheet frontsheet--editing", root);
  el("pgchrome__botmargin", root);
  el("pgchrome__band", root);
  el("pgchrome__topmargin", root);
  let standsBack = false;
  const place = (back: boolean) => {
    if (back === standsBack) return;
    standsBack = back;
    if (back) root.append(mount);
    else root.prepend(mount);
  };
  return { root, mount, place };
}

/**
 * A page's name on its sheet, in the corner of the paper outside the text
 * block, where nothing prints: what the page is, and that a press edits it
 * (docs/app/formatting/formats-and-layout.md#FMT-175). It is part of the
 * sheet, so a press on it is a press on the sheet; a screen reader already
 * hears the sheet's own name and what a press does.
 */
function pageChip(name: string, sheet: HTMLElement, editable: boolean): void {
  const chip = el("pgchip", sheet);
  chip.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "pgchip__name";
  label.textContent = name;
  chip.appendChild(label);
  if (!editable) return;
  const hint = document.createElement("span");
  hint.className = "pgchip__hint";
  hint.textContent = "Edit";
  chip.appendChild(hint);
}

/**
 * Add Page, on the desk beside the pages, for a pointer or a finger: a press
 * the script's selection never takes. It is the pointer's way to a command
 * the keyboard and a screen reader have in the menus (Add Page… in the
 * document menu, the Script menu and the folder of pages' own), so it is no
 * control of its own to them, as a sheet's name in its corner is not. A
 * control here would also be one that scrolls under the bar at the top of
 * the script: half hidden there, it is a target too small to press, at
 * whatever offset the writer stopped scrolling.
 */
function addPageWidget(side: "front" | "back", corner: boolean, onAdd: () => void): HTMLElement {
  const root = el(`pgchrome pgadd pgadd--${side}${corner ? " pgadd--corner" : ""}`);
  root.contentEditable = "false";
  const button = el("pgadd__button", root);
  button.textContent = "Add Page";
  button.setAttribute("aria-hidden", "true");
  button.dataset.addPage = side;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onAdd();
  });
  return root;
}

/**
 * Whatever opens a sheet before the script: a press of the pointer (never
 * selecting a word of the sheet's text), or Return or Space with the sheet
 * focused, which the Tab key reaches (docs/app/formatting/formats-and-layout.md#FMT-169).
 */
function opensOnPress(
  sheet: HTMLElement,
  name: string,
  open: (target: EventTarget | null) => void,
): void {
  sheet.classList.add(
    sheet.classList.contains("titlesheet") ? "titlesheet--editable" : "frontsheet--editable",
  );
  sheet.tabIndex = 0;
  sheet.setAttribute("role", "button");
  sheet.setAttribute(
    "aria-label",
    `${name}, ${sheet.dataset.backPage === undefined ? "front" : "back"} matter`,
  );
  sheet.setAttribute("aria-description", "Press to write on this page.");
  sheet.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    open(event.target);
  });
  sheet.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    open(null);
  });
}

/** A page with nothing on it yet: a sheet with its name, to be written on. */
function emptyPageWidget(
  source: string,
  name: string,
  onOpen: ((source: string, paragraphId: string | null) => void) | null,
  back = false,
): HTMLElement {
  const root = el(`pgchrome pgchrome--front${back ? " pgchrome--back" : ""}`);
  root.contentEditable = "false";
  if (back) gapBefore(root);
  const sheet = el("frontsheet frontsheet--placeholder", root);
  sheet.dataset.frontPlaceholder = source;
  sheet.dataset.frontSource = source;
  if (back) sheet.dataset.backPage = "";
  el("frontsheet__placeholderhead", sheet).textContent = name;
  el("frontsheet__placeholderhint", sheet).textContent = onOpen
    ? "Click to write on this page."
    : "Nothing is written on this page yet.";
  if (onOpen) opensOnPress(sheet, name, () => onOpen(source, null));
  if (!back) gapAfter(root);
  return root;
}

/** The foot of a sheet, the desk between two sheets, and the head of the next. */
function gapAfter(root: HTMLElement): void {
  el("pgchrome__botmargin", root);
  el("pgchrome__band", root);
  el("pgchrome__topmargin", root);
}
/** The same three, before a sheet that follows the script's last. */
const gapBefore = gapAfter;

/**
 * The pages before the script in print order, by source: a page file's
 * binder id, or `legacy:` and the kind of a page the title page prints.
 */
function frontSources(frontMatter: FrontMatter | null | undefined): string[] {
  if (frontMatter?.pages) return frontMatter.pages.map((page) => page.id);
  return legacyPageFiles(frontMatter).map((file) => `legacy:${file.kind}`);
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
export function blocksFromPmDoc(
  doc: PMNode,
  spec: FormatSpec,
): {
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
      // A line break inside a speech or an action (Enter, Shift+Enter) is a
      // node here and a newline everywhere else. Left out, the engine read a
      // speech's paragraphs as one, wrapped it on lines the page does not have,
      // and broke the page partway through a line the writer could see had room.
      if (child.type.name === LINE_BREAK) {
        pieces.push({ text: "\n", srcStart: offset + 1 + childOffset });
        return;
      }
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
          out.push(Decoration.widget(at, dualClearWidget, { side: -1, key: `dual-clear-${at}` }));
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
  /** Rows of text on the page this break ends (line-shortfall.ts). */
  textRows: number;
  header: Slots | null;
  /** The footer of the page this break ENDS. */
  footer: Slots | null;
  contd: string | null;
}): HTMLElement {
  const root = el("pgchrome");
  root.contentEditable = "false";
  el("pgchrome__fill", root).style.height = remainderHeight(args.fillRows, args.textRows);
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
function frontMatterWidget(
  page: FrontMatterPage,
  spec: FormatSpec,
  onOpen: ((source: string, paragraphId: string | null) => void) | null,
  names: ReadonlyMap<string, string>,
  /** A page after the script: its sheet stands under the gap, not over it. */
  back = false,
  /** Lines that stand for a detail the play does not have yet (`AUTHOR_PROMPT`). */
  prompts: ReadonlySet<string> = NO_PROMPTS,
): HTMLElement {
  const root = el(
    `pgchrome pgchrome--${page.kind === "title" ? "title" : "front"}${back ? " pgchrome--back" : ""}`,
  );
  root.contentEditable = "false";
  if (back) gapBefore(root);
  const sheet = el(page.kind === "title" ? "titlesheet" : "frontsheet", root);
  sheet.dataset.frontKind = page.kind;
  if (back) sheet.dataset.backPage = "";
  const source = page.source;
  // The page that lists the cast, which the guide points at (lesson 4).
  if (page.kind === "characters" || /character|cast/i.test(page.label ?? ""))
    sheet.dataset.tutorial = "characters-page";
  if (source !== undefined && onOpen) {
    sheet.dataset.frontSource = source;
    // One click, the title page's as every other's: the pages are part of
    // the play, and a click on one is meant
    // (docs/app/formatting/formats-and-layout.md#FMT-169).
    // Named as the page is everywhere else: its file's name, or the name its
    // file will have (frontPageList), not the old sheet's label.
    const name = names.get(source) ?? frontSheetLabel(page).label;
    opensOnPress(sheet, name, (target) => {
      const hit = target instanceof Element ? target : null;
      const line = hit?.closest<HTMLElement>("[data-front-paragraph]");
      onOpen(source, line?.dataset.frontParagraph ?? null);
    });
  }
  frontMatterLines(page.lines, sheet, spec, prompts);
  if (source !== undefined)
    pageChip(names.get(source) ?? frontSheetLabel(page).label, sheet, !!onOpen);
  if (!back) gapAfter(root);
  return root;
}

const NO_PROMPTS: ReadonlySet<string> = new Set();

function frontMatterLines(
  lines: FrontMatterLine[],
  sheet: HTMLElement,
  spec: FormatSpec,
  prompts: ReadonlySet<string> = NO_PROMPTS,
): void {
  for (const line of lines) {
    const text = el(
      prompts.has(line.text) ? "frontsheet__line frontsheet__line--prompt" : "frontsheet__line",
      sheet,
    );
    for (const segment of styleSegments(line.text, line.runs ?? [], {
      bold: line.fontStyle === "bold" || line.fontStyle === "bold-italic",
      italic: line.fontStyle === "italic" || line.fontStyle === "bold-italic",
    })) {
      const span = document.createElement("span");
      span.textContent = segment.text;
      span.style.fontWeight = segment.bold ? "700" : "400";
      span.style.fontStyle = segment.italic ? "italic" : "normal";
      text.appendChild(span);
    }
    text.style.top = `calc(${line.row} * var(--fmt-line))`;
    text.style.left = `${inchesToCh(spec, line.xIn)}ch`;
    text.style.fontWeight =
      line.fontStyle === "bold" || line.fontStyle === "bold-italic" ? "700" : "400";
    text.style.fontStyle =
      line.fontStyle === "italic" || line.fontStyle === "bold-italic" ? "italic" : "normal";
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
    const height = index < bodyPage ? layout.maxRows : (page.lines[0]?.row ?? page.usedRows);
    sheet.style.height = `calc(${height} * var(--fmt-line))`;
    frontMatterLines(page.intro ?? [], sheet, spec);
    if (index < bodyPage)
      root.appendChild(
        breakWidget({
          fillRows: 0,
          // An intro sheet is drawn at its exact height, with no line of text in flow.
          textRows: 0,
          footer: page.footer,
          header: layout.pages[index + 1].header,
          contd: null,
        }),
      );
  }
  return root;
}

/** A first-page header (formats that don't suppress it) drawn into the top
 * margin, and the last sheet's bottom fill with that sheet's footer. */
function edgeWidget(
  kind: "first-header" | "fill",
  args: {
    fillRows?: number;
    textRows?: number;
    header?: Slots | null;
    footer?: Slots | null;
  },
): HTMLElement {
  const root = el("pgchrome");
  root.contentEditable = "false";
  if (kind === "first-header" && args.header) {
    marginSlots("pgchrome__header", args.header, el("pgchrome__firstheader", root));
  }
  if (kind === "fill") {
    el("pgchrome__fill", root).style.height = remainderHeight(
      args.fillRows ?? 0,
      args.textRows ?? 0,
    );
    // The last sheet's bottom margin is the page's own padding, not chrome, so
    // its footer hangs from a zero-height anchor down into it.
    if (args.footer) marginSlots("pgchrome__footer", args.footer, el("pgchrome__lastfooter", root));
  }
  return root;
}

/**
 * The blocks whose first line opens a page: each hugs its page's top margin
 * (`pm-page-top`), as the engine placed it, with no gap above row 0.
 *
 * Read from the layout because the DOM cannot say it: after a forced break the
 * block under the page's chrome is the break itself, which prints nothing and
 * page view collapses, so `.pgchrome + .pl` took the break and the line below
 * kept its gap, a blank line at the top of the page that the PDF does not
 * have. A synopsis or a boneyard at a page's top hid the same way. A page that
 * opens partway through a block is left alone: its gap is on the page before.
 * `skipPage` is the page under the intro, whose first block it marks itself.
 */
export function pageTopSources(pages: LayoutPage[], skipPage: number): number[] {
  const sources: number[] = [];
  for (const [i, page] of pages.entries()) {
    if (i === skipPage) continue;
    const first = page.lines[0];
    if (first?.kind === "text" && first.start === 0 && first.sourceIndex >= 0)
      sources.push(first.sourceIndex);
  }
  return sources;
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
    const next = blocks[index + 1],
      previous = blocks[index - 1];
    const firstRow = pages.flatMap((p) => p.lines).find((line) => line.sourceIndex === source)?.row;
    const gap =
      index === 0 || (config.enabled && firstRow === 0)
        ? 0
        : Math.max(
            previous ? config.spec.elements[previous.type].spacingAfter : 0,
            config.spec.elements[blocks[index].type].spacingBefore,
          );
    // Floats do not collapse margins like regular paragraphs. Give the pair
    // one measured gap, outside both blocks, so both begin on the same row.
    if (previous) {
      const priorAt = blockPos[previous.sourceIndex];
      dualDecos.push(
        Decoration.node(priorAt, priorAt + doc.child(previous.sourceIndex).nodeSize, {
          class: "pm-before-beside",
        }),
      );
    }
    dualDecos.push(
      Decoration.widget(
        at,
        () => {
          const spacer = document.createElement("div");
          spacer.className = "pm-beside-gap";
          spacer.style.height = `calc(${gap} * var(--fmt-line))`;
          return spacer;
        },
        { side: -1, key: `beside-gap-${source}-${gap}` },
      ),
    );
    dualDecos.push(
      Decoration.node(
        blockPos[next.sourceIndex],
        blockPos[next.sourceIndex] + doc.child(next.sourceIndex).nodeSize,
        { class: "pm-beside-body" },
      ),
    );
    const tail = runIns.has(next.sourceIndex) ? blocks[index + 2] : next;
    const end = blockPos[tail.sourceIndex] + doc.child(tail.sourceIndex).nodeSize;
    dualDecos.push(
      Decoration.widget(
        end,
        () => {
          const clear = document.createElement("div");
          clear.className = "pm-beside-clear";
          return clear;
        },
        { side: -1, key: `beside-clear-${source}` },
      ),
    );
  }
  const beside = besidePairs(blocks, config.spec);
  for (const source of runIns) {
    const index = blocks.findIndex((b) => b.sourceIndex === source);
    const block = blocks[index],
      previous = blocks[index - 1],
      next = blocks[index + 1];
    const col = elementColumnIn(config.spec, block.type);
    const previousCol =
      previous && beside.has(previous.sourceIndex)
        ? elementColumnIn(config.spec, previous.type)
        : null;
    const left = col.leftIn - (previousCol ? previousCol.leftIn + previousCol.widthIn : 0);
    const at = blockPos[source];
    dualDecos.push(
      Decoration.node(at, at + doc.child(source).nodeSize, {
        class: "pm-run-in",
        style: `margin-left:${inchesToCh(config.spec, left)}ch;width:${block.text.length}ch;max-width:${block.text.length}ch;`,
      }),
    );
    dualDecos.push(
      Decoration.node(
        blockPos[next.sourceIndex],
        blockPos[next.sourceIndex] + doc.child(next.sourceIndex).nodeSize,
        { class: "pm-run-in-body" },
      ),
    );
  }

  if (!config.enabled) {
    return {
      deco: dualDecos.length ? DecorationSet.create(doc, dualDecos) : DecorationSet.empty,
      pageStarts,
      total: pages.length,
    };
  }

  const decorations: Decoration[] = [...dualDecos];
  // A play with no author yet says so where the name will print, on a sheet
  // that can be written on: never in print, which lays out the play's own
  // details (docs/app/formatting/formats-and-layout.md#FMT-176).
  const editable = !!config.onFrontPageOpen;
  const unnamed =
    editable && !!config.frontMatter && !(config.frontMatter.authors ?? []).join("").trim();
  const shown = unnamed
    ? { ...config.frontMatter, authors: [AUTHOR_PROMPT], credit: config.frontMatter?.credit ?? "" }
    : config.frontMatter;
  const prompts: ReadonlySet<string> = unnamed ? new Set([AUTHOR_PROMPT]) : NO_PROMPTS;
  const fronts = paginateFrontMatter(shown, config.spec);
  const order = frontSources(config.frontMatter);
  const names = new Map(
    [...frontPageList(config.frontMatter), ...backPageList(config.frontMatter)].map((p) => [
      p.id,
      p.name,
    ]),
  );
  const backSources = backPageList(config.frontMatter).map((page) => page.id);
  const isBack = (source: string | undefined) =>
    source !== undefined && backSources.includes(source);
  const rank = (source: string | undefined) => {
    const at = source === undefined ? -1 : order.indexOf(source);
    return at < 0 ? order.length : at;
  };
  // The page being edited stands where its sheets would, as one sheet that
  // grows with what is typed; with no sheet of its own yet, where it would go.
  // A page file with nothing printed on it stands where it goes, to be written on.
  const editing = config.editingFront ?? null;
  const inserts: { rank: number; deco: () => Decoration }[] = [];
  const editingBack = !!editing && (editing.back ?? isBack(editing.source));
  /** The editing sheet, marked with the side it is drawn on as it is drawn. */
  const editingRoot = (side: "front" | "back") => () => {
    editing!.root.dataset[EDIT_SIDE] = side;
    return editing!.root;
  };
  if (editing && !editingBack)
    inserts.push({
      rank: rank(editing.source),
      deco: () =>
        Decoration.widget(0, editingRoot("front"), {
          side: -1,
          key: `pg-front-edit-${editing.source}`,
          // The editor in it is its own: the script neither reads its keys
          // nor takes its selection for the script's.
          stopEvent: () => true,
          ignoreSelection: true,
        }),
    });
  if (config.spec.frontMatter.placement !== "inline")
    for (const page of config.frontMatter?.pages ?? []) {
      if (page.id === editing?.source || fronts.some((front) => front.source === page.id)) continue;
      inserts.push({
        rank: rank(page.id),
        deco: () =>
          Decoration.widget(
            0,
            () => emptyPageWidget(page.id, page.name, config.onFrontPageOpen ?? null),
            { side: -1, key: `pg-front-empty-${page.id}-${page.name}` },
          ),
      });
    }
  inserts.sort((a, b) => a.rank - b.rank);
  const drawInserts = (upTo: number) => {
    while (inserts.length && inserts[0]!.rank <= upTo) decorations.push(inserts.shift()!.deco());
  };
  for (const [index, page] of fronts.entries()) {
    drawInserts(rank(page.source));
    if (page.source !== undefined && page.source === editing?.source) continue;
    decorations.push(
      Decoration.widget(
        0,
        () =>
          frontMatterWidget(
            page,
            config.spec!,
            config.onFrontPageOpen ?? null,
            names,
            false,
            prompts,
          ),
        {
          side: -1,
          key: `pg-front-${index}-${editable}-${names.get(page.source ?? "") ?? ""}-${JSON.stringify(page)}`,
        },
      ),
    );
  }
  drawInserts(Number.POSITIVE_INFINITY);
  const onAddPage = config.onAddPage ?? null;
  if (onAddPage) {
    // In the gap over the script's first sheet when a page stands before it,
    // and in the corner of that sheet's own margin when none does.
    // Until here the page's own decorations are the pages before the script alone.
    const corner = decorations.length === dualDecos.length;
    decorations.push(
      Decoration.widget(0, () => addPageWidget("front", corner, () => onAddPage("front")), {
        side: -1,
        key: `pg-add-front-${corner}`,
        stopEvent: () => true,
        ignoreSelection: true,
      }),
    );
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
    decorations.push(
      Decoration.widget(0, () => introWidget(layout, config.spec!, bodyPage), {
        side: -1,
        key: `pg-intro-${JSON.stringify(pages.slice(0, bodyPage + 1))}`,
      }),
    );
    const first = pages[bodyPage].lines[0];
    if (first && first.sourceIndex >= 0) {
      const at = blockPos[first.sourceIndex];
      decorations.push(
        Decoration.node(at, at + doc.child(first.sourceIndex).nodeSize, {
          class: "pm-after-intro",
        }),
      );
    }
  }
  for (const source of pageTopSources(pages, hasIntro ? bodyPage : -1)) {
    const at = blockPos[source];
    decorations.push(
      Decoration.node(at, at + doc.child(source).nodeSize, { class: "pm-page-top" }),
    );
  }
  for (let i = hasIntro ? bodyPage + 1 : 1; i < pages.length; i++) {
    const page = pages[i];
    const prev = pages[i - 1];
    const pos = pageStarts[i];
    const contd = page.breakBefore?.contd ?? null;
    const header = page.header;
    const footer = prev.footer;
    const fillRows = prev.fillRows;
    const textRows = textRowsOf(prev.lines);
    decorations.push(
      Decoration.widget(pos, () => breakWidget({ fillRows, textRows, header, footer, contd }), {
        side: -1,
        key: `pg-${i}-${pos}-${fillRows}-${textRows}-${contd ?? ""}-${JSON.stringify(header)}-${JSON.stringify(footer)}`,
      }),
    );
  }
  const last = pages[pages.length - 1];
  if (last) {
    const footer = last.footer;
    const textRows = textRowsOf(last.lines);
    decorations.push(
      Decoration.widget(
        doc.content.size,
        () => edgeWidget("fill", { fillRows: last.fillRows, textRows, footer }),
        {
          side: 1,
          key: `pg-last-${last.fillRows}-${textRows}-${JSON.stringify(footer)}`,
        },
      ),
    );
  }
  // The pages after the script (docs/app/formatting/formats-and-layout.md#FMT-174),
  // each under a gap of its own after the script's last sheet, in their
  // folder's order: a page's sheets, the page being edited in its place, a
  // page with nothing printed yet as a sheet to be written on.
  const backs = paginateBackMatter(config.frontMatter, config.spec);
  let side = 2;
  const drawEditing = () =>
    decorations.push(
      Decoration.widget(doc.content.size, editingRoot("back"), {
        side: side++,
        key: `pg-back-edit-${editing!.source}`,
        stopEvent: () => true,
        ignoreSelection: true,
      }),
    );
  for (const source of backSources) {
    if (editingBack && source === editing?.source) {
      drawEditing();
      continue;
    }
    const sheets = backs.filter((page) => page.source === source);
    if (!sheets.length) {
      const name = names.get(source) ?? "Page";
      decorations.push(
        Decoration.widget(
          doc.content.size,
          () => emptyPageWidget(source, name, config.onFrontPageOpen ?? null, true),
          { side: side++, key: `pg-back-empty-${source}-${name}` },
        ),
      );
      continue;
    }
    for (const page of sheets)
      decorations.push(
        Decoration.widget(
          doc.content.size,
          () => frontMatterWidget(page, config.spec!, config.onFrontPageOpen ?? null, names, true),
          {
            side: side++,
            key: `pg-back-${editable}-${names.get(source) ?? ""}-${JSON.stringify(page)}`,
          },
        ),
      );
  }
  // A page just added after the script, edited before its folder has been
  // read: its sheet stands last, where the page will.
  if (editingBack && editing && !backSources.includes(editing.source)) drawEditing();
  if (onAddPage)
    decorations.push(
      Decoration.widget(
        doc.content.size,
        () => addPageWidget("back", true, () => onAddPage("back")),
        { side: side++, key: "pg-add-back", stopEvent: () => true, ignoreSelection: true },
      ),
    );
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
      // The sheets drawn again wait for a finger's tap under way: drawn under
      // it, they cost an iPad's tap its click (ui/finger.ts).
      const relayout = () => {
        if (view.isDestroyed) return;
        const state = KEY.getState(view.state);
        if (!state?.stale) return;
        const { deco, pageStarts, total } = computeLayout(view.state.doc, state.config);
        const meta: LayoutMetaMsg = { kind: "layout", deco, pageStarts, total };
        view.dispatch(view.state.tr.setMeta(KEY, meta));
      };
      timer = setTimeout(() => {
        timer = null;
        afterTap(relayout);
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
