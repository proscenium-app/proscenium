// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure cast-name helpers shared by the character-autocomplete extension and the
 * workspace (docs/app/writing/editor-ux.md#EDIT-D112). No DOM, no ProseMirror,
 * and — by design — no vault import: the editor never reads disk. The cast is
 * injected (binder names) and merged with the cues already in the open doc.
 *
 * Names are matched ALL-CAPS because cues render ALL-CAPS; the matching prefix
 * STOPS at the first "(" so a name still matches once an extension like
 * "(O.S.)" is being typed (critique R-CHARACTER-EXT).
 */
import type { Doc } from "../fountain";
import { cueNamePart } from "../fountain/cue";

/**
 * The name portion of a cue: everything before the first "(" (an extension),
 * trimmed — fountain/cue.ts's reading, the one the Cast counts by.
 * `"MARA (O.S.)"` → `"MARA"`, `"MARA(O.S.)"` → `"MARA"`, `"MARA"` → `"MARA"`.
 */
export function cuePrefix(text: string): string {
  return cueNamePart(text);
}

/** Upper-case, trim, drop empties, dedupe, and sort — the canonical pool form. */
export function normalizeCast(names: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const raw of names) {
    const name = cuePrefix(raw).toUpperCase();
    if (name) seen.add(name);
  }
  return [...seen].sort();
}

/**
 * Candidates for `query` from an already-normalized `pool`: names that begin
 * with the query but aren't already exactly it (nothing to complete). Query is
 * upper-cased to match the pool.
 */
export function matchCast(query: string, pool: string[]): string[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  return pool.filter((name) => name !== q && name.startsWith(q));
}

/**
 * Suggestions for an EMPTY cue, best first (land in a character element and
 * the next speaker is one keystroke away). Dialogue
 * alternates, so the top suggestion is the previous DIFFERENT speaker (two
 * cues back); then the other speakers by recency; then the rest of the pool.
 * `cuesBefore` is the document-order list of cues above the caret.
 */
export function rankSuggestions(pool: string[], cuesBefore: string[]): string[] {
  const recency: string[] = [];
  for (const raw of cuesBefore) {
    const name = cuePrefix(raw).toUpperCase();
    if (!name) continue;
    const already = recency.indexOf(name);
    if (already !== -1) recency.splice(already, 1);
    recency.push(name);
  }
  recency.reverse(); // most recent speaker first
  const ordered = recency.length >= 2 ? [recency[1], ...recency] : recency;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of [...ordered, ...pool]) {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Cue names used in a parsed body doc — for the "previously used cues" source. */
export function cuesFromDoc(doc: Doc): string[] {
  const out: string[] = [];
  for (const block of doc.content ?? []) {
    if (block.type !== "character") continue;
    const text = (block.content ?? [])
      .map((n) => (n.type === "text" ? n.text : ""))
      .join("");
    const name = cuePrefix(text).toUpperCase();
    if (name) out.push(name);
  }
  return out;
}

/** A minimal binder-tree shape — kept local so the editor never imports workspace. */
export interface CastSource {
  type: string;
  title?: string;
  children?: CastSource[];
}

/** Normalized cast names drawn from a binder's `character`-type items. */
export function castFromBinder(items: CastSource[]): string[] {
  const titles: string[] = [];
  const walk = (nodes: CastSource[]) => {
    for (const n of nodes) {
      if (n.type === "character" && n.title) titles.push(n.title);
      if (n.children) walk(n.children);
    }
  };
  walk(items);
  return normalizeCast(titles);
}
