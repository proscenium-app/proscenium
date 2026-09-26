// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Progress on the Plays screen: each play's length in pages (docs/app/keeping-work/storage-and-file-format.md#STOR-121).
 *
 * It was scenes, read off the card records in the play file, because discovery
 * never opened a script. Pages cost more: a read and a pagination per play. The
 * count is the layout engine's (src/layout/engine.ts) in the play's own format,
 * so the number is the one the element bar and the PDF give. Two things keep the
 * Plays screen from waiting on it:
 *
 * - **It is counted in the background** (use-play-pages.ts), a play at a time:
 *   rows come up with a dash, and pages fill in.
 * - **It is cached in app data** (docs/app/keeping-work/storage-and-file-format.md#STOR-D10, `plays/<id>/cache/pages.json`),
 *   keyed by the script, its modified time and the format, so a play is
 *   counted again only when its script changed — here or on another device — or
 *   its format did. Never in the play file: a count is derivable from the
 *   script, and docs/app/keeping-work/storage-and-file-format.md#STOR-D5 sends everything derivable to the cache.
 *
 * A format this Mac does not have (one made on another machine) shows a dash,
 * as a play with no script does: never a page count in a format the play does
 * not use.
 */
import { DEFAULT_FORMAT_ID, type FormatRegistry, type FormatSpec } from "../format";
import { parse } from "../fountain";
import { paginateDoc } from "../layout";
import { playStore, vault } from "../storage";
import type { VaultPlay } from "./vault-plays";

export type PlayPages =
  | { kind: "pages"; pages: number }
  /** The play names a format this Mac does not have. */
  | { kind: "no-format"; format: string }
  /** No script to count, a play file that needs repair, or a script that would not read. */
  | { kind: "unknown" };

/** Where a play's count is kept, inside its app-data directory. */
export const PAGES_CACHE = "cache/pages.json";

/** What a count was taken from. The same key, the same count. */
export interface PagesKey {
  script: string;
  modified: string;
  format: string;
  /** The resolved format, fingerprinted: an edit in the format designer counts again. */
  spec: string;
}

/** FNV-1a over the format as JSON: not a secret, only a change detector. */
export function specFingerprint(spec: FormatSpec): string {
  let hash = 0x811c9dc5;
  const text = JSON.stringify(spec);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** A script's pages in `spec`: the engine's count, as the element bar shows it. */
export function countPages(fountain: string, spec: FormatSpec): number {
  const { doc, frontMatter } = parse(fountain);
  return paginateDoc(doc, spec, { frontMatter }).pages.length;
}

/** The count a cache file holds for `key`, or null when it holds another one (or nothing usable). */
export function cachedPages(raw: string | null, key: PagesKey): number | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<PagesKey> & { pages?: unknown };
    const same = c.script === key.script && c.modified === key.modified && c.format === key.format && c.spec === key.spec;
    return same && Number.isInteger(c.pages) && (c.pages as number) >= 0 ? (c.pages as number) : null;
  } catch {
    return null;
  }
}

export interface PageCountIo {
  read: (rel: string) => Promise<string>;
  cacheRead: (playId: string) => Promise<string | null>;
  cacheWrite: (playId: string, content: string) => Promise<void>;
}

const appIo: PageCountIo = {
  read: async (rel) => (await vault.read(rel)).content,
  cacheRead: (playId) => playStore.read(playId, PAGES_CACHE),
  cacheWrite: (playId, content) => playStore.write(playId, PAGES_CACHE, content),
};

/**
 * One play's pages, from its cache when the script and format are the ones it
 * was counted in. `counted` is true when the engine ran, which is the part that
 * costs, and the part worth saying when it is done.
 */
export async function playPages(
  play: VaultPlay,
  registry: FormatRegistry,
  io: PageCountIo = appIo,
): Promise<{ pages: PlayPages; counted: boolean }> {
  if (play.problem || !play.script) return { pages: { kind: "unknown" }, counted: false };
  const format = play.format ?? DEFAULT_FORMAT_ID;
  const spec = registry.get(format);
  if (!spec) return { pages: { kind: "no-format", format }, counted: false };
  // No modified time, no key: counted every time rather than trusted blind.
  const key: PagesKey | null = play.scriptModified
    ? { script: play.script, modified: play.scriptModified, format, spec: specFingerprint(spec) }
    : null;
  if (key) {
    const hit = cachedPages(await io.cacheRead(play.id).catch(() => null), key);
    if (hit !== null) return { pages: { kind: "pages", pages: hit }, counted: false };
  }
  let pages: number;
  try {
    pages = countPages(await io.read(play.script), spec);
  } catch {
    return { pages: { kind: "unknown" }, counted: false };
  }
  if (key) await io.cacheWrite(play.id, `${JSON.stringify({ ...key, pages })}\n`).catch(() => {});
  return { pages: { kind: "pages", pages }, counted: true };
}
