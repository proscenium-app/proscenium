// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which script was in front, per play.
 *
 * The page that was open when the app closed should open again. A play
 * opened on its first script whatever the writer had been in, so a second draft
 * beside the first sent them back to the first every time the play opened. The
 * tabs came back (use-panes.ts) and the caret did (caret-memory.ts); the script
 * behind them did not.
 *
 * App chrome, as the caret is: localStorage, never the play folder, keyed by
 * the play's id. Every path fails soft to the first script, which is what the
 * app did before.
 */
import type { BinderItem } from "../workspace";

const PREFIX = "proscenium:script:";

export function rememberScript(playId: string, scriptId: string): void {
  if (!playId || !scriptId) return;
  try {
    localStorage.setItem(PREFIX + playId, scriptId);
  } catch {
    /* chrome preference only */
  }
}

export function recallScript(playId: string): string | null {
  if (!playId) return null;
  try {
    return localStorage.getItem(PREFIX + playId);
  } catch {
    return null;
  }
}

/**
 * The script a play opens on: the one last in front while the binder still
 * holds it as a script, and otherwise the first.
 */
export function scriptToOpen(
  binder: readonly BinderItem[],
  remembered: string | null,
): BinderItem | null {
  let first: BinderItem | null = null;
  let kept: BinderItem | null = null;
  const walk = (items: readonly BinderItem[]) => {
    for (const it of items) {
      if (it.type === "script") {
        first ??= it;
        if (remembered && it.id === remembered) kept = it;
      }
      if (it.children) walk(it.children);
    }
  };
  walk(binder);
  return kept ?? first;
}
