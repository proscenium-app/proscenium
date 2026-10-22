// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WHEN a save should produce a version (docs/app/keeping-work/storage-and-file-format.md#STOR-D10): the first save of a
 * script, then at most one per bucket (default 5 minutes) — pulling something
 * back wants meaningful stopping points, not one entry per autosave.
 * Pre-destructive versions (reload, keep, restore, collision) bypass this
 * policy entirely: they are always taken, and most of them are pinned.
 *
 * Clock is injected so the policy is unit-tested without waiting.
 */
export class SnapshotPolicy {
  private last = new Map<string, number>();

  constructor(
    private readonly bucketMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when this save should snapshot (first save, or the bucket elapsed). */
  shouldSnapshot(scriptId: string): boolean {
    const t = this.last.get(scriptId);
    return t === undefined || this.now() - t >= this.bucketMs;
  }

  /** Record that a snapshot was just taken for `scriptId`. */
  record(scriptId: string): void {
    this.last.set(scriptId, this.now());
  }

  /** Forget a script (on close/teardown) so reopening snapshots immediately. */
  reset(scriptId: string): void {
    this.last.delete(scriptId);
  }
}

/** Where a writing version goes: the play it was written in, the item, its bytes. */
export type TakeVersion = (
  playId: string,
  id: string,
  content: string,
  ext: string,
) => Promise<unknown> | void;

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The versions a writer's own saves leave, for a script, a sheet or outline
 * notes alike (docs/app/keeping-work/storage-and-file-format.md#STOR-115).
 *
 * The bucket alone keeps the START of each five minutes: the words of the
 * last few minutes before a pause reached a version only with the first save
 * after it, which put them in the next sitting's changes. So a save the
 * bucket passes over is held, and kept once the saves go quiet
 * (`quietMs`, default 2 minutes) — each sitting ends on what was written.
 * Identical content dedups ring-side, so a quiet version that repeats the
 * last one costs nothing.
 *
 * A save also says what the file held before it (`before`). When that is not
 * what this keeper last saw land — the first save since opening, or the first
 * since a change arrived from outside — it is kept too, just ahead of the
 * save: it is where the writer's next changes start. Without it the first
 * sitting on a document had nothing to compare with, and a sitting after a
 * change from outside counted that change as the writer's.
 */
export class WritingVersions {
  private readonly policy: SnapshotPolicy;
  private readonly held = new Map<
    string,
    { playId: string; content: string; ext: string; timer: unknown }
  >();
  /** What each item's last save landed, as far as this keeper saw. */
  private readonly lastLanded = new Map<string, string>();

  constructor(
    private readonly take: TakeVersion,
    bucketMs = 5 * 60_000,
    private readonly quietMs = 2 * 60_000,
    now: () => number = Date.now,
    private readonly timers: Timers = realTimers,
  ) {
    this.policy = new SnapshotPolicy(bucketMs, now);
  }

  /** A save of `content` landed for `id`, over `before` (what the file held). */
  landed(playId: string, id: string, content: string, ext: string, before?: string): void {
    const held = this.held.get(id);
    if (held) this.timers.clear(held.timer);
    this.held.delete(id);
    const seen = this.lastLanded.get(id);
    this.lastLanded.set(id, content);
    const start =
      before !== undefined && before !== content && before !== seen ? before : undefined;
    if (start !== undefined || this.policy.shouldSnapshot(id)) {
      this.policy.record(id);
      if (start !== undefined)
        // In order: the earlier text must be the earlier version.
        void Promise.resolve(this.take(playId, id, start, ext)).then(
          () => this.take(playId, id, content, ext),
          () => this.take(playId, id, content, ext),
        );
      else void this.take(playId, id, content, ext);
      return;
    }
    const timer = this.timers.set(() => this.keepHeld(id), this.quietMs);
    this.held.set(id, { playId, content, ext, timer });
  }

  /** Keep what is held for `id` now (or for every item), instead of when saves go quiet. */
  flush(id?: string): void {
    for (const key of id === undefined ? [...this.held.keys()] : [id]) this.keepHeld(key);
  }

  /** A new session of `id`: what is held is kept, and its next save keeps a version. */
  reset(id: string): void {
    this.keepHeld(id);
    this.policy.reset(id);
    this.lastLanded.delete(id);
  }

  private keepHeld(id: string): void {
    const held = this.held.get(id);
    if (!held) return;
    this.timers.clear(held.timer);
    this.held.delete(id);
    this.policy.record(id);
    void this.take(held.playId, id, held.content, held.ext);
  }
}
