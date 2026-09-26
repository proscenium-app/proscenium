// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two questions a file opened from Finder can raise (docs/app/keeping-work/storage-and-file-format.md#STOR-D5, docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
 *
 * Both answers are additive and reversible, so ⏎ may take them: choosing a
 * Plays folder moves nothing, and making a play copies a script without
 * touching the original. Cancel is always one key away.
 */
import { Button, Sheet } from "../ui";
import type { OpenRequest } from "./useFinderOpens";

export function OpenFileSheet({
  request,
  onAnswer,
}: {
  request: OpenRequest;
  onAnswer: (yes: boolean) => void;
}) {
  const cancel = () => onAnswer(false);

  if (request.kind === "adopt-folder") {
    return (
      <Sheet
        title={`Open “${request.playTitle}”?`}
        width={460}
        onClose={cancel}
        onDefault={() => onAnswer(true)}
        footer={
          <>
            <span className="sheet__spacer" />
            <Button onClick={cancel}>Cancel</Button>
            <Button treatment="primary" onClick={() => onAnswer(true)}>
              Use Its Folder as the Plays Folder
            </Button>
          </>
        }
      >
        <div className="openfile">
          <p className="openfile__lede">
            {request.hasPlaysFolder
              ? "This play is in a folder that isn't your Plays folder."
              : "This play is in a folder, and Proscenium doesn't have a Plays folder yet."}{" "}
            Proscenium shows the plays in one folder at a time. Nothing is moved.
          </p>
          <p className="openfile__path" title={request.playsFolder}>
            {request.playsFolder}
          </p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      title={`Make a play from “${request.fileName}”?`}
      width={460}
      onClose={cancel}
      onDefault={() => onAnswer(true)}
      footer={
        <>
          <span className="sheet__spacer" />
          <Button onClick={cancel}>Cancel</Button>
          <Button treatment="primary" onClick={() => onAnswer(true)}>
            Make a Play from It
          </Button>
        </>
      }
    >
      <div className="openfile">
        <p className="openfile__lede">
          This script isn't part of a play. Proscenium can make a new play in your Plays folder
          with a copy of it. The original stays where it is.
        </p>
      </div>
    </Sheet>
  );
}
