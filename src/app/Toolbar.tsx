// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The window toolbar (docs/engineering/design-system.md#UI-D101).
 *
 * Ten controls became six. The wordmark, "‹ Plays", the Format button, the save
 * pill, "Open Folder…" and the focused-pane title span all
 * left: their homes are now the document menu, the status bar and the
 * inspector. What is left is a three-column grid — identity on the left, the
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
import { openSettings } from "./settings";
import { useSettings } from "./settings/store";
import { openFeedback } from "../feedback";
import { openHelp } from "../tutorial/events";
import type { FormatSpec } from "../format";
import {
  ChevronDownIcon,
  Button,
  DocIcon,
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

export type ViewId = "script" | "corkboard" | "outliner" | "cast" | "changes";

const VIEWS: SegmentedOption<ViewId>[] = [
  { id: "script", label: "Script", title: "Show the script in the focused pane (⌘1)" },
  { id: "corkboard", label: "Board", title: "Show the board in the focused pane (⌘2)" },
  { id: "outliner", label: "Outline", title: "Show the outline in the focused pane (⌘3)" },
  { id: "cast", label: "Cast", title: "Show the cast in the focused pane (⌘4)" },
  { id: "changes", label: "Changes", title: "Show what arrived from outside (⌘5)" },
];

export interface DocumentMenuActions {
  onAllPlays: () => void;
  onReveal?: () => void;
  formats: FormatSpec[];
  activeFormatId: string;
  onSetFormat: (id: string) => void;
  language: string;
  onSaveLanguage: (value: string) => Promise<boolean>;
  paginated: boolean;
  onSetPaginated: (on: boolean) => void;
  spellcheck: boolean;
  onSetSpellcheck: (on: boolean) => void;
  onEditTitlePage: () => void;
  onShowHistory: () => void;
  onExport: () => void;
  /** The same dialog, on a word processor's file (docs/app/formatting/formats-and-layout.md#FMT-145). */
  onExportAs: (type: "docx" | "odt") => void;
  /** The same dialog, with printing as its default: what prints is what exports. */
  onPrint: () => void;
  exporting: boolean;
  onSettings: () => void;
  /** The format designer, on the format this play uses. */
  onEditFormats: () => void;
}

/** docs/engineering/design-system.md#UI-D107's document menu, in its documented order. */
export function documentMenuEntries(a: DocumentMenuActions, onLanguage?: () => void): MenuEntry[] {
  return [
    { label: "All Plays", shortcut: "⌘⇧O", onSelect: a.onAllPlays },
    { label: "Reveal in Finder", disabled: !a.onReveal, onSelect: a.onReveal },
    { kind: "sep" },
    { kind: "section", label: "Script format" },
    ...a.formats.slice(0, 3).map((f) => ({
      id: `format:${f.id}`,
      label: f.name,
      checked: f.id === a.activeFormatId,
      onSelect: () => a.onSetFormat(f.id),
    })),
    { label: "All Formats", submenu: [
      ...a.formats.map((f) => ({ label: f.name, checked: f.id === a.activeFormatId, onSelect: () => a.onSetFormat(f.id) })),
      { kind: "sep" }, { label: "Manage Formats…", onSelect: () => openSettings("formats") },
    ] },
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
    { id: "opening-pages", label: "Edit Opening Pages…", onSelect: a.onEditTitlePage },
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
    { id: "export-docx", label: "Export .docx…", disabled: a.exporting, onSelect: () => a.onExportAs("docx") },
    { id: "export-odt", label: "Export .odt…", disabled: a.exporting, onSelect: () => a.onExportAs("odt") },
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
  onSplit: (dir: "row" | "col") => void;
  document: DocumentMenuActions | null;
  scriptOpen: boolean;
}) {
  const titleRef = useRef<HTMLButtonElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu();
  const { formatOrder } = useSettings();
  const orderedDoc = doc && { ...doc, formats: [...doc.formats].sort((a, b) => {
    const rank = (id: string) => { const i = formatOrder.indexOf(id); return i < 0 ? formatOrder.length : i; };
    return rank(a.id) - rank(b.id);
  }) };
  const [languageOpen, setLanguageOpen] = useState(false);
  const addMenu = useMenu();

  const views = VIEWS.map((v) =>
    v.id === "changes" && pendingChanges > 0 ? { ...v, badge: pendingChanges } : v,
  );

  return (
    /* "deep": the bar's empty space anywhere drags the window, controls stay
       controls. A bare attribute only drags from the header's own pixels in
       Tauri 2 — and without `core:window:allow-start-dragging` it dragged
       from nowhere, so the window could not be moved at all. */
    <header className="toolbar" data-tauri-drag-region="deep">
      <div className="toolbar__left">
        {scriptOpen && (
          <IconButton
            label={binderOpen ? "Hide the binder" : "Show the binder"}
            title={`${binderOpen ? "Hide" : "Show"} the binder (⌘⌥B)`}
            on={binderOpen}
            neutral
            onClick={onToggleBinder}
          >
            <SidebarLeftIcon size={17} />
          </IconButton>
        )}
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
                entries={documentMenuEntries(orderedDoc!, () => setLanguageOpen(true))}
                onClose={menu.close}
                width={248}
                label="Document"
              />
            )}
          </>
        )}
      </div>

      <div className="toolbar__centre">
        {languageOpen && doc && <LanguageSheet language={doc.language} onSave={doc.onSaveLanguage} onClose={() => setLanguageOpen(false)} />}
        {scriptOpen && (
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
        <Button size="small" treatment="borderless" data-tutorial="help" onClick={openHelp}>Help & Tutorials</Button>
        <Button size="small" treatment="borderless" onClick={() => openFeedback()}>Feedback</Button>
        {/* Inline tracked changes. Only offered when there is something to
            show — a dead toggle teaches nothing. */}
        {scriptOpen && hasTrackedChanges && (
          <label className="trackedswitch">
            <span className="trackedswitch__label">Changes in text</span>
            <Switch
              mini
              on={showTracked}
              onChange={onSetShowTracked}
              label="Changes in text — show what arrived from outside, marked in the script"
            />
          </label>
        )}
        {scriptOpen && (
          <>
            <IconButton
              label="Split side by side"
              title="Split the focused pane side by side (⌥-click for top and bottom)"
              onClick={(e) => onSplit(e.altKey ? "col" : "row")}
            >
              <SplitIcon size={16} />
            </IconButton>
            <IconButton
              label={inspectorOpen ? "Hide the inspector" : "Show the inspector"}
              title={`${inspectorOpen ? "Hide" : "Show"} the inspector (⌘⌥I)`}
              on={inspectorOpen}
              neutral
              onClick={onToggleInspector}
            >
              <SidebarRightIcon size={17} />
            </IconButton>
          </>
        )}
      </div>
    </header>
  );
}
