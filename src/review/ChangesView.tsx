// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Changes surface — what arrived in this folder from somewhere else, as
 * something you can read, keep, or undo.
 *
 * An entry's `note` is always absent now (the inbound note channel went with
 * the chat panel). Where an older entry still carries one it is rendered as PLAIN
 * TEXT — a text node, never markup, never a link — because it was written by
 * something other than the app.
 */
import { useEffect, useState } from "react";
import { compactDiff, diffLines, type DiffLine } from "./diff";
import { Alert, Button, RevertIcon } from "../ui";
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
}

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
}: ChangesViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Keep the relative times honest without a render loop.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const pending = entries
    .filter((e) => e.status === "pending")
    .slice()
    .reverse();
  const settled = entries
    .filter((e) => e.status !== "pending")
    .slice()
    .reverse()
    .slice(0, 20);

  if (
    entries.length === 0 &&
    otherVersions.length === 0 &&
    savedCopies.length === 0 &&
    !savedCopiesError &&
    !recoveryCopies?.copies.length &&
    !recoveryCopies?.error
  ) {
    return (
      <div className="changes changes--empty">
        <div className="emptysurface">
          <span className="emptysurface__glyph">
            <RevertIcon size={22} />
          </span>
          <p className="emptysurface__title">Nothing has changed somewhere else</p>
          <p className="emptysurface__body">
            When another device or another editor writes here, it lands live and shows up in this
            list with a way back.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="changes">
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
        />
      ))}
      {pending.length > 0 && <h3 className="changes__group">Needs a look</h3>}
      {pending.map((e) => (
        <ChangeRow
          key={e.id}
          entry={e}
          now={now}
          open={openId === e.id}
          onToggle={() => setOpenId(openId === e.id ? null : e.id)}
          loadDiff={loadDiff}
          onKeep={onKeep}
          onRevert={onRevert}
        />
      ))}
      {settled.length > 0 && <h3 className="changes__group">Earlier</h3>}
      {settled.map((e) => (
        <ChangeRow
          key={e.id}
          entry={e}
          now={now}
          open={openId === e.id}
          onToggle={() => setOpenId(openId === e.id ? null : e.id)}
          loadDiff={loadDiff}
          onKeep={onKeep}
          onRevert={onRevert}
        />
      ))}
    </div>
  );
}

interface RowProps {
  entry: LedgerEntry;
  now: number;
  open: boolean;
  onToggle: () => void;
  loadDiff: ChangesViewProps["loadDiff"];
  onKeep: ChangesViewProps["onKeep"];
  onRevert: ChangesViewProps["onRevert"];
}

function ChangeRow({ entry, now, open, onToggle, loadDiff, onKeep, onRevert }: RowProps) {
  const [rows, setRows] = useState<(DiffLine | { kind: "skip"; count: number })[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* Revert REWRITES the script and cannot be walked back from the Finder, so
     it is one of the two actions that still ask (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). */
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open || rows || loadError) return;
    let dead = false;
    void loadDiff(entry.id)
      .then((d) => {
        if (dead) return;
        setRows(d ? compactDiff(diffLines(d.before, d.after)) : []);
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
          : rows.length
            ? `Comparison ready for ${entry.path}.`
            : `No comparison available for ${entry.path}.`,
  );

  const pending = entry.status === "pending";

  return (
    <section className={`change change--${entry.status}`}>
      <header className="change__head">
        <button className="change__summary" onClick={onToggle} aria-expanded={open}>
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
          className="change__diff"
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
          {rows?.length === 0 && (
            <p className="changes__hint">
              No diff available — there is no record of what this file held before.
            </p>
          )}
          {rows?.map((r, i) =>
            r.kind === "skip" ? (
              <div key={i} className="diffline diffline--skip">
                ⋯ {r.count} unchanged lines
              </div>
            ) : (
              <div key={i} className={`diffline diffline--${r.kind}`}>
                {r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "} {r.text}
              </div>
            ),
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
}: {
  path: string;
  open: boolean;
  onToggle: () => void;
  loadOther: ChangesViewProps["loadOther"];
  onKeepOther: ChangesViewProps["onKeepOther"];
  onTrashOther: ChangesViewProps["onTrashOther"];
}) {
  const [rows, setRows] = useState<(DiffLine | { kind: "skip"; count: number })[] | null>(null);
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
        setRows(d ? compactDiff(diffLines(d.ours, d.theirs)) : []);
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
          : rows.length
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
          {rows?.length === 0 && <p className="change__nobase">This one could not be read.</p>}
          {rows && rows.length > 0 && (
            <div
              className="diffview__diff change__diff"
              tabIndex={0}
              role="region"
              aria-label={`How the copy differs from ${path}`}
            >
              {rows.map((r, i) =>
                r.kind === "skip" ? (
                  <div key={i} className="diffline diffline--skip">
                    ⋯ {r.count} unchanged
                  </div>
                ) : (
                  <div key={i} className={`diffline diffline--${r.kind}`}>
                    {/* The mark the ledger's rows already carry, so a change is never told by colour alone. */}
                    {r.kind === "add" ? "+" : r.kind === "del" ? "−" : " "}{" "}
                    {r.kind === "add" && <span className="sr-only">Added: </span>}
                    {r.kind === "del" && <span className="sr-only">Removed: </span>}
                    {r.text}
                  </div>
                ),
              )}
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
