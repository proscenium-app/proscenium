// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { telemetry } from "../storage/ipc";
import { useToast } from "../ui";
import { openSettings, updateSettings, useSettings, useSettingsLoaded } from "./settings";

export const PRIVACY_NOTICE = "Proscenium sends anonymous usage and crash reports, never your writing, and you can switch them off in Privacy settings.";

/** An upgrade that skips Welcome still sees the notice once (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-25). */
export function usePrivacyNotice(booted: boolean, hasRoot: boolean): boolean {
  const prefs = useSettings();
  const loaded = useSettingsLoaded();
  const toast = useToast();
  const [configured, setConfigured] = useState(false);
  const shown = useRef(false);
  useEffect(() => { void telemetry.configured().then(setConfigured, () => {}); }, []);
  const due = loaded && booted && !prefs.privacyNoticeSeen;
  useEffect(() => {
    if (!due || !hasRoot || !configured || shown.current) return;
    shown.current = true;
    toast({
      title: PRIVACY_NOTICE,
      action: { label: "Settings", run: () => openSettings("privacy") },
      onShown: () => { void updateSettings({ privacyNoticeSeen: true }); },
    });
  }, [due, hasRoot, configured, toast]);
  return due;
}
