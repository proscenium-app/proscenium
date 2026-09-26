// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The spell checker: a tokenizer that knows what a script looks like (words.ts)
 * and a speller that knows how dialogue is written down (speller.ts), over the
 * hunspell English dictionary.
 *
 * Everything exported here is PURE — no assets, no DOM, no ProseMirror — so it
 * runs under `bun test`. The dictionary loader is deliberately NOT re-exported:
 * import "./dictionary" directly (see the note at the top of that file).
 */
export { wordsIn } from "./words";
export type { WordSpan } from "./words";
export { createSpeller } from "./speller";
export type { Lexicon, Speller } from "./speller";
export { STAGE_WORDS } from "./stage-words";
