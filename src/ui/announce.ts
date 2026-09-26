// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Words for a screen reader, when something changed that has no focus to carry it.
 *
 * A toast was `role="status"` on an element that mounted with its text already
 * inside, and WebKit does not reliably announce a live region that arrives
 * already full — the region has to exist first and then change. So there are
 * two regions, created once and never removed, and every announcement is a
 * change of their text. ProseMirror plugins are not React, so this is a plain
 * function rather than a hook: the editor calls it too.
 */

import { portalHost } from "./portal-host";

type Kind = "polite" | "assertive";
type Scope = { regions: Partial<Record<Kind, HTMLElement>>; pending: Record<Kind, number> };
const scopes = new WeakMap<HTMLElement, Scope>();

function scope(host: HTMLElement): Scope {
  let state = scopes.get(host);
  if (!state) {
    state = { regions: {}, pending: { polite: 0, assertive: 0 } };
    scopes.set(host, state);
  }
  return state;
}

function region(kind: Kind, host: HTMLElement): HTMLElement {
  const state = scope(host);
  const existing = state.regions[kind];
  if (existing?.isConnected) return existing;
  const el = document.createElement("div");
  el.className = "sr-only";
  el.setAttribute("aria-live", kind);
  el.setAttribute("aria-atomic", "true");
  el.setAttribute("role", kind === "polite" ? "status" : "alert");
  el.dataset.announcer = kind;
  host.appendChild(el);
  state.regions[kind] = el;
  return el;
}

/** Create both regions ahead of the first message, so the first one is heard. */
export function ensureAnnouncer(host?: HTMLElement) {
  if (typeof document === "undefined") return;
  const target = host ?? portalHost();
  region("polite", target);
  region("assertive", target);
}

/**
 * Say `message`. Clearing and refilling on the next tick makes the same words
 * announce twice in a row — "Dialogue", Tab, Tab back, "Dialogue" — which an
 * unchanged text node would swallow.
 */
export function announce(message: string, opts: { assertive?: boolean } = {}) {
  if (typeof document === "undefined" || !message) return;
  const kind = opts.assertive ? "assertive" : "polite";
  const host = portalHost();
  const pending = scope(host).pending;
  const el = region(kind, host);
  el.textContent = "";
  window.clearTimeout(pending[kind]);
  pending[kind] = window.setTimeout(() => {
    // An action may close its confirmation before React commits. Route that
    // action's result to the newly active, already-mounted modal scope.
    if (!host.isConnected) announce(message, opts);
    else if (portalHost() === host) el.textContent = message;
  }, 40);
}
