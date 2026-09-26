// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recovery snapshots, the writing half (docs/app/keeping-work/storage-and-file-format.md#STOR-D10, docs/app/keeping-work/storage-and-file-format.md#STOR-D13): while the open
 * script holds words that are not on disk, put them in app data every few
 * seconds; when they reach the disk, take the snapshot away.
 *
 * Autosave already lands typing within about two seconds, so in the ordinary
 * case a snapshot comes and goes unnoticed. It earns its keep when a flush
 * cannot land — the banner is up because the script changed somewhere else, the
 * disk refused the write, the folder went away — and the words then exist only
 * in this process. Five seconds is how much a crash can cost from there.
 *
 * Every write and delete for a script goes through one queue, in order. A
 * snapshot write still in flight when a flush lands must not be able to finish
 * AFTER the delete that the flush asked for, or it would leave a stale snapshot
 * behind to be offered on the next open.
 *
 * Timers and IO are injected, so the cadence is unit-tested with a fake clock.
 */
import type { TimerHost } from "./autosave";
import { encodeSnapshot } from "./recovery-policy";
import { ulid } from "../workspace/ulid";

export const RECOVERY_INTERVAL_MS = 5000;

export interface RecoveryTarget {
  playId: string;
  scriptId: string;
  /** The script's path in the play, carried in the snapshot for the offer's words. */
  path: string;
}

export interface RecoveryIO {
  write(playId: string, scriptId: string, content: string, owner: string): Promise<void>;
  remove(playId: string, scriptId: string, owner: string): Promise<void>;
  release?(playId: string, scriptId: string, owner: string): Promise<void>;
}

/** Which script's snapshot: the play it is in, and the script. */
export type RecoveryScript = Pick<RecoveryTarget, "playId" | "scriptId">;

const realTimers: TimerHost = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (h) => clearTimeout(h),
  now: () => Date.now(),
};

export class RecoverySnapshots {
  private target: RecoveryTarget | null = null;
  private owner: string | null = null;
  private owners = new Map<string, string>();
  /** The buffer's text while it holds unsaved words; null while it is clean. */
  private capture: () => string | null = () => null;
  private timer: number | null = null;
  /** The words the last snapshot write for the target carried, so unchanged words are not written again. */
  private written: string | null = null;
  /**
   * A snapshot for the target may be on disk. Set by any write, including one
   * that reported failure — the snapshot an earlier write left is still there,
   * and a delete for a file that is not there costs nothing. Only a delete
   * clears it.
   */
  private onDisk = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly io: RecoveryIO,
    private readonly timers: TimerHost = realTimers,
    private readonly intervalMs = RECOVERY_INTERVAL_MS,
  ) {}

  /** Follow the script that just opened. Nothing is written until it is dirty. */
  attach(target: RecoveryTarget, capture: () => string | null): void {
    this.detach();
    this.target = { ...target };
    this.owner = ulid();
    this.owners.set(`${target.playId}/${target.scriptId}`, this.owner);
    this.capture = capture;
  }

  /** The open script moved or was renamed: snapshots say where it is now. */
  moved(path: string): void {
    if (this.target) this.target = { ...this.target, path };
  }

  /** The existing copy is now the only home for replaced words. Retire its
   * owner and give subsequent typing a different file, even in this editor. */
  keepAndContinue(): void {
    if (this.target) this.attach(this.target, this.capture);
  }

  /** Stop following. A snapshot already on disk stays — that is its purpose. */
  detach(): void {
    const target = this.target, owner = this.owner;
    if (target && owner && this.io.release) {
      void this.enqueue(() => this.io.release!(target.playId, target.scriptId, owner));
    }
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.target = null;
    this.owner = null;
    this.capture = () => null;
    this.written = null;
    this.onDisk = false;
  }

  /** An edit made the buffer dirty: the cadence runs until it is clean again. */
  dirty(): void {
    if (!this.target || this.timer !== null) return;
    this.timer = this.timers.set(() => this.tick(), this.intervalMs);
  }

  /**
   * A script's words are safe somewhere else — a flush landed, a reload
   * replaced them with the file, they went into a pinned version. Its snapshot
   * has nothing left to guard.
   *
   * `script` is the open script when omitted. Naming it matters to a write
   * that lands after the writer has moved to another script: the words it
   * carried are the first script's, and so is the snapshot to delete.
   */
  saved(script?: RecoveryScript): Promise<void> {
    const target = this.target;
    const whose = script ?? target;
    if (!whose) return this.queue;
    const owner = this.owners.get(`${whose.playId}/${whose.scriptId}`);
    if (!owner) return this.queue;
    const open = target !== null && target.playId === whose.playId && target.scriptId === whose.scriptId;
    if (open) {
      // Nothing was ever written for it: a flush with no snapshot behind it
      // costs no IPC at all.
      if (!this.onDisk) return this.queue;
      this.written = null;
      this.onDisk = false;
    }
    return this.enqueue(() => this.io.remove(whose.playId, whose.scriptId, owner));
  }

  /**
   * Snapshot the unsaved words now instead of at the next tick — for the
   * moment just before the buffer is replaced, or the app quits, when they
   * could be kept nowhere else. Resolves once the write has been tried: true
   * when the words it took are in this owner's snapshot, false when the target
   * changed or the write failed, so a quit can keep them some other way.
   */
  async writeNow(): Promise<boolean> {
    const target = this.target;
    const owner = this.owner;
    if (!target) return false;
    const text = this.capture();
    this.write(target, text);
    await this.queue;
    return text !== null && this.owner === owner && this.written === text;
  }

  /** Resolves when every queued write and delete has finished. */
  settle(): Promise<void> {
    return this.queue;
  }

  private tick(): void {
    this.timer = null;
    const target = this.target;
    if (!target) return;
    const text = this.capture();
    // Clean: stop here. The next edit starts the cadence again.
    if (text === null) return;
    this.timer = this.timers.set(() => this.tick(), this.intervalMs);
    this.write(target, text);
  }

  private write(target: RecoveryTarget, text: string | null): void {
    const owner = this.owner;
    if (text === null || text === this.written || !owner) return;
    this.written = text;
    this.onDisk = true;
    const body = encodeSnapshot({ path: target.path, savedAtMs: this.timers.now(), content: text });
    void this.enqueue(() =>
      this.io.write(target.playId, target.scriptId, body, owner).catch((e: unknown) => {
        // Nothing landed, so the next tick must try again rather than believe
        // these words are already safe.
        if (this.owner === owner && this.written === text) this.written = null;
        throw e;
      }),
    );
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    // A failed write costs this one snapshot, never the queue behind it.
    this.queue = this.queue.then(op).catch(() => {});
    return this.queue;
  }
}
