// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Changes — what changed in this folder that the writer has not seen, and how
 * to put it back.
 *
 * This is the sync surface. You edited on the iPad; iCloud pushed something
 * while the app was closed; another editor rewrote a file underneath you. The
 * list is how the writer finds out, and Versions is how they undo it.
 */
export {
  baselinePath,
  beforePath,
  openChanges,
  BASELINE_DIR,
  BEFORE_DIR,
  LEDGER_PATH,
} from "./store";
export type { ChangesStore, LedgerEntry, LedgerStatus } from "./store";

export { countStats, recordExternalChange } from "./record";

export { touchedScenes } from "./locate";

export { compactDiff, diffLines } from "./diff";
export type { DiffLine } from "./diff";

export { ChangesView } from "./ChangesView";
export type { ChangesViewProps } from "./ChangesView";

export { computeMarks, emptyMarks, mergeMarks } from "./tracked";
export type { TrackedMarks } from "./tracked";
