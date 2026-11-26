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

  test("every drag region is drawn through the record, so an iPad's bars carry none", () => {
    // An iPad's shell has no window to drag, and a tap on a drag region there
    // raised an error (src/ui/system-traits.ts, `windowDrag`). A bar that
    // wrote the attribute itself would bring it back.
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    const literal = [...glob.scanSync({ cwd: join(root, "src") })]
      .filter((file) => !/\.test\.tsx?$/.test(file) && file !== join("ui", "system-traits.ts"))
      .filter((file) =>
        readFileSync(join(root, "src", file), "utf8").includes("data-tauri-drag-region"),
      );
    expect(literal).toEqual([]);
  });
});
