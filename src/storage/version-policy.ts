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
