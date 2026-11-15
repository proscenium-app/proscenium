// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { telemetry } from "../storage/ipc";
import { useToast } from "../ui";
import { openSettings, updateSettings, useSettings, useSettingsLoaded } from "./settings";

export const PRIVACY_NOTICE =
  "Proscenium sends anonymous usage and crash reports, never your writing, and you can switch them off in Privacy settings.";

/** What Settings › Privacy says in place of the switch, in a copy built without reports. */
export const NO_REPORTS = "This copy of Proscenium doesn’t send usage or crash reports.";

let configured: Promise<boolean> | null = null;

/**
 * Whether this copy can send reports at all: built with the reports service's
 * key (telemetry/mod.rs `telemetry_configured`). A local build, and a copy the
 * reports service does not take yet, are built without one, and say nothing
 * of sending. Asked once: a build cannot gain a key while it runs.
 */
export function reportsConfigured(): Promise<boolean> {
  configured ??= telemetry.configured().catch(() => false);
  return configured;
}

/** The same, for a component: null until the copy has answered. */
export function useReportsConfigured(): boolean | null {
  const [known, setKnown] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void reportsConfigured().then((on) => {
      if (live) setKnown(on);
    });
    return () => {
      live = false;
    };
  }, []);
  return known;
}

/**
 * The reports notice (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-25):
 * the Welcome screen says it once, or a toast does if a release opens straight
 * into a play. `notice` is the Welcome screen's to show; `waiting` holds the
 * tutorial's invitation back while a notice may still appear.
 *
 * A copy that sends no reports shows neither, and the notice stays unseen: it
 * is due on the first copy that does send them, which must say so before it
 * sends anything.
 */
export function usePrivacyNotice(
  booted: boolean,
  hasRoot: boolean,
): { notice: boolean; waiting: boolean } {
  const prefs = useSettings();
  const loaded = useSettingsLoaded();
  const toast = useToast();
  const sends = useReportsConfigured();
  const shown = useRef(false);
  const due = loaded && booted && !prefs.privacyNoticeSeen;
  useEffect(() => {
    if (!due || !hasRoot || sends !== true || shown.current) return;
    shown.current = true;
    toast({
      title: PRIVACY_NOTICE,
      action: { label: "Settings", run: () => openSettings("privacy") },
      onShown: () => {
        void updateSettings({ privacyNoticeSeen: true });
      },
    });
  }, [due, hasRoot, sends, toast]);
  return { notice: due && sends === true, waiting: due && sends !== false };
}
