// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How much of the window the screen's keyboard leaves, for anything placed
 * against the bottom of the window: a menu, the element menu, autocomplete,
 * the spelling menu, a tutorial's card.
 *
 * The keyboard's claim is `--kb-inset` on the root element, which
 * app/use-keyboard-inset.ts keeps (from the keyboard's own frame where the
 * system gives it, and the visual viewport elsewhere); the shell already
 * rides above it. A popup placed against `innerHeight` alone opened under the
 * keyboard. On a Mac or a PC the inset is 0, and this is `innerHeight`.
 */
import { useEffect, useState } from "react";

/** The points the keyboard covers at the bottom of the window. */
export function keyboardInset(): number {
  if (typeof document === "undefined") return 0;
  const raw = document.documentElement.style.getPropertyValue("--kb-inset");
  const inset = Number.parseFloat(raw);
  return Number.isFinite(inset) && inset > 0 ? inset : 0;
}

/** The bottom of what the writer can see: the window's height above the keyboard. */
export function visibleHeight(): number {
  return Math.max(0, window.innerHeight - keyboardInset());
}

/**
 * The keyboard's inset, read again whenever the root's style changes: for a
 * popup already open when the keyboard comes, goes or changes its bar. Placed
 * only as it opened, the spelling menu stayed where the screen's keyboard then
 * came up over it, the inset landing a moment after the tap that opened it
 * (app/inset-gate.ts).
 */
export function useKeyboardInsetNow(): number {
  const [inset, setInset] = useState(keyboardInset);
  useEffect(() => {
    const read = () => setInset(keyboardInset());
    const watch = new MutationObserver(read);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    read();
    return () => watch.disconnect();
  }, []);
  return inset;
}
