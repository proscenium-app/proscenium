// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { DocumentSession, decideExternalChange } from "./conflict-floor";

describe("decideExternalChange (docs/app/keeping-work/storage-and-file-format.md#STOR-D104)", () => {
  it("ignores an echo of our own write", () => {
    expect(
      decideExternalChange({ lastKnownHash: "sha256:aa", dirty: false }, "sha256:aa"),
    ).toEqual({ kind: "ignore", reason: "unchanged" });
  });

  it("reloads when the buffer is clean", () => {
    expect(
      decideExternalChange({ lastKnownHash: "sha256:aa", dirty: false }, "sha256:bb"),
    ).toEqual({ kind: "reload" });
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-104: dirty-gates when there are unsaved edits", () => {
    expect(
      decideExternalChange({ lastKnownHash: "sha256:aa", dirty: true }, "sha256:bb"),
    ).toEqual({ kind: "dirty-gate" });
  });
});

describe("DocumentSession", () => {
  it("docs/app/keeping-work/storage-and-file-format.md#STOR-89: deletion immediately gates a dirty buffer and keeps its expected hash", () => {
    const s = new DocumentSession("A.fountain", "sha256:before");
    s.markDirty();
    expect(s.onExternalChange(null)).toEqual({ kind: "dirty-gate" });
    expect(s.canAutosave).toBe(false);
    expect(s.dirty).toBe(true);
    expect(s.expectedForWrite).toBe("sha256:before");
  });
  it("tracks dirty + last-known hash through a save", () => {
    const s = new DocumentSession("script/play.fountain", "sha256:base");
    expect(s.status).toBe("clean");
    s.markDirty();
    expect(s.dirty).toBe(true);
    expect(s.status).toBe("dirty");
    expect(s.canAutosave).toBe(true);
    expect(s.expectedForWrite).toBe("sha256:base");

    s.onSaved({ status: "ok", hash: "sha256:new" });
    expect(s.dirty).toBe(false);
    expect(s.status).toBe("clean");
    expect(s.lastKnownHash).toBe("sha256:new");
    expect(s.canAutosave).toBe(false);
  });

  it("auto-reloads a clean buffer on external change", () => {
    const s = new DocumentSession("a.fountain", "sha256:aa");
    expect(s.onExternalChange("sha256:bb")).toEqual({ kind: "reload" });
    s.confirmReloaded("sha256:bb");
    expect(s.lastKnownHash).toBe("sha256:bb");
    expect(s.status).toBe("clean");
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-104: an external change to a DIRTY buffer never discards edits", () => {
    const s = new DocumentSession("a.fountain", "sha256:aa");
    s.markDirty();
    const decision = s.onExternalChange("sha256:theirs");
    expect(decision).toEqual({ kind: "dirty-gate" });
    // The buffer is untouched: still dirty, edits intact.
    expect(s.dirty).toBe(true);
    expect(s.status).toBe("external-pending");
    // Autosave is paused so we don't clobber or spam siblings.
    expect(s.canAutosave).toBe(false);
    // We remember "theirs" for the user's choice.
    expect(s.pendingTheirsHash).toBe("sha256:theirs");
  });

  it("Load theirs resolves the gate by reloading", () => {
    const s = new DocumentSession("a.fountain", "sha256:aa");
    s.markDirty();
    s.onExternalChange("sha256:theirs");
    s.confirmReloaded("sha256:theirs");
    expect(s.status).toBe("clean");
    expect(s.dirty).toBe(false);
    expect(s.lastKnownHash).toBe("sha256:theirs");
    expect(s.pendingTheirsHash).toBeNull();
  });

  it("Keep mine resolves the gate by promoting our version", () => {
    const s = new DocumentSession("a.fountain", "sha256:aa");
    s.markDirty();
    s.onExternalChange("sha256:theirs");
    // orchestrator preserved theirs to a sibling, then promoted ours
    s.confirmPromoted("sha256:mine");
    expect(s.status).toBe("clean");
    expect(s.dirty).toBe(false);
    expect(s.lastKnownHash).toBe("sha256:mine");
  });

  it("Keep mine leaves words typed after ours was taken unsaved", () => {
    // "Keep this" pins theirs before writing ours, and a keystroke can land
    // while it does. What landed is ours as it was when it was serialized.
    const s = new DocumentSession("a.fountain", "sha256:aa");
    s.markDirty();
    s.onExternalChange("sha256:theirs");
    const taken = s.editCount;
    s.markDirty(); // typed while ours was being written
    s.confirmPromoted("sha256:mine", taken);
    expect(s.lastKnownHash).toBe("sha256:mine");
    expect(s.pendingTheirsHash).toBeNull();
    expect(s.dirty).toBe(true);
    expect(s.canAutosave).toBe(true);

    const quiet = new DocumentSession("b.fountain", "sha256:bb");
    quiet.markDirty();
    quiet.onExternalChange("sha256:theirs");
    quiet.confirmPromoted("sha256:mine", quiet.editCount);
    expect(quiet.dirty).toBe(false);
    expect(quiet.status).toBe("clean");
  });

  // The self-write race behind a false conflict banner, frontend half: while OUR write is in flight,
  // lastKnownHash still names the pre-write state, so an arriving event
  // cannot yet be told apart from a real external edit. Defer, then decide.
  describe("writes in flight defer external changes", () => {
    it("an echo of the write we just made never gates", () => {
      const s = new DocumentSession("a.fountain", "sha256:base");
      s.markDirty();
      s.beginWrite();
      // The watcher reports the file changing — it is our own write landing.
      expect(s.onExternalChange("sha256:mine")).toEqual({
        kind: "ignore",
        reason: "write-in-flight",
      });
      // Nothing was gated or discarded while deferred (docs/app/keeping-work/storage-and-file-format.md#STOR-104).
      expect(s.status).toBe("dirty");

      s.onSaved({ status: "ok", hash: "sha256:mine" });
      expect(s.drainDeferred()).toBeNull(); // it was our own bytes
      expect(s.status).toBe("clean");
      expect(s.canAutosave).toBe(false);
    });

    it("a GENUINE external edit landing mid-write still gates afterwards", () => {
      const s = new DocumentSession("a.fountain", "sha256:base");
      s.markDirty();
      s.beginWrite();
      s.onExternalChange("sha256:theirs");
      s.onSaved({ status: "ok", hash: "sha256:mine" });

      // Different from what we wrote → still a real change. We're dirty again
      // only if edits continued; here the save cleaned us, so it reloads.
      expect(s.drainDeferred()).toEqual({ kind: "reload" });
    });

    it("a mid-write external edit gates when edits continued during the save", () => {
      const s = new DocumentSession("a.fountain", "sha256:base");
      s.markDirty();
      s.beginWrite();
      s.onExternalChange("sha256:theirs");
      s.onSaved({ status: "ok", hash: "sha256:mine" });
      s.markDirty(); // the writer kept typing while the save was in flight

      expect(s.drainDeferred()).toEqual({ kind: "dirty-gate" });
      expect(s.pendingTheirsHash).toBe("sha256:theirs");
      expect(s.dirty).toBe(true); // docs/app/keeping-work/storage-and-file-format.md#STOR-104: edits intact
    });

    it("holds until the LAST of several overlapping writes completes", () => {
      const s = new DocumentSession("a.fountain", "sha256:base");
      s.beginWrite();
      s.beginWrite();
      s.onExternalChange("sha256:theirs");
      s.onSaved({ status: "ok", hash: "sha256:one" });
      expect(s.writeInFlight).toBe(true);
      expect(s.drainDeferred()).toBeNull(); // still one write outstanding

      s.onSaved({ status: "ok", hash: "sha256:two" });
      expect(s.writeInFlight).toBe(false);
      expect(s.drainDeferred()).toEqual({ kind: "reload" });
    });

    it("abortWrite balances a thrown write so events can never stick", () => {
      const s = new DocumentSession("a.fountain", "sha256:base");
      s.beginWrite();
      s.abortWrite(); // the IPC call threw
      expect(s.writeInFlight).toBe(false);
      // Back to deciding immediately — no permanent deferral.
      expect(s.onExternalChange("sha256:theirs")).toEqual({ kind: "reload" });
    });

    /*
     * docs/app/keeping-work/storage-and-file-format.md#STOR-104. The keystroke that lands between the flush taking its bytes and the
     * write coming back is not in those bytes. It used to be marked saved:
     * status Saved, autosave idle, the words only in memory until the writer
     * typed again — and gone if they quit instead.
     */
    it("docs/app/keeping-work/storage-and-file-format.md#STOR-104: an edit made while the write was in flight is still unsaved after it lands", () => {
      const s = new DocumentSession("a.fountain", "sha256:base");
      s.markDirty();
      const carried = s.beginWrite();
      s.markDirty(); // typed while the IPC write was out
      s.onSaved({ status: "ok", hash: "sha256:first" }, carried);
      expect(s.lastKnownHash).toBe("sha256:first"); // the landed bytes are ours
      expect(s.dirty).toBe(true);
      expect(s.status).toBe("dirty");
      expect(s.canAutosave).toBe(true); // …so the next flush carries the keystroke

      const next = s.beginWrite();
      s.onSaved({ status: "ok", hash: "sha256:second" }, next);
      expect(s.dirty).toBe(false);
      expect(s.status).toBe("clean");
    });

    it("a write that carried every edit leaves the buffer clean", () => {
      const s = new DocumentSession("a.fountain", "sha256:base");
      s.markDirty();
      s.markDirty();
      const carried = s.beginWrite();
      s.onSaved({ status: "ok", hash: "sha256:all" }, carried);
      expect(s.dirty).toBe(false);
    });

    it("resolving a gate clears anything still deferred", () => {
      const s = new DocumentSession("a.fountain", "sha256:base");
      s.markDirty();
      s.beginWrite();
      s.onExternalChange("sha256:theirs");
      s.onSaved({ status: "ok", hash: "sha256:mine" });
      s.confirmReloaded("sha256:theirs");
      expect(s.drainDeferred()).toBeNull();
    });
  });

  it("a collision-on-write surfaces a conflict and pauses autosave (docs/app/keeping-work/storage-and-file-format.md#STOR-105)", () => {
    // Nothing was written and no sibling was made (docs/app/keeping-work/storage-and-file-format.md#STOR-D9): `hash` is disk
    // truth, and the orchestrator pins a version holding our bytes. The session
    // must NOT adopt that hash — it is theirs, not what we saved.
    const s = new DocumentSession("a.fountain", "sha256:aa");
    s.markDirty();
    s.onSaved({ status: "collision", hash: "sha256:theirs" });
    expect(s.status).toBe("external-pending");
    expect(s.canAutosave).toBe(false);
    expect(s.lastKnownHash).toBe("sha256:aa");
    expect(s.dirty).toBe(true);
  });
});
