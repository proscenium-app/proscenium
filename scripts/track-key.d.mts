// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Types for track-key.mjs, for the TypeScript test that uses it. */
export const SETTINGS_KEY: "updateTrackKey";
export const KEY_SHAPE: RegExp;
export function mintKey(): string;
export function keyHash(key: string): string;
export function readSettings(path: string): Record<string, unknown>;
export function holdsKey(path: string): boolean;
export function writeKey(path: string, key: string): void;
