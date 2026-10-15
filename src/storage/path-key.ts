// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A Windows path: on a drive (`C:\`) or a share (`\\server\`). Its separator
 * is `\`, and `/` is one too. Every other path is a Mac's, where `\` is a
 * character a name may hold. Paths inside a play are always `/`; only a
 * folder's or an opened file's whole path is the system's own.
 */
export function isWindowsPath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\)/.test(path);
}

/** A whole path without the separators it ends with; a root keeps its own. */
export function trimSeparators(path: string): string {
  const trimmed = path.replace(isWindowsPath(path) ? /[\\/]+$/ : /\/+$/, "");
  if (trimmed === "") return path.slice(0, 1);
  return /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
}

function lastSeparator(path: string): number {
  return isWindowsPath(path)
    ? Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
    : path.lastIndexOf("/");
}

/** The last name in a whole path. */
export function baseName(path: string): string {
  const trimmed = trimSeparators(path);
  return trimmed.slice(lastSeparator(trimmed) + 1);
}

/** The folder a whole path is in; a root is its own. */
export function parentOf(path: string): string {
  const trimmed = trimSeparators(path);
  const i = lastSeparator(trimmed);
  if (isWindowsPath(trimmed)) return i <= 2 ? trimmed.slice(0, 2) + "\\" : trimmed.slice(0, i);
  return i <= 0 ? "/" : trimmed.slice(0, i);
}

/** A whole folder path and a path inside it (`/` between its names), joined as the system writes it. */
export function joinPath(folder: string, inside: string): string {
  const windows = isWindowsPath(folder);
  const base = trimSeparators(folder);
  const sep = windows ? "\\" : "/";
  const rest = windows ? inside.replace(/\//g, "\\") : inside;
  return base.endsWith(sep) ? base + rest : base + sep + rest;
}

/** Where `child` is inside `folder`, with `/` between its names; null when it is not inside. */
export function relativeTo(child: string, folder: string): string | null {
  const f = pathKey(folder);
  const c = pathKey(child);
  const prefix = f.endsWith("/") ? f : `${f}/`;
  if (!c.startsWith(prefix)) return null;
  const names = trimSeparators(child).split(isWindowsPath(child) ? /[\\/]/ : "/");
  return names.slice(names.length - c.slice(prefix.length).split("/").length).join("/");
}

/** docs/app/keeping-work/storage-and-file-format.md#STOR-D4: one NFC, case-insensitive comparison rule. Keys are never I/O
 * paths: retain the name returned by the directory listing for reads/writes. A
 * Windows path's key has `/` for its separators, as a Mac's does. */
export function pathKey(path: string): string {
  const slashed = isWindowsPath(path) ? path.replace(/\\/g, "/") : path;
  return slashed.normalize("NFC").replace(/\/+$/, "").toLowerCase().normalize("NFC");
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
