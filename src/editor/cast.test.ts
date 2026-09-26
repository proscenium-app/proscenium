// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  castFromBinder,
  cuePrefix,
  cuesFromDoc,
  matchCast,
  normalizeCast,
  rankSuggestions,
  type CastSource,
} from "./cast";
import { elementLabel } from "./ElementBar";
import { LEADER_ELEMENTS, LEADER_MENU } from "./leader-key";
import { parse } from "../fountain";

describe("cuePrefix — matching stops at the first '(' after the name (R-CHARACTER-EXT)", () => {
  it("returns the bare name unchanged", () => {
    expect(cuePrefix("MARA")).toBe("MARA");
  });
  it("drops an extension so a name still matches while it is typed", () => {
    expect(cuePrefix("MARA (O.S.)")).toBe("MARA");
    expect(cuePrefix("MARA (CONT'D)")).toBe("MARA");
    expect(cuePrefix("MARA (")).toBe("MARA");
  });
  it("trims surrounding whitespace", () => {
    expect(cuePrefix("  MARA  ")).toBe("MARA");
  });
  it("does not split on a leading paren: there is no name in front of it", () => {
    expect(cuePrefix("(beat)")).toBe("(beat)");
  });
  it("drops an extension typed with no space, the way the parser reads one", () => {
    expect(cuePrefix("MARA(V.O.)")).toBe("MARA");
    expect(cuePrefix("MARA(")).toBe("MARA");
  });
});

describe("normalizeCast", () => {
  it("upper-cases, trims, drops empties, dedupes, sorts", () => {
    expect(normalizeCast(["Mara", "jonah", "MARA", "", "  Lena "])).toEqual([
      "JONAH",
      "LENA",
      "MARA",
    ]);
  });
  it("strips extensions via cuePrefix so cues collapse to one entry", () => {
    expect(normalizeCast(["MARA (O.S.)", "MARA"])).toEqual(["MARA"]);
  });
});

describe("matchCast", () => {
  const pool = normalizeCast(["MARA", "MARABEL", "JONAH"]);
  it("offers prefix matches", () => {
    expect(matchCast("MA", pool)).toEqual(["MARA", "MARABEL"]);
  });
  it("is case-insensitive on the query", () => {
    expect(matchCast("ma", pool)).toEqual(["MARA", "MARABEL"]);
  });
  it("excludes an exact match — nothing left to complete", () => {
    expect(matchCast("MARA", pool)).toEqual(["MARABEL"]);
    expect(matchCast("JONAH", pool)).toEqual([]);
  });
  it("returns nothing for an empty query", () => {
    expect(matchCast("", pool)).toEqual([]);
    expect(matchCast("   ", pool)).toEqual([]);
  });
});

describe("cuesFromDoc", () => {
  it("collects cue names (ALL-CAPS, extension-stripped) from the body doc", () => {
    const { doc } = parse(
      ["MARA (O.S.)", "Hello?", "", "JONAH", "Hi.", "", "She waits."].join("\n"),
    );
    expect(cuesFromDoc(doc)).toEqual(["MARA", "JONAH"]);
  });
  it("is empty when there are no cues", () => {
    const { doc } = parse("Just a stage direction.");
    expect(cuesFromDoc(doc)).toEqual([]);
  });
});

describe("castFromBinder — (a) the binder's character items", () => {
  const binder: CastSource[] = [
    { type: "script", title: "The Weight of Water" },
    {
      type: "folder",
      title: "Characters",
      children: [
        { type: "character", title: "Mara" },
        { type: "character", title: "Jonah" },
      ],
    },
    { type: "note", title: "Structure" },
  ];
  it("walks the tree, keeping only character items, normalized", () => {
    expect(castFromBinder(binder)).toEqual(["JONAH", "MARA"]);
  });
  it("returns [] for a binder with no characters", () => {
    expect(castFromBinder([{ type: "script", title: "X" }])).toEqual([]);
  });
});

describe("rankSuggestions — the empty-cue speaker prediction", () => {
  const pool = ["CHAUNCEY", "JAMIE", "MARY", "SAMMY"];

  it("predicts the alternating speaker: two cues back comes first", () => {
    // …CHAUNCEY spoke, then JAMIE; the next cue is most likely CHAUNCEY.
    expect(rankSuggestions(pool, ["CHAUNCEY", "JAMIE"])).toEqual([
      "CHAUNCEY",
      "JAMIE",
      "MARY",
      "SAMMY",
    ]);
  });

  it("orders the tail by recency, then the rest of the pool", () => {
    // Recency: JAMIE (last), CHAUNCEY, MARY. Prediction: CHAUNCEY (two back).
    expect(rankSuggestions(pool, ["MARY", "CHAUNCEY", "JAMIE"])).toEqual([
      "CHAUNCEY",
      "JAMIE",
      "MARY",
      "SAMMY",
    ]);
  });

  it("suggests the lone speaker when only one has spoken", () => {
    expect(rankSuggestions(pool, ["JAMIE"])[0]).toBe("JAMIE");
  });

  it("falls back to the pool order with no cues above", () => {
    expect(rankSuggestions(pool, [])).toEqual(pool);
  });

  it("strips extensions and repeated turns", () => {
    expect(rankSuggestions(pool, ["CHAUNCEY", "JAMIE (O.S.)", "JAMIE"])).toEqual([
      "CHAUNCEY",
      "JAMIE",
      "MARY",
      "SAMMY",
    ]);
  });
});

describe("leader contract (docs/app/writing/editor-ux.md#EDIT-D100)", () => {
  it("maps exactly the contract letters to element node names", () => {
    expect(LEADER_ELEMENTS).toEqual({
      s: "sceneHeading",
      a: "action",
      c: "character",
      d: "dialogue",
      p: "parenthetical",
      t: "transition",
      "1": "act",
      "2": "scene",
      l: "lyric",
      "=": "synopsis",
      n: "note",
      ">": "centered",
      // Not an element type: the leader arms only on an empty block, which is
      // where a forced page break belongs, so it rides the same menu (docs/app/writing/editor-ux.md#EDIT-60).
      "-": "pageBreak",
    });
  });

  it("offers every leader key as a menu row", () => {
    expect(LEADER_MENU.map((r) => r.key).sort()).toEqual(
      Object.keys(LEADER_ELEMENTS).sort(),
    );
  });

  // The node stays `note` (the Fountain name); every label a writer reads or
  // hears says Comment (docs/app/writing/comments.md#COMM-5).
  it("names the note row, and the note itself, as a comment", () => {
    expect(LEADER_MENU.find((r) => r.key === "n")?.label).toBe("Comment");
    expect(LEADER_MENU.filter((r) => /\bnotes?\b/i.test(r.label))).toEqual([]);
    expect(elementLabel("note")).toBe("Comment");
  });
});
