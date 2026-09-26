// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { ProseEditor } from "../markdown/ProseEditor";
import { FormatBar } from "../markdown/FormatBar";
import { toMarkdown, type Node } from "../markdown/doc";
import type { CharacterEntry, FrontMatter } from "../fountain";

export function charactersPageText(characters: readonly CharacterEntry[]): string {
  return toMarkdown({ type: "doc", content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Characters" }] },
    ...characters.map((c): Node => ({ type: "paragraph", content: [
      { type: "text", text: c.name, marks: [{ type: "bold" }] },
      ...(c.description ? [{ type: "text", text: " — " + c.description }] : []),
    ] })),
  ] });
}

function proseText(text: string): Node[] {
  return text.split("\n").flatMap((line, i) => [...(i ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]);
}

export function openingNotesText(fm: FrontMatter): string {
  return fm.openingNotes ?? toMarkdown({ type: "doc", content: [["Setting", fm.setting], ["Time", fm.time], ["Place", fm.place]]
    .filter(([, text]) => text?.trim()).flatMap(([label, text]): Node[] => [
      { type: "heading", attrs: { level: 2 }, content: proseText(label!) },
      { type: "paragraph", content: proseText(text!) },
    ]) });
}

export function titlePageText(fm: FrontMatter): string {
  return fm.titlePage ?? toMarkdown({ type: "doc", content: [
    ...(fm.title ? [{ type: "heading", attrs: { level: 1, textAlign: "center" }, content: proseText(fm.title) }] : []),
    ...[fm.credit ?? "", (fm.authors ?? []).join(", "), (fm.contact ?? []).join("\n"), fm.draftDate ?? ""].filter(Boolean)
      .map((text): Node => ({ type: "paragraph", attrs: { textAlign: "center" }, content: proseText(text) })),
  ] });
}

/** Familiar prose controls; print layout remains the shared paginator's job. */
export function FrontPageEditor({ value, onChange, label }: { value: string; onChange: (text: string) => void; label: string }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  return <div className="frontpage-editor" role="group" aria-label={label}>
    <FormatBar editor={editor} openingPage />
    <ProseEditor markdown={value} onChange={onChange} onReady={setEditor} />
  </div>;
}
