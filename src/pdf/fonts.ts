// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Courier Prime TTFs for PDF embedding (OFL 1.1 — see fonts/OFL.txt; the
 * editor's woff2 copies live in src/ui/fonts). Vite fingerprints and bundles
 * the files; fetched lazily only when an export runs.
 */
import boldItalicUrl from "./fonts/CourierPrime-BoldItalic.ttf?url";
import boldUrl from "./fonts/CourierPrime-Bold.ttf?url";
import italicUrl from "./fonts/CourierPrime-Italic.ttf?url";
import regularUrl from "./fonts/CourierPrime-Regular.ttf?url";
import type { PdfFontBytes } from "./render";

async function bytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load embedded font ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function loadPdfFonts(): Promise<PdfFontBytes> {
  const [regular, bold, italic, boldItalic] = await Promise.all([
    bytes(regularUrl),
    bytes(boldUrl),
    bytes(italicUrl),
    bytes(boldItalicUrl),
  ]);
  return { regular, bold, italic, boldItalic };
}
