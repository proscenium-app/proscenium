// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, mock } from "bun:test";

/**
 * Tauri's event module, as far as `listen` uses it. Its unlisten rejects the
 * first `failures` times, as Tauri's does while the page's half of a listener
 * has not been added yet.
 */
let failures = 0;
let unlistens = 0;
let emit: ((payload: unknown) => void) | null = null;
mock.module("@tauri-apps/api/event", () => ({
  listen: async (_event: string, handler: (event: { payload: unknown }) => void) => {
    emit = (payload) => handler({ payload });
    return async () => {
      unlistens++;
      if (failures > 0) {
        failures--;
        throw new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')");
      }
      emit = null;
    };
  },
}));

const { listen } = await import("./ipc");

async function until(test: () => boolean) {
  for (let i = 0; i < 400 && !test(); i++) await new Promise((r) => setTimeout(r, 5));
}

describe("listen", () => {
  it("lets go even when Tauri's unlisten first finds nothing to remove", async () => {
    failures = 2;
    unlistens = 0;
    const seen: unknown[] = [];
    const off = await listen<string>("menu://action", (e) => seen.push(e.payload));
    emit?.("before");
    off();
    // Quiet at once, though Rust has not let go yet.
    emit?.("after");
    await until(() => emit === null);
    expect(emit).toBeNull();
    expect(unlistens).toBe(3);
    expect(seen).toEqual(["before"]);
  });

  it("lets go once, however often it is asked", async () => {
    failures = 0;
    unlistens = 0;
    const off = await listen("menu://action", () => {});
    off();
    off();
    await until(() => emit === null);
    await new Promise((r) => setTimeout(r, 50));
    expect(unlistens).toBe(1);
  });
});
