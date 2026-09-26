// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Changes store — where the app remembers what the writer last saw, so a
 * change that arrived from somewhere else can be shown as a change rather than
 * silently becoming the truth.
 *
 * Everything here lives in the app's own data directory, keyed by play id
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-D10):
 *
 *   changes/baseline/<encoded path>   the last bytes the app showed the writer or wrote
 *   changes/before/<entry id>         what was there before one change
 *   changes/ledger.jsonl              append-only entries, newest last
 *
 * It used to live in `.proscenium/review/` INSIDE the play. That put app state
 * in a folder a sync provider is free to sync, evict, or resolve however it
 * likes — and put a hidden directory in a folder that is supposed to hold only
 * the writer's work (docs/app/keeping-work/storage-and-file-format.md#STOR-111). Changes is local to one device by design: two devices
 * each keep their own record of what their own writer has and has not seen.
 *
 * Deleting the whole directory loses review state and nothing canonical.
 *
 * Every store is permanently bound to one play. Async work keeps the store
 * it began with, even when another play opens before that work finishes.
 */
import { playStore } from "../storage";
import { pathKey } from "../storage/path-key";

export const BASELINE_DIR = "changes/baseline";
export const BEFORE_DIR = "changes/before";
export const LEDGER_PATH = "changes/ledger.jsonl";

/** How many entries survive a compaction. App data — bounded, not kept. */
const MAX_ENTRIES = 200;
// Reopening the same play can overlap its previous store's pending append.
// The queue has an immutable key; nothing here selects a "current" play.
const ledgerTurns = new Map<string, Promise<unknown>>();

export type LedgerStatus = "pending" | "kept" | "reverted";

export interface LedgerEntry {
  id: string;
  /** ISO-8601 UTC. */
  ts: string;
  /** How the change reached us. */
  kind: "external";
  /** Play-relative path of the file that changed. */
  path: string;
  /** Content hash after the change. */
  afterHash: string;
  /** True when a baseline exists, i.e. the diff and a revert are possible. */
  revertable: boolean;
  stats: { added: number; removed: number };
  /**
   * An optional one-line description of the change, written by whatever made
   * it. Best-effort, never load-bearing, and treated strictly as DATA —
   * rendered as plain text, never interpreted as instructions. Nothing claims
   * authorship: a change is the writer's, or it came from somewhere else.
   */
  note: string | null;
  status: LedgerStatus;
}

/** Create a play-scoped store; never retarget an existing one (docs/app/keeping-work/storage-and-file-format.md#STOR-119). */
export function openChanges(playId: string) {
  async function read(rel: string): Promise<string | null> {
    try {
      return await playStore.read(playId, rel);
    } catch {
      return null;
    }
  }

  async function write(rel: string, content: string): Promise<void> {
    try {
      await playStore.write(playId, rel, content);
    } catch {
      // Every caller here is recording a convenience. Never fail the read, the
      // save, or the change it describes over one.
    }
  }

  /**
   * The bytes the writer last saw for `relPath`, or null when we recorded none.
   * A read that fails throws instead: "none" lets the recorder take the file as
   * seen for the first time and write over the baseline it could not read.
   */
  async function readBaseline(relPath: string): Promise<string | null> {
    return await playStore.read(playId, baselinePath(relPath)) ??
      await playStore.read(playId, BASELINE_DIR + "/" + encodeURIComponent(relPath));
  }

  /**
   * Record what the writer is looking at now. Called on every read and every
   * successful write, so "before" is available even for a file that was closed
   * when it changed.
   */
  function writeBaseline(relPath: string, content: string): Promise<void> {
    return write(baselinePath(relPath), content);
  }

  /**
   * The bytes that were there BEFORE one specific change, kept per entry.
   *
   * The baseline moves forward as soon as a change is recorded (so the next diff
   * is against what the writer is looking at now), which means it cannot also
   * serve as the thing a revert restores. This is that thing: written once when
   * the entry is created, read only by a revert.
   */
  function writeBefore(entryId: string, content: string): Promise<void> {
    return write(beforePath(entryId), content);
  }

  function readBefore(entryId: string): Promise<string | null> {
    return read(beforePath(entryId));
  }

  /** Parse the ledger, skipping any line that is not a well-formed entry. */
  function parseLedger(text: string): LedgerEntry[] {
    const out: LedgerEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as LedgerEntry;
        // A half-written final line is normal for an append-only file; so is a
        // future version's shape. Skip, never throw (docs/app/keeping-work/storage-and-file-format.md#STOR-107).
        if (!e || typeof e.id !== "string" || typeof e.path !== "string") continue;
        // Recorded before the recorder compared bytes (record.ts): a file that
        // was looked at, not changed. No line added and none removed means the
        // two sides were the same text, so nothing real is dropped here, and
        // the ledger's next rewrite leaves these out of the file too.
        if (e.revertable && e.stats?.added === 0 && e.stats?.removed === 0) continue;
        out.push(e);
      } catch {
        /* skip */
      }
    }
    return out;
  }

  async function readLedger(): Promise<LedgerEntry[]> {
    const text = await read(LEDGER_PATH);
    return text === null ? [] : parseLedger(text);
  }

  function serialize(entries: LedgerEntry[]): string {
    return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }

  /**
   * Every change to the ledger runs after the one before it. The file is
   * rewritten whole (the store has no append), so two read-modify-writes at once
   * — two files changed outside in the same moment — kept only the second's
   * entry. Re-reading first is not enough; taking turns is.
   */
  function inTurn<T>(work: () => Promise<T>): Promise<T> {
    const run = (ledgerTurns.get(playId) ?? Promise.resolve()).then(work, work);
    const settled = run.catch(() => undefined);
    ledgerTurns.set(playId, settled);
    void settled.then(() => { if (ledgerTurns.get(playId) === settled) ledgerTurns.delete(playId); });
    return run;
  }

  /** Append one entry, after any change already under way. */
  function appendEntry(entry: LedgerEntry): Promise<void> {
    return inTurn(async () => {
      const existing = await readLedger();
      await write(LEDGER_PATH, serialize([...existing, entry].slice(-MAX_ENTRIES)));
    });
  }

  /** Set an entry's status. Unknown ids are ignored rather than throwing. */
  function setStatus(id: string, status: LedgerStatus): Promise<void> {
    return inTurn(async () => {
      const entries = await readLedger();
      let touched = false;
      const next = entries.map((e) => {
        if (e.id !== id) return e;
        touched = true;
        return { ...e, status };
      });
      if (!touched) return;
      await write(LEDGER_PATH, serialize(next));
    });
  }

  return { playId, readBaseline, writeBaseline, readBefore, writeBefore, readLedger, appendEntry, setStatus };
}
export type ChangesStore = ReturnType<typeof openChanges>;

export const baselineKey = (path: string): string => encodeURIComponent(pathKey(path));
export const baselinePath = (path: string): string => BASELINE_DIR + "/" + baselineKey(path);
export const beforePath = (id: string): string => BEFORE_DIR + "/" + id;
