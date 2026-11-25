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
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { Selection, TextSelection } from "@tiptap/pm/state";
import { Button } from "../ui";
import { keyStyle } from "../ui/keys";
import { takeFocusFromPress, type PressFocusView } from "../ui/caret-on-focus";
import { ProseEditor } from "../markdown/ProseEditor";
import { FormatBar } from "../markdown/FormatBar";
import { FIELD_NODE, type FieldEditRequest } from "../markdown/page-file-nodes";
import type { FieldName } from "../markdown/page-fields";
import type { Field } from "../layout";
import { FieldPopover } from "./FieldPopover";
import { DETAIL_OF, type Detail } from "./play-details";

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

/** The play's details, as a field of the page reads and writes them. */
export interface DetailsAccess {
  text: (detail: Detail) => string;
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
  onPlayDetails,
  details,
  openField,
  sheet,
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
  /** Opens Play Details…, where every detail a field shows is listed. */
  onPlayDetails?: () => void;
  /** The play's details: given, a field is where its detail is edited. */
  details?: DetailsAccess;
  /** A field to open as the editor does: the one the writer pressed on the sheet. */
  openField?: FieldName | null;
  /** Set the page as it prints. */
  sheet?: SheetSetting;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [fieldEdit, setFieldEdit] = useState<(FieldEditRequest & { n: number }) | null>(null);
  const asked = useRef(0);
  const editable = !!details;
  const onEditField = useCallback(
    (request: FieldEditRequest) => setFieldEdit({ ...request, n: ++asked.current }),
    [],
  );
  // A page file's editor shows its fields as the facts they hold, kept current
  // as the play's details change.
  const pageFile = useMemo(
    () => (fields ? { values: fields, ...(editable ? { onEditField } : {}) } : undefined),
    [fields, editable, onEditField],
  );
  const box = useRef<HTMLDivElement | null>(null);
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
    // The field the writer pressed on the sheet opens with the page.
    if (!openField || !editable) return;
    let found: number | null = null;
    doc.descendants((node, at) => {
      if (found === null && node.type.name === FIELD_NODE && node.attrs.name === openField)
        found = at;
      return found === null;
    });
    const dom = found === null ? null : view.nodeDOM(found);
    if (dom instanceof HTMLElement) onEditField({ name: openField, dom });
  }, [editor, focusAt]);
  /**
   * The keys that go to a document's start or end (⌘↑ ⌘↓ on a Mac, with ⇧
   * to select, and ⇧Home ⇧End; Ctrl+Home and Ctrl+End on a PC) go to the
   * page's: left to the browser they went to the script's, which the page
   * stands inside, and the next keys typed went there.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editor || editor.isDestroyed) return;
    // A key in a detail's own editor, which stands outside the page, is not the page's.
    if (!(event.target instanceof Node) || !box.current?.contains(event.target)) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const pc = keyStyle() === "pc";
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
      {(onPlayDetails || onDone) && <span className="frontedit-bar__spacer" />}
      {onPlayDetails && <Button onClick={onPlayDetails}>Play Details…</Button>}
      {onDone && (
        <Button treatment="primary" onClick={onDone}>
          Done
        </Button>
      )}
    </>
  );
  const detail = fieldEdit ? DETAIL_OF[fieldEdit.name] : null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the page's own start and end keys, taken before the script's
    <div
      ref={box}
      className={`frontpage-editor${sheet ? " frontpage-editor--sheet" : ""}${sheet?.title ? " frontpage-editor--title" : ""}`}
      role="group"
      aria-label={label}
      style={setting}
      onKeyDownCapture={onKeyDown}
    >
      {barHost ? createPortal(bar, barHost) : bar}
      <ProseEditor
        markdown={value}
        onChange={onChange}
        onReady={setEditor}
        pageFile={pageFile}
        onBlur={onBlur}
      />
      {fieldEdit && detail && details && (
        <FieldPopover
          key={fieldEdit.n}
          detail={detail}
          value={details.text(detail)}
          seed={fieldEdit.seed}
          anchor={fieldEdit.dom}
          onCommit={(text) => details.set(detail, text)}
          onClose={() => {
            setFieldEdit(null);
            // Back to the page, the caret where it was.
            if (editor && !editor.isDestroyed) editor.view.focus();
          }}
        />
      )}
    </div>
  );
}
