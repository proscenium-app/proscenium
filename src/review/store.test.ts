// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, mock } from "bun:test";

// An in-memory app-data store: the ledger is read and rewritten whole through it.
const files = new Map<string, string>();
const written: string[] = [];
let delayRead: (() => Promise<void>) | null = null;
let failRead: ((rel: string) => boolean) | null = null;
const playStoreMock = {
  async read(playId: string, rel: string) {
    if (delayRead) await delayRead();
    if (failRead?.(rel)) throw new Error("EIO");
    return files.get(`${playId}/${rel}`) ?? null;
  },
  async write(playId: string, rel: string, content: string) {
    await new Promise((r) => setTimeout(r, 1)); // long enough for two writers to overlap
    files.set(`${playId}/${rel}`, content);
    written.push(`${playId}/${rel}`);
  },
  async remove() {},
};
mock.module("../storage", () => ({ playStore: playStoreMock }));

const { openChanges } = await import("./store");
const { recordExternalChange } = await import("./record");
type LedgerEntry = import("./store").LedgerEntry;

const entry = (id: string): LedgerEntry => ({
  id,
  ts: "2026-09-15T10:00:00Z",
  kind: "external",
  path: `${id}.md`,
  afterHash: "h",
  revertable: false,
  stats: { added: 1, removed: 0 },
  note: null,
  status: "pending",
});

describe("the Changes ledger", () => {
  it("docs/app/keeping-work/storage-and-file-format.md#STOR-36: alternate event spellings find the same before image and old baselines remain readable", async () => {
    const store = openChanges("UNICODE");
    await store.writeBaseline("Notes/Café.md", "before");
    expect(await store.readBaseline("NOTES/Cafe\u0301.MD")).toBe("before");
    files.set("UNICODE/changes/baseline/" + encodeURIComponent("Old.md"), "legacy");
    expect(await store.readBaseline("Old.md")).toBe("legacy");
  });
  it("docs/app/keeping-work/storage-and-file-format.md#STOR-119: a delayed recording belongs to its original play after another opens", async () => {
    const a = openChanges("PLAY-A");
    await a.writeBaseline("shared.md", "Play A before");
    let release!: () => void;
    const blocked = new Promise<void>((done) => {
      release = done;
    });
    delayRead = () => blocked;
    const recording = recordExternalChange(a, {
      path: "shared.md",
      after: "Play A after",
      afterHash: "a",
      nowIso: "t",
    });
    const b = openChanges("PLAY-B");
    await b.writeBaseline("shared.md", "Play B before");
    delayRead = null;
    release();
    const recorded = await recording;
    if (!recorded) throw new Error("a real change went unrecorded");
    expect((await a.readLedger()).map((e) => e.id)).toEqual([recorded.id]);
    expect(await a.readBefore(recorded.id)).toBe("Play A before");
    expect(await a.readBaseline("shared.md")).toBe("Play A after");
    expect(await b.readLedger()).toEqual([]);
    expect(await b.readBefore(recorded.id)).toBeNull();
    expect(await b.readBaseline("shared.md")).toBe("Play B before");
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-119: reopening the same play retains the queue of its previous store", async () => {
    const a = openChanges("REOPEN");
    const b = openChanges("REOPEN");
    await Promise.all([a.appendEntry(entry("A")), b.appendEntry(entry("B"))]);
    expect((await b.readLedger()).map((e) => e.id)).toEqual(["A", "B"]);
  });
  // Two files changed outside in the same moment used to leave
  // one entry — each recorder read the same ledger and wrote its own back.
  it("keeps both of two entries appended at once", async () => {
    const { appendEntry, readLedger } = openChanges("01J9REVIEW-LEDGER");
    await Promise.all([appendEntry(entry("A")), appendEntry(entry("B"))]);
    const ids = (await readLedger()).map((e) => e.id);
    expect(ids).toEqual(["A", "B"]);
  });

  it("a status change racing an append loses neither", async () => {
    const { appendEntry, readLedger, setStatus } = openChanges("01J9REVIEW-LEDGER-2");
    await appendEntry(entry("A"));
    await Promise.all([setStatus("A", "kept"), appendEntry(entry("B"))]);
    const after = await readLedger();
    expect(after.map((e) => [e.id, e.status])).toEqual([
      ["A", "kept"],
      ["B", "pending"],
    ]);
  });
});

describe("recording a change", () => {
  const look = (path: string, after: string, nowIso = "2026-09-16T12:55:37Z") => ({
    path,
    after,
    afterHash: `sha256:${after.length}`,
    nowIso,
  });

  // The +0 −0 rows: the watcher's start-up scan reports every file, and coming
  // back to the app re-reads every open one. Neither is a change.
  it("a file that was looked at, not changed, records nothing and writes nothing", async () => {
    const store = openChanges("LOOKED-AT");
    await store.writeBaseline("v2.fountain", "INT. KITCHEN - NIGHT\n\nCLAY\nStay.\n");
    written.length = 0;
    expect(
      await recordExternalChange(
        store,
        look("v2.fountain", "INT. KITCHEN - NIGHT\n\nCLAY\nStay.\n"),
      ),
    ).toBeNull();
    expect(await store.readLedger()).toEqual([]);
    expect(written).toEqual([]);
  });

  it("a file this device has not seen becomes the baseline, and its next change has a diff", async () => {
    const store = openChanges("FIRST-LOOK");
    expect(await recordExternalChange(store, look("Characters/clay.md", "# Clay\n"))).toBeNull();
    expect(await store.readLedger()).toEqual([]);
    expect(await store.readBaseline("Characters/clay.md")).toBe("# Clay\n");

    const changed = await recordExternalChange(
      store,
      look("Characters/clay.md", "# Clay\n\nThe older brother.\n"),
    );
    if (!changed) throw new Error("a real change went unrecorded");
    expect(changed.revertable).toBe(true);
    expect(changed.stats).toEqual({ added: 2, removed: 0 });
    expect((await store.readLedger()).map((e) => e.id)).toEqual([changed.id]);
    expect(await store.readBefore(changed.id)).toBe("# Clay\n");
    expect(await store.readBaseline("Characters/clay.md")).toBe("# Clay\n\nThe older brother.\n");
  });

  it("a baseline that cannot be read is not mistaken for one never taken", async () => {
    const store = openChanges("UNREADABLE-BASELINE");
    await store.writeBaseline("v2.fountain", "what the writer saw\n");
    failRead = (rel) => rel.startsWith("changes/baseline/");
    try {
      await expect(
        recordExternalChange(store, look("v2.fountain", "what arrived\n")),
      ).rejects.toThrow();
    } finally {
      failRead = null;
    }
    expect(await store.readBaseline("v2.fountain")).toBe("what the writer saw\n");
    expect(await store.readLedger()).toEqual([]);
  });

  it("rows recorded before the bytes were compared, with nothing added or removed, are dropped", async () => {
    const store = openChanges("OLD-ROWS");
    const row = (id: string, revertable: boolean, added: number, removed: number): LedgerEntry => ({
      ...entry(id),
      revertable,
      stats: { added, removed },
    });
    files.set(
      "OLD-ROWS/changes/ledger.jsonl",
      [
        row("LOOKED-AT", true, 0, 0),
        row("REAL", true, 0, 3),
        // No before to compare with: it cannot be told apart from a real change, so it stays.
        row("NO-BASELINE", false, 0, 0),
      ]
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );

    expect((await store.readLedger()).map((e) => e.id)).toEqual(["REAL", "NO-BASELINE"]);
    await store.setStatus("REAL", "kept");
    expect(files.get("OLD-ROWS/changes/ledger.jsonl")).not.toContain("LOOKED-AT");
  });
});
