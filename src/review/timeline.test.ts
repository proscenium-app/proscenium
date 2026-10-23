// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import type { VersionEntry } from "../storage/ipc";
import type { LedgerEntry } from "./store";
import { buildTimeline, filterTimeline, joinKey, type HistoryDoc } from "./timeline";

const T0 = Date.parse("2026-09-30T09:00:00Z");
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const v = (name: string, min: number, reason = "save"): VersionEntry => ({
  name,
  ts: iso(min),
  reason,
  size: 1,
  pinned: false,
});
const outside = (id: string, min: number, path: string): LedgerEntry => ({
  id,
  ts: iso(min),
  kind: "external",
  path,
  afterHash: "h",
  revertable: true,
  stats: { added: 1, removed: 0 },
  note: null,
  status: "kept",
});

const script: HistoryDoc = {
  id: "s",
  title: "Play",
  path: "Play.fountain",
  kind: "script",
  versions: [v("s1", 0), v("s2", 5), v("s3", 12), v("s4", 90), v("s5", 95)],
};
const notes: HistoryDoc = {
  id: "n",
  title: "MARA",
  path: "Characters/MARA.md",
  kind: "sheet",
  versions: [v("n1", 20), v("n2", 200, "pre-reload")],
};

describe("buildTimeline", () => {
  const timeline = buildTimeline([script, notes], [outside("o1", 60, "Play.fountain")]);

  test("sittings split at a 30-minute gap, across documents, newest first", () => {
    expect(timeline.map((e) => e.key.split(":")[0])).toEqual([
      "sitting",
      "sitting",
      "outside",
      "sitting",
    ]);
    const first = timeline[3]!;
    if (first.kind !== "sitting") throw new Error("not a sitting");
    expect(first.start).toBe(iso(0));
    expect(first.end).toBe(iso(20));
    expect(first.docs.map((d) => d.docId)).toEqual(["s", "n"]);
  });

  test("each part starts from the newest earlier version, and knows when nothing came after", () => {
    const second = timeline[1]!;
    if (second.kind !== "sitting") throw new Error("not a sitting");
    // A change from outside came between (o1, at 60): the sitting starts from
    // its first save, not from the writer's text before that change.
    expect(second.docs).toEqual([
      {
        docId: "s",
        before: script.versions[3]!,
        versions: [script.versions[4]!],
        newest: true,
        mixed: false,
      },
    ]);
    // Nothing before the first sitting: its first version is where it started.
    const first = timeline[3]!;
    if (first.kind !== "sitting") throw new Error("not a sitting");
    expect(first.docs[0]!.before).toEqual(script.versions[0]!);
    expect(first.docs[0]!.versions).toEqual([script.versions[1]!, script.versions[2]!]);
    expect(first.docs[0]!.newest).toBe(false);
    // One version and nothing before it: nothing to start from.
    expect(first.docs[1]!.before).toBeNull();
  });

  test("a sitting of versions only kept before a replacement did not write", () => {
    const latest = timeline[0]!;
    if (latest.kind !== "sitting") throw new Error("not a sitting");
    expect(latest.wrote).toBe(false);
    expect(latest.docs[0]!.before).toEqual(notes.versions[0]!);
  });
});

describe("filterTimeline", () => {
  const docs = [script, notes];
  const timeline = buildTimeline(docs, [
    outside("o1", 60, "Play.fountain"),
    outside("o2", 61, "Characters/MARA.md"),
  ]);

  test("mine and from outside", () => {
    expect(filterTimeline(timeline, "mine", null, docs).every((e) => e.kind === "sitting")).toBe(
      true,
    );
    expect(filterTimeline(timeline, "outside", null, docs).map((e) => e.key)).toEqual([
      "outside:o2",
      "outside:o1",
    ]);
  });

  test("one document narrows a sitting to its part and outside changes to its path", () => {
    const only = filterTimeline(timeline, "all", "n", docs);
    expect(only.map((e) => (e.kind === "sitting" ? e.docs.map((d) => d.docId) : e.key))).toEqual([
      ["n"],
      "outside:o2",
      ["n"],
    ]);
  });
});

describe("a change from outside", () => {
  test("ends a sitting, and the next starts from the first save over it", () => {
    const doc: HistoryDoc = {
      id: "s",
      title: "Play",
      path: "Play.fountain",
      kind: "script",
      versions: [
        v("a", 0),
        v("b", 5),
        v("c", 9, "pre-reload"),
        // The save over the change keeps the text the change left, then its own.
        v("d", 11),
        v("e", 11.01),
        v("f", 15),
      ],
    };
    const timeline = buildTimeline([doc], [outside("o", 10, "Play.fountain")]);
    expect(timeline.map((e) => e.key.split(":")[0])).toEqual(["sitting", "outside", "sitting"]);
    const after = timeline[0]!;
    if (after.kind !== "sitting") throw new Error("not a sitting");
    expect(after.docs[0]!.before).toEqual(doc.versions[3]!);
    expect(after.docs[0]!.versions).toEqual([doc.versions[4]!, doc.versions[5]!]);
    const earlier = timeline[2]!;
    if (earlier.kind !== "sitting") throw new Error("not a sitting");
    expect(earlier.docs[0]!.versions.map((x) => x.name)).toEqual(["b", "c"]);
  });

  test("the copy kept because it arrived counts as before it, though stamped after", () => {
    const doc: HistoryDoc = {
      id: "s",
      title: "Play",
      path: "Play.fountain",
      kind: "script",
      // "c" is the writer's text from before the change heard at 10, stamped 3 s later.
      versions: [v("a", 0), v("b", 5), v("c", 10.05, "pre-reload"), v("d", 11), v("e", 11.01)],
    };
    const timeline = buildTimeline([doc], [outside("o", 10, "Play.fountain")]);
    expect(timeline.map((e) => e.key.split(":")[0])).toEqual(["sitting", "outside", "sitting"]);
    const before = timeline[2]!;
    const after = timeline[0]!;
    if (before.kind !== "sitting" || after.kind !== "sitting") throw new Error("not sittings");
    expect(before.docs[0]!.versions.map((x) => x.name)).toEqual(["b", "c"]);
    expect(before.docs[0]!.mixed).toBe(false);
    expect(before.endAt).toBe(Date.parse(iso(10)) - 1);
    expect(after.docs[0]!.before!.name).toBe("d");
  });

  test("a copy kept after it, with no save over it, says it may hold that change", () => {
    const doc: HistoryDoc = {
      id: "s",
      title: "Play",
      path: "Play.fountain",
      kind: "script",
      // "c" was kept for a second change, at 12: it holds what the first, at 10, brought.
      versions: [v("a", 0), v("b", 5), v("c", 12.05, "pre-reload")],
    };
    // Only the first change is listed (the second fell off the ledger), so
    // the copy kept for the second is the writer's only sight of it.
    const timeline = buildTimeline([doc], [outside("o", 10, "Play.fountain")], undefined, [
      outside("o", 10, "Play.fountain"),
      outside("o2", 12, "Play.fountain"),
    ]);
    const kept = timeline.find((e) => e.kind === "sitting" && !e.wrote);
    if (kept?.kind !== "sitting") throw new Error("not a sitting");
    expect(kept.wrote).toBe(false);
    expect(kept.docs[0]!.mixed).toBe(true);
    expect(kept.docs[0]!.before!.name).toBe("b");
  });
});

describe("docs/app/keeping-work/storage-and-file-format.md#STOR-184: changes from outside in a burst", () => {
  const doc: HistoryDoc = {
    id: "s",
    title: "Play",
    path: "Play.fountain",
    kind: "script",
    versions: [
      v("a", 0),
      v("b", 5),
      // Kept because each change arrived while the script was open.
      v("c1", 10.02, "pre-reload"),
      v("c2", 12.02, "pre-reload"),
      v("c3", 14.02, "pre-reload"),
      // The writer writes, then something changes it again.
      v("d", 40),
      v("e", 41),
      v("c4", 42.02, "pre-reload"),
    ],
  };
  const changes = [
    outside("o1", 10, "Play.fountain"),
    outside("o2", 12, "Play.fountain"),
    outside("o3", 14, "Play.fountain"),
    outside("n1", 13, "Characters/MARA.md"),
    outside("o4", 42, "Play.fountain"),
  ];
  const timeline = buildTimeline([doc], changes);

  test("are one entry per file, oldest first inside it, until the writer writes", () => {
    const bursts = timeline.filter((e) => e.kind === "outside");
    expect(bursts.map((e) => (e.kind === "outside" ? e.entries.map((x) => x.id) : []))).toEqual([
      ["o4"],
      ["o1", "o2", "o3"],
      ["n1"],
    ]);
    const three = bursts[1]!;
    if (three.kind !== "outside") throw new Error("not a burst");
    expect(three.start).toBe(iso(10));
    expect(three.ts).toBe(iso(14));
  });

  test("carry the copy kept as the first arrived, and list no sitting that only repeats them", () => {
    const three = timeline.find((e) => e.kind === "outside" && e.entries[0]!.id === "o1");
    if (three?.kind !== "outside") throw new Error("not a burst");
    expect(three.kept).toEqual({ docId: "s", version: doc.versions[2]! });
    // c1 and c4 hold the writer's own words as each change came, so they end
    // the writer's sittings; c2 and c3 were only ever the burst's copies, and
    // say nothing the burst does not.
    const sittings = timeline.filter((e) => e.kind === "sitting");
    expect(
      sittings.map((e) =>
        e.kind === "sitting" ? e.docs.flatMap((d) => d.versions.map((x) => x.name)) : [],
      ),
    ).toEqual([
      ["e", "c4"],
      ["b", "c1"],
    ]);
  });

  test("break where the texts say the writer's words came between, though no version kept them", () => {
    const quiet: HistoryDoc = { ...doc, versions: [v("a", 0)] };
    const pair = [outside("o1", 10, "Play.fountain"), outside("o2", 12, "Play.fountain")];
    const joined = (yes: boolean) =>
      buildTimeline([quiet], pair, undefined, pair, new Map([[joinKey("o1", "o2"), yes]])).filter(
        (e) => e.kind === "outside",
      ).length;
    expect(joined(false)).toBe(2);
    expect(joined(true)).toBe(1);
    // The texts are the better witness: they join what a version would part.
    const between: HistoryDoc = { ...doc, versions: [v("a", 0), v("w", 11)] };
    expect(
      buildTimeline(
        [between],
        pair,
        undefined,
        pair,
        new Map([[joinKey("o1", "o2"), true]]),
      ).filter((e) => e.kind === "outside"),
    ).toHaveLength(1);
  });

  test("break at a gap, and at a change put back", () => {
    const apart = buildTimeline(
      [doc],
      [outside("o1", 10, "Play.fountain"), outside("o9", 100, "Play.fountain")],
    );
    expect(apart.filter((e) => e.kind === "outside")).toHaveLength(2);
    const back = buildTimeline(
      [doc],
      [
        { ...outside("o1", 10, "Play.fountain"), status: "reverted" },
        outside("o2", 12, "Play.fountain"),
      ],
    );
    expect(back.filter((e) => e.kind === "outside")).toHaveLength(2);
  });
});
