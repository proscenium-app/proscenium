// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Autosave debounce (docs/app/keeping-work/storage-and-file-format.md#STOR-D10): write after `debounceMs` of idle, but never
 * wait longer than `maxWaitMs` once edits start arriving. Blur / app-hide /
 * quit force an immediate flush (the orchestrator calls `flushNow`).
 *
 * Timer primitives are injected so the policy is unit-tested with a fake clock —
 * no real waiting, no flakiness.
 */

export interface AutosaveOptions {
  debounceMs: number;
  maxWaitMs: number;
}

export const DEFAULT_AUTOSAVE: AutosaveOptions = {
  debounceMs: 600,
  maxWaitMs: 2000,
};

export interface TimerHost {
  set(fn: () => void, ms: number): number;
  clear(handle: number): void;
  now(): number;
}

const realTimers: TimerHost = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (h) => clearTimeout(h),
  now: () => Date.now(),
};

export class AutosaveScheduler {
  private idle: number | null = null;
  private max: number | null = null;
  private firstDirtyAt: number | null = null;

  constructor(
    private readonly opts: AutosaveOptions,
    private readonly flush: () => void,
    private readonly timers: TimerHost = realTimers,
  ) {}

  /** Call on every document mutation. Arms/re-arms the debounce. */
  schedule(): void {
    const now = this.timers.now();
    if (this.firstDirtyAt === null) this.firstDirtyAt = now;

    // Reset the idle timer on each edit.
    if (this.idle !== null) this.timers.clear(this.idle);
    const idleMs = this.opts.debounceMs;
    // Don't let the idle timer push us past the max-wait ceiling.
    const remaining = this.opts.maxWaitMs - (now - this.firstDirtyAt);
    const wait = Math.max(0, Math.min(idleMs, remaining));
    this.idle = this.timers.set(() => this.fire(), wait);

    // Arm the max-wait ceiling once.
    if (this.max === null) {
      this.max = this.timers.set(() => this.fire(), this.opts.maxWaitMs);
    }
  }

  /** Force an immediate flush (blur, route change, quit). */
  flushNow(): void {
    if (this.firstDirtyAt !== null) this.fire();
  }

  /** Drop any pending flush without writing (e.g. after an external reload). */
  cancel(): void {
    this.clearTimers();
    this.firstDirtyAt = null;
  }

  private fire(): void {
    this.clearTimers();
    this.firstDirtyAt = null;
    this.flush();
  }

  private clearTimers(): void {
    if (this.idle !== null) this.timers.clear(this.idle);
    if (this.max !== null) this.timers.clear(this.max);
    this.idle = null;
    this.max = null;
  }
}
