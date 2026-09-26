// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What to do with a recovery snapshot found when a script opens (docs/app/keeping-work/storage-and-file-format.md#STOR-D10,
 * docs/app/keeping-work/storage-and-file-format.md#STOR-D13) — pure, so the rule that decides whether a writer is shown their lost
 * words is tested without a disk, a clock or a window.
 *
 * A snapshot is what the buffer held while autosave could not land it. Finding
 * one means the app stopped before a flush deleted it: a crash, a kill, a
 * force-quit behind the "changed somewhere else" banner. Three answers:
 *
 *  - **delete** — the file already says what the snapshot says. The words
 *    made it to disk after all; there is nothing to keep.
 *  - **offer** — the snapshot differs from the file and is newer than it. These
 *    are words the writer typed that never reached the file, and they are
 *    offered: "Proscenium closed before these changes were saved".
 *  - **ignore** — the snapshot differs but the file is newer. Something wrote
 *    the script after the snapshot was taken (a flush that landed just before
 *    the app died, another device, another editor), so the snapshot is not
 *    the latest word and saying it is would be wrong. The caller still keeps
 *    it in Versions: "ignore" means do not speak, never throw away.
 *
 * Nothing here applies a snapshot. Applying one is the writer's choice, made
 * at the offer (docs/app/keeping-work/storage-and-file-format.md#STOR-118).
 */

export type RecoveryDecision = "offer" | "ignore" | "delete";

export interface RecoveryFacts {
  /** When the words in the snapshot were captured from the buffer, epoch ms. */
  snapshotAtMs: number;
  /**
   * The script file's last-modified time, epoch ms; null when the platform will
   * not say (an evicted iCloud file, for one).
   */
  fileModifiedMs: number | null;
  /** Whether the snapshot says what the file already says (`sameScriptText`). */
  sameContent: boolean;
}

export function decideRecovery(facts: RecoveryFacts): RecoveryDecision {
  if (facts.sameContent) return "delete";
  // No file time to compare against: the words are the only thing known to be
  // at risk, so they are shown. A writer can say no; they cannot say yes to
  // something never offered.
  if (facts.fileModifiedMs === null) return "offer";
  return facts.snapshotAtMs > facts.fileModifiedMs ? "offer" : "ignore";
}

/**
 * Does a snapshot hold the same script as the file?
 *
 * A snapshot is always the app's canonical Fountain (it is serialized from the
 * buffer), and a file the writer has not saved from this app since opening may
 * not be — a trailing space, a blank line the serializer normalizes. So the
 * file is compared as it stands and as the app would write it. Equal either way
 * means no words are missing, and nothing should be offered over whitespace.
 */
export function sameScriptText(
  snapshot: string,
  file: string,
  canonical: (text: string) => string,
): boolean {
  if (snapshot === file) return true;
  try {
    return snapshot === canonical(file);
  } catch {
    return false;
  }
}

/** A snapshot as the frontend writes it into app data. */
export interface RecoverySnapshot {
  /** The script's path in the play when it was taken — shown, never used to find the file. */
  path: string;
  /** When its words were captured from the buffer, epoch ms. */
  savedAtMs: number;
  content: string;
}

const KIND = "proscenium/recovery";

/**
 * The bytes of a snapshot: a small JSON envelope, so the words carry the time
 * they were captured rather than the time the disk got round to writing them
 * (the difference decides between "offer" and "ignore").
 */
export function encodeSnapshot(s: RecoverySnapshot): string {
  return (
    JSON.stringify({
      kind: KIND,
      version: 1,
      path: s.path,
      savedAt: new Date(s.savedAtMs).toISOString(),
      content: s.content,
    }) + "\n"
  );
}

/** The snapshot in `raw`, or null when it is not one this app wrote. */
export function decodeSnapshot(raw: string): RecoverySnapshot | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v?.kind !== KIND || typeof v.content !== "string" || typeof v.savedAt !== "string") {
      return null;
    }
    const savedAtMs = Date.parse(v.savedAt);
    if (!Number.isFinite(savedAtMs)) return null;
    return { path: typeof v.path === "string" ? v.path : "", savedAtMs, content: v.content };
  } catch {
    return null;
  }
}
