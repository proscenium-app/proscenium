// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from "react";
import { Button, Sheet } from "../ui";
import type { VaultPlay } from "../workspace/vault-plays";

export interface RawPlayDetails {
  play: VaultPlay;
  text: string | null;
  message: string;
}

/** A damaged play stays discoverable, with its raw file protected (docs/app/keeping-work/storage-and-file-format.md#STOR-107). */
export function RawPlaySheet({
  details,
  onClose,
  onRetry,
  onReveal,
}: {
  details: RawPlayDetails;
  onClose(): void;
  onRetry(): void;
  onReveal(): void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, [details]);
  return (
    <Sheet
      title={details.play.title}
      labelledBy="raw-play-title"
      width={640}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onReveal}>Show in Folder</Button>
          <span className="sheet__spacer" />
          <Button onClick={onClose}>Close</Button>
          <Button treatment="primary" onClick={onRetry}>
            Try Again
          </Button>
        </>
      }
    >
      <div className="diagnostics-body">
        <p className="diagnostics-notice" id="raw-play-notice">
          {details.message} Show in Folder opens the location of the original file.
        </p>
        {details.text !== null && (
          <textarea
            ref={field}
            className="diagnostics-review"
            readOnly
            aria-label="Original play file"
            aria-describedby="raw-play-notice"
            value={details.text}
          />
        )}
      </div>
    </Sheet>
  );
}
