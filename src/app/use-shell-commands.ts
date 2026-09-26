// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from "react";
import { anyLayerOpen, useToast } from "../ui";
import { vault } from "../storage";
import { openFeedback } from "../feedback";
import { copyDiagnostics, formatsInUse } from "../diagnostics";
import { openSettings } from "./settings";
import { openHelp } from "../tutorial/events";
import { checkForUpdatesNow } from "./updates";
import { saveInFormatDesigner } from "./formats/open";
import { cycleRegion } from "./regions";
import { useMenuActions } from "./menu-actions";
import { useZoom, ZOOM_STEP } from "./use-zoom";
import type { usePanes } from "./use-panes";
import type { ViewId } from "./Toolbar";
import type { Surface } from "./panes";
import type { Workspace } from "./useWorkspace";
import type { ExportRequest } from "./ExportDialog";

export const VIEW_TO_SURFACE: Record<ViewId, Surface> = {
  script: { kind: "script" },
  corkboard: { kind: "corkboard" },
  outliner: { kind: "outliner" },
  cast: { kind: "cast" },
  changes: { kind: "changes" },
};

interface ShellActions {
  panes: Pick<ReturnType<typeof usePanes>, "show">;
  binderVisible: boolean;
  inspectorVisible: boolean;
  setBinderOpen: (on: boolean) => void;
  setInspectorOpen: (on: boolean) => void;
  toggleComments: () => void;
  splitFocused: (dir: "row" | "col") => void;
  zoomBy: (delta: number) => void;
  zoomReset: () => void;
  zoomCtl: Pick<ReturnType<typeof useZoom>, "setMode">;
  openTitlePage: () => void;
  openHistory: () => void;
  /** File › New Play… (⌘N): the Plays screen names a blank play. */
  askNewPlay: () => void;
  toast: ReturnType<typeof useToast>;
  caretOrdinalRef: MutableRefObject<number | null>;
  showShortcutsRef: MutableRefObject<boolean>;
  toggleCommentsRef: MutableRefObject<() => void>;
  setShowShortcuts: Dispatch<SetStateAction<boolean>>;
  setFocusMode: Dispatch<SetStateAction<boolean>>;
  setShowExport: Dispatch<SetStateAction<ExportRequest | null>>;
  setShowGoToScene: Dispatch<SetStateAction<boolean>>;
}

export function useShellCommands(
  {
    openFind,
    mode,
    scriptTitle,
    plays,
    format,
    cards,
    openScene,
    exporting,
    backToVault,
    openFolder,
    onSaveShortcut,
    editor,
  }: Pick<
    Workspace,
    | "openFind"
    | "mode"
    | "scriptTitle"
    | "plays"
    | "format"
    | "cards"
    | "openScene"
    | "exporting"
    | "backToVault"
    | "openFolder"
    | "onSaveShortcut"
    | "editor"
  >,
  {
    panes,
    binderVisible,
    inspectorVisible,
    setBinderOpen,
    setInspectorOpen,
    toggleComments,
    splitFocused,
    zoomBy,
    zoomReset,
    zoomCtl,
    openTitlePage,
    openHistory,
    askNewPlay,
    toast,
    caretOrdinalRef,
    showShortcutsRef,
    toggleCommentsRef,
    setShowShortcuts,
    setFocusMode,
    setShowExport,
    setShowGoToScene,
  }: ShellActions,
) {
  /**
   * ⌘F / ⌘⌥F open the find bar.
   *
   * At the window rather than in the editor's keymap for two reasons: the
   * webview has its own find, which would search the RENDERED DOM — page
   * headers, page numbers, the re-printed "(CONT'D)" cue, none of which are in
   * the document — and highlight things the script does not contain; and find
   * should work while the writer is reading the board or the binder, not only
   * with the caret in the script. `preventDefault` before the native find sees
   * it; `openFind` switches to the Script surface first.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "f") return;
      // ⌃⌘F is focus mode, not find — both would otherwise fire on one chord.
      if (e.metaKey && e.ctrlKey) return;
      // A menu or sheet is up: the window's keys wait for it (docs/app/preferences-and-help/accessibility.md#A11Y-3).
      if (anyLayerOpen()) return;
      if (mode !== "workspace" || !scriptTitle) return;
      e.preventDefault();
      openFind(e.altKey);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, scriptTitle, openFind]);

  /* ⌘⇧C opens and closes the comment feed. At the window for find's second
     reason: the list should be reachable from the board or the binder, not
     only with the caret in the script — and it opens a PANE, which the
     editor's keymap has no business doing. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== "c") return;
      if (anyLayerOpen()) return;
      if (mode !== "workspace" || !scriptTitle) return;
      e.preventDefault();
      toggleCommentsRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, scriptTitle]);

  /** The formats Copy Diagnostics names: every play's in the folder, and the open one's as it stands. */
  const formatsInPlay = () =>
    formatsInUse([...plays.map((p) => p.format), mode === "workspace" ? format.id : null]);

  /** Previous / next scene, from wherever the caret is. */
  const stepScene = useCallback(
    (delta: 1 | -1) => {
      const ordinals = cards.map((c) => c.anchor.ordinal).sort((a, b) => a - b);
      if (ordinals.length === 0) return;
      const here = caretOrdinalRef.current;
      const next =
        delta === 1
          ? (ordinals.find((o) => here === null || o > here) ?? ordinals[0])
          : ([...ordinals].reverse().find((o) => here !== null && o < here) ??
            ordinals[ordinals.length - 1]);
      openScene(next);
    },
    [
      openFind,
      mode,
      scriptTitle,
      plays,
      format,
      cards,
      openScene,
      exporting,
      backToVault,
      openFolder,
      onSaveShortcut,
      editor,
    ],
  );

  /*
   * The window's own keys (keymap.ts). At the window rather than in the
   * editor's keymap because every one of them acts on the SHELL — a pane, a
   * rail, a sheet — which the editor has no business doing, and because they
   * have to work while the writer is reading the board or the binder.
   */
  useEffect(() => {
    const inPlay = mode === "workspace" && !!scriptTitle;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      /* A menu or sheet is up: every window key waits for it (docs/app/preferences-and-help/accessibility.md#A11Y-3).
         ⌘1 used to switch the pane under the Export sheet, and ⌘⇧O could
         leave the play from behind a modal. The one exception is ⌘/, which
         closes the overlay it opened. */
      if (anyLayerOpen()) {
        if (key === "/" && !e.altKey && showShortcutsRef.current) {
          e.preventDefault();
          setShowShortcuts(false);
        }
        return;
      }

      // ⌃⌘F leaves focus mode too, and Esc is the escape hatch everywhere.
      if (e.ctrlKey && e.metaKey && key === "f" && inPlay) {
        e.preventDefault();
        setFocusMode((on) => !on);
        return;
      }
      if (key === "," && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        openSettings();
        return;
      }
      if (key === "/" && !e.altKey) {
        e.preventDefault();
        setShowShortcuts((on) => !on);
        return;
      }
      // ⌘N is File › New Play…. Where the menu bar exists it takes the chord
      // first and its item arrives above; this is the same thing for a window
      // without one, unless the binder, whose ⌘N adds a document, answered.
      if (
        key === "n" &&
        !e.shiftKey &&
        !e.altKey &&
        !(e.ctrlKey && e.metaKey) &&
        !e.defaultPrevented
      ) {
        e.preventDefault();
        backToVault();
        askNewPlay();
        return;
      }
      // All Plays needs a play, not a script, as the menu bar's item does: a
      // play whose script is still reading (from iCloud, or just after Stop
      // Tutorial brought the play back) or could not be read is left by its key
      // too. It used to wait for the script, and hand the key to the menu bar.
      if (e.shiftKey && key === "o" && mode === "workspace") {
        e.preventDefault();
        backToVault();
        return;
      }
      if (!inPlay) return;

      // ⌘1–5 SWITCH the focused pane, exactly as the switcher does — the
      // toolbar's "+" is what adds a tab.
      if (!e.altKey && !e.shiftKey && key >= "1" && key <= "5") {
        const order: ViewId[] = ["script", "corkboard", "outliner", "cast", "changes"];
        e.preventDefault();
        panes.show(VIEW_TO_SURFACE[order[Number(key) - 1]]);
        return;
      }
      if (e.altKey && key === "b") {
        e.preventDefault();
        setBinderOpen(!binderVisible);
        return;
      }
      if (e.altKey && key === "i") {
        e.preventDefault();
        setInspectorOpen(!inspectorVisible);
        return;
      }
      if (e.shiftKey && key === "e") {
        e.preventDefault();
        if (!exporting) setShowExport({ sidesFor: null });
        return;
      }
      // ⌘P prints, through the same dialog. Command only: in a Mac text field
      // ⌃P moves the caret up a line, and the script is a text field.
      if (e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && key === "p") {
        e.preventDefault();
        if (!exporting) setShowExport({ sidesFor: null, action: "print" });
        return;
      }
      if (e.shiftKey && key === "j") {
        e.preventDefault();
        setShowGoToScene(true);
        return;
      }
      // ⌥⌘↑ / ⌥⌘↓ — the previous and next scene, from wherever the caret is.
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        stepScene(e.key === "ArrowDown" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    openFind,
    mode,
    scriptTitle,
    plays,
    format,
    cards,
    openScene,
    exporting,
    backToVault,
    askNewPlay,
    openFolder,
    onSaveShortcut,
    editor,
    panes,
    binderVisible,
    inspectorVisible,
    setBinderOpen,
    setInspectorOpen,
    stepScene,
  ]);

  /* ⌃⇥ / ⌃⇧⇥ (and F6) move between the window's areas (regions.ts). In the
     capture phase, so the script's own Tab ring never sees a Control-Tab, and
     not while a menu or sheet is up: those keep focus by design. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrlTab = e.key === "Tab" && e.ctrlKey && !e.metaKey && !e.altKey;
      const f6 = e.key === "F6" && !e.metaKey && !e.ctrlKey && !e.altKey;
      if ((!ctrlTab && !f6) || anyLayerOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      cycleRegion(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ⌘+/⌘−/⌘0 scale the writing surface while a script is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (mode !== "workspace" || !scriptTitle) return;
      if (anyLayerOpen()) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (e.key === "-") {
        e.preventDefault();
        zoomBy(-ZOOM_STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        zoomReset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, scriptTitle, zoomBy, zoomReset]);

  /*
   * The native menu bar's items (menu-actions.ts). Every one of them is a
   * command the window keymap or a control already performs — the menu bar is
   * a second route to the same thing, never a second implementation, and macOS
   * eats an accelerator it owns before the webview sees it, so the routes have
   * to agree.
   */
  const runMenuAction = useCallback(
    (id: string) => {
      switch (id) {
        case "import-draft":
          if (!anyLayerOpen()) window.dispatchEvent(new Event("proscenium:import-draft"));
          return;
        case "settings":
          openSettings();
          return;
        case "check-updates":
          openSettings("updates");
          void checkForUpdatesNow();
          return;
        case "tutorials":
          openHelp();
          return;
        case "shortcuts":
          // ⌘/ opens the list and ⌘/ closes it, by the menu bar as by the window.
          setShowShortcuts((on) => !on);
          return;
        case "copy-diagnostics":
          void copyDiagnostics(formatsInPlay(), toast);
          return;
        case "report-problem":
          openFeedback(formatsInPlay());
          return;
        case "new-play":
          // File › New Play… from anywhere: the Plays screen, then a blank play
          // named there, as its New Play button does. It used to stop at the
          // Plays screen, so the menu's "Blank Play ⌘N" made nothing.
          backToVault();
          askNewPlay();
          return;
        case "all-plays":
          backToVault();
          return;
        case "open-vault":
          openFolder();
          return;
        case "save":
          // With the format designer up, ⌘S saves the format in front of the
          // writer, not the script behind the sheet.
          if (saveInFormatDesigner()) return;
          onSaveShortcut();
          return;
        case "reveal":
          void vault.reveal();
          return;
        case "export-pdf":
          if (!exporting) setShowExport({ sidesFor: null });
          return;
        case "export-docx":
        case "export-odt":
          if (!exporting)
            setShowExport({ sidesFor: null, type: id === "export-docx" ? "docx" : "odt" });
          return;
        case "print":
          if (!exporting) setShowExport({ sidesFor: null, action: "print" });
          return;
        case "title-page":
          openTitlePage();
          return;
        case "history":
          openHistory();
          return;
        case "view-script":
        case "view-corkboard":
        case "view-outliner":
        case "view-cast":
        case "view-changes":
          panes.show(VIEW_TO_SURFACE[id.slice(5) as ViewId]);
          return;
        case "toggle-binder":
          setBinderOpen(!binderVisible);
          return;
        case "toggle-inspector":
          setInspectorOpen(!inspectorVisible);
          return;
        case "toggle-comments":
          toggleComments();
          return;
        case "split-row":
          splitFocused("row");
          return;
        case "split-col":
          splitFocused("col");
          return;
        case "zoom-in":
          zoomBy(ZOOM_STEP);
          return;
        case "zoom-out":
          zoomBy(-ZOOM_STEP);
          return;
        case "zoom-actual":
          zoomReset();
          return;
        case "zoom-fit-width":
          zoomCtl.setMode({ kind: "fit-width" });
          return;
        case "zoom-fit-page":
          zoomCtl.setMode({ kind: "fit-page" });
          return;
        case "focus":
          setFocusMode((on) => !on);
          return;
        case "find":
          openFind(false);
          return;
        case "find-replace":
          openFind(true);
          return;
        case "goto-scene":
          setShowGoToScene(true);
          return;
        case "scene-prev":
        case "scene-next":
          stepScene(id === "scene-next" ? 1 : -1);
          return;
      }
    },
    [
      openFind,
      mode,
      scriptTitle,
      plays,
      format,
      cards,
      openScene,
      exporting,
      backToVault,
      openFolder,
      onSaveShortcut,
      editor,
      panes,
      binderVisible,
      inspectorVisible,
      setBinderOpen,
      setInspectorOpen,
      toggleComments,
      splitFocused,
      zoomBy,
      zoomReset,
      zoomCtl,
      openTitlePage,
      toast,
      stepScene,
    ],
  );
  const menuWhileLayer = useCallback(
    // Help may copy diagnostics or open its feedback sheet above Settings.
    (id: string) =>
      (id === "shortcuts" && showShortcutsRef.current) ||
      id === "copy-diagnostics" ||
      id === "report-problem",
    [],
  );
  useMenuActions({ editor: editor, run: runMenuAction, allowWhileLayer: menuWhileLayer });
}
