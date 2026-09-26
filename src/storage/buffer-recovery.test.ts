// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from "bun:test";
import { BufferRecovery, type RecoveryBuffer } from "./buffer-recovery";
import { decodeSnapshot } from "./recovery-policy";

it("docs/app/keeping-work/storage-and-file-format.md#STOR-116: live, gated, parked, and first-outline words all receive separate recovery copies", async () => {
  const disk = new Map<string, string>();
  const words = ["sheet", "gated-sheet", "parked-sheet", "outline-unsaved"];
  let input: RecoveryBuffer[] = words.map((content, i) => ({
    key: String(i),
    playId: "P",
    scriptId: i < 3 ? "M" : "outline-unsaved",
    path: "Notes.md",
    content,
  }));
  let fail = false;
  const copy = new BufferRecovery(
    {
      write: async (_p, _s, content, owner) => {
        if (fail) throw new Error("disk full");
        disk.set(owner, content);
      },
      remove: async (_p, _s, owner) => {
        disk.delete(owner);
      },
    },
    () => input,
  );
  expect(await copy.captureNow()).toBe(true);
  expect([...disk.values()].map((v) => decodeSnapshot(v)?.content).sort()).toEqual(
    [...words].sort(),
  );
  input = [{ ...input[0], key: "replacement", content: "latest" }];
  fail = true;
  expect(await copy.captureNow()).toBe(false);
  expect(disk.size).toBe(4); // no earlier copy removed while its replacement fails
  fail = false;
  expect(await copy.captureNow()).toBe(true);
  expect([...disk.values()].map((v) => decodeSnapshot(v)?.content)).toEqual(["latest"]);
  await copy.detach();
  expect(disk.size).toBe(1); // crash/open can still recover a detached workspace
});

it("docs/app/keeping-work/storage-and-file-format.md#STOR-116: the recovery cadence bounds loss while an editor never pauses", async () => {
  let tick: (() => void) | null = null;
  let word = "first",
    at = 0;
  const saved: string[] = [];
  const copy = new BufferRecovery(
    {
      write: async (_p, _s, content) => {
        saved.push(decodeSnapshot(content)!.content);
      },
      remove: async () => {},
    },
    () => [{ key: "outline", playId: "P", scriptId: "N", path: "Outline.md", content: word }],
    {
      now: () => at,
      set: (fn, delay) => {
        expect(delay).toBe(5000);
        tick = fn;
        return 1;
      },
      clear: () => {
        tick = null;
      },
    },
  );
  copy.start();
  for (let i = 1; i <= 3; i++) {
    word = "continuous typing " + i;
    at += 5000;
    (tick as unknown as () => void)();
    await copy.settle();
  }
  expect(saved).toEqual(["continuous typing 1", "continuous typing 2", "continuous typing 3"]);
  await copy.stop();
  expect(tick).toBeNull();
});
