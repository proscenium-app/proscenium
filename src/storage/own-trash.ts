// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How many days Proscenium’s Trash keeps what is deleted, where the system has
 * no trash of its own and a delete goes there instead (an iPad), or null where
 * the system's trash takes a delete
 * (docs/engineering/cross-platform.md#PLAT-16). From the capability record's
 * `ownTrashDays`, set when the record is read (ipc.ts), so the words that say
 * where a delete went, and the Plays screen that opens the trash, never ask
 * which system they are on.
 */
let days: number | null = null;

export function setOwnTrashDays(next: number | null): void {
  days = next;
}

export const ownTrashDays = (): number | null => days;
