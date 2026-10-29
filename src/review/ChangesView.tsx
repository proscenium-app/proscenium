// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Changes surface — one timeline of the play: the writer's own sittings,
 * from Versions, and what arrived in this folder from somewhere else, each as
 * something you can read, step through, keep, or undo
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-119).
 *
 * The timeline is a list beside a page
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-186). The list says
 * what happened, when, where in the play and how much, in words; the change
 * chosen in it is drawn on the page beside it as a redline. It opens on the
 * newest change the writer has not seen, and looking is seeing
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-183): every change on
 * the list is seen once the surface is in front, and the ones that were new
 * stay marked New for as long as it is.
 *
 * Changes from outside are read in bursts
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-184): one file
 * changed again and again with nothing of the writer's between is one entry.
 *
 * An entry's `note` is always absent now (the inbound note channel went with
 * the chat panel). Where an older entry still carries one it is rendered as PLAIN
 * TEXT — a text node, never markup, never a link — because it was written by
 * something other than the app.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Comparison,
  isDocumentPath,
  isScriptPath,
  readLook,
  writeLook,
  type ChangesLook,
  type DocumentPage,
  type ScriptPage,
} from "./Comparison";
import { Alert, Button, PopupButton, RevertIcon, Segmented } from "../ui";
import { ChangeSteps } from "./ChangeSteps";
import { VERSION_KEPT_EVENT } from "../storage/ipc";
import {
  SittingDetail,
  WordStats,
  dayLabel,
  scenesSaid,
  sittingWho,
  span,
  timeLabel,
  useDayGroups,
  useSittingSummary,
  versionReader,
  wordsSaid,
  type HistorySource,
  type OutsideSince,
  type Sitting,
} from "./SittingRow";
import {
  buildTimeline,
  filterTimeline,
  type HistoryDoc,
  type TimelineEntry,
  type Who,
} from "./timeline";
import { conflictOriginal } from "../workspace/sync-names";
import type { LedgerEntry } from "./store";
import { SavedCopies } from "./SavedCopies";
import type { SavedCopy } from "../storage/ipc";
import type { RecoveryCopiesState } from "./RecoveryCopies";
import { useAnnouncedStatus } from "../ui/use-announced-status";
import { announce, ensureAnnouncer } from "../ui/announce";
import { ChangeStatus, useChangeStatus, type StatusSink } from "./status";
import { touchedSceneNames } from "./locate";
import { wordStats } from "./redline";

type Burst = Extract<TimelineEntry, { kind: "outside" }>;

export interface ChangesViewProps {
  entries: LedgerEntry[];
  /** Which changes to a file began from what the one before left: what makes a burst. */
  joins?: ReadonlyMap<string, boolean>;
  /**
   * Files a sync provider left behind — another version of something in the
   * play (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). Never listed as scripts; they surface here, where the
   * writer can compare them and decide.
   */
  otherVersions: string[];
  savedCopies?: SavedCopy[];
  savedCopiesError?: string | null;
  recoveryCopies?: RecoveryCopiesState;
  /** What a run of changes to one file did: before the first, and what the last left. */
  loadDiff: (entryIds: readonly string[]) => Promise<{ before: string; after: string } | null>;
  /** These changes have been in front of the writer. */
  onSeen: (entryIds: readonly string[]) => void;
  /** And these kept copies (a save's, a crash's). */
  onSeenCopies?: (ids: readonly string[]) => void;
  onRevert: (entryIds: readonly string[]) => Promise<boolean>;
  /** The file still reads as the last of these left it, so they can be put back. */
  canRevert: (entryIds: readonly string[]) => Promise<boolean>;
  /** Read one, for the comparison. */
  loadOther: (path: string) => Promise<{ theirs: string; ours: string } | null>;
  /** Promote it over the file it is a copy of. */
  onKeepOther: (path: string) => Promise<boolean>;
  /** Move it to the trash — recoverable, and the writer's own call. */
  onTrashOther: (path: string) => Promise<boolean>;
  /** The writer's own versions of every document, for their sittings (docs/app/keeping-work/storage-and-file-format.md#STOR-119). */
  history?: HistorySource;
  /** Show this first — Versions… asks for the writer's own versions of one document. A new object asks again. */
  focus?: { who: Who; docId: string | null } | null;
  /** The request above was acted on, so a later visit shows everything again. */
  onFocusHandled?: () => void;
  /** Draws a script's changes on the script's own page; without it they are drawn as plain lines. */
  scriptPage?: ScriptPage;
  /** Draws a document's changes on the document's own page; without it, plain lines. */
  documentPage?: DocumentPage;
  /**
   * The newest changes from outside the open script can draw on itself
   * (docs/app/keeping-work/storage-and-file-format.md#STOR-185), and how to
   * draw them there.
   */
  inScript?: { ids: readonly string[]; show: () => void } | null;
}

/** Entries shown before "Show Older". */
const PAGE = 40;
/** Changes from outside read into the timeline: the ledger only grows. */
const OUTSIDE_KEPT = 200;
/** Narrower than this, a change opens under its line instead of beside the list. */
const SPLIT_MIN_PX = 760;

/** The last path segment. */
function baseOf(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** A file's name as a writer calls it: no folder, no extension. */
function nameOf(p: string): string {
  return baseOf(p).replace(/\.(fountain|md|markdown|txt)$/i, "");
}

/** Under this long, a burst is one moment, said as the time of its last save. */
const MOMENT_MS = 5 * 60_000;

/** The time a burst spans, as a clock reads it: a span only when it took minutes. */
function burstSpan(burst: Burst): string {
  const from = timeLabel(burst.start);
  const to = timeLabel(burst.ts);
  return from === to || Date.parse(burst.ts) - Date.parse(burst.start) < MOMENT_MS
    ? to
    : `${from}–${to}`;
}

/** A save's time, to the second when another save of the burst shares its minute. */
function saveLabel(entries: readonly LedgerEntry[], i: number): string {
  const label = timeLabel(entries[i]!.ts);
  const shared = entries.some((e, k) => k !== i && timeLabel(e.ts) === label);
  return shared
    ? new Date(entries[i]!.ts).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : label;
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * True while the element is at least `min` pixels wide; null until it has
 * been measured, so a chosen change is drawn once, in the place it belongs,
 * never drawn in one and moved to the other.
 */
function useWide(el: HTMLElement | null, min: number): boolean | null {
  const [wide, setWide] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const solve = () => setWide(el.clientWidth >= min);
    solve();
    const observer = new ResizeObserver(solve);
    observer.observe(el);
    // Observers are silent in a window that is not being painted.
    window.addEventListener("resize", solve);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", solve);
    };
  }, [el, min]);
  return wide;
}

export function ChangesView({
  entries,
  joins,
  otherVersions,
  savedCopies = [],
  savedCopiesError = null,
  recoveryCopies,
  loadDiff,
  onSeen,
  onSeenCopies,
  onRevert,
  canRevert,
  loadOther,
  onKeepOther,
  onTrashOther,
  history,
  focus,
  onFocusHandled,
  scriptPage,
  documentPage,
  inScript,
}: ChangesViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState<string | null>(null);
  const [look, setLook] = useState<ChangesLook>(readLook);
  const [now, setNow] = useState(() => Date.now());
  const [who, setWho] = useState<Who>("all");
  const [docId, setDocId] = useState<string | null>(null);
  const [docs, setDocs] = useState<HistoryDoc[]>([]);
  const [shownCount, setShownCount] = useState(PAGE);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Measured whenever the surface's element comes: it is not there while
  // Changes says it has nothing yet.
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const wide = useWide(rootEl, SPLIT_MIN_PX);
  const setRoot = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    setRootEl(el);
  }, []);

  // Keep the relative times honest without a render loop.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /*
   * Looking is seeing
   * (docs/app/keeping-work/storage-and-file-format.md#STOR-183). What was new
   * when the writer looked stays marked New while this is in front, and the
   * badge, which counts what has not been seen, goes at once. A change that
   * arrives while it is in front is new, and seen, the same way.
   */
  const fresh = useRef(new Set<string>());
  const unseen = entries.filter((e) => e.status === "pending").map((e) => e.id);
  for (const id of unseen) fresh.current.add(id);
  const unseenKey = unseen.join();
  useEffect(() => {
    if (unseen.length) onSeen(unseen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenKey]);
  const copyKey = [...savedCopies, ...(recoveryCopies?.copies ?? [])].map((c) => c.id).join("\n");
  useEffect(() => {
    if (copyKey) onSeenCopies?.(copyKey.split("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyKey]);

  // Versions… opens here on the writer's own versions of what was in front.
  useEffect(() => {
    if (!focus) return;
    setWho(focus.who);
    setDocId(focus.docId);
    setSelected(null);
    setSayCount(true);
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // The writer's half: every document's versions, read again whenever one is kept.
  const [generation, setGeneration] = useState(0);
  /** Versions… asked: say what it found once the list is read. */
  const [sayCount, setSayCount] = useState(false);
  const [loaded, setLoaded] = useState(0);
  useEffect(() => {
    if (!history) return;
    let live = true;
    const done = () => live && setLoaded((n) => n + 1);
    void history
      .load()
      .then((list) => live && setDocs(list))
      .catch(() => live && setDocs([]))
      .finally(done);
    return () => {
      live = false;
    };
  }, [history, generation]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setGeneration((g) => g + 1), 400);
    };
    window.addEventListener(VERSION_KEPT_EVENT, again);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(VERSION_KEPT_EVENT, again);
    };
  }, []);
  const read = useMemo(
    () => (history ? versionReader(history.read) : null),
    // A new reading of the list reads versions afresh: a pruned one is gone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, generation],
  );
  const docMap = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs]);
  const outsideSince = useMemo<OutsideSince>(() => {
    const latest = new Map<string, number>();
    for (const e of entries)
      latest.set(e.path, Math.max(latest.get(e.path) ?? 0, Date.parse(e.ts)));
    return (path, ms) => path !== null && (latest.get(path) ?? 0) > ms;
  }, [entries]);

  const outside = useMemo(() => entries.slice(-OUTSIDE_KEPT), [entries]);
  const timeline = useMemo(
    () => filterTimeline(buildTimeline(docs, outside, undefined, entries, joins), who, docId, docs),
    [docs, outside, entries, joins, who, docId],
  );
  const visible = timeline.slice(0, shownCount);
  const groups = useDayGroups(visible, (e) => (e.kind === "sitting" ? e.end : e.ts), now);
  const order = visible.map((e) => e.key);

  /** Something in this entry was new when the writer looked. */
  const isNew = (e: TimelineEntry) =>
    e.kind === "outside" && e.entries.some((x) => fresh.current.has(x.id));

  // Opens on the newest change the writer had not seen, else the newest of all.
  // A choice the list no longer holds (a filter, a burst that grew) is made again.
  const current =
    selected && order.includes(selected)
      ? selected
      : (visible.find(isNew)?.key ?? visible[0]?.key ?? null);
  const at = current ? order.indexOf(current) : -1;
  const chosen = at >= 0 ? visible[at]! : null;

  /** Choose the entry `delta` away from the chosen one, and move focus to it. */
  const step = (delta: number) => {
    if (!order.length) return;
    const next = at < 0 ? 0 : Math.max(0, Math.min(order.length - 1, at + delta));
    const key = order[next]!;
    setSelected(key);
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>(`[data-step="${CSS.escape(key)}"]`)?.focus(),
    );
  };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    if (!(ev.target as HTMLElement).closest("[data-step]")) return;
    ev.preventDefault();
    step(ev.key === "ArrowDown" ? 1 : -1);
  };

  /*
   * What Versions… found, said once the list is read after it asked, and
   * said with what the entry it opens on says as it is read (status.ts): two
   * messages at one moment are one heard.
   */
  const [countNote, setCountNote] = useState<string | null>(null);
  useEffect(() => {
    if (!sayCount || !loaded) return;
    setSayCount(false);
    const sittings = timeline.filter((e) => e.kind === "sitting").length;
    const of = docId ? ` of ${docMap.get(docId)?.title ?? "this document"}` : "";
    setCountNote(
      sittings
        ? `Your versions${of}: ${sittings} ${sittings === 1 ? "session" : "sessions"}.`
        : `No versions of your own${of} yet.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sayCount, loaded]);
  const reports = useRef(new Map<string, { message: string | null; settled: boolean }>());
  const [reported, setReported] = useState(0);
  const sink = useMemo<StatusSink>(
    () => ({
      holding: countNote !== null,
      report: (key, message, settled) => {
        reports.current.set(key, { message, settled });
        setReported((n) => n + 1);
      },
    }),
    [countNote],
  );
  const hasChosen = !!chosen;
  useEffect(() => {
    if (countNote === null) return;
    const say = () => {
      const rest = [...reports.current.values()].map((r) => r.message).filter(Boolean);
      reports.current.clear();
      ensureAnnouncer();
      announce([countNote, ...rest].join(" "));
      setCountNote(null);
    };
    const settled = [...reports.current.values()].some((r) => r.settled);
    if (!hasChosen || settled) {
      say();
      return;
    }
    // An entry slow to read is not waited on for long: its result follows.
    const timer = setTimeout(say, 1500);
    return () => clearTimeout(timer);
  }, [countNote, reported, hasChosen]);

  const nothingOutside =
    entries.length === 0 &&
    otherVersions.length === 0 &&
    savedCopies.length === 0 &&
    !savedCopiesError &&
    !recoveryCopies?.copies.length &&
    !recoveryCopies?.error;
  if (nothingOutside && docs.length === 0) {
    return (
      <div className="changes changes--empty">
        <div className="emptysurface">
          <span className="emptysurface__glyph">
            <RevertIcon size={22} />
          </span>
          <p className="emptysurface__title">No changes yet</p>
          <p className="emptysurface__body">
            Your writing sessions show up here as you write, and so does anything changed on another
            device or in another editor, each with a way back.
          </p>
        </div>
      </div>
    );
  }

  const docOptions = [
    { value: "", label: "All documents" },
    ...docs.map((d) => ({ value: d.id, label: d.title })),
  ];
  const titleOf = (path: string) => docs.find((d) => d.path === path)?.title ?? nameOf(path);
  const newCount = visible.filter(isNew).length;

  const head = (e: TimelineEntry): ReactNode => (
    <DetailHead
      who={e.kind === "sitting" ? sittingWho(e) : "Changed somewhere else"}
      when={`${dayLabel(e.kind === "sitting" ? e.end : e.ts, now)}, ${
        e.kind === "sitting" ? span(e) : burstSpan(e)
      }`}
      fresh={isNew(e)}
      newer={at > 0 ? () => step(-1) : undefined}
      older={at >= 0 && at < order.length - 1 ? () => step(1) : undefined}
    />
  );

  const detail = (e: TimelineEntry): ReactNode =>
    e.kind === "outside" ? (
      <BurstDetail
        key={e.key}
        burst={e}
        title={titleOf(e.path)}
        head={head(e)}
        loadDiff={loadDiff}
        onRevert={onRevert}
        canRevert={canRevert}
        history={history}
        look={look}
        scriptPage={scriptPage}
        documentPage={documentPage}
        now={now}
        inScript={
          inScript &&
          sameIds(
            inScript.ids,
            e.entries.map((x) => x.id),
          )
            ? inScript.show
            : undefined
        }
      />
    ) : history && read ? (
      <SittingDetail
        key={e.key}
        sitting={e}
        docs={docMap}
        history={history}
        read={read}
        now={now}
        onRestored={() => setGeneration((n) => n + 1)}
        outsideSince={outsideSince}
        look={look}
        scriptPage={scriptPage}
        documentPage={documentPage}
        head={head(e)}
      />
    ) : null;

  return (
    <ChangeStatus.Provider value={sink}>
      <div
        className={`changes${wide ? " changes--split" : ""}`}
        ref={setRoot}
        onKeyDown={onKeyDown}
      >
        <SavedCopies copies={savedCopies} error={savedCopiesError} />
        {recoveryCopies && (
          <SavedCopies
            {...recoveryCopies}
            heading="Recovered document copies"
            notice="Proscenium kept these words before a previous session ended. You can select and copy them here. Reading a copy does not change your play."
          />
        )}
        {/* A provider's conflict copy is not a change to a file — it is a second
          file claiming to be one. It goes first, because it is the only thing
          here that is still sitting in the folder waiting to be resolved. */}
        {otherVersions.length > 0 && <h3 className="changes__group">Other versions</h3>}
        {otherVersions.map((path) => (
          <OtherVersionRow
            key={path}
            path={path}
            open={otherOpen === path}
            onToggle={() => setOtherOpen(otherOpen === path ? null : path)}
            loadOther={loadOther}
            onKeepOther={onKeepOther}
            onTrashOther={onTrashOther}
            look={look}
            scriptPage={scriptPage}
            documentPage={documentPage}
          />
        ))}
        <div className="changes__bar">
          <Segmented
            size="small"
            label="Whose changes"
            value={who}
            onChange={(v) => {
              setWho(v);
              setSelected(null);
            }}
            options={[
              { id: "all", label: "All" },
              { id: "mine", label: "Mine" },
              { id: "outside", label: "From Outside" },
            ]}
          />
          {docs.length > 1 && (
            <PopupButton
              label="Which document"
              menuWidth={260}
              value={docId ?? ""}
              onChange={(v) => {
                setDocId(v || null);
                setSelected(null);
              }}
              options={docOptions}
            />
          )}
          {newCount > 0 && (
            <span className="changes__hint changes__new">{newCount} new since you last looked</span>
          )}
          <span className="changes__spacer" />
          <Segmented
            size="small"
            label="How changes are shown"
            value={look}
            onChange={(v) => {
              setLook(v);
              writeLook(v);
            }}
            options={[
              { id: "page", label: "On the Page" },
              { id: "lines", label: "Line by Line" },
            ]}
          />
        </div>
        <div className="changes__split">
          <nav className="changes__list" aria-label="Changes, newest first">
            {groups.map((g) => (
              <div className="changes__day" key={g.day}>
                <h3 className="changes__group">{g.day}</h3>
                <ul className="changes__rows">
                  {g.items.map((e) => (
                    <li key={e.key}>
                      <ChangeRowButton
                        entry={e}
                        chosen={e.key === current}
                        fresh={isNew(e)}
                        title={e.kind === "outside" ? titleOf(e.path) : ""}
                        onChoose={() => setSelected(e.key)}
                        loadDiff={loadDiff}
                        docs={docMap}
                        history={history}
                        read={read}
                        now={now}
                        outsideSince={outsideSince}
                      />
                      {wide === false && e.key === current && detail(e)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {timeline.length > shownCount && (
              <Button size="small" onClick={() => setShownCount((n) => n + PAGE)}>
                Show Older
              </Button>
            )}
            {!timeline.length && (
              <p className="changes__hint">
                {who === "mine"
                  ? "No versions of your own here yet."
                  : who === "outside"
                    ? "Nothing here has changed somewhere else."
                    : "Nothing here yet."}
              </p>
            )}
          </nav>
          {wide && chosen && (
            <section className="changes__detail" aria-label="The change chosen">
              {detail(chosen)}
            </section>
          )}
        </div>
      </div>
    </ChangeStatus.Provider>
  );
}

/** Who, when, and the steps to the next entry either way: the top of a chosen change. */
function DetailHead({
  who,
  when,
  fresh,
  newer,
  older,
}: {
  who: string;
  when: string;
  fresh: boolean;
  newer?: () => void;
  older?: () => void;
}) {
  return (
    <div className="changedetail__head">
      <span className="capsule change__who">{who}</span>
      {fresh && <span className="change__new">New</span>}
      <span className="change__when">{when}</span>
      <span className="changes__spacer" />
      <span className="changes__hint changes__keys" aria-hidden="true">
        ↑ ↓ to step
      </span>
      <Button size="small" disabled={!newer} onClick={newer}>
        Newer
      </Button>
      <Button size="small" disabled={!older} onClick={older}>
        Older
      </Button>
    </div>
  );
}

/** One line of the timeline: who, when, what, where, and how much. */
function ChangeRowButton({
  entry,
  chosen,
  fresh,
  title,
  onChoose,
  loadDiff,
  docs,
  history,
  read,
  now,
  outsideSince,
}: {
  entry: TimelineEntry;
  chosen: boolean;
  fresh: boolean;
  /** A burst's document, by its name. */
  title: string;
  onChoose: () => void;
  loadDiff: ChangesViewProps["loadDiff"];
  docs: ReadonlyMap<string, HistoryDoc>;
  history?: HistorySource;
  read: ((docId: string, name: string) => Promise<string>) | null;
  now: number;
  outsideSince: OutsideSince;
}) {
  return (
    <button
      type="button"
      className={`change__summary changerow changerow--${entry.kind}${fresh ? " changerow--new" : ""}`}
      data-step={entry.key}
      aria-current={chosen ? "true" : undefined}
      onClick={onChoose}
    >
      {entry.kind === "outside" ? (
        <BurstLine burst={entry} title={title} fresh={fresh} loadDiff={loadDiff} />
      ) : history && read ? (
        <SittingLine
          sitting={entry}
          docs={docs}
          history={history}
          read={read}
          now={now}
          outsideSince={outsideSince}
        />
      ) : null}
    </button>
  );
}

function SittingLine({
  sitting,
  docs,
  history,
  read,
  now,
  outsideSince,
}: {
  sitting: Sitting;
  docs: ReadonlyMap<string, HistoryDoc>;
  history: HistorySource;
  read: (docId: string, name: string) => Promise<string>;
  now: number;
  outsideSince: OutsideSince;
}) {
  const summary = useSittingSummary(sitting, docs, history, read, now, outsideSince);
  const titles = sitting.docs.filter((p) => docs.has(p.docId)).map((p) => docs.get(p.docId)!.title);
  return (
    <>
      <span className="changerow__top">
        <span className="capsule change__who sitting__who">{sittingWho(sitting)}</span>
        <span className="change__when">{span(sitting)}</span>
      </span>
      <span className="changerow__what sitting__titles">{titles.join(", ")}</span>
      <span className="changerow__where">
        {summary?.scenes.length ? (
          <span className="changerow__scenes">{scenesSaid([...new Set(summary.scenes)])}</span>
        ) : null}
        {summary && <WordStats added={summary.added} removed={summary.removed} />}
      </span>
    </>
  );
}

/** What a burst did, read once for its line and again only if the list moves. */
function useBurstSummary(burst: Burst, loadDiff: ChangesViewProps["loadDiff"]) {
  const ids = burst.entries.map((e) => e.id);
  const key = ids.join();
  const [summary, setSummary] = useState<{
    added: number;
    removed: number;
    scenes: string[];
  } | null>(null);
  useEffect(() => {
    let live = true;
    void loadDiff(ids)
      .then((texts) => {
        if (!live || !texts) return;
        setSummary({
          ...wordStats(texts.before, texts.after),
          scenes: isScriptPath(burst.path) ? touchedSceneNames(texts.before, texts.after) : [],
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadDiff]);
  return summary;
}

function BurstLine({
  burst,
  title,
  fresh,
  loadDiff,
}: {
  burst: Burst;
  title: string;
  fresh: boolean;
  loadDiff: ChangesViewProps["loadDiff"];
}) {
  const summary = useBurstSummary(burst, loadDiff);
  const n = burst.entries.length;
  const reverted = burst.entries.every((e) => e.status === "reverted");
  return (
    <>
      <span className="changerow__top">
        <span className="capsule change__who">Changed somewhere else</span>
        {fresh && <span className="change__new">New</span>}
        <span className="change__when">{burstSpan(burst)}</span>
      </span>
      <span className="changerow__what">
        {title}
        {n > 1 && <span className="changerow__count"> · {n} saves</span>}
        {reverted && <span className="change__status"> · put back</span>}
      </span>
      {/* Outside text. Plain, never markup. */}
      {burst.entries.map((e) =>
        e.note ? (
          <span key={e.id} className="change__note">
            “{e.note}”
          </span>
        ) : null,
      )}
      <span className="changerow__where">
        {summary?.scenes.length ? (
          <span className="changerow__scenes">{scenesSaid(summary.scenes)}</span>
        ) : null}
        {summary && <WordStats added={summary.added} removed={summary.removed} />}
        {!summary && !burst.entries[0]?.revertable && (
          <span className="change__nobase" title="No record of what was here before this change">
            changed while closed
          </span>
        )}
      </span>
    </>
  );
}

/** Two texts read for a comparison, or "none" when there is nothing to compare with. */
type Texts = { before: string; after: string } | "none";

/**
 * A burst, chosen: what it did on the page, its saves one at a time, and the
 * way back. Revert writes the text from before its first change, and only
 * while the file still reads as its last left it; once the file has moved on,
 * the copy kept as it arrived is put back as a version is.
 */
function BurstDetail({
  burst,
  title,
  head,
  loadDiff,
  onRevert,
  canRevert,
  history,
  look,
  scriptPage,
  documentPage,
  now,
  inScript,
}: {
  burst: Burst;
  title: string;
  head: ReactNode;
  loadDiff: ChangesViewProps["loadDiff"];
  onRevert: ChangesViewProps["onRevert"];
  canRevert: ChangesViewProps["canRevert"];
  history?: HistorySource;
  look: ChangesLook;
  scriptPage?: ScriptPage;
  documentPage?: DocumentPage;
  now: number;
  inScript?: () => void;
}) {
  /** All of the burst, or one save of it against the one before. */
  const [pick, setPick] = useState<number | "all">("all");
  const ids = pick === "all" ? burst.entries.map((e) => e.id) : [burst.entries[pick]!.id];
  const key = ids.join();
  const [rows, setRows] = useState<Texts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revertable, setRevertable] = useState(false);
  /* Revert REWRITES the script and cannot be walked back from the Finder, so
     it is one of the two actions that still ask (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). */
  const [confirming, setConfirming] = useState<"revert" | "restore" | null>(null);
  const reverted = burst.entries.some((e) => e.status === "reverted");
  const allIds = burst.entries.map((e) => e.id).join();

  // Read each time it is chosen: the file may have moved on since.
  useEffect(() => {
    let dead = false;
    setRows(null);
    setLoadError(null);
    void loadDiff(ids)
      .then((d) => {
        if (!dead) setRows(d ?? "none");
      })
      .catch((error) => {
        if (!dead) setLoadError(String(error));
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadDiff, loadError === null]);
  useEffect(() => {
    let dead = false;
    void canRevert(burst.entries.map((e) => e.id)).then((ok) => !dead && setRevertable(ok));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allIds, canRevert, busy]);
  useChangeStatus(
    burst.key,
    loadError
      ? `Could not read changes in ${burst.path}. ${loadError}`
      : rows === null
        ? `Reading changes in ${burst.path}…`
        : rows !== "none"
          ? `Comparison ready for ${burst.path}.`
          : `No comparison available for ${burst.path}.`,
    !!loadError || rows !== null,
  );

  const stats = rows && rows !== "none" ? wordStats(rows.before, rows.after) : null;
  const scenes =
    rows && rows !== "none" && isScriptPath(burst.path)
      ? touchedSceneNames(rows.before, rows.after)
      : [];
  const kept = burst.kept;
  const target = kept && history ? history.target(kept.docId) : null;

  return (
    <section className={`changedetail change change--${reverted ? "reverted" : "kept"}`}>
      {head}
      <div className="sitting__dochead">
        <span className="sitting__doctitle">{title}</span>
        {scenes.length > 0 && <span className="sitting__scenes">{scenesSaid(scenes)}</span>}
        {stats && <WordStats added={stats.added} removed={stats.removed} />}
        <ChangeSteps />
      </div>
      {burst.entries.length > 1 && (
        <div className="sitting__versions" role="group" aria-label={`Saves to ${title}`}>
          <button
            type="button"
            className="sitting__version"
            aria-pressed={pick === "all"}
            onClick={() => setPick("all")}
          >
            All {burst.entries.length} saves
          </button>
          {burst.entries.map((e, i) => (
            <button
              key={e.id}
              type="button"
              className="sitting__version"
              aria-pressed={pick === i}
              onClick={() => setPick(i)}
            >
              {saveLabel(burst.entries, i)}
            </button>
          ))}
        </div>
      )}
      <div className="change__actions changedetail__actions">
        {inScript && !reverted && (
          <Button size="small" onClick={inScript}>
            Show in Script
          </Button>
        )}
        {reverted ? (
          <span className="change__status">Put back</span>
        ) : revertable ? (
          <Button
            size="small"
            treatment="destructive"
            disabled={busy}
            onClick={() => setConfirming("revert")}
          >
            Revert…
          </Button>
        ) : kept && target ? (
          <Button size="small" disabled={busy} onClick={() => setConfirming("restore")}>
            Restore as It Was Before…
          </Button>
        ) : kept && history ? (
          <Button size="small" onClick={() => history.open(kept.docId)}>
            Open {title} to Restore
          </Button>
        ) : null}
      </div>
      {confirming === "revert" && (
        <Alert
          title={`Revert ${burst.entries.length > 1 ? "these changes" : "this change"} to ${title}?`}
          body={`${
            stats ? `${wordsSaid(stats.added, stats.removed)}: ` : ""
          }${title} goes back to how you had it. What it says now is kept in Versions, and the change stays in the list as put back.`}
          confirmLabel={busy ? "Reverting…" : "Revert"}
          destructive
          onConfirm={() => {
            setBusy(true);
            void onRevert(burst.entries.map((e) => e.id)).finally(() => {
              setBusy(false);
              setConfirming(null);
            });
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === "restore" && kept && target && (
        <Alert
          title={`Put ${title} back to ${dayLabel(kept.version.ts, now).toLowerCase()} at ${timeLabel(kept.version.ts)}?`}
          body="That is how you had it when this change arrived. What it says now is kept as a version first, so this can be undone here."
          confirmLabel={busy ? "Restoring…" : "Restore"}
          onConfirm={() => {
            setBusy(true);
            void target.restore(kept.version.name).finally(() => {
              setBusy(false);
              setConfirming(null);
            });
          }}
          onCancel={() => setConfirming(null)}
        />
      )}
      <div
        className={`change__diff change__diff--${look}`}
        tabIndex={0}
        role="region"
        aria-label={`What changed in ${burst.path}`}
        aria-busy={rows === null && !loadError}
      >
        {loadError && (
          <p className="changes__hint">
            Could not read this comparison. {loadError}{" "}
            <Button size="small" onClick={() => setLoadError(null)}>
              Try Again
            </Button>
          </p>
        )}
        {rows === null && !loadError && <p className="changes__hint">Reading…</p>}
        {rows === "none" && (
          <p className="changes__hint">
            No comparison available: there is no record of what this file held before.
          </p>
        )}
        {rows && rows !== "none" && rows.before === rows.after && (
          <p className="changes__hint">Nothing changed — the text is the same.</p>
        )}
        {rows && rows !== "none" && rows.before !== rows.after && (
          <Comparison
            before={rows.before}
            after={rows.after}
            look={look}
            script={isScriptPath(burst.path)}
            document={isDocumentPath(burst.path)}
            scriptPage={scriptPage}
            documentPage={documentPage}
            label={`${baseOf(burst.path)}, with its changes marked`}
          />
        )}
      </div>
    </section>
  );
}

/**
 * One provider conflict copy (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
 *
 * Syncthing and Dropbox name theirs unambiguously, so the app can say what the
 * file is a copy OF rather than showing a name with a timestamp buried in it.
 * Three things a writer can do with it, and the app does none of them by
 * itself: look at the difference, keep this one instead, or throw it away.
 */
function OtherVersionRow({
  path,
  open,
  onToggle,
  loadOther,
  onKeepOther,
  onTrashOther,
  look,
  scriptPage,
  documentPage,
}: {
  path: string;
  open: boolean;
  onToggle: () => void;
  loadOther: ChangesViewProps["loadOther"];
  onKeepOther: ChangesViewProps["onKeepOther"];
  onTrashOther: ChangesViewProps["onTrashOther"];
  look: ChangesLook;
  scriptPage?: ScriptPage;
  documentPage?: DocumentPage;
}) {
  const [rows, setRows] = useState<Texts | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"keep" | "trash" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const original = conflictOriginal(baseOf(path));

  useEffect(() => {
    if (!open || rows || loadError) return;
    let live = true;
    void loadOther(path)
      .then((d) => {
        if (!live) return;
        setRows(d ? { before: d.ours, after: d.theirs } : "none");
      })
      .catch((error) => {
        if (live) setLoadError(String(error));
      });
    return () => {
      live = false;
    };
  }, [open, rows, loadError, loadOther, path]);
  useAnnouncedStatus(
    !open
      ? null
      : loadError
        ? `Could not read the other version of ${path}. ${loadError}`
        : rows === null
          ? `Reading the other version of ${path}…`
          : rows !== "none"
            ? `Comparison ready for ${path}.`
            : `The other version of ${path} could not be read.`,
  );

  return (
    <div className={`change${open ? " is-open" : ""}`}>
      <button type="button" className="change__head" onClick={onToggle} aria-expanded={open}>
        <span className="change__path">
          {original ? `Another version of ${original}` : baseOf(path)}
        </span>
        <span className="change__when">left by a sync</span>
      </button>
      {open && (
        <div className="change__body" aria-busy={rows === null && !loadError}>
          {loadError && (
            <p className="change__nobase">
              Could not read this comparison. {loadError}{" "}
              <Button size="small" onClick={() => setLoadError(null)}>
                Try Again
              </Button>
            </p>
          )}
          {rows === null && !loadError && <p className="change__nobase">Loading…</p>}
          {rows === "none" && <p className="change__nobase">This one could not be read.</p>}
          {rows && rows !== "none" && (
            <div
              className={`diffview__diff change__diff change__diff--${look}`}
              tabIndex={0}
              role="region"
              aria-label={`How the copy differs from ${path}`}
            >
              <Comparison
                before={rows.before}
                after={rows.after}
                look={look}
                script={isScriptPath(path)}
                document={isDocumentPath(path)}
                scriptPage={scriptPage}
                documentPage={documentPage}
                label={`${baseOf(path)}, with its differences marked`}
              />
            </div>
          )}
          <div className="change__actions">
            <Button size="small" disabled={busy} onClick={() => setConfirming("keep")}>
              Keep this one
            </Button>
            <Button size="small" disabled={busy} onClick={() => setConfirming("trash")}>
              Move to Trash
            </Button>
          </div>
        </div>
      )}
      {confirming === "keep" && (
        <Alert
          title="Keep this version instead?"
          body="It replaces the file it is a copy of. The replaced text is kept in Versions."
          confirmLabel="Keep this one"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            setBusy(true);
            void onKeepOther(path).finally(() => setBusy(false));
          }}
        />
      )}
      {confirming === "trash" && (
        <Alert
          title="Move this version to the Trash?"
          body="It goes to the Trash, where you can put it back."
          confirmLabel="Move to Trash"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            setBusy(true);
            void onTrashOther(path).finally(() => setBusy(false));
          }}
        />
      )}
    </div>
  );
}
