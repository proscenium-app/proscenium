// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import { liftEmptyBlock } from "@tiptap/pm/commands";
import type { Node as PMNode } from "@tiptap/pm/model";
import { liftListItem, splitListItem, wrapInList } from "@tiptap/pm/schema-list";
import { EditorState, Plugin, TextSelection, type Command } from "@tiptap/pm/state";
import { toDoc, toMarkdown, type Node } from "./doc";
import {
  backspaceAtItemStart,
  continueNumbering,
  indentItem,
  numberingAt,
  outdentItem,
  settleLists,
  startNumberingAt,
} from "./lists";
import { PROSE_EXTENSIONS } from "./ProseEditor";

const schema = getSchema(PROSE_EXTENSIONS);
const item = schema.nodes.listItem!;

/**
 * A document from Markdown with the caret where `|` stands, under the same
 * settling the editor runs after every change.
 */
function open(markdown: string): EditorState {
  const at = markdown.indexOf("|");
  const source = markdown.replace("|", "‸");
  const doc = schema.nodeFromJSON(toDoc(source));
  let caret = 1;
  let clean = doc;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text!.includes("‸")) return;
    caret = pos + node.text!.indexOf("‸");
  });
  if (at >= 0) {
    clean = schema.nodeFromJSON(toDoc(markdown.replace("|", "")));
    // A caret at the start of an empty line has no text node to stand in.
    if (!doc.textContent.includes("‸")) throw new Error("the caret mark was not text");
  }
  const state = EditorState.create({
    doc: clean,
    plugins: [new Plugin({ appendTransaction: settleLists })],
  });
  return state.apply(state.tr.setSelection(TextSelection.create(clean, caret)));
}

function press(state: EditorState, command: Command): EditorState {
  let next = state;
  const handled = command(state, (tr) => {
    next = state.apply(tr);
  });
  if (!handled) throw new Error("the key was not handled");
  return next;
}

/** The page as the file would hold it, with the caret marked. */
function page(state: EditorState): string {
  const { from } = state.selection;
  const marked = state.apply(state.tr.insertText("|", from));
  return toMarkdown(marked.doc.toJSON() as Node).trimEnd();
}

const kinds = (doc: PMNode) => {
  const out: string[] = [];
  doc.forEach((node) =>
    out.push(node.type.name === "orderedList" ? `numbered@${node.attrs.start}` : node.type.name),
  );
  return out;
};

describe("Backspace at the start of an item", () => {
  test("keeps the words in the list, as a line of the item above", () => {
    const state = press(open("- one\n- |two\n- three"), backspaceAtItemStart);
    expect(page(state)).toBe("- one\\\n  |two\n- three");
    expect(kinds(state.doc)).toEqual(["bulletList"]);
  });

  test("a second Backspace joins the two lines", () => {
    const state = press(open("- one\n- |two\n- three"), backspaceAtItemStart);
    const joined = state.apply(state.tr.delete(state.selection.from - 1, state.selection.from));
    expect(page(joined)).toBe("- one|two\n- three");
  });

  test("a numbered list keeps counting through it", () => {
    const state = press(open("1. one\n2. |two\n3. three"), backspaceAtItemStart);
    expect(page(state)).toBe("1. one\\\n   |two\n2. three");
  });

  test("joins the last line of the item above, however deep its own list goes", () => {
    const state = press(open("- one\n  - under\n- |two"), backspaceAtItemStart);
    expect(page(state)).toBe("- one\n  - under\\\n    |two");
  });

  test("items nested under it keep their depth", () => {
    const state = press(open("- one\n- |two\n  - under two\n- three"), backspaceAtItemStart);
    expect(page(state)).toBe("- one\\\n  |two\n  - under two\n- three");
  });

  test("an empty item just goes, and an empty line above just takes the words", () => {
    const made = press(open("- one\n- two|"), splitListItem(item));
    expect(page(press(made, backspaceAtItemStart))).toBe("- one\n- two|");
    const under = press(open("- one|\n- two"), splitListItem(item));
    const down = under.apply(
      under.tr.setSelection(TextSelection.create(under.doc, under.selection.from + 4)),
    );
    expect(page(press(down, backspaceAtItemStart))).toBe("- one\n- |two");
  });

  test("the first item of a nested list steps out one level", () => {
    const state = press(open("- one\n  - |under\n  - also\n- two"), backspaceAtItemStart);
    expect(page(state)).toBe("- one\n- |under\n  - also\n- two");
  });

  test("the first item of the whole list becomes a paragraph above it", () => {
    const state = press(open("1. |one\n2. two\n3. three"), backspaceAtItemStart);
    expect(kinds(state.doc)).toEqual(["paragraph", "numbered@1"]);
    expect(page(state)).toBe("|one\n\n1. two\n2. three");
  });

  test("is not this rule's anywhere else on the line", () => {
    const state = open("- one\n- tw|o");
    expect(backspaceAtItemStart(state)).toBe(false);
  });
});

describe("Tab and Shift-Tab", () => {
  test("Tab indents under the item above", () => {
    expect(page(press(open("- one\n- |two"), indentItem(true)))).toBe("- one\n  - |two");
  });

  test("Tab on an item with nothing above it is spent on a page, and passed on in a sheet", () => {
    const state = open("- |one\n- two");
    expect(page(press(state, indentItem(true)))).toBe("- |one\n- two");
    expect(indentItem(false)(state)).toBe(false);
  });

  test("Shift-Tab steps a nested item out", () => {
    expect(page(press(open("- one\n  - |two"), outdentItem(true)))).toBe("- one\n- |two");
  });

  test("Shift-Tab at the top level leaves the item in its list", () => {
    const state = open("- one\n- |two\n- three");
    expect(page(press(state, outdentItem(true)))).toBe("- one\n- |two\n- three");
    expect(outdentItem(false)(state)).toBe(false);
  });

  test("neither is the list's outside a list", () => {
    const state = open("plain |words");
    expect(indentItem(true)(state)).toBe(false);
    expect(outdentItem(true)(state)).toBe(false);
  });
});

describe("a numbered list goes on counting", () => {
  test("below an item turned back into a paragraph", () => {
    const state = press(open("1. one\n2. |two\n3. three\n4. four"), liftListItem(item));
    expect(kinds(state.doc)).toEqual(["numbered@1", "paragraph", "numbered@2"]);
    expect(page(state)).toBe("1. one\n\n|two\n\n2. three\n3. four");
  });

  test("below an empty item left with Return", () => {
    const made = press(open("1. one|\n2. two"), splitListItem(item));
    const left = press(made, liftEmptyBlock);
    expect(kinds(left.doc)).toEqual(["numbered@1", "paragraph", "numbered@2"]);
  });

  test("and keeps up as the list above it grows", () => {
    const state = press(open("1. one|\n\naside\n\n2. two"), splitListItem(item));
    expect(kinds(state.doc)).toEqual(["numbered@1", "paragraph", "numbered@3"]);
  });

  test("a list whose number is the next number is that list continuing", () => {
    const state = open("1. one\n2. two\n\naside\n\n3. |three");
    expect(numberingAt(state)).toEqual({ start: 3, continues: true, next: 3 });
  });

  test("a list with a number of its own keeps it", () => {
    const state = press(open("1. one|\n\naside\n\n7. seven"), splitListItem(item));
    expect(kinds(state.doc)).toEqual(["numbered@1", "paragraph", "numbered@7"]);
  });

  test("the first item leaving does not make the rest a continuation of some other list", () => {
    const state = press(open("1. a\n2. b\n\naside\n\n1. |one\n2. two"), liftListItem(item));
    expect(kinds(state.doc)).toEqual(["numbered@1", "paragraph", "paragraph", "numbered@1"]);
  });

  test("the writer starts it again at 1, or continues it", () => {
    const state = open("1. one\n2. two\n\naside\n\n3. |three\n4. four");
    const again = press(state, startNumberingAt(1));
    expect(page(again)).toBe("1. one\n2. two\n\naside\n\n1. |three\n2. four");
    expect(numberingAt(again)).toEqual({ start: 1, continues: false, next: 3 });
    expect(page(press(again, continueNumbering))).toBe(page(state));
  });

  test("continuing needs a list above", () => {
    expect(continueNumbering(open("aside\n\n1. |one"))).toBe(false);
  });

  test("a nested list counts by itself", () => {
    const state = press(open("1. one\n2. |two\n3. three"), indentItem(true));
    expect(page(state)).toBe("1. one\n   1. |two\n2. three");
  });
});

describe("lists that touch are one list", () => {
  test("when what stood between them goes", () => {
    const state = open("- one\n\n|aside\n\n- two");
    const { $from } = state.selection;
    const gone = state.apply(state.tr.delete($from.before(), $from.after()));
    expect(kinds(gone.doc)).toEqual(["bulletList"]);
    expect(gone.doc.firstChild!.childCount).toBe(2);
  });

  test("a paragraph made a list beside one joins it", () => {
    const state = press(open("1. one\n2. two\n\n|three"), wrapInList(schema.nodes.orderedList!));
    expect(page(state)).toBe("1. one\n2. two\n3. |three");
  });

  test("a bulleted list and a numbered one stay two", () => {
    const state = open("- one\n\n|aside\n\n1. two");
    const { $from } = state.selection;
    const gone = state.apply(state.tr.delete($from.before(), $from.after()));
    expect(kinds(gone.doc)).toEqual(["bulletList", "numbered@1"]);
  });
});
