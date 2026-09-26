// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Keep in step with vault/read_limit.rs. Applies before importing or parsing. */
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;
export const DOCUMENT_SIZE_MESSAGE =
  "This file is larger than Proscenium's 16 MiB document limit. Its original has not been changed.";
export class DocumentSizeError extends Error {
  constructor() {
    super(DOCUMENT_SIZE_MESSAGE);
  }
}
export function assertDocumentSize(bytes: number): void {
  if (bytes > MAX_DOCUMENT_BYTES) throw new DocumentSizeError();
}
export function assertDocumentText(text: string): void {
  assertDocumentSize(text.length);
  assertDocumentSize(new TextEncoder().encode(text).byteLength);
}

/** File.size is checked before allocating its contents, then checked again. */
export async function readImportFile(file: Pick<File, "size" | "text">): Promise<string> {
  assertDocumentSize(file.size);
  const text = await file.text();
  assertDocumentText(text);
  return text;
}
