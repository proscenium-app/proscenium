// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deep links into Settings: `openSettings("privacy")` from the Welcome notice
 * (T4), `openSettings("formats")` from the document menu, a bare
 * `openSettings()` from ⌘, and the menu bar.
 *
 * A plain function rather than a prop, because the places that open Settings
 * are scattered — a menu entry, a notice, a plugin — and threading a callback
 * down to each of them is how the next one gets missed. The shell registers
 * the one sheet with `useSettingsSheet`; everything else just calls this.
 */
import { useCallback, useEffect, useState } from "react";
import type { SettingsSection } from "./sections";

let show: ((section: SettingsSection) => void) | null = null;
/** A request made before the shell mounted, delivered when it does. */
let queued: SettingsSection | null = null;
/** Where the writer last was: a bare ⌘, reopens there, as a native Settings window does. */
let last: SettingsSection = "general";

/** Open Settings at `section` — or, with none, where the writer last left it. */
export function openSettings(section?: SettingsSection): void {
  const to = section ?? last;
  if (show) show(to);
  else queued = to;
}

/**
 * The shell's side: which section the sheet is showing, or null while it is
 * closed. Only one component may hold this at a time — the app has one sheet.
 */
export function useSettingsSheet(): {
  section: SettingsSection | null;
  setSection: (section: SettingsSection) => void;
  close: () => void;
} {
  const [section, setSectionState] = useState<SettingsSection | null>(null);
  const setSection = useCallback((to: SettingsSection) => {
    last = to;
    setSectionState(to);
  }, []);
  useEffect(() => {
    show = setSection;
    if (queued) {
      setSection(queued);
      queued = null;
    }
    return () => {
      if (show === setSection) show = null;
    };
  }, [setSection]);
  const close = useCallback(() => setSectionState(null), []);
  return { section, setSection, close };
}
