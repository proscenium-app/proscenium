// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The menu's items that act while a menu, a sheet or an alert is up. Every
 * other item waits for the layer, as its key does at the window
 * (docs/app/preferences-and-help/accessibility.md#A11Y-3, `menu-actions.ts`).
 */
export interface OverLayers {
  /** The shortcuts overlay is up, which ⌘/ closes. */
  shortcutsShown: boolean;
  /** The format designer is up, and takes a Save (`formats/open.ts`). */
  designerUp: boolean;
}

export function menuActsOverLayer(id: string, now: OverLayers): boolean {
  switch (id) {
    // ⌘/ closes its own overlay.
    case "shortcuts":
      return now.shortcutsShown;
    // Help may copy diagnostics or open its feedback sheet above Settings.
    case "copy-diagnostics":
    case "report-problem":
      return true;
    // Save with the format designer up saves the format in front of the
    // writer. A Mac's page and a PC's hear ⌘S before their menu does, and the
    // designer takes it there; an iPad's menu takes the chord before the page
    // (docs/engineering/cross-platform.md#PLAT-76), and its Save, waiting
    // behind the designer's own sheet, saved nothing at all.
    case "save":
      return now.designerUp;
    default:
      return false;
  }
}
