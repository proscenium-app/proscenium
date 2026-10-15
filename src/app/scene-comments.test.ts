// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The inspector's "N in this scene" (docs/app/writing/comments.md#COMM-70):
 * the comments standing in the outline's scene, found by its place in the
 * script and never by its title. Headless: the schema, no DOM.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { collectPmComments, commentThreads } from "../comments/plugin";
import { fromEditorDoc, toEditorDoc } from "../editor/bridge";
import { sceneOrdinalAt } from "../editor/caret-scene";
import { playExtensions } from "../editor/schema";
import { extractScenes, parse, type Doc } from "../fountain";
import { countSceneComments } from "./scene-comments";

const schema = getSchema(playExtensions);
const page = (...lines: string[]): PMNode =>
  schema.nodeFromJSON(toEditorDoc(parse(`${lines.join("\n\n")}\n`).doc));
const outline = (doc: PMNode) => extractScenes(fromEditorDoc(doc.toJSON() as Doc));

/** Every scene of the outline, with what the inspector says of its comments. */
function counted(doc: PMNode) {
  const threads = commentThreads(collectPmComments(doc));
  return outline(doc).map((scene) => {
    const { total, todo } = countSceneComments(doc, threads, scene.ordinal);
    return [scene.act ?? null, scene.heading, total, todo];
  });
}

describe("the comments in a scene", () => {
  it("counts a comment under a scene heading inside a titled scene", () => {
    // The outline has one scene here, SCENE 1; the comment is listed under the
    // scene heading. Matched by title, the scene counted none.
    expect(counted(page("## SCENE 1", "INT. KITCHEN - NIGHT", "Water. [[x]]"))).toEqual([
      [null, "SCENE 1", 1, 0],
    ]);
  });

  it("counts everything from a scene's title to the next scene's", () => {
    const doc = page(
      "# ACT ONE",
      "## SCENE 1[[Sam: retitle]][[Robin: no]]",
      "INT. KITCHEN[[todo: which kitchen]] - NIGHT",
      "A tap drips. [[Sam: too long?]][[Robin: todo: trim it]]",
      "EXT. YARD - DAY",
      "Sun. [[Robin: fine]]",
      "## SCENE 2",
      "Dark.[[Sam: cut]]",
    );
    // A comment and its replies are one, and a to-do in a reply makes it one.
    expect(counted(doc)).toEqual([
      ["ACT ONE", "SCENE 1", 4, 2],
      ["ACT ONE", "SCENE 2", 1, 0],
    ]);
  });

  it("tells two scenes with one title apart", () => {
    // Every play in two acts has two scenes called SCENE 1.
    const acts = page(
      "# ACT ONE",
      "## SCENE 1",
      "Water. [[one]]",
      "# ACT TWO",
      "## SCENE 1",
      "Fire. [[two]] Ash. [[todo: three]]",
    );
    expect(counted(acts)).toEqual([
      ["ACT ONE", "SCENE 1", 1, 0],
      ["ACT TWO", "SCENE 1", 2, 1],
    ]);
    const twins = page("## KITCHEN", "Water. [[one]]", "## KITCHEN", "## KITCHEN[[three]]");
    expect(counted(twins)).toEqual([
      [null, "KITCHEN", 1, 0],
      [null, "KITCHEN", 0, 0],
      [null, "KITCHEN", 1, 0],
    ]);
  });

  it("takes scene headings for the scenes of a script with no scene titles", () => {
    const doc = page(
      "INT. KITCHEN - NIGHT",
      "Water. [[one]]",
      "INT. KITCHEN - NIGHT[[todo: same room?]]",
      "Fire. [[three]]",
    );
    expect(counted(doc)).toEqual([
      [null, "INT. KITCHEN - NIGHT", 1, 0],
      [null, "INT. KITCHEN - NIGHT", 2, 1],
    ]);
  });

  it("counts a comment for the scene the inspector shows with the caret on it", () => {
    const doc = page(
      "Lights. [[before any scene]]",
      "# ACT ONE[[on the first act]]",
      "## SCENE 1[[on a title]]",
      ".A kitchen. Night.",
      "A tap drips. [[under a scene heading]]",
      "# ACT TWO[[on the next act]]",
      "Six months on. [[between an act and its first scene]]",
      "## SCENE 1",
      ".The same. Later.[[on a scene heading]]",
      "@MARA[[on a cue]]\nDark.[[in a speech]]",
    );
    const scenes = outline(doc);
    const blockAt = new Map<number, number>();
    doc.forEach((_node, offset, index) => blockAt.set(offset, index));
    const threads = commentThreads(collectPmComments(doc));
    const placed = threads.map((thread) => {
      const block = blockAt.get(thread.root.blockPos)!;
      const inOutline = scenes.find((s) => s.range.from <= block && block < s.range.to);
      const countedBy = scenes
        .filter((s) => countSceneComments(doc, [thread], s.ordinal).total === 1)
        .map((s) => s.ordinal);
      // The outline's range, the caret's scene and the count are one reading.
      expect(sceneOrdinalAt(doc, thread.root.pos)).toBe(inOutline?.ordinal ?? null);
      expect(countedBy).toEqual(inOutline ? [inOutline.ordinal] : []);
      return [thread.root.text, inOutline?.ordinal ?? null];
    });
    // A scene runs to the next scene's first line, so the title of the act
    // after it, and what stands between that title and the act's first scene,
    // are in its stretch: where the outline and the caret already put them.
    expect(placed).toEqual([
      ["before any scene", null],
      ["on the first act", null],
      ["on a title", 0],
      ["under a scene heading", 0],
      ["on the next act", 0],
      ["between an act and its first scene", 0],
      ["on a scene heading", 1],
      ["on a cue", 1],
      ["in a speech", 1],
    ]);
    // Past the first scene's title, every comment is some scene's.
    const total = counted(doc).reduce((sum, [, , n]) => sum + (n as number), 0);
    expect(total).toBe(threads.length - 2);
  });

  it("has nothing to count where the inspector shows no scene", () => {
    const doc = page("Lights. [[one]]", "@MARA\nDark.[[two]]");
    const threads = commentThreads(collectPmComments(doc));
    expect(threads).toHaveLength(2);
    // No scene line of either kind: the caret is in no scene.
    expect(sceneOrdinalAt(doc, threads[0].root.pos)).toBeNull();
    expect(countSceneComments(doc, threads, null)).toEqual({ total: 0, todo: 0 });
    // A scene the script no longer has.
    const one = page("## SCENE 1", "Water. [[x]]");
    const its = commentThreads(collectPmComments(one));
    expect(countSceneComments(one, its, 0)).toEqual({ total: 1, todo: 0 });
    expect(countSceneComments(one, its, 1)).toEqual({ total: 0, todo: 0 });
  });
});
