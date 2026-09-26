// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { assertDocumentSize } from "./read-limit";

export function encodeBytes(bytes: Uint8Array): string {
  assertDocumentSize(bytes.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeBytes(base64: string): Uint8Array {
  assertDocumentSize(
    Math.floor((base64.length * 3) / 4) -
      (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0),
  );
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
export type KeptFile =
  | { name: string; content: string; base64?: never }
  | { name: string; base64: string; content?: never };
