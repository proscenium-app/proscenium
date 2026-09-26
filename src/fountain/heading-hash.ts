// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Scene heading hashing for the card↔scene anchor (docs/app/keeping-work/storage-and-file-format.md#STOR-D6).
 *
 * The hash is over the NORMALIZED, ACT-QUALIFIED heading path — e.g.
 * "ACT TWO ▸ SCENE 1" — so two scenes both named "SCENE 1" in different acts
 * don't collide. It survives reordering (the same scene keeps its hash within an
 * act) and breaks only when the heading or its act is rewritten.
 */

const SEP = " ▸ "; // " ▸ "

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

/** The act-qualified heading path: `<ACT> ▸ <HEADING>` (or just the heading). */
export function headingPath(act: string | undefined | null, heading: string): string {
  const h = normalize(heading);
  return act ? `${normalize(act)}${SEP}${h}` : h;
}

/** 64-bit FNV-1a as 16 lowercase hex chars (deterministic, dependency-free). */
function fnv1a64(s: string): string {
  const mask = (1n << 64n) - 1n;
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(s)) {
    hash = (hash ^ BigInt(byte)) & mask;
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function headingHash(act: string | undefined | null, heading: string): string {
  return fnv1a64(headingPath(act, heading));
}
