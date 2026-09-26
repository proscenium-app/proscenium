// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the words are — the tokenizer the checker runs on (docs/app/writing/editor-ux.md#EDIT-D100
 * docs/app/writing/editor-ux.md#EDIT-D116). Pure: a string in, word spans out, so the interesting
 * decisions are testable without an editor.
 *
 * A play is not an essay, and the difference is entirely in this file:
 *
 *  - **ALL-CAPS is a convention, not prose.** Sound cues and first-appearance
 *    names ("a door SLAMS", "MARA enters") are shouted on purpose, and a name
 *    the dictionary has never heard of is the normal case in a script. Caps
 *    tokens are skipped rather than second-guessed — the same instinct that
 *    keeps cues and headings out of the check entirely (schema.ts NO_SPELLCHECK).
 *  - **A capital means a name.** "Craigslist", "Sophia", the town the play is
 *    set in: a word that starts with a capital is almost always a proper noun,
 *    and underlining one says the app knows the writer's world better than they
 *    do. So it is skipped too. The price is a typo in the first word of a
 *    sentence ("Teh door opens") going unmarked — taken on purpose, because a
 *    play is full of names and a missed first-word typo is rare by comparison.
 *  - **Dialogue elides.** "talkin'", "'em", "ol'" are how people speak and how
 *    playwrights write them down. The apostrophe stays INSIDE the token so the
 *    speller can put the dropped letter back (speller.ts) instead of underlining
 *    every dropped g in the play.
 *  - **A hyphen joins two words, not one.** "half-remembered" is checked as
 *    "half" and "remembered": a compound no dictionary lists is still two words
 *    every dictionary knows.
 *
 * Offsets are into the string handed in; the caller owns the mapping back to
 * document positions (spellcheck.ts).
 */

/** One checkable token, and the half-open range it occupies in the source. */
export interface WordSpan {
  /** The token as written — apostrophes and all, so the speller sees the elision. */
  word: string;
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * A run of letters/digits, apostrophes allowed after the first character. The
 * hyphen is deliberately absent (compounds split), and the leading apostrophe
 * of an elision ("'em") is left outside the token — the bare word is what the
 * dictionary knows, and it is what the underline should cover.
 */
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

/** Addresses and URLs are typed, not spelled. Any token inside one is skipped. */
const LINK = /\S+@\S+\.\S+|(?:https?:\/\/|www\.)\S+/gi;

const HAS_LETTER = /\p{L}/u;
const HAS_LOWER = /\p{Ll}/u;
/** An upper- or title-case first letter: "Mara", "McTavish". */
const STARTS_CAPITAL = /^[\p{Lu}\p{Lt}]/u;
const HAS_DIGIT = /\p{N}/u;
const TRAILING_APOSTROPHES = /['’]+$/;

/** Character ranges covered by a URL or an email address. */
function linkRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(LINK)) {
    const start = m.index ?? 0;
    out.push([start, start + m[0].length]);
  }
  return out;
}

/**
 * True for a token the checker should never look at. Skipping is cheap and
 * silent; every rule here is one class of false positive that would otherwise
 * be underlined on every page.
 */
function skip(word: string): boolean {
  // A serial number, a year, a measurement: "1953", "mp3s", "3rd".
  if (HAS_DIGIT.test(word) || !HAS_LETTER.test(word)) return true;
  // "I", "a", and the orphan "s" of a possessive split across a mark.
  if (word.replace(TRAILING_APOSTROPHES, "").length < 2) return true;
  // ALL-CAPS: a sound cue, an initialism, or a name being introduced.
  if (!HAS_LOWER.test(word)) return true;
  // Capitalized: a name, a place, a brand.
  if (STARTS_CAPITAL.test(word)) return true;
  return false;
}

/** Every checkable word in `text`, in order. */
export function wordsIn(text: string): WordSpan[] {
  const links = linkRanges(text);
  const out: WordSpan[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const word = m[0];
    const start = m.index ?? 0;
    const end = start + word.length;
    if (skip(word)) continue;
    if (links.some(([from, to]) => start < to && end > from)) continue;
    out.push({ word, start, end });
  }
  return out;
}
