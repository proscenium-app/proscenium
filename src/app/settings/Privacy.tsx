// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › Privacy (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3). What the notes promise is
 * what the closed event list and telemetry/mod.rs hold to: versions, features
 * used and crashes go; nothing of the writing does; switching off drops what
 * was waiting. The update check is not a report and has its own switch, so the
 * section says where it is rather than let "off" read as "silent".
 */
import { useUpdateState } from "../updates";
import { Button, useToast } from "../../ui";
import { settings as ipc } from "../../storage/ipc";
import { Group, Note, SectionBody, SwitchRow } from "./parts";
import { updateSettings, useSettings } from "./store";

export function PrivacySlot() {
  const { shareAnalytics } = useSettings();
  // Store copies have no automatic updater setting.
  const checksForUpdates = useUpdateState().kind !== "unavailable";
  const toast = useToast();
  return (
    <SectionBody title="Privacy">
      <Group label="Reports">
        <SwitchRow
          label="Share anonymous usage and crash reports"
          on={shareAnalytics}
          onChange={(on) => updateSettings({ shareAnalytics: on })}
          note="Counts launches and features used, with the Proscenium and macOS versions and chip. Crash reports include stack traces and the kind of failure. Never includes your writing, titles, character names, file names, paths, error messages or memory dumps."
        />
        <Note>
          Turning this off also discards reports that haven’t been sent.
          {checksForUpdates && " Checking for updates is a separate setting, in Updates."}
          {" Send Feedback works with reports off."}
        </Note>
        <Button
          size="small"
          onClick={() =>
            void ipc
              .openPrivacy()
              .catch(() => toast({ kind: "error", title: "Could not open the privacy page." }))
          }
        >
          Read the Privacy Policy
        </Button>
      </Group>
    </SectionBody>
  );
}
