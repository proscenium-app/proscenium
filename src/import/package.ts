// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { zipSync } from "fflate";
import { assertDocumentSize } from "../storage/read-limit";

/**
 * A package-form document opened from Finder (a `.pages` folder), zipped
 * whole with its folder at the root: the same shape the web view gives a
 * package that is chosen or dropped, and Finder's Compress makes. The import
 * reads it, and the play keeps it as `Originals/<folder>.zip`, which opens
 * back into the folder (docs/app/importing/document-import.md#IMPT-89).
 * Stored, not deflated: the parts are compressed already.
 */
export function zipPackage(
  folder: string,
  files: { path: string; bytes: Uint8Array }[],
): { name: string; bytes: Uint8Array } {
  const bytes = zipSync(Object.fromEntries(files.map((f) => [`${folder}/${f.path}`, f.bytes])), {
    level: 0,
  });
  assertDocumentSize(bytes.byteLength);
  return { name: `${folder}.zip`, bytes };
}
