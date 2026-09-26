// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Only numeric locations in our own compiled bundle cross IPC. Never error messages or paths. */
export interface PageFrame {
  lineno: number;
  colno: number;
}
export interface PageErrorSignal {
  name: string;
  frames: PageFrame[];
}
const NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
  "InternalError",
  "UnhandledRejection",
  "PageError",
  "AbortError",
  "DataCloneError",
  "InvalidStateError",
  "NotFoundError",
  "NotAllowedError",
  "NotSupportedError",
  "SecurityError",
  "QuotaExceededError",
  "NetworkError",
  "TimeoutError",
  "InvalidCharacterError",
  "HierarchyRequestError",
  "IndexSizeError",
]);
function frame(location: string, origin: string): PageFrame | null {
  const found = /^(.*):(\d+):(\d+)$/.exec(location);
  if (!found) return null;
  try {
    const url = new URL(found[1]);
    if (url.origin !== origin && !(url.protocol === "tauri:" && url.hostname === "localhost"))
      return null;
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/assets\/[a-zA-Z0-9_-]+\.js$/.test(url.pathname)
    )
      return null;
    const lineno = Number(found[2]),
      colno = Number(found[3]);
    return [lineno, colno].every((n) => Number.isInteger(n) && n >= 1 && n <= 10_000_000)
      ? { lineno, colno }
      : null;
  } catch {
    return null;
  }
}
/** WebKit's fn@url and Chromium's at fn (url) both become numbers, youngest first. */
export function stackFrames(
  stack: string,
  origin = globalThis.location?.origin ?? "tauri://localhost",
): PageFrame[] {
  const lines = stack.slice(0, 128 * 1024).split("\n");
  const chromium = lines.some((line) => /^\s+at\s/.test(line));
  const frames: PageFrame[] = [];
  for (const line of lines) {
    if (chromium && !/^\s+at\s/.test(line)) continue;
    const found = line.match(/((?:[a-z][a-z0-9+.-]*:\/\/)[^\s()@]*:\d+:\d+)\)?\s*$/i);
    const parsed = found && frame(found[1], origin);
    if (parsed) frames.push(parsed);
    if (frames.length === 64) break;
  }
  return frames;
}
export function pageErrorSignal(
  thrown: unknown,
  fallbackFrame = "",
  fallbackName = "Error",
): PageErrorSignal {
  if (!(thrown instanceof Error))
    return { name: NAMES.has(fallbackName) ? fallbackName : "Error", frames: [] };
  const name = NAMES.has(thrown.name) ? thrown.name : "Error";
  let frames = typeof thrown.stack === "string" ? stackFrames(thrown.stack) : [];
  if (!frames.length && fallbackFrame) frames = stackFrames(fallbackFrame);
  return { name, frames };
}
