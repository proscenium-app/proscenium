// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readDocument } from "./read";
self.onmessage = (event: MessageEvent<{ name: string; bytes: Uint8Array }>) => {
  try {
    self.postMessage({
      document: readDocument(event.data.name, event.data.bytes),
    });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
