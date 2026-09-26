// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The status bar (docs/engineering/design-system.md#UI-D101).
 *
 * 26px of the quietest chrome in the app, and the new home for three things the
 * toolbar used to carry: where the play is, what the app is worried about, and
 * whether the work is saved. The save state stopped being a coloured pill —
 * "Saved · 2:14 AM" is a fact, and a fact does not need a badge.
 */
import { vault } from "../storage";
import { Chip, WarnIcon } from "../ui";
import type { SaveStatus } from "./useWorkspace";
import { WatcherStatus } from "./WatcherStatus";

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  dirty: "Editing…",
  saving: "Saving…",
  saved: "Saved",
  // Never "Conflict": a writer has not done anything wrong, and the word names
  // a mechanism rather than the thing that happened (docs/app/keeping-work/storage-and-file-format.md#STOR-D1). What happened
  // is that the file changed somewhere else.
  conflict: "Changed elsewhere",
  // The disk refused a save. Why, and what would let it through, was said in a
  // toast once; this stays until a save lands.
  unsaved: "Not saved",
};

function savedAt(): string {
  return new Date().toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StatusBar({
  root,
  status,
  savedTime,
  formatWarnings,
  conflictCopies,
  preserved,
  children,
}: {
  root: string | null;
  status: SaveStatus;
  /** The clock the last save landed at; the bar states it rather than "just now". */
  savedTime: string | null;
  formatWarnings: string[];
  conflictCopies: unknown[];
  preserved: unknown[];
  /** The zoom stepper, which only exists while a script is open. */
  children?: React.ReactNode;
}) {
  const label = STATUS_LABEL[status];
  return (
    <footer className="statusbar">
      {root && (
        <button
          type="button"
          className="statusbar__path"
          onClick={() => void vault.reveal()}
          title="Reveal in Finder"
        >
          {root}
        </button>
      )}
      {formatWarnings.length > 0 && (
        <Chip kind="warn" tiny title={formatWarnings.join("\n")}>
          <WarnIcon size={10} />
          {formatWarnings.length} format warning
          {formatWarnings.length === 1 ? "" : "s"}
        </Chip>
      )}
      {conflictCopies.length > 0 && (
        <Chip kind="warn" tiny title="Open Changes to compare them.">
          <WarnIcon size={10} />
          {conflictCopies.length} other version
          {conflictCopies.length === 1 ? "" : "s"}
        </Chip>
      )}
      {preserved.length > 0 && (
        <Chip tiny title="Kept in Versions.">
          {preserved.length} version{preserved.length === 1 ? "" : "s"} kept
        </Chip>
      )}
      <span className="statusbar__spacer" />
      <WatcherStatus root={root} />
      {label && (
        <span className={`savestatus${status === "conflict" || status === "unsaved" ? " savestatus--conflict" : ""}`} data-tutorial="save-status">
          {status === "saved" && savedTime ? `Saved · ${savedTime}` : label}
        </span>
      )}
      {children && (
        <>
          <span className="statusbar__divider" />
          {children}
        </>
      )}
    </footer>
  );
}

export { savedAt };
