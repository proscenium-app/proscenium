// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import {
  compareByWeight,
  computeWeights,
  detectNewSpeakers,
  groupCast,
  tierFor,
} from "./cast-weight";
import type { Doc } from "../fountain";

/* --- tiny doc builders, so the fixtures read like a script --- */
const t = (text: string) => ({ type: "text" as const, text });
const b = (type: string, text = "") => ({
  type,
  ...(text ? { content: [t(text)] } : {}),
});
const scene = (n: number) => b("scene", `SCENE ${n}`);
const cue = (name: string) => b("character", name);
const line = (text: string) => b("dialogue", text);
const doc = (...content: ReturnType<typeof b>[]): Doc =>
  ({ type: "doc", content }) as unknown as Doc;

describe("computeWeights", () => {
  test("attributes speech to the cue above it", () => {
    const w = computeWeights(
      doc(scene(1), cue("MARA"), line("One."), cue("JONAH"), line("Two.\nThree.")),
    );
    expect(w.get("MARA")).toMatchObject({ cues: 1, lines: 1, scenes: 1, first: 0 });
    expect(w.get("JONAH")).toMatchObject({ cues: 1, lines: 2, scenes: 1, first: 0 });
  });

  test("a parenthetical keeps the speech attached; anything else ends the speech", () => {
    const w = computeWeights(
      doc(
        scene(1),
        cue("MARA"),
        b("parenthetical", "(quietly)"),
        line("Still hers."),
        b("action", "She leaves."),
        line("Orphaned — nobody said this."),
      ),
    );
    expect(w.get("MARA")!.lines).toBe(1);
  });

  test("does not count parentheticals as lines — '(beat)' is not a line", () => {
    const chatty = computeWeights(
      doc(
        scene(1),
        cue("MARA"),
        b("parenthetical", "(beat)"),
        b("parenthetical", "(beat)"),
        line("Fine."),
      ),
    );
    expect(chatty.get("MARA")!.lines).toBe(1);
  });

  test("counts lyric as speech — a sung line is still a line of the part", () => {
    const w = computeWeights(doc(scene(1), cue("MARA"), b("lyric", "The tide, the tide")));
    expect(w.get("MARA")!.lines).toBe(1);
  });

  test("blank lines inside a speech don't inflate the count", () => {
    const w = computeWeights(doc(scene(1), cue("MARA"), line("One.\n\n\nTwo.")));
    expect(w.get("MARA")!.lines).toBe(2);
  });

  test("counts distinct scenes, not cues, and remembers the first", () => {
    const w = computeWeights(
      doc(
        scene(1),
        cue("MARA"),
        line("a"),
        cue("MARA"),
        line("b"),
        scene(2),
        cue("MARA"),
        line("c"),
        cue("JONAH"),
        line("d"),
      ),
    );
    expect(w.get("MARA")).toMatchObject({ cues: 3, scenes: 2, first: 0 });
    expect(w.get("JONAH")).toMatchObject({ cues: 1, scenes: 1, first: 1 });
  });

  test("a cue never carries its speech across a scene break", () => {
    const w = computeWeights(doc(scene(1), cue("MARA"), scene(2), line("nobody's line")));
    expect(w.get("MARA")!.lines).toBe(0);
  });

  test("strips a cue extension so MARA (O.S.) is MARA", () => {
    const w = computeWeights(doc(scene(1), cue("MARA (O.S.)"), line("a"), cue("MARA"), line("b")));
    expect([...w.keys()]).toEqual(["MARA"]);
    expect(w.get("MARA")!.cues).toBe(2);
  });

  test("an extension typed with no space is still MARA (docs/engineering/fountain-model.md#EDIT-125)", () => {
    const w = computeWeights(
      doc(
        scene(1),
        cue("MARA(V.O.)"),
        line("a"),
        cue("MARA (V.O.) (CONT'D)"),
        line("b"),
        cue("MARA"),
        line("c"),
      ),
    );
    expect([...w.keys()]).toEqual(["MARA"]);
    expect(w.get("MARA")!.cues).toBe(3);
  });

  test("falls back to scene headings when the play has no scene sections", () => {
    const w = computeWeights(
      doc(
        b("sceneHeading", "A kitchen"),
        cue("MARA"),
        line("a"),
        b("sceneHeading", "A pier"),
        cue("MARA"),
        line("b"),
      ),
    );
    expect(w.get("MARA")!.scenes).toBe(2);
  });

  test("an empty or missing doc weighs nothing", () => {
    expect(computeWeights(null).size).toBe(0);
    expect(computeWeights(doc()).size).toBe(0);
  });
});

describe("tierFor", () => {
  // MARA carries the play; JONAH is a real but smaller part; USHER says one line.
  const play = doc(
    scene(1),
    cue("MARA"),
    line("a\nb\nc\nd\ne\nf\ng\nh"),
    cue("JONAH"),
    line("i\nj\nk"),
    scene(2),
    cue("MARA"),
    line("l\nm\nn\no"),
    scene(3),
    cue("USHER"),
    line("p"),
  );
  const w = computeWeights(play);

  test("the biggest part is a principal", () => {
    expect(tierFor("MARA", w, 3)).toBe("principal");
  });

  test("a small speaking part is supporting", () => {
    expect(tierFor("USHER", w, 3)).toBe("supporting");
  });

  test("a name that never speaks is 'mentioned', not ranked last", () => {
    expect(tierFor("THE SEA", w, 3)).toBe("mentioned");
  });

  test("one scene is never reach, however short the play", () => {
    // USHER is in 1 of 3 scenes; in a 2-scene play that arithmetic would say
    // "half the play", which is exactly the wrong answer for a doorman.
    const twoScene = computeWeights(
      doc(scene(1), cue("MARA"), line("a\nb\nc\nd\ne\nf"), scene(2), cue("USHER"), line("p")),
    );
    expect(tierFor("USHER", twoScene, 2)).toBe("supporting");
  });

  test("reach alone can make a principal — a small part that's always on stage", () => {
    // CHORUS says little but is in every scene of a three-scene play.
    const ubiquitous = computeWeights(
      doc(
        scene(1),
        cue("MARA"),
        line("a\nb\nc\nd\ne\nf\ng\nh\ni\nj"),
        cue("CHORUS"),
        line("hm"),
        scene(2),
        cue("CHORUS"),
        line("hm"),
        scene(3),
        cue("CHORUS"),
        line("hm"),
      ),
    );
    expect(ubiquitous.get("CHORUS")!.lines).toBe(3);
    expect(tierFor("CHORUS", ubiquitous, 3)).toBe("principal");
  });

  test("the split is relative, so a two-hander makes both leads principals", () => {
    const twoHander = computeWeights(
      doc(scene(1), cue("A"), line("x\ny\nz\nw"), cue("B"), line("p\nq\nr")),
    );
    expect(tierFor("A", twoHander, 1)).toBe("principal");
    expect(tierFor("B", twoHander, 1)).toBe("principal");
  });

  test("case and stray spacing in the cast list still match the script", () => {
    expect(tierFor("  mara  ", w, 3)).toBe("principal");
  });
});

describe("compareByWeight", () => {
  const w = computeWeights(
    doc(
      scene(1),
      cue("BIG"),
      line("a\nb\nc"),
      cue("EARLY"),
      line("x"),
      scene(2),
      cue("LATE"),
      line("y"),
    ),
  );

  test("more lines wins", () => {
    expect(compareByWeight("BIG", "EARLY", w)).toBeLessThan(0);
  });

  test("equal parts fall back to who speaks first", () => {
    expect(compareByWeight("EARLY", "LATE", w)).toBeLessThan(0);
  });

  test("names with no script presence sort alphabetically, so order is stable", () => {
    expect(compareByWeight("ZED", "ABE", w)).toBeGreaterThan(0);
    expect(compareByWeight("ABE", "ZED", w)).toBeLessThan(0);
  });
});

describe("detectNewSpeakers — what auto-add adds", () => {
  const w = computeWeights(
    doc(scene(1), cue("MARA"), line("a\nb"), cue("JONAH"), line("c"), cue("VOICE"), line("d")),
  );

  test("finds speakers who aren't on the cast list, heaviest first", () => {
    expect(detectNewSpeakers([{ name: "MARA" }], w)).toEqual(["JONAH", "VOICE"]);
  });

  test("nothing to add once everyone is listed — so auto-add converges", () => {
    const all = [{ name: "MARA" }, { name: "JONAH" }, { name: "VOICE" }];
    expect(detectNewSpeakers(all, w)).toEqual([]);
  });

  test("a hidden speaker is never re-added — removal has to stick", () => {
    expect(detectNewSpeakers([{ name: "MARA" }], w, ["VOICE"])).toEqual(["JONAH"]);
  });

  test("matching ignores case and spacing, so 'Mara' isn't added twice", () => {
    expect(detectNewSpeakers([{ name: " mara " }], w)).toEqual(["JONAH", "VOICE"]);
    expect(detectNewSpeakers([{ name: "MARA" }], w, [" voice "])).toEqual(["JONAH"]);
  });

  test("a blank cast row doesn't swallow a real name", () => {
    expect(detectNewSpeakers([{ name: "" }, { name: "MARA" }], w)).toEqual(["JONAH", "VOICE"]);
  });
});

describe("groupCast", () => {
  const play = doc(
    scene(1),
    cue("MARA"),
    line("a\nb\nc\nd\ne\nf\ng\nh"),
    cue("USHER"),
    line("p"),
    scene(2),
    cue("MARA"),
    line("i\nj"),
  );
  const w = computeWeights(play);
  const entries = [{ name: "USHER" }, { name: "GHOST" }, { name: "MARA" }];

  test("groups into tiers, heaviest first inside each", () => {
    const groups = groupCast(entries, w, 2);
    expect(groups.map((g) => g.label)).toEqual(["Principals", "Supporting", "Mentioned"]);
    expect(groups[0]!.indices.map((i) => entries[i]!.name)).toEqual(["MARA"]);
    expect(groups[1]!.indices.map((i) => entries[i]!.name)).toEqual(["USHER"]);
    expect(groups[2]!.indices.map((i) => entries[i]!.name)).toEqual(["GHOST"]);
  });

  test("returns indices into the caller's array, so grouping never rewrites the list", () => {
    const groups = groupCast(entries, w, 2);
    const all = groups.flatMap((g) => g.indices).sort();
    expect(all).toEqual([0, 1, 2]);
  });

  test("empty tiers are dropped — an all-principal cast is one plain list", () => {
    const both = computeWeights(doc(scene(1), cue("A"), line("x\ny"), cue("B"), line("p\nq")));
    const groups = groupCast([{ name: "A" }, { name: "B" }], both, 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("Principals");
  });

  test("a cast list with nothing in it produces no groups", () => {
    expect(groupCast([], w, 2)).toEqual([]);
  });

  test("every entry lands in exactly one group, even duplicates and blanks", () => {
    const messy = [{ name: "MARA" }, { name: "MARA" }, { name: "" }, { name: "unknown" }];
    const groups = groupCast(messy, w, 2);
    const placed = groups.flatMap((g) => g.indices).sort();
    expect(placed).toEqual([0, 1, 2, 3]);
  });
});
