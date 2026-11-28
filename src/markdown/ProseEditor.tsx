// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The prose editing surface for Markdown materials — a page you type on, not a
 * source file you look at. Notes, character sheets and research are edited the
 * way the rest of the world edits a document; Markdown remains what is on disk.
 *
 * The bridge (doc.ts) is what makes that safe, and it is the reason this file
 * is small: TipTap holds a ProseMirror document, doc.ts turns the file into one
 * on open and back into Markdown on save, and NOTHING here knows the syntax.
 *
 * Two rules this surface must keep:
 *
 *  1. **Never write without an edit.** Serializing normalizes formatting, so a
 *     save the writer didn't cause would reformat a file nobody touched — a
 *     change with no author, in a watched tree. `onChange` fires only from a
 *     real transaction, and the caller compares before writing.
 *  2. **Never re-seed a dirty buffer.** An external change arriving mid-sentence
 *     is the watcher's decision to make, not this one's.
 *
 * A page before the script is a page file (`pageFile`): its field tokens are
 * drawn as fields and its foot mark as a rule (page-file-nodes.ts).
 */
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Extension, Node as TipTapNode } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { CaretOnFocus } from "../ui/caret-on-focus";
import { PendingSelection } from "../ui/pending-selection";
import { FormatInput } from "../ui/format-input";
import { BarPress } from "./bar-press";
import { DocumentCaret } from "./caret";
import { toDoc, toMarkdown, type Node } from "./doc";
import { DocumentLists } from "./lists";
import { pageFileExtensions, setFieldValues, type FieldWriter } from "./page-file-nodes";
import type { FieldValues } from "./page-fields";
import { paperClick } from "./paper-click";
import { ProseCheckerContext } from "./prose-checker";
import { emit, loaded, proseSync, propArrived } from "./prose-sync";
import { systemSpelling } from "../ui/system-traits";

/**
 * Column alignment is part of the table, so the cells have to carry it: the
 * source says `|:---:|` and the file has to say it again on the way out.
 * TipTap's cells have no such attribute of their own.
 */
function aligned(cell: TipTapNode): TipTapNode {
  return cell.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        align: {
          default: null,
          parseHTML: (el: HTMLElement) => el.style.textAlign || null,
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs.align ? { style: `text-align: ${attrs.align as string}` } : {},
        },
      };
    },
  });
}

/** Exported for the tests that build this editor's schema without a DOM. */
export const PROSE_EXTENSIONS = [
  Extension.create({
    name: "paragraphAlignment",
    addGlobalAttributes: () => [
      {
        types: ["paragraph", "heading"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (el: HTMLElement) =>
              ["center", "right"].includes(el.style.textAlign) ? el.style.textAlign : null,
            renderHTML: (attrs: Record<string, unknown>) =>
              ["center", "right"].includes(String(attrs.textAlign))
                ? { style: `text-align: ${attrs.textAlign}` }
                : {},
          },
        },
      },
    ],
  }),
  TipTapNode.create({
    name: "managedMarker",
    group: "block",
    atom: true,
    selectable: false,
    addAttributes: () => ({ source: { default: "" } }),
    parseHTML: () => [{ tag: "div[data-managed-marker]" }],
    renderHTML: () => ["div", { "data-managed-marker": "", hidden: "", "aria-hidden": "true" }],
  }),
  StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
    link: { openOnClick: false, autolink: false },
    /**
     * Off, deliberately. Markdown has no underline, and `~~strike~~` is not in
     * the dialect doc.ts writes — so either mark would apply, look applied, and
     * be silently dropped by the next save. Disabling the extensions kills the
     * input rules (`~~x~~`) and the keyboard shortcuts (⌘U, ⌘⇧S) too, which is
     * the point: there must be no route to a formatting the file cannot hold.
     */
    strike: false,
    underline: false,
    /**
     * A document that ends in a list ends there. The stock rule keeps an empty
     * paragraph after any last block that is not one, so that a table or a code
     * block can be left; a list is left with Return on an empty item, and the
     * spare paragraph under it is where a click below the last item landed:
     * outside the list, on a line that is not in the file.
     */
    trailingNode: { notAfter: ["bulletList", "orderedList"] },
  }),
  DocumentLists,
  DocumentCaret,
  CaretOnFocus,
  // A finger's press on the format bar leaves the caret where it was.
  BarPress,
  // An iPad's ⌘B and ⌘I, and its screen keyboard's B and I, as the format
  // bar's; its ⌘U and U have nothing to run, as the file has no underline. The
  // keys are taken here too, so a press that also comes as the menu's item or
  // the system's format runs once.
  FormatInput(
    {
      bold: (ed) => ed.chain().focus().toggleBold().run(),
      italic: (ed) => ed.chain().focus().toggleItalic().run(),
    },
    { keys: true },
  ),
  Table.configure({ resizable: false }),
  TableRow,
  aligned(TableHeader),
  aligned(TableCell),
  // A click is never undone by an update arriving with it (docs/app/writing/editor-ux.md#EDIT-211).
  PendingSelection,
];

export interface ProseEditorProps {
  /** The material body (front matter already split off). */
  markdown: string;
  /** Fires on a real edit, with the body serialized back to Markdown. */
  onChange: (markdown: string) => void;
  /** Called on blur so leaving the page can't strand a sentence. */
  onBlur?: () => void;
  editable?: boolean;
  /**
   * Receives the editor once, for imperative ops — as PlayEditor does, and as
   * the formatting bar needs. The bar is deliberately NOT rendered here: it is
   * page chrome, and inside this component it would land on the paper, under
   * the sheet's own top margin, competing with the first line of prose.
   */
  onReady?: (editor: Editor) => void;
  /**
   * The text is a page before the script, as a page file holds it
   * (src/layout/page-files.ts): each field token is drawn as a field showing
   * its value from `values` (as the layout's `fieldValue` gives them; `TITLE`
   * falls back to `title` in capitals), and a title page's foot mark as the
   * rule its foot starts under. The formatting bar then offers Insert Field.
   *
   * Whether the text is a page file is read once, as the editor is made: a
   * page file's document holds nodes no other editor has. The values may
   * change at any time; the fields are drawn again where they stand, and
   * nothing is saved for it.
   */
  pageFile?: {
    values: FieldValues;
    /**
     * The page's own way to write a detail of the play where a field shows
     * it (docs/app/formatting/formats-and-layout.md#FMT-180): given, a field's
     * words are written in place. Without it a field only shows its value.
     */
    write?: FieldWriter;
  };
}

export function ProseEditor({
  markdown,
  onChange,
  onBlur,
  onReady,
  editable = true,
  pageFile,
}: ProseEditorProps) {
  /**
   * The page file's own reading, fixed for the editor's life: a document read
   * as a page file and an editor without its nodes would not open at all.
   */
  // The way to write a field is reached through a ref: the editor's
  // extensions are made once, and the writer they call is today's.
  const writer = useRef(pageFile?.write);
  writer.current = pageFile?.write;
  const [page] = useState(() =>
    pageFile
      ? {
          values: pageFile.values,
          write: pageFile.write
            ? ({
                writes: (name) => writer.current?.writes(name) ?? false,
                commit: (name, text) => writer.current?.commit(name, text),
                help: (name) => writer.current?.help?.(name) ?? "",
                onActive: (name, at) => writer.current?.onActive?.(name, at),
              } satisfies FieldWriter)
            : undefined,
        }
      : null,
  );
  const readAs = useMemo(() => ({ pageFile: !!page }), [page]);
  // A page keeps a line that is set and waiting for words; a document does not.
  const writeAs = useMemo(() => ({ emptyLines: !!page, blankRows: !!page }), [page]);
  const values = pageFile?.values;
  /**
   * Which props are this editor's own words coming back (prose-sync.ts): the
   * prop as last seen, the newest Markdown the editor produced, and the
   * emissions its parent has not rendered back yet.
   *
   * The newest Markdown is baselined from the editor's OWN document, not from
   * the file, and that distinction is the whole guard against phantom saves.
   * ProseMirror normalizes on parse, so the first serialization can differ from
   * the bytes on disk without anyone having typed. Comparing against the file
   * called that an edit and wrote it back; comparing against the loaded document
   * calls it what it is — nothing happened.
   */
  const sync = useRef(proseSync(markdown, toMarkdown(toDoc(markdown, readAs), writeAs)));
  /**
   * Whether what the editor reports now is the writer's. Transactions that
   * settle the freshly-parsed document are the editor arranging itself, and
   * folding those into the baseline instead of reporting them is what stops
   * merely OPENING a note from saving it.
   *
   * This used to be "has TipTap emitted `create` yet", and that was a bug with
   * a stopwatch in it. `create`
   * comes a task after the view is mounted (`Editor.mount` ends in
   * `window.setTimeout(…, 0)`), and the view takes keystrokes from the moment
   * it is mounted. On a loaded machine every keystroke in that gap was folded
   * away as settling: the words were on the page, the buffer believed it was
   * clean, and so nothing autosaved them, kept a recovery copy, or counted
   * them as unsaved on the way out (docs/app/keeping-work/storage-and-file-format.md#STOR-104).
   * What the writer did is known from the writer's own events, below, not from
   * how long the editor took to say hello.
   */
  const live = useRef(false);
  /** The writer typed, pasted, dropped or cut: everything after this is theirs. */
  const acted = () => {
    live.current = true;
    return false;
  };

  /**
   * The app's own spell checker, where the system's may not run in a document
   * (prose-checker.ts): its extensions join the page's as the editor is made,
   * and what it draws goes beside the page. Nothing is handed over on a Mac or
   * a PC, and the editor is the one it always was.
   */
  const checker = useContext(ProseCheckerContext);
  const checking = checker?.extensions;
  const extensions = useMemo(() => {
    const own = page
      ? [...PROSE_EXTENSIONS, ...pageFileExtensions(page.values, page.write)]
      : PROSE_EXTENSIONS;
    return checking ? [...own, ...checking] : own;
  }, [checking, page]);

  const editor = useEditor({
    extensions,
    editable,
    content: toDoc(markdown, readAs) as never,
    editorProps: {
      attributes: {
        class: "prose",
        /* The system checks a document's spelling where it may. Where it may
           not (an iPad), spell checking is off, because WebKit turns smart
           quotes and dashes off only there, and the system's Smart
           Punctuation would otherwise rewrite what the writer typed in the
           file's bytes (ui/system-traits.ts). The app's own checker marks the
           words there instead (prose-checker.ts). */
        spellcheck: systemSpelling() ? "true" : "false",
        /* Where the app's own checker marks the words, the system's
           autocorrection is off too, as it is in the script: on an iPad it put
           its own guess in place of an underlined word as the tap on it moved
           the caret away, so the app's corrections never opened, and it knows
           nothing of the cast a character's sheet names. The system's sentence
           capitals stay (docs/app/writing/editor-ux.md#EDIT-194). */
        ...(systemSpelling() ? {} : { autocorrect: "off" }),
        /* macOS's writing suggestions (inline predictive text, on by default)
           deleted letters typed here. In the native self-test's outline notes,
           " Tide turns at the stair." kept "Tide ns at the stair.": at the key
           after "tur", WebKit sent deleteCompositionText for a composition the
           page never saw start, and took the three letters with it. WebKit
           offers suggestions in a contenteditable even though the web view's
           configuration leaves inline predictions off. With this attribute
           the same run keeps every letter. PlayEditor turns them off too. */
        writingsuggestions: "false",
      },
      /**
       * Every route the writer has into a document the editor has not finished
       * arranging yet. ProseMirror runs these before its own handler for the
       * same event, so the flag is set before the transaction the event causes
       * is dispatched. Each returns false, so ProseMirror goes on to handle the
       * event as it always did. The page chrome cannot reach the document in
       * that window at all: it is handed the editor by `onReady`, which is
       * `create`.
       */
      handleClick: paperClick,
      handleDOMEvents: {
        keydown: acted,
        beforeinput: acted,
        compositionstart: acted,
        paste: acted,
        cut: acted,
        drop: acted,
      },
    },
    onCreate({ editor: ed }) {
      live.current = true;
      onReady?.(ed);
    },
    onUpdate({ editor: ed }) {
      const next = toMarkdown(ed.getJSON() as Node, writeAs);
      if (!live.current) {
        loaded(sync.current, next);
        return;
      }
      if (next === sync.current.last) return;
      emit(sync.current, next);
      onChange(next);
    },
    onBlur() {
      onBlur?.();
    },
  });

  // A different material opened, or the store adopted an external change on a
  // clean buffer. Either way the document is replaced wholesale — but never for
  // our own words arriving back as a new prop, however late (prose-sync.ts).
  // A layout effect, so it runs in the commit that rendered the prop: a passive
  // one ran after paint, when WebKit had already handed ProseMirror the next
  // keystrokes, and the prop it compared was already old.
  useLayoutEffect(() => {
    if (!editor || propArrived(sync.current, markdown) !== "replace") return;
    editor.commands.setContent(toDoc(markdown, readAs) as never, { emitUpdate: false });
    loaded(sync.current, toMarkdown(editor.getJSON() as Node, writeAs));
  }, [editor, markdown, readAs, writeAs]);

  // The play's details changed elsewhere: each field shows its new value where
  // it stands, the caret where it was. No word changed, so nothing is saved.
  useLayoutEffect(() => {
    if (editor && page && values) setFieldValues(editor, values);
  }, [editor, page, values]);

  useEffect(() => {
    // Editable or not changes no word: no update for it.
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  return (
    <>
      <EditorContent editor={editor} className="prose-host" />
      {editor && checker?.beside(editor)}
    </>
  );
}
