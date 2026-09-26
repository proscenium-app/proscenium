// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The review of words a crash left behind (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
 *
 * "Proscenium closed before these changes were saved" is a sentence a writer
 * should be able to check before believing: it shows exactly what Recover would
 * change, as the same line diff Changes and Versions use, from the script as it
 * stands now to the words as they were when the app stopped.
 *
 * Nothing is applied until Recover. Recover goes through the guarded write that
 * a restore uses, so what the script says now becomes a version first; Discard
 * leaves the recovered words in Versions, where they were put before the offer
 * was ever shown. There is no default button: ⏎ on a sheet that can rewrite the
 * script is how a keyboard press ends up doing the thing it was not on.
 */
import { useMemo, useState } from "react";
import { compactDiff, diffLines } from "../review/diff";
import { Button, Sheet } from "../ui";
import type { RecoveryOffer } from "./useWorkspace";

export interface RecoveryPanelProps {
  offer: RecoveryOffer;
  /** The script as it stands, which is what Recover would replace. */
  currentScriptText: () => string;
  onRecover: () => Promise<boolean>;
  onDiscard: () => void;
  onClose: () => void;
}

function whenLabel(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? `today at ${time}`
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${time}`;
}

export function RecoveryPanel({
  offer,
  currentScriptText,
  onRecover,
  onDiscard,
  onClose,
}: RecoveryPanelProps) {
  // Read once, on open: the comparison is against the script as the writer saw
  // it when they asked to review, not a target that moves while they read.
  const [now] = useState(currentScriptText);
  const [working, setWorking] = useState(false);

  const diff = useMemo(() => {
    const rows = compactDiff(diffLines(now, offer.words));
    return {
      rows,
      added: rows.filter((r) => r.kind === "add").length,
      removed: rows.filter((r) => r.kind === "del").length,
    };
  }, [now, offer.words]);

  const recover = async () => {
    setWorking(true);
    const ok = await onRecover();
    setWorking(false);
    if (ok) onClose();
  };

  return (
    <Sheet
      title="Unsaved Changes"
      subtitle={`${offer.title} · from ${whenLabel(offer.savedAt)}`}
      width={720}
      height={480}
      onClose={onClose}
      footer={
        <>
          <span className="sheet__hint">Discarded changes stay in Versions.</span>
          <span className="sheet__spacer" />
          <Button
            onClick={() => {
              onDiscard();
              onClose();
            }}
            disabled={working}
          >
            Discard
          </Button>
          <Button onClick={onClose} disabled={working}>
            Not Now
          </Button>
          <Button treatment="primary" onClick={() => void recover()} disabled={working}>
            Recover These Changes
          </Button>
        </>
      }
    >
      <div className="recoverypanel">
        <p className="recoverypanel__lede">
          Proscenium closed before these changes were saved. Recover puts them back into the script;
          what the script says now is kept in Versions first.
          <span className="diffview__stats">
            +{diff.added} −{diff.removed}
          </span>
        </p>
        {diff.added === 0 && diff.removed === 0 ? (
          <p className="historypanel__loading">
            The script already says the same thing — there is nothing to put back.
          </p>
        ) : (
          <div
            className="diffview__diff historypanel__diff recoverypanel__diff"
            tabIndex={0}
            role="region"
            aria-label="What Recover would change"
          >
            {diff.rows.map((row, i) =>
              row.kind === "skip" ? (
                <div key={i} className="diffview__skip">
                  ⋯ {row.count} unchanged lines ⋯
                </div>
              ) : (
                <div key={i} className={`diffview__line diffview__line--${row.kind}`}>
                  {row.text || " "}
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
