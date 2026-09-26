// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { UpdateRestart, type RestartServices } from "./update-restart";

test("Restart to Update locks before settling, coalesces requests, and unlocks after a failed installer", async () => {
  const events: string[] = [];
  let finish!: () => void;
  const services: RestartServices = {
    lock: () => { events.push("lock"); return () => { events.push("unlock"); }; },
    settle: async () => { events.push("settle"); return { lost: [], leave: async () => { events.push("kept"); } }; },
    confirmSaved: async () => { events.push("acknowledge"); },
    restart: async () => { events.push("install"); await new Promise<void>((r) => { finish = r; }); throw new Error("swap refused"); },
  };
  const updater = new UpdateRestart();
  const a = updater.run(services);
  expect(updater.run(services)).toBe(a);
  for (let i = 0; i < 10 && !finish; i++) await Promise.resolve();
  expect(events).toEqual(["lock", "settle", "kept", "acknowledge", "install"]);
  finish();
  expect(await a).toEqual({ failed: "Error: swap refused" });
  expect(events[events.length - 1]).toBe("unlock");
});

test("Restart to Update: lost words or an unacknowledged beacon never call the installer", async () => {
  for (const lost of [[], ["Script"]]) {
    let installs = 0;
    let unlocked = false;
    const result = await new UpdateRestart().run({
      lock: () => () => { unlocked = true; },
      settle: async () => ({ lost, leave: async () => {} }),
      confirmSaved: async () => { throw new Error("save state could not be written"); },
      restart: async () => { installs++; return { kind: "notReady" }; },
    });
    expect(result).toHaveProperty("failed");
    expect(installs).toBe(0);
    expect(unlocked).toBe(true);
  }
});
