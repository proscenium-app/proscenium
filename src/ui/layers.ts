// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which floating layer owns the keyboard, and where focus goes when it closes.
 *
 * Menus, sheets and alerts each bind their keys at the WINDOW, in the capture
 * phase, so that Escape reaches them wherever focus happens to be. That was
 * right for one layer and wrong for two: listeners on the same target all run,
 * and `stopPropagation` does not stop a sibling listener. So Escape in the
 * Export sheet's "What to export" popup closed the popup AND the sheet, and
 * Enter on a popup row inside the Title Page sheet ran the sheet's Save. The
 * stack below is the missing rule: only the top layer acts on a key.
 *
 * The second half is focus. Every layer used to leave focus on a node that no
 * longer existed, which a browser resolves to <body> — so after closing any
 * menu, Tab started again from the top of the window and VoiceOver announced
 * nothing at all. A layer now remembers what had focus when it opened and hands
 * it back when it closes, unless something else has deliberately taken it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const stack: number[] = [];
let seq = 0;

/** The same layer stack for editor plugins that mount outside React. */
export function registerLayer() {
  const id = ++seq;
  stack.push(id);
  return {
    isTop: () => stack[stack.length - 1] === id,
    close: () => {
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    },
  };
}

/**
 * Registers a layer while `active`, and returns a function that answers "is
 * this layer on top right now?" — asked at key time, not at render time,
 * because a menu opened inside a sheet changes the answer without re-rendering
 * the sheet.
 */
export function useLayer(active = true): () => boolean {
  const id = useRef(0);
  useEffect(() => {
    if (!active) return;
    const me = ++seq;
    id.current = me;
    stack.push(me);
    return () => {
      const i = stack.lastIndexOf(me);
      if (i >= 0) stack.splice(i, 1);
      if (id.current === me) id.current = 0;
    };
  }, [active]);
  return useCallback(() => id.current !== 0 && stack[stack.length - 1] === id.current, []);
}

/** True while any menu, sheet or alert is up — for global shortcuts to defer to. */
export function anyLayerOpen(): boolean {
  return stack.length > 0;
}

function focusable(el: Element | null): el is HTMLElement {
  return !!el && el instanceof HTMLElement && el.isConnected && el !== document.body;
}

/**
 * Remembers the element that had focus when the layer rendered, and restores it
 * on unmount — but only if focus was left stranded (on <body>, or on a node the
 * layer took with it). A menu item that moves focus on purpose, into the
 * editor or into a sheet it opened, keeps it.
 */
export function useFocusReturn() {
  const [origin] = useState<Element | null>(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  const restore = useCallback(() => {
    if (focusable(origin)) origin.focus({ preventScroll: true });
  }, [origin]);
  useEffect(
    () => () => {
      const now = document.activeElement;
      if (!now || now === document.body || !now.isConnected) restore();
    },
    [restore],
  );
  return restore;
}

const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Everything inside `root` a keyboard can land on, in DOM order, visible only.
 *
 * `tabIndex < 0` is excluded even on a button: a roving composite (a tablist,
 * a radio group) parks its unselected members at -1, and counting them made
 * the sheet's Tab wrap land on the FIRST tab rather than the selected one — a
 * stop the list had deliberately taken away.
 */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest("[inert]"),
  );
}

/** A key that belongs to the control it was pressed on, not to the layer. */
export function keyOwnedByTarget(e: KeyboardEvent, key: "Enter" | " "): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || e.isComposing) return true;
  if (t.isContentEditable || t.closest("textarea")) return true;
  if (key === " " && t.closest("input")) return true;
  return !!t.closest(
    "button, a[href], select, summary, [role='button'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='tab'], [role='switch'], [role='checkbox'], [role='radio'], [role='option']",
  );
}
