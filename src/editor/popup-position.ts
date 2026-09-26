// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Caret-anchored popup placement shared by the character autocomplete and the
 * element menu: below the caret by default, flipped above when the viewport
 * bottom would clip it (the caret usually IS at the bottom — that's where
 * writing happens), and clamped inside the right edge.
 */
import type { EditorView } from "@tiptap/pm/view";

const GAP = 4;

export function placeAtCaret(dom: HTMLElement, view: EditorView): void {
  const coords = view.coordsAtPos(view.state.selection.head);
  dom.style.display = "block";
  const height = dom.offsetHeight;
  const width = dom.offsetWidth;
  const below = coords.bottom + GAP;
  let top = below + height > window.innerHeight ? coords.top - height - GAP : below;
  // Clamp fully inside the viewport (a scrolled-away caret must not strand
  // the popup off-screen).
  top = Math.max(GAP, Math.min(top, window.innerHeight - height - GAP));
  const left = Math.max(GAP, Math.min(coords.left, window.innerWidth - width - GAP * 2));
  dom.style.top = `${Math.round(top)}px`;
  dom.style.left = `${Math.round(left)}px`;
}
