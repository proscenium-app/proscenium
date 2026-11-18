// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the system does for the page, from the capability record
 * (docs/engineering/cross-platform.md#PLAT-35), given to the page at boot
 * (main.tsx) as its keys and words are, so a component reads it at once and
 * never asks which system it is on:
 *
 *  - **`menuBar`**: a native menu bar carries the menu's commands and takes
 *    their chords before the page sees them. Where there is none, the window
 *    binds the menu's chords itself (app/use-shell-commands.ts).
 *  - **`systemSpelling`**: the system's own spelling, and with it its smart
 *    punctuation, may run where the writer types. Where it may not, every
 *    field has spell checking off, because WebKit turns smart quotes and
 *    dashes off only for a field whose spell checking is off, and a curly
 *    quote in the play's bytes is beyond any rule to undo.
 *  - **`windowDrag`**: the page's top bars move the window, a press on
 *    their empty space asking the window to start dragging. An iPad's windows
 *    move by the system's own handle, and its shell has no window to ask: a
 *    drag region there turned a tap on the toolbar into an error.
 *  - **`closeAt`**: the top corner where this system puts a window's close
 *    control, `left` on a Mac and an iPad, `right` on a PC. Settings, which
 *    stands in for a window of its own, puts its close button there.
 *
 * Until the record is read, and where it cannot be, all are a Mac's.
 */

export interface SystemTraits {
  menuBar: boolean;
  systemSpelling: boolean;
  windowDrag: boolean;
  closeAt: "left" | "right";
}

let traits: SystemTraits = {
  menuBar: true,
  systemSpelling: true,
  windowDrag: true,
  closeAt: "left",
};

export function setSystemTraits(next: SystemTraits): void {
  traits = next;
}

/** A native menu bar takes the menu's chords first. */
export const menuBar = (): boolean => traits.menuBar;

/** The system's own spelling may run where the writer types. */
export const systemSpelling = (): boolean => traits.systemSpelling;

/** The top corner a window's close control is in on this system. */
export const closeAt = (): "left" | "right" => traits.closeAt;

/**
 * What marks a top bar as the window's handle, spread onto the bar: Tauri's
 * own drag region, `deep` to take the bar's empty space between its controls
 * as well, where the page's top bars move the window; nothing where they do
 * not (an iPad).
 */
export function dragRegion(deep = false): { "data-tauri-drag-region"?: string } {
  if (!traits.windowDrag) return {};
  return { "data-tauri-drag-region": deep ? "deep" : "" };
}
