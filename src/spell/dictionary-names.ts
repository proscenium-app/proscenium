// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The words the dictionary also carries as a name: a stem with a capital
 * that takes a possessive (`Charlie/M`, `Will/M`, `Rose/M`), lower-cased.
 * `It`, which is there with a capital and no possessive, is not one. Read for
 * the names in the directions (editor/names-in-directions.ts), which leave an
 * ordinary word alone unless the writer gave it a capital and it is a name.
 */
export function namesIn(dic: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const line of dic.split("\n")) {
    const slash = line.indexOf("/");
    if (slash < 1 || !/^\p{Lu}/u.test(line)) continue;
    if (line.slice(slash + 1).includes("M")) names.add(line.slice(0, slash).toLowerCase());
  }
  return names;
}
