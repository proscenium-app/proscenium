// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One timeline of the play: the writer's own sittings and what arrived from
 * outside, newest first (docs/app/keeping-work/storage-and-file-format.md#STOR-119).
 *
 * Both halves were already kept: Versions holds each document's earlier
 * states (docs/app/keeping-work/storage-and-file-format.md#STOR-115), the Changes ledger holds what changed outside the window.
 * Shown apart, a writer's own recent work was behind a menu while Changes
 * listed only what someone else did. This joins what they show and stores
 * nothing new: a sitting is a run of versions, of any document, with no gap
 * longer than `gapMs` (30 minutes) between them.
 */
import type { VersionEntry } from "../storage/ipc";
import type { LedgerEntry } from "./store";

/** A document whose versions the timeline reads. */
export interface HistoryDoc {
  /** The id its versions are kept under. */
  id: string;
  title: string;
  /** Play-relative path, which joins it to the ledger's entries; null while it has none. */
  path: string | null;
  kind: "script" | "sheet" | "outline";
  versions: VersionEntry[];
}

/** One document's part of a sitting. */
export interface SittingDoc {
  docId: string;
  /** The newest version of it from before the sitting: what the sitting started from. Null when none was kept. */
  before: VersionEntry | null;
  /** Its versions kept during the sitting, oldest first. */
  versions: VersionEntry[];
  /** No later version of it exists, so the words as they stand now follow this sitting. */
  newest: boolean;
  /**
   * A change from outside came since `before`, and nothing here was kept by a
   * save over it: what these versions add may be that change, not the writer's.
   */
  mixed: boolean;
}

export type TimelineEntry =
  | {
      kind: "sitting";
      key: string;
      /** ISO time of its first and last version. */
      start: string;
      end: string;
      /** When its last version counts as kept, in ms: what "since this sitting" is measured from. */
      endAt: number;
      /** True when a version in it was kept by saving, not only before something replaced the words. */
      wrote: boolean;
      docs: SittingDoc[];
    }
  | {
      kind: "outside";
      key: string;
      /** ISO time of its newest change, and of its first. */
      ts: string;
      start: string;
      path: string;
      /**
       * The changes from outside it holds, oldest first: one file changed again
       * and again with nothing of the writer's between, and no gap over 30
       * minutes, is one burst of work done somewhere else, read as one.
       */
      entries: LedgerEntry[];
      /**
       * The copy of the writer's text kept because its first change arrived
       * (a version of `docId`): the way back once the file has moved on.
       */
      kept: { docId: string; version: VersionEntry } | null;
    };

export const SITTING_GAP_MS = 30 * 60_000;

const at = (iso: string) => Date.parse(iso);

/** Versions kept because a change arrived from outside: the writer's text from before it. */
const KEPT_FOR_ARRIVAL = new Set(["pre-reload", "pre-reload-at-banner"]);
/** How long after a change is heard its kept copy may be stamped and still be that change's. */
const ARRIVAL_WINDOW_MS = 60_000;

/** The key `joins` answers for two changes to one file, one after the other. */
export const joinKey = (prev: string, next: string) => `${prev}>${next}`;

/**
 * Every sitting and every outside change in `outside`, newest first.
 * `boundaries` are all the changes from outside, shown or not: each ends a
 * sitting, so no sitting's changes span one. `joins` says, where the texts
 * were read, whether a change began from exactly what the one before it left
 * (`joinKey`): words of the writer's between them that no version kept still
 * part them. Where it says nothing, a version of the writer's between them
 * does.
 */
export function buildTimeline(
  docs: readonly HistoryDoc[],
  outside: readonly LedgerEntry[],
  gapMs = SITTING_GAP_MS,
  boundaries: readonly LedgerEntry[] = outside,
  joins?: ReadonlyMap<string, boolean>,
): TimelineEntry[] {
  const arrivals = boundaries.map((e) => ({ t: at(e.ts), path: e.path, entry: e }));
  // When a version counts as kept. A copy kept because a change arrived holds
  // the writer's text from before that change, but is stamped a moment after
  // the change was heard: it counts as just before it, whatever the clock
  // says, so the order of the two never depends on which was written first.
  const keptAt = new Map<VersionEntry, number>();
  /** A copy kept because a change arrived, and the change it was kept for. */
  const keptFor = new Map<VersionEntry, LedgerEntry>();
  for (const doc of docs)
    for (const v of doc.versions) {
      const t = at(v.ts);
      let cause: (typeof arrivals)[number] | null = null;
      if (KEPT_FOR_ARRIVAL.has(v.reason))
        for (const a of arrivals)
          if (
            a.path === doc.path &&
            a.t <= t &&
            t - a.t <= ARRIVAL_WINDOW_MS &&
            (!cause || a.t > cause.t)
          )
            cause = a;
      keptAt.set(v, cause ? cause.t - 1 : t);
      if (cause) keptFor.set(v, cause.entry);
    }
  const t = (v: VersionEntry) => keptAt.get(v) ?? at(v.ts);
  const points = docs
    .flatMap((doc) => doc.versions.map((v) => ({ doc, v })))
    .sort((a, b) => t(a.v) - t(b.v) || a.v.name.localeCompare(b.v.name));
  const runs: (typeof points)[] = [];
  for (const point of points) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    const between = last && arrivals.some((a) => a.t > t(last.v) && a.t <= t(point.v));
    if (run && last && !between && t(point.v) - t(last.v) <= gapMs) run.push(point);
    else runs.push([point]);
  }
  const sittings: TimelineEntry[] = runs.map((run) => {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const inRun = new Set(run.map((p) => p.v));
    const byDoc = new Map<string, SittingDoc>();
    for (const { doc, v } of run) {
      let part = byDoc.get(doc.id);
      if (!part) {
        // Runs do not overlap in time, so what is not in this one and not
        // after its start is before it.
        const earlier = doc.versions
          .filter((x) => !inRun.has(x) && t(x) <= t(first.v))
          .sort((a, b) => t(b) - t(a));
        part = {
          docId: doc.id,
          before: earlier[0] ?? null,
          versions: [],
          newest: false,
          mixed: false,
        };
        byDoc.set(doc.id, part);
      }
      part.versions.push(v);
    }
    for (const part of byDoc.values()) {
      const doc = docs.find((d) => d.id === part.docId)!;
      // A change from outside to this document since its version before:
      // that version is the writer's text without it, so the sitting starts
      // from the first save after it instead — the text that change left,
      // which the save over it kept (version-policy.ts, WritingVersions).
      const since = part.before ? t(part.before) : -Infinity;
      const arrived = arrivals.some(
        (a) => a.path === doc.path && a.t > since && a.t <= t(part.versions[0]!),
      );
      const firstSave = part.versions.findIndex((x) => x.reason === "save");
      if (arrived && firstSave >= 0 && part.versions.length > firstSave + 1)
        part.before = part.versions.splice(firstSave, 1)[0]!;
      else if (arrived && part.before) part.mixed = true;
      // Nothing kept from before: the sitting's first version is where it
      // started (a session's first save keeps the text it was made over).
      else if (!part.before && part.versions.length > 1) part.before = part.versions.shift()!;
      const lastOfSitting = part.versions[part.versions.length - 1]!;
      part.newest = !doc.versions.some((x) => t(x) > t(lastOfSitting));
    }
    return {
      kind: "sitting",
      key: `sitting:${first.v.ts}:${first.doc.id}:${first.v.name}`,
      start: first.v.ts,
      end: last.v.ts,
      endAt: t(last.v),
      wrote: run.some((p) => p.v.reason === "save"),
      docs: [...byDoc.values()],
    };
  });
  // A burst of changes from outside to one file, with nothing of the writer's
  // between them, is one entry: the writer reads what that burst did, once.
  const shown = new Set(outside.map((e) => e.id));
  const docOf = (path: string) => docs.find((d) => d.path === path) ?? null;
  /** The writer did something to this file between these two times. */
  const wroteBetween = (path: string, from: number, to: number) =>
    docOf(path)?.versions.some((v) => !keptFor.has(v) && t(v) > from && t(v) < to) ?? false;
  const bursts: LedgerEntry[][] = [];
  for (const entry of [...outside].sort(
    (a, b) => at(a.ts) - at(b.ts) || a.id.localeCompare(b.id),
  )) {
    const open = [...bursts].reverse().find((b) => b[0]!.path === entry.path);
    const last = open?.[open.length - 1];
    if (
      open &&
      last &&
      at(entry.ts) - at(last.ts) <= gapMs &&
      last.status !== "reverted" &&
      entry.status !== "reverted" &&
      (joins?.get(joinKey(last.id, entry.id)) ??
        !wroteBetween(entry.path, at(last.ts), at(entry.ts)))
    )
      open.push(entry);
    else bursts.push([entry]);
  }
  const changes: TimelineEntry[] = bursts.map((entries) => {
    const first = entries[0]!;
    const newest = entries[entries.length - 1]!;
    const doc = docOf(first.path);
    const kept = doc?.versions.find((v) => keptFor.get(v)?.id === first.id) ?? null;
    return {
      kind: "outside",
      key: `outside:${first.id}`,
      ts: newest.ts,
      start: first.ts,
      path: first.path,
      entries,
      kept: doc && kept ? { docId: doc.id, version: kept } : null,
    };
  });
  // A sitting of nothing but copies kept because changes arrived, each of a
  // change listed here, says again what that change says: it is the change's
  // way back (`kept`), not a sitting of the writer's.
  const echoes = (e: TimelineEntry) =>
    e.kind === "sitting" &&
    !e.wrote &&
    e.docs.every((part) =>
      part.versions.every((v) => {
        const cause = keptFor.get(v);
        return !!cause && shown.has(cause.id);
      }),
    );
  const when = (e: TimelineEntry) => (e.kind === "sitting" ? e.endAt : at(e.ts));
  return [...sittings.filter((e) => !echoes(e)), ...changes].sort((a, b) => when(b) - when(a));
}

export type Who = "all" | "mine" | "outside";

/**
 * The entries a filter keeps. `docId` narrows to one document: a sitting
 * keeps only that document's part, and an outside change is kept when its
 * path is that document's.
 */
export function filterTimeline(
  entries: readonly TimelineEntry[],
  who: Who,
  docId: string | null,
  docs: readonly HistoryDoc[],
): TimelineEntry[] {
  const path = docId ? (docs.find((d) => d.id === docId)?.path ?? null) : null;
  const out: TimelineEntry[] = [];
  for (const e of entries) {
    if (e.kind === "sitting") {
      if (who === "outside") continue;
      if (!docId) {
        out.push(e);
        continue;
      }
      const part = e.docs.filter((d) => d.docId === docId);
      if (part.length) out.push({ ...e, docs: part, key: `${e.key}:${docId}` });
    } else {
      if (who === "mine") continue;
      if (docId && e.path !== path) continue;
      out.push(e);
    }
  }
  return out;
}
