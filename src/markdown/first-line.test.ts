// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { toDoc, toMarkdown, type Node } from "./doc";
import { firstLineOffset, toFirstLine } from "./first-line";
import { PROSE_EXTENSIONS } from "./ProseEditor";
import { renderTemplate } from "../materials/schema";
import { split } from "../workspace/front-matter";

const schema = getSchema(PROSE_EXTENSIONS);
const stateOf = (markdown: string) =>
  EditorState.create({ schema, doc: schema.nodeFromJSON(toDoc(markdown)) });
const characterBody = split(
  renderTemplate({
    type: "character",
    template: "prompts",
    id: "01TEST",
    title: "New Character",
    created: "2026-09-16T00:00:00Z",
  }),
).body;

describe("the first line of a new page (docs/app/preferences-and-help/accessibility.md#A11Y-4)", () => {
  test("a blank document: the caret in its one paragraph, nothing changed", () => {
    const state = stateOf("");
    const tr = toFirstLine(state);
    expect(tr.docChanged).toBe(false);
    expect(tr.selection.from).toBe(1);
    expect(tr.doc.firstChild?.type.name).toBe("paragraph");
  });

  test("a character sheet: a line under the first heading, and the same Markdown", () => {
    const state = stateOf(characterBody);
    expect(state.doc.child(0).textContent).toBe("Want");
    expect(state.doc.child(1).type.name).toBe("heading");
    const tr = toFirstLine(state);
    const next = state.apply(tr);
    expect(next.doc.child(1).type.name).toBe("paragraph");
    expect(next.selection.$from.parent).toBe(next.doc.child(1));
    // Typing there writes under Want, not into it.
    const typed = next.apply(next.tr.insertText("Her mother's house."));
    expect(typed.doc.child(0).textContent).toBe("Want");
    expect(typed.doc.child(1).textContent).toBe("Her mother's house.");
    // Until then the file is exactly what it was: nothing to save.
    expect(toMarkdown(next.doc.toJSON() as Node)).toBe(toMarkdown(state.doc.toJSON() as Node));
    expect(tr.getMeta("addToHistory")).toBe(false);
  });

  test("asked twice, it makes one line", () => {
    const once = stateOf(characterBody);
    const twice = once.apply(toFirstLine(once));
    const again = toFirstLine(twice);
    expect(again.docChanged).toBe(false);
    expect(twice.apply(again).doc.childCount).toBe(twice.doc.childCount);
  });

  test("a heading with words under it: the caret after them", () => {
    const state = stateOf("## Want\n\nHer mother's house.\n\n## Obstacle\n");
    const tr = toFirstLine(state);
    expect(tr.docChanged).toBe(false);
    expect(tr.selection.$from.parent.textContent).toBe("Her mother's house.");
    expect(tr.selection.$from.parentOffset).toBe("Her mother's house.".length);
  });

  test("Source puts the caret on the line under a first heading", () => {
    expect(firstLineOffset("")).toBe(0);
    expect(firstLineOffset("Some words.")).toBe(0);
    expect(characterBody.startsWith("## Want\n")).toBe(true);
    expect(firstLineOffset(characterBody)).toBe("## Want\n".length);
    expect(firstLineOffset("# Title")).toBe("# Title".length);
    expect(firstLineOffset("#hashtag\n")).toBe(0);
  });
});
