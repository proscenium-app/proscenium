// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The plays picker (docs/engineering/design-system.md#UI-D101) — every play in the vault as one row
 * of a ledger, not a tile wall.
 *
 * The New Play control is a pull-down now, because "start a play" has more
 * than one answer and the rest used to have nowhere to live: from a draft you
 * already have (docs/app/importing/document-import.md#IMPT-D5 — every playwright who tries this has one somewhere
 * else), and the sample play that makes the editor's premise visible inside
 * forty seconds (docs/app/keeping-work/storage-and-file-format.md#STOR-135).
 *
 * A Plays folder with no plays in it, whose own folders hold some, was most
 * likely chosen one level too high (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). The screen says so, offers
 * those folders, and offers the sample play only once that is answered: the
 * sample play went into such a folder on 2026-09-13, from this screen.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayPages, PlaysFolderHint, VaultPlay } from "../workspace";
import type { KeptFile } from "./useWorkspace";
import { SAMPLE_PLAY, SAMPLE_PLAY_TITLE } from "../workspace/sample-play";
import { useAnnouncedStatus } from "../ui/use-announced-status";
import { announce, Button, PopupButton, PullDownButton, SearchIcon, type PopupOption } from "../ui";
import { useSettings } from "./settings";
import { usePlayPages } from "./use-play-pages";

export interface VaultScreenProps {
  tutorialInvitation?: React.ReactNode;
  vaultRoot: string;
  /** Where the plays live, in one sentence (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). */
  wherePlaysLive?: string;
  plays: VaultPlay[];
  /** The Plays folder looks chosen one level too high: what to say and offer. */
  hint: PlaysFolderHint | null;
  /** Still finding out whether to ask; the sample play is not offered meanwhile. */
  lookingBelow: boolean;
  /** Make a folder inside this one the Plays folder; resolves to whether it opened. */
  onUseFolder: (dir: string) => Promise<boolean>;
  /** Keep this folder as the Plays folder, plays or not. */
  onKeepFolder: () => void;
  onOpen: (play: VaultPlay) => void;
  /** `script` seeds the new play's one .fountain from a draft the writer
   *  already has; `keep` is the file to keep beside it — an `.fdx` a play was
   *  made from (docs/app/keeping-work/storage-and-file-format.md#STOR-148). */
  onCreate: (title: string, script?: string, keep?: KeptFile) => void;
  /** Edit a play's status / logline in place (writes project.json). */
  onUpdate: (dir: string, patch: { status?: string; logline?: string }) => void;
  onImport: (files?: File[]) => void;
  /** Counts File › New Play… (⌘N) from the shell: each new count names a blank play, as the New Play button does. */
  newPlayAsk?: number;
}

/**
 * The statuses a play can be given: the list in Settings › General, in its order
 * (docs/app/preferences-and-help/settings.md#SET-7; it was fixed here). A play whose word is not in the list — one
 * renamed or deleted there, or set by hand — keeps it, and it is offered too,
 * rather than dropped by the control that shows it.
 */
function statusOptions(statuses: readonly string[], current?: string): PopupOption<string>[] {
  const options: PopupOption<string>[] = [
    { value: "", label: "No Status" },
    ...statuses.map((s) => ({ value: s, label: s })),
  ];
  if (current && !statuses.includes(current)) options.push({ value: current, label: current });
  return options;
}

/**
 * A play's length in pages (docs/app/keeping-work/storage-and-file-format.md#STOR-121), or a dash that says why not: still
 * being counted, a format this Mac does not have, or nothing to count.
 */
function PagesCell({ pages }: { pages: PlayPages | undefined }) {
  if (pages?.kind === "pages") {
    return <span>{pages.pages === 1 ? "1 page" : `${pages.pages} pages`}</span>;
  }
  const why = !pages
    ? "Counting pages"
    : pages.kind === "no-format"
      ? `Not counted: the format “${pages.format}” is not on this Mac`
      : "Not counted";
  return (
    <>
      <span aria-hidden="true" title={pages ? why : undefined}>
        —
      </span>
      <span className="sr-only">{why}</span>
    </>
  );
}

function vaultName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

function modifiedLabel(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  // Same-day drafts differ by hours, not days, so today says so.
  if (sameDay) {
    return `Today, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One ledger row: the whole row opens the play; status and logline edit here. */
function PlayRow({
  play,
  statuses,
  pages,
  showProgress,
  onOpen,
  onUpdate,
}: {
  play: VaultPlay;
  statuses: readonly string[];
  pages: PlayPages | undefined;
  showProgress: boolean;
  onOpen: () => void;
  onUpdate: (dir: string, patch: { status?: string; logline?: string }) => void;
}) {
  const [logline, setLogline] = useState(play.logline ?? "");
  const options = statusOptions(statuses, play.status);

  const commitLogline = () => {
    const next = logline.trim();
    if (next !== (play.logline ?? "")) onUpdate(play.dir, { logline: next });
  };

  /**
   * The WHOLE row opens the play, not just the title.
   *
   * The row lights up on hover and turns the title accent-coloured, so it
   * advertises itself as one click target — but only the title text was one: a
   * 142×17px button inside a 685×60px row. Clicks on the obvious places did
   * nothing, and the natural response is to click again, which is exactly why
   * picker rows seemed to need a second click.
   */
  const openFromRow = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input, select, button, textarea, a")) return;
    onOpen();
  };

  return (
    /* A table row is made of CELLS. Every column here was a bare child of the
       `row`, so VoiceOver's table navigation found rows with nothing in them
       and read the plays list as four headers over empty lines. */
    <div className="playrow playrow--play" role="row" onClick={openFromRow}>
      <div className="playrow__main" role="cell">
        <button className="playrow__title playrow__open" onClick={onOpen}>
          {play.title}
        </button>
        <input
          className="playrow__logline"
          value={logline}
          placeholder="Add a logline…"
          aria-label={`Logline for ${play.title}`}
          onChange={(e) => setLogline(e.target.value)}
          onBlur={commitLogline}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setLogline(play.logline ?? "");
          }}
        />
      </div>
      {/* Pages, counted behind the rows (use-play-pages.ts): a dash until a
          count arrives, never a false 0. Off in Settings, the cell goes with
          its header, so the rows still read as a table. */}
      {showProgress && (
        <span className="playrow__progress" role="cell">
          <PagesCell pages={pages} />
        </span>
      )}
      <span className="playrow__status" role="cell">
        <PopupButton
          size="mini"
          label={`Status for ${play.title}`}
          options={options}
          value={play.status ?? ""}
          onChange={(v) => onUpdate(play.dir, { status: v })}
          menuWidth={150}
        />
      </span>
      <span className="playrow__modified" role="cell">
        {modifiedLabel(play.modified)}
      </span>
    </div>
  );
}

export function VaultScreen({
  vaultRoot,
  wherePlaysLive,
  plays,
  hint,
  lookingBelow,
  onUseFolder,
  onKeepFolder,
  onOpen,
  onCreate,
  onUpdate,
  onImport,
  tutorialInvitation,
  newPlayAsk = 0,
}: VaultScreenProps) {
  const { playStatuses, showProgress } = useSettings();
  // Nothing is counted while Progress is off.
  const pages = usePlayPages(plays, showProgress);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [naming, setNaming] = useState<null | "blank">(null);
  const [title, setTitle] = useState("");
  const [dropping, setDropping] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const asking = plays.length === 0 && hint !== null;
  const summary =
    plays.length === 0
      ? "No plays here yet — start one, or drop a draft you already have."
      : `${plays.length} play${plays.length === 1 ? "" : "s"} · ${vaultName(vaultRoot)}`;

  // The question arrives with the screen, which nothing focuses, so it is said.
  useEffect(() => {
    if (asking && hint) announce(hint.sentence);
  }, [asking, hint?.sentence]);

  /*
   * Answering removes the button that had focus. Once the screen has settled —
   * the other folder's plays listed, or this folder kept — focus goes to the
   * heading rather than <body>, and what the screen now says is said. The
   * folder used may ask a question of its own, which says itself. An answer
   * that did not go through (refused, or the panel cancelled) changes nothing,
   * and leaves nothing waiting to move focus later.
   */
  const answeredRef = useRef(false);
  const answer = (act: () => Promise<boolean> | void) => {
    answeredRef.current = true;
    void Promise.resolve(act()).then((went) => {
      if (went === false) answeredRef.current = false;
    });
  };
  useEffect(() => {
    if (!answeredRef.current || lookingBelow) return;
    answeredRef.current = false;
    if (!document.activeElement || document.activeElement === document.body) {
      headingRef.current?.focus();
    }
    if (!asking) announce(summary);
  }, [asking, lookingBelow, summary]);

  // The sample play waits for the question too, here as on the empty screen.
  const sampleWaits = asking || lookingBelow;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plays;
    return plays.filter(
      (p) => p.title.toLowerCase().includes(q) || (p.logline ?? "").toLowerCase().includes(q),
    );
  }, [plays, query]);
  useAnnouncedStatus(
    searched
      ? shown.length === 0
        ? "No plays match your search."
        : `${shown.length} ${shown.length === 1 ? "play" : "plays"}${query.trim() ? " match your search" : " in this folder"}.`
      : null,
  );

  /** The control New Play started from, so Escape can go back to it rather than lose the keyboard's place. */
  const namingFrom = useRef<HTMLElement | null>(null);
  const startNaming = (mode: "blank") => {
    namingFrom.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setNaming(mode);
  };
  const cancelName = () => {
    setTitle("");
    setNaming(null);
    namingFrom.current?.focus();
    namingFrom.current = null;
  };
  /* File › New Play… and ⌘N reach this screen as a count from the shell: the
     menu bar takes the accelerator before the window sees it, and the shell
     answers the item. Each new count names a blank play exactly as the New
     Play button does. The button's menu said "Blank Play ⌘N" while ⌘N did
     nothing here. */
  const asked = useRef(newPlayAsk);
  useEffect(() => {
    if (newPlayAsk === asked.current) return;
    asked.current = newPlayAsk;
    startNaming("blank");
  }, [newPlayAsk]);
  const submitName = () => {
    const t = title.trim();
    const mode = naming;
    setTitle("");
    setNaming(null);
    if (t && mode) onCreate(t);
  };

  /**
   * A .fountain or .fdx becomes a play, named after the draft's own title. An
   * .fdx is kept beside the script it became — the same story as
   * opening one from Finder (docs/app/keeping-work/storage-and-file-format.md#STOR-148).
   */

  return (
    <div
      className={`vault-screen${dropping ? " is-dropping" : ""}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDropping(false);
        onImport(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="vault-screen__bar" data-tauri-drag-region="deep">
        <h1 className="vault-screen__vault">{vaultName(vaultRoot)}</h1>
        <span className="vault-screen__spacer" />
        <label className="field field--search vault-screen__search">
          <SearchIcon size={12} />
          <input
            value={query}
            placeholder="Search plays"
            aria-label="Search plays"
            onChange={(e) => {
              setSearched(true);
              setQuery(e.target.value);
            }}
          />
        </label>
        <PullDownButton
          treatment="primary"
          label="New Play"
          menuWidth={236}
          align="end"
          onPrimary={() => startNaming("blank")}
          entries={[
            { label: "Blank Play", shortcut: "⌘N", onSelect: () => startNaming("blank") },
            {
              label: "Import a Draft…",
              onSelect: () => onImport(),
            },
            { kind: "sep" },
            {
              label: "Open the Sample Play",
              disabled: sampleWaits,
              onSelect: () => onCreate(SAMPLE_PLAY_TITLE, SAMPLE_PLAY),
            },
          ]}
        />
        <Button onClick={() => onImport()}>Import a Draft…</Button>
      </header>

      <div className="vault-screen__inner">
        {tutorialInvitation}
        <header className="vault-screen__head">
          <h2 className="vault-screen__title" ref={headingRef} tabIndex={-1}>
            Plays
          </h2>
          {asking && hint ? (
            /* In place of "start one": where the plays look to be, and the
               folders to use instead, most plays first. */
            <div className="vault-screen__ask" role="group" aria-labelledby="vault-screen-ask">
              <p className="vault-screen__asktext" id="vault-screen-ask">
                {hint.sentence}
              </p>
              <div className="vault-screen__askactions">
                {hint.folders.map((f, i) => (
                  <Button
                    key={f.dir}
                    treatment={i === 0 ? "primary" : "default"}
                    onClick={() => answer(() => onUseFolder(f.dir))}
                  >
                    Use “{f.dir}”
                  </Button>
                ))}
                <Button onClick={() => answer(onKeepFolder)}>Keep This Folder</Button>
              </div>
            </div>
          ) : (
            <p className="vault-screen__sub">{summary}</p>
          )}
          {/* The sentence that must exist when it is the last one: plays on
              this Mac alone should never be learned about from a backup the
              writer did not have (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). */}
          {wherePlaysLive && <p className="vault-screen__where">{wherePlaysLive}</p>}
        </header>

        <div
          className={`vault-list${showProgress ? "" : " vault-list--noprogress"}`}
          role="table"
          aria-label="Plays"
        >
          <div className="playrow playrow--head" role="row">
            <span role="columnheader">Play</span>
            {showProgress && <span role="columnheader">Progress</span>}
            <span role="columnheader">Status</span>
            <span role="columnheader">Modified</span>
          </div>
          {shown.map((p) => (
            <PlayRow
              key={p.dir}
              play={p}
              statuses={playStatuses}
              pages={pages.get(p.dir)}
              showProgress={showProgress}
              onOpen={() => onOpen(p)}
              onUpdate={onUpdate}
            />
          ))}
          {shown.length === 0 && plays.length > 0 && (
            <div className="playrow playrow--empty" role="row">
              <span role="cell">No play matches “{query}”.</span>
            </div>
          )}
          {/* The naming row sits at the BOTTOM of the table, where the new play
              will appear, rather than in a dialog over the list it joins. */}
          {naming && (
            <div className="playrow playrow--naming" role="row">
              <span className="playrow__namingcell" role="cell">
                <input
                  className="playrow__input"
                  placeholder="Title of the play…"
                  aria-label="Title of the new play"
                  aria-describedby="playrow-naming-hint"
                  value={title}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitName();
                    if (e.key === "Escape") cancelName();
                  }}
                  onBlur={submitName}
                />
                <span className="playrow__hint" id="playrow-naming-hint">
                  Return to create · Esc to cancel
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Only once it is settled that this folder is where the plays go:
            never while the folders inside it are still being looked into, and
            never beside the question above. */}
        {plays.length === 0 && !naming && !sampleWaits && (
          <div className="vault-screen__firstrun">
            <Button onClick={() => onCreate(SAMPLE_PLAY_TITLE, SAMPLE_PLAY)}>
              Open the Sample Play
            </Button>
            <span className="sheet__hint">
              Two acts, four characters, and every element the editor knows.
            </span>
          </div>
        )}
      </div>

      {dropping && (
        <div className="vault-screen__dropnote">Drop your draft to review and import it</div>
      )}
    </div>
  );
}
