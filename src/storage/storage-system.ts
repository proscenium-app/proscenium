// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which system's words storage says itself in (save-failure.ts): a Mac's
 * Finder and Get Info, a PC's Read-only and Properties, or an iPad's, where
 * Files has no Get Info and the system is iPadOS. From the capability record
 * (docs/engineering/cross-platform.md#PLAT-35), set when the record is read
 * (ipc.ts), so storage needs nothing of the interface's.
 */
export type StorageSystem = "mac" | "pc" | "ipad";

let system: StorageSystem = "mac";

export function setStorageSystem(next: StorageSystem): void {
  system = next;
}

export const storageSystem = (): StorageSystem => system;
