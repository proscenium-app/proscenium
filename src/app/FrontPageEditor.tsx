// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { ProseEditor } from "../markdown/ProseEditor";
import { FormatBar } from "../markdown/FormatBar";
import { toMarkdown, type Node } from "../markdown/doc";
import type { FrontMatter } from "../fountain";

export { charactersPageText } from "../markdown/characters-page";

function proseText(text: string): Node[] {
  return text
    .split("\n")
    .flatMap((line, i) => [
      ...(i ? [{ type: "hardBreak" }] : []),
      ...(line ? [{ type: "text", text: line }] : []),
    ]);
}

export function openingNotesText(fm: FrontMatter): string {
  return (
    fm.openingNotes ??
    toMarkdown({
      type: "doc",
      content: [
        ["Setting", fm.setting],
        ["Time", fm.time],
        ["Place", fm.place],
      ]
        .filter(([, text]) => text?.trim())
        .flatMap(([label, text]): Node[] => [
          { type: "heading", attrs: { level: 2 }, content: proseText(label!) },
          { type: "paragraph", content: proseText(text!) },
        ]),
    })
  );
}

export function titlePageText(fm: FrontMatter): string {
  return (
    fm.titlePage ??
    toMarkdown({
      type: "doc",
      content: [
        ...(fm.title
          ? [
              {
                type: "heading",
                attrs: { level: 1, textAlign: "center" },
                content: proseText(fm.title),
              },
            ]
          : []),
        ...[
          fm.credit ?? "",
          (fm.authors ?? []).join(", "),
          (fm.contact ?? []).join("\n"),
          fm.draftDate ?? "",
        ]
          .filter(Boolean)
          .map(
            (text): Node => ({
              type: "paragraph",
              attrs: { textAlign: "center" },
              content: proseText(text),
            }),
          ),
      ],
    })
  );
}

/** Familiar prose controls; print layout remains the shared paginator's job. */
export function FrontPageEditor({
  value,
  onChange,
  label,
  focusAt,
}: {
  value: string;
  onChange: (text: string) => void;
  label: string;
  /** Put the caret at the start of this top-level paragraph; a new object asks again. */
  focusAt?: { paragraph: number } | null;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  useEffect(() => {
    if (!editor || !focusAt) return;
    const doc = editor.state.doc;
    const index = Math.max(0, Math.min(focusAt.paragraph, doc.childCount - 1));
    let pos = 0;
    for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
    editor
      .chain()
      .focus(pos + 1)
      .scrollIntoView()
      .run();
  }, [editor, focusAt]);
  return (
    <div className="frontpage-editor" role="group" aria-label={label}>
      <FormatBar editor={editor} openingPage />
      <ProseEditor markdown={value} onChange={onChange} onReady={setEditor} />
    </div>
  );
}
