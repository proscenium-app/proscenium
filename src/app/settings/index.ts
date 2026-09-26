// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings: the sheet, the store every preference is read from, and the deep
 * link that opens a section (docs/app/preferences-and-help/settings.md#SET-D100, Part A).
 */
export { SettingsSheet, type SettingsSheetProps } from "./SettingsSheet";
export { SETTINGS_SECTIONS, type SettingsSection } from "./sections";
export { openSettings, useSettingsSheet } from "./open";
export {
  forgetWord,
  learnWord,
  settingsStore,
  updateSettings,
  useSettings,
  useSettingsLoaded,
} from "./store";
export { useOpenAtLaunch } from "./launch";
