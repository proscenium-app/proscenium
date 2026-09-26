// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { oneAtATime } from "./one-at-a-time";

/** A promise the test resolves by hand. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe("one at a time", () => {
  it("runs each job only after the one before it has finished, in order", async () => {
    const line = oneAtATime();
    const log: string[] = [];
    const slow = gate();
    const first = line(async () => {
      log.push("launch opens the last play");
      await slow.opened;
      log.push("launch done");
      return "last play";
    });
    const second = line(async () => {
      log.push("Finder opens its play");
      return "Finder's play";
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(["launch opens the last play"]);
    slow.open();
    expect(await first).toBe("last play");
    expect(await second).toBe("Finder's play");
    expect(log).toEqual(["launch opens the last play", "launch done", "Finder opens its play"]);
  });

  it("keeps going after a job fails, and hands the failure to its caller", async () => {
    const line = oneAtATime();
    const failed = line(async () => {
      throw new Error("the folder went away");
    });
    const next = line(async () => "the Plays screen");
    await expect(failed).rejects.toThrow("the folder went away");
    expect(await next).toBe("the Plays screen");
  });
});
