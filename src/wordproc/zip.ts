// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The package around a .docx or .odt: a zip, written with fflate, which the
 * importer already uses to read these files — so writing them adds no
 * dependency (docs/app/formatting/formats-and-layout.md#FMT-D109).
 *
 * Entries keep the order they are given, because an .odt's `mimetype` must
 * come first and be stored uncompressed, and every entry carries the same
 * fixed date, so the same play and choices make the same bytes on the same
 * machine (docs/app/formatting/formats-and-layout.md#FMT-153).
 */
import { strToU8, zipSync, type Zippable } from "fflate";

export interface ZipEntry {
  path: string;
  data: Uint8Array | string;
  /** Stored as-is rather than deflated: an .odt's `mimetype`, and fonts already compact. */
  store?: boolean;
}

/** The earliest date a zip entry can hold, in local time — and never "now". */
const FIXED_DATE = new Date(1980, 0, 1, 0, 0, 0);

export function zipEntries(entries: readonly ZipEntry[]): Uint8Array {
  const files: Zippable = {};
  for (const entry of entries) {
    if (entry.path in files) throw new Error(`the package lists ${entry.path} twice`);
    const bytes = typeof entry.data === "string" ? strToU8(entry.data) : entry.data;
    files[entry.path] = [bytes, { level: entry.store ? 0 : 6, mtime: FIXED_DATE }];
  }
  return zipSync(files);
}
