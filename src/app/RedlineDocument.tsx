// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A change to a document, read on the document's own page
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-177): a note, a
 * character sheet or an outline, as the sheet it is written on draws it, with
 * headings, lists and emphasis, cut words struck through and added ones
 * underlined. Its Markdown is never on show; Line by Line shows the file.
 *
 * It is the document's own editor, read-only, on a document made for the
 * purpose (review/document-redline.ts), on the play's page: the format's page
 * width and margins, drawn smaller when the pane is narrower than the page.
 * Details kept above the text (a sheet's front matter) are not part of the
 * page; when they changed, it says so.
 */
import { Extension, Mark, Node as TipTapNode } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatCssVars, type FormatSpec } from "../format";
import { PROSE_EXTENSIONS } from "../markdown/ProseEditor";
import {
  REDLINE_ADD,
  REDLINE_DEL,
  REDLINE_SKIP,
  documentRedline,
} from "../review/document-redline";
import { split } from "../workspace/front-matter";

const EMPTY = { type: "doc", content: [{ type: "paragraph" }] };

/** Added words: `<ins>`, said to a screen reader as well as shown. */
const Add = Mark.create({
  name: REDLINE_ADD,
  parseHTML: () => [{ tag: "ins" }],
  renderHTML: () => ["ins", { class: "redline-add" }, 0],
});

/** Cut words: `<del>`. */
const Del = Mark.create({
  name: REDLINE_DEL,
  parseHTML: () => [{ tag: "del" }],
  renderHTML: () => ["del", { class: "redline-del" }, 0],
});

/** Where unchanged elements were left out: a rule that says how many. */
const Skip = TipTapNode.create({
  name: REDLINE_SKIP,
  group: "block",
  atom: true,
  selectable: false,
  addAttributes: () => ({ count: { default: 0 } }),
  parseHTML: () => [{ tag: "div[data-redline-skip]" }],
  renderHTML: ({ node }) => {
    const count = Number(node.attrs.count);
    return [
      "div",
      {
        "data-redline-skip": "",
        class: "redline-skip",
        contenteditable: "false",
        role: "separator",
        "aria-label": `${count} unchanged ${count === 1 ? "element" : "elements"} not shown`,
      },
      ["span", { class: "redline-skip__dots", "aria-hidden": "true" }, "⋯"],
    ];
  },
});

/** What happened to an element, on the element: the rule in the margin is drawn from it. */
const Changed = Extension.create({
  name: "documentRedline",
  addGlobalAttributes: () => [
    {
      types: ["paragraph", "heading", "codeBlock", "horizontalRule", "table"],
      attributes: {
        redline: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-redline"),
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs.redline ? { "data-redline": attrs.redline } : {},
        },
      },
    },
  ],
});

export function RedlineDocument({
  before,
  after,
  format,
  label,
}: {
  before: string;
  after: string;
  format: FormatSpec;
  /** What this is a comparison of, for the page's name. */
  label: string;
}) {
  const { redline, details } = useMemo(() => {
    const was = split(before);
    const is = split(after);
    return {
      redline: documentRedline(was.body, is.body),
      details: (was.header ?? "") !== (is.header ?? ""),
    };
  }, [before, after]);
  const editor = useEditor({
    extensions: [...PROSE_EXTENSIONS, Add, Del, Skip, Changed],
    editable: false,
    content: redline.doc ?? EMPTY,
    editorProps: { attributes: { class: "prose", spellcheck: "false" } },
  });
  useEffect(() => {
    // A page taken away as it was drawn is destroyed before its effects run.
    if (!editor || editor.isDestroyed) return;
    editor.commands.setContent(redline.doc ?? EMPTY, { emitUpdate: false });
  }, [editor, redline]);

  const vars = useMemo(() => formatCssVars(format) as CSSProperties, [format]);

  // As wide as the page, or as much smaller as the pane makes it.
  const frame = useRef<HTMLDivElement | null>(null);
  const measure = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const solve = () => {
      const natural = measure.current?.getBoundingClientRect().width ?? 0;
      const room = el.clientWidth - 1;
      if (natural > 0 && room > 0) setZoom(Math.min(1, Math.floor((room / natural) * 100) / 100));
    };
    solve();
    const observer = new ResizeObserver(solve);
    observer.observe(el);
    // Observers are silent in a window that is not being painted.
    window.addEventListener("resize", solve);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", solve);
    };
  }, [format]);

  return (
    <div className="redline redline--document" style={vars} ref={frame}>
      <div className="redline__measure redline__measure--page" ref={measure} aria-hidden="true" />
      {details && (
        <p className="changes__hint redline__note">
          The details at the top changed as well. Line by Line shows them.
        </p>
      )}
      {redline.doc ? (
        <div
          className="material__page redline__doc"
          role="group"
          aria-label={label}
          style={{ zoom } as CSSProperties}
        >
          <EditorContent editor={editor} className="prose-host" />
        </div>
      ) : (
        !details && (
          <p className="changes__hint redline__note">
            No line of it reads differently. Line by Line shows what changed in the file.
          </p>
        )
      )}
    </div>
  );
}
