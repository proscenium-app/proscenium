// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The program: Proscenium's sponsors by level, as the services Worker keeps
 * it from GitHub's Sponsors webhook (services/edge/src/patrons.ts,
 * docs/app/preferences-and-help/settings.md#SET-32).
 *
 * A release asks for it once, before building, and bakes it into the page
 * through vite.config.ts, so the app itself never asks anyone for it. Every
 * other build — dev, smoke, the self-test, a rehearsal — has the empty roll.
 *
 *   node scripts/patrons.mjs            print the live roll
 */
import { readFileSync } from "node:fs";

export const ROLL_URL = "https://patrons.proscenium.ink/v1/roll";
export const LEVELS = /** @type {const} */ (["benefactors", "patrons", "friends"]);
export const EMPTY_ROLL = Object.freeze({ version: 1, benefactors: [], patrons: [], friends: [], private: 0 });
const MAX_NAMES = 500;

/**
 * The roll, held to the Worker's shape: version 1, three lists of printable
 * names of at most 100 characters, and a private count. Throws on anything
 * else, so a bad answer can never reach the page.
 */
export function parseRoll(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1) throw new Error("not a version 1 roll");
  const out = { version: 1, benefactors: [], patrons: [], friends: [], private: 0 };
  let total = 0;
  for (const level of LEVELS) {
    const names = value[level];
    if (!Array.isArray(names)) throw new Error(`${level} is not a list`);
    for (const name of names) {
      if (typeof name !== "string" || !name.trim() || [...name].length > 100 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) {
        throw new Error(`${level} holds a name that is not printable`);
      }
      out[level].push(name);
    }
    total += names.length;
  }
  if (total > MAX_NAMES) throw new Error("more names than a roll holds");
  if (!Number.isInteger(value.private) || value.private < 0 || value.private > 100_000) throw new Error("private is not a count");
  out.private = value.private;
  return out;
}

/** The live roll, or a thrown reason. */
export async function fetchRoll({ fetcher = fetch, timeoutMs = 10_000 } = {}) {
  const response = await fetcher(ROLL_URL, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${ROLL_URL} answered ${response.status}`);
  return parseRoll(await response.json());
}

/** The roll a build bakes in: the file `PROSCENIUM_PATRONS_FILE` names, else the empty one. */
export function bakedRoll(env = process.env) {
  const file = env.PROSCENIUM_PATRONS_FILE;
  return file ? parseRoll(JSON.parse(readFileSync(file, "utf8"))) : { ...EMPTY_ROLL };
}

/** "A", "A and B", "A, B and C". */
export function listed(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The release notes' line for the edition's Benefactors, or null when there are none. */
export function underwritten(roll) {
  return roll.benefactors.length ? `This edition was underwritten by ${listed(roll.benefactors)}.` : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await fetchRoll(), null, 2));
}
