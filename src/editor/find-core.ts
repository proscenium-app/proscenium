// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The search itself — pure, DOM-free, ProseMirror-free (it takes a plain list of
 * blocks), so the interesting part of find/replace is testable on its own.
 *
 * Two things make this a playwright's search rather than a generic one:
 *
 *  1. **Scope is an element or a speaker.** A playwright rarely wants every
 *     "water" in the file; they want it *in dialogue*, or *in stage directions*,
 *     or *in MARA's speeches*. The document is already typed blocks and the cue
 *     above a speech is already known, so scoping is nearly free and is the
 *     feature worth having. Plain full-text is the fallback, not the goal.
 *  2. **A match knows what kind of block it is in**, because replacing inside a
 *     character cue is a rename, not a replace: the printed cast page, the
 *     `characters/<slug>.md` sheet and the sidecar would all still say the old
 *     name, so the play would end up half-renamed. Callers use `blockType` to
 *     refuse those rather than split a character in two.
 *  3. **A match knows whether it touches a comment.** Comments are Fountain
 *     notes living inside the script (docs/app/writing/comments.md#COMM-D2), so find reaches them —
 *     and a Replace All that rewrote them would put words in a collaborator's
 *     mouth, or break a `[[id:…]]` scene anchor. Replace leaves them alone and
 *     says how many it left (docs/app/writing/comments.md#COMM-D9).
 *
 * Positions are the CALLER's coordinates. Each block hands over its characters
 * paired with the position each one starts at (`chars`), so a match maps back
 * exactly — across marks (a bolded syllable mid-word), across notes, and without
 * ever crossing a line break, which is represented as a "\n" that no query
 * character can match into.
 */

/** One searchable character of a block: the char, and where it lives. */
export interface IndexedChar {
  ch: string;
  /** Position of this character in the caller's coordinate space. */
  pos: number;
  /** True inside a comment or note (`[[ ]]`), which Replace never touches. */
  inNote?: boolean;
}

/** A block as the search sees it. */
export interface SearchBlock {
  /** Node type name — `dialogue`, `action`, `character`, … */
  type: string;
  /** ALL-CAPS name of the cue this block belongs to, if any. A `character`
   *  block is its own speaker; a speech carries the cue above it. */
  speaker: string | null;
  chars: IndexedChar[];
}

export interface FindMatch {
  from: number;
  to: number;
  /** Block type the match sits in — `character` means "this is a rename". */
  blockType: string;
  speaker: string | null;
  /**
   * True when any matched character is inside a comment. A match that merely
   * runs INTO one counts: replacing it would cut across the note's edge.
   */
  inNote: boolean;
}

/** Where to look. `element` lists node type names; `speaker` is a cue name. */
export type FindScope =
  | { kind: "all" }
  | { kind: "element"; types: readonly string[] }
  | { kind: "speaker"; name: string };

export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  scope: FindScope;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  // Insensitive by default, but it genuinely matters here: cues are ALL CAPS, so
  // a sensitive search is how you find the cue MARA without every "Mara" in the
  // stage directions.
  caseSensitive: false,
  wholeWord: false,
  scope: { kind: "all" },
};

/** Blocks a speech attaches to a cue — the same set the page reads as one speech. */
const SPEECH = new Set(["dialogue", "parenthetical", "lyric"]);

/** Does this block fall inside the scope? */
export function inScope(block: SearchBlock, scope: FindScope): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "element") return scope.types.includes(block.type);
  // A speaker scope means the words that character SAYS — their speeches and
  // wrylies, not the cue line itself (searching "MARA" scoped to MARA would
  // otherwise only ever find her own name).
  return SPEECH.has(block.type) && block.speaker === scope.name;
}

const WORD = /[\p{L}\p{N}_]/u;

function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORD.test(ch);
}

/**
 * Every match of `query` in `blocks`, in document order.
 *
 * Matches never span a block, so a replace can never weld two elements
 * together, and never span a line break inside one (the "\n" standing in for a
 * break is not something a query can match through).
 */
export function findMatches(
  blocks: readonly SearchBlock[],
  query: string,
  opts: FindOptions,
): FindMatch[] {
  const out: FindMatch[] = [];
  if (!query) return out;
  const needle = opts.caseSensitive ? query : query.toLowerCase();

  for (const block of blocks) {
    if (!inScope(block, opts.scope)) continue;
    const raw = block.chars.map((c) => c.ch).join("");
    const hay = opts.caseSensitive ? raw : raw.toLowerCase();
    let at = hay.indexOf(needle);
    while (at !== -1) {
      const end = at + needle.length;
      const spansBreak = needle.includes("\n")
        ? false
        : hay.slice(at, end).includes("\n");
      const wordOk =
        !opts.wholeWord ||
        (!isWordChar(raw[at - 1]) && !isWordChar(raw[end]));
      if (!spansBreak && wordOk) {
        let inNote = false;
        for (let i = at; i < end && !inNote; i++) inNote = block.chars[i].inNote === true;
        out.push({
          from: block.chars[at].pos,
          // The end is the last matched character's position plus its width;
          // every indexed char is one position wide.
          to: block.chars[end - 1].pos + 1,
          blockType: block.type,
          speaker: block.speaker,
          inNote,
        });
      }
      // Advance by one so overlapping occurrences ("aa" in "aaa") are all found.
      at = hay.indexOf(needle, at + 1);
    }
  }
  return out;
}

/** The match at or after `pos` — where "find again" resumes from the caret. */
export function matchAtOrAfter(matches: readonly FindMatch[], pos: number): number {
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].from >= pos) return i;
  }
  return matches.length ? 0 : -1;
}

/** Step the current match, wrapping at both ends. */
export function stepIndex(index: number, count: number, delta: number): number {
  if (count === 0) return -1;
  if (index < 0) return delta > 0 ? 0 : count - 1;
  return ((index + delta) % count + count) % count;
}

/** Why a replace will not touch a match, or null when it may. */
export function heldBack(match: FindMatch): "note" | "cue" | null {
  // A comment first: it is a comment wherever it sits, cue line included.
  if (match.inNote) return "note";
  if (match.blockType === "character") return "cue";
  return null;
}

/**
 * Matches a replace is allowed to touch, and how many it must leave alone.
 *
 * Character cues are excluded: changing "MARA" in a cue leaves the printed cast
 * page, the character sheet and the sidecar all saying MARA, so the play
 * half-renames and one character quietly becomes two. Comments are excluded
 * too (docs/app/writing/comments.md#COMM-D9): they are someone's note about the script, not the
 * script, and a `[[id:…]]` anchor rewritten by accident unbinds a scene's card.
 * The counts come back so the writer is TOLD rather than left to discover it —
 * a silent skip would be its own trap.
 */
export function partitionForReplace(matches: readonly FindMatch[]): {
  replaceable: FindMatch[];
  cueMatches: FindMatch[];
  noteMatches: FindMatch[];
} {
  const replaceable: FindMatch[] = [];
  const cueMatches: FindMatch[] = [];
  const noteMatches: FindMatch[] = [];
  for (const m of matches) {
    const why = heldBack(m);
    (why === "note" ? noteMatches : why === "cue" ? cueMatches : replaceable).push(m);
  }
  return { replaceable, cueMatches, noteMatches };
}

/**
 * The sentence the find bar shows for what Replace will leave alone, or null.
 * One sentence for both reasons, so the bar never stacks two warnings.
 */
export function leftAloneNote(cues: number, notes: number): string | null {
  const parts: string[] = [];
  if (cues > 0) parts.push(`${cues} in ${cues === 1 ? "a character cue" : "character cues"}`);
  if (notes > 0) parts.push(`${notes} in ${notes === 1 ? "a comment" : "comments"}`);
  return parts.length ? `${parts.join(" and ")} — left alone` : null;
}
