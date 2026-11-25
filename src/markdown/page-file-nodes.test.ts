// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page file in the prose editor (page-file-nodes.ts): a field and the foot
 * are each one object the keys take whole, Insert Field puts a field at the
 * caret, a token typed or pasted becomes one, and new values redraw every
 * field without changing a word. The editor is headless, so what a field's
 * view draws is read where the view reads it: the face its decoration carries.
 */
import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { toDoc, toMarkdown, type Node } from "./doc";
import { PROSE_EXTENSIONS } from "./ProseEditor";
import {
  FIELD_NODE,
  FOOT_NODE,
  canInsertField,
  deleteFieldBeside,
  fieldValuesIn,
  fieldsKey,
  pageFileExtensions,
  showValues,
  type FaceSpec,
} from "./page-file-nodes";
import { FOOT_MARK, type FieldValues } from "./page-fields";

/**
 * A page file's editor, headless. An editor with no element holds no plugins
 * until it is mounted, so its state is given them here: the fields' own and
 * everything else the page's editor runs.
 */
function pageEditor(markdown: string, values: FieldValues = {}) {
  const editor = new Editor({
    element: null,
    extensions: [...PROSE_EXTENSIONS, ...pageFileExtensions(values)],
    content: toDoc(markdown, { pageFile: true }) as never,
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  return editor;
}

/** Words arriving at the caret in one change, with the marks typing there takes. */
function type(editor: Editor, words: string, meta?: Record<string, unknown>) {
  const tr = editor.state.tr.insertText(words);
  for (const [key, value] of Object.entries(meta ?? {})) tr.setMeta(key, value);
  editor.view.dispatch(tr);
}

/** The kinds of node in the page's first block. */
function kinds(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.child(0).forEach((node) => {
    out.push(node.type.name);
  });
  return out;
}

/** The page as its file would hold it. */
const file = (editor: Editor) => toMarkdown(editor.getJSON() as Node);

/** Where the first node of `type` stands. */
function at(editor: Editor, type: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) found = pos;
  });
  if (found < 0) throw new Error(`no ${type} in the page`);
  return found;
}

/** What each field draws, in the page's order: the face its view is handed. */
function faces(editor: Editor): string[] {
  const set = fieldsKey.getState(editor.state)?.faces;
  return (set?.find() ?? [])
    .sort((a, b) => a.from - b.from)
    .map((decoration) => (decoration.spec as FaceSpec).fieldLines);
}

const press = (editor: Editor, dir: -1 | 1) =>
  deleteFieldBeside(dir)(editor.state, editor.view.dispatch);

describe("a field and the foot are each one object", () => {
  test("the page opens as its file and is written back unchanged", () => {
    const src = `# {TITLE}\n\nby _{author}_\n\n${FOOT_MARK}\n\n{contact}\n`;
    const editor = pageEditor(src);
    expect(file(editor)).toBe(src);
    expect(editor.state.doc.child(2).type.name).toBe(FOOT_NODE);
    editor.destroy();
  });

  test("Backspace just after a field takes it whole, and so does Delete just before one", () => {
    const back = pageEditor("by {author} today\n");
    const pos = at(back, FIELD_NODE);
    back.commands.setTextSelection(pos + 1);
    expect(press(back, -1)).toBe(true);
    expect(file(back)).toBe("by  today\n");
    back.destroy();

    const forward = pageEditor("by {author} today\n");
    forward.commands.setTextSelection(pos);
    expect(press(forward, 1)).toBe(true);
    expect(file(forward)).toBe("by  today\n");
    // Beside a letter the key is the page's own, as ever.
    expect(press(forward, -1)).toBe(false);
    forward.destroy();
  });

  test("a selected field, or the selected foot, goes whole", () => {
    const editor = pageEditor(`by {author}\n\n${FOOT_MARK}\n\n{contact}\n`);
    editor.commands.setNodeSelection(at(editor, FIELD_NODE));
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    editor.commands.deleteSelection();
    expect(file(editor)).toBe(`by \n\n${FOOT_MARK}\n\n{contact}\n`);
    editor.commands.setNodeSelection(at(editor, FOOT_NODE));
    editor.commands.deleteSelection();
    expect(file(editor)).toBe("by \n\n{contact}\n");
    editor.destroy();
  });

  test("Backspace at the start of the line under the foot takes the foot, and keeps the words", () => {
    const editor = pageEditor(`Third draft\n\n${FOOT_MARK}\n\n{contact}\n`);
    editor.commands.setTextSelection(at(editor, FOOT_NODE) + 2);
    expect(editor.commands.joinBackward()).toBe(true);
    expect(file(editor)).toBe("Third draft\n\n{contact}\n");
    editor.destroy();
  });
});

describe("Insert Field", () => {
  test("puts the field at the caret, with the marks typing there would take", () => {
    const editor = pageEditor("**by and**\n");
    editor.commands.setTextSelection(4);
    expect(canInsertField(editor.state)).toBe(true);
    expect(editor.commands.insertField("author")).toBe(true);
    expect(file(editor)).toBe("**by {author}and**\n");
    // The caret is after it, where the next word goes.
    expect(editor.state.selection.$from.nodeBefore?.type.name).toBe(FIELD_NODE);
    editor.destroy();
  });

  test("takes the place of what is selected", () => {
    const editor = pageEditor("Draft of DATE\n");
    editor.commands.setTextSelection({ from: 10, to: 14 });
    editor.commands.insertField("draftDate");
    expect(file(editor)).toBe("Draft of {draftDate}\n");
    editor.destroy();
  });

  test("is not offered in code, whose words are literal", () => {
    const editor = pageEditor("```\nnotes\n```\n");
    editor.commands.setTextSelection(2);
    expect(canInsertField(editor.state)).toBe(false);
    expect(editor.commands.insertField("title")).toBe(false);
    expect(file(editor)).toBe("```\nnotes\n```\n");
    editor.destroy();
  });
});

describe("a token that comes in as words is a field, as it prints", () => {
  test("typed a key at a time: the closing brace makes it one, in the marks around it", () => {
    const editor = pageEditor("**by**\n");
    editor.commands.setTextSelection(3);
    for (const key of " {author") type(editor, key);
    expect(kinds(editor)).toEqual(["text"]);
    type(editor, "}");
    const line = editor.state.doc.child(0);
    expect(line.lastChild?.type.name).toBe(FIELD_NODE);
    expect(line.lastChild?.marks.map((mark) => mark.type.name)).toEqual(["bold"]);
    // The caret is after it, where the next key goes.
    expect(editor.state.selection.$from.nodeBefore?.type.name).toBe(FIELD_NODE);
    expect(file(editor)).toBe("**by {author}**\n");
    // A word that is no field keeps its braces.
    for (const key of " {cast}") type(editor, key);
    expect(file(editor)).toBe("**by {author} {cast}**\n");
    editor.destroy();
  });

  test("several keys read from the page at once, a token whole among them", () => {
    const editor = pageEditor("by\n");
    editor.commands.setTextSelection(3);
    type(editor, " and {source} too");
    expect(kinds(editor)).toEqual(["text", FIELD_NODE, "text"]);
    expect(file(editor)).toBe("by and {source} too\n");
    expect(editor.state.selection.from).toBe(editor.state.doc.child(0).nodeSize - 1);
    editor.destroy();
  });

  test("pasted: every token in the words", () => {
    const editor = pageEditor("\n");
    const words = "from {source}, by {author}";
    type(editor, words, { uiEvent: "paste" });
    expect(kinds(editor)).toEqual(["text", FIELD_NODE, "text", FIELD_NODE]);
    expect(file(editor)).toBe(`${words}\n`);
    editor.destroy();
  });

  test("an input method's words wait until it commits them", () => {
    const editor = pageEditor("\n");
    type(editor, "{author}", { composition: 1 });
    expect(kinds(editor)).toEqual(["text"]);
    type(editor, " ");
    expect(kinds(editor)).toEqual([FIELD_NODE, "text"]);
    editor.destroy();
  });

  test("one undo takes the words and the field they became, never leaving the token", () => {
    const editor = pageEditor("Draft\n");
    editor.commands.setTextSelection(6);
    type(editor, " {draftDate}");
    expect(kinds(editor)).toEqual(["text", FIELD_NODE]);
    expect(editor.commands.undo()).toBe(true);
    expect(file(editor)).toBe("Draft\n");
    editor.destroy();
  });

  test("code keeps its braces: its words are literal", () => {
    const editor = pageEditor("Notes `x` here\n");
    editor.commands.setTextSelection(8);
    type(editor, "{title}");
    expect(file(editor)).toBe("Notes `x{title}` here\n");
    editor.destroy();
  });
});

describe("new values", () => {
  test("redraw every field where it stands, and change no word", () => {
    const editor = pageEditor("{TITLE}\n\nby {author}\n", {
      title: "The Weight of Water",
      author: "A. Playwright",
    });
    expect(faces(editor)).toEqual(["THE WEIGHT OF WATER", "A. Playwright"]);
    editor.commands.setTextSelection(at(editor, FIELD_NODE) + 4);
    const before = editor.state;
    let updates = 0;
    editor.on("update", () => {
      updates += 1;
    });

    const tr = showValues(editor.state, { title: "High Water", author: "B. Writer" });
    if (!tr) throw new Error("new values made no transaction");
    expect(tr.docChanged).toBe(false);
    expect(tr.getMeta("addToHistory")).toBe(false);
    editor.view.dispatch(tr);

    expect(editor.state.doc).toBe(before.doc);
    expect(editor.state.selection.eq(before.selection)).toBe(true);
    expect(faces(editor)).toEqual(["HIGH WATER", "B. Writer"]);
    expect(fieldValuesIn(editor.state)).toEqual({ title: "High Water", author: "B. Writer" });
    // Nothing changed in the file, so nothing is saved.
    expect(updates).toBe(0);
    // The same values again are nothing to do.
    expect(showValues(editor.state, { title: "High Water", author: "B. Writer" })).toBeNull();
    editor.destroy();
  });

  test("a field with no value draws its prompt, and a new field the values the page has", () => {
    const editor = pageEditor("{TITLE}\n\nby {author}\n", { author: "A. Playwright" });
    const tr = showValues(editor.state, { draftDate: "Third draft" });
    if (!tr) throw new Error("new values made no transaction");
    editor.view.dispatch(tr);
    expect(faces(editor)).toEqual(["TITLE", "Author's name"]);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertField("draftDate");
    expect(faces(editor)).toEqual(["TITLE", "Author's name", "Third draft"]);
    editor.destroy();
  });

  test("an editor that is not a page file's has no fields to show", () => {
    const editor = new Editor({
      element: null,
      extensions: PROSE_EXTENSIONS,
      content: toDoc("Ask {title}.") as never,
    });
    expect(fieldValuesIn(editor.state)).toBeNull();
    expect(showValues(editor.state, { title: "X" })).toBeNull();
    expect(canInsertField(editor.state)).toBe(false);
    editor.destroy();
  });
});
