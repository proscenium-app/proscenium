// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { keepFrontOutside } from "./front";
import { COMMENT_RANGE } from "./ranges";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: {},
  },
  marks: {
    [COMMENT_RANGE]: { attrs: { id: { default: null } }, excludes: "" },
  },
});
const stretch = schema.marks[COMMENT_RANGE].create({ id: "c1" });

/** "The pipe's ⟨been long⟩ all night": the stretch from 12 to 21. */
function state() {
  return EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("The pipe's "),
        schema.text("been long", [stretch]),
        schema.text(" all night"),
      ]),
    ]),
  });
}
const START = 12;
const END = 21;

/** The words after `tr`, and whether the guard let any out of the stretch. */
function after(tr: Transaction) {
  const next = state().apply(tr);
  const fix = next.tr;
  const took = keepFrontOutside([tr], next, fix);
  const doc = next.apply(fix).doc;
  const marked: string[] = [];
  doc.descendants((node) => {
    if (node.isText && stretch.isInSet(node.marks)) marked.push(node.text ?? "");
  });
  return { took, text: doc.textContent, marked: marked.join("") };
}

// docs/app/writing/comments.md#COMM-62
describe("words typed in front of a stretch", () => {
  test("carried into the stretch, as an iPad's page put them, are let out of it", () => {
    const tr = state().tr.insert(START, schema.text("has ", [stretch]));
    expect(after(tr)).toEqual({
      took: true,
      text: "The pipe's has been long all night",
      marked: "been long",
    });
  });

  test("typed as the editor types them are outside already", () => {
    const tr = state().tr.insertText("has ", START);
    expect(after(tr)).toEqual({
      took: false,
      text: "The pipe's has been long all night",
      marked: "been long",
    });
  });

  test("typed inside the stretch or at its end are the stretch", () => {
    const inside = state().tr.insert(START + 5, schema.text("so ", [stretch]));
    expect(after(inside).marked).toBe("been so long");
    expect(after(inside).took).toBe(false);
    const atEnd = state().tr.insertText(" and loud", END);
    expect(after(atEnd).marked).toBe("been long and loud");
    expect(after(atEnd).took).toBe(false);
  });

  test("typed over the stretch's first word are the stretch", () => {
    const tr = state().tr.replaceWith(START, START + 4, schema.text("was", [stretch]));
    expect(after(tr)).toEqual({
      took: false,
      text: "The pipe's was long all night",
      marked: "was long",
    });
  });

  test("put back by the history are left as they come", () => {
    const tr = state()
      .tr.insert(START, schema.text("has ", [stretch]))
      .setMeta("history$", {});
    expect(after(tr).took).toBe(false);
    expect(after(tr).marked).toBe("has been long");
  });
});
