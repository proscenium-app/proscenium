// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** docs/app/keeping-work/storage-and-file-format.md#STOR-D4: one NFC, case-insensitive comparison rule. Keys are never I/O
 * paths: retain the name returned by the directory listing for reads/writes. */
export function pathKey(path: string): string {
  return path.normalize("NFC").replace(/\/+$/, "").toLowerCase().normalize("NFC");
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b);
}

/** Rewrite by path segments: NFC and NFD prefixes can have different lengths. */
export function replacePathPrefix(path: string, from: string, to: string): string {
  const parts = path.split("/");
  const count = from.split("/").length;
  if (!samePath(parts.slice(0, count).join("/"), from)) return path;
  return [to, ...parts.slice(count)].join("/");
}

/** Exact spelling wins when an external tool supplied case-colliding files
 * on a case-sensitive disk. An ambiguous alias never chooses either file. */
export function matchingPath(path: string, candidates: Iterable<string>): string | undefined {
  const key = pathKey(path);
  let match: string | undefined;
  let ambiguous = false;
  for (const candidate of candidates) {
    if (candidate === path) return candidate;
    if (pathKey(candidate) !== key) continue;
    if (match !== undefined && match !== candidate) ambiguous = true;
    match = candidate;
  }
  return ambiguous ? undefined : match;
}
