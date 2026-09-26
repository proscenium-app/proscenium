// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Versions, with pull-backs (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). Lists the open
 * script's snapshot ring newest-first; selecting an entry previews its text;
 * Restore replaces the script through the guarded apply path (the current
 * state is snapshotted first, so a restore is itself reversible).
 *
 * It also **reads the change between two drafts**, which is the question a
 * writer actually has of their history: not "what did the script say in March"
 * but "what have I changed since the draft I sent the theatre". The snapshots
 * were already there and the Changes view already had a line differ for its
 * versions, so this points the one at the other rather than inventing a second
 * notion of "which draft is this" — no revision marks, no second source of
 * truth about what is current.
 */
import { useEffect, useMemo, useState } from "react";
import { compactDiff, diffLines } from "../review/diff";
import type { VersionEntry } from "../storage";
import { Alert, Button, PopupButton, RevertIcon, Segmented, Sheet } from "../ui";
import { useAnnouncedStatus } from "../ui/use-announced-status";

export interface HistoryPanelProps {
  scriptTitle: string;
  listVersions: () => Promise<VersionEntry[]>;
  readVersion: (name: string) => Promise<string>;
  restoreVersion: (name: string) => Promise<boolean>;
  /** The script as it stands right now — the default thing to compare against. */
  currentScriptText: () => string;
  onClose: () => void;
}

/** `""` means "the script as it stands"; otherwise a snapshot's name. */
const NOW = "";

const REASON_LABEL: Record<string, string> = {
  save: "while writing",
  "pre-reload": "before a change arrived",
  "pre-reload-at-banner": "before using the other version",
  "pre-keep": "before keeping this one",
  "pre-restore": "before a restore",
  // The one that could not be written. It is the only surviving copy of what
  // the buffer held, which is why the ring never prunes it (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
  collision: "couldn't be saved — kept here",
  "pre-apply": "before words were put back",
  // Words a crash left in a recovery snapshot, kept whether or not the writer
  // took them back — pinned like a collision (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
  recovery: "from before Proscenium closed",
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function HistoryPanel(props: HistoryPanelProps) {
  const [entries, setEntries] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  /** Off: the version's own text. On: what changed between it and `against`. */
  const [comparing, setComparing] = useState(false);
  const [against, setAgainst] = useState<string>(NOW);
  const [againstText, setAgainstText] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    props
      .listVersions()
      .then((list) => {
        if (!alive) return;
        setEntries(list);
        if (list.length) setSelected(list[0].name);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [props.listVersions]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setPreview(null);
    setConfirming(false);
    props
      .readVersion(selected)
      .then((text) => alive && setPreview(text))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [selected, props.readVersion]);

  // The other side of the comparison. "Now" is read straight from the live
  // buffer, so a diff includes edits that have not been snapshotted yet.
  useEffect(() => {
    if (!comparing) return;
    if (against === NOW) {
      setAgainstText(props.currentScriptText());
      return;
    }
    let alive = true;
    setAgainstText(null);
    props
      .readVersion(against)
      .then((text) => alive && setAgainstText(text))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [comparing, against, props.readVersion, props.currentScriptText]);

  // before = the version you selected, after = what you are comparing it with,
  // so the diff always reads as "what happened after this draft".
  const diff = useMemo(() => {
    if (!comparing || preview === null || againstText === null) return null;
    const rows = compactDiff(diffLines(preview, againstText));
    return {
      rows,
      added: rows.filter((r) => r.kind === "add").length,
      removed: rows.filter((r) => r.kind === "del").length,
    };
  }, [comparing, preview, againstText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  // Group by day for scannability; entries stay newest-first inside groups.
  const groups = useMemo(() => {
    const out: { day: string; items: VersionEntry[] }[] = [];
    for (const e of entries ?? []) {
      const day = dayLabel(e.ts);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [entries]);

  const restore = async () => {
    if (!selected) return;
    setRestoring(true);
    const ok = await props.restoreVersion(selected);
    setRestoring(false);
    if (ok) props.onClose();
  };

  const chosen = (entries ?? []).find((e) => e.name === selected);
  const loading =
    !error &&
    (entries === null || (!!selected && preview === null) || (comparing && againstText === null));
  useAnnouncedStatus(
    error
      ? `Could not read versions. ${error}`
      : loading
        ? "Reading versions…"
        : !entries?.length
          ? "No saved versions yet."
          : diff
            ? `Comparison ready. ${diff.added} lines added and ${diff.removed} removed.`
            : chosen
              ? `Version ready: ${dayLabel(chosen.ts)}, ${timeLabel(chosen.ts)}.`
              : null,
  );

  return (
    <>
      <Sheet
        title="Versions"
        subtitle={props.scriptTitle}
        width={760}
        height={520}
        onClose={props.onClose}
        head={
          <>
            <span className="sheet__spacer" />
            <span className="sheet__hint">
              Snapshots every ~5 min of writing, and before anything replaces it.
            </span>
          </>
        }
        footer={
          <>
            <span className="sheet__hint">
              Restoring snapshots the current state first — nothing is lost.
            </span>
            <span className="sheet__spacer" />
            <Button onClick={props.onClose}>Close</Button>
            <Button
              treatment="primary"
              disabled={!selected || !preview}
              onClick={() => setConfirming(true)}
            >
              Restore…
            </Button>
          </>
        }
      >
        {error && <p className="historypanel__error">{error}</p>}
        {entries !== null && entries.length === 0 && (
          <div className="emptysurface">
            <span className="emptysurface__glyph">
              <RevertIcon size={22} />
            </span>
            <p className="emptysurface__title">No versions yet</p>
            <p className="emptysurface__body">
              Snapshots are taken as you write — about every five minutes of activity — and before
              anything replaces what is here.
            </p>
          </div>
        )}
        {entries === null && !error && <p className="historypanel__loading">Loading…</p>}
        {entries !== null && entries.length > 0 && (
          <div className="historypanel__body" aria-busy={loading}>
            {/* One tab stop, ↑↓ Home End move the selection (docs/app/preferences-and-help/accessibility.md#A11Y-6):
                a listbox whose every option is a tab stop is a list you Tab
                through. Each option says its day, so two "10:14 · Save" on
                different days read apart. */}
            <div
              className="historypanel__list"
              role="listbox"
              aria-label="Versions"
              onKeyDown={(ev) => {
                const order = groups.flatMap((g) => g.items.map((e) => e.name));
                if (!order.length) return;
                const at = order.indexOf(selected ?? "");
                let next: number | null = null;
                if (ev.key === "ArrowDown") next = Math.min(order.length - 1, at + 1);
                else if (ev.key === "ArrowUp") next = Math.max(0, at - 1);
                else if (ev.key === "Home") next = 0;
                else if (ev.key === "End") next = order.length - 1;
                if (next === null) return;
                ev.preventDefault();
                setSelected(order[next]!);
                ev.currentTarget
                  .querySelector<HTMLElement>(`[data-version="${CSS.escape(order[next]!)}"]`)
                  ?.focus();
              }}
            >
              {groups.map((g) => (
                <div key={g.day}>
                  <div className="historypanel__day seclabel">{g.day}</div>
                  {g.items.map((e) => (
                    <button
                      key={e.name}
                      role="option"
                      data-version={e.name}
                      tabIndex={e.name === (selected ?? groups[0]?.items[0]?.name) ? 0 : -1}
                      aria-selected={e.name === selected}
                      aria-label={`${g.day}, ${timeLabel(e.ts)}, ${REASON_LABEL[e.reason] ?? e.reason}`}
                      className={`historypanel__row${e.name === selected ? " is-selected" : ""}`}
                      onClick={() => setSelected(e.name)}
                    >
                      <span className="historypanel__time">{timeLabel(e.ts)}</span>
                      <span className="historypanel__reason">
                        {REASON_LABEL[e.reason] ?? e.reason}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="historypanel__pane">
              <div className="historypanel__panehead">
                {/* Text / What Changed is a segmented control, not a toggle
                    button: they are two views of one thing, not a switch. */}
                <Segmented
                  size="small"
                  label="How to show this version"
                  value={comparing ? "diff" : "text"}
                  onChange={(v) => setComparing(v === "diff")}
                  options={[
                    { id: "text", label: "Text" },
                    { id: "diff", label: "What Changed" },
                  ]}
                />
                {comparing && (
                  <>
                    <span className="historypanel__vs">compared with</span>
                    <PopupButton
                      label="Compare against"
                      menuWidth={260}
                      value={against}
                      onChange={setAgainst}
                      options={[
                        { value: NOW, label: "as it stands now" },
                        ...(entries ?? [])
                          .filter((e) => e.name !== selected)
                          .map((e) => ({
                            value: e.name,
                            label: `${dayLabel(e.ts)} ${timeLabel(e.ts)}`,
                          })),
                      ]}
                    />
                    <span className="sheet__spacer" />
                    {diff && (
                      <span className="diffview__stats">
                        +{diff.added} −{diff.removed}
                      </span>
                    )}
                  </>
                )}
              </div>
              {comparing ? (
                diff === null ? (
                  <p className="historypanel__loading">Loading…</p>
                ) : diff.added === 0 && diff.removed === 0 ? (
                  <p className="historypanel__loading">
                    Nothing changed between these two — the text is identical.
                  </p>
                ) : (
                  <div
                    className="diffview__diff historypanel__diff"
                    tabIndex={0}
                    role="region"
                    aria-label="What changed since this version"
                  >
                    {diff.rows.map((row, i) =>
                      row.kind === "skip" ? (
                        <div key={i} className="diffview__skip">
                          ⋯ {row.count} unchanged lines ⋯
                        </div>
                      ) : (
                        <div key={i} className={`diffview__line diffview__line--${row.kind}`}>
                          {/* A mark and a word, not only a colour (docs/engineering/cross-platform.md#PLAT-57). */}
                          {row.kind === "add" ? (
                            <>
                              <span aria-hidden="true">+ </span>
                              <span className="sr-only">Added: </span>
                            </>
                          ) : row.kind === "del" ? (
                            <>
                              <span aria-hidden="true">− </span>
                              <span className="sr-only">Removed: </span>
                            </>
                          ) : (
                            <span aria-hidden="true">{"  "}</span>
                          )}
                          {row.text || " "}
                        </div>
                      ),
                    )}
                  </div>
                )
              ) : (
                /* Focusable, so a version too long for the pane can be read
                   by scrolling it from the keyboard (WCAG 2.1.1). */
                <pre
                  className="historypanel__preview"
                  tabIndex={0}
                  role="region"
                  aria-label="The text of this version"
                >
                  {preview ?? "Loading…"}
                </pre>
              )}
            </div>
          </div>
        )}
      </Sheet>
      {/* Restore REWRITES the script and cannot be walked back from the Finder,
          so it is one of the two actions that still get an alert (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). */}
      {confirming && (
        <Alert
          title={`Replace ${props.scriptTitle ? `“${props.scriptTitle}”` : "it"} with the ${
            chosen ? timeLabel(chosen.ts) : "chosen"
          } version?`}
          body="The current text is kept as a version first, so this can be undone."
          confirmLabel={restoring ? "Restoring…" : "Restore"}
          onConfirm={() => void restore()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
