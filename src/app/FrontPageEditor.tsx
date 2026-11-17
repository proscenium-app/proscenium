// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { ProseEditor } from "../markdown/ProseEditor";
import { FormatBar } from "../markdown/FormatBar";
import { toMarkdown, type Node } from "../markdown/doc";
import type { FrontMatter } from "../fountain";
import type { NotesSheetKind } from "../editor";
import { openingParagraphs } from "../layout";

export { charactersPageText } from "../markdown/characters-page";

/** Whether a page's Markdown holds a word that would print; one that holds none prints no page. */
export function printsProse(markdown: string | undefined): boolean {
  return !!markdown?.trim() && openingParagraphs(markdown).some((p) => p.text.trim());
}

/**
 * Which top-level block of a notes page's text holds the printed paragraph a
 * writer double-clicked (docs/app/formatting/formats-and-layout.md#FMT-161).
 * `text` is what the page's editor opens on. The engine names a paragraph of
 * written notes by its place among the text's paragraphs (`production-prose-2`);
 * opening notes still printed from the Setting, Time and Place fields are a
 * heading and a paragraph each in the editor, in that order. Anything else,
 * the page's own heading or a click between lines, is the top of the text.
 */
export function notesBlock(
  kind: NotesSheetKind,
  paragraphId: string | null,
  text: string,
  fm: FrontMatter,
): number {
  const id = paragraphId ?? "";
  const prose = /^(setting|production)-prose-(\d+)$/.exec(id);
  if (prose?.[1] === kind) return openingParagraphs(text)[Number(prose[2])]?.block ?? 0;
  const field = /^(SETTING|TIME|PLACE)(-heading)?$/.exec(id);
  if (kind === "setting" && fm.openingNotes === undefined && field) {
    const at = (
      [
        ["SETTING", fm.setting],
        ["TIME", fm.time],
        ["PLACE", fm.place],
      ] as const
    )
      .filter(([, value]) => value?.trim())
      .findIndex(([label]) => label === field[1]);
    if (at >= 0) return at * 2 + (field[2] ? 0 : 1);
  }
  return 0;
}

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
  barHost,
}: {
  value: string;
  onChange: (text: string) => void;
  label: string;
  /** Put the caret at the start of this top-level paragraph; a new object asks again. */
  focusAt?: { paragraph: number } | null;
  /** Where the formatting bar stands, when not over the text: the top of the script, for a page edited there. */
  barHost?: HTMLElement | null;
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
      {barHost ? (
        createPortal(<FormatBar editor={editor} openingPage />, barHost)
      ) : (
        <FormatBar editor={editor} openingPage />
      )}
      <ProseEditor markdown={value} onChange={onChange} onReady={setEditor} />
    </div>
  );
}
