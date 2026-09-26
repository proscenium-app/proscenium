// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_FIND_OPTIONS,
  findMatches,
  leftAloneNote,
  matchAtOrAfter,
  partitionForReplace,
  stepIndex,
  type FindMatch,
  type FindOptions,
  type SearchBlock,
} from "./find-core";

/** A block whose characters start at `start` and run one position each. */
function block(type: string, text: string, speaker: string | null = null, start = 1): SearchBlock {
  return {
    type,
    speaker,
    chars: [...text].map((ch, i) => ({ ch, pos: start + i })),
  };
}

const opts = (patch: Partial<FindOptions> = {}): FindOptions => ({
  ...DEFAULT_FIND_OPTIONS,
  ...patch,
});

describe("find: matching", () => {
  it("finds every occurrence, with positions in the caller's coordinates", () => {
    const b = block("dialogue", "water, water", null, 10);
    const m = findMatches([b], "water", opts());
    expect(m.map((x) => [x.from, x.to])).toEqual([
      [10, 15],
      [17, 22],
    ]);
  });

  it("is case-insensitive by default and sensitive on request", () => {
    const b = block("action", "Water and water");
    expect(findMatches([b], "water", opts())).toHaveLength(2);
    expect(findMatches([b], "water", opts({ caseSensitive: true }))).toHaveLength(1);
  });

  it("finds overlapping occurrences", () => {
    expect(findMatches([block("action", "aaa")], "aa", opts())).toHaveLength(2);
  });

  it("honours whole-word", () => {
    const b = block("dialogue", "water waterfall");
    expect(findMatches([b], "water", opts())).toHaveLength(2);
    expect(findMatches([b], "water", opts({ wholeWord: true }))).toHaveLength(1);
  });

  it("returns nothing for an empty query", () => {
    expect(findMatches([block("action", "water")], "", opts())).toEqual([]);
  });

  /** A match may not weld two elements together, nor cross a soft break. */
  it("never spans a block or a line break", () => {
    const two = [block("action", "one", null, 1), block("action", "two", null, 10)];
    expect(findMatches(two, "onetwo", opts())).toEqual([]);
    const broken = block("dialogue", "one\ntwo");
    expect(findMatches([broken], "one\ntwo".replace("\n", ""), opts())).toEqual([]);
    // …but a query that deliberately contains the break still matches.
    expect(findMatches([broken], "one\ntwo", opts())).toHaveLength(1);
  });

  it("maps positions across a gap in the index (a mark or a note boundary)", () => {
    // "wa" at 5,6 then "ter" at 9,10,11 — as if a note or mark shifted the run.
    const b: SearchBlock = {
      type: "dialogue",
      speaker: "MARA",
      chars: [
        { ch: "w", pos: 5 },
        { ch: "a", pos: 6 },
        { ch: "t", pos: 9 },
        { ch: "e", pos: 10 },
        { ch: "r", pos: 11 },
      ],
    };
    expect(findMatches([b], "water", opts())).toEqual([
      { from: 5, to: 12, blockType: "dialogue", speaker: "MARA", inNote: false },
    ]);
  });

  it("flags a match inside a comment, and one that only runs into it", () => {
    // `She waits [[Sam: waits too long]]` — the note's text starts at 11.
    const outside = [..."She waits "].map((ch, i) => ({ ch, pos: 1 + i }));
    const inside = [..."Sam: waits too long"].map((ch, i) => ({ ch, pos: 11 + i, inNote: true }));
    const b: SearchBlock = { type: "action", speaker: null, chars: [...outside, ...inside] };

    const waits = findMatches([b], "waits", opts());
    expect(waits.map((m) => m.inNote)).toEqual([false, true]);
    // "waits Sam" starts in the action and ends in the comment: still a comment.
    const across = findMatches([b], "waits Sam", opts());
    expect(across).toHaveLength(1);
    expect(across[0].inNote).toBe(true);
  });
});

describe("find: scope is the actual feature", () => {
  const script = [
    block("action", "A tap drips into the water.", null, 1),
    block("character", "MARA", "MARA", 40),
    block("dialogue", "The water again.", "MARA", 50),
    block("character", "JONAH", "JONAH", 70),
    block("dialogue", "Water, water.", "JONAH", 80),
    block("parenthetical", "(watching the water)", "JONAH", 100),
  ];

  it("searches everything by default", () => {
    expect(findMatches(script, "water", opts())).toHaveLength(5);
  });

  it("searches one element type", () => {
    const inDialogue = findMatches(script, "water", opts({
      scope: { kind: "element", types: ["dialogue"] },
    }));
    expect(inDialogue).toHaveLength(3);
    expect(new Set(inDialogue.map((m) => m.blockType))).toEqual(new Set(["dialogue"]));
  });

  it("searches stage directions only", () => {
    expect(
      findMatches(script, "water", opts({ scope: { kind: "element", types: ["action"] } })),
    ).toHaveLength(1);
  });

  it("searches one character's speeches — their words, not their cue line", () => {
    const jonah = findMatches(script, "water", opts({
      scope: { kind: "speaker", name: "JONAH" },
    }));
    // Two in the speech, one in the wryly. Not MARA's, and not the cue itself.
    expect(jonah).toHaveLength(3);
    expect(jonah.every((m) => m.speaker === "JONAH")).toBe(true);
    expect(jonah.some((m) => m.blockType === "character")).toBe(false);
  });

  it("scoping to a speaker does not match their own cue", () => {
    const mara = findMatches(script, "MARA", opts({
      scope: { kind: "speaker", name: "MARA" },
    }));
    expect(mara).toEqual([]);
  });
});

describe("find: navigation", () => {
  const matches: FindMatch[] = [
    { from: 10, to: 15, blockType: "action", speaker: null, inNote: false },
    { from: 40, to: 45, blockType: "dialogue", speaker: "MARA", inNote: false },
  ];

  it("resumes at the first match at or after the caret", () => {
    expect(matchAtOrAfter(matches, 0)).toBe(0);
    expect(matchAtOrAfter(matches, 20)).toBe(1);
    // Past the last one, wrap to the top.
    expect(matchAtOrAfter(matches, 90)).toBe(0);
    expect(matchAtOrAfter([], 0)).toBe(-1);
  });

  it("wraps at both ends", () => {
    expect(stepIndex(0, 2, 1)).toBe(1);
    expect(stepIndex(1, 2, 1)).toBe(0);
    expect(stepIndex(0, 2, -1)).toBe(1);
    expect(stepIndex(-1, 2, 1)).toBe(0);
    expect(stepIndex(-1, 2, -1)).toBe(1);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe("find: replace refuses to half-rename a character", () => {
  it("holds cue matches back and counts them", () => {
    const matches: FindMatch[] = [
      { from: 10, to: 14, blockType: "character", speaker: "MARA", inNote: false },
      { from: 40, to: 44, blockType: "dialogue", speaker: "MARA", inNote: false },
      { from: 60, to: 64, blockType: "action", speaker: null, inNote: false },
    ];
    const { replaceable, cueMatches } = partitionForReplace(matches);
    expect(replaceable.map((m) => m.blockType)).toEqual(["dialogue", "action"]);
    // Reported, not silently dropped — a quiet skip is its own trap.
    expect(cueMatches).toHaveLength(1);
  });
});

describe("find: replace leaves comments alone (docs/app/writing/comments.md#COMM-D9)", () => {
  const matches: FindMatch[] = [
    { from: 10, to: 14, blockType: "dialogue", speaker: "MARA", inNote: false },
    { from: 20, to: 24, blockType: "dialogue", speaker: "MARA", inNote: true },
    { from: 30, to: 34, blockType: "action", speaker: null, inNote: true },
    // A comment sitting on a cue line is a comment first, and counted once.
    { from: 40, to: 44, blockType: "character", speaker: "MARA", inNote: true },
    { from: 50, to: 54, blockType: "character", speaker: "JONAH", inNote: false },
  ];

  it("holds comment matches back and counts them apart from cues", () => {
    const { replaceable, cueMatches, noteMatches } = partitionForReplace(matches);
    expect(replaceable.map((m) => m.from)).toEqual([10]);
    expect(noteMatches.map((m) => m.from)).toEqual([20, 30, 40]);
    expect(cueMatches.map((m) => m.from)).toEqual([50]);
  });

  it("says what it left alone, the way cues were always reported", () => {
    expect(leftAloneNote(0, 0)).toBeNull();
    expect(leftAloneNote(1, 0)).toBe("1 in a character cue — left alone");
    expect(leftAloneNote(0, 3)).toBe("3 in comments — left alone");
    expect(leftAloneNote(0, 1)).toBe("1 in a comment — left alone");
    expect(leftAloneNote(2, 3)).toBe("2 in character cues and 3 in comments — left alone");
  });
});
