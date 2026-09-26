// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";

test("docs/app/keeping-work/storage-and-file-format.md#STOR-5: canonical files expose recoverable Trash, never a permanent-delete command", async () => {
  const native = await Bun.file(new URL("../../src-tauri/src/lib.rs", import.meta.url)).text();
  const backend = await Bun.file(
    new URL("../../src-tauri/src/vault/mod.rs", import.meta.url),
  ).text();
  const bridge = await Bun.file(new URL("./ipc.ts", import.meta.url)).text();
  expect(/\bvault_remove\b/.test(native)).toBe(false);
  expect(/\bvault_remove\b/.test(bridge)).toBe(false);
  expect(/\bfn remove\(/.test(backend)).toBe(false);
  expect(/async fn vault_trash\(/.test(native)).toBe(true);
  expect(bridge.includes('invoke("vault_trash", { rel })')).toBe(true);
  // The separately scoped app-data store still maintains recovery and Versions.
  expect(/async fn store_remove\(/.test(native)).toBe(true);
  expect(/async fn recovery_remove\(/.test(native)).toBe(true);
});
