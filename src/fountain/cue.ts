// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a cue divides into a name and an extension (docs/engineering/fountain-model.md#FOUN-D100).
 *
 * `MARA (V.O.)` is MARA speaking in voice-over, not a character called
 * "MARA (V.O.)". There are two readings, for two jobs, and every caller uses one
 * of them from here — four hand-copied readers had drifted into requiring a
 * space before the bracket, so `MARA(V.O.)` was a second character.
 *
 *  - **Who speaks** (`cueName`): everything before the first "(" that follows
 *    a name. Every extension goes, so `MARA (V.O.) (CONT'D)` and `MARA(V.O.)`
 *    are both MARA. The Cast, part sizes, appearances, sides, autocomplete and
 *    Find count by it.
 *  - **How the file holds it** (`splitCueExtension`): the LAST parenthetical is
 *    the character block's `extension` attribute and the rest is its text. The
 *    parser reads a cue this way; the editor bridge splits a cue on its way out
 *    the same way, and the layout engine splits one that arrives as text.
 *
 * No imports: the layout engine and the PDF use this without the parser.
 */

/** A trailing parenthetical, with the whitespace in front of it. */
const TRAILING_EXTENSION = /\s*(\([^)]*\))\s*$/;

/**
 * The cue's last parenthetical and the index where it begins (whitespace before
 * it included), or null. `at` is an index into `text`, so a caller holding runs
 * or positions can cut at it.
 */
export function trailingExtension(text: string): { at: number; extension: string } | null {
  const m = TRAILING_EXTENSION.exec(text);
  return m ? { at: m.index, extension: m[1] } : null;
}

/** The file's reading: `"MARA (V.O.)"` → `{ name: "MARA", extension: "(V.O.)" }`. */
export function splitCueExtension(text: string): { name: string; extension: string | null } {
  const t = trailingExtension(text);
  return t
    ? { name: text.slice(0, t.at).trim(), extension: t.extension }
    : { name: text.trim(), extension: null };
}

/** A name's last character, then the first "(" after it (spaces allowed between). */
const NAME_THEN_BRACKET = /\S\s*\(/;

/**
 * Where the speaker's name ends: before the first "(" that has a name in front
 * of it, and any spaces between. -1 when there is none, and the whole cue is the
 * name — including a cue that STARTS with a bracket, like `(beat)`, which is a
 * mistyped parenthetical rather than an extension.
 */
export function cueNameEnd(text: string): number {
  const m = NAME_THEN_BRACKET.exec(text);
  return m ? m.index + 1 : -1;
}

/** The speaker's name as typed: trimmed, case kept. `"Mara (o.s.)"` → `"Mara"`. */
export function cueNamePart(text: string): string {
  const end = cueNameEnd(text);
  return (end === -1 ? text : text.slice(0, end)).trim();
}

/** Who speaks, upper-cased — the key a character is counted under. */
export function cueName(text: string): string {
  return cueNamePart(text).toUpperCase();
}
