// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { assertDocumentText, MAX_DOCUMENT_BYTES, readImportFile } from "./read-limit";
import { scriptFromFile } from "../fountain/fdx";

test("docs/app/keeping-work/storage-and-file-format.md#STOR-33: an oversized import is refused before File.text or conversion", async () => {
  let read = false;
  await expect(readImportFile({ size: MAX_DOCUMENT_BYTES + 1, text: async () => { read = true; return "words"; } })).rejects.toThrow("16 MiB");
  expect(read).toBe(false);
  expect(() => scriptFromFile("draft.fdx", "x".repeat(MAX_DOCUMENT_BYTES + 1))).toThrow("16 MiB");
  expect(() => assertDocumentText("é".repeat(MAX_DOCUMENT_BYTES / 2 + 1))).toThrow("16 MiB");
  expect(await readImportFile({ size: 5, text: async () => "words" })).toBe("words");
});
