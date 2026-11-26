// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which words the checker reads (spellcheck.ts): every word of a document's
 * prose, wherever its blocks nest, and none of its code
 * (docs/app/writing/editor-ux.md#EDIT-194); in the script, what it always
 * read (docs/app/writing/editor-ux.md#EDIT-83). And as the writer types, a
 * key reads again the blocks it touched, each underline in them drawn once
 * (docs/app/writing/editor-ux.md#EDIT-92).
 */
import { describe, expect, test } from "bun:test";
import { Editor, getSchema, type AnyExtension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { parse } from "../fountain";
import { toDoc } from "../markdown/doc";
import { PROSE_EXTENSIONS } from "../markdown/ProseEditor";
import { createSpeller } from "../spell";
import { toEditorDoc } from "./bridge";
import { playExtensions } from "./schema";
import { misspellings, Spellcheck, spellcheckKey } from "./spellcheck";

/** A dictionary of every word these pages spell right, and no other. */
const KNOWN = new Set(
  (
    "a an and another at beside block code cell door from here in is item it its " +
    "line list nested of on one opens quote row says she side table the this to well " +
    "with words"
  ).split(" "),
);
const speller = createSpeller({ correct: (w) => KNOWN.has(w.toLowerCase()), suggest: () => [] });

/** The words underlined in a page, in order. */
function underlined(doc: PMNode): string[] {
  return misspellings(doc, 0, doc.content.size, speller).map((d) => doc.textBetween(d.from, d.to));
}

const prose = getSchema(PROSE_EXTENSIONS);
const documentOf = (markdown: string) => prose.nodeFromJSON(toDoc(markdown));

describe("a document", () => {
  test("its headings, paragraphs, lists, quotes and tables are checked, however deep", () => {
    const doc = documentOf(
      [
        "# the tidle",
        "",
        "a line of the sae",
        "",
        "- an item with a mrash",
        "  - a nested item with a snad",
        "1. another itme",
        "",
        "> a quote with a wrold",
        "",
        "| a cell | a clel |",
        "| --- | --- |",
        "| the row | a roow |",
      ].join("\n"),
    );
    expect(underlined(doc)).toEqual([
      "tidle",
      "sae",
      "mrash",
      "snad",
      "itme",
      "wrold",
      "clel",
      "roow",
    ]);
  });

  test("its code is not: a code block, or code in a line", () => {
    const doc = documentOf(
      [
        "a line with `codde` in it",
        "",
        "```",
        "a blcok of codde",
        "```",
        "",
        "- an item with `codde` and a mrash",
        "",
        "> a quote with `codde`",
      ].join("\n"),
    );
    expect(underlined(doc)).toEqual(["mrash"]);
  });

  test("code in a line parts the words either side of it, and each is checked alone", () => {
    // "wrold" and "beside" touch the code, and are words of their own.
    expect(underlined(documentOf("the wrold`codde`beside it"))).toEqual(["wrold"]);
    expect(underlined(documentOf("the side`codde`wrold"))).toEqual(["wrold"]);
  });

  test("a word split by a mark is one word, and a break or a cell's edge parts two", () => {
    const doc = documentOf("a *wr*old here  \nand a snad\n\n| a | mrash |\n| --- | --- |");
    expect(underlined(doc)).toEqual(["wrold", "snad", "mrash"]);
  });
});

describe("the script", () => {
  const play = getSchema(playExtensions);
  const scriptOf = (text: string) => play.nodeFromJSON(toEditorDoc(parse(text).doc));

  test("its cues and headings are still out, and its words in", () => {
    const doc = scriptOf(
      ["INT. THE KICTHEN - NITE", "", "a door opnes.", "", "MARRA", "the wrold is here."].join(
        "\n",
      ),
    );
    expect(underlined(doc)).toEqual(["opnes", "wrold"]);
  });

  test("its boneyard is the writer's own words, and is checked as it always was", () => {
    const doc = scriptOf(["a door opens.", "", "/* she says a wrold */"].join("\n"));
    expect(doc.lastChild?.type.name).toBe("boneyard");
    expect(underlined(doc)).toEqual(["wrold"]);
  });
});

describe("as the writer types", () => {
  /**
   * A page as the checker's plugin holds it, once given its speller as
   * `setSpeller` gives it. The plugin comes from an editor made with no page
   * to draw on, which has its extensions' plugins but no view to hold them,
   * and is given the page as JSON: anything else it would parse as HTML.
   */
  function checking(extensions: AnyExtension[], doc: PMNode): EditorState {
    const editor = new Editor({
      element: null,
      extensions: [...extensions, Spellcheck],
      content: doc.toJSON(),
    });
    const plugin = editor.extensionManager.plugins.find((p) => p.spec.key === spellcheckKey);
    editor.destroy();
    if (!plugin) throw new Error("the checker made no plugin");
    const state = EditorState.create({ doc, plugins: [plugin] });
    return state.apply(state.tr.setMeta(spellcheckKey, { kind: "speller", speller }));
  }

  /** `words` typed a key at a time at the end of the last text in the page. */
  function typeAtEnd(state: EditorState, words: string): EditorState {
    let at = 0;
    state.doc.descendants((node, pos) => {
      if (node.isText) at = pos + node.nodeSize;
    });
    let next = state;
    for (const key of words) {
      next = next.apply(next.tr.insertText(key, at));
      at += key.length;
    }
    return next;
  }

  /** Every underline the page draws, a word for each, as many times as it is drawn. */
  const drawn = (state: EditorState) =>
    (spellcheckKey.getState(state)?.decos.find() ?? []).map((d) =>
      state.doc.textBetween(d.from, d.to),
    );

  test("an underline elsewhere in the block typed in is drawn once, in a document", () => {
    // A list is one block, however many items: typing in its last item reads
    // the whole list again.
    const list = typeAtEnd(
      checking(PROSE_EXTENSIONS, documentOf("- an item with a mrash\n- an item")),
      " with a sae",
    );
    expect(drawn(list)).toEqual(["mrash", "sae"]);
    const quote = typeAtEnd(
      checking(PROSE_EXTENSIONS, documentOf("> a wrold in a quote")),
      " and words",
    );
    expect(drawn(quote)).toEqual(["wrold"]);
  });

  test("an underline elsewhere in the block typed in is drawn once, in the script", () => {
    const play = getSchema(playExtensions);
    const doc = play.nodeFromJSON(toEditorDoc(parse("MARA\nthe wrold is here.").doc));
    expect(drawn(typeAtEnd(checking(playExtensions, doc), " and the side"))).toEqual(["wrold"]);
  });

  test("a word typed wrong is underlined as it is typed, and only it", () => {
    const state = typeAtEnd(checking(PROSE_EXTENSIONS, documentOf("a line")), " of the sae");
    expect(drawn(state)).toEqual(["sae"]);
  });
});
