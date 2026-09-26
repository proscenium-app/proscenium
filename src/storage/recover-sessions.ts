// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { decodeSnapshot, decideRecovery } from "./recovery-policy";
import type { RecoveryFile } from "./ipc";

export interface RecoveredWords {
  owner: string;
  words: string;
  savedAt: string;
  versionName: string | null;
}

/** Review every abandoned owner independently. A failed pin never authorises
 * deleting its source or prevents another owner's copy from being kept. */
export async function reviewRecoveryFiles(
  files: RecoveryFile[],
  io: {
    fileModifiedMs: number | null;
    sameContent(text: string): boolean;
    keep(text: string): Promise<string>;
    remove(owner: string): Promise<void>;
  },
): Promise<RecoveredWords[]> {
  const offers: RecoveredWords[] = [];
  for (const file of files) {
    const snapshot = decodeSnapshot(file.content);
    if (!snapshot) continue;
    const decision = decideRecovery({
      snapshotAtMs: snapshot.savedAtMs,
      fileModifiedMs: io.fileModifiedMs,
      sameContent: io.sameContent(snapshot.content),
    });
    if (decision === "delete") {
      await io.remove(file.owner).catch(() => {});
      continue;
    }
    const versionName = await io.keep(snapshot.content).catch(() => null);
    if (versionName !== null) await io.remove(file.owner).catch(() => {});
    if (decision === "offer")
      offers.push({
        owner: file.owner,
        words: snapshot.content,
        savedAt: new Date(snapshot.savedAtMs).toISOString(),
        versionName,
      });
  }
  return offers.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
