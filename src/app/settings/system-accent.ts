// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Follow Mac, kept current: the Mac's accent colour (accent.rs), asked at
 * launch and again whenever the window comes forward, and put on the document
 * (ui/system-accent.ts). The answer is remembered, so the next launch paints
 * its first frame in it (use-accent.ts, before React mounts).
 *
 * The page hears no event when the writer changes the accent in System
 * Settings. But a writer who does is in System Settings, and coming back
 * brings Proscenium's window forward, which is when it asks: the same moment
 * the workspace uses to look for changes made elsewhere.
 */
import { useSyncExternalStore } from "react";
import { settings as ipc } from "../../storage/ipc";
import { applySystemAccent, rememberedSystemAccent } from "../../ui/system-accent";

let current: string | null = rememberedSystemAccent();
const listeners = new Set<() => void>();
let started = false;
let asking = false;
/** A reason to ask arrived while an answer was on its way: ask once more after it. */
let askAgain = false;

async function ask(): Promise<void> {
  if (asking) {
    askAgain = true;
    return;
  }
  asking = true;
  try {
    const hex = await ipc.systemAccent();
    if (hex !== current) {
      current = hex;
      applySystemAccent(hex);
      for (const listener of [...listeners]) listener();
    }
  } finally {
    asking = false;
    if (askAgain) {
      askAgain = false;
      void ask();
    }
  }
}

/** Ask now, and whenever the window comes forward. Once per launch; a second call does nothing. */
export function startSystemAccent(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void ask();
  const again = () => {
    if (document.visibilityState !== "hidden") void ask();
  };
  window.addEventListener("focus", again);
  document.addEventListener("visibilitychange", again);
  // The dev vault's stand-in for coming back from System Settings.
  window.addEventListener("proscenium:system-accent", again);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The Mac's accent as it last answered, for Follow Mac's swatch; null where there is no Mac. */
export function useSystemAccent(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
