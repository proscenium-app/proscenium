// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A line read without the comments on it (docs/app/writing/comments.md#COMM-67),
 * and the comments on a cue or a heading collected like any other
 * (docs/app/writing/comments.md#COMM-66). Headless: the schema, no DOM.
 */
import { describe, expect, it } from "bun:test";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { fromEditorDoc, toEditorDoc } from "../editor/bridge";
import { playExtensions } from "../editor/schema";
import { extractScenes, parse, serialize, type Doc } from "../fountain";
import { collectComments, nameSpan } from "./model";
import { ownOffset, ownStretch, ownText } from "./own-text";
import { collectPmComments, commentThreads } from "./plugin";

const schema = getSchema(playExtensions);
const note = (text: string) => schema.nodes.note.create(null, schema.text(text));
const line = (type: string, ...content: PMNode[]) => schema.nodes[type].create(null, content);
const page = (text: string): PMNode => schema.nodeFromJSON(toEditorDoc(parse(text).doc));

describe("a line's own text", () => {
  const comment = note("Robin: rename?");

  it("is what was typed on it, wherever a comment stands", () => {
    expect(ownText(line("character", schema.text("MARA"), comment))).toBe("MARA");
    expect(ownText(line("character", comment, schema.text("MARA")))).toBe("MARA");
    expect(ownText(line("character", schema.text("MA"), comment, schema.text("RA")))).toBe("MARA");
    expect(ownText(line("sceneHeading", schema.text("INT. KITCHEN"), comment))).toBe(
      "INT. KITCHEN",
    );
    expect(ownText(line("character", comment))).toBe("");
    expect(ownText(line("character"))).toBe("");
  });

  it("is the whole text of a line with no comment, marks and all", () => {
    const cue = line(
      "character",
      schema.text("MA"),
      schema.text("RA", [schema.marks.em.create()]),
      schema.text(" (V.O.)"),
    );
    expect(ownText(cue)).toBe(cue.textContent);
  });

  it("counts the caret in the line's own characters", () => {
    const cue = line("character", schema.text("MA"), comment, schema.text("RA"));
    const past = 2 + comment.nodeSize;
    expect(ownOffset(cue, 0)).toBe(0);
    expect(ownOffset(cue, 2)).toBe(2);
    // Anywhere along the comment is still two letters in.
    expect(ownOffset(cue, 2 + 3)).toBe(2);
    expect(ownOffset(cue, past)).toBe(2);
    expect(ownOffset(cue, past + 1)).toBe(3);
    expect(ownOffset(cue, cue.content.size)).toBe(4);
  });

  it("finds the name's letters beside a comment, and refuses a name with one in it", () => {
    const after = line("character", schema.text("MARA"), comment);
    expect(ownStretch(after, 4)).toEqual({ from: 0, to: 4 });
    expect(ownStretch(after, 2)).toEqual({ from: 0, to: 2 });
    const before = line("character", comment, schema.text("MARA (V.O.)"));
    expect(ownStretch(before, 4)).toEqual({ from: comment.nodeSize, to: comment.nodeSize + 4 });
    const marked = line(
      "character",
      schema.text("MA"),
      schema.text("RA", [schema.marks.em.create()]),
    );
    expect(ownStretch(marked, 4)).toEqual({ from: 0, to: 4 });
    const inside = line("character", schema.text("MA"), comment, schema.text("RA"));
    expect(ownStretch(inside, 2)).toEqual({ from: 0, to: 2 });
    expect(ownStretch(inside, 4)).toBeNull();
    expect(ownStretch(after, 0)).toBeNull();
    expect(ownStretch(after, 9)).toBeNull();
  });
});

describe("a comment on a cue or a heading is a comment", () => {
  const SCRIPT = [
    "# ACT ONE[[Robin: one act?]]",
    "",
    "## SCENE 1[[Sam: retitle]][[Robin: no]]",
    "",
    "INT. KITCHEN[[todo: which kitchen]] - NIGHT",
    "",
    "A tap drips. [[Sam: too long?]]",
    "",
    "@MARA (V.O.)[[Robin: rename?]]",
    "The water again.",
    "",
    "## SCENE 2",
    "",
    "Dark.[[Sam: cut]]",
    "",
  ].join("\n");

  it("collects each one, under the heading it is on or under", () => {
    const threads = commentThreads(collectPmComments(page(SCRIPT)));
    expect(
      threads.map((t) => [t.root.text, t.replies.map((r) => r.text), t.root.act, t.root.scene]),
    ).toEqual([
      ["Robin: one act?", [], "ACT ONE", null],
      ["Sam: retitle", ["Robin: no"], "ACT ONE", "SCENE 1"],
      ["todo: which kitchen", [], "ACT ONE", "INT. KITCHEN - NIGHT"],
      ["Sam: too long?", [], "ACT ONE", "INT. KITCHEN - NIGHT"],
      ["Robin: rename?", [], "ACT ONE", "INT. KITCHEN - NIGHT"],
      ["Sam: cut", [], "ACT ONE", "SCENE 2"],
    ]);
  });

  it("reads the script and the page alike", () => {
    const doc = parse(SCRIPT).doc;
    const read = collectComments(doc).map((c) => [c.text, c.act, c.scene, c.thread]);
    const shown = collectPmComments(page(SCRIPT));
    expect(read.map(([text, act, scene]) => [text, act, scene])).toEqual(
      shown.map((e) => [e.text, e.act, e.scene]),
    );
    // The reply answers the comment on the scene's title.
    expect(read[2]).toEqual(["Robin: no", "ACT ONE", "SCENE 1", 1]);
  });

  it("names a scene as the outline does where the script has one kind of heading", () => {
    const script = SCRIPT.replace("INT. KITCHEN[[todo: which kitchen]] - NIGHT\n\n", "");
    const doc = page(script);
    const headings = extractScenes(fromEditorDoc(doc.toJSON() as Doc)).map((s) => s.heading);
    expect(headings).toEqual(["SCENE 1", "SCENE 2"]);
    const scenes = collectPmComments(doc).map((e) => e.scene);
    expect(scenes).toEqual([null, "SCENE 1", "SCENE 1", "SCENE 1", "SCENE 1", "SCENE 2"]);
    // With both kinds the label is the nearer heading, which the outline does
    // not have: the scene's own count goes by place, not by this label
    // (docs/app/writing/comments.md#COMM-70, src/app/scene-comments.test.ts).
    const both = collectPmComments(page(SCRIPT));
    expect(extractScenes(parse(SCRIPT).doc).map((s) => s.heading)).toEqual(headings);
    expect(both.filter((e) => e.scene === "INT. KITCHEN - NIGHT")).toHaveLength(3);
  });

  it("paints the name in front of it, full stops and all, and keeps no range in a name", () => {
    expect(nameSpan("MR. SMITH ")).toEqual({ start: 0, end: 9 });
    expect(nameSpan("  ")).toBeNull();
    const smith = page("@MR. SMITH[[Robin: Mister?]]\nQuite.\n");
    const [entry] = collectPmComments(smith);
    expect(smith.textBetween(entry.anchorFrom!, entry.anchorTo!)).toBe("MR. SMITH");
    const doc = page(SCRIPT);
    const about = collectPmComments(doc)
      .filter((e) => e.anchorFrom !== null && e.anchorTo !== null)
      .map((e) => [e.text, doc.textBetween(e.anchorFrom!, e.anchorTo!)]);
    expect(about).toEqual([
      ["Robin: one act?", "ACT ONE"],
      ["Sam: retitle", "SCENE 1"],
      ["todo: which kitchen", "INT. KITCHEN"],
      ["Sam: too long?", "A tap drips."],
      ["Robin: rename?", "MARA (V.O.)"],
      ["Sam: cut", "Dark."],
    ]);
    expect(collectPmComments(doc).every((e) => e.rangeId === null)).toBe(true);
  });

  it("comes back from the page as the script it was", () => {
    const doc = page(SCRIPT);
    expect(serialize({ frontMatter: {}, doc: fromEditorDoc(doc.toJSON() as Doc) })).toBe(SCRIPT);
  });
});
