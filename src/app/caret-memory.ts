// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the writer was, per script.
 *
 * Opening a play used to land at the top of the document, which is the title
 * page — nine tenths of a blank sheet, and the first thing you did was scroll to
 * find your own work. The caret is the writer's place in the play, so it is
 * worth remembering across sessions.
 *
 * App chrome, not project data: it lives in localStorage beside the page-view
 * toggle and the zoom mode, never in the vault. It is a convenience, so every
 * path here fails soft — a missing, stale or out-of-range value just means
 * "start at the top", which is what the app did before.
 */

const PREFIX = "proscenium:caret:";

/** Keyed by vault path, so each script in a play remembers its own place. */
function key(scriptPath: string): string {
  return PREFIX + scriptPath;
}

export function rememberCaret(scriptPath: string, pos: number): void {
  if (!scriptPath || !Number.isFinite(pos) || pos < 0) return;
  try {
    localStorage.setItem(key(scriptPath), String(Math.round(pos)));
  } catch {
    /* chrome preference only */
  }
}

/**
 * The remembered position, clamped into the document that just loaded.
 *
 * Clamping matters: the file may have been edited elsewhere (another editor, a
 * sync, another device) and be shorter than when we last looked, and a position
 * past the end would throw when resolved.
 */
export function recallCaret(scriptPath: string, docSize: number): number | null {
  if (!scriptPath) return null;
  try {
    const raw = localStorage.getItem(key(scriptPath));
    if (raw === null) return null;
    const pos = Number(raw);
    if (!Number.isFinite(pos) || pos <= 0) return null;
    // `docSize` is doc.content.size; the last legal text position is inside the
    // final block, so leave a character of room.
    return Math.min(pos, Math.max(0, docSize - 1));
  } catch {
    return null;
  }
}

export function forgetCaret(scriptPath: string): void {
  try {
    localStorage.removeItem(key(scriptPath));
  } catch {
    /* chrome preference only */
  }
}
