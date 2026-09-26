// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The judgement half of the checker: is this word spelled, and if not, what did
 * the writer mean? Pure and dictionary-agnostic — it takes a `Lexicon` (the
 * English hunspell data in dictionary.ts, or a stub in a test) and wraps it in
 * the rules a script needs.
 *
 * Three of those rules matter enough to name:
 *
 *  - **A dropped g is not a typo.** "talkin'" is checked as "talkin", then as
 *    "talking"; the whole dialect class ("nothin'", "comin'", "goin'") passes
 *    without a word list. When it genuinely IS wrong, the suggestion offered is
 *    the restored spelling, because that is what replaces cleanly.
 *  - **A possessive is its stem.** "Mara's" is checked as "Mara" — and the "'s"
 *    is put BACK on the suggestions, so accepting one fixes the name instead of
 *    eating the apostrophe.
 *  - **The cast is a dictionary.** Names the binder knows, and words the writer
 *    taught the app, are supplied as `extra` and matched case-insensitively.
 *    Without that, every proper noun in the play is a typo (the failure the
 *    native check would have had).
 */

/** The dictionary this wraps — hunspell in the app, a Set in the tests. */
export interface Lexicon {
  correct(word: string): boolean;
  suggest(word: string): string[];
}

export interface Speller {
  /** True when the word is spelled, under any of the forms above. */
  known(word: string): boolean;
  /** Corrections worth offering, best first; empty when there is nothing close. */
  suggest(word: string, limit?: number): string[];
}

/**
 * A form to look up, and how to dress a suggestion made against it back up as a
 * replacement for the token the writer actually typed. The spelled form and the
 * offered replacement are not the same string: looking up "Mara" must not offer
 * to replace "Mara's" with "Mara".
 */
interface Variant {
  word: string;
  /** Applied to each suggestion this variant produces. */
  restore: (suggestion: string) => string;
}

const AS_IS = (s: string) => s;

/** Straight quotes are what the app writes (src-tauri/smartsubs.rs); pasted text may not be. */
function normalize(word: string): string {
  return word.replace(/’/g, "'");
}

/** Trailing-apostrophe forms: possessive stem, and the restored dropped letter. */
const ELIDED = /^(.+?)'([sS]?)$/;

function variants(word: string): Variant[] {
  const out: Variant[] = [{ word, restore: AS_IS }];
  const m = ELIDED.exec(word);
  if (!m) return out;
  const [, stem, s] = m;
  if (s) {
    // "Marra's" → look up "Marra", offer "Mara's".
    out.push({ word: stem, restore: (hit) => `${hit}'${s}` });
    return out;
  }
  // A bare trailing apostrophe is two different things. Dialogue means the
  // dropped g far more often, so that form is offered first and offered whole —
  // the apostrophe goes away with the correction ("tallkin'" → "talking").
  out.push({ word: stem + "g", restore: AS_IS });
  // The other reading is a plural possessive, and only a plural can carry a
  // bare apostrophe: "boyz'" → "boys'", but "hous'" → "house", not "house'".
  out.push({ word: stem, restore: (hit) => (/s$/i.test(hit) ? `${hit}'` : hit) });
  return out;
}

const DEFAULT_LIMIT = 6;

/**
 * A speller over `base`, treating everything in `extra` (cast names, the
 * writer's own additions, words ignored this session) as spelled.
 */
export function createSpeller(base: Lexicon, extra: Iterable<string> = []): Speller {
  const known = new Set<string>();
  for (const word of extra) {
    const w = normalize(word).trim().toLowerCase();
    if (w) known.add(w);
  }

  return {
    known(raw: string): boolean {
      for (const { word } of variants(normalize(raw))) {
        if (known.has(word.toLowerCase())) return true;
        if (base.correct(word)) return true;
      }
      return false;
    },

    suggest(raw: string, limit = DEFAULT_LIMIT): string[] {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const { word, restore } of variants(normalize(raw))) {
        for (const hit of base.suggest(word)) {
          const full = restore(hit);
          // A "suggestion" identical to what is already typed helps nobody.
          if (full === raw || seen.has(full)) continue;
          seen.add(full);
          out.push(full);
          if (out.length >= limit) return out;
        }
      }
      return out;
    },
  };
}
