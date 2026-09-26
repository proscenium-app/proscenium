// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { createSpeller, type Lexicon } from "./speller";

/**
 * A stub lexicon: a fixed word list plus a fixed suggestion table. The real
 * hunspell data is exercised by the app, not by unit tests — what is worth
 * pinning here is the script-shaped logic wrapped AROUND a dictionary.
 */
function lexicon(known: string[], suggestions: Record<string, string[]> = {}): Lexicon {
  const set = new Set(known);
  return {
    correct: (word) => set.has(word),
    suggest: (word) => suggestions[word] ?? [],
  };
}

describe("known — the plain cases", () => {
  const spell = createSpeller(lexicon(["waits", "door"]));
  it("accepts a word in the dictionary", () => {
    expect(spell.known("waits")).toBe(true);
  });
  it("rejects one that is not", () => {
    expect(spell.known("waitss")).toBe(false);
  });
  it("normalizes a curly apostrophe to the straight one the dictionary has", () => {
    const s = createSpeller(lexicon(["doesn't"]));
    expect(s.known("doesn’t")).toBe(true);
  });
});

describe("known — a dropped g is not a typo", () => {
  const spell = createSpeller(lexicon(["talking", "nothing", "coming"]));
  it("restores the letter", () => {
    expect(spell.known("talkin'")).toBe(true);
    expect(spell.known("nothin'")).toBe(true);
  });
  it("still rejects a genuine misspelling of the elided form", () => {
    expect(spell.known("tallkin'")).toBe(false);
  });
  it("does not invent a word by adding g to anything", () => {
    expect(spell.known("zzz'")).toBe(false);
  });
});

describe("known — a possessive is its stem", () => {
  const spell = createSpeller(lexicon(["Mara", "boys"]));
  it("checks the stem of a singular possessive", () => {
    expect(spell.known("Mara's")).toBe(true);
  });
  it("checks the stem of a plural possessive", () => {
    expect(spell.known("boys'")).toBe(true);
  });
  it("leaves a contraction alone — the apostrophe is not at the end", () => {
    const s = createSpeller(lexicon(["doesn't"]));
    expect(s.known("doesn't")).toBe(true);
    expect(s.known("doesnt")).toBe(false);
  });
});

describe("known — the cast is a dictionary", () => {
  const spell = createSpeller(lexicon(["waits"]), ["VRONSKY", "Thessaly Junction"]);
  it("accepts an injected name whatever its case", () => {
    expect(spell.known("Vronsky")).toBe(true);
    expect(spell.known("vronsky")).toBe(true);
    expect(spell.known("VRONSKY")).toBe(true);
  });
  it("accepts the possessive of an injected name", () => {
    expect(spell.known("Vronsky's")).toBe(true);
  });
  it("does not accept a near miss", () => {
    expect(spell.known("Vronskie")).toBe(false);
  });
});

describe("suggest", () => {
  it("offers the dictionary's corrections", () => {
    const spell = createSpeller(lexicon([], { recieve: ["receive", "relieve"] }));
    expect(spell.suggest("recieve")).toEqual(["receive", "relieve"]);
  });
  it("puts the possessive back, so accepting one fixes the name", () => {
    const spell = createSpeller(lexicon([], { Marra: ["Mara"] }));
    expect(spell.suggest("Marra's")).toEqual(["Mara's"]);
  });
  it("offers the restored spelling for an elision, apostrophe and all", () => {
    const spell = createSpeller(lexicon([], { tallking: ["talking"] }));
    expect(spell.suggest("tallkin'")).toEqual(["talking"]);
  });
  it("never offers the word that is already typed", () => {
    const spell = createSpeller(lexicon([], { colour: ["colour", "color"] }));
    expect(spell.suggest("colour")).toEqual(["color"]);
  });
  it("keeps a bare apostrophe only where a plural possessive can carry one", () => {
    const spell = createSpeller(lexicon([], { boyz: ["boys", "boy"] }));
    expect(spell.suggest("boyz'")).toEqual(["boys'", "boy"]);
  });
  it("dedupes across the forms it tried", () => {
    const spell = createSpeller(lexicon([], { "hous'": ["house"], hous: ["house", "hours"] }));
    expect(spell.suggest("hous'")).toEqual(["house", "hours'"]);
  });
  it("honours the limit", () => {
    const spell = createSpeller(lexicon([], { a: ["b", "c", "d", "e"] }));
    expect(spell.suggest("a", 2)).toEqual(["b", "c"]);
  });
  it("is empty when the dictionary has nothing close", () => {
    expect(createSpeller(lexicon([])).suggest("qwertyuiop")).toEqual([]);
  });
});
