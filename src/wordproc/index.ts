// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Export .docx and Export .odt (docs/app/formatting/formats-and-layout.md#FMT-145):
 * the play, in its format, as a file a word processor opens and a recipient
 * can mark up and restyle. The same choices as a PDF — part, pages, opening
 * sheets, anonymous copy, language — and the same save panel and atomic write.
 *
 * Loaded lazily, like the PDF path, so none of it is in the editor's startup.
 */
import { exporter } from "../storage";
import { loadPdfFonts } from "../pdf/fonts";
import { writeDocx } from "./docx";
import type { FontFaces } from "./fonts";
import { buildDocument, type WpInput } from "./model";
import { writeOdt } from "./odt";

export type DocumentType = "docx" | "odt";

export { buildDocument } from "./model";
export type { WpInput } from "./model";

/** The file, from its model and the faces it embeds. Pure: the tests call this. */
export function writeScriptDocument(
  type: DocumentType,
  input: WpInput,
  fonts: FontFaces,
): Uint8Array {
  const doc = buildDocument(input);
  return type === "docx" ? writeDocx(doc, fonts) : writeOdt(doc, fonts);
}

export async function renderScriptDocument(
  type: DocumentType,
  input: WpInput,
): Promise<Uint8Array> {
  // The Courier Prime files the PDF embeds (docs/app/formatting/formats-and-layout.md#FMT-154).
  return writeScriptDocument(type, input, await loadPdfFonts());
}

export async function exportScriptDocument(
  type: DocumentType,
  input: WpInput & { suggestedName: string },
): Promise<string | null> {
  return exporter.saveFile(input.suggestedName, await renderScriptDocument(type, input), type);
}
