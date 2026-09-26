// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The type a .docx or .odt names and carries
 * (docs/app/formatting/formats-and-layout.md#FMT-154): the format's own
 * family, with its four faces embedded — the same Courier Prime files the PDF
 * embeds, which the SIL Open Font License lets a document carry and whose
 * embedding flags say installable — and the family's next name as the
 * fallback for a reader that ignores embedded fonts.
 */
import type { FormatSpec } from "../format";

export interface FontFaces {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
  boldItalic: Uint8Array;
}

export const FACES = ["regular", "bold", "italic", "boldItalic"] as const;
export type Face = (typeof FACES)[number];

/** The names in the format's family, in order, without quotes. */
export function familyNames(spec: FormatSpec): { primary: string; fallback: string } {
  const names = spec.type.family
    .split(",")
    .map((name) => name.trim().replace(/^["']|["']$/g, ""))
    .filter((name) => name && name !== "monospace");
  return { primary: names[0] ?? "Courier Prime", fallback: names[1] ?? "Courier New" };
}
