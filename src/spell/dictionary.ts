// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Loading the English dictionaries — the ONLY module in src/spell that touches an
 * asset, which is why it is imported directly rather than through index.ts:
 * `?url` is a Vite transform, and a test that pulled it in transitively would
 * not run under `bun test`.
 *
 * The Hunspell data is checked in under dictionaries/ the
 * way formats/*.json are checked in — see scripts/sync-dictionary.mjs for where
 * it comes from and how to refresh it. `?url` (not `?raw`) keeps word lists
 * out of the JavaScript bundle: each ships as its own asset and is fetched
 * when a script first needs that language.
 *
 * One load per language per session, shared by every editor: the promise is the cache, so
 * two callers racing get one fetch and one parse (~50ms).
 */
import nspell from "nspell";
import affUrl from "../../dictionaries/en.aff?url";
import dicUrl from "../../dictionaries/en.dic?url";
import britishAffUrl from "../../dictionaries/en-GB.aff?url";
import britishDicUrl from "../../dictionaries/en-GB.dic?url";
import type { Lexicon } from "./speller";
import { spellingLanguage, type SpellingLanguage } from "../workspace/language";

const pending = new Map<SpellingLanguage, Promise<Lexicon>>();

async function asset(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Spelling dictionary could not be loaded");
  return response.text();
}

async function build(language: SpellingLanguage): Promise<Lexicon> {
  const british = language === "en-GB";
  const [aff, dic] = await Promise.all([
    asset(british ? britishAffUrl : affUrl),
    asset(british ? britishDicUrl : dicUrl),
  ]);
  const checker = nspell(aff, dic);
  return {
    correct: (word) => checker.correct(word),
    suggest: (word) => checker.suggest(word),
  };
}

/**
 * The matching shared lexicon. Rejects only if the asset itself cannot be read,
 * which callers treat as "no spell check this session" — a dictionary that
 * failed to load must never be an error the writer has to dismiss.
 */
export function loadDictionary(value: string): Promise<Lexicon | null> {
  const language = spellingLanguage(value);
  if (!language) return Promise.resolve(null);
  let load = pending.get(language);
  if (!load) {
    load = build(language).catch((error: unknown) => {
      pending.delete(language);
      throw error;
    });
    pending.set(language, load);
  }
  return load;
}
