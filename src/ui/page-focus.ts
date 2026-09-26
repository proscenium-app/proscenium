// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * "Put the cursor on this item's page once it is ready" (docs/app/preferences-and-help/accessibility.md#A11Y-4).
 *
 * New ▸ Document opened the page in a pane and left the keyboard in the binder:
 * the new row had dropped into rename mode, so the writer's first words renamed
 * the file, and Enter left focus on nothing. Nothing could do better, because
 * the two halves never met. What knows the page is new — the binder, the Cast,
 * the store — cannot reach into a pane, and the page cannot take the cursor
 * the moment it is asked: it mounts when its buffer arrives, and its editor is
 * ready a task after that. So one side asks here, and the other answers when
 * it can:
 *
 * - `requestPageFocus(id)`: a document or a sheet made from the Cast asks as
 *   soon as it exists; a character or a script named in the binder asks when
 *   Enter or Escape leaves the name field.
 * - `usePageTarget(id, target)`: a page offers itself while it is mounted. Its
 *   `focus()` puts the caret where the writer's first words go.
 *
 * A request is consumed once, when focus lands on the page. Until then it
 * waits, and it never forces:
 *
 * - **Never over a layer.** While a menu, sheet or alert is up (ui/layers.ts),
 *   the page does not take the keyboard from it. A menu hands focus back to
 *   what opened it when it closes, so the page's focus has to land after that.
 * - **Never from a hidden page.** Focusing inside a `hidden` pane does nothing;
 *   the target says when it is on screen.
 * - **Never over the writer.** A pointer press or a key anywhere drops it —
 *   they have gone somewhere themselves — and so does focus found in a text
 *   field or another editor.
 * - **Never late.** It lapses after a few seconds, so a page opened later on
 *   never takes the cursor for a request made long before.
 */
import { useEffect, useRef } from "react";
import { anyLayerOpen } from "./layers";

/** What a page offers while it can take the cursor. */
export interface PageTarget {
  /** Focus is on this page now. */
  hasFocus(): boolean;
  /** The page is mounted and on screen, so focusing it would land. */
  ready(): boolean;
  /** Put the caret where the writer's first words go, and focus the page. */
  focus(): void;
}

export interface PageFocusEnv {
  now(): number;
  later(run: () => void, ms: number): void;
  /** A menu, sheet or alert holds the keyboard. */
  layerOpen(): boolean;
  /** Focus is in a text field or an editor, where the writer may be typing. */
  typingSomewhere(): boolean;
}

/** How long a request waits for its page. A read from iCloud can take seconds. */
export const PAGE_FOCUS_WAIT_MS = 10_000;
/** How often a waiting request looks again: a layer closing and a pane un-hiding say nothing. */
export const PAGE_FOCUS_RETRY_MS = 50;

export function createPageFocus(env: PageFocusEnv) {
  let wanted: { id: string; until: number } | null = null;
  const targets = new Map<string, Set<PageTarget>>();
  let scheduled = false;

  /** One look. True while there is still something to wait for. */
  function attempt(): boolean {
    if (!wanted) return false;
    if (env.now() > wanted.until) {
      wanted = null;
      return false;
    }
    const pages = [...(targets.get(wanted.id) ?? [])];
    if (pages.some((p) => p.hasFocus())) {
      wanted = null;
      return false;
    }
    if (env.layerOpen()) return true;
    const page = pages.find((p) => p.ready());
    if (!page) return true;
    if (env.typingSomewhere()) {
      wanted = null;
      return false;
    }
    page.focus();
    if (page.hasFocus()) {
      wanted = null;
      return false;
    }
    return true;
  }

  /**
   * Looks on a later task, never inside the call that asked: a request made
   * from a key in the binder's name field has to wait for React to take the
   * field away, or the field would still hold focus and read as typing.
   */
  function schedule(ms: number) {
    if (scheduled || !wanted) return;
    scheduled = true;
    env.later(() => {
      scheduled = false;
      if (attempt()) schedule(PAGE_FOCUS_RETRY_MS);
    }, ms);
  }

  return {
    request(id: string) {
      wanted = { id, until: env.now() + PAGE_FOCUS_WAIT_MS };
      schedule(0);
    },
    /** Drop the request: all of them, or only the one for `id`. */
    cancel(id?: string) {
      if (!id || wanted?.id === id) wanted = null;
    },
    /** The item whose page is waited on, if any. */
    pending(): string | null {
      return wanted?.id ?? null;
    },
    /** Offer a page for `id`. Returns the withdrawal. */
    register(id: string, target: PageTarget): () => void {
      let set = targets.get(id);
      if (!set) targets.set(id, (set = new Set()));
      set.add(target);
      if (wanted?.id === id) schedule(0);
      return () => {
        set.delete(target);
        if (set.size === 0 && targets.get(id) === set) targets.delete(id);
      };
    },
  };
}

/** Keys that are only held, never pressed at something: ⌘ shows the element bar's keys. */
const MODIFIERS = new Set(["Meta", "Shift", "Control", "Alt", "CapsLock", "Fn"]);

function typingSomewhere(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit", "reset"].includes(el.type);
}

const pageFocus = createPageFocus({
  now: () => Date.now(),
  later: (run, ms) => void setTimeout(run, ms),
  layerOpen: anyLayerOpen,
  typingSomewhere,
});

if (typeof window !== "undefined") {
  // Capture phase, so the press that makes a request (a menu row's click, ⏎ in
  // the name field) has already gone by when the request is made, and only a
  // later one drops it.
  window.addEventListener("pointerdown", () => pageFocus.cancel(), true);
  window.addEventListener(
    "keydown",
    (e) => {
      if (!MODIFIERS.has(e.key)) pageFocus.cancel();
    },
    true,
  );
}

/** Ask for the cursor on `id`'s page, once the page can take it. */
export function requestPageFocus(id: string): void {
  pageFocus.request(id);
}

/**
 * Offer this page for `id` while `target` is non-null. The target is read when
 * a request is answered, not when it was registered, so it can close over
 * whatever the page holds now.
 */
export function usePageTarget(id: string | null, target: PageTarget | null): void {
  const current = useRef(target);
  current.current = target;
  const live = target !== null;
  useEffect(() => {
    if (!id || !live) return;
    return pageFocus.register(id, {
      hasFocus: () => current.current?.hasFocus() ?? false,
      ready: () => current.current?.ready() ?? false,
      focus: () => current.current?.focus(),
    });
  }, [id, live]);
}

/** Whether `el` is in the document and drawn: a node in a `hidden` pane has no boxes. */
export function onScreen(el: Element | null | undefined): boolean {
  return !!el && el.isConnected && el.getClientRects().length > 0;
}
