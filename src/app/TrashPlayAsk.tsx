// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Move a whole play to the trash, asked twice
 * (docs/app/organizing/workspace-model.md#WORK-91). A binder row's delete asks
 * nothing, since its toast can undo it (src/ui/Sheet.tsx); a play is every
 * page the writer has on it and leaves every device that syncs the folder, so
 * it is asked about twice, with Cancel as ⏎'s answer both times.
 *
 * The first question is a sheet with room to say what goes and how to have it
 * back, in the system's own words. The second is an alert that names the play
 * once more and holds the one destructive button.
 */
import { useState } from "react";
import { Alert, Button, Sheet } from "../ui";
import {
  goneForGoodWhen,
  moveToTrash,
  playPutBackSteps,
  systemWords,
  theTrash,
  trashKeepsIt,
} from "../ui/system-words";
import type { VaultPlay } from "../workspace";

export function TrashPlayAsk({
  play,
  folder,
  onTrash,
  onCancel,
}: {
  play: VaultPlay;
  /** The Plays folder's name, where a drag puts the play back. */
  folder: string;
  onTrash: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const where = theTrash();
  const machine = systemWords().machine;

  if (step === 2)
    return (
      <Alert
        title={`Move “${play.title}” to ${where}?`}
        body={`Last check. The whole play leaves your Plays folder. ${trashKeepsIt()}`}
        confirmLabel={moveToTrash()}
        cancelLabel="Keep the Play"
        destructive
        cancelIsDefault
        onConfirm={onTrash}
        onCancel={onCancel}
      />
    );

  return (
    <Sheet
      title={`Move “${play.title}” to ${where}?`}
      width={500}
      onClose={onCancel}
      onDefault={onCancel}
      footer={
        <>
          <Button treatment="primary" onClick={onCancel}>
            Cancel
          </Button>
          <span className="sheet__spacer" />
          <Button onClick={() => setStep(2)}>Continue…</Button>
        </>
      }
    >
      <div className="trash-play">
        <h3 className="trash-play__head">What goes</h3>
        <p>
          The whole play: its folder “{play.dir}” in your Plays folder, with every script, page,
          file and card in it.
        </p>
        <p>
          If your Plays folder syncs, as iCloud Drive, OneDrive or Dropbox do, the play leaves your
          other devices too, and comes back to them when you put it back.
        </p>
        <p>Its saved versions stay on this {machine}, and are there again once the play is back.</p>
        <h3 className="trash-play__head">How to get it back</h3>
        <ol className="trash-play__steps">
          {playPutBackSteps(play.dir, folder).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p>{goneForGoodWhen()}</p>
      </div>
    </Sheet>
  );
}
