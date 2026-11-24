// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { parse } from "./parse";
import { serialize } from "./serialize";
import { extractScenes, wholeScript } from "./scenes";
import {
  moveSceneInDoc,
  sameSceneOutline,
  sceneBlockRanges,
  addSceneToDoc,
  setSceneSynopsis,
} from "./scene-move";

const THREE = [
  "# ACT ONE",
  "",
  "## SCENE 1",
  "",
  "Aaa.",
  "",
  "## SCENE 2",
  "",
  "Bbb.",
  "",
  "# ACT TWO",
  "",
  "## SCENE 3",
  "",
  "Ccc.",
].join("\n");

const headings = (doc: ReturnType<typeof parse>["doc"]) => extractScenes(doc).map((s) => s.heading);
const acts = (doc: ReturnType<typeof parse>["doc"]) => extractScenes(doc).map((s) => s.act);

describe("moveSceneInDoc", () => {
  it("identifies blocks bounded by scene AND act (act nodes are fixed dividers)", () => {
    const ranges = sceneBlockRanges(parse(THREE).doc);
    expect(ranges.map((r) => r.ordinal)).toEqual([0, 1, 2]);
    // SCENE 2's block stops at the ACT TWO node, never absorbing it.
    expect(ranges[1].to).toBeLessThan(ranges[2].from);
  });

  it("reorders within an act", () => {
    const moved = moveSceneInDoc(parse(THREE).doc, 0, 1);
    expect(headings(moved)).toEqual(["SCENE 2", "SCENE 1", "SCENE 3"]);
    expect(acts(moved)).toEqual(["ACT ONE", "ACT ONE", "ACT TWO"]);
  });

  it("moves a scene across an act divider (changes its act)", () => {
    const moved = moveSceneInDoc(parse(THREE).doc, 1, 2);
    expect(headings(moved)).toEqual(["SCENE 1", "SCENE 3", "SCENE 2"]);
    // SCENE 2 is now after the ACT TWO divider → it belongs to ACT TWO.
    expect(acts(moved)).toEqual(["ACT ONE", "ACT TWO", "ACT TWO"]);
  });

  it("moves a later scene before an earlier one", () => {
    const moved = moveSceneInDoc(parse(THREE).doc, 2, 0);
    expect(headings(moved)).toEqual(["SCENE 3", "SCENE 1", "SCENE 2"]);
  });

  it("produces clean, round-trippable Fountain after a move", () => {
    const moved = moveSceneInDoc(parse(THREE).doc, 1, 2);
    const out = serialize({ frontMatter: {}, doc: moved });
    expect(serialize({ frontMatter: {}, doc: parse(out).doc })).toBe(out);
    // the act divider survived exactly once
    expect(out.match(/# ACT TWO/g)?.length).toBe(1);
  });

  it("is a no-op for out-of-range or identity moves", () => {
    const doc = parse(THREE).doc;
    expect(moveSceneInDoc(doc, 1, 1)).toBe(doc);
    expect(moveSceneInDoc(doc, 5, 0)).toBe(doc);
  });
});

describe("adding a scene from the board", () => {
  it("appends a scene the script did not have", () => {
    const doc = addSceneToDoc(parse(THREE).doc);
    expect(headings(doc)).toEqual(["SCENE 1", "SCENE 2", "SCENE 3", "Scene 4"]);
  });

  it("takes a title when one is given", () => {
    const doc = addSceneToDoc(parse(THREE).doc, "  The Lamp Room  ");
    const hs = headings(doc);
    expect(hs[hs.length - 1]).toBe("The Lamp Room");
  });

  it("lands in the last act, because acts are dividers", () => {
    const doc = addSceneToDoc(parse(THREE).doc);
    const as = acts(doc);
    expect(as[as.length - 1]).toBe("ACT TWO");
  });

  it("starts a scene-less script with a ## scene", () => {
    const doc = addSceneToDoc({ type: "doc", content: [] });
    expect(doc.content.map((b) => b.type)).toEqual(["scene"]);
    expect(serialize({ frontMatter: {}, doc })).toContain("## Scene 1");
  });

  it("matches a heading-based script instead of flipping its boundary", () => {
    // The trap: extractScenes prefers `scene` over `sceneHeading`, so a stray
    // `##` here would make every existing card disappear from the board.
    const src = "INT. KITCHEN - DAY\n\nShe waits.\n\nINT. HALL - NIGHT\n\nHe does not.\n";
    const doc = addSceneToDoc(parse(src).doc);
    expect(doc.content.some((b) => b.type === "scene")).toBe(false);
    expect(doc.content.filter((b) => b.type === "sceneHeading")).toHaveLength(3);
  });

  it("produces round-trippable Fountain", () => {
    const doc = addSceneToDoc(parse(THREE).doc, "The Lamp Room");
    const out = serialize({ frontMatter: {}, doc });
    expect(serialize({ frontMatter: {}, doc: parse(out).doc })).toBe(out);
  });

  it("forces a heading that is not a natural slug, so it parses back", () => {
    const src = "INT. KITCHEN - DAY\n\nShe waits.\n";
    const out = serialize({ frontMatter: {}, doc: addSceneToDoc(parse(src).doc) });
    expect(out).toContain(".Scene 2");
    expect(parse(out).doc.content.filter((b) => b.type === "sceneHeading")).toHaveLength(2);
  });
});

describe("sameSceneOutline", () => {
  it("typing inside a scene leaves the outline the same", () => {
    const before = parse(THREE).doc;
    const typed = parse(THREE.replace("Aaa.", "Aaa, and more typed.")).doc;
    expect(sameSceneOutline(before, typed)).toBe(true);
  });

  it("a scene heading typed meanwhile is a different outline", () => {
    const before = parse(THREE).doc;
    const typed = parse(`${THREE}\n\n## SCENE 4\n\nDdd.`).doc;
    expect(sameSceneOutline(before, typed)).toBe(false);
  });

  it("a renamed scene is a different outline", () => {
    const before = parse(THREE).doc;
    const renamed = parse(THREE.replace("## SCENE 2", "## THE TRUCE")).doc;
    expect(sameSceneOutline(before, renamed)).toBe(false);
  });

  it("an act divider added is a different outline", () => {
    const before = parse(THREE).doc;
    const acted = parse(THREE.replace("## SCENE 2", "# INTERLUDE\n\n## SCENE 2")).doc;
    expect(sameSceneOutline(before, acted)).toBe(false);
  });

  it("a move made on the page it was named against means the same thing", () => {
    const before = parse(THREE).doc;
    const typed = parse(THREE.replace("Ccc.", "Ccc, typed while it was out.")).doc;
    expect(sameSceneOutline(before, typed)).toBe(true);
    const moved = moveSceneInDoc(typed, 0, 1);
    expect(headings(moved)).toEqual(headings(moveSceneInDoc(before, 0, 1)));
    expect(serialize({ frontMatter: {}, doc: moved })).toContain("Ccc, typed while it was out.");
  });
});

/**
 * A play with no scene line is one scene (docs/app/organizing/workspace-model.md#WORK-41,
 * docs/app/organizing/workspace-model.md#WORK-93): a short play in one place
 * often has no heading anywhere, and its one card is the whole script.
 */
describe("a script no scene line divides", () => {
  const UNDIVIDED = [
    "A bus shelter. Rain.",
    "",
    "ODILE",
    "Is it always this late?",
    "",
    "FENWICK",
    "Only when it rains.",
  ].join("\n");

  it("is one scene, the whole of it, with no heading", () => {
    const { doc } = parse(UNDIVIDED);
    expect(wholeScript(doc)).toBe(true);
    const scenes = extractScenes(doc);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ ordinal: 0, heading: "", range: { from: 0 } });
    expect(scenes[0].range.to).toBe(doc.content.length);
  });

  it("is not one when a ## title or a scene heading divides it, or when it is empty", () => {
    expect(wholeScript(parse(`## SCENE 1\n\n${UNDIVIDED}`).doc)).toBe(false);
    expect(wholeScript(parse(`.A bus shelter.\n\n${UNDIVIDED}`).doc)).toBe(false);
    expect(wholeScript(parse("").doc)).toBe(false);
    expect(wholeScript(null)).toBe(false);
    // An act title is not a scene line: a one-act play under its act's name
    // is still one scene.
    expect(wholeScript(parse(`# ACT ONE\n\n${UNDIVIDED}`).doc)).toBe(true);
  });

  it("takes its summary at the top, never between a cue and its speech", () => {
    // Under the first line, as under a heading, the summary went after the
    // script's opening line, and in a play that opens on a cue it parted the
    // cue from its speech.
    const opensOnCue = UNDIVIDED.split("\n").slice(2).join("\n");
    for (const src of [UNDIVIDED, opensOnCue]) {
      const doc = setSceneSynopsis(parse(src).doc, 0, "Two strangers wait out the rain.");
      expect(doc.content[0].type).toBe("synopsis");
      const out = serialize({ frontMatter: {}, doc });
      expect(out.startsWith("= Two strangers wait out the rain.\n")).toBe(true);
      expect(out).toContain("ODILE\nIs it always this late?");
      const back = parse(out).doc;
      expect(wholeScript(back)).toBe(true);
      expect(extractScenes(back)[0].synopsis).toBe("Two strangers wait out the rain.");
    }
  });

  it("changes its summary in place, and an empty one takes the line away", () => {
    const once = setSceneSynopsis(parse(UNDIVIDED).doc, 0, "Two strangers.");
    const twice = setSceneSynopsis(once, 0, "Two strangers, one shelter.");
    expect(twice.content.filter((b) => b.type === "synopsis")).toHaveLength(1);
    expect(extractScenes(twice)[0].synopsis).toBe("Two strangers, one shelter.");
    expect(setSceneSynopsis(twice, 0, "  ").content).toEqual(parse(UNDIVIDED).doc.content);
  });

  it("still puts a divided scene's summary under its heading", () => {
    const doc = setSceneSynopsis(parse(THREE).doc, 1, "The lamp goes out.");
    const at = doc.content.findIndex((b) => b.type === "synopsis");
    expect(doc.content[at - 1].type).toBe("scene");
    expect(extractScenes(doc)[1].synopsis).toBe("The lamp goes out.");
  });
});
