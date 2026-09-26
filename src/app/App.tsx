// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
useCallback,
useEffect,
useMemo,
useRef,
useState,
type ReactNode
} from "react";
import { CommentsFeed } from "../comments";
import { commentsState } from "../comments/plugin";
import {
errorShown,
playOpened,
surfaceShown,
workspaceErrorCode
} from "../diagnostics";
import { FeedbackSheet } from "../feedback/FeedbackSheet";
import { PlayEditor } from "../editor";
import { useCaretScene } from "../editor/caret-scene";
import { ChangesView } from "../review";
import { useRecoveryCopies } from "../review/RecoveryCopies";
import { useSavedCopies } from "../review/SavedCopies";
import { settings,vault } from "../storage";
import type { Surface as ReportedSurface } from "../storage/ipc";
import { Button,ToastHost,useToast } from "../ui";
import type { BinderItem } from "../workspace";
import { titleOf } from "../workspace";
import { Binder } from "../workspace/BinderView";
import { CorkboardView } from "../workspace/CorkboardView";
import { MaterialEditor } from "../workspace/MaterialEditor";
import { OutlinerView } from "../workspace/OutlinerView";
import { AppDialogs } from "./AppDialogs";
import { BannerActions } from "./BannerActions";
import { CastView } from "./CastView";
import type { ExportRequest } from "./ExportDialog";
import { Inspector,type InspectorTab } from "./Inspector";
import { PaneTree } from "./PaneTree";
import { SceneInspector } from "./SceneInspector";
import { SheetInspector } from "./SheetInspector";
import { StatusBar } from "./StatusBar";
import { Toolbar,type ViewId } from "./Toolbar";
import { VaultScreen } from "./VaultScreen";
import { ImportPanel, type ImportRequest, type ImportSource } from "../import/ImportPanel";
import { WelcomeScreen } from "./WelcomeScreen";
import { LaunchScreen } from "./LaunchScreen";
import { ZoomControl } from "./ZoomControl";
import {
openFormatDesigner,
useFormatDesignerRequest
} from "./formats/open";
import { findLeaf,hasSurface,type Surface } from "./panes";
import { usePrivacyNotice } from "./privacy-notice";
import { useQuitGate } from "./quit";
import { playLanding } from "./regions";
import {
learnWord,
openSettings,
updateSettings,
useOpenAtLaunch,
useSettings,
useSettingsSheet
} from "./settings";
import { UpdateInstallSheet } from "./update-lock";
import { useUpdateNotices } from "./updates";
import { useCreatedPages } from "./use-created-pages";
import { useKeyboardInset } from "./use-keyboard-inset";
import { useNarrowLayout } from "./use-narrow-layout";
import { useShellCommands,VIEW_TO_SURFACE } from "./use-shell-commands";
import { findBinderItem,useWorkspacePanes } from "./use-workspace-panes";
import { findFitTarget,useZoom } from "./use-zoom";
import { useFinderOpens } from "./useFinderOpens";
import { useWorkspace } from "./useWorkspace";
import { useTutorial } from "../tutorial/useTutorial";
import { Catalogue, TutorialInvitation } from "../tutorial/Catalogue";
import { CueCard } from "../tutorial/CueCard";

/** "2m ago" — the only place the app phrases a timestamp loosely, because a
    change that just landed is news and news has an age, not a clock time. */
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** The binder's "Characters" folder, so new character sheets land there. */
function findCharactersFolder(binder: BinderItem[]): BinderItem | null {
  return (
    binder.find((it) => it.type === "folder" && /^characters$/i.test(titleOf(it))) ?? null
  );
}

/** What `surface_shown` calls each view (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3). */
const REPORTED_SURFACE: Record<ViewId, ReportedSurface> = {
  script: "script",
  corkboard: "board",
  outliner: "outline",
  cast: "cast",
  changes: "changes",
};

const BINDER_OPEN_KEY = "proscenium:binderOpen";
const INSPECTOR_OPEN_KEY = "proscenium:inspectorOpen";
const INSPECTOR_TAB_KEY = "proscenium:inspectorTab";

/* Multi-pane, so the script and its board or outline can be open at once: an arbitrary split tree of tab groups.
   The model is panes.ts, the state shell use-panes.ts, the renderer
   PaneTree.tsx — this file only says what each surface IS. */

/**
 * The shell, inside the toast host so anything under it can raise one (the
 * binder's undo toast, chiefly — Move to Trash stopped asking).
 */
export function App() {
  return (
    <ToastHost onError={errorShown}>
      <AppShell />
      <FeedbackSheet />
      <UpdateInstallSheet />
    </ToastHost>
  );
}

function AppShell() {
  const ws = useWorkspace();
  const savedCopies = useSavedCopies(ws.mode === "workspace" ? ws.root : null);
  const recoveryCopies = useRecoveryCopies(ws.playId, ws.root, ws.binder);
  // "Proscenium x.y.z is ready" when an update has downloaded, and a restart
  // that flushes this workspace's edits before anything is installed.
  useUpdateNotices(ws.settleForQuit, ws.confirmSaveState);
  /* Every quit — ⌘Q, the Dock, logging out, the window's close button — asks
     here first, and waits while the play keeps its words (quit.ts). */
  const quitGate = useQuitGate(ws.settleForQuit);
  const toast = useToast();
  /* Every preference, from the one store the Settings sheet writes to — so the
     document menu's Check Spelling as You Type and Settings › Writing cannot
     disagree. */
  const prefs = useSettings();
  const privacyNoticeDue = usePrivacyNotice(ws.booted, !!ws.root);
  const settingsSheet = useSettingsSheet();
  const designer = useFormatDesignerRequest();
  /* Plays, scripts and .fdx files opened from Finder (docs/app/keeping-work/storage-and-file-format.md#STOR-D5). */
  const [importQueue, setImportQueue] = useState<(ImportRequest & { id: number })[]>([]);
  const importId = useRef(0);
  /* Import follows where the writer is (docs/app/importing/document-import.md#IMPT-95):
     on the Plays screen it makes a play; in a play it adds a script or a
     binder document to that play. Finder always makes a play. */
  const openPlayTitle = ws.mode === "workspace" && ws.playTitle ? ws.playTitle : undefined;
  const beginImport = useCallback((sources: ImportSource[] = [], play?: string, parentId: string | null = null) => {
    if (!ws.vaultRoot) {
      toast({ kind: "plain", title: "Choose where your plays live first", detail: "Then use Import a Draft to bring your writing here." });
      return Promise.resolve();
    }
    if (sources.length > 20) {
      toast({ kind: "plain", title: "Choose up to 20 files at a time", detail: "Each file is reviewed before it becomes a separate play." });
      return Promise.resolve();
    }
    return new Promise<void>(finish => {
      const id = ++importId.current;
      const folder = parentId ? findBinderItem(ws.binder, parentId) : null;
      setImportQueue(q => [...q, { id, sources, finish, play, parentId, folder: folder ? titleOf(folder) : undefined }]);
    });
  }, [ws.vaultRoot, ws.binder, toast]);
  const finderOpens = useFinderOpens(ws, toast, path => beginImport([{ path }]));
  useEffect(() => {
    const open = () => { void beginImport([], openPlayTitle); };
    window.addEventListener("proscenium:import-draft", open);
    return () => window.removeEventListener("proscenium:import-draft", open);
  }, [beginImport, openPlayTitle]);
  /* Where the writer was last, on the empty screen — the one fact that turns
     "open a folder" from a question into a reminder. */
  const [lastVault, setLastVault] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void settings.getLastVault().then(
      (v) => live && setLastVault(v),
      () => {
        /* first run has no last vault, which is not an error */
      },
    );
    return () => {
      live = false;
    };
  }, []);
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** Read at key time: ⌘/ may close its own overlay while that overlay is a layer. */
  const showShortcutsRef = useRef(false);
  showShortcutsRef.current = showShortcuts;
  const [showGoToScene, setShowGoToScene] = useState(false);
  /* Focus mode (docs/app/preferences-and-help/accessibility.md#A11Y-7): "chrome earns pixels" taken to its end. Nothing
     new to learn — the same page, the same keys, with everything that is not
     the page slid away until the pointer moves. */
  const [focusMode, setFocusMode] = useState(false);
  /** In focus mode the chrome comes back while the pointer is moving. */
  const [peeking, setPeeking] = useState(false);
  const [showTitlePage, setShowTitlePage] = useState(false);
  /** Latest feed toggle, so the ⌘⇧C listener isn't rebound on every layout. */
  const toggleCommentsRef = useRef<() => void>(() => {});

  /* Narrow layouts (an iPad in portrait, a small desktop window) have no room
     for 624px of rails beside an 816px sheet — the script pane is left with
     about 210px and the page is clipped on both sides. So below the breakpoint
     at most ONE rail shows: whichever was opened last.

     `binderOpen`/`inspectorOpen` stay the writer's *intent* and are never rewritten
     here, so rotating back to landscape restores exactly what they had. And
     because each rail keeps its thin collapsed strip, every tap still does
     something visible — which a plain "hide the rails" would not. Landscape is
     a different problem and gets a different answer: fit-width zoom, since 560px
     for an 816px page overflows too (use-zoom.ts). */
  // Binder ids whose file is gone from disk, for the greyed "missing" chip.
  const missingIds = useMemo(
    () => new Set(ws.missingItems.map((i) => i.id)),
    [ws.missingItems],
  );
  // How many changes from outside the app are still waiting on the writer.
  const pendingChanges = useMemo(
    () => ws.ledger.filter((e) => e.status === "pending").length + savedCopies.copies.length + recoveryCopies.copies.length,
    [ws.ledger, savedCopies.copies, recoveryCopies.copies],
  );

  const narrow = useNarrowLayout();
  const [narrowRail, setNarrowRail] = useState<"binder" | "inspector" | null>(null);
  // The soft keyboard's inset (iOS); a no-op wherever there isn't one.
  useKeyboardInset();

  const openTitlePage = useCallback(() => setShowTitlePage(true), []);
  /**
   * Versions, and of what: the script (null), or the sheet or outline note
   * in front when it was asked for — their kept words were in Versions with
   * nothing in the app able to show them.
   */
  const [showHistory, setShowHistoryFor] = useState<{ id: string | null } | null>(null);
  /** The review of words a crash left behind (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). */
  const [showRecovery, setShowRecovery] = useState(false);
  // Export is a dialog now (which pages, seen first), so the menu item opens
  // it and the export itself happens on the way out. It can open preselected
  // to one character's sides (from the Cast surface), and Print opens the same
  // dialog with printing as its default, so what prints is what exports.
  const [showExport, setShowExport] = useState<ExportRequest | null>(null);
  /** The frame of the Plays and welcome screens. A fit zoom solves against a pane instead (findFitTarget). */
  const mainRef = useRef<HTMLElement | null>(null);

  const {
    panes,
    paneTree,
    openMaterialTab,
    editorParkRef,
    editorHostRef,
    scriptScrollerRef,
    setScriptSlot,
    paneRootRef,
    scriptVisible,
    visibleSurfaces,
    labelFor,
    toolbarAddable,
    addableFor,
    onActivateTab,
    switcherView,
    onCloseTab,
    onSelectBinderItem,
    onDropBinderItem,
    splitFocused,
  } = useWorkspacePanes(ws);
  /* Until the launch has arrived, the launch screen covers the window: the
     Welcome and Plays screens are not mounted under it, and the play loads and
     lays out beneath it, so it is shown once, in place. In place means the
     script has settled at the writer's place and every sheet on screen has
     its words — or could not have them, which the error says. */
  const frontInPlace =
    ws.playSettled &&
    (!!ws.error || visibleSurfaces.every((s) => s.kind !== "material" || !!ws.openMaterials[s.id]));
  const { launching, opening } = useOpenAtLaunch(ws, frontInPlace);
  // A new document, sheet or script opens, and its page takes the cursor (docs/app/preferences-and-help/accessibility.md#A11Y-4).
  useCreatedPages(ws, onSelectBinderItem);

  /* The anonymous facts only the page sees (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3): a
     play opened, with the Plays folder's count for Rust to bucket, and each
     surface as it comes on screen — which Rust reports once a launch. Rust
     decides whether any of it is sent. */
  const playInFront = ws.mode === "workspace" ? ws.root : null;
  const playsInFolder = ws.plays.length;
  useEffect(() => {
    if (playInFront) playOpened(playsInFolder);
    // Once per play entered, not again when the Plays folder is rescanned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playInFront]);
  const surfaceInFront = ws.mode === "workspace" && ws.scriptTitle ? switcherView : null;
  useEffect(() => {
    if (surfaceInFront) surfaceShown(REPORTED_SURFACE[surfaceInFront]);
  }, [surfaceInFront]);
  useEffect(() => {
    if (designer.request) surfaceShown("format-designer");
  }, [designer.request]);

  /* "Saved" is a fact with a time on it, not a badge with a colour. The clock is
     read when the save lands, because reading it at render would make the bar
     re-time itself on every keystroke. */
  const [savedTime, setSavedTime] = useState<string | null>(null);
  useEffect(() => {
    if (ws.status !== "saved") return;
    setSavedTime(
      new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    );
  }, [ws.status]);

  /** What the focused pane is showing, for the titlebar. */
  const focusedTitle = useMemo(() => {
    const leaf = panes.focusedLeaf ? findLeaf(paneTree, panes.focusedLeaf) : null;
    const surface = leaf?.tabs[leaf.active];
    if (surface?.kind === "material") {
      const item = findBinderItem(ws.binder, surface.id);
      return item ? titleOf(item) : ws.scriptTitle;
    }
    return ws.scriptTitle;
  }, [paneTree, panes.focusedLeaf, ws.binder, ws.scriptTitle]);

  // Outline and Cast are hosted by whichever pane asks for them, so their props
  // are declared once here and the copies can never drift apart.
  const outlineSurface = useCallback(
    () => (
      <OutlinerView
        cards={ws.cards}
        onReorder={ws.reorderScene}
        onSetCard={ws.setCard}
        onEditSynopsis={ws.editSynopsis}
        onOpenScene={ws.openScene}
        scenePages={ws.scenePages}
        notes={ws.outlineBody}
        notesPath={ws.outlineNotePath}
        onEditNotes={ws.saveOutlineNote}
        onNotesDirty={ws.setOutlineDirty}
        notesReset={ws.outlineReset}
        notesReady={ws.outlineReady}
        notesGate={ws.outlineGate}
        onResolveNotesGate={ws.resolveOutlineGate}
        onRegisterNotesBuffer={ws.registerOutlineBuffer}
        changedScenes={ws.changedScenes}
      />
    ),
    [ws],
  );

  const castSurface = useCallback(
    () => (
      <CastView
        characters={ws.frontMatter.characters ?? []}
        printedPage={ws.frontMatter.charactersPage}
        onSavePage={(charactersPage) => ws.patchFrontMatter({ charactersPage }, ws.openScriptKey)}
        appearances={ws.castAppearances()}
        weights={ws.castWeights}
        sceneCount={ws.sceneCount}
        hidden={ws.castHidden}
        binder={ws.binder}
        scriptKey={ws.scriptPath}
        onSave={ws.saveCharacters}
        onOpenSheet={openMaterialTab}
        onCreateSheet={(name) => {
          const chars = findCharactersFolder(ws.binder);
          ws.createMaterial(chars?.id ?? null, "character", name);
        }}
        onHide={ws.hideFromCast}
        onUnhide={ws.unhideFromCast}
        cards={ws.cards}
        onOpenScene={ws.openScene}
        onExportSides={(name) => setShowExport({ sidesFor: name })}
      />
    ),
    [ws, openMaterialTab],
  );

  const [binderOpen, setBinderOpenState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BINDER_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const setBinderOpen = (on: boolean) => {
    setBinderOpenState(on);
    if (on) setNarrowRail("binder");
    try {
      localStorage.setItem(BINDER_OPEN_KEY, on ? "1" : "0");
    } catch {
      /* chrome preference only */
    }
  };

  const binderVisible = binderOpen && (!narrow || narrowRail === "binder");

  /* Zoom (use-zoom.ts): still a pure view transform, so
     the engine's geometry and every page break are identical at every level.
     Declared here because a fit mode has to re-solve whenever the pane's width
     changes, and before the surfaces because a material's sheet takes the same
     zoom as the script's page (MaterialEditor). */
  const zoomCtl = useZoom({
    temporary: ws.practicing,
    // The pane the page is in, wherever it currently is — the script's, or a
    // sheet's when no pane shows the script. A fit has to solve against the box
    // the sheet actually sits in, not a fixed frame.
    target: () => findFitTarget(scriptScrollerRef.current, paneRootRef.current),
    format: ws.format,
    active: ws.mode === "workspace" && !!ws.scriptTitle,
    // The EFFECTIVE layout, not the intent — a rail suppressed by a narrow
    // layout changes the pane's width just as closing it would, and a fit that
    // solved against the wrong width is the bug this token exists to prevent.
    // The whole tree is in the token because ANY reshape can resize the page's
    // pane or move the page to another one; the focused pane, because with no
    // script showing it decides which sheet that is.
    layout: `${binderVisible}:${panes.focusedLeaf}:${JSON.stringify(paneTree)}`,
  });
  const { zoom, zoomBy, refit } = zoomCtl;
  const zoomReset = zoomCtl.reset;

  const renderSurface = useCallback(
    (surface: Surface): ReactNode => {
      switch (surface.kind) {
        case "script":
          // Just the landing site — the editor's DOM is moved in above.
          return <div className="pane-scriptslot editor-frame--desk" ref={setScriptSlot} />;
        case "corkboard":
          return (
            <CorkboardView
              cards={ws.cards}
              onReorder={ws.reorderScene}
              onSetCard={ws.setCard}
              onEditSynopsis={ws.editSynopsis}
              onAddScene={ws.editable ? () => ws.addScene() : undefined}
              onOpenScene={ws.openScene}
              scenePages={ws.scenePages}
              changedScenes={ws.changedScenes}
            />
          );
        case "outliner":
          return outlineSurface();
        case "cast":
          return castSurface();
        case "changes":
          return (
            <ChangesView
              key={ws.root}
              entries={ws.ledger}
              otherVersions={ws.conflictCopies}
              savedCopies={savedCopies.copies}
              savedCopiesError={savedCopies.error}
              recoveryCopies={recoveryCopies}
              loadDiff={ws.changeDiff}
              onKeep={ws.keepChange}
              onRevert={ws.revertChange}
              loadOther={ws.loadOther}
              onKeepOther={ws.keepOther}
              onTrashOther={ws.trashOther}
            />
          );
        case "comments":
          // The feed reads the comments straight out of the open script — a
          // comment IS text in it, so there is nothing else to keep in sync.
          return <CommentsFeed editor={ws.editor} onJump={ws.openComment} />;
        case "material": {
          // Every open sheet has its own buffer, hash and gate, keyed by binder
          // id — so two of them can be live in two panes at once.
          const open = ws.openMaterials[surface.id];
          // A restored tab whose buffer has not arrived yet. It always does —
          // the effect below asks for it — so this is a beat, not a state.
          if (!open) return <div className="pane-parked">Opening…</div>;
          return (
            <div className="pane-scriptslot editor-frame--desk">
              <MaterialEditor
                key={open.item.id}
                item={open.item}
                content={open.content}
                reset={open.reset}
                onSave={(content, base) => ws.saveMaterial(surface.id, content, base)}
                onRename={ws.readOnly ? undefined : ws.renameTo}
                onEditTags={ws.readOnly ? undefined : (edit) => void ws.editMaterialTags(surface.id, edit)}
                onDirty={(dirty) => ws.setMaterialDirty(surface.id, dirty)}
                onRegisterBuffer={(buffer) => ws.registerMaterialBuffer(surface.id, buffer)}
                gate={ws.materialGates[surface.id] ?? null}
                onResolveGate={(choice) => ws.resolveMaterialGate(surface.id, choice)}
                // The script's page, at the script's zoom: a note is a page too.
                format={ws.format}
            language={ws.playLanguage}
                zoom={zoom}
                // Page and Source move the sheet: a fit counts what is above it.
                onSheetMoved={refit}
              />
            </div>
          );
        }
      }
    },
    [ws, outlineSurface, castSurface, zoom, refit],
  );

  // Per-surface scroll memory now lives in the pane that owns the
  // scroller — see PaneTree's LeafView. With one scroller per pane there is no
  // single frame to key it against here any more.

  /* The inspector is the new home for Comments. It is still a pane surface —
     ⤢ moves the active tab into the split tree — so the rail is a default,
     not a cage. */
  const [inspectorOpen, setInspectorOpenState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(INSPECTOR_OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [inspectorTab, setInspectorTabState] = useState<InspectorTab>(() => {
    try {
      const v = localStorage.getItem(INSPECTOR_TAB_KEY);
      return v === "comments" ? v : "scene";
    } catch {
      return "scene";
    }
  });
  const setInspectorOpen = useCallback((on: boolean) => {
    setInspectorOpenState(on);
    if (on) setNarrowRail("inspector");
    try {
      localStorage.setItem(INSPECTOR_OPEN_KEY, on ? "1" : "0");
    } catch {
      /* chrome preference only */
    }
  }, []);
  const setInspectorTab = useCallback((t: InspectorTab) => {
    setInspectorTabState(t);
    try {
      localStorage.setItem(INSPECTOR_TAB_KEY, t);
    } catch {
      /* chrome preference only */
    }
  }, []);

  // `binderVisible` is further up, beside the zoom whose fit it re-solves.
  const inspectorVisible =
    inspectorOpen && !!ws.scriptTitle && (!narrow || narrowRail === "inspector");

  /* The comment feed has TWO homes now: the inspector by default, and the
     split tree when ⤢ pops it out. The toggle means "show me this", wherever
     it happens to live — so a tab already open as a pane is focused rather
     than duplicated into the rail. */
  const commentsPaned = hasSurface(paneTree, { kind: "comments" });

  const showInInspector = useCallback(
    (tab: InspectorTab) => {
      setInspectorTab(tab);
      setInspectorOpen(true);
    },
    [setInspectorTab, setInspectorOpen],
  );

  const toggleComments = useCallback(() => {
    if (commentsPaned) {
      panes.closeSurface({ kind: "comments" });
      return;
    }
    if (inspectorVisible && inspectorTab === "comments") setInspectorOpen(false);
    else showInInspector("comments");
  }, [
    commentsPaned,
    panes,
    inspectorVisible,
    inspectorTab,
    setInspectorOpen,
    showInInspector,
  ]);
  toggleCommentsRef.current = toggleComments;

  const commentsOpen = commentsPaned || (inspectorVisible && inspectorTab === "comments");

  /** ⤢ — move the inspector's active tab into a pane of its own. */
  const popOutInspector = useCallback(() => {
    if (inspectorTab === "comments") panes.openBeside({ kind: "comments" }, "row");
    else return;
    setInspectorTab("scene");
  }, [inspectorTab, panes, setInspectorTab]);

  /* ── What the inspector is looking at ─────────────────────────────────── */

  /** The scene the caret is in — the inverse of `openScene` (caret-scene.ts). */
  const caretOrdinal = useCaretScene(ws.editor);
  const caretOrdinalRef = useRef<number | null>(null);
  caretOrdinalRef.current = caretOrdinal;
  const caretCard = useMemo(
    () => ws.cards.find((c) => c.anchor.ordinal === caretOrdinal) ?? null,
    [ws.cards, caretOrdinal],
  );

  /** Who speaks in this scene, and how often — from the same appearance map
      the Cast surface and the character sheets read. */
  const caretSpeakers = useMemo(() => {
    if (caretOrdinal === null) return [];
    const out: { name: string; lines: number }[] = [];
    for (const [name, scenes] of ws.castAppearances()) {
      if (!scenes.some((sc) => sc.ordinal === caretOrdinal)) continue;
      out.push({ name, lines: ws.castWeights.get(name)?.lines ?? 0 });
    }
    return out.sort((a, b) => b.lines - a.lines);
  }, [caretOrdinal, ws]);

  /* Comments in this scene. A comment IS text in the script, so this counts the
     same plugin state the feed and the margin read — there is no comment store
     that could disagree with the document. Recomputed on every doc change,
     which is what `docVersion` is for. */
  const docVersion = ws.editor?.state.doc.nodeSize ?? 0;
  const caretComments = useMemo(() => {
    const heading = caretCard?.heading ?? null;
    const state = ws.editor ? commentsState(ws.editor.state) : undefined;
    if (!state || heading === null) return { total: 0, todo: 0 };
    let total = 0;
    let todo = 0;
    for (const entry of state.entries) {
      if (entry.scene !== heading) continue;
      total += 1;
      if (entry.parsed.todo) todo += 1;
    }
    return { total, todo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caretCard, ws.editor, docVersion]);

  /** A change that landed from somewhere else and touched this scene. */
  const caretPending = useMemo(() => {
    if (caretOrdinal === null || !ws.changedScenes.has(caretOrdinal)) return null;
    const entry = ws.ledger.find((e) => e.status === "pending");
    if (!entry) return null;
    return { when: ago(entry.ts) };
  }, [caretOrdinal, ws.changedScenes, ws.ledger]);

  /** The open script's scenes, for the rail's rows (docs/app/organizing/workspace-model.md#WORK-5). Derived from the
      same cards and page map the board reads, so the two cannot disagree. */
  const binderScenes = useMemo(
    () =>
      [...ws.cards]
        .sort((a, b) => a.anchor.ordinal - b.anchor.ordinal)
        .map((c) => {
          const pages = ws.scenePages.scenes.find((sc) => sc.ordinal === c.anchor.ordinal);
          return {
            id: c.id,
            ordinal: c.anchor.ordinal,
            label: c.heading || `Scene ${c.anchor.ordinal + 1}`,
            color: c.card.color,
            pages: pages
              ? pages.firstPage === pages.lastPage
                ? `${pages.firstPage}`
                : `${pages.firstPage}–${pages.lastPage}`
              : null,
          };
        }),
    [ws.cards, ws.scenePages],
  );

  /** The material the focused pane holds, if it holds one — the Sheet tab. */
  const focusedMaterial = useMemo(() => {
    const leaf = panes.focusedLeaf ? findLeaf(paneTree, panes.focusedLeaf) : null;
    const surface = leaf?.tabs[leaf.active];
    if (surface?.kind !== "material") return null;
    return ws.openMaterials[surface.id] ?? null;
  }, [paneTree, panes.focusedLeaf, ws.openMaterials]);

  /**
   * Whether the writer was last working in the outliner's notes or its rows.
   * Only focus INSIDE the outliner counts: the document menu, its trigger (which
   * gets focus back before the menu's action runs) and any sheet all take focus
   * on the way to Versions…, and reading the focused element then always said
   * "the script" to someone writing in the notes.
   */
  const inOutlineNotesRef = useRef(false);
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest(".outline-surface")) {
        inOutlineNotesRef.current = !!el.closest(".outline-notes");
      }
    };
    document.addEventListener("focusin", onFocus);
    return () => document.removeEventListener("focusin", onFocus);
  }, []);

  /** Versions of what is in front: a sheet, the outline notes being written in, or the script. */
  const openHistory = useCallback(() => {
    const leaf = panes.focusedLeaf ? findLeaf(paneTree, panes.focusedLeaf) : null;
    const surface = leaf?.tabs[leaf.active];
    if (surface?.kind === "material") {
      setShowHistoryFor({ id: surface.id });
      return;
    }
    if (surface?.kind === "outliner" && inOutlineNotesRef.current) {
      setShowHistoryFor({ id: ws.outlineNoteId ?? "outline" });
      return;
    }
    setShowHistoryFor({ id: null });
  }, [paneTree, panes.focusedLeaf, ws.outlineNoteId]);
  /**
   * The sheet's or notes' Versions, made once per opening: new functions on
   * every render re-ran the panel's loading, which moved its selection back to
   * the newest version and dismissed a Restore being confirmed.
   */
  const historyTarget = useMemo(
    () => (showHistory?.id ? ws.versionsOf(showHistory.id) : null),
    [showHistory, ws.versionsOf],
  );

  /** What the script says about the character whose sheet is showing. */
  const sheetDerived = useMemo(() => {
    if (focusedMaterial?.item.type !== "character") return null;
    const name = titleOf(focusedMaterial.item).toUpperCase();
    const weight = ws.castWeights.get(name);
    if (!weight) return null;
    const scenes = ws.castAppearances().get(name) ?? [];
    return {
      lines: weight.lines,
      scenes: weight.scenes,
      appearances: scenes.length
        ? `Appears in ${scenes.map((sc) => sc.label).join(" · ")}`
        : "Not cued in the script yet",
    };
  }, [focusedMaterial, ws]);

  /* The workspace's own errors and notices become toasts, so there is ONE
     transient surface in the app rather than two stacked buttons in a corner.
     Dismissing here as soon as it is shown keeps the workspace's flag from
     re-raising the same toast on the next render. A refused save comes with its
     own code and a detail to read, so it stays up twice as long: the workspace
     says it once, not at every retry. */
  const { error: wsError, notice: wsNotice, dismissError, dismissNotice } = ws;
  useEffect(() => {
    if (!wsError) return;
    toast(
      typeof wsError === "string"
        ? { kind: "error", title: wsError, code: workspaceErrorCode(wsError) }
        : { kind: "error", ...wsError, ms: 12000 },
    );
    dismissError();
  }, [wsError, toast, dismissError]);
  useEffect(() => {
    if (!wsNotice) return;
    toast({ kind: "ok", title: wsNotice });
    dismissNotice();
  }, [wsNotice, toast, dismissNotice]);


  /* The chrome comes back on a pointer move and goes again two seconds after it
     stops. Not on hover: a writer whose pointer is parked over the toolbar has
     not asked for it, and a bar that flickers with every stray twitch is worse
     than one that stays. */
  useEffect(() => {
    if (!focusMode) {
      setPeeking(false);
      return;
    }
    let timer = 0;
    const onMove = () => {
      setPeeking(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPeeking(false), 2000);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.clearTimeout(timer);
    };
  }, [focusMode]);

  /* Collapsed chrome is inert. Height zero and opacity
     zero hide it from the eye, not from the keyboard: ⌃⇥ and Tab used to land
     on invisible controls. Inert takes them out of focus and out of the
     accessibility tree until the chrome comes back — on a peek, only the two
     bars the peek reveals. Focus already in the chrome moves to the page. */
  useEffect(() => {
    const chrome = [
      ...document.querySelectorAll<HTMLElement>(
        ".app-shell > .toolbar, .app-shell > .statusbar, .app-shell .binder, .app-shell .inspector, .app-shell .pane__tabs, .app-shell .elementbar",
      ),
    ];
    for (const el of chrome) {
      const peeks = el.matches(".toolbar, .statusbar");
      el.inert = focusMode && !(peeking && peeks);
    }
    if (focusMode && chrome.some((el) => el.inert && el.contains(document.activeElement))) {
      document.querySelector<HTMLElement>(".pane.is-focused .ProseMirror, .ProseMirror")?.focus();
    }
    return () => {
      for (const el of chrome) el.inert = false;
    };
  }, [focusMode, peeking, binderVisible]);

  /* Esc is the way out of focus mode; ⌃⌘F is the way in and out. Separate from
     the keymap above because it must fire without a modifier, and only then. */
  useEffect(() => {
    if (!focusMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode]);

  const guide = useTutorial(ws, {
    welcomeReady: !privacyNoticeDue,
    show: panes.show, view: switcherView,
    revealBinder: () => {setBinderOpenState(true);setNarrowRail("binder");},
    openExport: () => setShowExport({sidesFor:null}),
    closeDialogs: () => {setShowExport(null);setShowTitlePage(false);setShowHistoryFor(null);},
    // Asked one place at a time, not as one selector list: a list answers with its
    // first match in the page, and the toolbar's Help & Tutorials comes before any
    // pane, so Stop Tutorial handed that button the keyboard instead of the script.
    writing: () => playLanding() ?? document.querySelector<HTMLElement>(".vault-screen__title") ?? document.querySelector<HTMLElement>(".welcome button"),
    material: focusedMaterial,
  });
  const practiceChrome = useRef<{binder: boolean; focus: boolean} | null>(null);
  useEffect(() => {
    if(ws.practicing && !practiceChrome.current) {practiceChrome.current = {binder:binderOpen,focus:focusMode};setFocusMode(false);}
    else if(!ws.practicing && practiceChrome.current) {setBinderOpenState(practiceChrome.current.binder);setFocusMode(practiceChrome.current.focus);practiceChrome.current=null;}
  }, [ws.practicing]);
  useShellCommands(ws, { panes, binderVisible, inspectorVisible, setBinderOpen, setInspectorOpen, toggleComments, splitFocused, zoomBy, zoomReset, zoomCtl, openTitlePage, openHistory, toast, caretOrdinalRef, showShortcutsRef, toggleCommentsRef, setShowShortcuts, setFocusMode, setShowExport, setShowGoToScene });

  return (
    <>
    <div
      className={`app-shell${focusMode ? " is-focus" : ""}${
        focusMode && peeking ? " is-peeking" : ""
      }`}
      aria-busy={launching || undefined}
    >
      <Toolbar
        title={focusedTitle || "Proscenium"}
        scriptOpen={ws.mode === "workspace" && !!ws.scriptTitle}
        binderOpen={binderVisible}
        onToggleBinder={() => setBinderOpen(!binderVisible)}
        inspectorOpen={inspectorVisible}
        onToggleInspector={() => setInspectorOpen(!inspectorVisible)}
        view={switcherView}
        onSetView={(v) => panes.show(VIEW_TO_SURFACE[v])}
        addable={toolbarAddable}
        onAddSurface={(sf) => panes.open(sf)}
        pendingChanges={pendingChanges}
        hasTrackedChanges={ws.hasTrackedChanges}
        showTracked={ws.showTracked}
        onSetShowTracked={ws.setShowTracked}
        onSplit={splitFocused}
        document={
          ws.mode === "workspace" && ws.scriptTitle
            ? {
                onAllPlays: ws.backToVault,
                onReveal: ws.canReveal ? () => void vault.reveal() : undefined,
                formats: ws.formats,
                activeFormatId: ws.format.id,
                onSetFormat: ws.setFormat,
                language: ws.playLanguage,
                onSaveLanguage: (value) => ws.savePlayLanguage(value, ws.openScriptKey),
                paginated: ws.paginated,
                onSetPaginated: ws.setPaginated,
                spellcheck: prefs.spellcheck,
                onSetSpellcheck: (on) => updateSettings({ spellcheck: on }),
                onEditTitlePage: openTitlePage,
                onShowHistory: () => openHistory(),
                onExport: () => setShowExport({ sidesFor: null }),
                onExportAs: (type) => setShowExport({ sidesFor: null, type }),
                onPrint: () => setShowExport({ sidesFor: null, action: "print" }),
                exporting: ws.exporting,
                onSettings: () => openSettings(),
                onEditFormats: () => openFormatDesigner({ kind: "edit", formatId: ws.format.id }),
              }
            : null
        }
      />

      {/* Ambient, never modal (docs/app/keeping-work/storage-and-file-format.md#STOR-109). "Another version" rather than "conflict":
          nothing went wrong, the file simply changed somewhere else, and both
          sides are kept either way (docs/app/keeping-work/storage-and-file-format.md#STOR-D1, docs/app/keeping-work/storage-and-file-format.md#STOR-D9). */}
      {ws.gate && (
        <section className="banner-area" aria-label="Another version of this script">
          <div className="banner banner--conflict" role="alert">
            <span className="banner__text">
              This script changed somewhere else. Your writing is safe — both
              versions are kept.
            </span>
            <BannerActions
              label="Which version to keep"
              actions={[
                { text: "Keep this one", onClick: ws.keepMine },
                { text: "Use the other", onClick: ws.loadTheirs, primary: true },
              ]}
            />
          </div>
        </section>
      )}

      {/* Words from before the app stopped (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). Ambient like the
          banner above (docs/app/keeping-work/storage-and-file-format.md#STOR-109): the writer can keep writing and answer later, and
          nothing is applied until they choose. */}
      {ws.recoveryOffer && ws.mode === "workspace" && (
        <section className="banner-area" aria-label="Changes from before Proscenium closed">
          <div className="banner banner--conflict banner--recovery" role="alert">
            <span className="banner__text">
              Proscenium closed before these changes were saved.
            </span>
            <BannerActions
              label="What to do with these changes"
              actions={[
                { text: "Discard", onClick: ws.discardOffer },
                { text: "Review…", onClick: () => setShowRecovery(true), primary: true },
              ]}
            />
          </div>
        </section>
      )}

      <div className="workspace-body">
        {/* No edge strip when the binder is closed: the toolbar's sidebar
            button is the one way in and out, which is where a Mac user looks
            for it (docs/app/organizing/workspace-model.md#WORK-D1). */}
        {ws.root && ws.mode === "workspace" && binderVisible && (
          <Binder
            binder={ws.binder}
            activeId={ws.activeId}
            playTitle={ws.playTitle}
            readOnly={ws.readOnly}
            justCreated={ws.justCreated}
            onConsumeCreated={ws.consumeCreated}
            onSelect={onSelectBinderItem}
            onOpenInNewPane={(item) => {
              ws.selectItem(item);
              panes.openBeside(
                item.type === "script"
                  ? { kind: "script" }
                  : { kind: "material", id: item.id },
                "row",
              );
            }}
            onReorder={ws.reorder}
            onMove={ws.moveTo}
            onRename={ws.renameTo}
            onDelete={(id) => {
              /* No dialog: the file goes to the OS Trash, which is
                 recoverable, so Finder's rule applies — a recoverable
                 action is not confirmed. The undo is real, not a pointer
                 at the Finder: the bytes were read before the trash. */
              void ws.remove(id).then((res) => {
                if (!res) return;
                toast({
                  kind: "trash",
                  title: `“${res.title}” moved to the Trash`,
                  detail: "It's in the Finder's Trash if you need it later.",
                  action: res.undo
                    ? { label: "Undo", run: () => void res.undo?.() }
                    : undefined,
                });
              });
            }}
            onDuplicate={ws.duplicate}
            onReveal={ws.canReveal ? ws.revealItem : undefined}
            onNewFolder={ws.createFolder}
            onNewMaterial={ws.createMaterial}
            onNewScript={ws.createScript}
            onImport={(parentId) => void beginImport([], ws.playTitle, parentId)}
            onImportFiles={(files, parentId) => void beginImport(files.map((file) => ({ file })), ws.playTitle, parentId)}
            onOpenCast={ws.scriptTitle ? () => ws.setView("cast") : undefined}
            castActive={visibleSurfaces.some((s) => s.kind === "cast")}
            newlyFiled={ws.newlyFiled}
            missingIds={missingIds}
            onAcknowledgeFiled={ws.acknowledgeFiled}
            scenes={binderScenes}
            caretScene={caretOrdinal}
            onOpenScene={ws.openScene}
          />
        )}
        {ws.mode === "workspace" && ws.root ? (
          /* The one `main` landmark: VoiceOver's rotor jumps binder →
             panes → inspector, and with a play open the panes were a div,
             so the rotor listed a navigation and a complementary and no
             place to write. */
          <main ref={paneRootRef} className="paneroot" aria-label="Play">
            <PaneTree
              node={paneTree}
              activeLeafId={panes.focusedLeaf}
              onFocusLeaf={panes.setFocusedLeaf}
              onActivateTab={onActivateTab}
              onCloseTab={onCloseTab}
              onResize={panes.resize}
              onAddSurface={panes.openInLeaf}
              onDropTab={panes.dropTab}
              onDropBinderItem={onDropBinderItem}
              labelFor={labelFor}
              addable={addableFor}
              renderSurface={renderSurface}
            />
          </main>
        ) : (
          <main ref={mainRef} className="editor-frame">
            {!launching && ws.root && ws.mode === "picker" && (
              <VaultScreen
                tutorialInvitation={<TutorialInvitation guide={guide} />}
                vaultRoot={ws.vaultRoot ?? ws.root}
                wherePlaysLive={ws.wherePlaysLive}
                plays={ws.plays}
                hint={ws.playsFolderHint}
                lookingBelow={ws.lookingBelow}
                onUseFolder={ws.openFolderBelow}
                onKeepFolder={ws.keepPlaysFolder}
                onOpen={ws.enterPlay}
                onCreate={ws.createPlay}
                onUpdate={ws.updatePlay}
                onImport={files => { void beginImport(files?.map(file => ({ file }))); }}
              />
            )}
            {!launching && !ws.root && (
              <WelcomeScreen
                cloudRoot={ws.cloudRoot}
                lastVault={lastVault}
                onChooseCloud={ws.openCloudFolder}
                onChooseFolder={ws.openFolder}
                onReopenLast={ws.openFolder}
                privacyNotice={privacyNoticeDue}
                onPrivacyNoticeSeen={() => updateSettings({ privacyNoticeSeen: true })}
                onPrivacySettings={() => openSettings("privacy")}
              />
            )}
          </main>
        )}
        {inspectorVisible && (
          <Inspector
            tab={inspectorTab}
            onSetTab={setInspectorTab}
            sheetMode={focusedMaterial !== null}
            onPopOut={popOutInspector}
          >
            {inspectorTab === "scene" &&
              (focusedMaterial ? (
                <SheetInspector
                  key={focusedMaterial.item.id}
                  item={focusedMaterial.item}
                  content={focusedMaterial.content}
                  locked={!!ws.materialGates[focusedMaterial.item.id]}
                  onSetField={(key, value) =>
                    void ws.setMaterialField(focusedMaterial.item.id, key, value)
                  }
                  onEditTags={(edit) => void ws.editMaterialTags(focusedMaterial.item.id, edit)}
                  derived={sheetDerived}
                  onOpenCast={() => panes.open({ kind: "cast" })}
                  onExportSides={
                    sheetDerived
                      ? () => setShowExport({ sidesFor: titleOf(focusedMaterial.item) })
                      : undefined
                  }
                />
              ) : (
                <SceneInspector
                  key={caretCard?.id ?? "no-scene"}
                  scene={caretCard}
                  scenePages={ws.scenePages}
                  onSetCard={ws.setCard}
                  onEditSynopsis={ws.editSynopsis}
                  speakers={caretSpeakers}
                  commentCount={caretComments.total}
                  todoCount={caretComments.todo}
                  onShowComments={() => setInspectorTab("comments")}
                  pendingChange={caretPending}
                  onReviewChange={() => panes.open({ kind: "changes" })}
                />
              ))}
            {inspectorTab === "comments" &&
              (commentsPaned ? (
                <PoppedOut
                  what="The comment list"
                  onBringBack={() => panes.closeSurface({ kind: "comments" })}
                />
              ) : (
                <div className="inspector__surface">
                  <CommentsFeed editor={ws.editor} onJump={ws.openComment} />
                </div>
              ))}
          </Inspector>
        )}
      </div>

      {/*
        The editor is mounted EXACTLY ONCE, here, and its DOM node is moved into
        whichever pane currently shows the Script (the layout effect above).
        Rendering it inside the recursive pane tree instead would remount
        ProseMirror every time the tree reshaped — losing the selection, the
        undo history and the scroll position on every split. React keeps owning
        this subtree; only the parent element changes, which ProseMirror does
        not care about.
      */}
      <div className="editorpark" ref={editorParkRef} aria-hidden={!scriptVisible}>
        <div className="editormount" ref={editorHostRef}>
          <PlayEditor
            tutorialActive={ws.practicing}
            editable={ws.editable}
            cast={ws.cast}
            onReady={ws.onEditorReady}
            onChange={ws.onEditorChange}
            onSaveShortcut={ws.onSaveShortcut}
            format={ws.format}
                language={ws.playLanguage}
            paginated={ws.paginated}
            layoutMeta={ws.layoutMeta}
            frontMatter={ws.frontMatter}
            onEditTitlePage={openTitlePage}
            trackedMarks={ws.showTracked ? ws.trackedMarks : undefined}
            zoom={zoom}
            commentsOpen={commentsOpen}
            onToggleComments={toggleComments}
            spellcheck={prefs.spellcheck}
            learnedWords={prefs.learnedWords}
            onLearnWord={learnWord}
            cards={ws.cards}
            scenePages={ws.scenePages}
            onJumpToScene={ws.openScene}
            showRunningTime={prefs.runningTimeStrip}
          />
        </div>
      </div>

      <StatusBar
        root={ws.root}
        status={ws.status}
        savedTime={savedTime}
        formatWarnings={ws.formatWarnings}
        conflictCopies={ws.conflictCopies}
        preserved={ws.preserved}
      >
        {/* Zoom lives here, not in the document menu: it is a view transform,
            not a property of the script, and buried three clicks deep it read
            as missing entirely. */}
        {ws.mode === "workspace" && ws.scriptTitle && (
          <ZoomControl
            mode={zoomCtl.mode}
            label={zoomCtl.label}
            onDelta={zoomBy}
            onSetMode={zoomCtl.setMode}
            onReset={zoomReset}
          />
        )}
      </StatusBar>

      {importQueue[0] && <ImportPanel key={importQueue[0].id} request={importQueue[0]}
        destination={ws.vaultRoot ?? "Plays"} onCreate={ws.createPlayFrom}
        onAdd={(as, title, content, kept) => ws.addImport(as, title, content, kept, importQueue[0]?.parentId ?? null)}
        onClose={() => { importQueue[0]?.finish?.(); setImportQueue(q => q.slice(1)); }} />}
      <AppDialogs
        ws={ws}
        showTitlePage={showTitlePage}
        setShowTitlePage={setShowTitlePage}
        showExport={showExport}
        setShowExport={setShowExport}
        showShortcuts={showShortcuts}
        setShowShortcuts={setShowShortcuts}
        showGoToScene={showGoToScene}
        setShowGoToScene={setShowGoToScene}
        settingsSheet={settingsSheet}
        designer={designer}
        finderOpens={finderOpens}
        quitGate={quitGate}
        showRecovery={showRecovery}
        setShowRecovery={setShowRecovery}
        showHistory={showHistory}
        setShowHistoryFor={setShowHistoryFor}
        historyTarget={historyTarget}
      />
      {launching && <LaunchScreen play={opening} />}
    </div>
      <Catalogue guide={guide} practicing={ws.practicing} />
      <CueCard guide={guide} editor={ws.editor} />
    </>
  );
}

/**
 * A tab the writer popped out. The rail says where it went and offers the way
 * back, rather than rendering a second copy of a surface that is already open.
 */
function PoppedOut({ what, onBringBack }: { what: string; onBringBack: () => void }) {
  return (
    <div className="emptysurface">
      <p className="emptysurface__title">{what} is open in a pane</p>
      <p className="emptysurface__body">
        It kept everything — this rail is just not where it lives right now.
      </p>
      <Button size="small" onClick={onBringBack}>
        Bring It Back Here
      </Button>
    </div>
  );
}
