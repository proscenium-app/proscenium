// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What Wrangler said when a command failed, and whether the same command may
 * succeed when it is simply made again. scripts/release.mjs reads and writes
 * the update tracks in R2 with it.
 */
import { stripVTControlCharacters } from "node:util";

/**
 * Wrangler's own error line and the note after it. Never the "Logs were
 * written to" line it ends with: that log is in a folder removed when the
 * command returns, so naming it names nothing.
 */
export function wranglerSaid(stderr, status = null) {
  const lines = stripVTControlCharacters(stderr ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/Logs were written to/.test(l));
  const at = lines.findIndex((l) => l.includes("[ERROR]"));
  const said = (at >= 0 ? lines.slice(at, at + 2) : lines.slice(-1)).join(" ");
  return said.slice(0, 400) || `wrangler exited ${status}`;
}

/**
 * A failure in passing: the network dropped or timed out, or Cloudflare
 * answered 408, 429 or a 5xx. A missing object, a refused token or a bad
 * request fails the same way every time, and is not made again.
 */
export function inPassing(said) {
  return /fetch failed|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR_|timed out|- (408|429|5\d\d):|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out|try again/i.test(
    said ?? "",
  );
}
