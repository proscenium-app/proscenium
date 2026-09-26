// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Settings sections, in the order the section list shows them
 * (docs/app/preferences-and-help/settings.md#SET-D100, Part A). Each one is a file beside this.
 */
export type SettingsSection =
  | "general"
  | "appearance"
  | "writing"
  | "formats"
  | "shortcuts"
  | "help"
  | "privacy"
  | "updates"
  | "about";

export const SETTINGS_SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "writing", label: "Writing" },
  { id: "formats", label: "Formats" },
  { id: "shortcuts", label: "Keyboard Shortcuts" },
  { id: "help", label: "Help & Feedback" },
  { id: "privacy", label: "Privacy" },
  { id: "updates", label: "Updates" },
  { id: "about", label: "About" },
];

/**
 * Where a key in the section list goes: ↑ and ↓ step and wrap, Home and End
 * jump. Null for any other key, which the list leaves alone. A vertical list
 * takes the vertical arrows only — ← and → are left for whatever else wants
 * them, as they are in a native sidebar.
 */
export function stepSection(from: SettingsSection, key: string): SettingsSection | null {
  const n = SETTINGS_SECTIONS.length;
  const at = Math.max(
    0,
    SETTINGS_SECTIONS.findIndex((s) => s.id === from),
  );
  const to =
    key === "ArrowDown"
      ? (at + 1) % n
      : key === "ArrowUp"
        ? (at - 1 + n) % n
        : key === "Home"
          ? 0
          : key === "End"
            ? n - 1
            : -1;
  return to < 0 ? null : SETTINGS_SECTIONS[to].id;
}
