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
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { Extension, Node as TipTapNode } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { toDoc, toMarkdown, type Node } from "./doc";
import { emit, loaded, proseSync, propArrived } from "./prose-sync";

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
    addGlobalAttributes: () => [{ types: ["paragraph", "heading"], attributes: { textAlign: {
      default: null,
      parseHTML: (el: HTMLElement) => ["center", "right"].includes(el.style.textAlign) ? el.style.textAlign : null,
      renderHTML: (attrs: Record<string, unknown>) => ["center", "right"].includes(String(attrs.textAlign)) ? { style: `text-align: ${attrs.textAlign}` } : {},
    } } }],
  }),
  TipTapNode.create({
    name: "managedMarker", group: "block", atom: true, selectable: false,
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
  }),
  Table.configure({ resizable: false }),
  TableRow,
  aligned(TableHeader),
  aligned(TableCell),
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
}

export function ProseEditor({
  markdown,
  onChange,
  onBlur,
  onReady,
  editable = true,
}: ProseEditorProps) {
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
  const sync = useRef(proseSync(markdown, toMarkdown(toDoc(markdown))));
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

  const editor = useEditor({
    extensions: PROSE_EXTENSIONS,
    editable,
    content: toDoc(markdown) as never,
    editorProps: {
      attributes: {
        class: "prose",
        spellcheck: "true",
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
      const next = toMarkdown(ed.getJSON() as Node);
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
    editor.commands.setContent(toDoc(markdown) as never, { emitUpdate: false });
    loaded(sync.current, toMarkdown(editor.getJSON() as Node));
  }, [editor, markdown]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return <EditorContent editor={editor} className="prose-host" />;
}
