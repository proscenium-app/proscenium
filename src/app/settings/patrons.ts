// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › About › The Program: Proscenium's sponsors, by level, as the
 * release this copy came from found them (docs/app/preferences-and-help/settings.md#SET-32).
 * The roll is baked in at build time (scripts/patrons.mjs), so nothing here
 * asks anyone for anything, and a build that is not a release has the empty
 * roll.
 */
import type { Roll } from "../../../scripts/patrons.mjs";

export const EMPTY_ROLL: Roll = {
  version: 1,
  benefactors: [],
  patrons: [],
  friends: [],
  private: 0,
};

/** The roll this build carries. */
export const ROLL: Roll =
  typeof __PROSCENIUM_PATRONS__ === "undefined" ? EMPTY_ROLL : __PROSCENIUM_PATRONS__;

/** The levels, in the order a program prints them, each with its tier's name. */
export const LEVELS = [
  { key: "benefactors", label: "Benefactors" },
  { key: "patrons", label: "Patrons" },
  { key: "friends", label: "Friends of the House" },
] as const;

/** The levels that have names, in order; an empty level is left out. */
export function billed(roll: Roll): { label: string; names: string[] }[] {
  return LEVELS.filter((l) => roll[l.key].length > 0).map((l) => ({
    label: l.label,
    names: roll[l.key],
  }));
}

/**
 * The line for the sponsors who asked not to be named: they are counted, and
 * that is all. Null when there are none.
 */
export function inTheWings(roll: Roll): string | null {
  const n = roll.private;
  if (n === 0) return null;
  const named = LEVELS.some((l) => roll[l.key].length > 0);
  if (named)
    return n === 1
      ? "And one more who prefers to remain in the wings."
      : `And ${n} more who prefer to remain in the wings.`;
  return n === 1
    ? "One patron who prefers to remain in the wings."
    : `${n} patrons who prefer to remain in the wings.`;
}

/** Opening night, before anyone has sponsored: the program's one joke. */
export const DARK_HOUSE =
  "The house is dark, the ushers are playing cards in the lobby, and the first name in this program has yet to be written.";

export function isDark(roll: Roll): boolean {
  return roll.private === 0 && LEVELS.every((l) => roll[l.key].length === 0);
}
