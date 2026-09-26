// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

describe("the window moves by its top bar", () => {
  test("the page may ask the window to start dragging", () => {
    // Without this permission Tauri refuses `start_dragging`, and every
    // `data-tauri-drag-region` in the app does nothing: the window could not be
    // moved at all. `core:default` does not include it.
    const capability = JSON.parse(
      readFileSync(join(root, "src-tauri", "capabilities", "default.json"), "utf8"),
    ) as { windows: string[]; permissions: string[] };
    expect(capability.windows).toContain("main");
    expect(capability.permissions).toContain("core:window:allow-start-dragging");
  });
});
