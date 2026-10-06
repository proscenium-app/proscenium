// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Changes surface — one timeline of the play: the writer's own sittings,
 * from Versions, and what arrived in this folder from somewhere else, each as
 * something you can read, step through, keep, or undo
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-119).
 *
 * An entry's `note` is always absent now (the inbound note channel went with
 * the chat panel). Where an older entry still carries one it is rendered as PLAIN
 * TEXT — a text node, never markup, never a link — because it was written by
 * something other than the app.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Comparison,
  isScriptPath,
  readLook,
  writeLook,
  type ChangesLook,
  type ScriptPage,
} from "./Comparison";
import { Alert, Button, PopupButton, RevertIcon, Segmented } from "../ui";
import { VERSION_KEPT_EVENT } from "../storage/ipc";
import { SittingRow, useDayGroups, versionReader, type HistorySource } from "./SittingRow";
import { buildTimeline, filterTimeline, type HistoryDoc, type Who } from "./timeline";
import { conflictOriginal } from "../workspace/sync-names";
import type { LedgerEntry } from "./store";
import { SavedCopies } from "./SavedCopies";
import type { SavedCopy } from "../storage/ipc";
import type { RecoveryCopiesState } from "./RecoveryCopies";
import { useAnnouncedStatus } from "../ui/use-announced-status";

export interface ChangesViewProps {
  entries: LedgerEntry[];
  /**
   * Files a sync provider left behind — another version of something in the
   * play (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). Never listed as scripts; they surface here, where the
   * writer can compare them and decide.
   */
  otherVersions: string[];
  savedCopies?: SavedCopy[];
  savedCopiesError?: string | null;
  recoveryCopies?: RecoveryCopiesState;
  loadDiff: (entryId: string) => Promise<{ before: string; after: string } | null>;
  onKeep: (entryId: string) => void;
  onRevert: (entryId: string) => Promise<boolean>;
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
}

/** Entries shown before "Show Older". */
const PAGE = 40;
/** Settled outside changes read into the timeline: the ledger only grows. */
const SETTLED_KEPT = 200;

/** The last path segment. */
function baseOf(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** "2m ago" — relative, because the useful question is "since when I looked". */
function ago(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ChangesView({
  entries,
  otherVersions,
  savedCopies = [],
  savedCopiesError = null,
  recoveryCopies,
  loadDiff,
  onKeep,
  onRevert,
  loadOther,
  onKeepOther,
  onTrashOther,
  history,
  focus,
  onFocusHandled,
  scriptPage,
}: ChangesViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [look, setLook] = useState<ChangesLook>(readLook);
  const [now, setNow] = useState(() => Date.now());
  const [who, setWho] = useState<Who>("all");
  const [docId, setDocId] = useState<string | null>(null);
  const [docs, setDocs] = useState<HistoryDoc[]>([]);
  const [shownCount, setShownCount] = useState(PAGE);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Keep the relative times honest without a render loop.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Versions… opens here on the writer's own versions of what was in front.
  useEffect(() => {
    if (!focus) return;
    setWho(focus.who);
    setDocId(focus.docId);
    setOpenId(null);
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
  const outsideSince = useMemo(() => {
    const latest = new Map<string, number>();
    for (const e of entries)
      latest.set(e.path, Math.max(latest.get(e.path) ?? 0, Date.parse(e.ts)));
    return (path: string | null, ms: number) => path !== null && (latest.get(path) ?? 0) > ms;
  }, [entries]);

  const pending = entries
    .filter((e) => e.status === "pending")
    .slice()
    .reverse();
  const settled = useMemo(
    () => entries.filter((e) => e.status !== "pending").slice(-SETTLED_KEPT),
    [entries],
  );
  const timeline = useMemo(
    () => filterTimeline(buildTimeline(docs, settled, undefined, entries), who, docId, docs),
    [docs, settled, entries, who, docId],
  );
  const shownPending = pending.filter(
    (e) => who !== "mine" && (!docId || e.path === (docMap.get(docId)?.path ?? null)),
  );
  const visible = timeline.slice(0, shownCount);
  const groups = useDayGroups(visible, (e) => (e.kind === "sitting" ? e.end : e.ts), now);
  const order = [...shownPending.map((e) => `pending:${e.id}`), ...visible.map((e) => e.key)];

  /** Open the entry `delta` away from the open (or focused) one, and move focus to it. */
  const step = (delta: number, from?: string | null) => {
    if (!order.length) return;
    const at = order.indexOf(from ?? openId ?? "");
    const next =
      at < 0
        ? delta > 0
          ? 0
          : order.length - 1
        : Math.max(0, Math.min(order.length - 1, at + delta));
    const key = order[next]!;
    setOpenId(key);
    requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>(`[data-step="${CSS.escape(key)}"]`)?.focus(),
    );
  };
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const on = (ev.target as HTMLElement).closest<HTMLElement>("[data-step]");
    if (!on) return;
    ev.preventDefault();
    step(ev.key === "ArrowDown" ? 1 : -1, on.dataset.step);
  };
  const at = order.indexOf(openId ?? "");

  // What Versions… found, said once the list is read after it asked.
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
  useAnnouncedStatus(countNote);

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
  const renderOutside = (e: LedgerEntry, key: string) => (
    <ChangeRow
      key={key}
      stepKey={key}
      entry={e}
      now={now}
      open={openId === key}
      onToggle={() => setOpenId(openId === key ? null : key)}
      loadDiff={loadDiff}
      onKeep={onKeep}
      onRevert={onRevert}
      look={look}
      scriptPage={scriptPage}
    />
  );

  return (
    <div className="changes" ref={rootRef} onKeyDown={onKeyDown}>
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
          open={openId === path}
          onToggle={() => setOpenId(openId === path ? null : path)}
          loadOther={loadOther}
          onKeepOther={onKeepOther}
          onTrashOther={onTrashOther}
          look={look}
          scriptPage={scriptPage}
        />
      ))}
      <div className="changes__bar">
        <Segmented
          size="small"
          label="Whose changes"
          value={who}
          onChange={(v) => {
            setWho(v);
            setOpenId(null);
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
              setOpenId(null);
            }}
            options={docOptions}
          />
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
        <span className="changes__hint changes__keys" aria-hidden="true">
          ↑ ↓ to step
        </span>
        <Button size="small" disabled={!order.length || at === 0} onClick={() => step(-1)}>
          Newer
        </Button>
        <Button
          size="small"
          disabled={!order.length || at === order.length - 1}
          onClick={() => step(1)}
        >
          Older
        </Button>
      </div>
      {shownPending.length > 0 && <h3 className="changes__group">Needs a look</h3>}
      {shownPending.map((e) => renderOutside(e, `pending:${e.id}`))}
      {groups.map((g) => (
        <div className="changes__day" key={g.day}>
          <h3 className="changes__group">{g.day}</h3>
          {g.items.map((e) =>
            e.kind === "outside" ? (
              renderOutside(e.entry, e.key)
            ) : history && read ? (
              <SittingRow
                key={e.key}
                stepKey={e.key}
                sitting={e}
                docs={docMap}
                open={openId === e.key}
                onToggle={() => setOpenId(openId === e.key ? null : e.key)}
                history={history}
                read={read}
                now={now}
                onRestored={() => setGeneration((n) => n + 1)}
                outsideSince={outsideSince}
                look={look}
                scriptPage={scriptPage}
              />
            ) : null,
          )}
        </div>
      ))}
      {timeline.length > shownCount && (
        <Button size="small" onClick={() => setShownCount((n) => n + PAGE)}>
          Show Older
        </Button>
      )}
      {!shownPending.length && !timeline.length && (
        <p className="changes__hint">
          {who === "mine"
            ? "No versions of your own here yet."
            : who === "outside"
              ? "Nothing here has changed somewhere else."
              : "Nothing here yet."}
        </p>
      )}
    </div>
  );
}

interface RowProps {
  stepKey: string;
  entry: LedgerEntry;
  now: number;
  open: boolean;
  onToggle: () => void;
  loadDiff: ChangesViewProps["loadDiff"];
  onKeep: ChangesViewProps["onKeep"];
  onRevert: ChangesViewProps["onRevert"];
  look: ChangesLook;
  scriptPage?: ScriptPage;
}

/** Two texts read for a comparison, or "none" when there is nothing to compare with. */
type Texts = { before: string; after: string } | "none";

function ChangeRow({
  stepKey,
  entry,
  now,
  open,
  onToggle,
  loadDiff,
  onKeep,
  onRevert,
  look,
  scriptPage,
}: RowProps) {
  const [rows, setRows] = useState<Texts | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* Revert REWRITES the script and cannot be walked back from the Finder, so
     it is one of the two actions that still ask (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). */
  const [confirming, setConfirming] = useState(false);

  // Read again each time it opens: the comparison is with the file as it
  // stands, and the writer may have changed lines back since it was last read.
  useEffect(() => {
    if (!open) setRows(null);
  }, [open]);
  useEffect(() => {
    if (!open || rows || loadError) return;
    let dead = false;
    void loadDiff(entry.id)
      .then((d) => {
        if (dead) return;
        setRows(d ?? "none");
      })
      .catch((error) => {
        if (!dead) setLoadError(String(error));
      });
    return () => {
      dead = true;
    };
  }, [open, rows, loadError, entry.id, loadDiff]);
  useAnnouncedStatus(
    !open
      ? null
      : loadError
        ? `Could not read changes in ${entry.path}. ${loadError}`
        : rows === null
          ? `Reading changes in ${entry.path}…`
          : rows !== "none"
            ? `Comparison ready for ${entry.path}.`
            : `No comparison available for ${entry.path}.`,
  );

  const pending = entry.status === "pending";

  return (
    <section className={`change change--${entry.status}`}>
      <header className="change__head">
        <button
          className="change__summary"
          data-step={stepKey}
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className="capsule change__who">Changed somewhere else</span>
          <span className="change__when">{ago(entry.ts, now)}</span>
          <span className="change__path">{entry.path}</span>
          {/* Outside text. Plain, truncated at parse, never markup. */}
          {entry.note && <span className="change__note">“{entry.note}”</span>}
          <span className="change__stats">
            {entry.revertable ? (
              <>
                <span className="change__add">+{entry.stats.added}</span>{" "}
                <span className="change__del">−{entry.stats.removed}</span>
              </>
            ) : (
              <span
                className="change__nobase"
                title="No record of what was here before this change"
              >
                changed while closed
              </span>
            )}
          </span>
        </button>
        <span className="change__actions">
          {pending && (
            <>
              <Button size="small" onClick={() => onKeep(entry.id)}>
                Keep
              </Button>
              {entry.revertable && (
                <Button
                  size="small"
                  treatment="destructive"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  Revert
                </Button>
              )}
            </>
          )}
          {!pending && <span className="change__status">{entry.status}</span>}
        </span>
      </header>
      {confirming && (
        <Alert
          title={`Revert this change to ${entry.path.split("/").pop()}?`}
          body={`${entry.stats.added} line${entry.stats.added === 1 ? "" : "s"} added and ${
            entry.stats.removed
          } removed go back to how you had them. The change stays in the list as reverted.`}
          confirmLabel={busy ? "Reverting…" : "Revert"}
          destructive
          onConfirm={() => {
            setBusy(true);
            void onRevert(entry.id).finally(() => {
              setBusy(false);
              setConfirming(false);
            });
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {open && (
        <div
          className={`change__diff change__diff--${look}`}
          tabIndex={0}
          role="region"
          aria-label={`What changed in ${entry.path}`}
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
          {rows && rows !== "none" && (
            <Comparison
              before={rows.before}
              after={rows.after}
              look={look}
              script={isScriptPath(entry.path)}
              scriptPage={scriptPage}
              label={`${baseOf(entry.path)}, with its changes marked`}
            />
          )}
        </div>
      )}
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
}: {
  path: string;
  open: boolean;
  onToggle: () => void;
  loadOther: ChangesViewProps["loadOther"];
  onKeepOther: ChangesViewProps["onKeepOther"];
  onTrashOther: ChangesViewProps["onTrashOther"];
  look: ChangesLook;
  scriptPage?: ScriptPage;
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
                scriptPage={scriptPage}
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
