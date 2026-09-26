// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `nspell` ships JSDoc but no .d.ts. Only the two methods the app calls are
 * declared — a fuller shim would be fiction we'd have to maintain.
 */
declare module "nspell" {
  interface NSpell {
    /** True when the word is spelled, applying the affix rules from the .aff. */
    correct(word: string): boolean;
    /** Corrections, best first; empty when nothing is close. */
    suggest(word: string): string[];
  }
  /** Build a checker from the text of a hunspell affix file and dictionary. */
  export default function nspell(aff: string, dic: string): NSpell;
}
