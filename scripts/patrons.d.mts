// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Types for scripts/patrons.mjs, which vite.config.ts and the tests import. */
export interface Roll {
  version: 1;
  benefactors: string[];
  patrons: string[];
  friends: string[];
  private: number;
}
export declare const ROLL_URL: string;
export declare const LEVELS: readonly ["benefactors", "patrons", "friends"];
export declare const EMPTY_ROLL: Readonly<Roll>;
export declare function parseRoll(value: unknown): Roll;
export declare function fetchRoll(options?: {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<Roll>;
export declare function bakedRoll(env?: Record<string, string | undefined>): Roll;
export declare function listed(names: readonly string[]): string;
export declare function underwritten(roll: Roll): string | null;
