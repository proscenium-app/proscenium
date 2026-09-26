// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";

import type { BlockNode, Doc } from "../fountain/model";
import { cueTail, sidesDoc, SIDES_CUE_WORDS } from "./sides";

function b(type: BlockNode["type"], text: string, attrs?: Record<string, unknown>): BlockNode {
  const node: BlockNode = { type, content: text ? [{ type: "text", text }] : [] };
  if (attrs) node.attrs = attrs;
  return node;
}

function doc(...content: BlockNode[]): Doc {
  return { type: "doc", content };
}

function texts(d: Doc): string[] {
  return d.content.map(
    (blk) =>
      `${blk.type}:${(blk.content ?? []).map((n) => (n.type === "text" ? n.text : "")).join("")}`,
  );
}

describe("cueTail", () => {
  test("a short single-line speech is the whole cue, unmarked", () => {
    expect(cueTail("Then go.")).toBe("Then go.");
  });

  test("a long line keeps its last words behind an ellipsis", () => {
    const line = "one two three four five six seven eight nine ten";
    expect(cueTail(line)).toBe("… three four five six seven eight nine ten");
    expect(cueTail(line)!.split(" ").length).toBe(SIDES_CUE_WORDS + 1);
  });

  test("a multi-line speech cues from its last line, marked as partial", () => {
    expect(cueTail("First thought.\nAnd the last.")).toBe("… And the last.");
  });

  test("whitespace-only speech gives no cue", () => {
    expect(cueTail("  \n  ")).toBeNull();
  });
});

describe("sidesDoc", () => {
  const play = doc(
    b("sceneHeading", "SCENE 1"),
    b("action", "A kitchen. Morning."),
    b("character", "JONAH"),
    b("dialogue", "You never told me why you left in the first place."),
    b("character", "MARA"),
    b("parenthetical", "quietly"),
    b("dialogue", "Because staying was worse."),
    b("action", "JONAH turns away."),
    b("character", "JONAH"),
    b("dialogue", "Worse than this?"),
  );

  test("keeps the target's chains verbatim with cue-ins, elides the rest", () => {
    const sides = sidesDoc(play, "MARA");
    expect(texts(sides)).toEqual([
      "centered:MARA — SIDES",
      "sceneHeading:SCENE 1",
      "character:JONAH",
      "dialogue:… me why you left in the first place.",
      "character:MARA",
      "parenthetical:quietly",
      "dialogue:Because staying was worse.",
    ]);
  });

  test("the cue-in line is italic; the target's own lines keep their marks", () => {
    const marked = doc(
      b("sceneHeading", "SCENE 1"),
      b("character", "JONAH"),
      b("dialogue", "Go."),
      b("character", "MARA"),
      {
        type: "dialogue",
        content: [{ type: "text", text: "Fine.", marks: [{ type: "strong" }] }],
      },
    );
    const sides = sidesDoc(marked, "MARA");
    const cueIn = sides.content[3];
    expect(cueIn.type).toBe("dialogue");
    expect(cueIn.content?.[0]).toMatchObject({ text: "Go.", marks: [{ type: "em" }] });
    const own = sides.content[sides.content.length - 1];
    expect(own.content?.[0]).toMatchObject({ text: "Fine.", marks: [{ type: "strong" }] });
  });

  test("no cue-in when the target opens a scene, and an empty scene leaves no heading", () => {
    const twoScenes = doc(
      b("sceneHeading", "SCENE 1"),
      b("character", "JONAH"),
      b("dialogue", "Curtain line."),
      b("sceneHeading", "SCENE 2"),
      b("character", "MARA"),
      b("dialogue", "A fresh start."),
    );
    // SCENE 1 is dropped — MARA isn't in it, and sides for a three-scene part
    // must not be a flip-book of empty scene labels.
    expect(texts(sidesDoc(twoScenes, "MARA"))).toEqual([
      "centered:MARA — SIDES",
      "sceneHeading:SCENE 2",
      "character:MARA",
      "dialogue:A fresh start.",
    ]);
  });

  test("no cue-in when the target cues themself across an elided action", () => {
    const selfCued = doc(
      b("sceneHeading", "SCENE 1"),
      b("character", "MARA"),
      b("dialogue", "I put it down somewhere."),
      b("action", "She searches."),
      b("character", "MARA"),
      b("dialogue", "Here it is."),
    );
    const shapes = texts(sidesDoc(selfCued, "MARA"));
    expect(shapes).toEqual([
      "centered:MARA — SIDES",
      "sceneHeading:SCENE 1",
      "character:MARA",
      "dialogue:I put it down somewhere.",
      "character:MARA",
      "dialogue:Here it is.",
    ]);
  });

  test("a cue with only a wryly under it can't cue anyone", () => {
    const wrylyOnly = doc(
      b("sceneHeading", "SCENE 1"),
      b("character", "JONAH"),
      b("parenthetical", "a long look"),
      b("character", "MARA"),
      b("dialogue", "Say it."),
    );
    expect(texts(sidesDoc(wrylyOnly, "MARA"))).toEqual([
      "centered:MARA — SIDES",
      "sceneHeading:SCENE 1",
      "character:MARA",
      "dialogue:Say it.",
    ]);
  });

  test("drops the dual flag so a half-column pair lays out sequentially", () => {
    const dual = doc(
      b("sceneHeading", "SCENE 1"),
      b("character", "JONAH"),
      b("dialogue", "Together—"),
      b("character", "MARA", { dual: true, extension: "(O.S.)" }),
      b("dialogue", "Together—"),
    );
    const sides = sidesDoc(dual, "MARA");
    const cue = sides.content.find(
      (blk) => blk.type === "character" && blk.content?.[0]?.type === "text" && blk.content[0].text === "MARA",
    );
    expect(cue?.attrs?.dual).toBeUndefined();
    expect(cue?.attrs?.extension).toBe("(O.S.)"); // the rest of the attrs survive
  });

  test("cue-in name matching ignores the cue's extension", () => {
    const withExt = doc(
      b("sceneHeading", "SCENE 1"),
      b("character", "MARA (O.S.)"),
      b("dialogue", "Anyone home?"),
      b("character", "MARA"),
      b("dialogue", "…I'll let myself in."),
    );
    // Both cues are MARA, so no cue-in between them.
    const shapes = texts(sidesDoc(withExt, "MARA"));
    expect(shapes.filter((s) => s.startsWith("character:"))).toEqual([
      "character:MARA (O.S.)",
      "character:MARA",
    ]);
  });

  test("notes in the cueing speech don't leak into the cue-in", () => {
    const noted = doc(
      b("sceneHeading", "SCENE 1"),
      b("character", "JONAH"),
      {
        type: "dialogue",
        content: [
          { type: "text", text: "Leave the key." },
          { type: "note", content: [{ type: "text", text: "check prop list" }] },
        ],
      },
      b("character", "MARA"),
      b("dialogue", "Take it."),
    );
    const sides = sidesDoc(noted, "MARA");
    const cueIn = sides.content[3];
    expect(cueIn.content?.[0]).toMatchObject({ text: "Leave the key." });
  });

  test("acts fold into the scene label and reset the cue memory — never a page-forcing act block", () => {
    const acts = doc(
      b("act", "ACT ONE"),
      b("scene", "SCENE 1"),
      b("character", "JONAH"),
      b("dialogue", "End of act one."),
      b("act", "ACT TWO"),
      b("scene", "SCENE 1"),
      b("character", "MARA"),
      b("dialogue", "Later."),
    );
    // Both shipped formats give `act` startsNewPage, so emitting act blocks
    // would open a multi-act side with a run of near-empty sheets. The act
    // rides the scene label instead (the appearances.ts convention), and no
    // cue-in crosses the act break.
    expect(texts(sidesDoc(acts, "MARA"))).toEqual([
      "centered:MARA — SIDES",
      "scene:ACT TWO · SCENE 1",
      "character:MARA",
      "dialogue:Later.",
    ]);
  });

  test("a single-act play keeps its scene labels unqualified", () => {
    const oneAct = doc(
      b("act", "ACT ONE"),
      b("scene", "SCENE 2"),
      b("character", "MARA"),
      b("dialogue", "Just us."),
    );
    expect(texts(sidesDoc(oneAct, "MARA"))).toContain("scene:SCENE 2");
  });

  test("a slug heading detailing a `scene` block travels with it, unqualified twice", () => {
    const detailed = doc(
      b("act", "ACT ONE"),
      b("act", "ACT TWO"),
      b("scene", "SCENE 1"),
      b("sceneHeading", "INT. KITCHEN — NIGHT"),
      b("character", "MARA"),
      b("dialogue", "Home."),
    );
    expect(texts(sidesDoc(detailed, "MARA"))).toEqual([
      "centered:MARA — SIDES",
      "scene:ACT TWO · SCENE 1",
      "sceneHeading:INT. KITCHEN — NIGHT",
      "character:MARA",
      "dialogue:Home.",
    ]);
  });
});
