// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { wordsIn } from "./words";

/** Just the tokens, for the cases where the offsets are not the point. */
const words = (text: string) => wordsIn(text).map((w) => w.word);

describe("wordsIn — plain prose", () => {
  it("finds the words and where they are", () => {
    expect(wordsIn("she waits.")).toEqual([
      { word: "she", start: 0, end: 3 },
      { word: "waits", start: 4, end: 9 },
    ]);
  });
  it("does not let punctuation into a token", () => {
    expect(words("well — she waits, again...")).toEqual(["well", "she", "waits", "again"]);
  });
  it("keeps an internal apostrophe, so contractions stay whole", () => {
    expect(words("it doesn't matter")).toEqual(["it", "doesn't", "matter"]);
  });
  it("keeps a curly apostrophe too (pasted text arrives with them)", () => {
    expect(words("it doesn’t matter")).toEqual(["it", "doesn’t", "matter"]);
  });
});

describe("wordsIn — a hyphen joins two words, not one", () => {
  it("splits a compound into its parts", () => {
    expect(words("half-remembered")).toEqual(["half", "remembered"]);
  });
  it("treats an em-dash interruption as a boundary", () => {
    expect(words("what the—")).toEqual(["what", "the"]);
  });
});

describe("wordsIn — dialogue elides", () => {
  it("keeps the dropped-g apostrophe inside the token", () => {
    expect(words("talkin' about nothin'")).toEqual(["talkin'", "about", "nothin'"]);
  });
  it("leaves a LEADING apostrophe outside — the bare word is what is checked", () => {
    expect(wordsIn("'em")).toEqual([{ word: "em", start: 1, end: 3 }]);
  });
  it("keeps a possessive whole", () => {
    expect(words("the dog's coat")).toEqual(["the", "dog's", "coat"]);
  });
});

describe("wordsIn — what a script says on purpose is not checked", () => {
  it("skips ALL-CAPS: sound cues and names being introduced", () => {
    expect(words("a door SLAMS and MARA enters")).toEqual(["door", "and", "enters"]);
  });
  it("skips a Capitalized word: a name, a place, a brand", () => {
    expect(words("then Mara McTavish waits")).toEqual(["then", "waits"]);
    expect(words("sold it on Craigslist to Sophia's friend")).toEqual([
      "sold",
      "it",
      "on",
      "to",
      "friend",
    ]);
    expect(words("Élodie waits")).toEqual(["waits"]);
  });
  it("skips the first word of a sentence too — the price of the rule above", () => {
    expect(words("Teh door opens.")).toEqual(["door", "opens"]);
  });
  it("still checks a word with a capital INSIDE it", () => {
    expect(words("an iPhone")).toEqual(["an", "iPhone"]);
  });
  it("skips single letters — 'I', 'a', and a possessive split by a mark", () => {
    expect(words("I saw a thing")).toEqual(["saw", "thing"]);
    expect(words("'s")).toEqual([]);
  });
  it("skips anything with a digit in it", () => {
    expect(words("the 1953 flood, an mp3s file, the 3rd time")).toEqual([
      "the",
      "flood",
      "an",
      "file",
      "the",
      "time",
    ]);
  });
  it("skips inside a URL or an email address", () => {
    expect(words("see https://exampl.com/qq or write to hj@exampl.com now")).toEqual([
      "see",
      "or",
      "write",
      "to",
      "now",
    ]);
  });
});

describe("wordsIn — offsets survive everything above", () => {
  it("reports ranges that slice back to the token", () => {
    const text = "A door SLAMS; Mara's coat is half-soaked.";
    for (const { word, start, end } of wordsIn(text)) {
      expect(text.slice(start, end)).toBe(word);
    }
  });
  it("is empty for a blank line", () => {
    expect(wordsIn("")).toEqual([]);
    expect(wordsIn("   ")).toEqual([]);
  });
});
