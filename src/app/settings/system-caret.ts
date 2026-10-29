// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Mac's setting for a text cursor that does not blink, kept current: asked
 * at launch and again whenever the window comes forward (caret.rs), and put on
 * the document as `data-caret="steady"`, which is what holds the caret a
 * document draws (src/markdown/caret.ts, materials.css).
 *
 * The engine's own caret follows the setting by itself. A caret the page draws
 * does not, and no media query carries the setting, so without this a writer
 * who had asked the Mac for a steady cursor got a blinking one in documents
 * and a steady one in the script.
 *
 * The page hears no event when the setting changes. A writer who changes it is
 * in System Settings, and coming back brings the window forward, which is when
 * it asks: as it does for the Mac's accent colour (system-accent.ts).
 */
import { settings as ipc } from "../../storage/ipc";

let started = false;
let asking = false;
/** A reason to ask arrived while an answer was on its way: ask once more after it. */
let askAgain = false;

/** Say on the document whether the drawn caret holds steady. */
export function applySteadyCaret(root: HTMLElement, steady: boolean): void {
  if (steady) root.dataset.caret = "steady";
  else delete root.dataset.caret;
}

async function ask(): Promise<void> {
  if (asking) {
    askAgain = true;
    return;
  }
  asking = true;
  try {
    applySteadyCaret(document.documentElement, await ipc.steadyCaret());
  } finally {
    asking = false;
    if (askAgain) {
      askAgain = false;
      void ask();
    }
  }
}

/** Ask now, and whenever the window comes forward. Once per launch; a second call does nothing. */
export function startSystemCaret(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void ask();
  const again = () => {
    if (document.visibilityState !== "hidden") void ask();
  };
  window.addEventListener("focus", again);
  document.addEventListener("visibilitychange", again);
  // The dev vault's stand-in for coming back from System Settings.
  window.addEventListener("proscenium:system-caret", again);
}
