// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The workspace orchestrator: open the Plays folder → pick a play → read its
 * play file → render the binder → open a script → edit → autosave, with the
 * conflict floor live and binder edits mapped to disk.
 *
 * Two scopes, and the vault is reopened between them (docs/app/keeping-work/storage-and-file-format.md#STOR-D2, docs/app/keeping-work/storage-and-file-format.md#STOR-D3). On the
 * Plays screen the vault is the Plays folder and the app only ever lists it.
 * Inside a play the vault is that play's own folder, so every path the rest of
 * this file handles — binder entries, autosave, the watcher — is relative to
 * the play and needs no prefix. There is no sub-project layer any more.
 *
 * Mutable orchestration state lives in refs so the autosave/watcher callbacks
 * never see stale closures; React state drives rendering.
 */
import { settleWorkspaceDocuments, settleQuitDocuments, type ScriptSettlement as Settled, type WorkspaceSettlement } from "./workspace-transition";
import type { KeptFile } from "../storage/import-bytes";
import { useOutlineSession } from "./use-outline-session";
import { captureDocumentScope } from "./document-scope";
import { useMaterialSessions, type MaterialGate, type OpenMaterial } from "./use-material-sessions";
export type { MaterialGate, OpenMaterial } from "./use-material-sessions";
import { matchingPath } from "../storage/path-key";
import { flatten } from "../workspace/binder";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { revertReviewedFile } from "../review/revert";
import type { RawPlayDetails } from "./RawPlaySheet";
import { recoverBinderMoves } from "../workspace/binder-relocation";
import { reviewRecoveryFiles } from "../storage/recover-sessions";
import { BufferRecovery, type RecoveryBuffer } from "../storage/buffer-recovery";
import { canonicalLanguage, DEFAULT_PLAY_LANGUAGE } from "../workspace/language";
import { commentJumpTarget } from "../comments";
import { syncAppearances } from "../materials";
import {
  openChanges,
  recordExternalChange,
  computeMarks,
  emptyMarks,
  mergeMarks,
  touchedScenes,
  type ChangesStore,
  type LedgerEntry,
  type TrackedMarks,
} from "../review";
import {
  castFromBinder,
  ensureNonEmpty,
  fromEditorDoc,
  layoutPending,
  scrollPosIntoView,
  toEditorDoc,
} from "../editor";
import { recallCaret, rememberCaret } from "./caret-memory";
import { recallScript, rememberScript, scriptToOpen } from "./script-memory";
import { oneAtATime, type Line } from "./one-at-a-time";
import {
  addSceneToDoc,
  moveSceneInDoc,
  sameSceneOutline,
  parse,
  serialize,
  setSceneSynopsis,
  type CharacterEntry,
  type Doc,
  type FrontMatter,
} from "../fountain";
import type { FormatSpec } from "../format";
import { useFormatRegistry } from "./formats/use-formats";
import { settingsStore } from "./settings/store";
import {
  paginateDoc,
  scenePageMap,
  type LayoutMeta,
  type LayoutResult,
  type ScenePageMap,
} from "../layout";
import { pdfExported } from "../diagnostics";
import { revalidateFiles } from "../storage/revalidate";
import { watcherHealth } from "../storage/ipc";
import { copyPractice } from "../tutorial/copy-practice";
import { ulid } from "../workspace/ulid";
import { tutorials, type ExportFileType, type PracticeSource } from "../storage/ipc";
import { anonymousFrontMatter, anonymousMeta } from "../pdf/anonymous";
import { pageRangeLabel, type FrontSheet } from "../pdf/plan";
import { sidesDoc } from "../pdf/sides";
import {
  AutosaveScheduler,
  DEFAULT_AUTOSAVE,
  DocumentSession,
  KEPT_AT_QUIT,
  NO_FILE_YET,
  RecoverySnapshots,
  SnapshotPolicy,
  decodeKeptAtQuit,
  encodeKeptAtQuit,
  keptAtQuitMessage,
  onConflictCopy,
  onExternalChange,
  onOwnWrite,
  platform,
  playStore,
  recovery,
  sameScriptText,
  saveProblem,
  saveRefusal,
  settings,
  vault,
  VaultWriteError,
  versions,
  type KeptAtQuit,
  type SaveProblem,
  type SaveRefusal,
  type SaveSubject,
  type VersionEntry,
} from "../storage";
import type { QuitSettled } from "./quit";
import {
  allPlayFiles,
  commitPlay,
  computeAppearances,
  conflictOriginal,
  computeWeights,
  deleteItem,
  duplicateItem,
  detectNewSpeakers,
  discoverPlays,
  discoverPlaysBelow,
  ignoredFile,
  isPlayFileName,
  isReadOnly,
  playFileName,
  readPlayFile,
  resolvePlayFile,
  scriptDataFor,
  titleFromFileName,
  titleOf,
  withScriptData,
  moveItem,
  newFolder,
  newMaterial,
  newScript,
  playsFolderHint as hintFor,
  playsFolderRefusal,
  providerKind,
  samePath,
  wherePlaysLiveSentence,
  reconcileCards,
  reconcileBinder,
  toRecord,
  renameItem,
  reorderItem,
  reorderSceneCards,
  scaffoldPlayInVault,
  scaffoldPlayAt,
  updatePlayMeta,
  commitBinder,
  restoreBinderItem,
  locateBinderItem,
  type ApplyResult,
  type SceneAppearance,
  type SceneCard,
  type CharacterWeight,
  type BinderContext,
  type BinderItem,
  type BinderItemType,
  type Card,
  type FolderOfPlays,
  type Loaded,
  type PlayFile,
  type PlaysFolderHint,
  type ScriptData,
  type VaultPlay,
  type BufferLease,
  type MaterialBuffer,
  type ParkedWords,
} from "../workspace";

/**
 * The one status line. `unsaved`: the disk refused a save, and the words are
 * still waiting in the window (save-failure.ts) — said once in a toast, and
 * here for as long as it lasts.
 */
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "unsaved";

/**
 * Words a recovery snapshot held that never reached the script — offered when
 * the script opens, applied only if the writer chooses (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
 */
export interface RecoveryOffer {
  playId: string;
  owner: string;
  scriptId: string;
  /** The script's name, for the banner and the review. */
  title: string;
  /** The words as they were when the app stopped. */
  words: string;
  /** When they were captured, ISO-8601. */
  savedAt: string;
  /**
   * The pinned version already holding them, so Discard loses nothing; null
   * only when that version could not be written, in which case the snapshot
   * itself is held until the writer answers.
   */
  versionName: string | null;
}

/** The file as the app would write it — what a snapshot is compared against. */
function canonicalFountain(text: string): string {
  return serialize(parse(text));
}

/**
 * A file is there, as its folder lists it — which counts one whose bytes are
 * still in iCloud, where reading it fails and a bare `exists` says no. A folder
 * that cannot be listed says yes: when unsure, a file is there.
 */
async function isListed(path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  try {
    const entries = await vault.list(slash < 0 ? "" : path.slice(0, slash));
    return matchingPath(name, entries.map((e) => e.name)) !== undefined;
  } catch {
    return true;
  }
}

/** A file's last-modified time, from its directory listing; null when unknown. */
async function modifiedMsOf(path: string): Promise<number | null> {
  const slash = path.lastIndexOf("/");
  // Composed on both sides: a name the disk hands back decomposed is still this
  // file, and missing it would make every snapshot look newer than the script.
  const name = path.slice(slash + 1);
  try {
    const entries = await vault.list(slash < 0 ? "" : path.slice(0, slash));
    const match = matchingPath(name, entries.filter((e) => !e.isDir).map((e) => e.name));
    return entries.find((e) => e.name === match)?.modifiedMs ?? null;
  } catch {
    return null;
  }
}
/** What a trash returns: enough to phrase the toast, and the way back. */
/** An item just made in the binder, and whether the binder names it first (docs/app/preferences-and-help/accessibility.md#A11Y-4). */
export interface CreatedItem {
  id: string;
  /** Rename mode in the binder, then the page; false goes straight to the page. */
  name: boolean;
}
export interface TrashResult {
  title: string;
  /** Null for a folder, whose subtree is not held in memory to restore. */
  undo: (() => Promise<void>) | null;
}
export type ScriptView = "editor" | "corkboard" | "outliner" | "cast" | "changes";
/** Which screen the shell is showing: the vault's play picker, or one play. */
export type ShellMode = "picker" | "workspace";

function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

/** App-level (non-canonical) chrome preference: page view vs galley. */
const PAGE_VIEW_KEY = "proscenium:pageView";

/** Idle gap before the caret's position is written down (caret-memory.ts). */
const CARET_SAVE_MS = 600;
/** Long enough for an open to finish rendering before the place is re-asserted. */
const CARET_SETTLE_MS = 180;
/** The longest an open waits on a page relayout still due before it calls itself settled. */
const LAYOUT_PATIENCE_MS = 1000;

/** Calls `done` once the page layout has caught up with the document (pagination.ts). */
function whenLaidOut(editor: Editor, done: () => void): void {
  if (!layoutPending(editor.state)) {
    done();
    return;
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    editor.off("transaction", check);
    window.clearTimeout(late);
    done();
  };
  const check = () => {
    if (!layoutPending(editor.state)) finish();
  };
  editor.on("transaction", check);
  const late = window.setTimeout(finish, LAYOUT_PATIENCE_MS);
}

/**
 * Idle gap before character sheets' managed sections are refreshed. Slower than
 * autosave: nobody is reading a sheet this millisecond, and each write is a
 * file event in a watched tree.
 */
const APPEARANCES_DEBOUNCE_MS = 2000;

/**
 * A script's body as text, with the title page removed. Tracked-change marks
 * are expressed as block indexes, and the editor's block 0 is the first BODY
 * element — not `Title:`.
 */
function bodyTextOf(source: string): string {
  try {
    return serialize({ frontMatter: {}, doc: parse(source).doc });
  } catch {
    return source;
  }
}

/** Idle gap before an external file event triggers a binder walk. */
const RECONCILE_DEBOUNCE_MS = 1200;

/**
 * Run `fn` at most once per `delayMs`, scheduling on the FIRST call and letting
 * later ones ride along — a throttle, deliberately not a debounce.
 *
 * The distinction is load-bearing here. The character sheets are refreshed from
 * an effect whose dependencies (`cards`, `binder`) move constantly while the app
 * works: one autofile pass produces a new binder per material it files, and
 * every save produces new cards. A debounce clears its
 * timer on each of those, so under exactly the churn these features exist to
 * respond to, the timer is reset forever and the work never happens. That is
 * not a hypothetical — it is what the first build of this did.
 */
function scheduleThrottled(
  ref: { current: ReturnType<typeof setTimeout> | null },
  delayMs: number,
  fn: () => void,
): void {
  if (ref.current) return; // already scheduled; this change rides along
  ref.current = setTimeout(() => {
    ref.current = null;
    fn();
  }, delayMs);
}

/** What the Versions panel works on: a script, a sheet, or the outline note. */
export interface VersionsTarget {
  title: string;
  list: () => Promise<VersionEntry[]>;
  read: (name: string) => Promise<string>;
  restore: (name: string) => Promise<boolean>;
  /** The text as it stands right now, unsaved words included. */
  current: () => string;
}

/**
 * Is a change to this path worth showing the writer? The app's own file is
 * excluded — a list full of the app's bookkeeping is a list nobody reads —
 * and so is anything the binder itself would never show. What is left is the
 * writer's own work: scripts and prose.
 */
function isReviewable(relPath: string): boolean {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  if (isPlayFileName(name)) return false;
  if (ignoredFile(name)) return false;
  return /\.(fountain|md|markdown|txt)$/i.test(name);
}

/**
 * Could a change to this path change what the binder should hold?
 *
 * Anything the reconciler ignores cannot, and walking the whole tree for each
 * of them would mean a directory scan for every change that lands. Note what is
 * NOT excluded any more: `archive/` and `exports/` are ordinary folders since
 * 1.0, so a `.fountain` appearing in one really does belong in the binder
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-D3, docs/app/keeping-work/storage-and-file-format.md#STOR-D8).
 */
function affectsBinder(relPath: string): boolean {
  const name = relPath.slice(relPath.lastIndexOf("/") + 1);
  return !isPlayFileName(name) && !ignoredFile(name);
}

/** The binder item for a play-relative path, compared the way the Mac compares names. */
function findByPath(binder: BinderItem[], path: string): BinderItem | null {
  const rows = flatten(binder);
  const match = matchingPath(path, rows.map((item) => item.path));
  return rows.find((item) => item.path === match) ?? null;
}

/** A file to keep in a new play beside its script — the `.fdx` it was made from. */
export type { KeptFile } from "../storage/import-bytes";

function findById(binder: BinderItem[], id: string): BinderItem | null {
  for (const it of binder) {
    if (it.id === id) return it;
    if (it.children) {
      const found = findById(it.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** The row `id` is `target`, or a folder with `target` somewhere inside it. */
function holdsItem(binder: BinderItem[], id: string, target: string): boolean {
  const item = findById(binder, id);
  return item !== null && (item.id === target || findById(item.children ?? [], target) !== null);
}

export interface Workspace {
  /** Tutorial practice uses the same workspace and guarded writers, with a separate root. */
  practicing: boolean;
  startPractice: (title: string, script: string, resumeDir?: string, session?: string) => Promise<{id: string; dir: string; session?: string} | null>;
  keepPractice: (title: string) => Promise<{dir: string; base: string}>;
  openPracticeCopy: (copy: {dir: string; base: string}) => Promise<boolean>;
  canKeepPractice: boolean;
  stopPractice: () => Promise<boolean>;
  isPractice: (id: string) => boolean;
  browsePractice: () => Promise<boolean>;
  // vault of plays (picker screen)
  mode: ShellMode;
  /** The plays-vault root, when the open context came from one (else null). */
  vaultRoot: string | null;
  plays: VaultPlay[];
  /** Settles once the play is open, or back on the Plays screen if it could not be. */
  enterPlay: (play: VaultPlay) => Promise<void>;
  /**
   * The open play's script is read, laid out and scrolled to where the writer
   * left it — or there was none to read, or it could not be read. False from
   * the moment a play starts to close. Launch keeps the play covered until it.
   */
  playSettled: boolean;
  backToVault: () => void;
  /**
   * `script` seeds the new play's one .fountain — a draft, or the sample.
   * `keep` is written beside it: the `.fdx` it was made from.
   */
  createPlay: (title: string, script?: string, keep?: KeptFile) => void;
  /** The same, awaitable; resolves to whether the play was made and opened. */
  createPlayFrom: (title: string, script?: string, keep?: KeptFile) => Promise<boolean>;
  /** Open a play of the Plays folder by its folder's name, with a script in front. */
  /** `inFolder`: the Plays folder the play was found in, checked when its turn comes. */
  openPlayByDir: (dirName: string, script: string | null, inFolder?: string) => Promise<boolean>;
  /** Make a folder the Plays folder — asking for the grant when the app needs one. */
  adoptPlaysFolder: (path: string) => Promise<boolean>;
  /**
   * The Plays folder looks chosen one level too high: it holds no plays, and
   * folders inside it do (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). Null otherwise, and null once the
   * writer keeps the folder anyway.
   */
  playsFolderHint: PlaysFolderHint | null;
  /** Make `dir`, a folder inside the Plays folder, the Plays folder; resolves to whether it opened. */
  openFolderBelow: (dir: string) => Promise<boolean>;
  /** Keep the Plays folder the hint is about; the Plays screen stops asking. */
  keepPlaysFolder: () => void;
  /**
   * True until the folders inside the open Plays folder have been looked into.
   * The Plays screen offers no first play meanwhile.
   */
  lookingBelow: boolean;
  /** The last Plays folder has been tried: what opens from Finder can be routed. */
  booted: boolean;
  /** Edit a play's dashboard metadata (status / logline) from the picker. */
  updatePlay: (dir: string, patch: { status?: string; logline?: string }) => void;
  // workspace
  root: string | null;
  playId: string | null;
  /** The play's name, which is its folder's name (docs/app/keeping-work/storage-and-file-format.md#STOR-D4). */
  playTitle: string;
  binder: BinderItem[];
  /** What arrived from outside the app, newest last. */
  ledger: LedgerEntry[];
  /** The before/after text for one entry, or null when there is no baseline. */
  changeDiff: (entryId: string) => Promise<{ before: string; after: string } | null>;
  /** Accept a change — it stays and stops asking for attention. */
  keepChange: (entryId: string) => void;
  /** Put a change back, through the same guarded writers an edit uses. */
  revertChange: (entryId: string) => Promise<boolean>;
  /** A provider conflict copy beside the file it is a copy of (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). */
  loadOther: (path: string) => Promise<{ theirs: string; ours: string } | null>;
  /** Promote one over the file it copies, then trash it. */
  keepOther: (path: string) => Promise<boolean>;
  /** Move one to the OS trash. */
  trashOther: (path: string) => Promise<boolean>;
  /** Scene ordinals touched by a pending change, for the board/outliner marks. */
  changedScenes: Set<number>;
  /** Inline tracked changes over the script — a view layer, never the document. */
  showTracked: boolean;
  setShowTracked: (on: boolean) => void;
  trackedMarks: TrackedMarks;
  /** True when there is anything to show; the toggle hides itself otherwise. */
  hasTrackedChanges: boolean;
  /** Binder entries whose file is missing on disk — surfaced, never removed. */
  missingItems: BinderItem[];
  /** Ids the app filed for the writer; shown with a dot until acknowledged. */
  newlyFiled: Set<string>;
  /** Drop the dots — the writer has seen what arrived. */
  acknowledgeFiled: () => void;
  /** Cast names from the binder's `character` items, for autocomplete. */
  cast: string[];
  activeId: string | null;
  readOnly: boolean;
  rawPlay: RawPlayDetails | null;
  closeRawPlay(): void;
  retryRawPlay(): void;
  revealRawPlay(): void;
  conflictCopies: string[];
  preserved: string[];
  /** A sentence to show, or a refused save's title, detail and code (save-failure.ts). */
  error: string | SaveProblem | null;
  // editor / script
  scriptTitle: string;
  /** Vault-relative path of the open script (null when none). */
  scriptPath: string | null;
  status: SaveStatus;
  gate: boolean;
  editable: boolean;
  /** Words from before the app stopped, waiting on the writer (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). */
  recoveryOffer: RecoveryOffer | null;
  /** Put the offered words back into the script, through the guarded write. */
  recoverOffer: () => Promise<boolean>;
  /** Decline them. They stay in Versions. */
  discardOffer: () => void;
  // Versions (docs/app/keeping-work/storage-and-file-format.md#STOR-D10)
  /**
   * Versions of an open sheet, or of the outline note (`"outline"` for its id
   * before the note exists): the same panel as a script's, on another ring.
   * Null when there is no such sheet or note open.
   */
  versionsOf: (id: string) => VersionsTarget | null;
  /** The outline note's id, when it exists. */
  outlineNoteId: string | null;
  listVersions: () => Promise<VersionEntry[]>;
  readVersion: (name: string) => Promise<string>;
  restoreVersion: (name: string) => Promise<boolean>;
  /** The script as it stands, serialized — the live side of a version compare. */
  currentScriptText: () => string;
  // corkboard / outliner
  view: ScriptView;
  cards: SceneCard[];
  setView: (v: ScriptView) => void;
  openScene: (ordinal: number) => void;
  /** Go to a comment in the script — the feed's click (docs/app/writing/comments.md#COMM-D5). */
  openComment: (pos: number) => void;
  /** The live editor, for the surfaces that read comments out of it. */
  editor: Editor | null;
  /** ⌘F / ⌘⌥F — open the find bar on the script from wherever the writer is. */
  openFind: (replace?: boolean) => void;
  setCard: (sceneId: string, partial: Partial<Card>) => void;
  reorderScene: (from: number, to: number) => void;
  editSynopsis: (ordinal: number, text: string) => void;
  /** Make a scene from the board, before it is written: on a corkboard the card can come first. */
  addScene: (title?: string) => void;
  // script format & layout (docs/app/formatting/formats-and-layout.md#SCHEMA-D100)
  /** The play's resolved format spec — drives the renderer + pagination. */
  format: FormatSpec;
  /** All registered formats (built-ins + user files), for the picker. */
  formats: FormatSpec[];
  setFormat: (id: string) => void;
  playLanguage: string;
  savePlayLanguage: (language: string, forScript: string | null) => Promise<boolean>;
  /** Non-fatal format-load problems (bad user files, unknown ids). */
  formatWarnings: string[];
  /** Page view (engine page breaks) vs continuous galley. */
  paginated: boolean;
  setPaginated: (on: boolean) => void;
  /** Title/author for header tokens. */
  layoutMeta: LayoutMeta;
  /** Current front matter (title page fields; fountain title keys). */
  frontMatter: FrontMatter;
  /**
   * `forScript`: the script the edit was made for (`openScriptKey` when the
   * sheet opened). False, and nothing changed, when another script is open now.
   */
  saveFrontMatter: (fm: FrontMatter, forScript?: string | null) => boolean;
  /** Which script is open, as a key that changes when another one opens; null for none. */
  openScriptKey: string | null;
  /** Save the printed cast list (name + description) to the fountain title page. */
  saveCharacters: (entries: CharacterEntry[]) => void;
  patchFrontMatter: (patch: Partial<FrontMatter>, forScript: string | null) => boolean;
  /** Which scenes each UPPERCASE cue speaks in (derived from the script). */
  castAppearances: () => Map<string, SceneAppearance[]>;
  /** Size of each part, for tiering the cast (derived, never stored). */
  castWeights: Map<string, CharacterWeight>;
  /** Scenes in the play — the denominator for "appears throughout". */
  sceneCount: number;
  /** Where each scene sits in the paginated script, and how long it runs. */
  scenePages: ScenePageMap;
  /** Speakers kept off the printed cast page despite speaking. */
  castHidden: string[];
  hideFromCast: (name: string) => void;
  unhideFromCast: (name: string) => void;
  /** Paginate the open script for the export dialog's preview — the same call
   * the export itself makes, so what you pick is what you get. Pass a
   * character name to paginate that character's SIDES instead (backlog P5).
   * `anonymous` lays out the copy without the writer's name
   * (docs/app/formatting/formats-and-layout.md#FMT-143). */
  layoutForExport: (sidesFor?: string | null, anonymous?: boolean) => LayoutResult | null;
  /** Omit `pages` for the whole script. `front` names the unnumbered sheets
   * that go before the pages — title, cast, setting — for any export, sides
   * included; omitted, none do. `sidesFor` exports one character's part. `to`
   * saves the file (the default) or prints it: the same bytes either way.
   * `anonymous` leaves the writer's name and contact details out. `type` is
   * the file: a PDF (the default), or a .docx or .odt for a word processor
   * (docs/app/formatting/formats-and-layout.md#FMT-145); printing is always
   * the PDF. */
  exportScript: (opts?: {
    pages?: number[] | null;
    front?: FrontSheet[];
    sidesFor?: string | null;
    anonymous?: boolean;
    to?: "file" | "print";
    type?: ExportFileType;
  }) => void;
  exporting: boolean;
  /** Success message (e.g. "Exported …"); the happy-path toast. */
  notice: string | null;
  dismissNotice: () => void;
  // materials — several can be open at once, one per pane, so
  // everything here is keyed by BINDER ID rather than there being one of each.
  openMaterials: Record<string, OpenMaterial>;
  /** `base`: the version the words were written on (MaterialEditor). True when they landed. */
  saveMaterial: (id: string, fullContent: string, base?: string) => Promise<boolean>;
  /** One front-matter field of an open sheet, applied to the sheet as it is when written. */
  setMaterialField: (id: string, key: string, value: string) => Promise<boolean>;
  /** Change a sheet's tags, applied to the tags as they are when written — not as last drawn. */
  editMaterialTags: (id: string, edit: (tags: string[]) => string[]) => Promise<boolean>;
  /** A sheet's unsaved words appeared or went away. */
  setMaterialDirty: (id: string, dirty: boolean) => void;
  /** Each editor hands the store its buffer; the returned function withdraws it. */
  registerMaterialBuffer: (id: string, buffer: MaterialBuffer) => BufferLease<ParkedWords>;
  /** Write one material's pending edits now. */
  flushMaterial: (id: string) => void | Promise<void>;
  /** External changes waiting on a choice; nothing has been overwritten. */
  materialGates: Record<string, MaterialGate>;
  resolveMaterialGate: (id: string, choice: "mine" | "theirs") => void;
  /** Drop one open material's buffer — a pane's tab closing. */
  closeMaterial: (id: string) => void;
  /**
   * A quit is waiting (src/app/quit.ts): land every word that can land, keep
   * the rest where the next launch finds it, and say what could be kept
   * nowhere. Tears nothing down, so a quit that is called off goes on.
   */
  settleForQuit: () => Promise<QuitSettled>;
  confirmSaveState: () => Promise<void>;
  /** Same, for the outline scratchpad's buffer. */
  setOutlineDirty: (dirty: boolean) => void;
  /**
   * The outline scratchpad's prose — "" when the writer hasn't started one.
   * Body only: the front matter is held here and put back on every save
   * (outline-note.ts).
   */
  outlineBody: string;
  /** Where it lives, once it exists — shown so the file is never a mystery. */
  outlineNotePath: string | null;
  /**
   * `base`: the note the words were written on (OutlineNotes). True when they
   * landed — false while the note is still being read, or behind its gate.
   */
  saveOutlineNote: (body: string, base?: string) => Promise<boolean>;
  /** Bumped when the scratchpad must take `outlineBody` whatever it holds. */
  outlineReset: number;
  /** False while the note is being read: the scratchpad is not writable until it is. */
  outlineReady: boolean;
  /** Another version of the note, waiting on the writer's choice. */
  outlineGate: { theirs: string } | null;
  resolveOutlineGate: (choice: "mine" | "theirs") => void;
  registerOutlineBuffer: (buffer: MaterialBuffer) => BufferLease<ParkedWords>;
  // actions
  openFolder: () => void;
  /** Put the plays in the app's own iCloud Drive container (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). */
  openCloudFolder: () => void;
  /** The iCloud container's path, or null when iCloud is unavailable. */
  cloudRoot: string | null;
  /** Where the plays live, in one sentence (docs/app/keeping-work/storage-and-file-format.md#STOR-D11). */
  wherePlaysLive: string;
  /**
   * The provider keeping the Plays folder — `icloud`, `dropbox`, `syncthing`,
   * another File Provider's name, or `local` — for diagnostics, never a path.
   */
  playsProvider: string;
  selectItem: (item: BinderItem) => void;
  onEditorReady: (editor: Editor) => void;
  onEditorChange: (doc: Doc) => void;
  onSaveShortcut: () => void;
  loadTheirs: () => void;
  keepMine: () => void;
  dismissError: () => void;
  // binder ops
  reorder: (id: string, toIndex: number) => void;
  renameTo: (id: string, title: string) => void;
  moveTo: (id: string, parentId: string | null, atIndex: number) => void;
  createFolder: (parentId: string | null, title: string, atIndex?: number) => void;
  /** `name`: the binder names it before it is written in (docs/app/preferences-and-help/accessibility.md#A11Y-4). */
  createMaterial: (
    parentId: string | null,
    type: BinderItemType,
    title: string,
    atIndex?: number,
    opts?: { name?: boolean },
  ) => void;
  createScript: (parentId: string | null, title: string, atIndex?: number) => void;
  /** Copy a file beside itself and open the copy. Files only, never folders. */
  duplicate: (id: string) => void;
  /** Show one binder item in the OS file manager. */
  revealItem: (id: string) => void;
  /** Whether this host HAS a file manager to reveal into (docs/engineering/cross-platform.md#PLAT-D100). */
  canReveal: boolean;
  /**
   * What was just made: App opens it, and the binder shows it. `name`, and the
   * binder opens the row in rename mode first; otherwise its page takes the
   * cursor straight away (docs/app/preferences-and-help/accessibility.md#A11Y-4).
   */
  justCreated: CreatedItem | null;
  consumeCreated: () => void;
  /** Move to Trash. Resolves with the undo the toast offers (docs/app/keeping-work/storage-and-file-format.md#STOR-90). */
  remove: (id: string) => Promise<TrashResult | null>;
}

export function useWorkspace(): Workspace {
  const [practicing, setPracticing] = useState(false);
  const practiceRef = useRef(false);
  const returningFromPractice = useRef(false);
  const practiceSessionRef = useRef<string | undefined>(undefined);
  const practiceSourceRef = useRef<PracticeSource | null>(null);
  const practiceRootRef = useRef<string | null>(null);
  const practiceReturnRef = useRef<{base: string | null; dir: string | null; script: string | null} | null>(null);
  /* "picker" until a play has loaded, never "workspace" first: the first
     folder opens (setRoot) a few awaits before its plays are listed, and a
     shell that started in "workspace" drew an empty play for that moment on
     every launch — the flash a writer saw on the way into the last play —
     and counted it as a play opened. */
  const [mode, setMode] = useState<ShellMode>("picker");
  /** The open play's script is on the page, laid out, and at the writer's place (`playSettled`). */
  const [playSettled, setPlaySettled] = useState(false);
  const [vaultRoot, setVaultRoot] = useState<string | null>(null);
  /** Who keeps the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D11), detected when it opens. */
  const [playsProviders, setPlaysProviders] = useState<string[]>([]);
  const [plays, setPlays] = useState<VaultPlay[]>([]);
  const playsRef = useRef(plays);
  playsRef.current = plays;
  /**
   * Folders inside a Plays folder with no plays that do hold some (docs/app/keeping-work/storage-and-file-format.md#STOR-D12),
   * with the Plays folder they were looked for in. Screen state changes a render
   * apart when a folder opens; tagged, a hint about the last folder can never show
   * under the next one.
   */
  const [playsBelow, setPlaysBelow] = useState<{ root: string; folders: FolderOfPlays[] } | null>(
    null,
  );
  /** The Plays folder the writer kept when the Plays screen pointed below it. */
  const [keptFolder, setKeptFolder] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const activeRootRef = useRef(root);
  activeRootRef.current = root;
  const [playTitle, setPlayTitle] = useState("");
  const [binder, setBinder] = useState<BinderItem[]>([]);
  // Binder entries whose file is gone from disk (docs/app/keeping-work/storage-and-file-format.md#STOR-D9). Surfaced, never
  // removed — this could be a sync still in flight or an un-downloaded iCloud
  // file, and "fixing" it by deleting the entry is how work disappears.
  const [missingItems, setMissingItems] = useState<BinderItem[]>([]);
  // Items the app filed for the writer rather than the writer filing them —
  // shown with a dot until acknowledged. Non-canonical, session-scoped.
  const [newlyFiled, setNewlyFiled] = useState<Set<string>>(() => new Set());
  // Bumped when a material changes on disk. Materials are not in `binder` or
  // `cards`, so nothing else would tell the appearances sync to look again.
  const [materialsTick, setMaterialsTick] = useState(0);
  // The change ledger: what arrived from outside the app.
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  // Scene ordinals a pending change touched, so the board and the outliner can
  // say WHERE something arrived rather than only that something did.
  const [changedScenes, setChangedScenes] = useState<Set<number>>(() => new Set());
  // Inline tracked changes: a view over the same pending
  // entries, off by default because the writer asked to see the play, not the
  // diff, unless they say otherwise.
  const [showTracked, setShowTrackedState] = useState(false);
  const [trackedMarks, setTrackedMarks] = useState<TrackedMarks>(() => emptyMarks());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [rawPlay, setRawPlay] = useState<RawPlayDetails | null>(null);
  const readOnlyRef = useRef(false);
  readOnlyRef.current = readOnly;
  const [scriptTitle, setScriptTitle] = useState("");
  const [scriptPath, setScriptPathState] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  /** Mirrors editorRef for React: a ref alone never re-renders the panes. */
  const [editor, setEditor] = useState<Editor | null>(null);
  const [gate, setGate] = useState(false);
  /** Read inside async callbacks that must not close over a stale `gate`. */
  const gateRef = useRef(false);
  gateRef.current = gate;
  const [conflictCopies, setConflictCopies] = useState<string[]>([]);
  /** Versions pinned because a write could not land (docs/app/keeping-work/storage-and-file-format.md#STOR-D9). */
  const [preserved, setPreserved] = useState<string[]>([]);
  const [error, setError] = useState<string | SaveProblem | null>(null);
  const [view, setViewState] = useState<ScriptView>("editor");
  const [cards, setCards] = useState<SceneCard[]>([]);
  /** Read inside async callbacks that must not close over a stale `cards`. */
  const cardsRef = useRef<SceneCard[]>([]);
  cardsRef.current = cards;
  const reloadSeqRef = useRef(0);
  // Unlike read cancellation, document ownership lasts through settlement.
  const documentEpochRef = useRef(0);
  const captureSessionScope = useCallback(() => captureDocumentScope(() => ({
    playId: playIdRef.current, generation: documentEpochRef.current, changes: changesRef.current,
  }), vault), []);
  const materials = useMaterialSessions({
    currentScope: captureSessionScope,
    bufferGeneration: () => workspaceGenRef.current,
    syncBeacon: () => syncBeaconRef.current(),
    captureRecovery: () => { void bufferRecoveryRef.current?.captureNow(); },
    setSheetStatus: (status) => setSheetStatus(status),
    setActiveId: (id) => setActiveId(id),
    setError: (error) => setError(error),
    setPreserved: (update) => setPreserved(update),
    saveLanded: (key) => saveLanded(key),
    saveRefused: (key, error, subject) => saveRefused(key, error, subject),
    saveSubject: (kind, path) => saveSubject(kind, path),
    refusalFor: (key) => refusedRef.current.get(key),
    forgetRefused: (gone) => forgetRefused(gone),
  });
  const {
    openMaterials,
    materialGates,
    materialUnsaved,
    unsavedTextsOf,
    idForMaterialPath,
    openMaterial,
    saveMaterial,
    setMaterialField,
    editMaterialTags,
    setMaterialDirty,
    resolveMaterialGate,
    registerMaterialBuffer,
    flushMaterial,
    flushAllMaterials,
    closeMaterial,
    materialWrites,
  } = materials;

  /** Assigned with the beacon below: tell the installer whether anything is unsaved. */
  const syncBeaconRef = useRef<() => void>(() => {});
  /**
   * The one status line is the script's as much as any sheet's. A sheet that
   * saved must not say "Saved" over a script with words still unsaved or a
   * banner still up — that told the writer, and the installer's unsaved-work
   * beacon, that everything was safe.
   */
  const setSheetStatus = useCallback((next: SaveStatus) => {
    if (next === "saved" || next === "idle") {
      if (gateRef.current) next = "conflict";
      else if (sessionRef.current?.dirty) next = "dirty";
    }
    setStatus(next);
  }, []);

  /** `${playId}:${scriptId}` of the open script, for a sheet that edits it (the Title Page). */
  const [openScriptKey, setOpenScriptKey] = useState<string | null>(null);
  const outline = useOutlineSession(binder, {
    currentScope: captureSessionScope,
    bufferGeneration: () => workspaceGenRef.current,
    syncBeacon: () => syncBeaconRef.current(),
    captureRecovery: () => { void bufferRecoveryRef.current?.captureNow(); },
    setSheetStatus: (status) => setSheetStatus(status),
    setError: (error) => setError(error),
    setPreserved: (update) => setPreserved(update),
    saveLanded: (key) => saveLanded(key),
    saveRefused: (key, error, subject) => saveRefused(key, error, subject),
    saveSubject: (kind, path) => saveSubject(kind, path),
    runBinderOp: (operation) => runBinderOp(operation),
    binderOpNow: (operation) => binderOpNow(operation),
  });
  const {
    outlineBody,
    outlineNotePath,
    outlineLoading,
    outlineReset,
    outlineGate,
    setOutlineDirty,
    saveOutlineNote,
    resolveOutlineGate,
    registerOutlineBuffer,
    outlineNotePathOrHome,
  } = outline;

  /**
   * The app itself just wrote `path` — a revert, a conflict copy kept, an
   * appearances block regenerated. If that file is open in a pane, adopt the
   * bytes and the new hash so the buffer on screen matches disk and the next
   * save lands instead of colliding. A no-op when the file isn't open.
   *
   * This is the same three lines that used to sit at each write site; keyed by
   * id there is one more thing to get right at each of them, so there is one
   * of them now — and it covers the outline note, which a revert used to leave
   * showing the old notes, its first save a false choice.
   */
  const adoptMaterialWrite = useCallback(
    (path: string, content: string, hash: string) => {
      const id = idForMaterialPath(path);
      const m = id ? materials.record(id) : undefined;
      if (id && m) {
        // Never over unsaved words: an editor holding some keeps them, and its
        // next save meets the gate rather than this version being lost under it.
        // A "Keep this one" still waiting was about the version this replaces.
        materials.adopt(id, content, hash);
      }
      outline.adoptWrite(path, content, hash);
    },
    [idForMaterialPath, materials.adopt, outline.adoptWrite],
  );
  // Speakers deliberately kept off the printed cast page (`castHidden`).
  const [castHidden, setCastHidden] = useState<string[]>([]);
  // A just-created binder item: opened for the writer, and either named in place
  // first (create with a default name, then rename in the row — no prompt
  // dialog) or written in straight away (docs/app/preferences-and-help/accessibility.md#A11Y-4).
  const [justCreated, setJustCreated] = useState<CreatedItem | null>(null);
  // Asked once. The UI branches on the capability, never on a platform name.
  const [canReveal, setCanReveal] = useState(false);
  /** The iCloud container, or null where iCloud is unavailable (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). */
  const [cloudRoot, setCloudRoot] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void vault
      .cloudRoot()
      .then((r) => live && setCloudRoot(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    void platform.capabilities().then((c) => live && setCanReveal(c.canReveal));
    return () => {
      live = false;
    };
  }, []);
  // Script format (per-play, the play file's settings.format) + page view.
  // The registry is the app's one, shared with Settings and the format
  // designer, so a format saved there reaches the menu and this play at once.
  const registry = useFormatRegistry();
  const [formatId, setFormatId] = useState<string | null>(null);
  const [paginated, setPaginatedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PAGE_VIEW_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [layoutMeta, setLayoutMeta] = useState<LayoutMeta>({});
  const [frontMatter, setFrontMatterState] = useState<FrontMatter>({});
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const playRef = useRef<Loaded<PlayFile> | null>(null);

  const resolvedFormat = useMemo(() => registry.resolve(formatId), [registry, formatId]);
  const formatWarnings = useMemo(() => {
    const all = registry.warnings.map((w) => `${w.source}: ${w.message}`);
    if (resolvedFormat.warning) all.push(resolvedFormat.warning);
    return all;
  }, [registry, resolvedFormat]);

  // Cast names for character autocomplete: the binder's `character` items (their
  // titles = the characters/*.md sheet titles). The editor adds the open doc's
  // own cues on top. (a) from the binder; (b) is derived live in the editor.
  const cast = useMemo(() => castFromBinder(binder), [binder]);

  const appearancesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // editor/script refs
  const editorRef = useRef<Editor | null>(null);
  const sessionRef = useRef<DocumentSession | null>(null);
  const scriptPathRef = useRef<string | null>(null);
  const activeScriptIdRef = useRef<string | null>(null);
  const frontMatterRef = useRef<FrontMatter>({});
  const docRef = useRef<Doc | null>(null);

  const loadingRef = useRef(false);
  const flushRef = useRef<() => void>(() => {});
  // Declared here, assigned once reloadFromDisk exists below (flush resolves
  // deferred external changes and may need to reload).
  const reloadFromDiskRef = useRef<() => Promise<void>>(async () => {});
  // Same shape for the binder reconciler: loadWorkspace and the watcher both
  // call it, and neither should re-bind when the binder changes.
  const reconcileNowRef = useRef<() => Promise<void>>(async () => {});
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The ledger, and the script writer, read from callbacks that must not
  // re-bind every time an entry lands.
  const ledgerRef = useRef<LedgerEntry[]>([]);
  const changesRef = useRef<ChangesStore | null>(null);
  const applyScriptTextRef = useRef<(text: string) => Promise<boolean>>(async () => false);
  const autosaveRef = useRef<AutosaveScheduler | null>(null);
  if (!autosaveRef.current) {
    autosaveRef.current = new AutosaveScheduler(DEFAULT_AUTOSAVE, () => flushRef.current());
  }
  // Version cadence (docs/app/keeping-work/storage-and-file-format.md#STOR-D10): bucketed save snapshots.
  const snapshotPolicyRef = useRef<SnapshotPolicy | null>(null);
  if (!snapshotPolicyRef.current) snapshotPolicyRef.current = new SnapshotPolicy();
  // Recovery snapshots (docs/app/keeping-work/storage-and-file-format.md#STOR-D10, docs/app/keeping-work/storage-and-file-format.md#STOR-D13): the open script's unsaved words, in
  // app data every few seconds while autosave has not landed them.
  const recoveryRef = useRef<RecoverySnapshots | null>(null);
  if (!recoveryRef.current) recoveryRef.current = new RecoverySnapshots(recovery);
  const [recoveryOffer, setRecoveryOffer] = useState<RecoveryOffer | null>(null);
  const recoveryOfferRef = useRef<RecoveryOffer | null>(null);
  const recoveryQueueRef = useRef<RecoveryOffer[]>([]);
  const recoveryCheckRef = useRef(0);
  recoveryOfferRef.current = recoveryOffer;
  // The open play: its file's name inside the folder, and its id, which is how
  // Versions and Changes are addressed in app data (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
  const playPathRef = useRef<string | null>(null);
  const playIdRef = useRef<string | null>(null);
  const bufferRecoveryRef = useRef<BufferRecovery | null>(null);
  if (!bufferRecoveryRef.current) bufferRecoveryRef.current = new BufferRecovery(recovery, () => {
    const playId = playIdRef.current;
    if (!playId) return [];
    const copies: RecoveryBuffer[] = [];
    copies.push(...materials.recoveryCopies((id) => findById(playRef.current?.data.binder ?? [], id)?.path));
    copies.push(...outline.recoveryCopies());
    return copies;
  });
  useEffect(() => {
    const copies = bufferRecoveryRef.current!;
    copies.start();
    return () => { void copies.stop(); };
  }, []);
  /** The play's own directory name, for the ‹ back path and the Plays screen. */
  const playDirRef = useRef<string | null>(null);
  // The Plays folder root persists while a play from it is open.
  const vaultRootRef = useRef<string | null>(null);
  // Opening a play or a Plays folder, one at a time (one-at-a-time.ts).
  const lineRef = useRef<Line | null>(null);
  if (!lineRef.current) lineRef.current = oneAtATime();
  const line = lineRef.current;
  /**
   * Every write of the open script's file, one at a time: autosave, a board
   * move, a restore, Keep this. Each reads the hash it expects when its turn
   * comes and records what landed before the next begins. Two that overlapped
   * used to collide with each other — the second one's expectation named the
   * file before the first landed — which stopped autosave for good with no
   * banner to say so.
   */
  const scriptWritesRef = useRef<Line | null>(null);
  if (!scriptWritesRef.current) scriptWritesRef.current = oneAtATime();
  const scriptWrites = scriptWritesRef.current;

  /**
   * Saves the disk refused, by the file they were for (`script:<id>`,
   * `sheet:<id>`, `outline`), and why (save-failure.ts).
   *
   * The writer is told once. Autosave tries again at every pause in the typing,
   * and a script locked in Finder used to raise the OS's words in a new toast
   * each time. A retry refused the same way now says nothing new, and the
   * status line says "Not saved" for as long as it lasts. A different reason is
   * news, and so is the save that lands at last.
   */
  const refusedRef = useRef(new Map<string, { refusal: SaveRefusal; subject: SaveSubject }>());
  const [refusedSaves, setRefusedSaves] = useState(0);
  /** Whose words a save carries, from their file's path inside the play. */
  const saveSubject = useCallback((kind: SaveSubject["kind"], path: string): SaveSubject => {
    const dirs = path.split("/").slice(0, -1);
    const play = playDirRef.current ?? "";
    return { kind, name: titleFromFileName(path), folder: dirs.pop() ?? play.slice(play.lastIndexOf("/") + 1) };
  }, []);
  const saveRefused = useCallback((key: string, e: VaultWriteError, subject: SaveSubject) => {
    const refusal = saveRefusal(e);
    const before = refusedRef.current.get(key);
    refusedRef.current.set(key, { refusal, subject });
    setRefusedSaves(refusedRef.current.size);
    if (before?.refusal !== refusal) setError(saveProblem(refusal, subject));
  }, []);
  const saveLanded = useCallback((key: string) => {
    const refused = refusedRef.current.get(key);
    if (!refused) return;
    refusedRef.current.delete(key);
    setRefusedSaves(refusedRef.current.size);
    setNotice(`“${refused.subject.name}” is saved.`);
  }, []);
  /** Nothing waits to save under these keys any more: their words were kept, or went with their play. */
  const forgetRefused = useCallback((gone: (key: string) => boolean) => {
    for (const key of [...refusedRef.current.keys()]) if (gone(key)) refusedRef.current.delete(key);
    setRefusedSaves(refusedRef.current.size);
  }, []);
  /**
   * A change the writer asked for — a card moved, a version put back — that a
   * refused write stopped, in their words. Anything else, as it was said.
   */
  const changeRefused = useCallback(
    (e: unknown, kind: SaveSubject["kind"], path: string | null): string | SaveProblem =>
      e instanceof VaultWriteError && path ? saveProblem(saveRefusal(e), saveSubject(kind, path), "change") : String(e),
    [saveSubject],
  );

  // Caret memory (see caret-memory.ts): coalesced so arrow keys don't each
  // write to localStorage.
  const caretPendingRef = useRef<{ path: string; pos: number } | null>(null);
  const caretTimerRef = useRef<number | null>(null);

  // --- editor / autosave (unit F) ---
  const loadDocIntoEditor = useCallback((doc: Doc) => {
    loadingRef.current = true;
    // Newlines ⇄ lineBreak nodes across the editor boundary (bridge.ts): the
    // model keeps literal newlines, the editor can't hold a trailing one.
    //
    // Loading is NOT an edit (docs/app/writing/editor-ux.md#EDIT-D118: the stack resets on
    // reload/reopen, and you cannot undo across one). The editor outlives a
    // script switch, so without these two the swap is just another transaction:
    // ⌘Z pressed on a freshly opened play undid the load and left the empty
    // document the editor was created with, which autosave then wrote to the
    // `.fountain`. `addToHistory: false` keeps the load off the stack;
    // `resetHistory` keeps the PREVIOUS script's steps from being replayed
    // against the document that just replaced it.
    editorRef.current
      ?.chain()
      .setMeta("addToHistory", false)
      .setContent(toEditorDoc(ensureNonEmpty(doc)))
      .run();
    editorRef.current?.commands.resetHistory();
    loadingRef.current = false;
    docRef.current = editorRef.current
      ? fromEditorDoc(editorRef.current.getJSON() as Doc)
      : doc;
  }, []);

  /**
   * Put the writer back where they were in this script (caret-memory.ts).
   *
   * Only from `loadFromDisk` — an open, or a reload after an external change.
   * Not from the other `loadDocIntoEditor` callers: they re-sync the editor after
   * a scene move or clear it on teardown, and moving the caret there would yank
   * the writer somewhere they didn't ask to go.
   *
   * Focus is taken only if nothing else holds it. On a fresh open that means the
   * writer can just start typing; during a reload while they are mid-sentence in
   * a background write it means their focus is left alone.
   */
  const restoreCaret = useCallback((path: string, settled?: () => void) => {
    const editor = editorRef.current;
    // Every retained attempt has a Practice Play.fountain. Its remembered
    // cursor belongs to that play, not to the shared filename.
    const key = practiceRef.current && vaultRootRef.current === practiceRootRef.current && playIdRef.current ? `practice:${playIdRef.current}/${path}` : path;
    const pos = editor ? recallCaret(key, editor.state.doc.content.size) : null;
    const generation = workspaceGenRef.current;
    const loadedDoc = editor?.state.doc;
    let selection = editor?.state.selection;
    const place = (moveCaret: boolean) => {
      if (pos === null) return;
      const live = editorRef.current;
      if (!live || live !== editor || generation !== workspaceGenRef.current || scriptPathRef.current !== path
        || live.state.doc !== loadedDoc || !selection || !live.state.selection.eq(selection)) return;
      try {
        if (moveCaret) {
          live.chain().setTextSelection(pos).setMeta("addToHistory", false).run();
          selection = live.state.selection;
        }
        // Focus is taken only while nothing else holds it — checked NOW, not when
        // the restore was scheduled, so a writer who has since clicked into the
        // binder or a sheet keeps their cursor. Attempted in both passes because the
        // editor pane can still be `hidden` on the first one, and focusing inside
        // a hidden subtree does nothing.
        const active = document.activeElement;
        if (!live.view.hasFocus() && (!active || active === document.body)) {
          live.commands.focus();
        }
        scrollPosIntoView(live.view, pos, { center: true });
      } catch {
        /* a position the document no longer has: leave the writer at the top */
      }
    };
    // Asserted twice. Opening a play settles over several renders, and App's
    // per-view scroll memory sends a surface it has no memory of back to 0 — so
    // the first scroll can land before that and be undone by it. The second pass
    // is a no-op when the caret is already on screen (scrollPosIntoView bails
    // when the position is comfortably in view), so it only heals the race.
    //
    // The second pass also waits for the page layout: a relayout that lands
    // after it moves every line below the first page break, the caret's with
    // them. Then the script is where the writer left it, and says so
    // (`settled`, which launch waits on before it shows the play).
    if (pos !== null) setTimeout(() => place(true), 0);
    setTimeout(() => {
      if (scriptPathRef.current !== path) return;
      const finish = () => {
        place(false);
        settled?.();
      };
      const live = editorRef.current;
      if (live) whenLaidOut(live, finish);
      else finish();
    }, CARET_SETTLE_MS);
  }, []);

  /**
   * Put a script's text, already read, into the editor. Synchronous on
   * purpose: the callers check that nothing changed while the read was out,
   * and that check only holds if nothing is awaited between it and this.
   */
  const applyLoaded = useCallback(
    (path: string, content: string) => {
      // What the writer is about to look at becomes the review baseline, so a
      // later change from outside can be diffed and undone.
      void changesRef.current?.writeBaseline(path, content);
      const parsed = parse(content);
      frontMatterRef.current = parsed.frontMatter;
      setFrontMatterState(parsed.frontMatter);
      setLayoutMeta({
        frontMatter: parsed.frontMatter,
        title: parsed.frontMatter.title ?? "",
        author: parsed.frontMatter.authors?.join(", ") ?? "",
      });
      loadDocIntoEditor(parsed.doc);
      restoreCaret(path, () => setPlaySettled(true));
    },
    [loadDocIntoEditor, restoreCaret],
  );

  /**
   * Reconcile the play file's card records against the parsed doc, and write
   * only if something the FILE owns actually changed (docs/app/keeping-work/storage-and-file-format.md#STOR-D6).
   *
   * Runs on open, on external reloads, and after every flush so the Board and
   * Outline panes live-update at autosave cadence. The three derived fields the
   * pre-1.0 sidecar cached — act, heading, synopsis — are recomputed here and
   * held in `cards`; they never reach disk, which is what stops retyping a
   * scene heading from rewriting a synced JSON file on every keystroke.
   */
  const refreshCards = useCallback(async (doc: Doc) => {
    const scriptId = activeScriptIdRef.current;
    const playPath = playPathRef.current;
    const playId = playIdRef.current;
    if (!scriptId || !playPath) return;
    // What a commit brings back belongs to the play it was made in, and its
    // cards to the script. One that returns after the writer has moved on must
    // not put the last script's cards on this one's board — acting on those
    // wrote them into this script's records.
    const samePlay = () => playIdRef.current === playId && playPathRef.current === playPath;
    const sameScript = () => samePlay() && activeScriptIdRef.current === scriptId;

    const run = (play: PlayFile | null) =>
      reconcileCards({ doc, prior: play ? scriptDataFor(play, scriptId) : null });

    const base = playRef.current;
    const { data, cards: next, changed } = run(base?.data ?? null);
    setCards(next);
    if (!changed || readOnlyRef.current) return;

    try {
      // Replayable against a fresh base: a stale hash means someone else wrote
      // the play file, so the retry re-reconciles onto THEIR copy rather than
      // re-asserting ours (which used to spawn a conflict sibling per tick).
      const committed = await commitPlay(
        playPath,
        base,
        (prior) =>
          prior
            ? withScriptData(prior, scriptId, run(prior).data)
            : withScriptData(base!.data, scriptId, data),
        new Date().toISOString(),
      );
      if (!samePlay()) return;
      if (committed.status === "ok") {
        playRef.current = { data: committed.data, hash: committed.hash };
        setBinder(committed.data.binder);
        if (sameScript()) setCards(run(committed.data).cards);
        return;
      }
      // A play from a newer app is left exactly as it is (docs/app/keeping-work/storage-and-file-format.md#STOR-D14).
      if (committed.status === "read-only") {
        setReadOnly(true);
        return;
      }
      // Contended: adopt disk truth so the next tick starts from a hash that
      // can actually succeed. Never keep the expectation that just failed.
      if (committed.data) {
        playRef.current = { data: committed.data, hash: committed.hash ?? "" };
        setBinder(committed.data.binder);
        if (sameScript()) setCards(run(committed.data).cards);
      }
    } catch {
      /* best-effort (docs/app/keeping-work/storage-and-file-format.md#STOR-107) — never blocks opening */
    }
  }, []);

  // Flushes are strictly serialized: a debounce flush racing a blur/⌘S/quit
  // flush would read a stale `expected` hash and collide WITH OUR OWN prior
  // write (self-conflict siblings + a bogus dirty-gate — seen live 2026-07-17).
  // One flush in flight; latecomers coalesce into one follow-up that reads a
  // fresh expected hash after the first completes.
  const flushInFlightRef = useRef(false);
  const flushQueuedRef = useRef(false);
  /** Whoever is waiting for the flush in flight, and the pass queued behind it, to finish. */
  const flushWaitersRef = useRef<(() => void)[]>([]);
  /** The session whose last write threw, so leaving it does not retry forever. */
  const writeFailedRef = useRef<DocumentSession | null>(null);
  /**
   * Resolves once the open script's buffer has been written — or, when a
   * write is already out, once that write and one more pass behind it have
   * landed. A caller that is about to replace the buffer can rely on that;
   * `flushRef` callers need not wait.
   */
  const flush = useCallback(async (): Promise<void> => {
    // A play from a newer Proscenium is not written to (docs/app/keeping-work/storage-and-file-format.md#STOR-D14; one
    // once said read-only and still saved) — the editor is not editable then, and this is the second lock.
    if (readOnlyRef.current) return;
    if (flushInFlightRef.current) {
      flushQueuedRef.current = true;
      return new Promise<void>((resolve) => flushWaitersRef.current.push(resolve));
    }
    flushInFlightRef.current = true;
    try {
      do {
        flushQueuedRef.current = false;
        const session = sessionRef.current;
        const path = scriptPathRef.current;
        let doc = docRef.current;
        const sid = activeScriptIdRef.current;
        const playId = playIdRef.current;
        if (!session || !path || !doc || !session.canAutosave) break;
        // Everything below happens to THIS script. The refs are not read again
        // after the write: by the time it lands they may name another one, and
        // a write that finished late once reconciled one script's scenes into
        // another script's cards.
        const stillOpen = () => sessionRef.current === session;
        setStatus("saving");
        try {
          let content = serialize({ frontMatter: frontMatterRef.current, doc });
          // Events arriving from here until onSaved are deferred, not decided
          // (a watcher event can outrun the write's promise, and our own bytes are not an edit from outside).
          let carried = session.beginWrite();
          if (writeFailedRef.current === session) writeFailedRef.current = null;
          const outcome = await scriptWrites(async () => {
            // A write ahead in the line — a card moved, a version put back —
            // may have changed the page since these bytes were taken. They would
            // have gone over that change; the page as it is now goes instead.
            const now = docRef.current;
            if (stillOpen() && now && now !== doc) {
              doc = now;
              content = serialize({ frontMatter: frontMatterRef.current, doc });
              carried = session.editCount;
            }
            const out = await vault.write(path, content, session.expectedForWrite);
            session.onSaved(out, carried);
            return out;
          });
          if (outcome.status === "ok") {
            saveLanded(`script:${sid ?? path}`);
            // The snapshot guarded words that are on disk now. If the writer
            // typed while this write was out, the session is still dirty and
            // the next tick snapshots what is left.
            if (!session.dirty && sid && playId) {
              void recoveryRef.current?.saved({ playId, scriptId: sid });
            }
            // Bucketed version of exactly what landed (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
            if (sid && playId && snapshotPolicyRef.current?.shouldSnapshot(sid)) {
              snapshotPolicyRef.current.record(sid);
              void versions.snapshot(playId, sid, "save", content).catch(() => null);
            }
            if (!stillOpen()) continue;
            if (session.dirty) {
              // Typed mid-write: those keystrokes are not in what landed.
              setStatus("dirty");
              autosaveRef.current?.schedule();
            } else {
              setStatus("saved");
            }
            // Keep the card records reconciled with every save (docs/app/keeping-work/storage-and-file-format.md#STOR-D6) —
            // Board/Outline panes live-update at autosave cadence.
            void refreshCards(doc);
          } else {
            /*
             * The file changed under us and NOTHING was written (docs/app/keeping-work/storage-and-file-format.md#STOR-D9).
             *
             * Our bytes would have gone to `<name>.proscenium-conflict-<ts>`
             * beside the play before 1.0. They go to a PINNED VERSION instead:
             * docs/app/keeping-work/storage-and-file-format.md#STOR-105 still holds — both sides survive, theirs on disk and ours in
             * Versions — and the play folder stays the writer's (docs/app/keeping-work/storage-and-file-format.md#STOR-111). The
             * banner is how they choose.
             */
            const pinned = stillOpen()
              ? await snapshotBufferRef.current("collision")
              : sid && playId
                ? await versions.snapshot(playId, sid, "collision", content).catch(() => null)
                : null;
            if (pinned) setPreserved((p) => [...p, pinned]);
            if (stillOpen()) {
              void recoveryRef.current?.writeNow();
              setGate(true);
              setStatus("conflict");
            }
          }
        } catch (e) {
          session.abortWrite(); // never leak the in-flight count
          writeFailedRef.current = session;
          // The disk refused: said once, in the writer's words (save-failure.ts).
          // The words stay in the buffer and the recovery snapshot, and the next
          // pause in the typing tries again.
          if (!(e instanceof VaultWriteError)) setError(String(e));
          else if (stillOpen()) saveRefused(`script:${sid ?? path}`, e, saveSubject("script", path));
          else setError(saveProblem(saveRefusal(e), saveSubject("script", path)));
          if (stillOpen()) { void recoveryRef.current?.writeNow(); setStatus("idle"); }
        }
      } while (flushQueuedRef.current);

      // Writes have settled: decide anything the watcher sent while they were
      // in flight. Echoes of what we just wrote fall out as "unchanged"; a
      // genuine external edit that landed mid-write still gates (docs/app/keeping-work/storage-and-file-format.md#STOR-104).
      const session = sessionRef.current;
      const deferred = session?.drainDeferred();
      if (deferred) {
        if (deferred.kind === "reload") void reloadFromDiskRef.current();
        else if (deferred.kind === "dirty-gate") {
          setGate(true);
          setStatus("conflict");
        }
      }
    } finally {
      flushInFlightRef.current = false;
      for (const resolve of flushWaitersRef.current.splice(0)) resolve();
    }
  }, [refreshCards, saveLanded, saveRefused, saveSubject]);
  flushRef.current = () => void flush();

  /**
   * Best-effort version of the CURRENT buffer — always taken before anything
   * replaces the buffer or the file (reload, keep, restore), and on a
   * collision, where it is the only surviving copy of what we could not write.
   *
   * Content comes from the session, not the disk, because before an external
   * reload only the buffer still holds "ours". Identical content dedups
   * ring-side, so calling it liberally costs nothing. Returns the version's
   * name, or null. Never blocks or throws.
   */
  const snapshotBuffer = useCallback(async (reason: string): Promise<string | null> => {
    const sid = activeScriptIdRef.current;
    const playId = playIdRef.current;
    const doc = docRef.current;
    if (!sid || !playId || !doc) return null;
    try {
      const content = serialize({ frontMatter: frontMatterRef.current, doc });
      return await versions.snapshot(playId, sid, reason, content);
    } catch {
      return null;
    }
  }, []);
  /** So `flush`, declared above, can pin a version without depending on it. */
  const snapshotBufferRef = useRef(snapshotBuffer);
  snapshotBufferRef.current = snapshotBuffer;

  /** The open script's text while it holds words that are not on disk; else null. */
  const captureUnsaved = useCallback((): string | null => {
    const session = sessionRef.current;
    const doc = docRef.current;
    if (!session?.dirty || !doc) return null;
    return serialize({ frontMatter: frontMatterRef.current, doc });
  }, []);

  /**
   * Land the open script's unsaved words on disk, as far as autosave may: write
   * what is dirty, wait out a write already in flight, and write again what was
   * typed while it was out. Stops at a banner or a write that failed — the words
   * are then still unsaved, and it is the caller's to say what happens to them.
   */
  const landOpenScript = useCallback(async () => {
    // Bounded: someone typing through every pass still ends up pinned below.
    for (let pass = 0; pass < 4; pass++) {
      autosaveRef.current?.cancel();
      const session = sessionRef.current;
      if (!session) return;
      const busy = flushInFlightRef.current;
      if (!busy && (!session.canAutosave || writeFailedRef.current === session)) return;
      await flush();
      if (!busy && writeFailedRef.current === session) return;
    }
  }, [flush]);

  /**
   * Put the open script's unsaved words somewhere safe before anything replaces
   * its buffer (docs/app/keeping-work/storage-and-file-format.md#STOR-104): onto disk when autosave may write, into a pinned version
   * when a banner is holding the file or the disk refused the write. Leaving the
   * play always did this; switching to another script did not, so words typed
   * in the moment before clicking a second script in the binder went with the
   * buffer.
   *
   * Not `safe` when the words are in neither place — they could not be kept in
   * Versions, or the writer was still typing after several tries — and then
   * they have just been written to the recovery snapshot, as a last resort. The
   * caller says what that means for what it was about to do.
   *
   * **The caller replaces the buffer before it awaits anything else.** A
   * keystroke can only land between awaits; that is what keeps "safe" true at
   * the moment of the swap.
   */
  const settleOpenScript = useCallback(async (): Promise<Settled> => {
    await landOpenScript();
    const session = sessionRef.current;
    const sid = activeScriptIdRef.current;
    const playId = playIdRef.current;
    if (!session || !docRef.current || !session.dirty) return { safe: true, message: null };
    const failed = writeFailedRef.current === session;
    const item = sid ? findById(playRef.current?.data.binder ?? [], sid) : null;
    const title = item ? titleOf(item) : "The script";
    // Behind a banner, or refused by the disk: nothing more can be written to
    // the file, so the words go into a pinned version — surviving without
    // touching the file a banner is protecting (docs/app/keeping-work/storage-and-file-format.md#STOR-105). Taken again if the writer
    // typed while it was being kept.
    let kept: string | null = null;
    let keptText: string | null = null;
    for (let pass = 0; pass < 5 && sessionRef.current === session; pass++) {
      const text = captureUnsaved();
      if (text === null || text === keptText) break;
      const name = await snapshotBuffer("collision");
      if (name === null) {
        kept = null;
        break;
      }
      kept = name;
      keptText = text;
    }
    // Safe only if what is in the buffer NOW is what was kept: a keystroke
    // during the last pin is in no version yet.
    const now = sessionRef.current === session ? captureUnsaved() : keptText;
    if (kept !== null && sid && playId && (now === null || now === keptText)) {
      // In Versions now, so the recovery snapshot has nothing left to guard.
      void recoveryRef.current?.saved({ playId, scriptId: sid });
      setPreserved((p) => [...p, kept]);
      if (!failed) return { safe: true, message: "Unsaved edits were kept in Versions." };
      const keptWhy = `“${title}” couldn't be saved, so its unsaved words were kept in Versions.`;
      // Its refusal said the words were here and would save: say why they went.
      const refused = refusedRef.current.get(`script:${sid}`);
      if (!refused) return { safe: true, message: keptWhy };
      const cause = saveProblem(refused.refusal, refused.subject);
      return { safe: true, message: { title: keptWhy, detail: cause.title, code: cause.code } };
    }
    const recovered = (await recoveryRef.current?.writeNow()) === true;
    return { safe: false, title, why: kept !== null ? "still-changing" : "not-kept", recovered };
  }, [landOpenScript, snapshotBuffer, captureUnsaved]);

  /**
   * Look for a recovery snapshot left by a run that stopped before a flush
   * could land it, and act on the policy (recovery-policy.ts): delete one the
   * file already agrees with; otherwise keep its words in Versions, pinned, and
   * offer them when they are newer than the file. Nothing is applied here.
   *
   * Every abandoned owner is independent of the new editor's recovery file.
   * All eligible copies are offered in order, with pinned versions behind them.
   */
  const checkRecovery = useCallback(
    async (playId: string, item: BinderItem, fileText: string) => {
      if (!item.path) return;
      const scriptId = item.id;
      const check = ++recoveryCheckRef.current;
      const gen = workspaceGenRef.current;
      try {
        const files = await recovery.list(playId, scriptId);
        const offers = await reviewRecoveryFiles(files, {
          fileModifiedMs: await modifiedMsOf(item.path),
          sameContent: (text) => sameScriptText(text, fileText, canonicalFountain),
          keep: (text) => versions.snapshot(playId, scriptId, "recovery", text),
          remove: (owner) => recovery.remove(playId, scriptId, owner),
        });
        if (activeScriptIdRef.current !== scriptId || gen !== workspaceGenRef.current || check !== recoveryCheckRef.current) return;
        const queue = offers.map((offer) => ({ ...offer, playId, scriptId, title: titleOf(item) }));
        recoveryQueueRef.current = queue;
        setRecoveryOffer(queue.shift() ?? null);
      } catch {
        /* Every old owner stays intact; new typing has its own recovery file. */
      }
    },
    [],
  );

  /*
   * An open is a read, then a swap. Only the LATEST open may swap: one whose
   * read comes back after the writer has asked for something else — another
   * script, the script already open, another play — is dropped.
   *
   * Nothing points at the new script until its words are in hand. The refs
   * used to move before the read, so for as long as the read was out (a script
   * still downloading from iCloud) the path named one script while the buffer
   * and session were another's — and an autosave in that window wrote the old
   * script's words into the new script's file.
   */
  const openSeqRef = useRef(0);
  const openPendingRef = useRef(false);
  /**
   * True while a workspace is being torn down, and bumped when that is done:
   * an open begun in a workspace that has since gone must never swap into
   * whatever replaced it (a vault scoped to the Plays folder, where a script's
   * relative path would write a stray file at its root).
   */
  const closingRef = useRef(false);
  const workspaceGenRef = useRef(0);
  /**
   * What the last quit left to say about the play just opened (quit-note.ts),
   * held while its script opens: a script that opens retires whatever was said
   * before it, and on the first try this went with it, unseen, and its note
   * with it. Said once, and only then is the note removed.
   */
  const quitNoteRef = useRef<{ playId: string; message: string | SaveProblem } | null>(null);
  const sayQuitNote = useCallback(() => {
    const note = quitNoteRef.current;
    if (!note || note.playId !== playIdRef.current) return;
    quitNoteRef.current = null;
    setError(note.message);
    void playStore.remove(note.playId, KEPT_AT_QUIT).catch(() => {});
  }, []);
  /** So an open can hand a missed outside change to the one judge of it, declared below. */
  const handleExternalChangeRef = useRef<(e: { relPath: string; hash: string | null }) => void>(() => {});

  const openScript = useCallback(
    async (item: BinderItem) => {
      if (!item.path || closingRef.current) return;
      const seq = ++openSeqRef.current;
      const gen = workspaceGenRef.current;
      const latest = () => seq === openSeqRef.current && gen === workspaceGenRef.current;
      // Asking for the script that is already open cancels an open still reading.
      if (item.id === activeScriptIdRef.current) {
        openPendingRef.current = false;
        return;
      }
      openPendingRef.current = true;

      let loaded: { hash: string; content: string };
      try {
        loaded = await vault.read(item.path);
      } catch (e) {
        // A read can fail for a reason that is not "the file is broken": on iOS
        // the bytes may still be in iCloud (docs/engineering/cross-platform.md#PLAT-D103). Nothing
        // points at this script yet, so the one open is still whole; tell the
        // writer, because the alternative is a blank page and silence.
        if (latest()) {
          openPendingRef.current = false;
          setError(String(e));
          setPlaySettled(true);
        }
        return;
      }
      if (!latest()) return;
      // The script being left keeps its words before its buffer is replaced —
      // settled after the read, so what was typed while it was out is kept too.
      const settled = await settleOpenScript();
      if (!latest()) return;
      openPendingRef.current = false;
      if (!settled.safe) {
        // Its words are only in this buffer and a snapshot; replacing the buffer
        // would leave the snapshot alone holding them. Stay.
        setError(
          settled.why === "still-changing"
            ? `“${settled.title}” was still changing, so it stays open for now.`
            : `“${settled.title}” couldn't be saved or kept in Versions, so it stays open. Copy anything you need before switching.`,
        );
        return;
      }
      // Where the script is NOW. It may have been renamed or moved while its
      // open was out — a rename keeps the bytes, so what was read still holds —
      // or it may have left the binder, in which case it is not opened at all.
      const current = findById(playRef.current?.data.binder ?? [], item.id);
      if (!current?.path) return;
      const vaultPath = current.path;

      // The swap. Nothing is awaited from here until the session is in place.
      snapshotPolicyRef.current?.reset(current.id); // first save of a session snapshots
      scriptPathRef.current = vaultPath;
      setScriptPathState(vaultPath);
      activeScriptIdRef.current = current.id;
      applyLoaded(vaultPath, loaded.content);
      const session = new DocumentSession(vaultPath, loaded.hash);
      sessionRef.current = session;
      writeFailedRef.current = null;
      // The script left behind has nothing waiting to save: settling it above
      // landed its words or kept them in Versions, and said which.
      forgetRefused((key) => key.startsWith("script:"));
      setOpenScriptKey(`${playIdRef.current}:${current.id}`);
      // The play opens on this script next time (script-memory.ts).
      if (playIdRef.current) rememberScript(playIdRef.current, current.id);
      // Recovery snapshots follow the open script. An offer belongs to the
      // script it was made for; its words are in Versions whatever happens.
      setRecoveryOffer((o) => (o?.scriptId === current.id ? o : null));
      const playId = playIdRef.current;
      if (playId) {
        recoveryRef.current?.attach(
          { playId, scriptId: current.id, path: vaultPath },
          captureUnsaved,
        );
        void checkRecovery(playId, current, loaded.content);
      }
      // A change from outside that landed between the read and the swap went by
      // as "not the open script". Look once more, and let the one judge of an
      // outside change decide (docs/app/keeping-work/storage-and-file-format.md#STOR-104): a clean buffer reloads, a dirty one gates.
      void vault.read(vaultPath).then(
        (again) => {
          if (sessionRef.current === session && again.hash !== loaded.hash) {
            handleExternalChangeRef.current({ relPath: vaultPath, hash: again.hash });
          }
        },
        () => {
          /* gone or unreadable now: the watcher and the next write will say */
        },
      );
      const name = titleOf(current);
      setScriptTitle(name);
      // Header {title} falls back to the script's filename when the fountain
      // title page doesn't set one.
      setLayoutMeta((m) => (m.title ? m : { ...m, title: name }));
      setActiveId(current.id);
      setGate(false);
      setStatus("saved");
      // An open that succeeds retires the previous failure. Without this, the
      // "still downloading" notice from a failed attempt keeps hanging over a
      // script that has since opened perfectly — a stale alarm about work that
      // is demonstrably fine. What settling the last script had to say stays.
      setError(settled.message);
      // What the last quit kept of this play is not a failure to retire.
      sayQuitNote();
      // Card records come from the play file, which is already loaded — there
      // is no per-script sidecar to read any more (docs/app/keeping-work/storage-and-file-format.md#STOR-D5). Last, because
      // it awaits: everything above belongs to the swap.
      if (docRef.current) await refreshCards(docRef.current);
    },
    [applyLoaded, refreshCards, settleOpenScript, captureUnsaved, checkRecovery, forgetRefused, sayQuitNote],
  );

  const selectItem = useCallback(
    (item: BinderItem) => {
      setActiveId(item.id);
      if (item.type === "script") {
        // The open script again is a no-op — unless another is still reading,
        // when it is how the writer takes that click back.
        if (item.id !== activeScriptIdRef.current || openPendingRef.current) void openScript(item);
      } else if (item.type === "outline") {
        // The scratchpad's home is the Outline surface, not the generic material
        // editor. Going there rather than opening a second editor on the same
        // file also means there is only ever one live buffer for it.
        setViewState("outliner");
      } else if (item.type !== "folder") {
        void openMaterial(item);
      }
    },
    [openScript, openMaterial],
  );

  /*
   * Neither of these closes an open material any more.
   *
   * They both used to, because there was one frame and one buffer: showing the
   * script MEANT the sheet was gone. With a pane tree a sheet can be open
   * beside the script, and closing it because the writer clicked "Board" would
   * throw away a buffer that is still on screen in another pane — and with it
   * that buffer's hash, which is what makes its next save safe. A material's
   * lifetime now belongs to its TAB: the pane calls closeMaterial(id).
   */
  const setView = useCallback((v: ScriptView) => {
    if (activeScriptIdRef.current) setActiveId(activeScriptIdRef.current);
    setViewState(v);
  }, []);

  // Jump from a board/outline card to its scene in the script (a card is a
  // handle on the page, not a dead tile).
  const openScene = useCallback(
    (ordinal: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      setView("editor");
      // Match extractScenes' boundary priority: `scene` (##), else `sceneHeading`.
      const doc = editor.state.doc;
      let hasScene = false;
      doc.forEach((n) => {
        if (n.type.name === "scene") hasScene = true;
      });
      const boundary = hasScene ? "scene" : "sceneHeading";
      let count = -1;
      let target: number | null = null;
      doc.forEach((node, offset) => {
        if (node.type.name === boundary) {
          count += 1;
          if (count === ordinal) target = offset;
        }
      });
      if (target === null) return;
      const pos = target + 1;
      // Defer until the editor pane is un-hidden so the scroll can measure.
      setTimeout(() => {
        editor.chain().focus().setTextSelection(pos).run();
        // Explicitly, because ProseMirror's own `scrollIntoView()` moves nothing
        // in this layout — which is why clicking a card used to switch to the
        // script and then leave the writer at whatever they were last reading
        // instead of at the scene. See editor/scroll-to.ts.
        scrollPosIntoView(editor.view, pos, { center: true });
      }, 0);
    },
    [setView],
  );

  /**
   * Open the find bar. Routed through here rather than left to the
   * editor's own ⌘F because find has to work from anywhere — reading the board,
   * editing a sheet — and because a document search belongs on the Script
   * surface, so it switches there first. The editor pane must be un-hidden
   * before the bar can focus its field, hence the same deferral openScene uses.
   */
  /**
   * Go to a comment (docs/app/writing/comments.md#COMM-D5) — what clicking a row in the feed
   * means. Same shape as openScene: switch to the Script surface first, then
   * defer, because the pane has to be un-hidden before a scroll can measure.
   */
  const openComment = useCallback(
    (pos: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      setView("editor");
      setTimeout(() => {
        if (!editor.state.doc.nodeAt(pos)) return; // resolved out from under us
        // Never the note's own position: page view hides it, so it has no
        // coordinates to scroll to (commentJumpTarget).
        const target = commentJumpTarget(editor.state, pos) ?? pos;
        editor.chain().focus().setTextSelection(target).run();
        scrollPosIntoView(editor.view, target, { center: true });
        editor.commands.focusComment(pos);
      }, 0);
    },
    [setView],
  );

  const openFind = useCallback(
    (replace = false) => {
      const editor = editorRef.current;
      if (!editor) return;
      setView("editor"); // also closes an open material and re-selects the script
      setTimeout(() => editor.commands.openFind(replace), 0);
    },
    [setView],
  );

  /**
   * The script as it stands right now, in the same canonical Fountain a snapshot
   * holds — so comparing a version against "now" includes edits the autosave
   * has not written yet, which is what a writer means by "now".
   */
  const currentScriptText = useCallback((): string => {
    const doc = docRef.current;
    if (!doc) return "";
    return serialize({ frontMatter: frontMatterRef.current, doc });
  }, []);

  // --- leave the open workspace safely ---
  // Flush (or preserve) any unsaved edits BEFORE the vault reopens at a different
  // root — a write issued after the switch would resolve against the wrong tree.
  // Then reset every per-workspace surface back to blank.
  //
  // Resolves false, and clears nothing, when words could be kept nowhere: not
  // saved, not in Versions, not in a recovery copy. The
  // script switch and the quit already refuse in that state; leaving used to
  // clear the buffers and say so afterwards, when the words were gone.
  const teardownWorkspace = useCallback(async (requireSaved = false): Promise<boolean> => {
    // A script still reading belongs to the workspace that is going: it must
    // not swap itself in afterwards, pointed at a vault that has moved on — and
    // no new open may start while this settles.
    closingRef.current = true;
    workspaceGenRef.current += 1;
    openSeqRef.current += 1;
    openPendingRef.current = false;
    // Leaving cannot be refused the way a script switch is, so words that could
    // be kept nowhere else are in the recovery snapshot now, and the message
    // says so. Open sheets and the outline scratchpad come first: what they
    // hold lands, or is kept in Versions — leaving used to drop both.
    let transition: WorkspaceSettlement;
    try {
      transition = await settleWorkspaceDocuments({
        materials: materials.settle,
        outline: { hasUnsaved: outline.hasUnsaved, settle: outline.keepOutlineInLine, path: outlineNotePathOrHome },
        script: settleOpenScript,
      });
    } finally {
      workspaceGenRef.current += 1;
      closingRef.current = false;
    }
    const { script: settled, lostSheets, unsavedKeys, held } = transition;
    if (held.length) {
      setError(
        `What was typed couldn't be saved or kept anywhere, so the play stays open: ${held.map((t) => `“${t}”`).join(", ")} still ${held.length === 1 ? "holds" : "hold"} it. Copy anything you need, then try again.`,
      );
      return false;
    }
    // A portable copy must contain the latest words, not just an older file with
    // newer words preserved in app data (docs/app/keeping-work/storage-and-file-format.md#STOR-171).
    if (requireSaved && (gateRef.current || sessionRef.current?.dirty || materials.unsafe() || outline.unsafe())) return false;
    await bufferRecoveryRef.current?.captureNow();
    await bufferRecoveryRef.current?.detach();
    recoveryRef.current?.detach();
    recoveryQueueRef.current = [];
    setRecoveryOffer(null);
    documentEpochRef.current += 1;
    setPlaySettled(false);
    sessionRef.current = null;
    scriptPathRef.current = null;
    setScriptPathState(null);
    activeScriptIdRef.current = null;
    setOpenScriptKey(null);
    playRef.current = null;
    playPathRef.current = null;
    playIdRef.current = null;
    playDirRef.current = null;
    changesRef.current = null;
    frontMatterRef.current = {};
    docRef.current = null;
    materials.reset();
    outline.reset();
    setCastHidden([]);
    for (const t of [reconcileTimerRef, appearancesTimerRef]) {
      if (t.current) clearTimeout(t.current);
      t.current = null;
    }
    setLedger([]);
    setMissingItems([]);
    setNewlyFiled(new Set());
    setFormatId(null);
    setLayoutMeta({});
    setFrontMatterState({});
    loadDocIntoEditor({ type: "doc", content: [] });
    setBinder([]);
    setCards([]);
    setActiveId(null);
    setScriptTitle("");
    setPlayTitle("");
    setViewState("editor");
    setGate(false);
    setStatus("idle");
    // Sheets whose saves the disk refused, and whose words went into Versions
    // just now rather than being lost: their toast said "in this window".
    const keptAway = [...refusedRef.current]
      .filter(([key]) => unsavedKeys.has(key))
      .map(([, refused]) => refused)
      .filter(({ subject }) => !lostSheets.includes(subject.kind === "outline" ? "Outline notes" : subject.name));
    forgetRefused(() => true);
    if (!settled.safe) {
      setError(
        `“${settled.title}” couldn't be kept in Versions. If Proscenium could write a recovery copy, it offers the words when the script next opens.`,
      );
    } else if (settled.message) setError(settled.message);
    else if (keptAway.length) {
      const cause = saveProblem(keptAway[0].refusal, keptAway[0].subject);
      setError({
        title: `What was typed in ${keptAway.map(({ subject }) => `“${subject.name}”`).join(", ")} is kept in Versions, because it couldn't be saved.`,
        detail: cause.title,
        code: cause.code,
      });
    }
    return true;
  }, [settleOpenScript, loadDocIntoEditor, materials.settle, outline.hasUnsaved, outline.keepOutlineInLine, outlineNotePathOrHome, forgetRefused]);

  // --- quitting (docs/app/keeping-work/storage-and-file-format.md#STOR-D13, src/app/quit.ts) ---
  /**
   * What a quit waits on. Everything that can land lands, as it does when the
   * writer leaves the play. What cannot is kept where the next launch finds it:
   * the script's words in its recovery snapshot, which the script offers back
   * when it opens (or a pinned version, when the snapshot cannot be written);
   * a document's and the outline notes' in pinned versions, which the play says
   * when it opens, from the note `leave` writes. Resolves with whatever could
   * be kept nowhere, and why.
   *
   * Unlike leaving the play it tears nothing down: a quit that is called off
   * goes on from here, with every word where it was. In line, so a play being
   * left or opened finishes first — its words are that one's to keep.
   */
  const settleForQuit = useCallback(
    (): Promise<QuitSettled> =>
      line(async () => {
        const playId = playIdRef.current;
        const kept: KeptAtQuit[] = [];
        const lost: string[] = [];
        let problem: SaveProblem | null = null;
        /** Words that did not land: kept in Versions, or kept nowhere, and why, when the disk said. */
        const account = (key: string, subject: SaveSubject, inVersions: boolean) => {
          const refused = refusedRef.current.get(key);
          if (inVersions) {
            kept.push({ ...(refused?.subject ?? subject), refusal: refused?.refusal ?? null });
            return;
          }
          lost.push((refused?.subject ?? subject).name);
          if (!problem && refused) problem = saveProblem(refused.refusal, refused.subject, "quitting");
        };

        const documents = await settleQuitDocuments({
          materials: materials.settle,
          outline: { hasUnsaved: outline.hasUnsaved, settle: outline.keepOutlineInLine, path: outlineNotePathOrHome },
        });
        for (const document of documents) {
          const subject: SaveSubject = document.path
            ? saveSubject(document.kind, document.path)
            : { kind: document.kind, name: document.title, folder: "" };
          account(document.key, subject, document.inVersions);
        }

        // The script: landed as autosave may, then the recovery snapshot.
        await landOpenScript();
        const sid = activeScriptIdRef.current;
        const path = scriptPathRef.current;
        if (captureUnsaved() !== null && sid && path) {
          let inSnapshot = false;
          // Again if words arrived while it was written: what quits is what is on the page.
          for (let pass = 0; pass < 3; pass++) {
            const words = captureUnsaved();
            if (words === null || !(await recoveryRef.current?.writeNow())) break;
            if (captureUnsaved() === words) {
              inSnapshot = true;
              break;
            }
          }
          if (!inSnapshot && captureUnsaved() !== null) {
            const pinned = await snapshotBuffer("collision");
            if (pinned !== null) setPreserved((p) => [...p, pinned]);
            account(`script:${sid}`, saveSubject("script", path), pinned !== null);
          }
        }
        await recoveryRef.current?.settle();

        return {
          lost,
          problem,
          leave: async () => {
            if (!playId || kept.length === 0) return;
            await playStore.write(playId, KEPT_AT_QUIT, encodeKeptAtQuit(kept)).catch(() => {});
          },
        };
      }),
    [line, materials.settle, outline.hasUnsaved, outline.keepOutlineInLine, outlineNotePathOrHome, saveSubject, landOpenScript, captureUnsaved, snapshotBuffer],
  );

  // --- read the already-open play ---
  /**
   * Populate the binder from the play file and open the first script. The
   * caller has already `vault.open()`ed the play's own folder, so every path
   * below is relative to the play.
   */
  const loadPlay = useCallback(
    async (dir: string, file: string, loaded: Loaded<PlayFile>, focusScript: string | null = null) => {
      const play = loaded.data;
      const opts = play.settings?.autosave ?? DEFAULT_AUTOSAVE;
      autosaveRef.current = new AutosaveScheduler(opts, () => flushRef.current());

      playRef.current = loaded;
      playPathRef.current = file;
      playIdRef.current = play.id;
      playDirRef.current = dir;
      // Versions and Changes are addressed by play id in app data (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
      const changes = openChanges(play.id);
      changesRef.current = changes;
      snapshotPolicyRef.current = new SnapshotPolicy();
      // Words the last quit kept in Versions because they could not be saved:
      // said the first time the play is open again, once its script has opened
      // (quit-note.ts, `sayQuitNote`). A note nobody can read is removed.
      quitNoteRef.current = null;
      void playStore.read(play.id, KEPT_AT_QUIT).then(
        (raw) => {
          if (raw === null || playIdRef.current !== play.id) return;
          const message = keptAtQuitMessage(decodeKeptAtQuit(raw));
          if (!message) {
            void playStore.remove(play.id, KEPT_AT_QUIT).catch(() => {});
            return;
          }
          quitNoteRef.current = { playId: play.id, message };
          if (!openPendingRef.current) sayQuitNote();
        },
        () => {},
      );

      setFormatId(play.settings?.format ?? null);
      // The play's name is its folder's name (docs/app/keeping-work/storage-and-file-format.md#STOR-D4) — never a field in the file.
      setPlayTitle(dir);
      setBinder(play.binder);
      // A play file newer than this app understands opens READ-ONLY and is
      // never rewritten (docs/app/keeping-work/storage-and-file-format.md#STOR-D14).
      setReadOnly(isReadOnly(play.schemaVersion));
      setMode("workspace");

      // The script that was in front when the play was last open, or the first
      // (script-memory.ts). A script opened from Finder comes to the front instead.
      const inFront = scriptToOpen(play.binder, recallScript(play.id));
      const wanted = focusScript ? findByPath(play.binder, focusScript) : null;
      if (wanted?.type === "script") selectItem(wanted);
      else if (inFront) selectItem(inFront);
      else {
        setError("This play has no script yet.");
        setPlaySettled(true);
      }
      // File anything that landed while the app was closed — another tool's
      // work, another device's, the writer's own. Deliberately after the script
      // opens so the first paint is not waiting on a directory walk.
      void reconcileNowRef.current().then(() => {
        // A script opened from Finder that the binder did not list yet has just
        // been filed; now it can come to the front.
        if (!focusScript || wanted || playDirRef.current !== dir) return;
        const filed = findByPath(playRef.current?.data.binder ?? [], focusScript);
        if (filed?.type === "script") selectItem(filed);
      });
      void changes.readLedger().then((entries) => {
        if (changesRef.current === changes) setLedger(entries);
      });
      // Several `.proscenium` files in one folder is a sync duplicate (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
      // The one named for the folder is the play; the rest are surfaced, never
      // merged and never removed.
      void allPlayFiles().then((all) => {
        const others = all.filter((n) => n !== file);
        if (others.length) setConflictCopies((c) => [...c, ...others]);
      });
    },
    [selectItem, sayQuitNote],
  );

  // --- open the Plays folder ---
  /**
   * The chosen folder is always the Plays folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D2). Its children
   * that hold a `.proscenium` file are the plays; everything else in it is
   * ignored and never shown, and the app writes nothing at the root.
   *
   * There is no longer a second shape to detect. A folder that IS one play was
   * a pre-1.0 layout, and nothing reads that any more (docs/app/keeping-work/storage-and-file-format.md#STOR-D14).
   *
   * Throws on failure so callers choose how to surface it (openFolder shows an
   * error; the startup-restore silently falls back to the welcome screen).
   */
  const openAny = useCallback(
    async (picked: string) => {
      if (!(await teardownWorkspace())) return false;
      const opened = await vault.open(picked);
      setRoot(opened.root);
      setConflictCopies(opened.conflicts);
      setPreserved([]);
      vaultRootRef.current = opened.root;
      setVaultRoot(opened.root);
      // Listed before it is remembered: a folder the app can open but not read
      // (the App Sandbox, before a grant) must not become the folder the next
      // launch reopens — nor cost the one it replaced its bookmark.
      const found = await discoverPlays();
      if(practiceRef.current && opened.root !== practiceRootRef.current && !returningFromPractice.current) {
        practiceRef.current = false; setPracticing(false); practiceReturnRef.current = null;
      }
      // Remember this folder so the next launch reopens it (best-effort).
      // Native retains any durable-access problem for its retry/reauthorise UI.
      if (!practiceRef.current) void settings.setLastVault(opened.root).catch(() => {});
      // Who keeps it, for the one sentence (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
      void vault
        .folderFacts(opened.root)
        .then((f) => vaultRootRef.current === opened.root && setPlaysProviders(f.providers))
        .catch(() => setPlaysProviders([]));
      setPlays(found);
      setMode("picker");
      if (found.length > 0) {
        setPlaysBelow({ root: opened.root, folders: [] });
      } else {
        // A folder with no plays may be the one above the Plays folder
        // (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). Nothing waits for the look inside it: a listing can be
        // slow (a folder still coming down from iCloud), and neither the screen
        // nor the next open may wait on it. The screen offers no first play
        // until the answer is in. An answer that lands after the vault moved
        // on (any teardown between) is dropped.
        const generation = workspaceGenRef.current;
        void discoverPlaysBelow().then((folders) => {
          if (generation === workspaceGenRef.current) {
            setPlaysBelow({ root: opened.root, folders });
          }
        });
      }
      return true;
    },
    [teardownWorkspace],
  );

  /**
   * Enter one play: reopen the vault AT the play's folder, so every path the
   * rest of the app handles is play-relative and needs no prefix.
   *
   * Deliberately does NOT touch lastVault — launch always lands back on the
   * Plays screen.
   */
  const enterPlay = useCallback(
    async (play: VaultPlay, focusScript: string | null = null) => {
      const base = vaultRootRef.current;
      if (!base) return;
      try {
        if (!(await teardownWorkspace())) return;
        const opened = await vault.open(`${base}/${play.dir}`, play.id);
        setRoot(opened.root);
        setConflictCopies(opened.conflicts);
        setPreserved([]);

        // The file may have been renamed in Finder since the scan. Discovery is
        // by extension, so a mismatch never hides a play; the app adopts the
        // name it finds and renames it to match the folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D4).
        let file = (await resolvePlayFile(play.dir)) ?? play.file;
        let loaded = await readPlayFile(file);
        if (loaded.status !== "valid" && loaded.status !== "unsupported") {
          // Keep the original bytes protected and visible; the Plays folder
          // remains the active scope while this raw-file sheet is open.
          await openAny(base);
          setRawPlay({ play: { ...play, file }, text: "raw" in loaded ? loaded.raw : null,
            message: loaded.status === "malformed" ? loaded.message
              : loaded.status === "absent" ? "This play's details are no longer in its folder."
                : "This play's details could not be read. Try again when the folder is available." });
          return;
        }
        setRawPlay(null);
        if (opened.moves?.length) {
          if (loaded.status !== "valid") throw new Error("This play needs a newer Proscenium to finish its file move. Its move record has been kept.");
          const recovered = await recoverBinderMoves(file, loaded, opened.moves);
          loaded = { ...loaded, ...recovered };
        }
        const wanted = playFileName(play.dir);
        if (file !== wanted && !(await vault.exists(wanted))) {
          try {
            await vault.rename(file, wanted);
            file = wanted;
          } catch {
            /* keep the name we found; the play still opens */
          }
        }
        if (practiceRef.current && base === practiceRootRef.current) {
          // Legacy practice can also be opened from its normal Plays picker.
          practiceSourceRef.current = !practiceSessionRef.current || play.dir === "Practice Play"
            ? {session: practiceSessionRef.current, dir: play.dir} : null;
        }
        await loadPlay(play.dir, file, loaded, focusScript);
      } catch (e) {
        // Opening changed the native root before reading/recovering metadata.
        // Return it to the Plays folder before the writer can select again.
        await openAny(base).catch(() => {});
        setError(String(e));
      }
    },
    [teardownWorkspace, loadPlay, openAny],
  );

  const backToVault = useCallback(async () => {
    const base = vaultRootRef.current;
    if (!base) return;
    try {
      await openAny(base); // teardown inside flushes the open buffer first
    } catch (e) {
      setError(String(e));
    }
  }, [openAny]);

  // Scaffold a new play into the open vault and drop straight into it.
  /**
   * Why `path` cannot be the Plays folder, in a sentence, or null (docs/app/keeping-work/storage-and-file-format.md#STOR-D2).
   * `nesting` also refuses a folder inside the Plays folder already open, when
   * that folder holds plays — for a choice made with the panel, not for a
   * play's own folder named from Finder. Facts that cannot be read never block
   * the writer.
   */
  const refusalFor = useCallback(async (path: string, nesting: boolean) => {
    try {
      const facts = await vault.folderFacts(path);
      const open = vaultRootRef.current;
      return playsFolderRefusal(
        facts,
        nesting && open ? { path: open, plays: playsRef.current.length } : null,
      );
    } catch {
      return null;
    }
  }, []);

  /** Whether the app can list `path` without a grant from the panel first. */
  const canListFolder = useCallback(async (path: string): Promise<boolean> => {
    try {
      return (await vault.folderFacts(path)).listable;
    } catch {
      return true;
    }
  }, []);

  const createPlay = useCallback(
    async (title: string, script?: string, keep?: KeptFile): Promise<boolean> => {
      const base = vaultRootRef.current;
      if (!base) return false;
      let published: string | null = null;
      try {
        // A new play belongs in the Plays folder. With a play open the vault is
        // scoped to THAT play, and scaffolding there would put a play inside a
        // play (docs/app/keeping-work/storage-and-file-format.md#STOR-D2) — which is exactly where a file opened from Finder would
        // have landed. Come back out to the Plays folder first.
        if (playDirRef.current !== null && !(await openAny(base))) return false;
        /* A play started FROM a script (a .fountain the writer already has, or
           the sample) hands its text to the scaffolder, which stays the single
           place a play's shape is decided (play-shape.ts). */
        const { dir } = await scaffoldPlayInVault(
          title,
          new Date().toISOString(),
          script,
          // Settings › Formats: the format new plays start in (T3b).
          settingsStore.getSnapshot().defaultFormat ?? undefined,
          // Settings › General: the first status in the list, or none (docs/app/preferences-and-help/settings.md#SET-7).
          settingsStore.getSnapshot().playStatuses[0] ?? null,
          keep,
        );
        published = dir;
        // The scaffold saves an import's original before its discovery signal.
        const refreshed = await discoverPlays();
        setPlays(refreshed);
        const created = refreshed.find((p) => samePath(p.dir, dir));
        if (!created) {
          setError(`“${dir}” was made, but it isn't showing on the Plays screen yet.`);
          return true;
        }
        await enterPlay(created);
        if (playDirRef.current !== dir) {
          setError(`“${dir}” was created in your Plays folder but could not be opened. Open it from the Plays screen; importing again would create another copy.`);
          // Creation succeeded. Do not leave a retryable import after publication.
        }
        return true;
      } catch (e) {
        setError(published ? `“${published}” was created but could not be opened. Open it from your Plays folder rather than importing it again. ${String(e)}` : String(e));
        return published !== null;
      }
    },
    [enterPlay, openAny],
  );

  /**
   * Open one play of the Plays folder by its folder's name — the Finder route
   * (docs/app/keeping-work/storage-and-file-format.md#STOR-D5) — with `script` (play-relative) in front when one was opened.
   */
  const openPlayByDir = useCallback(
    async (dirName: string, script: string | null, inFolder?: string): Promise<boolean> => {
      const base = vaultRootRef.current;
      if (!base) return false;
      // Asked for while another Plays folder was open, and run after a switch:
      // a play of the same name in this folder is a different play.
      if (inFolder !== undefined && !samePath(base, inFolder)) {
        setError(`“${dirName}” is in a folder that isn't your Plays folder now.`);
        return false;
      }
      const bringForward = () => {
        if (!script) return true;
        const item = findByPath(playRef.current?.data.binder ?? [], script);
        if (item?.type === "script") {
          selectItem(item);
          return true;
        }
        return false;
      };
      // Already the open play: bring the script forward, reopen nothing.
      if (playDirRef.current !== null && samePath(playDirRef.current, dirName)) {
        if (!bringForward()) void reconcileNowRef.current().then(bringForward);
        return true;
      }
      try {
        if (playDirRef.current !== null) await openAny(base);
        const found = (await discoverPlays()).find((p) => samePath(p.dir, dirName));
        if (!found) {
          setError(`“${dirName}” isn't in your Plays folder any more.`);
          return false;
        }
        await enterPlay(found, script);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [openAny, enterPlay, selectItem],
  );

  /**
   * Make `path` the Plays folder, for a play opened from somewhere else, or for
   * the folder the Plays screen points to below a Plays folder with no plays. By
   * path when the app can reach it; otherwise — under the App Sandbox a folder
   * is readable only once the writer has picked it — through the folder panel,
   * opened on that folder, so the grant is one click. Nothing is moved.
   */
  const adoptPlaysFolder = useCallback(
    async (path: string): Promise<boolean> => {
      // Refused the same way a panel choice is (docs/app/keeping-work/storage-and-file-format.md#STOR-D2), except for being
      // nested in the Plays folder already open: the writer named this play.
      const refusal = await refusalFor(path, false);
      if (refusal) {
        setError(refusal);
        return false;
      }
      // Under the App Sandbox a folder the writer has not picked cannot be
      // read, so the panel comes first — before anything open is closed, so a
      // Cancel leaves the writer exactly where they were.
      if (await canListFolder(path)) {
        try {
          await openAny(path);
          return true;
        } catch {
          /* readable a moment ago; the panel is the way in now */
        }
      }
      try {
        const picked = await vault.pickFolder(path);
        if (!picked) return false;
        const again = await refusalFor(picked, false);
        if (again) {
          setError(again);
          return false;
        }
        await openAny(picked);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [openAny, refusalFor, canListFolder],
  );

  /**
   * The Plays screen's answer when the Plays folder looks chosen one level too
   * high (docs/app/keeping-work/storage-and-file-format.md#STOR-D12): `dir`, a folder inside it, becomes the Plays folder.
   * Refused and granted as a folder named from Finder is. Being inside the
   * Plays folder open now is never a reason to refuse it here; moving down into
   * that folder is the whole point.
   *
   * `from` is the Plays folder the question was asked about, as the screen
   * showed it. A second click that waited its turn behind the first finds
   * another folder open, and does nothing. Resolves to whether it opened.
   */
  const openFolderBelow = useCallback(
    async (from: string | null, dir: string): Promise<boolean> => {
      if (!from || vaultRootRef.current === null || !samePath(vaultRootRef.current, from)) {
        return false;
      }
      return adoptPlaysFolder(`${from}/${dir}`);
    },
    [adoptPlaysFolder],
  );

  // Edit a play's dashboard metadata from the picker (status / logline).
  // Optimistic: patch the in-memory row immediately, then persist + re-scan.
  const updatePlay = useCallback(
    async (dir: string, patch: { status?: string; logline?: string }) => {
      setPlays((ps) => ps.map((p) => (p.dir === dir ? { ...p, ...patch } : p)));
      try {
        const file = plays.find((p) => p.dir === dir)?.file ?? playFileName(dir);
        const ok = await updatePlayMeta(dir, file, patch, new Date().toISOString());
        if (ok) setPlays(await discoverPlays());
        else setError("Couldn't save the change — the play changed on disk.");
      } catch (e) {
        setError(String(e));
      }
    },
    [plays],
  );

  const openFolder = useCallback(async () => {
    try {
      // Where there is no folder picker (mobile — plugins-workspace#933), the
      // app's own Documents directory is the Plays folder: "On My iPad", the
      // one location that needs no grant. Branching on the capability rather
      // than the platform keeps this honest as the picker plugin lands — this
      // line stops being special the day canPickFolder turns true on mobile.
      const { canPickFolder, pickerShowsMessage } = await platform.capabilities();
      if (!canPickFolder) {
        await openAny(await vault.defaultRoot());
        return;
      }
      // A folder that cannot be the Plays folder brings the panel straight
      // back with the reason as its message (docs/app/keeping-work/storage-and-file-format.md#STOR-D2), until the writer
      // picks one that can, or cancels. Bounded, so a panel that stopped
      // asking could never spin. A picker with nowhere to show the reason
      // (iOS) is not brought back unexplained: the reason is said instead.
      let message: string | undefined;
      for (let attempt = 0; attempt < 8; attempt++) {
        const picked = await vault.pickFolder(undefined, message);
        if (!picked) return;
        const refusal = await refusalFor(picked, true);
        if (!refusal) {
          await openAny(picked);
          return;
        }
        message = refusal;
        if (!pickerShowsMessage) break;
      }
      if (message) setError(message);
    } catch (e) {
      setError(String(e));
    }
  }, [openAny, refusalFor]);

  /**
   * Put the plays in the app's own iCloud Drive container — the recommended
   * answer to the welcome screen's one question (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
   *
   * It needs no folder panel and no bookmark, because it is ours.
   */
  const openCloudFolder = useCallback(async () => {
    try {
      const root = await vault.cloudRoot();
      if (!root) {
        setError("iCloud Drive isn't available. Choose a folder instead.");
        return;
      }
      await openAny(root);
    } catch (e) {
      setError(String(e));
    }
  }, [openAny]);

  /**
   * Where the plays live, in one sentence (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
   *
   * The last clause is the one that must exist — a writer whose plays are on
   * this Mac alone should never find that out from a backup they didn't have.
   * Everything before it is a should, and detection beyond "is it in iCloud"
   * can follow real usage.
   */
  const wherePlaysLive = useMemo(
    () => (vaultRoot ? wherePlaysLiveSentence(playsProviders) : ""),
    [vaultRoot, playsProviders],
  );

  /**
   * What the Plays screen asks before it offers a first play (docs/app/keeping-work/storage-and-file-format.md#STOR-D12).
   * Null while the folders inside have not been looked into for THIS Plays
   * folder, which is also when the screen offers nothing.
   */
  const foldersBelow = vaultRoot && playsBelow?.root === vaultRoot ? playsBelow.folders : null;
  const playsFolderHint = useMemo(
    () => (foldersBelow && keptFolder !== vaultRoot ? hintFor(plays.length, foldersBelow) : null),
    [foldersBelow, keptFolder, vaultRoot, plays.length],
  );

  // On launch, reopen the last folder — a plays vault lands on the picker, a
  // standalone workspace opens directly. A stale/unreadable path makes
  // vault.open reject → we stay on the empty state. Runs once (the ref guard
  // also covers React.StrictMode's double-mount in dev).
  const bootstrappedRef = useRef(false);
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    void (async () => {
      try {
        // reopenLastVault, not getLastVault: on iOS the durable thing is the
        // security-scoped bookmark, not the path, so re-granting access happens
        // inside this call (and a bookmark iOS renewed gets re-persisted there).
        const last = await settings.reopenLastVault();
        if (last) await line(() => openAny(last));
      } catch {
        /* last folder gone — remain on the empty overlay */
      } finally {
        // Files opened from Finder wait for this: where a play goes depends on
        // which Plays folder is open.
        setBooted(true);
      }
    })();
  }, [openAny]);

  const onEditorReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
    setEditor(editor);
    // Keep a note of where the caret is, so reopening the play lands there
    // instead of on the title page. Held in a ref and written on a timer: this
    // fires on every arrow key, and localStorage is not for per-keystroke work.
    editor.on("selectionUpdate", () => {
      if (loadingRef.current) return; // the load's own selection, not the writer's
      const path = scriptPathRef.current;
      if (!path) return;
      const key = practiceRef.current && vaultRootRef.current === practiceRootRef.current && playIdRef.current ? `practice:${playIdRef.current}/${path}` : path;
      caretPendingRef.current = { path: key, pos: editor.state.selection.from };
      if (caretTimerRef.current !== null) return;
      caretTimerRef.current = window.setTimeout(() => {
        caretTimerRef.current = null;
        const pending = caretPendingRef.current;
        if (pending) rememberCaret(pending.path, pending.pos);
      }, CARET_SAVE_MS);
    });
  }, []);
  const onEditorChange = useCallback((doc: Doc) => {
    // Ignore the editor's initial mount update and edits with no script open.
    if (loadingRef.current || !sessionRef.current) return;
    docRef.current = doc;
    sessionRef.current.markDirty();
    setStatus("dirty");
    autosaveRef.current?.schedule();
    recoveryRef.current?.dirty();
  }, []);
  const onSaveShortcut = useCallback(() => {
    // An explicit save also retries a refused write after its timer has fired.
    // The ordinary flush still owns conflict and read-only checks.
    autosaveRef.current?.cancel();
    flushRef.current();
  }, []);

  const reloadFromDisk = useCallback(async () => {
    const path = scriptPathRef.current;
    const session = sessionRef.current;
    const sid = activeScriptIdRef.current;
    const playId = playIdRef.current;
    if (!path || !session) return;
    // Two reloads for two quick changes from outside can finish out of order;
    // only the latest asked-for one may land, or the older read would win.
    const seq = ++reloadSeqRef.current;
    const stillOpen = () => sessionRef.current === session && seq === reloadSeqRef.current;
    /*
     * The buffer is about to be replaced by the on-disk state; preserve ours as
     * a version first (dedup makes this free when nothing was unsaved).
     *
     * The reason distinguishes the two cases, and the ring's pruning depends on
     * it: a reload of a CLEAN buffer risks nothing, so `pre-reload` is prunable.
     * A reload the writer chose at a banner is giving up unsaved words, and
     * `pre-reload-at-banner` is pinned forever (docs/app/keeping-work/storage-and-file-format.md#STOR-D10).
     */
    const atBanner = gateRef.current;
    const reason = atBanner ? "pre-reload-at-banner" : "pre-reload";
    let edits = session.editCount;
    let kept = await snapshotBuffer(reason);
    let fresh: { content: string; hash: string };
    try {
      fresh = await vault.read(path);
    } catch (e) {
      if (stillOpen()) setError(String(e));
      return;
    }
    if (!stillOpen()) return;
    if (session.editCount !== edits) {
      if (!atBanner) {
        // Typed while the file was being read. Those are unsaved edits now, and
        // a change from outside never reloads over unsaved edits (docs/app/keeping-work/storage-and-file-format.md#STOR-104).
        const decision = session.onExternalChange(fresh.hash);
        if (decision.kind === "dirty-gate") {
          setGate(true);
          setStatus("conflict");
        }
        return;
      }
      // The writer chose the other version at the banner; what they typed
      // since goes into Versions with the rest. Still typing: leave it all be.
      edits = session.editCount;
      kept = await snapshotBuffer(reason);
      if (!stillOpen() || session.editCount !== edits) return;
    }
    const unsaved = session.dirty;
    if (unsaved && kept === null && sid) {
      // Not in Versions. Retire this recovery owner after keeping these words;
      // continued typing gets a new file and cannot overwrite the only copy.
      const recovered = (await recoveryRef.current?.writeNow()) === true;
      if (!stillOpen() || session.editCount !== edits) return;
      if (!recovered) {
        // Kept nowhere: the buffer is the only copy, and it stays rather than being
        // replaced by the file on disk. The banner stays with it.
        setError(
          "The unsaved words couldn't be kept in Versions or as a recovery copy, so they stay in the editor. Copy anything you need, then choose again.",
        );
        return;
      }
      recoveryRef.current?.keepAndContinue();
    }
    applyLoaded(path, fresh.content);
    session.confirmReloaded(fresh.hash);
    // The buffer is the file now, and what it held is the version above.
    if (sid && playId && (kept !== null || !unsaved)) {
      void recoveryRef.current?.saved({ playId, scriptId: sid });
    }
    autosaveRef.current?.cancel();
    setGate(false);
    setStatus("saved");
    if (docRef.current) await refreshCards(docRef.current); // re-reconcile cards
  }, [applyLoaded, refreshCards, snapshotBuffer]);

  reloadFromDiskRef.current = reloadFromDisk;

  const loadTheirs = useCallback(() => {
    void reloadFromDisk();
  }, [reloadFromDisk]);

  const keepMine = useCallback(async () => {
    const session = sessionRef.current;
    const path = scriptPathRef.current;
    const playId = playIdRef.current;
    const sid = activeScriptIdRef.current;
    if (!session || !path || !docRef.current) return;
    const stillOpen = () => sessionRef.current === session;
    try {
      /*
       * Pin a version of THEIRS before ours replaces it (docs/app/keeping-work/storage-and-file-format.md#STOR-105).
       *
       * The bytes come from disk, not the session — theirs is what is on disk,
       * and it is about to stop being. The pre-1.0 code copied it to a conflict
       * sibling beside the play; a pinned version keeps the same guarantee
       * somewhere the writer can actually use, and leaves the folder theirs.
       */
      if (!playId || !sid) return;
      let expected: string;
      let theirs: { content: string; hash: string } | null = null;
      try {
        theirs = await vault.read(path);
      } catch {
        // Gone, or there and unreadable here — bytes that are not text, or a
        // download that has not finished. Only gone is safe to write over: the
        // folder listing counts a file whose bytes are still in iCloud.
        if (await isListed(path)) {
          setError("The other version can't be read here, so it was left in place. Your words are still in this window.");
          return;
        }
      }
      if (theirs) {
        try {
          const pinned = await versions.snapshot(playId, sid, "pre-keep", theirs.content);
          setPreserved((p) => [...p, pinned]);
        } catch {
          // Ours would replace the only copy of theirs. Both stay as they are.
          setError("The other version couldn't be kept in Versions, so nothing was replaced.");
          return;
        }
        // Replace exactly what was just kept. If the file changes again
        // first, the write below collides rather than losing that too.
        expected = theirs.hash;
      } else {
        // Nothing there: write only where nothing still is.
        expected = NO_FILE_YET;
      }
      if (!stillOpen() || !docRef.current) return;
      // Taken now, not before the awaits above: words typed while theirs was
      // being kept belong in what replaces it.
      const content = serialize({ frontMatter: frontMatterRef.current, doc: docRef.current });
      const carried = session.editCount;
      const outcome = await scriptWrites(async () => {
        const out = await vault.write(path, content, expected);
        if (out.status === "ok") session.confirmPromoted(out.hash, carried);
        return out;
      });
      if (outcome.status === "ok") {
        if (!session.dirty && playId && sid) {
          void recoveryRef.current?.saved({ playId, scriptId: sid });
        }
        saveLanded(`script:${sid}`);
        if (!stillOpen()) return;
        setGate(false);
        if (session.dirty) {
          setStatus("dirty");
          autosaveRef.current?.schedule();
        } else setStatus("saved");
      } else {
        // It changed again after theirs was kept. The banner stays up, and is
        // about that newest version now.
        session.onExternalChange(outcome.hash);
        if (stillOpen()) setStatus("conflict");
      }
    } catch (e) {
      setError(changeRefused(e, "script", path));
    }
  }, [saveLanded, changeRefused]);

  // --- corkboard / outliner ---
  const setCard = useCallback(async (sceneId: string, partial: Partial<Card>) => {
    const base = playRef.current;
    const playPath = playPathRef.current;
    const scriptId = activeScriptIdRef.current;
    const playId = playIdRef.current;
    if (!base || !playPath || !scriptId) return;
    try {
      /*
       * Card metadata lives in the play file and never touches the `.fountain`
       * (docs/app/keeping-work/storage-and-file-format.md#STOR-D6: Fountain has nowhere to put a colour). The patch is
       * re-applied to whatever base wins, so an outside card edit landing
       * mid-write merges instead of colliding.
       */
      const committed = await commitPlay(
        playPath,
        base,
        (prior) => {
          const from = prior ?? base.data;
          const data = scriptDataFor(from, scriptId);
          return withScriptData(from, scriptId, {
            ...data,
            scenes: data.scenes.map((s) =>
              s.id === sceneId ? { ...s, card: { ...s.card, ...partial } } : s,
            ),
          });
        },
        new Date().toISOString(),
      );
      // Landed after the writer left the play, or the script: the record is
      // written, and nothing here belongs on screen any more.
      if (playIdRef.current !== playId) return;
      if (committed.status === "ok") {
        playRef.current = { data: committed.data, hash: committed.hash };
        // Re-derive the view models: the stored records changed, and act,
        // heading and synopsis come from the doc, not the file.
        const doc = docRef.current;
        if (doc && activeScriptIdRef.current === scriptId) {
          setCards(
            reconcileCards({ doc, prior: scriptDataFor(committed.data, scriptId) }).cards,
          );
        }
      } else setError("This play changed on disk — reopen it to see the change.");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  /**
   * Put a script typed on meanwhile onto the page, replacing only what differs
   * from the page, so the caret stays where the writer is typing (a scene moved
   * elsewhere in the play leaves it alone). A transaction, not a load: it is an
   * edit, and autosave saves it.
   */
  const rebaseEditor = useCallback((doc: Doc) => {
    const ed = editorRef.current;
    if (!ed) return;
    const next = ed.schema.nodeFromJSON(toEditorDoc(ensureNonEmpty(doc)));
    const cur = ed.state.doc;
    const start = cur.content.findDiffStart(next.content);
    if (start === null || start === undefined) return;
    const end = cur.content.findDiffEnd(next.content);
    if (!end) return;
    let { a, b } = end;
    const overlap = start - Math.min(a, b);
    if (overlap > 0) {
      a += overlap;
      b += overlap;
    }
    const tr = ed.state.tr.replace(start, a, next.slice(start, b));
    tr.setMeta("addToHistory", false);
    ed.view.dispatch(tr);
  }, []);

  /**
   * Write a change the board or Versions made to the open script — a card
   * moved, a synopsis set, a scene added, a whole script put back — and show it
   * once it has landed, so a refused write changes nothing.
   *
   * The writer can type while it is out, and those words are not in what
   * landed. The change used to be loaded over them when it landed, and they
   * were gone, while an autosave queued behind it wrote the page from before the
   * change over the change. Now:
   * - `redo` makes the same change on the page as it stands, and the page
   *   takes only the difference, so autosave saves the typing on top of the
   *   change. `redo` returns null when the page's scenes are no longer the ones
   *   the change named: the typing stays, the change is not made, the writer
   *   is told.
   * - Without `redo` (a whole script put back), the page is kept in Versions
   *   first, then replaced.
   */
  const writeScriptDoc = useCallback(
    async (newDoc: Doc, redo?: (page: Doc) => Doc | null): Promise<string | null> => {
      const path = scriptPathRef.current;
      const session = sessionRef.current;
      const sid = activeScriptIdRef.current;
      const playId = playIdRef.current;
      // No session means no script is open, and a write without one would go
      // out unguarded.
      if (!path || !session) return null;
      const content = serialize({ frontMatter: frontMatterRef.current, doc: newDoc });
      // Same in-flight bracket as the autosave flush: a board move or an
      // applied restore is still OUR write, and its echo must not gate. The
      // edit count says whether anything was typed while it was out.
      const carried = session.beginWrite();
      // The page is brought up to date inside this turn of the line: a save
      // queued behind it must not go out while the page still lacks the change.
      return scriptWrites(async () => {
        let out;
        try {
          out = await vault.write(path, content, session.expectedForWrite);
        } catch (e) {
          session.abortWrite();
          throw e;
        }
        session.onSaved(out, carried);
        if (out.status === "ok") {
          if (!session.dirty && sid && playId) void recoveryRef.current?.saved({ playId, scriptId: sid });
          // It carried the buffer's words, so a refused autosave has landed too.
          if (writeFailedRef.current === session) writeFailedRef.current = null;
          saveLanded(`script:${sid ?? path}`);
        }
        // The writer moved to another script while this was out. What landed is
        // this script's; nothing after this may touch the editor, which is
        // showing the other one now.
        if (sessionRef.current !== session) return null;
        // Decide anything the watcher sent mid-write: echoes of this write
        // resolve as "unchanged", a real external edit still surfaces.
        const deferred = session.drainDeferred();
        if (deferred?.kind === "dirty-gate" || deferred?.kind === "reload") {
          setGate(true);
          setStatus("conflict");
        }
        if (out.status !== "ok") {
          setError("The script changed on disk — reload before editing the board.");
          return null;
        }
        if (session.editCount === carried) {
          loadDocIntoEditor(newDoc); // keep the editor in sync, without marking dirty
          return out.hash;
        }
        // Typed while the change was out: those words are on the page only.
        const page = docRef.current;
        if (redo) {
          const rebased = page ? redo(page) : null;
          if (!rebased) {
            // The page keeps the typing; saving it undoes the change on disk.
            setError("The scenes changed while that change was being saved, so it wasn't made. Make it again.");
            autosaveRef.current?.schedule();
            return null;
          }
          rebaseEditor(rebased);
          return out.hash;
        }
        // A whole script put back over words typed meanwhile: they are kept in
        // Versions before the page is replaced, and kept again if more arrive
        // while that is being done.
        let pinned: string | null = null;
        for (let tries = 0; tries < 5; tries++) {
          const edits = session.editCount;
          pinned = await snapshotBufferRef.current("collision");
          if (sessionRef.current !== session) return null;
          if (!pinned || session.editCount === edits) break;
          const kept = pinned;
          setPreserved((p) => [...p, kept]);
          pinned = null;
        }
        if (!pinned) {
          setError("What was typed while the script was being replaced couldn't be kept in Versions, so it stays on the page.");
          autosaveRef.current?.schedule();
          return null;
        }
        const kept = pinned;
        setPreserved((p) => [...p, kept]);
        loadDocIntoEditor(newDoc);
        // The page is what landed now; with a choice up, the choice decides.
        if (session.canAutosave) session.confirmReloaded(out.hash);
        setStatus(session.dirty ? "dirty" : "saved");
        return out.hash;
      });
    },
    [loadDocIntoEditor, saveLanded, rebaseEditor],
  );

  const reorderScene = useCallback(
    async (from: number, to: number) => {
      const doc = docRef.current;
      const base = playRef.current;
      const playPath = playPathRef.current;
      const scriptId = activeScriptIdRef.current;
      const playId = playIdRef.current;
      if (!doc || !base || !playPath || !scriptId) return;
      const newDoc = moveSceneInDoc(doc, from, to);
      if (newDoc === doc) return;
      const scriptPath = scriptPathRef.current;
      let scriptMoved = false;
      try {
        const redo = (page: Doc) => (sameSceneOutline(doc, page) ? moveSceneInDoc(page, from, to) : null);
        if ((await writeScriptDoc(newDoc, redo)) === null) return;
        scriptMoved = true;
        // App-driven move: carry cards + refresh anchors directly, so the next
        // load-reconcile is a no-op rather than having to infer the move.
        const moved = reorderSceneCards(cardsRef.current, from, to, newDoc);
        setCards(moved);
        const committed = await commitPlay(
          playPath,
          base,
          (prior) => {
            const from_ = prior ?? base.data;
            const data = scriptDataFor(from_, scriptId);
            return withScriptData(from_, scriptId, {
              ...data,
              scenes: moved.map(toRecord),
            });
          },
          new Date().toISOString(),
        );
        if (committed.status === "ok" && playIdRef.current === playId) {
          playRef.current = { data: committed.data, hash: committed.hash };
        }
        // Words typed while the move was out are on the page, not yet on disk.
        if (activeScriptIdRef.current === scriptId) setStatus(sessionRef.current?.dirty ? "dirty" : "saved");
      } catch (e) {
        // Refused before the script moved: nothing changed, in the writer's words.
        setError(scriptMoved ? String(e) : changeRefused(e, "script", scriptPath));
      }
    },
    [writeScriptDoc, changeRefused],
  );

  const editSynopsis = useCallback(
    async (ordinal: number, text: string) => {
      const doc = docRef.current;
      if (!doc) return;
      const newDoc = setSceneSynopsis(doc, ordinal, text);
      const scriptPath = scriptPathRef.current;
      try {
        const redo = (page: Doc) =>
          sameSceneOutline(doc, page) ? setSceneSynopsis(page, ordinal, text) : null;
        const fountainHash = await writeScriptDoc(newDoc, redo);
        if (fountainHash === null) return;
        // The page, which may hold words typed while the change was out.
        await refreshCards(docRef.current ?? newDoc);
        setStatus(sessionRef.current?.dirty ? "dirty" : "saved");
      } catch (e) {
        setError(changeRefused(e, "script", scriptPath));
      }
    },
    [writeScriptDoc, refreshCards, changeRefused],
  );

  /**
   * Add a scene from the board. It goes through `writeScriptDoc` and then the
   * ordinary card refresh, exactly like a synopsis edit — the card that
   * appears is reconciled from the script, not invented beside it, so the board
   * stays a lens on the file even when the gesture started on the board.
   */
  const addScene = useCallback(
    async (title?: string) => {
      const doc = docRef.current;
      if (!doc) return;
      const newDoc = addSceneToDoc(doc, title);
      const scriptPath = scriptPathRef.current;
      try {
        const fountainHash = await writeScriptDoc(newDoc, (page) => addSceneToDoc(page, title));
        if (fountainHash === null) return;
        await refreshCards(docRef.current ?? newDoc);
        setStatus(sessionRef.current?.dirty ? "dirty" : "saved");
      } catch (e) {
        setError(changeRefused(e, "script", scriptPath));
      }
    },
    [writeScriptDoc, refreshCards, changeRefused],
  );

  // --- binder ops (unit G) ---
  /** A binder op, run now. Only from inside the line — everything else calls `runBinderOp`. */
  const binderOpNow = useCallback(
    async (
      fn: (ctx: BinderContext) => Promise<ApplyResult>,
      affects: { id: string; deletes?: boolean } | null = null,
    ): Promise<ApplyResult | undefined> => {
      const base = playRef.current;
      const playPath = playPathRef.current;
      if (!base || !playPath || readOnlyRef.current) return undefined;
      // An op on the open script, or on a folder it is in, moves or removes the
      // file its buffer writes to. Pending words land first — awaited, because a
      // write that lands after a rename recreates the old name with the new
      // words. A delete takes the buffer with it, so words that cannot land go
      // into Versions first, and without that nothing is deleted.
      const openId = activeScriptIdRef.current;
      if (affects && openId && holdsItem(base.data.binder, affects.id, openId)) {
        if (affects.deletes) {
          const settled = await settleOpenScript();
          if (!settled.safe) {
            setError(
              settled.why === "still-changing"
                ? `“${settled.title}” was still changing, so nothing was moved to the Trash.`
                : `“${settled.title}” couldn't be saved or kept in Versions, so nothing was moved to the Trash.`,
            );
            return undefined;
          }
          if (settled.message) setError(settled.message);
        } else {
          await landOpenScript();
          if (sessionRef.current?.canAutosave) autosaveRef.current?.schedule();
        }
      }
      const ctx: BinderContext = { playPath, play: base.data, hash: base.hash };
      // Any open document about to be renamed or relocated must finish writing
      // FIRST. Its buffer is keyed by a path; a write still in flight when the
      // rename lands would arrive at a path that no longer exists, and would be
      // refused — costing the writer a banner over a rename they just made.
      await flushAllMaterials();

      const res = await fn(ctx);
      if (res.ok) {
        playRef.current = { data: res.play, hash: res.hash };
        setBinder(res.play.binder);

        /**
         * Follow every OPEN MATERIAL to wherever the op put it.
         *
         * This used to be done for the script alone, and the omission was
         * quietly destructive: a material's buffer remembers the path it was
         * read from, so renaming or re-filing a sheet that was open in a pane
         * left the buffer pointing at a path that no longer existed. The next
         * autosave then RECREATED the old filename with the new text — the
         * writer ended up with a ghost file under the old name and a file
         * under the new name that never received a single edit they made after
         * the rename. Re-pointing the buffer (and the item behind the page
         * header, so its title is the file's real name) is the whole fix.
         */
        materials.applyBinder(res.play.binder, true);

        // If the open script moved/renamed, follow its new path + title.
        const openId = activeScriptIdRef.current;
        if (openId) {
          const moved = findById(res.play.binder, openId);
          if (moved) setScriptTitle(titleOf(moved));
          if (moved?.path) {
            const newVaultPath = moved.path;
            if (newVaultPath !== scriptPathRef.current && sessionRef.current) {
              // The same session follows the file: a rename changes no bytes, so
              // its hash still holds — and so do its unsaved edits, which a
              // fresh session used to mark clean.
              scriptPathRef.current = newVaultPath;
              setScriptPathState(newVaultPath);
              recoveryRef.current?.moved(newVaultPath);
            }
          } else if (!moved) {
            // open script was deleted — reset the editor + board surfaces
            recoveryRef.current?.detach();
            setRecoveryOffer(null);
            scriptPathRef.current = null;
            setScriptPathState(null);
            activeScriptIdRef.current = null;
            setOpenScriptKey(null);
            sessionRef.current = null;
            loadDocIntoEditor({ type: "doc", content: [] });
            setCards([]);
            setScriptTitle("");
            setStatus("idle");
          }
        }
      } else if (res.blocked) {
        readOnlyRef.current = true;
        setReadOnly(true);
        autosaveRef.current?.cancel();
        setError(res.message ?? "A file move needs recovery. Reopen the play before writing.");
      } else if (res.reason === "collision") {
        setError("This play changed on disk — reopen it to continue.");
      } else setError(res.message ?? "binder operation failed");
      return res;
    },
    [loadDocIntoEditor, flushAllMaterials, landOpenScript, settleOpenScript, unsavedTextsOf, materials.applyBinder],
  );

  /**
   * A binder op, in the same line as opening a play or a Plays folder. It can
   * wait on a slow write before it moves anything, and leaving the play used to
   * go ahead meanwhile: the op then ran its play-relative paths against the
   * Plays folder, and wrote a play file at its root. In line, leaving waits for
   * the op; and an op asked for in one play is done in that play or not at all.
   */
  const runBinderOp = useCallback(
    (
      fn: (ctx: BinderContext) => Promise<ApplyResult>,
      affects: { id: string; deletes?: boolean } | null = null,
    ): Promise<ApplyResult | undefined> => {
      const playId = playIdRef.current;
      return line(() =>
        playId !== null && playIdRef.current === playId
          ? binderOpNow(fn, affects)
          : Promise.resolve(undefined),
      );
    },
    [binderOpNow, line],
  );

  const reorder = useCallback(
    (id: string, toIndex: number) => void runBinderOp((c) => reorderItem(c, id, toIndex)),
    [runBinderOp],
  );
  /**
   * Make the binder agree with the folder (docs/app/keeping-work/storage-and-file-format.md#STOR-D8).
   *
   * **The binder is the folder.** A file that arrived while the app was closed
   * — another tool's, another device's, the writer's own in Finder — is filed
   * at the end of the folder it sits in, and a directory that appeared becomes
   * a binder folder. Nothing is moved, renamed, or rewritten: the file stays
   * exactly where whoever made it put it.
   *
   * Removals are asymmetric on purpose. A script whose file is gone KEEPS its
   * row — it carries cards and a version ring, and a script vanishing is
   * exactly when the app should speak up rather than tidy up. A document or
   * reference whose file is gone loses its row, and the removal is listed under
   * Changes so the writer can see it happened.
   *
   * Guarded against re-entry because the commit itself changes `binder`, which
   * is what triggers the caller.
   */
  const reconcileRunRef = useRef<Promise<void> | null>(null);
  const reconcileAgainRef = useRef(false);
  const reconcilePass = useCallback(async () => {
    if (!playRef.current || readOnlyRef.current) return;
    try {
      const before = playRef.current.data.binder;
      const planned = await reconcileBinder(before);
      setMissingItems(planned.missing);
      if (planned.added.length === 0 && planned.removed.length === 0 && planned.updated.length === 0) return;

      let filed: string[] = [];
      const res = await runBinderOp(async (ctx) => {
        /*
         * The plan was made against the binder as the walk began. A binder op
         * that landed while the disk was walked — the outline note being made,
         * a sheet renamed — is not in it, and committing it would undo that op:
         * the new note came back as a newly found file with another id, the
         * scratchpad took that for a different note, read it over the page and
         * lost what had been typed since. Walked again, from the binder as it
         * is, in this turn, where nothing else can land.
         */
        let plan = planned;
        if (ctx.play.binder !== before) {
          plan = await reconcileBinder(ctx.play.binder);
          setMissingItems(plan.missing);
          if (plan.added.length === 0 && plan.removed.length === 0 && plan.updated.length === 0) {
            return { ok: true, play: ctx.play, hash: ctx.hash };
          }
        }
        filed = plan.added;
        return commitBinder(ctx, plan.binder);
      });
      // A stale hash means the play file moved under us; the next pass rebuilds
      // the plan on top of what is really there.
      if (!res?.ok) return;
      if (filed.length) {
        setNewlyFiled((prev) => new Set([...prev, ...filed]));
      }
    } catch {
      /* the next pass tries again; the binder keeps what it had (docs/app/keeping-work/storage-and-file-format.md#STOR-107) */
    }
  }, [runBinderOp]);
  /**
   * One walk at a time. Asked for while one is running, it runs once more
   * after it — a file that landed after the walk began is not missed — and the
   * promise resolves when that is done, so "file it, then bring it forward"
   * waits for the filing instead of finding nothing.
   */
  const reconcileNow = useCallback((): Promise<void> => {
    if (reconcileRunRef.current) {
      reconcileAgainRef.current = true;
      return reconcileRunRef.current;
    }
    const run = (async () => {
      try {
        do {
          reconcileAgainRef.current = false;
          await reconcilePass();
        } while (reconcileAgainRef.current);
      } finally {
        reconcileRunRef.current = null;
      }
    })();
    reconcileRunRef.current = run;
    return run;
  }, [reconcilePass]);
  reconcileNowRef.current = reconcileNow;

  ledgerRef.current = ledger;

  const acknowledgeFiled = useCallback(() => setNewlyFiled(new Set()), []);

  /** The diff for one ledger entry: what was there, and what is there now. */
  const changeDiff = useCallback(
    async (entryId: string): Promise<{ before: string; after: string } | null> => {
      const entry = ledgerRef.current.find((e) => e.id === entryId);
      const changes = changesRef.current;
      const gen = workspaceGenRef.current;
      if (!entry || !changes) return null;
      const before = await changes.readBefore(entryId);
      if (gen !== workspaceGenRef.current) return null;
      if (before === null) return null; // recorded, but we never saw a "before"
      try {
        const after = (await vault.read(entry.path)).content;
        return gen === workspaceGenRef.current ? { before, after } : null;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * One provider conflict copy, beside the file it is a copy of (docs/app/keeping-work/storage-and-file-format.md#STOR-D11).
   * Null when either cannot be read.
   */
  const loadOther = useCallback(
    async (path: string): Promise<{ theirs: string; ours: string } | null> => {
      const original = conflictOriginal(path.slice(path.lastIndexOf("/") + 1));
      if (!original) return null;
      const dir = path.slice(0, path.lastIndexOf("/") + 1);
      try {
        const theirs = (await vault.read(path)).content;
        const ours = (await vault.read(dir + original)).content;
        return { theirs, ours };
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Promote a conflict copy over the file it is a copy of, then trash the copy.
   *
   * Through the ordinary guarded writers: the replaced text becomes a pinned
   * version first, so choosing this is as reversible as everything else.
   */
  const keepOther = useCallback(
    async (path: string): Promise<boolean> => {
      const original = conflictOriginal(path.slice(path.lastIndexOf("/") + 1));
      if (!original) return false;
      const dir = path.slice(0, path.lastIndexOf("/") + 1);
      const target = dir + original;
      try {
        const theirs = (await vault.read(path)).content;
        if (target === scriptPathRef.current) {
          // The open script: same path a restore takes, so the buffer, the
          // cards and the version ring all stay consistent.
          if (!(await applyScriptTextRef.current(theirs))) return false;
        } else {
          const current = await vault.read(target);
          const playId = playIdRef.current;
          // Kept under the file's own row — it used to go into the open
          // script's Versions, or nowhere — and without that nothing is replaced.
          const owner = findByPath(playRef.current?.data.binder ?? [], target);
          try {
            if (!playId || !owner) throw new Error("no row");
            const pinned = await versions.snapshot(
              playId,
              owner.id,
              "pre-keep",
              current.content,
              target.endsWith(".fountain") ? "fountain" : "md",
            );
            setPreserved((p) => [...p, pinned]);
          } catch {
            setError("The version there now couldn't be kept in Versions, so nothing was replaced.");
            return false;
          }
          const out = await vault.write(target, theirs, current.hash);
          if (out.status !== "ok") {
            setError("That file changed again just now — try once more.");
            return false;
          }
          adoptMaterialWrite(target, theirs, out.hash);
        }
        await vault.trash(path);
        setConflictCopies((c) => c.filter((p) => p !== path));
        setNotice(`Kept that version of ${original}.`);
        return true;
      } catch (e) {
        setError(changeRefused(e, "document", target));
        return false;
      }
    },
    [adoptMaterialWrite, changeRefused],
  );

  /** Move a conflict copy to the OS trash — recoverable, and the writer's call. */
  const trashOther = useCallback(async (path: string): Promise<boolean> => {
    try {
      await vault.trash(path);
      setConflictCopies((c) => c.filter((p) => p !== path));
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

  /** Accept a change: it stays, and it stops asking for attention. */
  const keepChange = useCallback(async (entryId: string) => {
    const changes = changesRef.current;
    const gen = workspaceGenRef.current;
    if (!changes) return;
    await changes.setStatus(entryId, "kept");
    if (gen !== workspaceGenRef.current) return;
    setLedger((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: "kept" } : e)));
  }, []);

  /**
   * Put a change back.
   *
   * Routes through the app's own guarded writers — never a raw write — so the
   * version ring, the card reconcile and the conflict floor all
   * stay intact for an undo exactly as they do for an edit. The pre-change
   * bytes become the new baseline, so reverting does not itself register as a
   * change to review.
   */
  const revertChange = useCallback(
    (entryId: string): Promise<boolean> => {
      const changes = changesRef.current;
      const gen = workspaceGenRef.current;
      const entry = ledgerRef.current.find((e) => e.id === entryId);
      if (!entry || !changes) return Promise.resolve(false);
      // Navigation waits for this operation, and material saves cannot race its
      // pin-and-write interval. Both the store and the selected entry are ours.
      return line(() => materialWrites(async () => {
        if (gen !== workspaceGenRef.current) return false;
        const owner = findByPath(playRef.current?.data.binder ?? [], entry.path);
        if (!owner) return false;
        const before = await changes.readBefore(entryId);
        if (before === null) return false;
        const session = owner.id === activeScriptIdRef.current ? sessionRef.current : null;
        const stillReviewed = () => gen === workspaceGenRef.current &&
          (session ? sessionRef.current === session && !session.dirty : unsavedTextsOf(owner.id).length === 0) &&
          (owner.id !== outline.record()?.id || !outline.hasUnsaved());
        try {
          const result = await revertReviewedFile({
            afterHash: entry.afterHash, before,
            read: () => vault.read(owner.path),
            pin: async (content) => {
              const pinned = await versions.snapshot(changes.playId, owner.id, "pre-keep", content,
                owner.type === "script" ? "fountain" : "md");
              setPreserved((p) => [...p, pinned]);
            },
            stillReviewed,
            write: async (content, expected) => {
              if (session) {
                if (session.expectedForWrite !== expected) return false;
                return applyScriptTextRef.current(content);
              }
              const out = await vault.write(owner.path, content, expected);
              if (out.status !== "ok") return false;
              adoptMaterialWrite(owner.path, content, out.hash);
              return true;
            },
          });
          if (result !== "saved") {
            setError(result === "unpreserved"
              ? "The version there now couldn't be kept in Versions, so nothing was replaced."
              : "That file changed since this entry was recorded. Review its latest words before putting it back.");
            return false;
          }
        } catch (e) {
          setError(changeRefused(e, "document", entry.path));
          return false;
        }
        await changes.writeBaseline(entry.path, before);
        await changes.setStatus(entryId, "reverted");
        if (gen === workspaceGenRef.current) {
          setLedger((prev) => prev.map((e) => (e.id === entryId ? { ...e, status: "reverted" } : e)));
        }
        return true;
      }));
    },
    [line, materialWrites, unsavedTextsOf, adoptMaterialWrite, changeRefused],
  );

  const renameTo = useCallback(
    (id: string, title: string) =>
      void runBinderOp((c) => renameItem(c, id, title), { id }),
    [runBinderOp],
  );
  const moveTo = useCallback(
    (id: string, parentId: string | null, atIndex: number) =>
      void runBinderOp((c) => moveItem(c, id, parentId, atIndex), { id }),
    [runBinderOp],
  );
  const createFolder = useCallback(
    (parentId: string | null, title: string, atIndex?: number) => {
      void (async () => {
        const res = await runBinderOp((c) => newFolder(c, parentId, title, atIndex));
        if (res?.ok && res.createdId) setJustCreated({ id: res.createdId, name: true });
      })();
    },
    [runBinderOp],
  );
  /**
   * Make a material and OPEN it. Creating a note and being left looking at the
   * binder was the step that made "new note" feel like filing rather than
   * writing — the file existed and the cursor was nowhere near it. A document,
   * or a sheet the Cast names, is written in at once; a character made in the
   * binder is named there first (`name`).
   */
  const createMaterial = useCallback(
    (
      parentId: string | null,
      type: BinderItemType,
      title: string,
      atIndex?: number,
      opts?: { name?: boolean },
    ) => {
      void (async () => {
        const res = await runBinderOp((c) => newMaterial(c, parentId, type, title, atIndex));
        if (res?.ok && res.createdId) {
          const item = findById(res.play.binder, res.createdId);
          if (item) selectItem(item);
          setJustCreated({ id: res.createdId, name: opts?.name ?? false });
        }
      })();
    },
    [runBinderOp, selectItem],
  );
  const createScript = useCallback(
    (parentId: string | null, title: string, atIndex?: number) => {
      void (async () => {
        const res = await runBinderOp((c) => newScript(c, parentId, title, atIndex));
        // Open the new script and drop it into rename mode so the writer can
        // name it, then start typing: the binder hands the cursor to the page
        // when the name is done (docs/app/preferences-and-help/accessibility.md#A11Y-4).
        if (res?.ok && res.createdId) {
          const item = findById(res.play.binder, res.createdId);
          if (item) selectItem(item);
          setJustCreated({ id: res.createdId, name: true });
        }
      })();
    },
    [runBinderOp, selectItem],
  );
  /**
   * Show one binder row's file in the OS file manager. A no-op where the host
   * has none (browser dev, mobile) — the binder hides the affordance off
   * `capabilities.canReveal` rather than testing the platform.
   */
  const revealItem = useCallback(
    (id: string) => {
      const item = findById(playRef.current?.data.binder ?? [], id);
      if (!item?.path) return;
      void vault.reveal(item.path).catch((e) => setError(String(e)));
    },
    [],
  );

  /** Copy a file beside itself, then open the copy — you duplicated it to work on it. */
  const duplicate = useCallback(
    (id: string) => {
      void (async () => {
        // The copy is made from disk, so what is on screen lands there first.
        const res = await runBinderOp((c) => duplicateItem(c, id), { id });
        if (res?.ok && res.createdId) {
          const item = findById(res.play.binder, res.createdId);
          if (item) selectItem(item);
        }
      })();
    },
    [runBinderOp, selectItem],
  );
  /**
   * Move to Trash — and hand back the way out (docs/app/keeping-work/storage-and-file-format.md#STOR-90).
   *
   * Finder's rule is that a recoverable action is not confirmed, so the binder
   * no longer raises a `confirm()`; it trashes and shows an undo toast. But
   * "recoverable" here meant "the writer can go and find it in the Finder's
   * Trash", which is not the same as Undo, so the undo is real: the bytes are
   * read BEFORE the trash and written back on demand, together with only the
   * removed row. Later binder edits and card notes stay where they are.
   *
   * A folder trashes a whole subtree, and reading a subtree into memory to
   * un-delete it is a different feature — so a folder gets the toast without an
   * Undo, and the toast says where it went instead of pretending.
   */
  const remove = useCallback(
    (id: string): Promise<TrashResult | null> => {
      const playId = playIdRef.current;
      // In line, like every binder op: reading the bytes for Undo and moving the
      // file to the Trash both belong to the play that was open when it was asked.
      return line(async (): Promise<TrashResult | null> => {
        const loaded = playRef.current;
        if (!loaded || playId === null || playIdRef.current !== playId) return null;
        const item = findById(loaded.data.binder, id);
        if (!item) return null;
        const removedLocation = locateBinderItem(loaded.data.binder, id)!;
        const removedItem: BinderItem = structuredClone(item);
        // The card records of every script going with it: pruned from the play
        // file by the delete, and put back by Undo with the row.
        const scriptsBefore: Record<string, ScriptData> = {};
        const collect = (it: BinderItem) => {
          if (it.type === "script" && loaded.data.scripts?.[it.id]) {
            scriptsBefore[it.id] = JSON.parse(JSON.stringify(loaded.data.scripts[it.id]));
          }
          for (const child of it.children ?? []) collect(child);
        };
        collect(item);

        // The open script's words, and any open sheet's, land before the bytes
        // are read for Undo, or Undo would bring back the file without them.
        const openId = activeScriptIdRef.current;
        if (openId && holdsItem(loaded.data.binder, id, openId)) await landOpenScript();
        await flushAllMaterials();

        const saved: { path: string; content: string }[] = [];
        if (item.type !== "folder") {
          try {
            if (await vault.exists(item.path)) {
              saved.push({ path: item.path, content: (await vault.read(item.path)).content });
            }
          } catch {
            /* unreadable is not fatal — it only costs this file its undo */
          }
        }

        const res = await binderOpNow((c) => deleteItem(c, id), { id, deletes: true });
        if (!res?.ok) return null;

        const canUndo = item.type !== "folder" && saved.length > 0;
        return {
          title: titleOf(item) || "This file",
          undo: canUndo
            ? () =>
                line(async () => {
                  if (playIdRef.current !== playId) {
                    setError(`“${titleOf(item)}” is in a play that isn't open any more.`);
                    return;
                  }
                  for (const f of saved) {
                    try {
                      // Back where it was, and never over something that has
                      // arrived there since.
                      await vault.create(f.path, f.content);
                    } catch (e) {
                      setError(String(e));
                      return;
                    }
                  }
                  await binderOpNow(async (c) => restoreBinderItem(c, removedItem,
                    removedLocation.parentId, removedLocation.index, scriptsBefore));
                })
            : null,
        };
      });
    },
    [binderOpNow, landOpenScript, flushAllMaterials, line],
  );
  const consumeCreated = useCallback(() => setJustCreated(null), []);

  const versionsOf = useCallback((id: string): VersionsTarget | null =>
    id === "outline" || id === outline.record()?.id ? outline.versionsOf(id) : materials.versionsOf(id),
  [outline.record, outline.versionsOf, materials.versionsOf]);

  // --- script format, page view, export (docs/app/formatting/formats-and-layout.md#SCHEMA-D100) ---
  const [, refreshLanguage] = useState(0);
  const savePlayLanguage = useCallback(async (value: string, forScript: string | null) => {
    const language = canonicalLanguage(value);
    const base = playRef.current;
    const playPath = playPathRef.current;
    const generation = workspaceGenRef.current;
    const scriptId = activeScriptIdRef.current;
    const sameScript = () => generation === workspaceGenRef.current &&
      scriptId === activeScriptIdRef.current && forScript === `${playIdRef.current}:${scriptId}`;
    if (!language || !base || !playPath || !sameScript()) return false;
    if (language === canonicalLanguage(base.data.settings.language ?? DEFAULT_PLAY_LANGUAGE)) return true;
    if (readOnlyRef.current) return false;
    try {
      const committed = await commitPlay(playPath, base, (prior) => {
        const from = prior ?? base.data;
        return { ...from, settings: { ...from.settings, language } };
      }, new Date().toISOString());
      if (!sameScript()) return false;
      if (committed.status !== "ok") return false;
      playRef.current = { data: committed.data, hash: committed.hash };
      refreshLanguage((revision) => revision + 1);
      return true;
    } catch { return false; }
  }, []);

  const setFormat = useCallback(async (id: string) => {
    setFormatId(id); // re-render immediately; persistence follows
    const base = playRef.current;
    const playPath = playPathRef.current;
    const playId = playIdRef.current;
    if (!base || !playPath) return;
    try {
      const committed = await commitPlay(
        playPath,
        base,
        (prior) => {
          const from = prior ?? base.data;
          return { ...from, settings: { ...from.settings, format: id } };
        },
        new Date().toISOString(),
      );
      if (playIdRef.current !== playId) return;
      if (committed.status === "ok") {
        playRef.current = { data: committed.data, hash: committed.hash };
      } else {
        setError("This play changed on disk — the format choice wasn't saved.");
      }
    } catch (e) {
      setError(String(e));
    }
  }, []);

  // Title-page fields (fountain title keys are canonical; autosave writes them).
  const saveFrontMatter = useCallback(
    (fm: FrontMatter, forScript?: string | null): boolean => {
      const openKey =
        playIdRef.current && activeScriptIdRef.current
          ? `${playIdRef.current}:${activeScriptIdRef.current}`
          : null;
      if (forScript !== undefined && forScript !== openKey) {
        // Filled in for one script, saved while another is open: its title,
        // author and contact are not this one's.
        setError("Another script opened before the title page was saved, so nothing was changed.");
        return false;
      }
      frontMatterRef.current = fm;
      setFrontMatterState(fm);
      setLayoutMeta({
        frontMatter: fm,
        title: fm.title ?? scriptTitle,
        author: fm.authors?.join(", ") ?? "",
      });
      if (sessionRef.current) {
        sessionRef.current.markDirty();
        setStatus("dirty");
        autosaveRef.current?.schedule();
        recoveryRef.current?.dirty();
      }
      return true;
    },
    [scriptTitle],
  );

  const patchFrontMatter = useCallback((patch: Partial<FrontMatter>, forScript: string | null) =>
    saveFrontMatter({ ...frontMatterRef.current, ...patch }, forScript), [saveFrontMatter]);

  // --- cast & characters (Phase 2) ---
  // The printed cast list (name + short description) is canonical in the
  // fountain title page; save it through the same dirty→autosave path.
  const saveCharacters = useCallback(
    (entries: CharacterEntry[]) => {
      saveFrontMatter({
        ...frontMatterRef.current,
        characters: entries.length ? entries : undefined,
      });
    },
    [saveFrontMatter],
  );
  // Auto-add calls this from an effect; a ref keeps it out of the deps, so the
  // effect fires on the script changing rather than on a callback re-binding.
  const saveCharactersRef = useRef(saveCharacters);
  saveCharactersRef.current = saveCharacters;
  // Where each character speaks (derived from the open doc + scene cards).
  const castAppearances = useCallback(
    () => computeAppearances(docRef.current, cards),
    [cards],
  );
  // How big each part is, for tiering the Cast surface. Recomputed with the
  // cards (i.e. after every successful save), never stored.
  const castWeights = useMemo(
    () => computeWeights(docRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards],
  );
  // How long each scene runs, from the same paginator the editor and the PDF
  // use — so the board, the page view and the export can never disagree about
  // where a scene sits. Recomputed with the cards (after each save), like the
  // weights above; never stored (storage rule 3).
  const scenePages = useMemo(
    () => scenePageMap(docRef.current, resolvedFormat.spec, layoutMeta),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, resolvedFormat.spec, layoutMeta],
  );

  // Keep the hidden set in step with whatever the play file currently says —
  // open, reconcile, or an external edit — without threading it through every
  // load site.
  useEffect(() => {
    const scriptId = activeScriptIdRef.current;
    const play = playRef.current?.data;
    const next = (scriptId && play ? scriptDataFor(play, scriptId).castHidden : null) ?? [];
    setCastHidden((prev) =>
      prev.length === next.length && prev.every((n, i) => n === next[i]) ? prev : next,
    );
  }, [cards]);

  /**
   * Rewrite the play file's hidden-speaker set, replayed against whatever base
   * wins — the same guarded pattern as a card edit, so an outside write landing
   * mid-flight merges rather than colliding.
   */
  const patchCastHidden = useCallback(
    async (change: (hidden: string[]) => string[]) => {
      const base = playRef.current;
      const playPath = playPathRef.current;
      const scriptId = activeScriptIdRef.current;
      const playId = playIdRef.current;
      if (!base || !playPath || !scriptId) return;
      try {
        const committed = await commitPlay(
          playPath,
          base,
          (prior) => {
            const from = prior ?? base.data;
            const data = scriptDataFor(from, scriptId);
            return withScriptData(from, scriptId, {
              ...data,
              castHidden: change(data.castHidden ?? []),
            });
          },
          new Date().toISOString(),
        );
        if (playIdRef.current !== playId) return;
        if (committed.status === "ok") {
          playRef.current = { data: committed.data, hash: committed.hash };
          if (activeScriptIdRef.current === scriptId) {
            setCastHidden(scriptDataFor(committed.data, scriptId).castHidden ?? []);
          }
        } else setError("This play changed on disk — reopen it to see the change.");
      } catch (e) {
        setError(String(e));
      }
    },
    [],
  );

  /**
   * Take a speaker off the printed cast page for good. Canonical in the play file
   * because the script can't say it — the Fountain file only knows that VOICE
   * speaks, not that you don't want VOICE listed. Without this, auto-add would
   * undo the removal on the next save.
   */
  const hideFromCast = useCallback(
    (name: string) => {
      const key = name.trim().toUpperCase();
      if (!key) return;
      void patchCastHidden((hidden) =>
        hidden.includes(key) ? hidden : [...hidden, key].sort(),
      );
    },
    [patchCastHidden],
  );

  /** Let a hidden speaker be auto-added again (the writer changed their mind). */
  const unhideFromCast = useCallback(
    (name: string) => {
      const key = name.trim().toUpperCase();
      void patchCastHidden((hidden) => hidden.filter((n) => n !== key));
    },
    [patchCastHidden],
  );

  /**
   * Auto-add: a speaker who says something and isn't listed simply joins the
   * cast. No button, no "add 3 from script" — the character exists because they
   * spoke.
   *
   * Two guards keep that from being annoying. **A cue with no speech under it
   * is ignored**, so a half-typed name never lands on the cast page (a
   * character isn't real until they say something). And this runs with `cards`
   * — i.e. at autosave cadence after a successful write, not per keystroke.
   * It converges: once added, the speaker is listed, so the next pass detects
   * nothing and stops.
   */
  useEffect(() => {
    if (!sessionRef.current || readOnly) return;
    const listed = frontMatterRef.current.characters ?? [];
    // The hidden set as the play file has it for the script open NOW. The
    // `castHidden` state catches up a render later, and in that render it was
    // still the last script's — or empty, just after opening — so a speaker
    // taken off the cast page for good came back every time the script opened.
    const sid = activeScriptIdRef.current;
    const play = playRef.current?.data ?? null;
    const hidden = sid && play ? (scriptDataFor(play, sid).castHidden ?? []) : castHidden;
    const fresh = detectNewSpeakers(listed, castWeights, hidden).filter(
      (name) => (castWeights.get(name)?.lines ?? 0) > 0,
    );
    if (fresh.length === 0) return;
    saveCharactersRef.current([...listed, ...fresh.map((name) => ({ name }))]);
  }, [castWeights, castHidden, readOnly]);

  const setPaginated = useCallback((on: boolean) => {
    setPaginatedState(on);
    try {
      localStorage.setItem(PAGE_VIEW_KEY, on ? "1" : "0");
    } catch {
      /* chrome preference only — losing it is harmless */
    }
  }, []);

  // Apply a full replacement script: parse it, adopt its front matter, and
  // write through the same guarded path the corkboard uses — the editor stays
  // in sync and the conflict floor holds.
  const applyScriptText = useCallback(
    async (content: string, forSession?: DocumentSession): Promise<boolean> => {
      const session = sessionRef.current;
      const scriptPath = scriptPathRef.current;
      if (!scriptPath || !session) return false;
      // Asked for while another script was open: those words are not this one's.
      if (forSession && forSession !== session) {
        setError("Another script opened before that could be put back, so nothing was replaced.");
        return false;
      }
      try {
        // Whatever the buffer held before the replacement is one pull-back away
        // — or nothing is replaced.
        const kept = await snapshotBuffer("pre-apply");
        if (kept === null) {
          setError("What the script holds now couldn't be kept in Versions, so nothing was replaced.");
          return false;
        }
        // Meant for the script that was open when it was asked for.
        if (sessionRef.current !== session) return false;
        const parsed = parse(content);
        frontMatterRef.current = parsed.frontMatter;
        setFrontMatterState(parsed.frontMatter);
        setLayoutMeta((m) => ({
          frontMatter: parsed.frontMatter,
          title: parsed.frontMatter.title ?? m.title ?? "",
          author: parsed.frontMatter.authors?.join(", ") ?? "",
        }));
        const hash = await writeScriptDoc(parsed.doc);
        if (hash === null) return false;
        await refreshCards(docRef.current ?? parsed.doc);
        setStatus(sessionRef.current?.dirty ? "dirty" : "saved");
        return true;
      } catch (e) {
        setError(changeRefused(e, "script", scriptPath));
        return false;
      }
    },
    [writeScriptDoc, refreshCards, snapshotBuffer, changeRefused],
  );
  // Held in a ref so the revert can reuse the SAME guarded write path without
  // re-binding whenever the script changes.
  applyScriptTextRef.current = applyScriptText;

  /**
   * Take the offered words back (docs/app/keeping-work/storage-and-file-format.md#STOR-D10): the writer chose it. Through the
   * same guarded path as a restore, so what the buffer holds now becomes a
   * version first and the conflict floor still stands between these words and
   * a file that changed.
   */
  const recoverOffer = useCallback(async (): Promise<boolean> => {
    const offer = recoveryOfferRef.current;
    if (!offer || activeScriptIdRef.current !== offer.scriptId || playIdRef.current !== offer.playId) return false;
    const ok = await applyScriptText(offer.words);
    if (!ok) return false;
    const playId = playIdRef.current;
    if (offer.versionName === null && playId) {
      // The snapshot was these words' only home, and they are in the script now.
      await recovery.remove(offer.playId, offer.scriptId, offer.owner).catch(() => {});
    }
    if (recoveryOfferRef.current?.owner !== offer.owner) return true;
    setRecoveryOffer(recoveryQueueRef.current.shift() ?? null);
    setNotice("The unsaved changes are back in the script.");
    return true;
  }, [applyScriptText]);

  /** Decline the offered words. They were kept in Versions before being offered. */
  const discardOffer = useCallback(async () => {
    const offer = recoveryOfferRef.current;
    if (!offer) return;
    const playId = playIdRef.current;
    if (offer.versionName === null && playId) {
      try {
        await versions.snapshot(offer.playId, offer.scriptId, "recovery", offer.words);
        await recovery.remove(offer.playId, offer.scriptId, offer.owner);
      } catch {
        // Nowhere else to keep them: the offer stays up rather than let them go.
        setError("Those changes couldn't be kept in Versions, so they're still being offered.");
        return;
      }
    }
    if (recoveryOfferRef.current?.owner !== offer.owner) return;
    setRecoveryOffer(recoveryQueueRef.current.shift() ?? null);
    setNotice("Discarded — the changes are kept in Versions if you want them back.");
  }, []);

  // --- Versions (docs/app/keeping-work/storage-and-file-format.md#STOR-D10) ---
  const listVersions = useCallback(async (): Promise<VersionEntry[]> => {
    const sid = activeScriptIdRef.current;
    const playId = playIdRef.current;
    return sid && playId ? versions.list(playId, sid) : [];
  }, []);

  const readVersion = useCallback(async (name: string): Promise<string> => {
    const sid = activeScriptIdRef.current;
    const playId = playIdRef.current;
    if (!sid || !playId) throw new Error("no script open");
    return versions.read(playId, sid, name);
  }, []);

  /**
   * Pull back an earlier state: the current buffer becomes a version first
   * (`pre-restore`), then the version's content replaces the script through the
   * same guarded path every other write uses — the conflict floor holds and the
   * cards re-reconcile. Restoring is itself undoable from Versions.
   */
  const restoreVersion = useCallback(
    async (name: string): Promise<boolean> => {
      const sid = activeScriptIdRef.current;
      const playId = playIdRef.current;
      const session = sessionRef.current;
      if (!sid || !playId || !session) return false;
      try {
        await snapshotBuffer("pre-restore");
        const content = await versions.read(playId, sid, name);
        // The version belongs to the script it was chosen from. If the writer
        // has moved to another script meanwhile, it is not written anywhere.
        const ok = await applyScriptText(content, session);
        if (ok) setNotice("Version restored — the replaced state is one pull-back away.");
        return ok;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [applyScriptText, snapshotBuffer],
  );

  /**
   * The play as pages, for the export dialog to show before anything is
   * written. Deliberately the same paginator call `exportScriptPdf` makes
   * rather than a cached result — the buffer may have moved since the last
   * save, and a preview that lags the script would be worse than none.
   */
  const layoutForExport = useCallback(
    (sidesFor?: string | null, anonymous?: boolean): LayoutResult | null => {
      const doc = docRef.current;
      if (!doc || !scriptPathRef.current) return null;
      const source = sidesFor ? sidesDoc(doc, sidesFor) : doc;
      return paginateDoc(source, resolvedFormat.spec, anonymous ? anonymousMeta(layoutMeta, scriptTitle) : layoutMeta);
    },
    [resolvedFormat, layoutMeta, scriptTitle],
  );

  const exportScript = useCallback(
    async (opts?: {
      pages?: number[] | null;
      front?: FrontSheet[];
      sidesFor?: string | null;
      anonymous?: boolean;
      to?: "file" | "print";
      type?: ExportFileType;
    }) => {
      const doc = docRef.current;
      const scriptPath = scriptPathRef.current;
      const language = playRef.current?.data.settings.language ?? DEFAULT_PLAY_LANGUAGE;
      const exportFrontMatter = frontMatterRef.current;
      const printing = opts?.to === "print";
      // Printing is the PDF's; a .docx or .odt is only ever saved.
      const type: ExportFileType = printing ? "pdf" : (opts?.type ?? "pdf");
      if (!doc || !scriptPath) {
        setError(printing ? "No script open to print." : "No script open to export.");
        return;
      }
      setExporting(true);
      try {
        autosaveRef.current?.flushNow(); // the file reflects what's on disk
        const pages = opts?.pages ?? null;
        const sidesFor = opts?.sidesFor?.trim().toUpperCase() || null;
        // The file name says what the file is — a sides export or an excerpt
        // can never be mistaken for (or overwrite) the full script beside it.
        // A print job carries the same name into the queue.
        const anonymous = !!opts?.anonymous;
        const parts = [
          sidesFor ? `${sidesFor} sides` : "",
          pages ? pageRangeLabel(pages) : "",
          anonymous ? "anonymous" : "",
        ].filter(Boolean);
        const slice = parts.length ? ` (${parts.join(", ")})` : "";
        const name = baseName(scriptPath).replace(/\.fountain$/, "") + slice;
        const args = {
          doc: sidesFor ? sidesDoc(doc, sidesFor) : doc,
          spec: resolvedFormat.spec,
          meta: anonymous ? anonymousMeta(layoutMeta, scriptTitle) : layoutMeta,
          language,
          // Any export can carry the title, cast and setting sheets — sides
          // too, for an audition packet. None go unless they were asked for.
          frontMatter: anonymous
            ? anonymousFrontMatter(exportFrontMatter, layoutMeta.title || scriptTitle)
            : exportFrontMatter,
          frontSheets: opts?.front ?? [],
          pages,
        };
        if (type !== "pdf") {
          // Lazy-loaded like the PDF path, so none of it is in the editor's startup.
          const { exportScriptDocument } = await import("../wordproc");
          const saved = await exportScriptDocument(type, { ...args, suggestedName: `${name}.${type}` });
          // No report event: counting these would add one to the closed list
          // (docs/app/formatting/formats-and-layout.md#FMT-D109).
          if (saved) setNotice(`Exported ${saved}`);
          return;
        }
        // Lazy-loaded so pdf-lib stays out of the editor's startup path.
        const { exportScriptPdf, printScriptPdf } = await import("../pdf");
        if (printing) {
          await printScriptPdf({ ...args, jobTitle: name });
          return;
        }
        const saved = await exportScriptPdf({ ...args, suggestedName: `${name}.pdf` });
        if (saved) {
          setNotice(`Exported ${saved}`);
          // An anonymous fact, sent only if reports are on (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3).
          pdfExported(sidesFor ? "sides" : pages ? "range" : "whole", resolvedFormat.spec.id);
        }
      } catch (e) {
        setError(
          printing
            ? `Printing failed: ${String(e)}`
            : type === "docx"
              ? `.docx export failed: ${String(e)}`
              : type === "odt"
                ? `.odt export failed: ${String(e)}`
                : `PDF export failed: ${String(e)}`,
        );
      } finally {
        setExporting(false);
      }
    },
    [resolvedFormat, layoutMeta, scriptTitle],
  );

  // --- watcher listeners (unit C/F) ---
  //
  // Subscribing is async, so cleanup can run before the unsubscribe function
  // exists; a handle that arrives after teardown must unsubscribe itself.
  // Without that, every re-run of this effect (it depends on reloadFromDisk,
  // which changes with the open script) left the previous listener attached —
  // so each external change ran the whole handler, and its play-file read, once
  // per leaked listener. It compounds: the more the app writes, the slower
  // every subsequent write gets.
  // Extracted so the foreground rescan (below) can feed it too. There must be
  // exactly ONE place that judges "the file changed under us" — docs/app/keeping-work/storage-and-file-format.md#STOR-104 is not
  // something to re-implement per platform.
  const handleExternalChange = useCallback(
    (e: { root?: string; relPath: string; hash: string | null }) => {
      if (e.root && (!activeRootRef.current || !samePath(e.root, activeRootRef.current))) return;
      const session = sessionRef.current;
      const changes = changesRef.current;
      const gen = workspaceGenRef.current;
      const knownPaths = [playPathRef.current, scriptPathRef.current, outline.record()?.path,
        ...materials.paths(),
        ...flatten(playRef.current?.data.binder ?? []).map((item) => item.path)]
        .filter((path): path is string => typeof path === "string");
      const eventPath = matchingPath(e.relPath, new Set(knownPaths)) ?? e.relPath;
      // The bytes may be unchanged during an external case/NFC rename. Still
      // reconcile so every open buffer follows the disk's actual spelling.
      if (e.relPath !== eventPath && affectsBinder(e.relPath)) {
        if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = setTimeout(() => void reconcileNowRef.current(), RECONCILE_DEBOUNCE_MS);
      }

      /**
       * The review floor. Runs for EVERY external
       * change to a play file, before any of the branches below decide what to
       * do about it — that ordering is the point: the ledger observes, it never
       * gates, and nothing downstream can opt out of being observed.
       *
       * It deliberately does not block. The file has already changed by the
       * time we hear; what the writer gets is a record of what they had and a
       * one-click way back. An event whose bytes match what the writer last saw
       * — a start-up scan, a return to the app — records nothing (record.ts).
       */
      if (changes && e.hash !== null && isReviewable(e.relPath)) {
        void (async () => {
          try {
            const fresh = await vault.read(e.relPath);
            const entry = await recordExternalChange(changes, {
              path: e.relPath,
              after: fresh.content,
              afterHash: fresh.hash,
              nowIso: new Date().toISOString(),
            });
            if (entry && gen === workspaceGenRef.current) setLedger((prev) => [...prev, entry]);
          } catch {
            /* unreadable right now: nothing to record, and nothing is gated */
          }
        })();
      }
      /*
       * The PLAY FILE has other legitimate writers — another tool setting card
       * fields, a sync, another device. Adopt their version at once.
       *
       * That keeps the board live, and (the part that was missing before) keeps
       * our expected hash honest: ignoring these left the app asserting a stale
       * hash on every autosave tick, colliding forever.
       */
      const playPath = playPathRef.current;
      if (playPath && eventPath === playPath) {
        void (async () => {
          const fresh = await readPlayFile(playPath);
          if (playPathRef.current !== playPath) return;
          if (fresh.status !== "valid" && fresh.status !== "unsupported") {
            readOnlyRef.current = true;
            setReadOnly(true);
            setError("This play's details changed and could not be read. Reopen the play to review the original file.");
            return;
          }
          if (fresh.hash === playRef.current?.hash) return; // our own echo
          readOnlyRef.current = fresh.status === "unsupported";
          setReadOnly(readOnlyRef.current);
          playRef.current = fresh;
          setBinder(fresh.data.binder);
          const scriptId = activeScriptIdRef.current;
          const doc = docRef.current;
          if (scriptId && doc) {
            setCards(reconcileCards({ doc, prior: scriptDataFor(fresh.data, scriptId) }).cards);
            setCastHidden(scriptDataFor(fresh.data, scriptId).castHidden ?? []);
          }
          // Renamed or moved somewhere else — another Mac, the iPad. The open
          // script and every open sheet follow their rows, as they do after a
          // rename made here; left at the old path, the next autosave recreated
          // the old file with the new words.
          const moved = scriptId ? findById(fresh.data.binder, scriptId) : null;
          if (moved?.path && moved.path !== scriptPathRef.current && sessionRef.current) {
            scriptPathRef.current = moved.path;
            setScriptPathState(moved.path);
            setScriptTitle(titleOf(moved));
            recoveryRef.current?.moved(moved.path);
          }
          materials.applyBinder(fresh.data.binder, false);
        })();
        return;
      }
      // Each document session applies its own dirty-buffer and hash checks.
      if (materials.onExternal(eventPath, e.hash)) return;
      if (outline.onExternal(eventPath, e.hash)) return;

      if (!session || eventPath !== scriptPathRef.current) {
        // It may be a material that appeared, moved, or vanished — a character
        // sheet arriving is exactly this event. Debounced, because a tool
        // writing several files produces several events for one intention.
        if (affectsBinder(e.relPath)) {
          if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
          reconcileTimerRef.current = setTimeout(
            () => void reconcileNowRef.current(),
            RECONCILE_DEBOUNCE_MS,
          );
          // A material changed under us, which the appearances sync also cares
          // about: anything that ADDS `## Appearances` to an existing sheet
          // changes neither the script nor the binder, so without this the
          // section it just asked for would stay empty until the next edit to
          // the play.
          setMaterialsTick((n) => n + 1);
        }
        return;
      }
      if (e.hash === null) {
        // The open script's file went away: deleted, or — as a sync delivers a
        // rename — gone from here a moment before the play file says where to.
        // There is nothing to reload, and the buffer keeps every word (docs/app/keeping-work/storage-and-file-format.md#STOR-104). The
        // binder walk says what happened; a rename's play file re-points us.
        const decision = session.onExternalChange(null);
        if (decision.kind === "dirty-gate") {
          setGate(true);
          setStatus("conflict");
          void recoveryRef.current?.writeNow();
        }
        if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = setTimeout(() => void reconcileNowRef.current(), RECONCILE_DEBOUNCE_MS);
        return;
      }
      const decision = session.onExternalChange(e.hash);
      if (decision.kind === "reload") void reloadFromDisk();
      else if (decision.kind === "dirty-gate") {
        setGate(true);
        setStatus("conflict");
      }
    },
    [reloadFromDisk, materials.applyBinder, materials.onExternal, outline.onExternal],
  );
  handleExternalChangeRef.current = handleExternalChange;

  useEffect(() => {
    let dead = false;
    const offs: (() => void)[] = [];
    const track = (p: Promise<() => void>) => {
      void p
        .then((off) => {
          if (dead) off();
          else offs.push(off);
        })
        .catch((e: unknown) => {
          // Changes made outside may go unseen, so the writer is told. Said once; the
          // hash check on every save still stands.
          if (!dead) setError(`Proscenium couldn't watch the folder for changes made outside: ${String(e)}`);
        });
    };
    track(onExternalChange(handleExternalChange));
    track(onConflictCopy((e) => {
      if (e.root && e.root !== activeRootRef.current) return;
      setConflictCopies((c) => (c.includes(e.relPath) ? c : [...c, e.relPath]));
    }));
    return () => {
      dead = true;
      for (const off of offs) off();
    };
  }, [handleExternalChange]);

  /**
   * The app's own writes are what the writer has, so each one moves its file's
   * Changes baseline, whichever part of the app made it (own-writes.ts). The
   * store is the play the write was sent to, which is the folder it landed in.
   */
  useEffect(() => onOwnWrite(({ playId, rel, content }) => {
    if (isReviewable(rel)) void openChanges(playId).writeBaseline(rel, content);
  }), []);

  /**
   * Revalidate every displayed file on foreground and watcher recovery. A
   * desktop watcher improves freshness; it cannot replace this check, because a watcher can fail or drop events.
   * Every hash goes through the same dirty-buffer policy as a normal event.
   */
  useEffect(() => {
    let cancelled = false;
    let running = false;
    let again = false;
    const rescan = async () => {
      if (running) { again = true; return; }
      running = true;
      try {
        do {
          again = false;
          const generation = workspaceGenRef.current;
          const paths = [scriptPathRef.current, playPathRef.current, outline.record()?.path,
            ...materials.paths()]
            .filter((path): path is string => !!path);
          await revalidateFiles(paths, vault.read, handleExternalChange,
            () => !cancelled && workspaceGenRef.current === generation);
          if (!cancelled && workspaceGenRef.current === generation) void reconcileNowRef.current();
        } while (again && !cancelled);
      } finally {
        running = false;
      }
    };
    const onForeground = () => {
      if (document.visibilityState === "visible") void rescan();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    let off: (() => void) | undefined;
    void watcherHealth.onState((health) => {
      if (health.root === activeRootRef.current) void rescan();
    }).then((stop) => {
      if (cancelled) stop(); else off = stop;
    });
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
      off?.();
    };
  }, [handleExternalChange]);

  /**
   * Which scenes carry a mark right now.
   *
   * Derived from the pending entries for the OPEN script only — a change to a
   * character sheet has no scene to point at. Recomputed when the ledger moves,
   * never stored: this is a view of the ledger, not a second copy of it.
   */
  useEffect(() => {
    const path = scriptPath;
    const changes = changesRef.current;
    const pending = ledger.filter((e) => e.status === "pending" && e.revertable && path !== null && samePath(e.path, path));
    if (!path || !changes || pending.length === 0) {
      setChangedScenes((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    let dead = false;
    void (async () => {
      const marks = new Set<number>();
      const tracked: TrackedMarks[] = [];
      try {
        const after = (await vault.read(path)).content;
        for (const entry of pending) {
          const before = await changes.readBefore(entry.id);
          if (before === null) continue;
          for (const ord of touchedScenes(before, after)) marks.add(ord);
          // The editor holds the BODY doc; the title page is a separate
          // surface. Diffing whole files would offset every block index by the
          // title-page lines and put the marks on the wrong speeches, so both
          // sides are reduced to body text first.
          tracked.push(computeMarks(bodyTextOf(before), bodyTextOf(after)));
        }
      } catch {
        /* a script we cannot read carries no marks */
      }
      if (dead) return;
      setChangedScenes(marks);
      setTrackedMarks(mergeMarks(tracked));
    })();
    return () => {
      dead = true;
    };
  }, [ledger, scriptPath]);

  /**
   * Keep each character sheet's `## Appearances` current.
   *
   * Keyed on `cards` — which moves after every successful save — plus the
   * binder, so adding a sheet fills it in without touching the script. The sync
   * is a no-op when nothing moved (it compares before writing), so the common
   * case costs one read per sheet and no file events.
   */
  const appearanceInputsRef = useRef({ binder, cards });
  appearanceInputsRef.current = { binder, cards };
  useEffect(() => {
    if (!root || mode !== "workspace" || readOnly) return;
    // THROTTLE, not a debounce — see the note on scheduleThrottled. `binder`
    // and `cards` both move while the app is working (an autofile pass files
    // several materials, each a new binder), and a debounce would have its
    // timer reset out from under it every time and never fire at all.
    scheduleThrottled(appearancesTimerRef, APPEARANCES_DEBOUNCE_MS, () => {
      const { binder: b, cards: c } = appearanceInputsRef.current;
      const appearances = computeAppearances(docRef.current, c);
      void syncAppearances({
        binder: b,
        appearances,
        // Adopt a sheet we have open, so the buffer on screen matches disk
        // without waiting for a watcher — browser dev and iOS have none.
        onWrote: (path, content, hash) => adoptMaterialWrite(path, content, hash),
        // Not a sheet with words of the writer's own not yet saved: rewriting
        // it under them is how those words were lost. It syncs once they land.
        skip: (path) => {
          const id = idForMaterialPath(path);
          return id !== null && (materialUnsaved(id) || materials.hasGate(id));
        },
      });
    });
  }, [root, mode, readOnly, binder, cards, materialsTick]);

  // Flush on blur/quit (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). And back in the window, saves the disk
  // refused try again: the writer was most likely in Finder unlocking the
  // file, or making room, as the toast asked — "it will save once" is kept
  // without waiting for the next keystroke.
  useEffect(() => {
    const onBlur = () => autosaveRef.current?.flushNow();
    const onFocus = () => {
      for (const key of refusedRef.current.keys()) {
        if (key.startsWith("script:")) flushRef.current();
        else if (key === "outline") void outline.flush();
        else void materials.flushMaterial(key.slice("sheet:".length));
      }
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("beforeunload", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("beforeunload", onBlur);
    };
  }, []);

  // Unsaved-work beacon for the installer: "unsafe to replace the
  // app" while words exist anywhere the disk does not have them — the script
  // (dirty, mid-write, behind its banner), any open sheet, the outline
  // scratchpad. It used to read the one status line, which a sheet that had
  // just saved set to "Saved" over a script still unsaved. Sent on change only.
  const beaconRef = useRef<boolean | null>(null);
  const confirmSaveState = async (force = true) => {
    const unsafe =
      // The forced acknowledgement follows settleForQuit. React may still
      // display its earlier "Saving" render; the live buffer refs decide it.
      (!force && (status === "dirty" || status === "saving" || status === "conflict")) ||
      !!sessionRef.current?.dirty ||
      gateRef.current ||
      materials.unsafe() ||
      outline.unsafe();
    if (!force && unsafe === beaconRef.current) return;
    beaconRef.current = unsafe;
    await settings.setBufferState(unsafe);
  };
  syncBeaconRef.current = () => { void confirmSaveState(false).catch(() => {}); };
  useEffect(() => syncBeaconRef.current(), [status, gate, materialGates, outlineGate]);

  /** These transitions join the existing queue; a failed settlement never opens another root. */
  const openPractice = async (session?: string, create = false) => {
    const practiceRoot = session ? await tutorials.session(session, create) : await tutorials.root();
    const before = {root: practiceRootRef.current, session: practiceSessionRef.current, source: practiceSourceRef.current, practicing: practiceRef.current, returning: practiceReturnRef.current};
    if (!practiceRef.current) practiceReturnRef.current = {base: vaultRootRef.current, dir: playDirRef.current, script: scriptPathRef.current};
    practiceRootRef.current = practiceRoot; practiceSessionRef.current = session;
    practiceRef.current = true; setPracticing(true);
    const rollback = () => {
      practiceRootRef.current = before.root; practiceSessionRef.current = before.session; practiceSourceRef.current = before.source;
      practiceRef.current = before.practicing; setPracticing(before.practicing); practiceReturnRef.current = before.returning;
    };
    try {
      if (!(await openAny(practiceRoot))) {rollback(); return false;}
      if (vaultRootRef.current !== practiceRoot) throw new Error("The practice folder could not be opened.");
      practiceSourceRef.current = null;
      return true;
    } catch(e) {if (vaultRootRef.current !== practiceRoot) rollback(); throw e;}
  };
  const startPractice = async (_title: string, script: string, resumeDir?: string, resumedSession?: string) => {
    const session = resumeDir ? resumedSession : ulid();
    if (!(await openPractice(session, !resumeDir))) return null;
    const dir = resumeDir ?? "Practice Play";
    if (!resumeDir) await scaffoldPlayAt(dir, dir, new Date().toISOString(), script, "stage-us-modern", null);
    const found = await discoverPlays(); setPlays(found);
    const play = found.find(p => p.dir === dir);
    if (!play) throw new Error("This practice could not be opened. Earlier files have not been changed; check Saved Practice.");
    await enterPlay(play);
    if (playIdRef.current !== play.id) return null;
    practiceSourceRef.current = {session, dir};
    return {id: play.id, dir: play.dir, session};
  };
  const keepPractice = async (title: string) => {
    const source = practiceSourceRef.current;
    const base = practiceReturnRef.current?.base;
    const manifest = playPathRef.current;
    if (!practiceRef.current || !source || !base || !manifest || readOnlyRef.current) throw new Error("Open a practice and choose a Plays folder before keeping a copy.");
    if (!(await teardownWorkspace(true))) throw new Error("Save or resolve the pending edits before keeping a copy. Your practice stays here.");
    let copy: {dir: string; base: string} | null = null;
    let failure: unknown;
    try {
      const captured = await copyPractice.capture(manifest);
      await vault.open(base);
      copy = {dir: await copyPractice.install(source, title, captured), base};
    } catch(e) {failure = e;}
    // The original stays the active practice. Opening the verified copy is a
    // separate choice; failed or partial copies never consume the original.
    try {
      const opened = await startPractice("Practice Play", "", source.dir, source.session);
      if (!opened) throw new Error("The original practice could not be reopened. It remains in Saved Practice.");
    } catch(e) {throw new Error([failure, copy ? "The copy is in your Plays folder." : null, String(e)].filter(Boolean).join(" "));}
    if (failure) throw failure;
    if (!copy) throw new Error("The copy was not completed. The original practice is kept.");
    return copy;
  };
  const stopPractice = async () => {
    const prior = practiceReturnRef.current;
    if (!practiceRef.current) return true;
    if (prior?.base) {
      returningFromPractice.current = true;
      try {
        if (!(await openAny(prior.base))) return false;
        if (prior.dir) {
          const play = (await discoverPlays()).find(p => p.dir === prior.dir);
          if (play) await enterPlay(play, prior.script);
          else setNotice("Your previous play is no longer available. Choose a play from the list.");
        }
      } finally {returningFromPractice.current = false;}
    } else {
      if (!(await teardownWorkspace())) return false;
      setRoot(null); setVaultRoot(null); vaultRootRef.current = null; setPlays([]);
    }
    practiceRef.current = false;
    setPracticing(false);
    practiceReturnRef.current = null;
    return true;
  };

  return {
    practicing,
    startPractice: (title, script, dir, session) => line(() => startPractice(title, script, dir, session)),
    keepPractice: title => line(() => keepPractice(title)),
    canKeepPractice: practicing && !!practiceSourceRef.current && !!practiceReturnRef.current?.base,
    openPracticeCopy: copy => line(async () => {
      if (!(await stopPractice())) return false;
      return openPlayByDir(copy.dir, null, copy.base);
    }),
    stopPractice: () => line(stopPractice),
    isPractice: id => practiceRef.current && playIdRef.current === id && vaultRootRef.current === practiceRootRef.current,
    browsePractice: () => line(() => openPractice()),
    mode,
    vaultRoot,
    plays,
    // Everything that closes what is open and reopens the vault somewhere else
    // waits its turn (one-at-a-time.ts).
    enterPlay: (play) => line(() => enterPlay(play)),
    playSettled,
    backToVault: () => void line(() => backToVault()),
    createPlay: (title, script, keep) => void line(() => createPlay(title, script, keep)),
    createPlayFrom: (title, script, keep) => line(() => createPlay(title, script, keep)),
    openPlayByDir: (dirName, script, inFolder) => line(() => openPlayByDir(dirName, script, inFolder)),
    adoptPlaysFolder: (path) => line(() => adoptPlaysFolder(path)),
    playsFolderHint,
    // The folder the question on screen is about, from this render: the ref
    // moves to the next folder a moment before the screen does.
    openFolderBelow: (dir) => line(() => openFolderBelow(playsFolderHint ? vaultRoot : null, dir)),
    keepPlaysFolder: () => {
      if (playsFolderHint && vaultRoot) setKeptFolder(vaultRoot);
    },
    lookingBelow: vaultRoot !== null && foldersBelow === null,
    booted,
    updatePlay: (dir, patch) => void updatePlay(dir, patch),
    root,
    playId: mode === "workspace" ? playIdRef.current : null,
    playTitle,
    binder,
    ledger,
    changedScenes,
    showTracked,
    setShowTracked: setShowTrackedState,
    trackedMarks,
    hasTrackedChanges: trackedMarks.added.size > 0 || trackedMarks.removedBefore.size > 0,
    changeDiff,
    keepChange: (id) => void keepChange(id),
    revertChange,
    missingItems,
    newlyFiled,
    acknowledgeFiled,
    cast,
    activeId,
    readOnly,
    rawPlay,
    closeRawPlay: () => setRawPlay(null),
    retryRawPlay: () => {
      if (!rawPlay) return;
      const play = rawPlay.play;
      setRawPlay(null);
      void line(() => enterPlay(play));
    },
    revealRawPlay: () => { if (rawPlay) void vault.reveal(rawPlay.play.dir + "/" + rawPlay.play.file).catch((e) => setError(String(e))); },
    conflictCopies,
    loadOther,
    keepOther,
    trashOther,
    preserved,
    error,
    scriptTitle,
    scriptPath,
    // While the disk refuses a save, "Saved" or "Editing…" would say the words
    // are on their way as usual. A banner, or a retry in flight, says more.
    status: refusedSaves > 0 && status !== "conflict" && status !== "saving" ? "unsaved" : status,
    gate,
    editable: !!scriptPathRef.current && !!root && !readOnly,
    recoveryOffer,
    recoverOffer,
    discardOffer: () => void discardOffer(),
    versionsOf,
    outlineNoteId: outlineNotePath ? (outline.record()?.id ?? null) : null,
    listVersions,
    readVersion,
    restoreVersion,
    currentScriptText,
    view,
    cards,
    setView,
    openScene,
    openComment,
    editor,
    openFind,
    setCard: (sceneId, partial) => void setCard(sceneId, partial),
    reorderScene: (from, to) => void reorderScene(from, to),
    editSynopsis: (ordinal, text) => void editSynopsis(ordinal, text),
    addScene: (title) => void addScene(title),
    format: resolvedFormat.spec,
    formats: registry.list(),
    setFormat: (id) => void setFormat(id),
    playLanguage: playRef.current?.data.settings.language ?? DEFAULT_PLAY_LANGUAGE,
    savePlayLanguage,
    formatWarnings,
    paginated,
    setPaginated,
    layoutMeta,
    frontMatter,
    saveFrontMatter,
    openScriptKey,
    saveCharacters,
    patchFrontMatter,
    castAppearances,
    castWeights,
    scenePages,
    sceneCount: cards.length,
    castHidden,
    hideFromCast,
    unhideFromCast,
    layoutForExport,
    exportScript: (opts) => void exportScript(opts),
    exporting,
    notice,
    dismissNotice: () => setNotice(null),
    openMaterials,
    saveMaterial,
    setMaterialField,
    editMaterialTags,
    setMaterialDirty,
    registerMaterialBuffer,
    flushMaterial,
    materialGates,
    resolveMaterialGate: (id, choice) => void resolveMaterialGate(id, choice),
    closeMaterial,
    settleForQuit,
    confirmSaveState,
    outlineBody,
    outlineNotePath,
    saveOutlineNote,
    outlineReset,
    outlineReady: !outlineLoading,
    outlineGate,
    resolveOutlineGate: (choice) => void resolveOutlineGate(choice),
    registerOutlineBuffer,
    setOutlineDirty,
    openFolder: () => void line(() => openFolder()),
    openCloudFolder: () => void line(() => openCloudFolder()),
    cloudRoot,
    wherePlaysLive,
    playsProvider: providerKind(playsProviders),
    selectItem,
    onEditorReady,
    onEditorChange,
    onSaveShortcut,
    loadTheirs,
    keepMine: () => void keepMine(),
    dismissError: () => setError(null),
    reorder,
    renameTo,
    moveTo,
    createFolder,
    createMaterial,
    createScript,
    duplicate,
    revealItem,
    canReveal,
    justCreated,
    consumeCreated,
    remove,
  };
}
