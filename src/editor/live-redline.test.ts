// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Decoration } from "@tiptap/pm/view";
import { parse } from "../fountain";
import { toEditorDoc } from "./bridge";
import { liveRedline } from "./live-redline";
import { playExtensions } from "./schema";

const schema = getSchema(playExtensions);

const BEFORE = `Title: The Weight of Water

# ACT ONE

## SCENE 1

AT RISE: A kitchen, just before dawn.

MARA
The pipe's been crying all night.

JONAH
You and that pipe.

MARA
You weren't supposed to come.

JONAH
I know.
`;

// Words added in one speech, words cut from another, and a speech cut whole.
const AFTER = `Title: The Weight of Water

# ACT ONE

## SCENE 1

AT RISE: A kitchen, just before dawn.

MARA
The pipe's been crying all night. Like it knows.

JONAH
You and that.

MARA
You weren't supposed to come.
`;

/** The page as the editor holds it after reading `text`. */
function pageOf(text: string): PMNode {
  return schema.nodeFromJSON(toEditorDoc(parse(text).doc));
}

/** What a decoration draws: an inline mark over words, a whole element's attribute, or a widget. */
function kinds(doc: PMNode, decos: Decoration[]) {
  return decos.map((d) => {
    const type = (d as unknown as { type: { attrs?: Record<string, string> } }).type;
    if (d.from === d.to) return { widget: d.from };
    const text = doc.textBetween(d.from, d.to);
    return type.attrs?.["data-redline"]
      ? { element: type.attrs["data-redline"], text }
      : { added: text };
  });
}

describe("docs/app/keeping-work/storage-and-file-format.md#STOR-185: a change drawn on the script being written", () => {
  test("marks added words, cut words and a cut speech once each, on the elements they belong to", () => {
    const doc = pageOf(AFTER);
    const { decorations, changes } = liveRedline(doc, BEFORE, AFTER);
    // MARA's line rewritten, JONAH's line rewritten, his cue and speech cut.
    expect(changes).toBe(4);
    const drawn = kinds(doc, decorations.find());
    expect(drawn).toContainEqual({ added: "Like it knows." });
    expect(drawn).toContainEqual({
      element: "mod",
      text: "The pipe's been crying all night. Like it knows.",
    });
    expect(drawn).toContainEqual({ element: "mod", text: "You and that." });
    // " pipe" cut from JONAH's line, and the cut cue and speech at the end.
    expect(drawn.filter((d) => "widget" in d)).toHaveLength(3);
    expect(drawn.some((d) => "added" in d && !!d.added?.includes("You"))).toBe(false);
  });

  test("words the writer typed since are never marked as the change's", () => {
    // The change arrived, then the writer rewrote MARA's line on the page.
    const typed = AFTER.replace("Like it knows.", "Like it knows. Like it remembers.");
    const doc = pageOf(typed);
    const drawn = kinds(doc, liveRedline(doc, BEFORE, AFTER).decorations.find());
    // The element still says it changed, but no word in it is put to the change.
    expect(drawn).toContainEqual({
      element: "mod",
      text: "The pipe's been crying all night. Like it knows. Like it remembers.",
    });
    expect(drawn.some((d) => "added" in d && !!d.added?.includes("Like"))).toBe(false);
    // JONAH's line is as the change left it: its marks stand.
    expect(drawn).toContainEqual({ element: "mod", text: "You and that." });
  });

  test("the same text twice draws nothing", () => {
    const doc = pageOf(AFTER);
    const { decorations, changes } = liveRedline(doc, AFTER, AFTER);
    expect(changes).toBe(0);
    expect(decorations.find()).toHaveLength(0);
  });
});
