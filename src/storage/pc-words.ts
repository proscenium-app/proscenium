// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether the words storage says itself are a PC's (save-failure.ts): Windows'
 * Read-only and Properties where a Mac's are Finder's. From the capability
 * record's `keys` (docs/engineering/cross-platform.md#PLAT-35), set when the
 * record is read (ipc.ts), so storage needs nothing of the interface's.
 */
let pc = false;

export function setPCWords(on: boolean): void {
  pc = on;
}

export const pcWords = (): boolean => pc;
