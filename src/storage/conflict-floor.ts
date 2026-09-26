// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The conflict safety floor — TypeScript half (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
 *
 * The Rust vault owns the *mechanism* (atomic writes docs/app/keeping-work/storage-and-file-format.md#STOR-106, a collision that
 * writes nothing, self-write suppression). This owns the *policy* that gates an
 * open buffer:
 *
 *   docs/app/keeping-work/storage-and-file-format.md#STOR-104 — No silent loss of in-memory edits. An external change to a file with
 *        unsaved edits never reloads over them; it raises a non-blocking choice.
 *
 * `DocumentSession` tracks the two inputs the floor needs per open file — the
 * dirty flag and the last-known on-disk hash — and is a pure state machine, so
 * the invariant is unit-tested without Tauri or a DOM.
 */

/** Hash we believe is currently on disk (what the next write asserts). */
export type Hash = string;

export type WriteOutcome =
  | { status: "ok"; hash: Hash }
  /**
   * The file changed under us and nothing was written (docs/app/keeping-work/storage-and-file-format.md#STOR-D9). `hash` is
   * disk truth. The orchestrator pins a version holding our bytes.
   */
  | { status: "collision"; hash: Hash }
  /**
   * The same, on the play file, which rebases. A `DocumentSession` guards
   * authored documents, so it should never see this — but it is part of the
   * vault's outcome type, and `onSaved` treats every not-written outcome the
   * same way: the write did not land, so do not adopt its hash.
   */
  | { status: "stale"; hash: Hash };

export type ExternalChangeDecision =
  | { kind: "ignore"; reason: "unchanged" }
  | { kind: "ignore"; reason: "write-in-flight" }
  | { kind: "reload" }
  | { kind: "dirty-gate" };

/** Pure docs/app/keeping-work/storage-and-file-format.md#STOR-D9 external-change decision. The heart of docs/app/keeping-work/storage-and-file-format.md#STOR-104. */
export function decideExternalChange(
  state: { lastKnownHash: Hash | null; dirty: boolean },
  newHash: Hash | null,
): ExternalChangeDecision {
  // Echo of our own write (the watcher usually suppresses this, but the hash
  // check is the real guard): nothing actually changed for us.
  if (newHash !== null && newHash === state.lastKnownHash) {
    return { kind: "ignore", reason: "unchanged" };
  }
  // Safe: no unsaved edits to protect — reload and re-reconcile.
  if (!state.dirty) {
    return { kind: "reload" };
  }
  // docs/app/keeping-work/storage-and-file-format.md#STOR-104: unsaved edits present. The buffer stays exactly as-is; nothing is
  // overwritten until the user chooses.
  return { kind: "dirty-gate" };
}

export type SessionStatus = "clean" | "dirty" | "external-pending";

/**
 * Per-open-document floor state. One per open file (script or sidecar).
 */
export class DocumentSession {
  private _lastKnownHash: Hash | null;
  private _dirty = false;
  private _status: SessionStatus = "clean";
  /** The on-disk hash of "theirs" awaiting a dirty-gate choice, if any. */
  private _pendingTheirs: Hash | null = null;
  /** Depth of guarded writes currently in flight for this document. */
  private _writesInFlight = 0;
  /** Hashes that arrived while a write was in flight, decided on completion. */
  private _deferred: (Hash | null)[] = [];
  /** Every mutation counts one, so a landed write can tell which edits it carried. */
  private _edits = 0;

  constructor(
    /**
     * The path the document was opened at. A rename keeps its session — the
     * bytes, and so the hash, are unchanged, and unsaved edits must stay
     * unsaved — so writers address the file by the workspace's current path,
     * never by this.
     */
    readonly relPath: string,
    initialHash: Hash | null = null,
  ) {
    this._lastKnownHash = initialHash;
  }

  get dirty(): boolean {
    return this._dirty;
  }
  get status(): SessionStatus {
    return this._status;
  }
  get lastKnownHash(): Hash | null {
    return this._lastKnownHash;
  }
  /** The `expected` hash a guarded write should assert (docs/app/keeping-work/storage-and-file-format.md#STOR-D9). */
  get expectedForWrite(): Hash | null {
    return this._lastKnownHash;
  }
  get pendingTheirsHash(): Hash | null {
    return this._pendingTheirs;
  }
  /**
   * Autosave is allowed only when there are edits AND no unresolved external
   * conflict is pending (which would otherwise spam conflict siblings).
   */
  get canAutosave(): boolean {
    return this._dirty && this._status !== "external-pending";
  }

  /** A document mutation occurred. */
  markDirty(): void {
    this._edits += 1;
    this._dirty = true;
    if (this._status === "clean") this._status = "dirty";
  }

  /** True while at least one guarded write for this document is in flight. */
  get writeInFlight(): boolean {
    return this._writesInFlight > 0;
  }

  /**
   * How many edits the buffer has had. Read it where bytes are taken from the
   * buffer, and compare after an await: a different count means the writer
   * typed in between, and those words are not in the bytes.
   */
  get editCount(): number {
    return this._edits;
  }

  /**
   * A guarded write is about to be issued. Events arriving from here until
   * `onSaved` are deferred rather than decided: the file on disk is changing
   * under us BY US, and `lastKnownHash` still names the pre-write state, so
   * deciding now would gate against our own bytes (the self-write race behind a false conflict banner,
   * frontend half). The Rust vault also pre-registers its suppression token,
   * so this is defense in depth — either layer alone prevents the banner.
   *
   * Call it where the bytes are taken from the buffer. It returns how many
   * edits those bytes carry; hand that back to `onSaved`.
   */
  beginWrite(): number {
    this._writesInFlight += 1;
    return this._edits;
  }

  /**
   * A guarded write threw (IPC failure, vault gone). Balances `beginWrite` so
   * the in-flight count can never leak — a stuck counter would defer external
   * changes forever, which is exactly the silent-loss failure docs/app/keeping-work/storage-and-file-format.md#STOR-104 forbids.
   */
  abortWrite(): void {
    if (this._writesInFlight > 0) this._writesInFlight -= 1;
  }

  /**
   * A guarded write completed.
   *
   * `editsWritten` is what `beginWrite` returned. An edit made while the write
   * was in flight is not in the bytes that landed, so the buffer stays dirty and
   * the next flush carries it. Without this a keystroke that arrived mid-write
   * was marked saved: the status said Saved, autosave had nothing to do, and
   * the words existed only in memory until the writer happened to type again.
   * Omitted, the write is taken to have carried everything (a whole-document
   * replacement that reloads the editor with exactly what it wrote).
   */
  onSaved(outcome: WriteOutcome, editsWritten?: number): void {
    if (this._writesInFlight > 0) this._writesInFlight -= 1;
    if (outcome.status === "ok") {
      this._lastKnownHash = outcome.hash;
      this._dirty = editsWritten !== undefined && editsWritten !== this._edits;
      this._status = this._dirty ? "dirty" : "clean";
    } else {
      // Nothing was written and the on-disk file kept its (changed) contents.
      // The orchestrator has pinned a version holding ours (docs/app/keeping-work/storage-and-file-format.md#STOR-105). Surface a
      // conflict and stop autosaving until the writer chooses.
      this._status = "external-pending";
    }
  }

  /**
   * Decide any events that arrived while writes were in flight, now that
   * `lastKnownHash` names the state we actually wrote. Echoes of our own write
   * fall out as "unchanged"; anything genuinely different still gates. Returns
   * the first actionable decision (reload / dirty-gate), or null if all the
   * deferred events were echoes. Call after `onSaved`.
   */
  drainDeferred(): ExternalChangeDecision | null {
    if (this._writesInFlight > 0) return null; // more writes still pending
    const pending = this._deferred;
    this._deferred = [];
    for (const hash of pending) {
      const decision = this.onExternalChange(hash);
      if (decision.kind !== "ignore") return decision;
    }
    return null;
  }

  /** A watcher external-change event. Returns the docs/app/keeping-work/storage-and-file-format.md#STOR-D104 decision. */
  onExternalChange(newHash: Hash | null): ExternalChangeDecision {
    // A write of ours is mid-flight: we cannot tell our own echo from a real
    // external edit yet, because lastKnownHash still names the pre-write
    // state. Hold it and re-decide once the write resolves (docs/app/keeping-work/storage-and-file-format.md#STOR-104 is preserved —
    // nothing is reloaded or overwritten while deferred).
    if (this._writesInFlight > 0) {
      this._deferred.push(newHash);
      return { kind: "ignore", reason: "write-in-flight" };
    }
    const decision = decideExternalChange(
      { lastKnownHash: this._lastKnownHash, dirty: this._dirty },
      newHash,
    );
    if (decision.kind === "dirty-gate") {
      this._status = "external-pending";
      this._pendingTheirs = newHash;
    }
    return decision;
  }

  /**
   * The buffer was reloaded from disk — either the safe auto-reload, or the user
   * chose "Load theirs" at the dirty gate. Their version is now ours.
   */
  confirmReloaded(diskHash: Hash | null): void {
    this._lastKnownHash = diskHash;
    this._dirty = false;
    this._status = "clean";
    this._pendingTheirs = null;
    this._deferred = [];
  }

  /**
   * The writer chose "Keep this": after the orchestrator pinned a version of
   * theirs (docs/app/keeping-work/storage-and-file-format.md#STOR-105) and promoted ours to canonical, ours is the on-disk truth.
   *
   * `editsWritten` is `editCount` as it was when ours was serialized. Anything
   * typed after that is not in what landed, so the buffer stays dirty and
   * autosave carries it — the same rule as `onSaved`.
   */
  confirmPromoted(myHash: Hash, editsWritten?: number): void {
    this._lastKnownHash = myHash;
    this._dirty = editsWritten !== undefined && editsWritten !== this._edits;
    this._status = this._dirty ? "dirty" : "clean";
    this._pendingTheirs = null;
    this._deferred = [];
  }
}
