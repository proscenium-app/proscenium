// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import { Button, ChevronDownIcon, IconButton, Menu, TrashIcon, announce, useMenu } from "../ui";
import { moveToTrash } from "../ui/system-words";
import { keyStyle, keys } from "../ui/keys";
import { portalHost } from "../ui/portal-host";
import { takeFocusFromPress, type PressFocusView } from "../ui/caret-on-focus";
import { ProseEditor } from "../markdown/ProseEditor";
import { FormatBar } from "../markdown/FormatBar";
import {
  FIELD_NODE,
  enterField,
  fieldTextOf,
  settleIntoField,
  type FieldWriter,
} from "../markdown/page-file-nodes";
import {
  FIELD_LABEL,
  readFieldOptions,
  writeFieldOptions,
  type FieldName,
} from "../markdown/page-fields";
import { toDoc, toMarkdown, type Node as DocNode } from "../markdown/doc";
import type { Field, MoveStep, MoveTo, Moved, PageSpot, PageSpots } from "../layout";
import { DETAIL_HELP, DETAIL_OF, type Detail } from "./play-details";

/** The element that scrolls `el`: the nearest that can, or the document. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight)
      return at;
  }
  return document.scrollingElement as HTMLElement | null;
}

/**
 * Bring the caret (a viewport y) into view below the bar that sticks at the
 * top of the script, and with it `head`, the top of the page's sheet, when
 * the page is opened at its top. What scrolls a caret "into view" knows
 * nothing of the bar, and left a page's first line under it; and it does not
 * scroll at all for an editor that has only just been put in the page, so a
 * page added further down than the writer was looking opened out of sight,
 * with the keyboard in it. A caret already in view below the bar, with the
 * head of its page, is left where it is.
 */
function reveal(
  caret: number,
  head: number | undefined,
  bar: HTMLElement | null | undefined,
  from: HTMLElement,
): void {
  const scroller = scrollerOf(from);
  if (!scroller) return;
  const pane = scroller.getBoundingClientRect();
  const limit = Math.max(bar?.getBoundingClientRect().bottom ?? 0, pane.top) + 12;
  // In view: below the bar, with room under it for a few lines to be typed.
  const floor = Math.min(pane.bottom, window.innerHeight) - 96;
  const top = Math.min(caret, head ?? caret);
  if (top >= limit && caret <= floor) return;
  // The head of the sheet under the bar, when the caret is then in view; the
  // caret itself a little under the bar when the page is taller than that.
  const room = floor - limit;
  const to = head !== undefined && caret - head <= room ? head : caret - Math.min(room, 96);
  scroller.scrollBy({ top: to - limit });
}

/** What a writer is told the detail a field writes is; nothing for a field that is no detail. */
function helpFor(name: FieldName): string {
  const detail = DETAIL_OF[name];
  return detail ? DETAIL_HELP[detail].help : "";
}

/**
 * One line under the field the caret is in, saying what that detail is: a
 * caption over the page, never on it, that follows the field as the page
 * scrolls and its words grow. It takes no press and no key, and a screen
 * reader has the same words as the field's description, so it is hidden from
 * one. It stands beside the field, on the field's first line, where a title
 * page's short lines leave the paper clear; under it where there is no room
 * beside (above, at the foot of the window); and is not drawn while the field
 * is under the bar at the top of the script.
 */
function FieldNote({
  at,
  bar,
  children,
}: {
  at: HTMLElement;
  bar: HTMLElement | null;
  children: string;
}) {
  const note = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const GAP = 6;
    const EDGE = 8;
    const put = () => {
      if (!at.isConnected) return setPlace(null);
      const field = at.getBoundingClientRect();
      const size = note.current?.getBoundingClientRect();
      const width = size?.width ?? 0;
      const height = size?.height ?? 0;
      const floor = bar?.getBoundingClientRect().bottom ?? 0;
      if (field.bottom < floor || field.top > window.innerHeight) return setPlace(null);
      // The pane the page is in: the caption stays over it, clear of what is beside it.
      const pane = scrollerOf(at)?.getBoundingClientRect();
      const edge = Math.min(window.innerWidth, pane?.right ?? window.innerWidth) - EDGE;
      const first = at.getClientRects()[0] ?? field;
      let top: number;
      let left: number;
      if (field.right + 2 * GAP + width <= edge) {
        left = field.right + 2 * GAP;
        top = first.top + (first.height - height) / 2;
      } else {
        const under = field.bottom + GAP;
        top = under + height > window.innerHeight - EDGE ? field.top - GAP - height : under;
        left = Math.max(EDGE, Math.min(edge - width, field.left + field.width / 2 - width / 2));
      }
      setPlace((was) => (was && was.top === top && was.left === left ? was : { top, left }));
    };
    put();
    window.addEventListener("scroll", put, true);
    window.addEventListener("resize", put);
    at.addEventListener("input", put);
    return () => {
      window.removeEventListener("scroll", put, true);
      window.removeEventListener("resize", put);
      at.removeEventListener("input", put);
    };
  }, [at, bar]);
  return createPortal(
    <div
      ref={note}
      className="fieldnote"
      aria-hidden="true"
      style={{
        top: place?.top ?? 0,
        left: place?.left ?? 0,
        visibility: place ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    portalHost(),
  );
}

/** How a page sits on its sheet, for an editor that sets it as it prints. */
export interface SheetSetting {
  /** Rows of the format's line above the page's first. */
  topRows: number;
  /** Blank rows between one paragraph and the next. */
  gapRows: number;
  /** A title page: its level-one heading is the play's title, in the format's title style. */
  title: boolean;
  /** How the format sets a heading, the body and a title page's title. */
  heading: string;
  body: string;
  titleStyle: string;
}

const weightOf = (style: string) => (style === "bold" || style === "bold-italic" ? "700" : "400");
const slantOf = (style: string) =>
  style === "italic" || style === "bold-italic" ? "italic" : "normal";

/**
 * Moving a block of the page (docs/app/formatting/formats-and-layout.md#FMT-182):
 * where each stands and where one can go, worked out by the one paginator from
 * the page's words as the editor holds them. A move's `text` is those words
 * with the block moved.
 */
export interface PagePlacing {
  spots: (body: string) => PageSpots;
  move: (body: string, index: number, to: MoveTo) => Moved | null;
  step: (body: string, index: number, step: MoveStep) => Moved | null;
}

/** Each way a block moves, as the Move menu and the keys say it. */
const STEPS: readonly { step: MoveStep; label: string; arrow: string; key: string }[] = [
  { step: "up", label: "Up a Row", arrow: "↑", key: "ArrowUp" },
  { step: "down", label: "Down a Row", arrow: "↓", key: "ArrowDown" },
  { step: "left", label: "Left a Cell", arrow: "←", key: "ArrowLeft" },
  { step: "right", label: "Right a Cell", arrow: "→", key: "ArrowRight" },
];

/**
 * The chord that moves a block, as this system writes it. A Mac's is ⌃⌘ and
 * an arrow, as a binder row's is. A PC's is Alt+Shift and an arrow, the keys
 * its word processors move a paragraph with: Ctrl+Shift and an arrow selects
 * by the word there, which a page's writer needs.
 */
const moveChord = (arrow: string) => (keyStyle() === "pc" ? keys(`⌥⇧${arrow}`) : `⌃⌘${arrow}`);

/** Where a moved block now stands, as it is said. */
const placeSaid = (moved: Moved) =>
  `Moved to row ${Math.floor(moved.row + 0.01) + 1}, cell ${Math.round(moved.cell) + 1}.`;

/** The outline of a block being dragged, in rows and cells of the sheet. */
interface Ghost {
  row: number;
  cell: number;
  width: number;
  height: number;
}

/**
 * The components of a page that have settings of their own
 * (docs/app/formatting/formats-and-layout.md#FMT-184): fields the script
 * fills, which no one writes in. Selected, each shows a button beside it that
 * opens what can be set.
 */
type ComponentName = "contents" | "cast";
const isComponent = (name: unknown): name is ComponentName =>
  name === "contents" || name === "cast";

/** The component the caret has selected, and where its button stands. */
interface ComponentAt {
  name: ComponentName;
  pos: number;
  options: string;
  top: number;
  left: number;
}

/** The play's details, as a field of the page writes them. */
export interface DetailsAccess {
  set: (detail: Detail, text: string) => void;
}

/**
 * A page before or after the script, written in the prose editor
 * (docs/app/formatting/formats-and-layout.md#FMT-169). With `sheet` it is
 * set as it prints (docs/app/formatting/formats-and-layout.md#FMT-177): the
 * format's own type on the script's character grid, its first line where the
 * layout puts it, the format's gap between paragraphs, and a title page's
 * foot at the bottom of the sheet, so a click on the page changes nothing but
 * the caret. Where the words wrap and break across sheets is still the shared
 * paginator's, when the editing ends.
 */
export function FrontPageEditor({
  value,
  onChange,
  label,
  focusAt,
  barHost,
  fields,
  onBlur,
  name,
  onDone,
  onChangeTemplate,
  onRemove,
  details,
  openField,
  sheet,
  place,
}: {
  value: string;
  onChange: (text: string) => void;
  label: string;
  /** Put the caret at the start of this top-level paragraph; a new object asks again. */
  focusAt?: { paragraph: number } | null;
  /** Where the formatting bar stands, when not over the text: the top of the script, for a page edited there. */
  barHost?: HTMLElement | null;
  /** A page file's fields and the facts they show (docs/app/formatting/formats-and-layout.md#FMT-169). */
  fields?: Partial<Record<Field, string>>;
  /** The editor lost the keyboard: what it holds should not wait for a pause. */
  onBlur?: () => void;
  /** The page's name, said in the bar while it is edited. */
  name?: string;
  /** Ends the editing: the bar's Done. */
  onDone?: () => void;
  /** Opens the templates, to give this page another. */
  onChangeTemplate?: () => void;
  /** Moves the page to the Trash: any page goes, the title page too. */
  onRemove?: () => void;
  /** The play's details: given, a field is where its detail is written, in place. */
  details?: DetailsAccess;
  /** A field to put the caret in as the editor opens: the one the writer pressed on the sheet. */
  openField?: FieldName | null;
  /** Set the page as it prints. */
  sheet?: SheetSetting;
  /** Given, with `sheet`: a block of the page can be moved about its sheet. */
  place?: PagePlacing;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  /** The field the caret is in: the bar says what that detail is. */
  const [activeField, setActiveField] = useState<{ name: FieldName; at: HTMLElement } | null>(null);
  const editable = !!details;
  const access = useRef(details);
  access.current = details;
  // A field is written where it stands
  // (docs/app/formatting/formats-and-layout.md#FMT-180): what is left in it is
  // the play's detail.
  const write = useMemo(
    (): FieldWriter => ({
      writes: (name) => name in DETAIL_OF,
      commit: (name, text) => {
        const detail = DETAIL_OF[name];
        if (detail) access.current?.set(detail, text);
      },
      help: (name) => helpFor(name),
      onActive: (name, at) => setActiveField(name && at ? { name, at } : null),
    }),
    [],
  );
  // A page file's editor shows its fields as the facts they hold, kept current
  // as the play's details change.
  const pageFile = useMemo(
    () => (fields ? { values: fields, ...(editable ? { write } : {}) } : undefined),
    [fields, editable, write],
  );
  const box = useRef<HTMLDivElement | null>(null);
  const placing = sheet ? place : undefined;
  const placer = useRef(placing);
  placer.current = placing;
  /** The handle a block is dragged by: beside the block under the pointer, or the caret's. */
  const [grip, setGrip] = useState<{ index: number; top: number; left: number } | null>(null);
  /** The outline of the block being dragged, where it would stand. */
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const drag = useRef<{
    index: number;
    body: string;
    self: PageSpot;
    cells: number;
    x: number;
    y: number;
    line: number;
    cell: number;
    asked: string;
    moved: Moved | null;
  } | null>(null);

  /** The component selected: its settings are a press away, beside it. */
  const [component, setComponent] = useState<ComponentAt | null>(null);
  const componentBtn = useRef<HTMLButtonElement | null>(null);
  const componentMenu = useMenu();
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editable) return;
    const read = () => {
      const { selection } = editor.state;
      const host = box.current;
      const node = selection instanceof NodeSelection ? selection.node : null;
      const dom = node ? editor.view.nodeDOM(selection.from) : null;
      if (!host || !node || node.type.name !== FIELD_NODE || !isComponent(node.attrs.name)) {
        setComponent(null);
        return;
      }
      if (!(dom instanceof HTMLElement)) return;
      const at = dom.getBoundingClientRect();
      const from = host.getBoundingClientRect();
      setComponent({
        name: node.attrs.name,
        pos: selection.from,
        options: typeof node.attrs.options === "string" ? node.attrs.options : "",
        top: at.top - from.top,
        left: at.right - from.left,
      });
    };
    editor.on("selectionUpdate", read);
    editor.on("update", read);
    return () => {
      editor.off("selectionUpdate", read);
      editor.off("update", read);
    };
  }, [editor, editable]);
  /** One setting of the selected component changed; the component stays selected. */
  const setOption = (key: string, value: string | null) => {
    if (!editor || editor.isDestroyed || !component) return;
    const { state, view } = editor;
    const options = { ...readFieldOptions(component.options) };
    if (value === null) delete options[key];
    else options[key] = value;
    const tr = state.tr.setNodeAttribute(component.pos, "options", writeFieldOptions(options));
    tr.setSelection(NodeSelection.create(tr.doc, component.pos));
    view.dispatch(tr);
    view.focus();
  };
  /**
   * The cast as words of the page: each name a line of its own, in bold as a
   * list of characters is set, to be written on from here. It no longer
   * follows the script.
   */
  const castIntoText = () => {
    if (!editor || editor.isDestroyed || !component) return;
    const { state, view } = editor;
    const names = (fields?.cast ?? "").split("\n").filter((name) => name.trim());
    const $at = state.doc.resolve(component.pos);
    const para = state.schema.nodes.paragraph;
    const bold = state.schema.marks.bold;
    if (!para) return;
    const tr = state.tr;
    if ($at.parent.childCount === 1 && $at.depth === 1) {
      const { placeRows: _rows, placeBeside: _beside, ...kept } = $at.parent.attrs;
      const lines = names.map((name, i) =>
        para.create(
          i ? kept : $at.parent.attrs,
          state.schema.text(name, bold ? [bold.create()] : []),
        ),
      );
      tr.replaceWith($at.before(), $at.after(), lines.length ? lines : para.create(kept));
      tr.setSelection(Selection.near(tr.doc.resolve($at.before() + 1)));
    } else if (names.length) {
      tr.replaceWith(component.pos, component.pos + 1, state.schema.text(names.join(", ")));
    } else tr.delete(component.pos, component.pos + 1);
    view.dispatch(tr);
    view.focus();
    announce(
      names.length
        ? `The cast is words of the page now: ${names.length} ${names.length === 1 ? "name" : "names"}.`
        : "The cast is taken off the page: no one speaks yet.",
    );
  };

  /** The page's words as the editor holds them, as its file would have them. */
  const bodyNow = useCallback(
    () =>
      editor && !editor.isDestroyed
        ? toMarkdown(editor.getJSON() as DocNode, { emptyLines: true, blankRows: true })
        : "",
    [editor],
  );
  /** Which of the page's blocks holds `target`, or the caret when it holds none. */
  const blockOf = useCallback(
    (target: EventTarget | null): number | null => {
      if (!editor || editor.isDestroyed) return null;
      const { view, state } = editor;
      let el = target instanceof globalThis.Node ? target : null;
      while (el && el.parentNode !== view.dom) el = el.parentNode;
      if (!el) return state.selection.$from.index(0);
      try {
        return state.doc.resolve(view.posAtDOM(el, 0)).index(0);
      } catch {
        return null;
      }
    },
    [editor],
  );
  /** The moved page in the editor, the caret in the block that moved. One step to undo. */
  const applyMove = useCallback(
    (moved: Moved) => {
      if (!editor || editor.isDestroyed) return;
      const { state, view } = editor;
      const next = state.schema.nodeFromJSON(toDoc(moved.text, { pageFile: true }));
      const tr = state.tr.replaceWith(0, state.doc.content.size, next.content);
      let pos = 0;
      const index = Math.min(moved.index, tr.doc.childCount - 1);
      for (let i = 0; i < index; i++) pos += tr.doc.child(i).nodeSize;
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))));
      view.dispatch(tr);
      const now = Date.now();
      takeFocusFromPress(view as unknown as PressFocusView, now, now);
      view.focus();
      // A line that is one field takes the caret into the field, as it had it.
      if (editable) settleIntoField(view);
      announce(placeSaid(moved));
    },
    [editor, editable],
  );
  /** Whether the block at `index` is one that moves: a paragraph or a heading. */
  const moves = useCallback(
    (index: number | null): index is number => {
      if (index === null || !editor || editor.isDestroyed) return false;
      const node = index < editor.state.doc.childCount ? editor.state.doc.child(index) : null;
      return node?.type.name === "paragraph" || node?.type.name === "heading";
    },
    [editor],
  );
  const moveBy = useCallback(
    (step: MoveStep, target: EventTarget | null) => {
      const index = blockOf(target);
      if (!placer.current || !moves(index)) return;
      const moved = placer.current.step(bodyNow(), index, step);
      if (moved) applyMove(moved);
      else announce("It cannot move further that way.");
    },
    [blockOf, moves, bodyNow, applyMove],
  );

  /** Where the handle of the block at `index` stands: just left of its words. */
  const gripFor = useCallback(
    (index: number | null) => {
      const host = box.current;
      if (!host || !placer.current || !moves(index) || !editor) return null;
      let pos = 0;
      for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
      const el = editor.view.nodeDOM(pos);
      if (!(el instanceof HTMLElement)) return null;
      const range = document.createRange();
      range.selectNodeContents(el);
      const words = range.getBoundingClientRect();
      const block = el.getBoundingClientRect();
      const from = host.getBoundingClientRect();
      const left = (words.width ? words.left : block.left) - from.left;
      return { index, top: block.top - from.top, left };
    },
    [editor, moves],
  );
  // With no pointer over the page, the handle is the caret's block's: a
  // finger has no hover, and the keys move that block.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !placing) return;
    const follow = () => {
      if (drag.current) return;
      setGrip(gripFor(editor.state.selection.$from.index(0)));
    };
    editor.on("selectionUpdate", follow);
    editor.on("update", follow);
    return () => {
      editor.off("selectionUpdate", follow);
      editor.off("update", follow);
    };
  }, [editor, placing, gripFor]);
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!placing || drag.current || !editor || editor.isDestroyed) return;
    if (!(event.target instanceof Element) || event.target.closest(".pageblock-grip")) return;
    // The block whose rows the pointer is on; of two side by side, the nearer.
    const { view } = editor;
    let best: { index: number; apart: number } | null = null;
    let index = 0;
    view.state.doc.forEach((_node, pos) => {
      const el = view.nodeDOM(pos);
      if (el instanceof HTMLElement && moves(index)) {
        const rows = el.getBoundingClientRect();
        if (event.clientY >= rows.top && event.clientY < rows.bottom) {
          // By its words, not its box: a line at the left is as wide as the sheet.
          const range = document.createRange();
          range.selectNodeContents(el);
          const words = range.getBoundingClientRect();
          const r = words.width ? words : rows;
          const apart =
            event.clientX < r.left
              ? r.left - event.clientX
              : event.clientX > r.right
                ? event.clientX - r.right
                : 0;
          if (!best || apart < best.apart) best = { index, apart };
        }
      }
      index += 1;
    });
    const found = best as { index: number; apart: number } | null;
    if (found && found.index !== grip?.index) setGrip(gripFor(found.index));
  };
  const endDrag = (apply: boolean) => {
    const held = drag.current;
    drag.current = null;
    setGhost(null);
    if (apply && held?.moved) applyMove(held.moved);
  };
  const onGripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!placing || !grip || !editor || editor.isDestroyed || event.button > 0) return;
    const body = bodyNow();
    const all = placing.spots(body);
    const self = all.spots.find((spot) => spot.index === grip.index && spot.movable);
    const root = editor.view.dom as HTMLElement;
    const line = Number.parseFloat(getComputedStyle(root).lineHeight);
    if (!self || !line) return;
    event.preventDefault();
    // Held by the handle wherever the pointer goes; a pointer that is not a
    // device's own cannot be held, and its events come to the handle anyway.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not a pointer the system knows.
    }
    // A cell is the advance of the page's own type, measured beside the
    // page's words and never among them.
    const probe = document.createElement("span");
    probe.textContent = "0000000000";
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    (box.current ?? root).appendChild(probe);
    const cell = probe.getBoundingClientRect().width / 10;
    probe.remove();
    drag.current = {
      index: grip.index,
      body,
      self,
      cells: all.grid.cells,
      x: event.clientX,
      y: event.clientY,
      line,
      cell: cell || line / 2,
      asked: "",
      moved: null,
    };
    setGhost({ row: self.row, cell: self.cell, width: self.width, height: self.height });
  };
  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held || !placing) return;
    const row = held.self.row + (event.clientY - held.y) / held.line;
    const across = (event.clientX - held.x) / held.cell;
    const to: MoveTo = { row };
    // A drag that stays in its column moves the block down the page only;
    // near the middle of the sheet it is centered, and at an edge set there.
    if (Math.abs(across) >= 0.75) {
      const at = held.self.cell + across;
      if (Math.abs(at + held.self.width / 2 - held.cells / 2) <= 1.25) to.align = "center";
      else to.cell = at;
    }
    const asked = `${Math.round(row)}:${to.align ?? (to.cell === undefined ? "" : Math.round(to.cell))}`;
    if (asked === held.asked) return;
    held.asked = asked;
    const moved = placing.move(held.body, held.index, to);
    if (!moved) return;
    held.moved = moved;
    setGhost({
      row: moved.row,
      cell: moved.cell,
      width: held.self.width,
      height: held.self.height,
    });
  };
  // The caret at the paragraph asked for, set and focused in two plain steps:
  // the editor's chained focus sent its selection a frame late, and a page
  // whose words arrived in that frame met it as a transaction for a document
  // it no longer held (WebKit stopped on it).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new request, or the editor arriving, is the cause
  useEffect(() => {
    if (!editor || editor.isDestroyed || !focusAt) return;
    const { state, view } = editor;
    const doc = state.doc;
    const index = Math.max(0, Math.min(focusAt.paragraph, doc.childCount - 1));
    let pos = 0;
    for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
    const selection = Selection.near(doc.resolve(Math.min(pos + 1, doc.content.size)));
    view.dispatch(state.tr.setSelection(selection).scrollIntoView());
    // Taken as a press's focus is (docs/app/writing/editor-ux.md#EDIT-211):
    // ProseMirror looks at the page 20 ms after a focus and writes its own
    // caret over any it has not read yet, so a key pressed in that moment
    // (⌘→ to the end of the page's first line) was undone.
    const now = Date.now();
    takeFocusFromPress(view as unknown as PressFocusView, now, now);
    view.focus();
    // Opened at its top, the page shows the top of its sheet too.
    const caret = view.coordsAtPos(view.state.selection.head).top;
    const head = index === 0 ? box.current?.parentElement?.getBoundingClientRect().top : undefined;
    reveal(caret, head, barHost, view.dom as HTMLElement);
    if (!editable) return;
    // The field the writer pressed on the sheet takes the caret with the page.
    let found: number | null = null;
    if (openField)
      doc.descendants((node, at) => {
        if (found === null && node.type.name === FIELD_NODE && node.attrs.name === openField)
          found = at;
        return found === null;
      });
    // A caret beside a field that is its whole line is a caret in the field.
    if (found === null || !enterField(view, found, "end")) settleIntoField(view);
  }, [editor, focusAt]);
  /**
   * The keys that go to a document's start or end (⌘↑ ⌘↓ on a Mac, with ⇧
   * to select, and ⇧Home ⇧End; Ctrl+Home and Ctrl+End on a PC) go to the
   * page's: left to the browser they went to the script's, which the page
   * stands inside, and the next keys typed went there.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed) return;
    if (!(event.target instanceof Node) || !box.current?.contains(event.target)) return;
    const pc = keyStyle() === "pc";
    // Esc lets go of a block being dragged, where it was.
    if (drag.current && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      endDrag(false);
      return;
    }
    // Return on a component opens what can be set on it: left to the page,
    // Return would write a new line over the component.
    if (component && event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      componentMenu.openFrom(componentBtn.current);
      return;
    }
    // The keys that move the block the caret is in, a field's own included.
    const step = STEPS.find((each) => each.key === event.key)?.step;
    const moving = pc
      ? event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
      : event.ctrlKey && event.metaKey && !event.altKey && !event.shiftKey;
    if (placing && step && moving) {
      event.preventDefault();
      event.stopPropagation();
      moveBy(step, event.target);
      return;
    }
    // A key in a field's own words is the field's.
    if (fieldTextOf(event.target)) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const toEnd = pc
      ? event.ctrlKey && !event.metaKey && event.key === "End"
      : (event.metaKey && !event.ctrlKey && event.key === "ArrowDown") ||
        (plain && event.shiftKey && event.key === "End");
    const toStart = pc
      ? event.ctrlKey && !event.metaKey && event.key === "Home"
      : (event.metaKey && !event.ctrlKey && event.key === "ArrowUp") ||
        (plain && event.shiftKey && event.key === "Home");
    if (!toEnd && !toStart) return;
    event.preventDefault();
    event.stopPropagation();
    const { state, view } = editor;
    const target = toEnd ? Selection.atEnd(state.doc) : Selection.atStart(state.doc);
    const selection = event.shiftKey
      ? TextSelection.between(state.selection.$anchor, target.$head)
      : target;
    view.dispatch(state.tr.setSelection(selection).scrollIntoView());
  };
  const setting = sheet
    ? ({
        "--page-top-rows": sheet.topRows,
        "--page-gap-rows": sheet.gapRows,
        "--page-heading-weight": weightOf(sheet.heading),
        "--page-heading-slant": slantOf(sheet.heading),
        "--page-body-weight": weightOf(sheet.body),
        "--page-body-slant": slantOf(sheet.body),
        "--page-title-weight": weightOf(sheet.titleStyle),
        "--page-title-slant": slantOf(sheet.titleStyle),
      } as CSSProperties)
    : undefined;
  const bar = (
    <>
      {name && (
        <span className="frontedit-bar__name" title={name}>
          {name}
        </span>
      )}
      <FormatBar editor={editor} openingPage />
      {(onChangeTemplate || onRemove || onDone) && <span className="frontedit-bar__spacer" />}
      {placing && editor && (
        <MoveMenu
          disabled={!moves(editor.state.selection.$from.index(0))}
          onStep={(step) => {
            editor.view.focus();
            moveBy(step, null);
          }}
        />
      )}
      {/* Any page can be taken out of the play, where it is written
          (docs/app/formatting/formats-and-layout.md#FMT-183): the toast that
          follows puts it back. */}
      {onRemove && (
        <IconButton label={`${moveToTrash()}: ${name ?? "this page"}`} onClick={onRemove}>
          <TrashIcon size={14} />
        </IconButton>
      )}
      {onChangeTemplate && <Button onClick={onChangeTemplate}>Change Template…</Button>}
      {onDone && (
        <Button treatment="primary" onClick={onDone}>
          Done
        </Button>
      )}
    </>
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the page's own start and end keys, taken before the script's
    <div
      ref={box}
      className={`frontpage-editor${sheet ? " frontpage-editor--sheet" : ""}${sheet?.title ? " frontpage-editor--title" : ""}`}
      role="group"
      aria-label={label}
      style={setting}
      onKeyDownCapture={onKeyDown}
      onPointerMove={placing ? onPointerMove : undefined}
    >
      {barHost ? createPortal(bar, barHost) : bar}
      {/* What the detail under the caret is, and what else shows it: said
          at the work, under the field, in place of a form that listed them all. */}
      {activeField && helpFor(activeField.name) && (
        <FieldNote at={activeField.at} bar={barHost ?? null}>
          {helpFor(activeField.name)}
        </FieldNote>
      )}
      {component && (
        <>
          <button
            ref={componentBtn}
            type="button"
            className="pagecomponent-btn"
            style={{ top: component.top, left: component.left }}
            aria-label={`${FIELD_LABEL[component.name]} settings`}
            title={`${FIELD_LABEL[component.name]} settings`}
            aria-haspopup="menu"
            aria-expanded={componentMenu.open}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => componentMenu.openFrom(componentBtn.current)}
          >
            <ChevronDownIcon size={10} />
          </button>
          {componentMenu.anchor && (
            <Menu
              anchor={componentMenu.anchor}
              label={`${FIELD_LABEL[component.name]} settings`}
              width={230}
              onClose={componentMenu.close}
              entries={
                component.name === "contents"
                  ? [
                      {
                        id: "acts",
                        label: "Page Numbers on Acts",
                        checked: readFieldOptions(component.options).acts !== "plain",
                        onSelect: () =>
                          setOption(
                            "acts",
                            readFieldOptions(component.options).acts === "plain" ? null : "plain",
                          ),
                      },
                    ]
                  : [{ id: "text", label: "Turn into Text", onSelect: castIntoText }]
              }
            />
          )}
        </>
      )}
      {placing && grip && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the pointer's way to move a block; the keys and the Move menu are the keyboard's
        <div
          className={`pageblock-grip${ghost ? " pageblock-grip--held" : ""}`}
          style={{ top: grip.top, left: grip.left }}
          aria-hidden="true"
          title={`Drag to move. ${moveChord("↑")} and the other arrows move it too.`}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
        >
          <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden="true">
            <title>Move</title>
            {[2, 7, 12].flatMap((y) =>
              [2, 6].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" />),
            )}
          </svg>
        </div>
      )}
      {ghost && editor && !editor.isDestroyed && (
        <GhostBox
          ghost={ghost}
          drag={drag.current}
          root={editor.view.dom as HTMLElement}
          host={box.current}
        />
      )}
      <ProseEditor
        markdown={value}
        onChange={onChange}
        onReady={setEditor}
        pageFile={pageFile}
        onBlur={onBlur}
      />
    </div>
  );
}

/** The outline of a block being dragged, drawn where it would stand on the sheet. */
function GhostBox({
  ghost,
  drag,
  root,
  host,
}: {
  ghost: Ghost;
  drag: { line: number; cell: number } | null;
  root: HTMLElement;
  host: HTMLElement | null;
}) {
  if (!drag || !host) return null;
  const sheet = root.getBoundingClientRect();
  const from = host.getBoundingClientRect();
  return (
    <div
      className="pageblock-ghost"
      aria-hidden="true"
      style={{
        top: sheet.top - from.top + ghost.row * drag.line,
        left: sheet.left - from.left + ghost.cell * drag.cell,
        width: Math.max(1, ghost.width) * drag.cell,
        height: ghost.height * drag.line,
      }}
    />
  );
}

/**
 * Move: the block the caret is in, a row up or down or a cell left or right,
 * each with the keys that do the same. A press leaves the caret where it was.
 */
function MoveMenu({ disabled, onStep }: { disabled: boolean; onStep: (step: MoveStep) => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="popupbtn"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => menu.openFrom(ref.current)}
        onKeyDown={(e) => {
          // ↓ and ↑ open a pull-down, as they do a native one.
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            menu.openFrom(ref.current);
          }
        }}
      >
        <span className="popupbtn__label">Move</span>
        <span className="popupbtn__badge" aria-hidden="true">
          <ChevronDownIcon size={9} />
        </span>
      </button>
      {menu.anchor && (
        <Menu
          anchor={menu.anchor}
          label="Move"
          width={210}
          onClose={menu.close}
          entries={STEPS.map((each) => ({
            id: each.step,
            label: each.label,
            hint: moveChord(each.arrow),
            onSelect: () => onStep(each.step),
          }))}
        />
      )}
    </>
  );
}
