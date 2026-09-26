// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import type { TimerHost } from "./autosave";
import { RecoverySnapshots, type RecoveryIO } from "./recovery";
import { decodeSnapshot } from "./recovery-policy";

it("docs/app/keeping-work/storage-and-file-format.md#STOR-117: another session cannot overwrite or delete these recovery words", async () => {
  // The review repro shared one slot. This store keys every owner passed by
  // production, so absent ownership reproduces the same overwrite/delete.
  const disk = new Map<string, string>();
  const io: RecoveryIO = {
    write: async (p, s, text, owner = "legacy") => { disk.set(`${p}/${s}/${owner}`, text); },
    remove: async (p, s, owner = "legacy") => { disk.delete(`${p}/${s}/${owner}`); },
  };
  const a = new RecoverySnapshots(io), b = new RecoverySnapshots(io);
  const target = { playId: "P", scriptId: "S", path: "A.fountain" };
  a.attach(target, () => "A UNSAVED"); b.attach(target, () => "B UNSAVED");
  expect(await a.writeNow()).toBe(true); expect(await b.writeNow()).toBe(true);
  expect(disk.size).toBe(2);
  await b.saved();
  expect(await a.writeNow()).toBe(true);
  expect([...disk.values()].map((raw) => decodeSnapshot(raw)?.content)).toEqual(["A UNSAVED"]);
});

it("docs/app/keeping-work/storage-and-file-format.md#STOR-117: retiring an only-copy snapshot gives continued typing another owner", async () => {
  const disk = new Map<string, string>(), released: string[] = [];
  const rec = new RecoverySnapshots({
    write: async (_p, _s, text, owner) => { disk.set(owner, text); },
    remove: async (_p, _s, owner) => { disk.delete(owner); },
    release: async (_p, _s, owner) => { released.push(owner); },
  });
  let text = "ORIGINAL UNSAVED WORDS";
  rec.attach({ playId: "P", scriptId: "S", path: "A.fountain" }, () => text);
  expect(await rec.writeNow()).toBe(true);
  const originalOwner = [...disk.keys()][0];
  rec.keepAndContinue();
  text = "NEW TYPING";
  expect(await rec.writeNow()).toBe(true);
  await rec.saved();
  expect(released).toEqual([originalOwner]);
  expect([...disk.values()].map((raw) => decodeSnapshot(raw)?.content)).toEqual(["ORIGINAL UNSAVED WORDS"]);
});

/** A clock that only moves when the test says so. */
function fakeTimers() {
  let now = 1_000_000;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const host: TimerHost = {
    set: (fn, ms) => {
      due.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clear: (h) => void due.delete(h),
    now: () => now,
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      due.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = until;
  };
  return { host, advance };
}

/** An app-data directory in a Map, with a log of what happened in order. */
function fakeIO(opts: { slowWrite?: boolean; failWrites?: number } = {}) {
  const files = new Map<string, string>();
  const log: string[] = [];
  let failures = opts.failWrites ?? 0;
  const io: RecoveryIO = {
    write: async (playId, scriptId, content) => {
      if (opts.slowWrite) await new Promise((r) => setTimeout(r, 5));
      if (failures > 0) {
        failures--;
        log.push("write-failed");
        throw new Error("disk full");
      }
      files.set(`${playId}/${scriptId}`, content);
      log.push(`write ${decodeSnapshot(content)?.content}`);
    },
    remove: async (playId, scriptId) => {
      files.delete(`${playId}/${scriptId}`);
      log.push("remove");
    },
  };
  return { io, files, log };
}

const TARGET = { playId: "01PLAY", scriptId: "01SCRIPT", path: "The Tide.fountain" };

describe("recovery snapshots: the cadence", () => {
  it("writes the unsaved words every five seconds while the buffer is dirty", async () => {
    const t = fakeTimers();
    const { io, files, log } = fakeIO();
    const rec = new RecoverySnapshots(io, t.host);
    let buffer: string | null = "She waits.";
    rec.attach(TARGET, () => buffer);

    rec.dirty();
    t.advance(4999);
    await rec.settle();
    expect(log).toEqual([]);
    t.advance(1);
    await rec.settle();
    expect(log).toEqual(["write She waits."]);

    buffer = "She waits. The sea";
    t.advance(5000);
    await rec.settle();
    expect(log).toEqual(["write She waits.", "write She waits. The sea"]);
    const snap = decodeSnapshot(files.get("01PLAY/01SCRIPT")!);
    expect(snap?.path).toBe("The Tide.fountain");
    // Stamped when the words were captured, not when the disk finished.
    expect(snap?.savedAtMs).toBe(1_000_000 + 10_000);
  });

  it("does not rewrite words it has already kept", async () => {
    const t = fakeTimers();
    const { io, log } = fakeIO();
    const rec = new RecoverySnapshots(io, t.host);
    rec.attach(TARGET, () => "unchanged");
    rec.dirty();
    t.advance(20_000);
    await rec.settle();
    expect(log).toEqual(["write unchanged"]);
  });

  it("stops when the buffer is clean, and starts again with the next edit", async () => {
    const t = fakeTimers();
    const { io, log } = fakeIO();
    const rec = new RecoverySnapshots(io, t.host);
    let buffer: string | null = null;
    rec.attach(TARGET, () => buffer);
    rec.dirty();
    t.advance(30_000);
    await rec.settle();
    expect(log).toEqual([]);

    buffer = "A new line.";
    rec.dirty();
    t.advance(5000);
    await rec.settle();
    expect(log).toEqual(["write A new line."]);
  });
});

describe("recovery snapshots: when the words land", () => {
  it("deletes the snapshot after a flush, and only if one was written", async () => {
    const t = fakeTimers();
    const { io, files, log } = fakeIO();
    const rec = new RecoverySnapshots(io, t.host);
    rec.attach(TARGET, () => "words");

    // A flush with no snapshot behind it costs no IPC at all.
    await rec.saved();
    expect(log).toEqual([]);

    rec.dirty();
    t.advance(5000);
    await rec.saved();
    expect(log).toEqual(["write words", "remove"]);
    expect(files.size).toBe(0);
  });

  it("never lets a slow snapshot write land after the delete that followed it", async () => {
    const t = fakeTimers();
    const { io, files, log } = fakeIO({ slowWrite: true });
    const rec = new RecoverySnapshots(io, t.host);
    rec.attach(TARGET, () => "typed just before the flush");
    rec.dirty();
    t.advance(5000); // the write starts, and is still in flight…
    await rec.saved(); // …when the flush lands and asks for the delete.
    expect(log).toEqual(["write typed just before the flush", "remove"]);
    expect(files.size).toBe(0);
  });

  it("tries again after a write that failed, instead of believing the words are kept", async () => {
    const t = fakeTimers();
    const { io, files, log } = fakeIO({ failWrites: 1 });
    const rec = new RecoverySnapshots(io, t.host);
    rec.attach(TARGET, () => "the only copy");
    rec.dirty();
    t.advance(5000);
    await rec.settle();
    t.advance(5000);
    await rec.settle();
    expect(log).toEqual(["write-failed", "write the only copy"]);
    expect(files.size).toBe(1);
  });

  it("still deletes the snapshot an earlier write left when a later write fails", async () => {
    // The first write landed; the second did not, which leaves the first on
    // disk. When the words then reach the disk, that older snapshot must go
    // too, or the next open offers words the script already has.
    const t = fakeTimers();
    const { io, files, log } = fakeIO();
    const rec = new RecoverySnapshots(io, t.host);
    let buffer = "first";
    rec.attach(TARGET, () => buffer);
    rec.dirty();
    t.advance(5000);
    await rec.settle();
    io.write = async () => {
      log.push("write-failed");
      throw new Error("disk full");
    };
    buffer = "second";
    t.advance(5000);
    await rec.settle();
    expect(files.size).toBe(1);

    await rec.saved();
    expect(log).toEqual(["write first", "write-failed", "remove"]);
    expect(files.size).toBe(0);
  });

  it("writes at once when asked, and names the script a late flush saved", async () => {
    const t = fakeTimers();
    const { io, files, log } = fakeIO();
    const rec = new RecoverySnapshots(io, t.host);
    rec.attach(TARGET, () => "about to be replaced");
    await rec.writeNow();
    expect(log).toEqual(["write about to be replaced"]);
    expect(decodeSnapshot(files.get("01PLAY/01SCRIPT")!)?.content).toBe("about to be replaced");

    // The writer moves to another script before the first script's flush lands.
    rec.attach({ playId: "01PLAY", scriptId: "01OTHER", path: "Other.fountain" }, () => null);
    await rec.saved({ playId: "01PLAY", scriptId: "01SCRIPT" });
    expect(log).toEqual(["write about to be replaced", "remove"]);
    expect(files.size).toBe(0);
  });

  it("says whether the words it was asked to keep are in the snapshot, so a quit can keep them elsewhere", async () => {
    const t = fakeTimers();
    let buffer: string | null = "typed before quitting";

    const ok = fakeIO();
    const rec = new RecoverySnapshots(ok.io, t.host);
    expect(await rec.writeNow()).toBe(false); // no script is open
    rec.attach(TARGET, () => buffer);
    expect(await rec.writeNow()).toBe(true);
    // The same words again: already there, and not written twice.
    expect(await rec.writeNow()).toBe(true);
    expect(ok.log).toEqual(["write typed before quitting"]);

    // A full disk: the write is tried, and the answer says it did not land.
    const full = fakeIO({ failWrites: 1 });
    const refused = new RecoverySnapshots(full.io, t.host);
    refused.attach(TARGET, () => buffer);
    expect(await refused.writeNow()).toBe(false);
    expect(await refused.writeNow()).toBe(true); // and tried again next time

    buffer = null;
    expect(await rec.writeNow()).toBe(false); // nothing unsaved to keep
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-117: an earlier snapshot does not prevent new recovery, and stays untouched", async () => {
    const t = fakeTimers();
    const files = new Map([["legacy", "owed to the writer"]]);
    const io: RecoveryIO = {
      write: async (_p, _s, text, owner) => { files.set(owner, text); },
      remove: async (_p, _s, owner) => { files.delete(owner); },
    };
    const rec = new RecoverySnapshots(io, t.host);
    rec.attach(TARGET, () => "newer typing");
    rec.dirty();
    t.advance(15_000);
    await rec.settle();
    expect(files.size).toBe(2);
    await rec.saved();
    expect([...files.values()]).toEqual(["owed to the writer"]);
  });

  it("detaching keeps the snapshot on disk — that is what it is for", async () => {
    const t = fakeTimers();
    const { io, files } = fakeIO();
    const rec = new RecoverySnapshots(io, t.host);
    rec.attach(TARGET, () => "unsaved at quit");
    rec.dirty();
    t.advance(5000);
    rec.detach();
    await rec.settle();
    t.advance(60_000);
    await rec.saved();
    expect(files.size).toBe(1);
  });
});
