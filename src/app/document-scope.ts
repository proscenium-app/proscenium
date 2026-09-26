// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ChangesStore } from "../review";
import type { vault } from "../storage";

/** A queued document operation belongs to the play that accepted it. */
export interface DocumentContext {
  playId: string | null;
  generation: number;
  changes: ChangesStore | null;
}
export type DocumentIO = Pick<typeof vault, "read" | "write">;
export interface DocumentScope extends DocumentContext {
  io: DocumentIO;
  isCurrent: () => boolean;
}

/** The vault is retargeted only after settlement. Check the captured owner at
 * each I/O boundary as well, so a late callback cannot use the next play. */
export function captureDocumentScope(
  current: () => DocumentContext,
  io: DocumentIO,
): DocumentScope {
  const owner = current();
  const isCurrent = () => {
    const now = current();
    return (
      owner.playId !== null && now.playId === owner.playId && now.generation === owner.generation
    );
  };
  const requireOwner = () => {
    if (!isCurrent()) throw new Error("This document belongs to a play that has closed.");
  };
  return {
    ...owner,
    isCurrent,
    io: {
      read: (...args) => {
        requireOwner();
        return io.read(...args);
      },
      write: (...args) => {
        requireOwner();
        return io.write(...args);
      },
    },
  };
}
