// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TimerHost } from "./autosave";
import {
  RecoverySnapshots,
  RECOVERY_INTERVAL_MS,
  type RecoveryIO,
  type RecoveryTarget,
} from "./recovery";

export interface RecoveryBuffer extends RecoveryTarget {
  key: string;
  content: string;
}
interface Entry {
  snapshot: RecoverySnapshots;
  target: RecoveryTarget;
  content: string;
}
const timers: TimerHost = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id),
  now: () => Date.now(),
};

/** Independent owners for every unsaved sheet/outline variant. Capturing all
 * replacements succeeds before any obsolete snapshot is removed. */
export class BufferRecovery {
  private entries = new Map<string, Entry>();
  private timer: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private io: RecoveryIO,
    private capture: () => RecoveryBuffer[],
    private clock: TimerHost = timers,
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = this.clock.set(() => {
      this.timer = null;
      void this.captureNow();
      this.start();
    }, RECOVERY_INTERVAL_MS);
  }

  captureNow(): Promise<boolean> {
    const buffers = this.capture();
    const work = async () => {
      const seen = new Set<string>();
      const writes: Promise<boolean>[] = [];
      for (const buffer of buffers) {
        if (seen.has(buffer.key)) throw new Error("duplicate recovery buffer key");
        seen.add(buffer.key);
        let entry = this.entries.get(buffer.key);
        if (
          entry &&
          (entry.target.playId !== buffer.playId || entry.target.scriptId !== buffer.scriptId)
        ) {
          entry.snapshot.detach();
          await entry.snapshot.settle();
          entry = undefined;
        }
        if (!entry) {
          const snapshot = new RecoverySnapshots(this.io, this.clock);
          const fresh: Entry = { snapshot, target: buffer, content: buffer.content };
          snapshot.attach(buffer, () => fresh.content);
          entry = fresh;
          this.entries.set(buffer.key, entry);
        }
        entry.content = buffer.content;
        entry.snapshot.moved(buffer.path);
        writes.push(entry.snapshot.writeNow());
      }
      const safe = (await Promise.all(writes)).every(Boolean);
      if (safe) {
        for (const [key, entry] of this.entries) {
          if (seen.has(key)) continue;
          await entry.snapshot.saved();
          entry.snapshot.detach();
          await entry.snapshot.settle();
          this.entries.delete(key);
        }
      }
      return safe;
    };
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  /** Leaving a workspace relinquishes ownership but never removes words. */
  detach(): Promise<void> {
    const result = this.queue.then(async () => {
      for (const entry of this.entries.values()) entry.snapshot.detach();
      await Promise.all([...this.entries.values()].map((entry) => entry.snapshot.settle()));
      this.entries.clear();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  stop(): Promise<void> {
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = null;
    return this.detach();
  }

  async settle(): Promise<void> {
    await this.queue;
  }
}
