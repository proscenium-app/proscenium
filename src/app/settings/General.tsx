// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Settings › General — where the plays live, what the app opens to, and what
 * the Plays screen shows: Progress, and the statuses a play can have
 * (docs/app/preferences-and-help/settings.md#SET-7).
 *
 * The Plays folder is the one choice from the welcome screen that a writer
 * revisits (docs/app/keeping-work/storage-and-file-format.md#STOR-D12): where it is, the one sentence saying what that means
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-D11), and the way to point the app somewhere else. Changing it moves
 * nothing — the app simply looks in the new folder.
 */
import { Button, PopupButton, useToast } from "../../ui";
import { settings as ipc } from "../../storage";
import type { OpenAtLaunch } from "../../storage/settings-model";
import { Group, Note, SectionBody, SwitchRow } from "./parts";
import { StatusList } from "./StatusList";
import { updateSettings, useSettings } from "./store";

const LAUNCH_OPTIONS: { value: OpenAtLaunch; label: string }[] = [
  { value: "lastPlay", label: "Where you left off" },
  { value: "plays", label: "The Plays screen" },
];

export function General({
  playsFolder,
  wherePlaysLive,
  canReveal,
  onChangePlaysFolder,
}: {
  /** The Plays folder's path, or null before one has been chosen. */
  playsFolder: string | null;
  /** The one sentence about where the plays live (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). */
  wherePlaysLive: string;
  /** This build has a Finder to show a folder in (capabilities, never platform). */
  canReveal: boolean;
  onChangePlaysFolder: () => void;
}) {
  const { openAtLaunch, showProgress, playStatuses } = useSettings();
  const toast = useToast();

  return (
    <SectionBody title="General">
      <Group label="Plays folder">
        {/* The last clause of this sentence is the one that must exist: a
            writer whose plays are on this Mac alone should never find that out
            from a backup they didn't have (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). */}
        <Note>
          {playsFolder ? wherePlaysLive : "Your plays will be saved in the folder you choose."}
        </Note>
        <div className="settings__folder">
          <span className="settings__path mono" title={playsFolder ?? undefined}>
            {playsFolder ?? "No folder chosen"}
          </span>
          {canReveal && playsFolder && (
            <Button
              size="small"
              onClick={() =>
                void ipc.revealPlaysFolder().catch(() =>
                  toast({
                    kind: "error",
                    title: "The Plays folder could not be shown in Finder.",
                    // The refusal a writer can meet here: the folder is no longer at its path.
                    detail: "It may have been moved, renamed or deleted.",
                    code: "E-REVEAL",
                  }),
                )
              }
            >
              Reveal in Finder
            </Button>
          )}
          <Button size="small" onClick={onChangePlaysFolder}>
            {playsFolder ? "Change…" : "Choose…"}
          </Button>
        </div>
        {playsFolder && (
          <Note>
            Changing the folder doesn’t move any plays. Proscenium shows the plays in the new folder
            instead.
          </Note>
        )}
      </Group>

      {/* Both choices say what they do, so neither carries a note. */}
      <Group label="When Proscenium opens">
        <div className="settings__row">
          <span className="settings__rowlabel">Show</span>
          <PopupButton
            label="Show when Proscenium opens"
            size="small"
            options={LAUNCH_OPTIONS}
            value={openAtLaunch}
            onChange={(value) => updateSettings({ openAtLaunch: value })}
            menuWidth={236}
          />
        </div>
      </Group>

      <Group label="Plays screen">
        <SwitchRow
          label="Show Progress column"
          on={showProgress}
          onChange={(on) => updateSettings({ showProgress: on })}
          note="Lists each play’s length in pages."
        />
      </Group>

      <Group label="Play statuses">
        <Note>
          Offered for plays on the Plays screen, in this order. New plays start with the first
          status. Renaming or deleting a status doesn’t change plays that already have it.
        </Note>
        <StatusList
          statuses={playStatuses}
          onChange={(next) => updateSettings({ playStatuses: next })}
        />
      </Group>
    </SectionBody>
  );
}
