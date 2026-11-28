// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A menu item that acts on the script, chosen while the keyboard is in a field
 * that keeps it: a comment's (docs/app/writing/comments.md#COMM-78).
 *
 * A comment's field leaves ⌘B to the menu bar, as a plain field does, and the
 * menu's Bold took the keyboard into the script to bold the script. The field
 * stayed open with the comment's words, out of reach of the keys that end it:
 * Esc and ⌘⏎ went to the script, which has no comment open, and the words
 * typed next went into the script. The comment could be neither saved nor
 * left by a key. So such an item is not the script's: the writer pressed its
 * chord in the field.
 */

/** The menu's items that act on the script, and take the keyboard into it to do so. */
const SCRIPT_ITEMS = new Set(["line-break", "page-break", "spelling-next", "comment"]);

/** Element items are `el-<node>` and marks `mark-<mark>` (menu-actions.ts). */
export function actsOnScript(id: string): boolean {
  return id.startsWith("el-") || id.startsWith("mark-") || SCRIPT_ITEMS.has(id);
}

/** A key, as a field is offered it. */
export interface FieldKey {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * What a field that keeps the keyboard is given of a script item: the one
 * chord it answers, ⌘⏎, which saves a comment there as its own key does; null
 * for every other item, which does nothing. On a Mac the page hears a chord
 * before its menu bar, and the menu has only what the page left alone, so the
 * field's own ⌘⏎ has run and Page Break never comes; where the menu hears a
 * chord first, as an iPad's does (docs/engineering/cross-platform.md#PLAT-76),
 * the field has its ⌘⏎ only this way. A PC's is Ctrl+Enter.
 */
export function fieldKeyFor(id: string, pc: boolean): FieldKey | null {
  if (id !== "page-break") return null;
  return { key: "Enter", code: "Enter", metaKey: !pc, ctrlKey: pc };
}

/** Enough of an element to ask where it is. */
interface Placed {
  closest(selector: string): unknown;
}

/**
 * The element with the keyboard, when it is in a field that keeps the
 * keyboard from the menu's script items: a comment's field marks itself so
 * (src/comments/Thread.tsx). Null otherwise.
 */
export function fieldKeepingKeyboard<T extends Placed>(active: T | null): T | null {
  return active && typeof active.closest === "function" && active.closest("[data-keeps-keyboard]")
    ? active
    : null;
}
