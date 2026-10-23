// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One sitting of the writer's own work in Changes
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-119): when it was,
 * which documents it touched, and — chosen — what changed in each, as a whole
 * or one kept version at a time, on the page, with the way back
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-186).
 *
 * Reading never writes. A restore goes through the document's own guarded
 * write after keeping what it says now as a version (docs/app/keeping-work/storage-and-file-format.md#STOR-115), so it can be
 * undone from this same list.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { VersionEntry } from "../storage/ipc";
import { Alert, Button } from "../ui";
import { Comparison, type ChangesLook, type DocumentPage, type ScriptPage } from "./Comparison";
import { ChangeSteps } from "./ChangeSteps";
import { useChangeStatus } from "./status";
import { touchedSceneNames } from "./locate";
import { wordStats } from "./redline";
import { SITTING_GAP_MS, type HistoryDoc, type SittingDoc, type TimelineEntry } from "./timeline";

export type Sitting = Extract<TimelineEntry, { kind: "sitting" }>;

/** What Changes can do with one document's versions (null: it is not open). */
export interface HistoryActions {
  current: () => string;
  restore: (name: string) => Promise<boolean>;
}

export interface HistorySource {
  load: () => Promise<HistoryDoc[]>;
  read: (docId: string, name: string) => Promise<string>;
  target: (docId: string) => HistoryActions | null;
  /** Open a document beside Changes, so its versions can be restored. */
  open: (docId: string) => void;
}

export const REASON_LABEL: Record<string, string> = {
  save: "while writing",
  "pre-reload": "before a change arrived",
  "pre-reload-at-banner": "before using the other version",
  "pre-keep": "before keeping this one",
  "pre-restore": "before a restore",
  // The only surviving copy of what the buffer held; the ring never prunes it.
  collision: "couldn't be saved — kept here",
  "pre-apply": "before words were put back",
  recovery: "from before Proscenium closed",
};

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function dayLabel(iso: string, nowMs = Date.now()): string {
  const d = new Date(iso);
  const today = new Date(nowMs);
  const yesterday = new Date(nowMs);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/**
 * The scenes a change touched, each act named once: "ACT ONE: SCENE 1,
 * SCENE 2 · ACT TWO: SCENE 1".
 */
export function scenesSaid(names: readonly string[]): string {
  const out: { act: string | null; scenes: string[] }[] = [];
  for (const name of names) {
    const at = name.indexOf(" · ");
    const act = at < 0 ? null : name.slice(0, at);
    const scene = at < 0 ? name : name.slice(at + 3);
    const last = out[out.length - 1];
    if (last && last.act === act && act !== null) last.scenes.push(scene);
    else out.push({ act, scenes: [scene] });
  }
  return out
    .map((g) => (g.act ? `${g.act}: ${g.scenes.join(", ")}` : g.scenes.join(", ")))
    .join(" · ");
}

/** "12 words added and 3 cut": what a change is counted in, said in full. */
export function wordsSaid(added: number, removed: number): string {
  const words = (n: number) => `${n} ${n === 1 ? "word" : "words"}`;
  if (!added && !removed) return "no words changed";
  if (!removed) return `${words(added)} added`;
  if (!added) return `${words(removed)} cut`;
  return `${words(added)} added and ${removed} cut`;
}

/** The +/− of a change, in words, with the same said in full to whoever hears it. */
export function WordStats({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="change__stats">
      <span aria-hidden="true">
        <span className="change__add">+{added}</span>{" "}
        <span className="change__del">−{removed}</span>
        <span className="change__unit"> words</span>
      </span>
      <span className="sr-only">{wordsSaid(added, removed)}</span>
    </span>
  );
}

export function span(sitting: Sitting): string {
  const from = timeLabel(sitting.start);
  const to = timeLabel(sitting.end);
  return from === to ? from : `${from}–${to}`;
}

/** Reads a version once for everyone who asks. */
export function versionReader(read: HistorySource["read"]) {
  const cache = new Map<string, Promise<string>>();
  return (docId: string, name: string): Promise<string> => {
    const key = `${docId}\n${name}`;
    let text = cache.get(key);
    if (!text) {
      text = read(docId, name);
      cache.set(key, text);
      text.catch(() => cache.delete(key));
    }
    return text;
  };
}

/** Which part of a document's sitting is shown: all of it, or one version against the one before. */
type Pick_ = { kind: "all" } | { kind: "version"; index: number };

/** The two texts a pick compares, or null when there is nothing before to compare with. */
function sides(
  part: SittingDoc,
  pick: Pick_,
): { from: VersionEntry | null; to: VersionEntry | "now" } {
  if (pick.kind === "all")
    return { from: part.before ?? null, to: part.versions[part.versions.length - 1]! };
  const i = pick.index;
  return { from: i === 0 ? part.before : part.versions[i - 1]!, to: part.versions[i]! };
}

interface Compared {
  before: string;
  after: string;
  added: number;
  removed: number;
  scenes: string[];
}

async function compare(
  read: (docId: string, name: string) => Promise<string>,
  doc: HistoryDoc,
  from: VersionEntry | null,
  to: VersionEntry | "now",
  live: HistoryActions | null,
): Promise<Compared> {
  const before = from ? await read(doc.id, from.name) : "";
  const after = to === "now" ? (live?.current() ?? "") : await read(doc.id, to.name);
  const { added, removed } = wordStats(before, after);
  return {
    before,
    after,
    added,
    removed,
    scenes: doc.kind === "script" ? touchedSceneNames(before, after) : [],
  };
}

/** Did anything arrive from outside in this file after this time? */
export type OutsideSince = (path: string | null, ms: number) => boolean;

/**
 * A sitting that may still be going on: its document has no later version, it
 * ended inside the gap, and nothing arrived from outside since — so the words
 * as they stand are its end, and the last minutes of typing, which have not
 * reached a version yet, are in it. A change from outside would be too.
 */
function endsNow(
  sitting: Sitting,
  part: SittingDoc,
  doc: HistoryDoc,
  nowMs: number,
  outsideSince: OutsideSince,
): boolean {
  return (
    part.newest &&
    nowMs - Date.parse(sitting.end) < SITTING_GAP_MS &&
    !outsideSince(doc.path, sitting.endAt)
  );
}

/** What a sitting did, in words and scenes, for its line in the list. Null until read. */
export function useSittingSummary(
  sitting: Sitting,
  docs: ReadonlyMap<string, HistoryDoc>,
  history: HistorySource,
  read: (docId: string, name: string) => Promise<string>,
  now: number,
  outsideSince: OutsideSince,
): { added: number; removed: number; scenes: string[] } | null {
  const [summary, setSummary] = useState<{
    added: number;
    removed: number;
    scenes: string[];
  } | null>(null);
  useEffect(() => {
    let live = true;
    // A part with nothing kept before it has no change to count, only a first version.
    const counted = sitting.docs.filter((part) => part.before && docs.has(part.docId));
    void Promise.all(
      counted.map((part) => {
        const doc = docs.get(part.docId)!;
        const { from, to } = sides(part, { kind: "all" });
        const actions = history.target(doc.id);
        return compare(
          read,
          doc,
          from,
          endsNow(sitting, part, doc, now, outsideSince) && actions ? "now" : to,
          actions,
        );
      }),
    )
      .then((all) => {
        if (live && all.length)
          setSummary({
            added: all.reduce((n, c) => n + c.added, 0),
            removed: all.reduce((n, c) => n + c.removed, 0),
            scenes: all.flatMap((c) => c.scenes),
          });
      })
      .catch(() => live && setSummary(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitting.key, read]);
  return summary;
}

/** Who a sitting was: the writer writing, or the app keeping a copy. */
export function sittingWho(sitting: Sitting): string {
  return sitting.wrote ? "You wrote" : "Kept by Proscenium";
}

/** A sitting, chosen: what changed in each of its documents, on the page. */
export function SittingDetail({
  sitting,
  docs,
  history,
  read,
  now,
  onRestored,
  outsideSince,
  look,
  scriptPage,
  documentPage,
  head,
}: {
  sitting: Sitting;
  docs: ReadonlyMap<string, HistoryDoc>;
  history: HistorySource;
  read: (docId: string, name: string) => Promise<string>;
  now: number;
  onRestored: () => void;
  outsideSince: OutsideSince;
  look: ChangesLook;
  scriptPage?: ScriptPage;
  documentPage?: DocumentPage;
  /** What stands above it: who, when, and the ways to step. */
  head: ReactNode;
}) {
  const parts = sitting.docs.filter((p) => docs.has(p.docId));
  return (
    <div className="changedetail sitting">
      {head}
      {parts.map((part) => (
        <SittingPart
          key={part.docId}
          sitting={sitting}
          part={part}
          doc={docs.get(part.docId)!}
          history={history}
          read={read}
          now={now}
          onRestored={onRestored}
          outsideSince={outsideSince}
          look={look}
          scriptPage={scriptPage}
          documentPage={documentPage}
        />
      ))}
    </div>
  );
}

function SittingPart({
  sitting,
  part,
  doc,
  history,
  read,
  now,
  onRestored,
  outsideSince,
  look,
  scriptPage,
  documentPage,
}: {
  sitting: Sitting;
  part: SittingDoc;
  doc: HistoryDoc;
  history: HistorySource;
  read: (docId: string, name: string) => Promise<string>;
  now: number;
  onRestored: () => void;
  outsideSince: OutsideSince;
  look: ChangesLook;
  scriptPage?: ScriptPage;
  documentPage?: DocumentPage;
}) {
  const [pick, setPick] = useState<Pick_>({ kind: "all" });
  const [shown, setShown] = useState<Compared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const actions = history.target(doc.id);
  const { from, to } = sides(part, pick);
  const liveEnd =
    pick.kind === "all" && endsNow(sitting, part, doc, now, outsideSince) && !!actions;
  const pickKey = pick.kind === "all" ? "all" : String(pick.index);

  useEffect(() => {
    let live = true;
    setShown(null);
    setError(null);
    compare(read, doc, from, liveEnd ? "now" : to, actions)
      .then((c) => live && setShown(c))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey, doc.id, read, liveEnd]);

  useChangeStatus(
    doc.id,
    error
      ? `Could not read the changes to ${doc.title}. ${error}`
      : shown === null
        ? `Reading the changes to ${doc.title}…`
        : `${doc.title}: ${wordsSaid(shown.added, shown.removed)}.`,
    !!error || shown !== null,
  );

  // What a restore puts back: the version this pick starts from when the
  // whole sitting is shown (undoing it), or the version picked.
  const target: VersionEntry | null = pick.kind === "all" ? part.before : (to as VersionEntry);
  const restoreLabel = pick.kind === "all" ? "Restore as It Was Before" : "Restore This Version";

  const restore = async () => {
    if (!actions || !target) return;
    setBusy(true);
    const ok = await actions.restore(target.name);
    setBusy(false);
    setConfirming(false);
    if (ok) onRestored();
  };

  const regionLabel =
    pick.kind === "all"
      ? `What changed in ${doc.title} in this sitting`
      : `What changed in ${doc.title} at ${timeLabel(part.versions[pick.index]!.ts)}`;

  return (
    <div className="sitting__doc">
      <div className="sitting__dochead">
        <span className="sitting__doctitle">{doc.title}</span>
        {shown && shown.scenes.length > 0 && (
          <span className="sitting__scenes">{scenesSaid(shown.scenes)}</span>
        )}
        {shown && <WordStats added={shown.added} removed={shown.removed} />}
        <ChangeSteps />
      </div>
      {/* The versions inside the sitting, oldest first: one press shows what
          that one changed from the one before. */}
      <div className="sitting__versions" role="group" aria-label={`Versions of ${doc.title}`}>
        <button
          type="button"
          className="sitting__version"
          aria-pressed={pick.kind === "all"}
          onClick={() => setPick({ kind: "all" })}
        >
          Whole sitting
        </button>
        {part.versions.map((v, i) => (
          <button
            key={v.name}
            type="button"
            className="sitting__version"
            aria-pressed={pick.kind === "version" && pick.index === i}
            aria-label={`${timeLabel(v.ts)}, ${REASON_LABEL[v.reason] ?? v.reason}`}
            title={REASON_LABEL[v.reason] ?? v.reason}
            onClick={() => setPick({ kind: "version", index: i })}
          >
            {timeLabel(v.ts)}
            {v.reason !== "save" && <span aria-hidden="true"> ·&nbsp;kept</span>}
          </button>
        ))}
      </div>
      <div
        className={`change__diff change__diff--${look}`}
        tabIndex={0}
        role="region"
        aria-label={regionLabel}
        aria-busy={shown === null && !error}
      >
        {error && <p className="changes__hint">Could not read this comparison. {error}</p>}
        {shown === null && !error && <p className="changes__hint">Reading…</p>}
        {shown && part.mixed && (
          <p className="changes__hint">
            A copy kept after a change arrived from outside. It is compared with your version before
            that change, so what it adds can be that change.
          </p>
        )}
        {shown && from === null && (
          <p className="changes__hint">
            {pick.kind === "all"
              ? "Nothing was kept from before this sitting, so there is nothing to compare it with."
              : "The first version kept of it, so there is nothing to compare it with."}
            {doc.kind !== "script" && " What it holds is shown as added."}
          </p>
        )}
        {shown && from !== null && shown.before === shown.after && (
          <p className="changes__hint">Nothing changed — the text is the same.</p>
        )}
        {/* A whole script underlined as added says nothing a writer can use. */}
        {shown && shown.before !== shown.after && (from !== null || doc.kind !== "script") && (
          <Comparison
            before={shown.before}
            after={shown.after}
            look={look}
            script={doc.kind === "script"}
            document={doc.kind !== "script"}
            scriptPage={scriptPage}
            documentPage={documentPage}
            label={`${doc.title}, with its changes marked`}
          />
        )}
      </div>
      <div className="sitting__actions">
        {actions ? (
          <Button size="small" disabled={!target || busy} onClick={() => setConfirming(true)}>
            {restoreLabel}…
          </Button>
        ) : (
          <Button size="small" onClick={() => history.open(doc.id)}>
            Open {doc.title} to Restore
          </Button>
        )}
      </div>
      {confirming && target && (
        <Alert
          title={`Put ${doc.title} back to ${dayLabel(target.ts, now).toLowerCase()} at ${timeLabel(target.ts)}?`}
          body="What it says now is kept as a version first, so this can be undone here."
          confirmLabel={busy ? "Restoring…" : "Restore"}
          onConfirm={() => void restore()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

/** Sittings and outside changes grouped under their day, in order. */
export function useDayGroups<T>(items: readonly T[], when: (item: T) => string, now: number) {
  return useMemo(() => {
    const out: { day: string; items: T[] }[] = [];
    for (const item of items) {
      const day = dayLabel(when(item), now);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(item);
      else out.push({ day, items: [item] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, now]);
}
