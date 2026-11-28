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
import { systemWords } from "../ui/system-words";
import { Chip, WarnIcon } from "../ui";
import type { SaveStatus } from "./useWorkspace";
import { UpdateReady } from "./UpdateReady";
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
  onReveal,
  status,
  savedTime,
  formatWarnings,
  conflictCopies,
  preserved,
  saveNote = false,
  updateAtQuit,
  children,
}: {
  root: string | null;
  /**
   * Show the folder in the file manager, where the system has one to show it
   * in (capabilities, never platform); the path is plain text where it has not.
   */
  onReveal?: () => void;
  status: SaveStatus;
  /** The clock the last save landed at; the bar states it rather than "just now". */
  savedTime: string | null;
  formatWarnings: string[];
  conflictCopies: unknown[];
  preserved: unknown[];
  /**
   * The writer asked for a Save: the status says Proscenium saves as they
   * write (docs/app/keeping-work/storage-and-file-format.md#STOR-201).
   */
  saveNote?: boolean;
  /** Whether a waiting update installs as the app quits (Settings › Updates). */
  updateAtQuit: boolean;
  /** The zoom stepper, which only exists while a script is open. */
  children?: React.ReactNode;
}) {
  const asked = saveNote && (status === "saved" || status === "idle");
  const label = asked
    ? `Saved${status === "saved" && savedTime ? ` · ${savedTime}` : ""} · Proscenium saves as you write`
    : status === "saved" && savedTime
      ? `Saved · ${savedTime}`
      : STATUS_LABEL[status];
  return (
    <footer className="statusbar">
      {root &&
        (onReveal ? (
          <button
            type="button"
            className="statusbar__path"
            onClick={onReveal}
            title={`Reveal in ${systemWords().fileManager}`}
          >
            {root}
          </button>
        ) : (
          <span className="statusbar__path">{root}</span>
        ))}
      {formatWarnings.length > 0 && (
        <Chip kind="warn" tiny news title={formatWarnings.join("\n")}>
          <WarnIcon size={10} />
          {formatWarnings.length} format warning
          {formatWarnings.length === 1 ? "" : "s"}
        </Chip>
      )}
      {conflictCopies.length > 0 && (
        <Chip kind="warn" tiny news title="Open Changes to compare them.">
          <WarnIcon size={10} />
          {conflictCopies.length} other version
          {conflictCopies.length === 1 ? "" : "s"}
        </Chip>
      )}
      {preserved.length > 0 && (
        <Chip tiny news title="Kept in Versions.">
          {preserved.length} version{preserved.length === 1 ? "" : "s"} kept
        </Chip>
      )}
      <span className="statusbar__spacer" />
      <UpdateReady atQuit={updateAtQuit} />
      <WatcherStatus root={root} />
      {label && (
        <span
          className={`savestatus${status === "conflict" || status === "unsaved" ? " savestatus--conflict" : ""}`}
          data-tutorial="save-status"
        >
          {label}
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
