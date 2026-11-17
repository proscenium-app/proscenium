// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The play's dictionary as the names in the directions ask it
 * (names-in-directions.ts `ordinaryWords`, docs/app/writing/editor-ux.md#EDIT-203).
 * Fetched when the rule is on, whether or not spelling is checked: it is the
 * same dictionary, held once for the session (spell/dictionary.ts).
 */
import { useEffect, useState } from "react";
import { STAGE_WORDS } from "../spell";
import { loadDictionary } from "../spell/dictionary";
import { ordinaryWords, type OrdinaryWord } from "./names-in-directions";

/** Null while the dictionary loads or when it could not be read. */
export function useOrdinaryWords(language: string, wanted: boolean): OrdinaryWord | null {
  const [found, setFound] = useState<{ language: string; ordinary: OrdinaryWord } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    void loadDictionary(language).then(
      // No dictionary for the language: no word is an ordinary one.
      (lexicon) => {
        if (live) setFound({ language, ordinary: ordinaryWords(lexicon, STAGE_WORDS) });
      },
      () => {
        /* unread: one-word names stay as typed this session */
      },
    );
    return () => {
      live = false;
    };
  }, [language, wanted]);
  return found?.language === language ? found.ordinary : null;
}
