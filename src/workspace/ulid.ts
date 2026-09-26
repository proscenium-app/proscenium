// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ULID — the stable identity primitive (docs/app/keeping-work/storage-and-file-format.md#STOR-D3): 26-char Crockford base32,
 * 48-bit timestamp prefix + 80 random bits. Lexicographically sortable and
 * collision-safe. Cross-references are ALWAYS by `id`, never by filename.
 *
 * In-house (no dependency) — the algorithm is fixed and tiny.
 */

// Crockford base32 alphabet (excludes I, L, O, U).
const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RAND_LEN = 16;

function encodeTime(time: number): string {
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = time % 32;
    out = ENC[mod] + out;
    time = Math.floor(time / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RAND_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < RAND_LEN; i++) out += ENC[bytes[i] & 31];
  return out;
}

/** Mint a new ULID. `time` (ms since epoch) is injectable for tests. */
export function ulid(time: number = Date.now()): string {
  return encodeTime(time) + encodeRandom();
}

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function isUlid(s: string): boolean {
  return ULID_RE.test(s);
}
