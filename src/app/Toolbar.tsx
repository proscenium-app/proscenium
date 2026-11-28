// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The window toolbar (docs/engineering/design-system.md#UI-D101).
 *
 * Ten controls became six. The wordmark, the Format button, the save
 * pill, "Open Folder…" and the focused-pane title span all
 * left: their homes are now the document menu, the status bar and the
 * inspector. "‹ Plays" left too, and came back as "‹ All Plays": in the
 * menus alone a writer could not find the way out of a play
 * (docs/app/organizing/workspace-model.md#WORK-90). What is left is a
 * three-column grid — the way back and identity on the left, the
 * view switcher in the centre, the two rails and the tracked-changes switch on
 * the right — which is macOS's own toolbar shape.
 *
 * The title is a PULL-DOWN, not a label. Everything per-play hangs off it, so
 * the thing you are working on is also the way you act on it; the title still
 * follows the focused pane, because with a sheet open beside the script "what
 * am I looking at" has to mean the pane you are in.
 *
 * **The switcher SWITCHES, and the "+" beside it adds**. It used
 * to call `panes.open`, so every click stacked another tab and the tab strip
 * appeared on its own the first time you looked at the board — two controls
 * doing one job, so the chrome said everything twice. Now a segment replaces what the
 * focused pane shows and the "+" is the only way to a second tab, so the strip
 * below (which renders only at two or more) means "you asked for this".
 */
import { useRef, useState } from "react";
import { LanguageSheet } from "./LanguageSheet";
import { VersionSheet } from "./VersionSheet";
import type { VersionPrint } from "../layout/furniture";
import { openSettings } from "./settings";
import { useSettings } from "../ui/settings-store";
import { openFeedback } from "../feedback";
import { openHelp } from "../tutorial/events";
import type { FormatSpec } from "../format";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Button,
  DocIcon,
  EllipsisIcon,
  IconButton,
  Menu,
  PlusIcon,
  Segmented,
  SidebarLeftIcon,
  SidebarRightIcon,
  SplitIcon,
  Switch,
  useMenu,
  type MenuEntry,
  type SegmentedOption,
} from "../ui";
import type { Surface } from "./panes";
import type { RedlineSteps } from "./use-redline-steps";
import { keyStyle, keys } from "../ui/keys";
import { dragRegion, menuBar } from "../ui/system-traits";
import { systemWords } from "../ui/system-words";
import { COARSE, useMedia, useToolbarFold } from "../ui/use-media";

export type ViewId = "script" | "corkboard" | "outliner" | "cast" | "changes";

// A function, not a constant: its keys are written as this system writes them,
// which the page learns at boot (ui/keys.ts).
const viewsWithKeys = (): SegmentedOption<ViewId>[] => [
  { id: "script", label: "Script", title: `Show the script in the focused pane (${keys("⌘1")})` },
  { id: "corkboard", label: "Board", title: `Show the board in the focused pane (${keys("⌘2")})` },
  {
    id: "outliner",
    label: "Outline",
    title: `Show the outline in the focused pane (${keys("⌘3")})`,
  },
  // The company (docs/app/formatting/formats-and-layout.md#FMT-170).
  {
    id: "cast",
    label: "Cast",
    title: `Show who speaks, where, and which page of the play names them, in the focused pane (${keys("⌘4")})`,
  },
  {
    id: "changes",
    label: "Changes",
    title: `Show your changes and what arrived from outside (${keys("⌘5")})`,
  },
];

export interface DocumentMenuActions {
  onAllPlays: () => void;
  onReveal?: () => void;
  /** Save As…: what the copy is for (docs/app/organizing/workspace-model.md#WORK-95). */
  onSaveAs?: () => void;
  /** Save Draft…: the script as it is now, kept (docs/app/keeping-work/storage-and-file-format.md#STOR-203). */
  onSaveDraft?: () => void;
  /** Rename Play… (docs/app/keeping-work/storage-and-file-format.md#STOR-208). */
  onRenamePlay?: () => void;
  /** The whole play as one .zip (docs/app/keeping-work/storage-and-file-format.md#STOR-199). */
  onExportPlay?: () => void;
  formats: FormatSpec[];
  activeFormatId: string;
  onSetFormat: (id: string) => void;
  language: string;
  onSaveLanguage: (value: string) => Promise<boolean>;
  paginated: boolean;
  onSetPaginated: (on: boolean) => void;
  spellcheck: boolean;
  onSetSpellcheck: (on: boolean) => void;
  /** Add Page…: the pages a script can have before and after it (docs/app/formatting/formats-and-layout.md#FMT-175). */
  onAddFrontPage: () => void;
  /** Capitalize Character Names in Directions… (docs/app/writing/editor-ux.md#EDIT-208). */
  onCapitalizeNames: () => void;
  /** Play Version… (docs/app/formatting/formats-and-layout.md#FMT-185): what the sheet opens on. */
  version: { text: string; print: VersionPrint; titleLacksLine: boolean };
  onSaveVersion: (
    text: string,
    print: VersionPrint | undefined,
    titleLine: boolean,
  ) => Promise<boolean>;
  onShowHistory: () => void;
  onExport: () => void;
  /** The same dialog, on a word processor's file (docs/app/formatting/formats-and-layout.md#FMT-145). */
  onExportAs: (type: "docx" | "odt") => void;
  /** The script and its pages as one .fountain (docs/app/formatting/formats-and-layout.md#FMT-171). */
  onExportFountain: () => void;
  /** The same dialog, with printing as its default: what prints is what exports. */
  onPrint: () => void;
  exporting: boolean;
  onSettings: () => void;
  /** The format designer, on the format this play uses. */
  onEditFormats: () => void;
  /**
   * Runs a menu bar item's id (menu-actions.ts). Where no menu bar carries
   * the Play and View menus (an iPad), this menu does, and a finger reaches
   * find, the scenes and focus from it.
   */
  onCommand?: (id: string) => void;
  /** Focus is on, for its row's check. */
  focusMode?: boolean;
}

/**
 * The commands a menu bar's Play and View menus carry, for a window with no
 * menu bar, where their chords were the only way in and a finger had none
 * (an iPad). The names are the menu bar's (src-tauri/src/menu.rs), and each
 * row sends the same id its item does.
 */
function playCommands(a: DocumentMenuActions): MenuEntry[] {
  const run = a.onCommand;
  if (menuBar() || !run) return [];
  return [
    { kind: "sep" },
    { label: "Find…", shortcut: "⌘F", onSelect: () => run("find") },
    { label: "Find and Replace…", shortcut: "⌘⌥F", onSelect: () => run("find-replace") },
    { label: "Go to Scene…", shortcut: "⌘⇧J", onSelect: () => run("goto-scene") },
    { label: "Previous Scene", shortcut: "⌥⌘↑", onSelect: () => run("scene-prev") },
    { label: "Next Scene", shortcut: "⌥⌘↓", onSelect: () => run("scene-next") },
    {
      label: "Next Misspelling",
      shortcut: "⌘;",
      disabled: !a.spellcheck,
      onSelect: () => run("spelling-next"),
    },
    { label: "Focus", shortcut: "⌃⌘F", checked: !!a.focusMode, onSelect: () => run("focus") },
  ];
}

/** docs/engineering/design-system.md#UI-D107's document menu, in its documented order. */
export function documentMenuEntries(
  a: DocumentMenuActions,
  onLanguage?: () => void,
  onVersion?: () => void,
): MenuEntry[] {
  return [
    { label: "All Plays", shortcut: "⌘⇧O", onSelect: a.onAllPlays },
    {
      label: `Reveal in ${systemWords().fileManager}`,
      disabled: !a.onReveal,
      onSelect: a.onReveal,
    },
    {
      id: "save-as",
      label: "Save As…",
      // A PC's Ctrl+Shift+S is Scene Heading's (src/ui/keys.ts), so Save As has no chord there.
      shortcut: keyStyle() === "pc" ? undefined : "⌘⇧S",
      disabled: !a.onSaveAs,
      onSelect: a.onSaveAs,
    },
    { id: "save-draft", label: "Save Draft…", disabled: !a.onSaveDraft, onSelect: a.onSaveDraft },
    {
      id: "rename-play",
      label: "Rename Play…",
      disabled: !a.onRenamePlay,
      onSelect: a.onRenamePlay,
    },
    ...playCommands(a),
    { kind: "sep" },
    { kind: "section", label: "Script format" },
    ...a.formats.slice(0, 3).map((f) => ({
      id: `format:${f.id}`,
      label: f.name,
      checked: f.id === a.activeFormatId,
      onSelect: () => a.onSetFormat(f.id),
    })),
    {
      label: "All Formats",
      submenu: [
        ...a.formats.map((f) => ({
          label: f.name,
          checked: f.id === a.activeFormatId,
          onSelect: () => a.onSetFormat(f.id),
        })),
        { kind: "sep" },
        { label: "Manage Formats…", onSelect: () => openSettings("formats") },
      ],
    },
    { label: "Edit Current Format…", onSelect: a.onEditFormats },
    { label: "Play Language…", onSelect: onLanguage },
    { kind: "sep" },
    {
      label: "Page View",
      checked: a.paginated,
      onSelect: () => a.onSetPaginated(!a.paginated),
    },
    {
      // The same words as the switch in Settings › Writing: one setting, one name.
      label: "Check Spelling as You Type",
      checked: a.spellcheck,
      onSelect: () => a.onSetSpellcheck(!a.spellcheck),
    },
    { kind: "sep" },
    { id: "add-front-page", label: "Add Page…", onSelect: a.onAddFrontPage },
    { id: "play-version", label: "Play Version…", onSelect: onVersion },
    {
      id: "cast-names",
      label: "Capitalize Character Names in Directions…",
      onSelect: a.onCapitalizeNames,
    },
    { label: "Versions…", onSelect: a.onShowHistory },
    { kind: "sep" },
    { label: "Settings…", shortcut: "⌘,", onSelect: a.onSettings },
    {
      id: "export-pdf",
      label: a.exporting ? "Exporting…" : "Export PDF…",
      shortcut: "⌘⇧E",
      disabled: a.exporting,
      onSelect: a.onExport,
    },
    {
      id: "export-docx",
      label: "Export .docx…",
      disabled: a.exporting,
      onSelect: () => a.onExportAs("docx"),
    },
    {
      id: "export-odt",
      label: "Export .odt…",
      disabled: a.exporting,
      onSelect: () => a.onExportAs("odt"),
    },
    {
      id: "export-fountain",
      label: "Export Fountain…",
      disabled: a.exporting,
      onSelect: a.onExportFountain,
    },
    {
      id: "export-play",
      label: "Export Play…",
      disabled: a.exporting || !a.onExportPlay,
      onSelect: a.onExportPlay,
    },
    { label: "Print…", shortcut: "⌘P", disabled: a.exporting, onSelect: a.onPrint },
  ];
}

export function Toolbar({
  title,
  binderOpen,
  onToggleBinder,
  inspectorOpen,
  onToggleInspector,
  view,
  onSetView,
  addable,
  onAddSurface,
  pendingChanges,
  hasTrackedChanges,
  showTracked,
  onSetShowTracked,
  trackedSteps,
  onSplit,
  document: doc,
  scriptOpen,
}: {
  title: string;
  binderOpen: boolean;
  onToggleBinder: () => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  /** Null when the focused pane shows something outside the switcher's set. */
  view: ViewId | null;
  onSetView: (v: ViewId) => void;
  /** Surfaces the focused pane does not already hold — the "+" menu's offer. */
  addable: { surface: Surface; label: string }[];
  onAddSurface: (surface: Surface) => void;
  pendingChanges: number;
  hasTrackedChanges: boolean;
  showTracked: boolean;
  onSetShowTracked: (on: boolean) => void;
  /** Previous and Next through the changes drawn on the script. */
  trackedSteps: RedlineSteps;
  onSplit: (dir: "row" | "col") => void;
  document: DocumentMenuActions | null;
  scriptOpen: boolean;
}) {
  const titleRef = useRef<HTMLButtonElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();
  const { formatOrder } = useSettings();
  const orderedDoc = doc && {
    ...doc,
    formats: [...doc.formats].sort((a, b) => {
      const rank = (id: string) => {
        const i = formatOrder.indexOf(id);
        return i < 0 ? formatOrder.length : i;
      };
      return rank(a.id) - rank(b.id);
    }),
  };
  const [languageOpen, setLanguageOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const addMenu = useMenu();
  const viewMenu = useMenu();
  const viewRef = useRef<HTMLButtonElement | null>(null);
  const moreMenu = useMenu();
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const splitMenu = useMenu();
  const splitRef = useRef<HTMLButtonElement | null>(null);
  // How much of the bar folds into More and the view pop-up (ui/use-media.ts),
  // and whether a finger is the pointer, which has no ⌥ to click with.
  const fold = useToolbarFold();
  const finger = useMedia(COARSE);

  const views = viewsWithKeys().map((v) =>
    v.id === "changes" && pendingChanges > 0 ? { ...v, badge: pendingChanges } : v,
  );
  const shown = views.find((v) => v.id === view);

  /** Split Side by Side and Split Top and Bottom, as the View menu names them. */
  const splits: MenuEntry[] = [
    { label: "Split Side by Side", onSelect: () => onSplit("row") },
    { label: "Split Top and Bottom", onSelect: () => onSplit("col") },
  ];
  /* What folds into More (ui/use-media.ts): on a finger below 1000 points the
     words Help, Feedback and Settings and the changes switch, and below 700
     the split and the inspector as well. Each is the same command its button
     runs where there is room for it. */
  const more: MenuEntry[] = [];
  if (fold !== "wide") {
    if (scriptOpen && hasTrackedChanges) {
      more.push({
        label: "Changes in Text",
        checked: showTracked,
        onSelect: () => onSetShowTracked(!showTracked),
      });
      if (showTracked && trackedSteps.count > 0)
        more.push(
          {
            label: "Previous Change",
            disabled: trackedSteps.index <= 0,
            onSelect: () => trackedSteps.go(-1),
          },
          {
            label: "Next Change",
            disabled: trackedSteps.index >= trackedSteps.count - 1,
            onSelect: () => trackedSteps.go(1),
          },
        );
      more.push({ kind: "sep" });
    }
    if (fold === "compact" && scriptOpen)
      more.push(
        {
          label: inspectorOpen ? "Hide the Inspector" : "Show the Inspector",
          shortcut: "⌘⌥I",
          onSelect: onToggleInspector,
        },
        ...splits,
        { kind: "sep" },
      );
    more.push(
      { label: "Help & Tutorials", onSelect: openHelp },
      { label: "Feedback…", onSelect: () => openFeedback() },
    );
    if (!doc && !menuBar())
      more.push({ label: "Settings…", shortcut: "⌘,", onSelect: () => openSettings() });
  }

  return (
    /* "deep": the bar's empty space anywhere drags the window, controls stay
       controls. A bare attribute only drags from the header's own pixels in
       Tauri 2 — and without `core:window:allow-start-dragging` it dragged
       from nowhere, so the window could not be moved at all. */
    <header
      className={`toolbar${fold === "wide" ? "" : ` toolbar--${fold}`}`}
      {...dragRegion(true)}
    >
      <div className="toolbar__left">
        {scriptOpen && (
          <IconButton
            label={binderOpen ? "Hide the binder" : "Show the binder"}
            title={`${binderOpen ? "Hide" : "Show"} the binder (${keys("⌘⌥B")})`}
            on={binderOpen}
            neutral
            onClick={onToggleBinder}
          >
            <SidebarLeftIcon size={17} />
          </IconButton>
        )}
        {/* The way back to every play, where a writer looks for it
            (docs/app/organizing/workspace-model.md#WORK-90): before the
            title, as a Mac window's back button sits before its title. On a
            folded bar (a finger's, or one too narrow for the words) the
            chevron alone keeps the name, and the title the room. */}
        {doc &&
          (fold !== "wide" ? (
            <IconButton
              label="All Plays"
              title={`All Plays (${keys("⌘⇧O")})`}
              className="toolbar__plays"
              neutral
              onClick={doc.onAllPlays}
            >
              <ChevronLeftIcon size={13} />
            </IconButton>
          ) : (
            <Button
              size="small"
              treatment="borderless"
              className="toolbar__plays"
              title={`Show all your plays (${keys("⌘⇧O")})`}
              onClick={doc.onAllPlays}
            >
              <ChevronLeftIcon size={11} />
              All Plays
            </Button>
          ))}
        {doc && (
          <>
            <button
              ref={titleRef}
              type="button"
              className="doctitle"
              data-tutorial="document-menu"
              aria-haspopup="menu"
              aria-expanded={menu.open}
              onClick={() => menu.openFrom(titleRef.current)}
            >
              <span className="doctitle__icon">
                <DocIcon size={14} />
              </span>
              <span className="doctitle__label">{title}</span>
              <ChevronDownIcon size={9} />
            </button>
            {menu.anchor && (
              <Menu
                anchor={menu.anchor}
                entries={documentMenuEntries(
                  orderedDoc!,
                  () => setLanguageOpen(true),
                  () => setVersionOpen(true),
                )}
                onClose={menu.close}
                width={248}
                label="Document"
              />
            )}
          </>
        )}
      </div>

      <div className="toolbar__centre">
        {languageOpen && doc && (
          <LanguageSheet
            language={doc.language}
            onSave={doc.onSaveLanguage}
            onClose={() => setLanguageOpen(false)}
          />
        )}
        {versionOpen && doc && (
          <VersionSheet
            version={doc.version.text}
            print={doc.version.print}
            titleLacksLine={doc.version.titleLacksLine}
            onSave={doc.onSaveVersion}
            onClose={() => setVersionOpen(false)}
          />
        )}
        {scriptOpen && fold === "compact" && (
          /* Too narrow for five segments: the view this pane shows, as a
             pull-down holding the five and the surfaces "+" would add. */
          <div className="viewswitch" data-tutorial="views">
            <Button
              ref={viewRef}
              size="small"
              className="viewswitch__pull"
              aria-haspopup="menu"
              aria-expanded={viewMenu.open}
              aria-label={`What this pane shows: ${shown?.label ?? "something else"}`}
              onClick={() => viewMenu.openFrom(viewRef.current)}
            >
              {shown?.label ?? "Views"}
              <ChevronDownIcon size={9} />
            </Button>
            {viewMenu.anchor && (
              <Menu
                anchor={viewMenu.anchor}
                onClose={viewMenu.close}
                width={220}
                label="What this pane shows"
                entries={[
                  ...views.map((v) => ({
                    label: v.badge ? `${v.label} (${v.badge})` : String(v.label),
                    checked: v.id === view,
                    radio: true,
                    shortcut: `⌘${["script", "corkboard", "outliner", "cast", "changes"].indexOf(v.id) + 1}`,
                    onSelect: () => onSetView(v.id),
                  })),
                  ...(addable.length
                    ? ([
                        { kind: "sep" },
                        { kind: "section", label: "Open in this pane, as a tab" },
                        ...addable.map((o) => ({
                          label: o.label,
                          onSelect: () => onAddSurface(o.surface),
                        })),
                      ] as MenuEntry[])
                    : []),
                ]}
              />
            )}
          </div>
        )}
        {scriptOpen && fold !== "compact" && (
          <div className="viewswitch" data-tutorial="views">
            <Segmented
              options={views}
              value={view}
              onChange={onSetView}
              label="What this pane shows"
            />
            {/* The add gesture, said out loud. A menu rather than a cycle: the
                writer picks what the second tab is, and sees the set. */}
            <IconButton
              ref={addRef}
              label="Open another surface in this pane"
              title="Open another surface in this pane — it opens beside this one, as a tab"
              size="small"
              on={addMenu.open}
              neutral
              disabled={addable.length === 0}
              onClick={() => addMenu.openFrom(addRef.current)}
            >
              <PlusIcon size={13} />
            </IconButton>
            {addMenu.anchor && addable.length > 0 && (
              <Menu
                anchor={addMenu.anchor}
                onClose={addMenu.close}
                width={200}
                label="Open in this pane"
                entries={[
                  { kind: "section", label: "Open in this pane" },
                  ...addable.map((o) => ({
                    label: o.label,
                    onSelect: () => onAddSurface(o.surface),
                  })),
                ]}
              />
            )}
          </div>
        )}
      </div>

      <div className="toolbar__right">
        {fold === "wide" && (
          <>
            <Button size="small" treatment="borderless" data-tutorial="help" onClick={openHelp}>
              Help & Tutorials
            </Button>
            <Button size="small" treatment="borderless" onClick={() => openFeedback()}>
              Feedback
            </Button>
          </>
        )}
        {/* Settings is the menu bar's, the play's document menu's, and ⌘,
            everywhere. With no menu bar to carry it (an iPad) and no play's
            menu here (the Plays screen, Welcome), this is the way to it a
            finger has. */}
        {fold === "wide" && !doc && !menuBar() && (
          <Button size="small" treatment="borderless" onClick={() => openSettings()}>
            Settings
          </Button>
        )}
        {/* The newest changes from outside, drawn on the script. Only
            offered when there is something new to show — a dead toggle
            teaches nothing — and, while it is on, the way from one change to
            the next. */}
        {fold === "wide" && scriptOpen && hasTrackedChanges && (
          <span className="trackedswitch">
            <label className="trackedswitch__toggle">
              <span className="trackedswitch__label">Changes in text</span>
              <Switch
                mini
                on={showTracked}
                onChange={onSetShowTracked}
                label="Changes in text — show what arrived from outside, marked in the script"
              />
            </label>
            {showTracked && trackedSteps.count > 0 && (
              <>
                <IconButton
                  label="Previous change"
                  size="small"
                  neutral
                  disabled={trackedSteps.index <= 0}
                  onClick={() => trackedSteps.go(-1)}
                >
                  <ChevronLeftIcon size={10} />
                </IconButton>
                <span className="trackedswitch__count">
                  {trackedSteps.index < 0
                    ? `${trackedSteps.count} ${trackedSteps.count === 1 ? "change" : "changes"}`
                    : `${trackedSteps.index + 1} of ${trackedSteps.count}`}
                </span>
                <IconButton
                  label="Next change"
                  size="small"
                  neutral
                  disabled={trackedSteps.index >= trackedSteps.count - 1}
                  onClick={() => trackedSteps.go(1)}
                >
                  <ChevronRightIcon size={10} />
                </IconButton>
              </>
            )}
          </span>
        )}
        {scriptOpen && fold !== "compact" && (
          <>
            {/* A pointer splits side by side, and ⌥-clicks for top and
                bottom. A finger has no ⌥, so the button asks which. */}
            {finger ? (
              <>
                <IconButton
                  ref={splitRef}
                  label="Split the focused pane"
                  aria-haspopup="menu"
                  aria-expanded={splitMenu.open}
                  onClick={() => splitMenu.openFrom(splitRef.current, "end")}
                >
                  <SplitIcon size={16} />
                </IconButton>
                {splitMenu.anchor && (
                  <Menu
                    anchor={splitMenu.anchor}
                    onClose={splitMenu.close}
                    width={220}
                    label="Split the focused pane"
                    entries={splits}
                  />
                )}
              </>
            ) : (
              <IconButton
                label="Split side by side"
                title={`Split the focused pane side by side (${keys("⌥")}-click for top and bottom)`}
                onClick={(e) => onSplit(e.altKey ? "col" : "row")}
              >
                <SplitIcon size={16} />
              </IconButton>
            )}
            <IconButton
              label={inspectorOpen ? "Hide the inspector" : "Show the inspector"}
              title={`${inspectorOpen ? "Hide" : "Show"} the inspector (${keys("⌘⌥I")})`}
              on={inspectorOpen}
              neutral
              onClick={onToggleInspector}
            >
              <SidebarRightIcon size={17} />
            </IconButton>
          </>
        )}
        {more.length > 0 && (
          <>
            <IconButton
              ref={moreRef}
              label="More"
              aria-haspopup="menu"
              aria-expanded={moreMenu.open}
              data-tutorial="help"
              onClick={() => moreMenu.openFrom(moreRef.current, "end")}
            >
              <EllipsisIcon size={16} />
            </IconButton>
            {moreMenu.anchor && (
              <Menu
                anchor={moreMenu.anchor}
                onClose={moreMenu.close}
                width={232}
                label="More"
                entries={more}
              />
            )}
          </>
        )}
      </div>
    </header>
  );
}
