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
 *
 * A Plays folder still coming down from iCloud is not an empty one
 * (docs/engineering/cross-platform.md#PLAT-69). On an iPad that had not
 * downloaded it, this screen said "No plays here yet" over a folder of plays,
 * and offered the sample play into it. While the app's own download passes
 * find anything still on its way, the screen says it is downloading, each play
 * joins the list as it arrives, and nothing is offered until it is all down.
 */
import type { CloudState } from "../workspace/cloud-download";
import { dragRegion } from "../ui/system-traits";
import { moveToTrash, systemWords } from "../ui/system-words";
import { keys } from "../ui/keys";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlayPages, PlaysFolderHint, VaultPlay } from "../workspace";
import type { KeptFile, PlayOpResult } from "./useWorkspace";
import { PlayNameSheet } from "./PlayNameSheet";
import type { MenuEntry } from "../ui/Menu";
import { SAMPLE_PLAY, SAMPLE_PLAY_TITLE } from "../workspace/sample-play";
import { useAnnouncedStatus } from "../ui/use-announced-status";
import {
  announce,
  Button,
  EllipsisIcon,
  IconButton,
  Menu,
  PopupButton,
  PullDownButton,
  SearchIcon,
  useMenu,
  type PopupOption,
} from "../ui";
import { useSettings } from "./settings";
import { usePlayPages } from "./use-play-pages";
import { ownTrashDays } from "../storage/own-trash";
import type { TrashEntry } from "../storage/ipc";
import type { PutBackOutcome } from "../workspace/trash";
import { TrashSheet } from "./TrashSheet";
import { TrashPlayAsk } from "./TrashPlayAsk";
import { AS_TYPED } from "../ui/as-typed";

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
  /**
   * What is still coming down from iCloud into the Plays folder
   * (docs/engineering/cross-platform.md#PLAT-69): said on the screen, and
   * nothing is offered meanwhile.
   */
  cloud?: CloudState;
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
  /**
   * Put one thing back from Proscenium’s Trash, which this screen opens where
   * the system keeps no trash of its own (docs/engineering/cross-platform.md#PLAT-16).
   */
  onPutBack?: (entry: TrashEntry) => Promise<PutBackOutcome>;
  /**
   * Move a whole play to the trash, once the writer has said yes twice
   * (docs/app/organizing/workspace-model.md#WORK-91). Without it, a row
   * offers no More Actions.
   */
  onTrash?: (play: VaultPlay) => void;
  /**
   * Rename a play from its row (docs/app/keeping-work/storage-and-file-format.md#STOR-208);
   * `titleOfPlay` says whether its title page shows its name.
   */
  onRename?: (play: VaultPlay, name: string, title: boolean) => Promise<PlayOpResult>;
  titleOfPlay?: (dir: string) => Promise<{ title: string | null; isName: boolean }>;
  /** Copy a play, and open the copy (docs/app/keeping-work/storage-and-file-format.md#STOR-197). */
  onDuplicate?: (play: VaultPlay, name: string) => Promise<PlayOpResult>;
  /** A new play with this one's setup (docs/app/keeping-work/storage-and-file-format.md#STOR-198). */
  onNewLike?: (play: VaultPlay, name: string) => Promise<PlayOpResult>;
  /** The whole play as one .zip (docs/app/keeping-work/storage-and-file-format.md#STOR-199). */
  onExportPlay?: (play: VaultPlay) => void;
  /** A play from a .zip, added to the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-200). */
  onAddZip?: (file: File) => void;
}

/** What a row's name sheet is asking for, and of which play. */
type NameAsk =
  | { kind: "rename"; play: VaultPlay; titleAsk: string | null }
  | { kind: "duplicate"; play: VaultPlay }
  | { kind: "like"; play: VaultPlay };

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
      ? `Not counted: the format “${pages.format}” is not on this ${systemWords().machine}`
      : "Not counted";
  return (
    <>
      {/* Why, for a pointer's rest and a finger's tap (TouchTip); said to a
          screen reader beside it. */}
      <span
        className="playrow__why"
        aria-hidden="true"
        title={pages ? why : undefined}
        data-news={pages ? true : undefined}
      >
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
  onTrash,
  actions = [],
}: {
  play: VaultPlay;
  statuses: readonly string[];
  pages: PlayPages | undefined;
  showProgress: boolean;
  onOpen: () => void;
  onUpdate: (dir: string, patch: { status?: string; logline?: string }) => void;
  /** Ask to move this play to the trash (docs/app/organizing/workspace-model.md#WORK-91). */
  onTrash?: () => void;
  /** What else the row's More Actions does, above Move to Trash (docs/app/organizing/workspace-model.md#WORK-94). */
  actions?: MenuEntry[];
}) {
  const entries: MenuEntry[] = [
    ...actions,
    ...(onTrash
      ? [
          ...(actions.length ? [{ kind: "sep" as const }] : []),
          { label: `${moveToTrash()}…`, destructive: true, onSelect: onTrash },
        ]
      : []),
  ];
  const [logline, setLogline] = useState(play.logline ?? "");
  const more = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();
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
    <>
      <div
        className="playrow playrow--play"
        role="row"
        onClick={openFromRow}
        onContextMenu={(e) => {
          // A field keeps the system's own menu (Copy, Paste, spelling).
          if (!entries.length || (e.target as HTMLElement).closest("input, textarea")) return;
          e.preventDefault();
          menu.openAt(e.clientX, e.clientY);
        }}
      >
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
          <span className="playrow__progress playrow__wide" role="cell">
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
        <span className="playrow__modified playrow__wide" role="cell">
          {modifiedLabel(play.modified)}
        </span>
        {entries.length > 0 && (
          <span className="playrow__more" role="cell">
            <IconButton
              ref={more}
              size="small"
              label={`More actions for “${play.title}”`}
              aria-haspopup="menu"
              aria-expanded={menu.open}
              onClick={() => menu.openFrom(more.current, "end")}
            >
              <EllipsisIcon size={13} />
            </IconButton>
          </span>
        )}
      </div>
      {/* Beside the row, not in it: a pick in the menu must not reach the
        row's click, which opens the play. */}
      {menu.anchor && entries.length > 0 && (
        <Menu
          anchor={menu.anchor}
          onClose={menu.close}
          label={play.title}
          width={240}
          entries={entries}
        />
      )}
    </>
  );
}

export function VaultScreen({
  vaultRoot,
  wherePlaysLive,
  plays,
  hint,
  lookingBelow,
  cloud,
  onUseFolder,
  onKeepFolder,
  onOpen,
  onCreate,
  onUpdate,
  onImport,
  tutorialInvitation,
  newPlayAsk = 0,
  onPutBack,
  onTrash,
  onRename,
  titleOfPlay,
  onDuplicate,
  onNewLike,
  onExportPlay,
  onAddZip,
}: VaultScreenProps) {
  const { playStatuses, showProgress } = useSettings();
  // Nothing is counted while Progress is off.
  const pages = usePlayPages(plays, showProgress);
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [naming, setNaming] = useState<null | "blank">(null);
  const [title, setTitle] = useState("");
  const [dropping, setDropping] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  /** The play whose move to the trash is being asked about. */
  const [trashing, setTrashing] = useState<VaultPlay | null>(null);
  /** The row whose rename, copy or new play is being named. */
  const [nameAsk, setNameAsk] = useState<NameAsk | null>(null);
  /** A play's .zip, chosen from New Play's menu (docs/app/keeping-work/storage-and-file-format.md#STOR-200). */
  const zipInput = useRef<HTMLInputElement | null>(null);
  const actionsFor = (p: VaultPlay): MenuEntry[] => [
    ...(onRename
      ? [
          {
            label: "Rename…",
            onSelect: () =>
              void (titleOfPlay?.(p.dir) ?? Promise.resolve({ title: null, isName: false })).then(
                (facts) =>
                  setNameAsk({
                    kind: "rename",
                    play: p,
                    titleAsk: facts.isName ? facts.title : null,
                  }),
              ),
          },
        ]
      : []),
    ...(onDuplicate
      ? [{ label: "Duplicate…", onSelect: () => setNameAsk({ kind: "duplicate", play: p }) }]
      : []),
    ...(onNewLike
      ? [{ label: "New Play Like This…", onSelect: () => setNameAsk({ kind: "like", play: p }) }]
      : []),
    ...(onExportPlay ? [{ label: "Export Play…", onSelect: () => onExportPlay(p) }] : []),
  ];
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const downloading = cloud?.downloading === true;
  const asking = plays.length === 0 && hint !== null && !downloading;
  const counted = `${plays.length} play${plays.length === 1 ? "" : "s"} · ${vaultName(vaultRoot)}`;
  // Still coming down is never "no plays here".
  const cloudSentence = !downloading
    ? null
    : plays.length === 0
      ? cloud?.slow
        ? "Still downloading your plays from iCloud Drive. Each one appears here as it arrives."
        : "Downloading your plays from iCloud Drive…"
      : cloud?.slow
        ? "Still downloading more plays from iCloud Drive."
        : "Downloading more plays from iCloud Drive…";
  const summary =
    plays.length === 0
      ? (cloudSentence ?? "No plays here yet — start one, or drop a draft you already have.")
      : counted;

  // A download nothing focuses is said, and so is its end. The end names no
  // count: the last plays are still being listed at that moment.
  const [downloaded, setDownloaded] = useState(false);
  const wasDownloading = useRef(false);
  useEffect(() => {
    if (wasDownloading.current && !downloading) setDownloaded(true);
    if (downloading) setDownloaded(false);
    wasDownloading.current = downloading;
  }, [downloading]);
  useAnnouncedStatus(
    cloudSentence ?? (downloaded ? "Your plays have downloaded from iCloud Drive." : null),
  );

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

  // The sample play waits for the question too, here as on the empty screen,
  // and for plays still coming down from iCloud, or not yet known not to be.
  const sampleWaits = asking || lookingBelow || downloading || cloud?.looking === true;

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
      <header className="vault-screen__bar" {...dragRegion(true)}>
        <h1 className="vault-screen__vault">{vaultName(vaultRoot)}</h1>
        <span className="vault-screen__spacer" />
        <label className="field field--search vault-screen__search">
          <SearchIcon size={12} />
          <input
            {...AS_TYPED}
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
            ...(onAddZip
              ? [{ label: "Add a Play from a .zip…", onSelect: () => zipInput.current?.click() }]
              : []),
            { kind: "sep" },
            {
              label: "Open the Sample Play",
              disabled: sampleWaits,
              onSelect: () => onCreate(SAMPLE_PLAY_TITLE, SAMPLE_PLAY),
            },
          ]}
        />
        {/* New Play's menu offers it too, which is all a narrow window keeps. */}
        <Button className="vault-screen__import" onClick={() => onImport()}>
          Import a Draft…
        </Button>
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
          {cloudSentence && plays.length > 0 && (
            <p className="vault-screen__cloud">{cloudSentence}</p>
          )}
          {/* The sentence that must exist when it is the last one: plays on
              this Mac alone should never be learned about from a backup the
              writer did not have (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). */}
          {wherePlaysLive && <p className="vault-screen__where">{wherePlaysLive}</p>}
        </header>

        <div
          className={`vault-list${showProgress ? "" : " vault-list--noprogress"}${onTrash ? " vault-list--actions" : ""}`}
          role="table"
          aria-label="Plays"
        >
          <div className="playrow playrow--head" role="row">
            <span role="columnheader">Play</span>
            {showProgress && (
              <span role="columnheader" className="playrow__wide">
                Progress
              </span>
            )}
            <span role="columnheader">Status</span>
            <span role="columnheader" className="playrow__wide">
              Modified
            </span>
            {onTrash && (
              <span role="columnheader">
                <span className="sr-only">Actions</span>
              </span>
            )}
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
              onTrash={onTrash ? () => setTrashing(p) : undefined}
              actions={actionsFor(p)}
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
                  {keys("Return")} to create · Esc to cancel
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
            <span className="sheet__hint">Scenes from Noël Coward's Hay Fever, in two acts.</span>
          </div>
        )}

        {/* Where the system keeps no trash of its own (an iPad), what is
            deleted on this device is kept in Proscenium’s Trash, and this is
            its door: the one screen whose folder every play is in, so anything
            in it can go back where it was (TrashSheet.tsx). */}
        {onPutBack && ownTrashDays() !== null && (
          <div className="vault-screen__trash">
            <Button onClick={() => setTrashOpen(true)}>{systemWords().trash}</Button>
          </div>
        )}
      </div>

      {trashOpen && onPutBack && (
        <TrashSheet plays={plays} onPutBack={onPutBack} onClose={() => setTrashOpen(false)} />
      )}

      {onAddZip && (
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          hidden
          aria-hidden="true"
          tabIndex={-1}
          data-play-zip=""
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onAddZip(file);
          }}
        />
      )}

      {nameAsk?.kind === "rename" && onRename && (
        <PlayNameSheet
          title="Rename Play"
          intro={`“${nameAsk.play.title}” and its play file take the new name.`}
          initial={nameAsk.play.dir}
          unchanged={nameAsk.play.dir}
          confirm="Rename"
          busyLabel="Renaming…"
          titleAsk={nameAsk.titleAsk}
          onSubmit={(name, title) => onRename(nameAsk.play, name, title)}
          onClose={() => setNameAsk(null)}
        />
      )}
      {nameAsk?.kind === "duplicate" && onDuplicate && (
        <PlayNameSheet
          title="Duplicate Play"
          intro={`A copy of “${nameAsk.play.title}”, every file of it, as a play of its own. It opens when it is made.`}
          initial={`${nameAsk.play.dir} copy`}
          confirm="Duplicate"
          busyLabel="Copying…"
          onSubmit={(name) => onDuplicate(nameAsk.play, name)}
          onClose={() => setNameAsk(null)}
        />
      )}
      {nameAsk?.kind === "like" && onNewLike && (
        <PlayNameSheet
          title="New Play Like This"
          intro={`A new play with the format, pages and folders of “${nameAsk.play.title}”, and none of its writing.`}
          initial=""
          confirm="Create Play"
          busyLabel="Creating…"
          onSubmit={(name) => onNewLike(nameAsk.play, name)}
          onClose={() => setNameAsk(null)}
        />
      )}

      {trashing && onTrash && (
        <TrashPlayAsk
          play={trashing}
          folder={vaultName(vaultRoot)}
          onCancel={() => setTrashing(null)}
          onTrash={() => {
            const play = trashing;
            setTrashing(null);
            onTrash(play);
          }}
        />
      )}

      {dropping && (
        <div className="vault-screen__dropnote">Drop your draft to review and import it</div>
      )}
    </div>
  );
}
