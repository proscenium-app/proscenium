// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the store may ask of one open editor's buffer: write it now, and say
 * what it holds that the disk does not. Several editors can show one sheet (two
 * panes), so each registers its own (MaterialEditor, OutlineNotes, useWorkspace).
 */
export interface MaterialBuffer {
  flush: () => void | Promise<void>;
  /** The whole file as this buffer would write it, while it holds unsaved words; else null. */
  unsaved: () => string | null;
  /** Those words with the version they are written on; else null. */
  words: () => ParkedWords | null;
  /**
   * The whole file as the page shows it, unsaved or not: what "Keep this one"
   * keeps when the writer's own words are all that differs and none are unsaved.
   */
  page: () => string;
}

/**
 * Unsaved words, as an editor holds them or leaves them for the next: the whole
 * file as they would write it (for the outline notes, the body), and the version
 * they are written on. A save still on its way counts as that version, so the
 * next save builds on it rather than meeting a false choice when it lands; the
 * store knows which saves never landed, and what each was built on.
 */
export interface ParkedWords {
  full: string;
  base: string;
}

/**
 * What an editor gets back for registering its buffer. `take` hands it words
 * an earlier editor of the same file left unsaved a moment ago (a tab switched
 * back to, a pane split) — each to one editor only. `release` is its going
 * away: what it still holds unsaved is kept for the next editor, and for Versions
 * if the file goes away first. A release after its play has closed is ignored:
 * leaving the play already kept those words.
 */
export interface BufferLease<T> {
  take: () => T | null;
  release: (words: T | null) => void;
}

/**
 * Whether words written on `base` go on top of `onDisk`: they do if the file
 * is still that version, or if every version between was a save that never
 * landed — each built on the one before, back to what the disk holds.
 * `failed` maps a save's text to the version it was built on.
 */
export function buildsOn(base: string, onDisk: string, failed: ReadonlyMap<string, string>): boolean {
  return builtOn(base, onDisk, failed) === onDisk;
}

/**
 * The version words written on `base` are really written on: back through
 * every save that never landed, stopping at `onDisk` if the walk reaches it.
 */
export function builtOn(base: string, onDisk: string, failed: ReadonlyMap<string, string>): string {
  let at = base;
  for (let steps = 0; at !== onDisk && steps <= failed.size; steps++) {
    const before = failed.get(at);
    if (before === undefined) break;
    at = before;
  }
  return at;
}

/** Remember a save that did not land, and what it was built on; the oldest go first. */
export function rememberFailed(failed: Map<string, string>, sent: string, before: string): void {
  if (sent === before) return;
  failed.delete(sent);
  failed.set(sent, before);
  while (failed.size > 16) {
    const oldest = failed.keys().next().value;
    if (oldest === undefined) break;
    failed.delete(oldest);
  }
}
