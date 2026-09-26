// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ImportDocument } from "./model";
import { assertDocumentSize } from "../storage/read-limit";

/** Parsing runs off the UI thread and can be cancelled even during decompression. */
export function analyze(
  name: string,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<ImportDocument> {
  assertDocumentSize(bytes.byteLength);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      worker.terminate();
      signal.removeEventListener("abort", cancel);
      clearTimeout(timer);
    };
    const cancel = () => {
      finish();
      reject(new DOMException("Import cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        new Error(
          "Reading took too long. Try exporting a smaller document or a Fountain copy.",
        ),
      );
    }, 30_000);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    worker.onmessage = (
      e: MessageEvent<{ document?: ImportDocument; error?: string }>,
    ) => {
      finish();
      if (e.data.document) resolve(e.data.document);
      else
        reject(new Error(e.data.error ?? "This document could not be read."));
    };
    worker.onerror = () => {
      finish();
      reject(
        new Error(
          "The document reader could not start. Close Import and try again.",
        ),
      );
    };
    worker.postMessage({ name, bytes });
  });
}
