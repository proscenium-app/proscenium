// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
/** Types for pages-sample.mjs, for the TypeScript tests that use it. */
export const HARBOR: [line: string, style: string][];
export function harborIndex(): Record<string, Uint8Array>;
export function harborPages(): Uint8Array;
export function harborPackage(): { path: string; bytes: Uint8Array }[];
export function harborPackageZip(): Uint8Array;
export function toBase64(bytes: Uint8Array): string;
