// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The speller the app's own checker draws its underlines from (spellcheck.ts,
 * docs/app/writing/editor-ux.md#EDIT-D116), made of everything a play's words
 * are checked against: the dictionary of the play's language, the stage's own
 * words, the cast, the words the writer taught it and the ones ignored this
 * session. The script holds one (PlayEditor), and so do the documents where
 * the system's own spelling may not run in them (the app's
 * document-spelling.tsx): one recipe, so the two cannot come to disagree about
 * what a word is.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createSpeller, STAGE_WORDS, type Lexicon, type Speller } from "../spell";
import { loadDictionary } from "../spell/dictionary";

export interface SpellerSource {
  /** Check Spelling as You Type. Off, there is no speller, and no dictionary is fetched. */
  on: boolean;
  /** The play's language, which chooses the dictionary. */
  language: string;
  /** The cast's names: a name is spelled however the play spells it. */
  cast?: readonly string[];
  /** Words the writer has taught the checker, from app settings. */
  learnedWords: readonly string[];
}

export interface SpellerHeld {
  /** Null while the dictionary loads, when it cannot, and while the check is off. */
  speller: Speller | null;
  /** Let a word stand until the app restarts: the correction menu's "Ignore". */
  ignore: (word: string) => void;
}

export function useSpeller({ on, language, cast, learnedWords }: SpellerSource): SpellerHeld {
  /**
   * The dictionary, fetched the first time the check is wanted and then held
   * for the session (the module caches it across editors too). A failure is
   * silence: no dictionary means no underlines, never a dialog over the page.
   */
  const [loadedDictionary, setLoadedDictionary] = useState<{
    language: string;
    lexicon: Lexicon | null;
  } | null>(null);
  const lexicon = loadedDictionary?.language === language ? loadedDictionary.lexicon : null;
  useEffect(() => {
    if (!on) return;
    let live = true;
    void loadDictionary(language).then(
      (loaded) => {
        if (live) setLoadedDictionary({ language, lexicon: loaded });
      },
      () => {
        /* no dictionary this session */
      },
    );
    return () => {
      live = false;
    };
  }, [on, language]);

  /** Words waved through until the app restarts — the menu's "Ignore". */
  const [ignored, setIgnored] = useState<string[]>([]);
  const ignore = useCallback((word: string) => {
    setIgnored((prev) =>
      prev.some((w) => w.toLowerCase() === word.toLowerCase()) ? prev : [...prev, word],
    );
  }, []);

  /**
   * Made again whenever anything behind it moves — the dictionary arriving, a
   * name entering the cast, a word learned or ignored — and only then: a new
   * speller is a full pass over the page it is given to.
   */
  const speller = useMemo(
    () =>
      on && lexicon
        ? createSpeller(lexicon, [...STAGE_WORDS, ...(cast ?? []), ...learnedWords, ...ignored])
        : null,
    [on, lexicon, cast, learnedWords, ignored],
  );

  return { speller, ignore };
}
