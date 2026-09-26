// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a writer's first words go on a page just made for them (docs/app/preferences-and-help/accessibility.md#A11Y-4).
 *
 * A blank document is one empty paragraph, and the caret goes into it. A
 * character sheet is born with its template — a `## Want` heading over
 * nothing — and a caret at the top of that page would put the writer's first
 * words into the heading. So on a page that starts with a heading, the caret
 * goes on the line under it: the paragraph already there, or an empty one made
 * for it. An empty paragraph between two headings is the same Markdown as none
 * (doc.ts writes nothing for it), so making one saves nothing: the file changes
 * when the writer types, and not before.
 */
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

/** The caret on the page's first line, as a transaction kept out of undo. */
export function toFirstLine(state: EditorState): Transaction {
  const tr = state.tr.setMeta("addToHistory", false);
  const { doc } = state;
  const first = doc.firstChild;
  if (!first || first.type.name !== "heading") return tr.setSelection(TextSelection.atStart(doc));
  const under = first.nodeSize;
  const next = doc.childCount > 1 ? doc.child(1) : null;
  if (next?.type.name === "paragraph") {
    return tr.setSelection(TextSelection.create(doc, under + 1 + next.content.size));
  }
  tr.insert(under, state.schema.nodes.paragraph.create());
  return tr.setSelection(TextSelection.create(tr.doc, under + 1));
}

/** The same place in the Source view's text: the start of the line under a first heading. */
export function firstLineOffset(markdown: string): number {
  return markdown.match(/^#{1,6}[ \t][^\n]*\n?/)?.[0].length ?? 0;
}
