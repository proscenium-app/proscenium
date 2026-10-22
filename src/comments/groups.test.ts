// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The feed's groups (docs/app/writing/comments.md#COMM-71): a comment listed
 * under the nearest heading above it, and a heading taken for the line it is.
 * Headless: the schema, no DOM.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { toEditorDoc } from "../editor/bridge";
import { playExtensions } from "../editor/schema";
import { parse } from "../fountain";
import { groupByHeading } from "./groups";
import { collectPmComments, commentThreads } from "./plugin";

const schema = getSchema(playExtensions);
const page = (...lines: string[]): PMNode =>
  schema.nodeFromJSON(toEditorDoc(parse(`${lines.join("\n\n")}\n`).doc));
const groups = (doc: PMNode, keep: (text: string) => boolean = () => true) =>
  groupByHeading(commentThreads(collectPmComments(doc)).filter((t) => keep(t.root.text))).map(
    (group) => [group.label, group.items.map((t) => t.root.text)],
  );

describe("the feed's groups", () => {
  it("lists a comment under the nearest heading above it, of either kind", () => {
    const doc = page(
      "Lights. [[before anything]]",
      "# ACT ONE[[one act?]]",
      "## SCENE 1[[retitle]]",
      "Morning. [[under the title]]",
      "INT. KITCHEN - NIGHT",
      "A tap drips. [[too long?]]",
      "@MARA[[rename?]]\nThe water again.",
      "## SCENE 2",
      "Dark.[[cut]]",
    );
    expect(groups(doc)).toEqual([
      ["Front of script", ["before anything"]],
      ["ACT ONE", ["one act?"]],
      ["ACT ONE · SCENE 1", ["retitle", "under the title"]],
      ["ACT ONE · INT. KITCHEN - NIGHT", ["too long?", "rename?"]],
      ["ACT ONE · SCENE 2", ["cut"]],
    ]);
  });

  it("keeps two headings with one text apart", () => {
    // Two scenes with one title, back to back.
    expect(groups(page("## KITCHEN", "Water. [[one]]", "## KITCHEN", "Fire. [[two]]"))).toEqual([
      ["KITCHEN", ["one"]],
      ["KITCHEN", ["two"]],
    ]);
    // Two scenes in one room: the scene headings read alike.
    const sameRoom = page(
      "## SCENE 1",
      ".The same. Later.",
      "Water. [[one]] Steam. [[two]]",
      "## SCENE 2",
      ".The same. Later.",
      "Fire. [[three]]",
    );
    expect(groups(sameRoom)).toEqual([
      ["The same. Later.", ["one", "two"]],
      ["The same. Later.", ["three"]],
    ]);
  });

  it("keeps them apart when a filter leaves nothing between them", () => {
    const doc = page(
      "## KITCHEN",
      "Water. [[todo: one]]",
      "## YARD",
      "Sun. [[two]]",
      "## KITCHEN",
      "Fire. [[todo: three]]",
    );
    expect(groups(doc, (text) => text.startsWith("todo:"))).toEqual([
      ["KITCHEN", ["todo: one"]],
      ["KITCHEN", ["todo: three"]],
    ]);
  });

  it("puts what follows a heading with no text of its own under the act", () => {
    const doc = page("# ACT ONE[[on the act]]", "## [[an untitled scene]]", "Water. [[under it]]");
    expect(groups(doc)).toEqual([["ACT ONE", ["on the act", "an untitled scene", "under it"]]]);
  });
});
