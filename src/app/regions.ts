// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ⌃⇥ and ⌃⇧⇥ — move between the window's areas: toolbar, a banner waiting on an
 * answer, binder, the play, inspector, status bar (docs/app/preferences-and-help/accessibility.md#A11Y-7).
 *
 * Tab in the script cycles what the line is, which is the writing feel and not
 * negotiable — and it made the script a keyboard trap. A writer without a
 * pointer who arrived on the page had no key that left it (WCAG 2.1.2), and
 * reaching the inspector from the binder meant walking every row and control
 * between them. Control-Tab is the key macOS itself gives for leaving a text
 * view that keeps Tab for its own use; F6 is the same move in every other
 * desktop idiom, and costs nothing to honour too.
 *
 * The areas are the landmarks the markup already declares, in DOM order, so
 * this cannot drift from what VoiceOver's rotor lists: a region that is not on
 * screen (a closed rail, focus mode's hidden chrome) is not a stop.
 */
import { tabbables } from "../ui/layers";
import { focusToastAction } from "../ui/Toast";

const REGIONS =
  "header.toolbar, section.banner-area, nav.binder, main, aside.inspector, footer.statusbar, aside.tutorial-cue";

function visible(el: HTMLElement): boolean {
  // A box with area, not merely a box: focus mode collapses chrome to zero
  // height, and inert chrome is not a stop either.
  const box = el.getBoundingClientRect();
  return (
    box.width > 0 && box.height > 0 && !el.closest("[aria-hidden='true']") && !el.closest("[inert]")
  );
}

/** Where focus should land inside an area: the thing a writer came there to use. */
function landingIn(region: HTMLElement): HTMLElement {
  if (region.matches("nav.binder")) {
    const tree = region.querySelector<HTMLElement>(".binder__scroll");
    if (tree && visible(tree)) return tree;
  }
  if (region.matches("main")) {
    const pane = region.querySelector<HTMLElement>(".pane.is-focused") ?? region;
    const script = pane.querySelector<HTMLElement>(".ProseMirror");
    if (script && visible(script)) return script;
    const first = tabbables(pane)[0];
    if (first) return first;
  }
  const first = tabbables(region)[0];
  if (first) return first;
  // An area with nothing to operate still takes focus, so it can be read.
  if (!region.hasAttribute("tabindex")) region.tabIndex = -1;
  return region;
}

/**
 * Where the keyboard lands in the open play — the same place ⌃⇥ lands in it —
 * or null while the play's focused pane is not on the page.
 */
export function playLanding(): HTMLElement | null {
  const play = document.querySelector<HTMLElement>("main.paneroot");
  return play?.querySelector(".pane.is-focused") ? landingIn(play) : null;
}

/**
 * Moves focus to the next (1) or previous (-1) area; false when there are none.
 * A toast offering an action (Undo, after Move to Trash) is the first stop in
 * either direction while it is up, so its action is in reach without a pointer.
 */
export function cycleRegion(dir: 1 | -1): boolean {
  if (focusToastAction()) return true;
  const regions = [...document.querySelectorAll<HTMLElement>(REGIONS)].filter(visible);
  if (regions.length === 0) return false;
  const active = document.activeElement;
  const at = regions.findIndex((r) => r.contains(active));
  const next =
    at < 0 ? (dir > 0 ? 0 : regions.length - 1) : (at + dir + regions.length) % regions.length;
  landingIn(regions[next]).focus({ preventScroll: false });
  return true;
}
