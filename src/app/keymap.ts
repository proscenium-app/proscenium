// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The keyboard, in one table (docs/app/preferences-and-help/settings.md#SET-11).
 *
 * ⌘/ opens an overlay of every shortcut, and the overlay is GENERATED from this
 * list — so it cannot describe a key the app does not bind, which is the failure
 * mode of every hand-written shortcut sheet. The window-level bindings are read
 * from the same list by `App`; the editor's own keymap (element-entry.ts,
 * leader-key.ts) is declared where ProseMirror needs it and mirrored here as
 * documentation, marked `owner: "editor"`.
 *
 * The mirrored entries carry the binding string they stand for, and a test
 * fails if the editor stops binding one — a shortcut sheet that drifts is worse
 * than no sheet at all.
 */
import { LEADER_MENU } from "../editor/leader-key";

export type ShortcutGroup =
  | "Elements"
  | "Emphasis"
  | "Navigation"
  | "Views and panels"
  | "The script"
  | "The play";

export interface Shortcut {
  /** Display form, in macOS glyphs. */
  keys: string;
  what: string;
  group: ShortcutGroup;
  /** "app" is bound in App's window listener; "editor" by a TipTap extension. */
  owner: "app" | "editor";
  /** The editor keymap string this mirrors, for the drift test. */
  binding?: string;
}

export const SHORTCUTS: Shortcut[] = [
  // Elements — the nine the element bar teaches on hold-⌘, plus the breaks.
  { keys: "⌘⌥1", what: "Act", group: "Elements", owner: "editor", binding: "Mod-Alt-1" },
  { keys: "⌘⌥2", what: "Scene", group: "Elements", owner: "editor", binding: "Mod-Alt-2" },
  { keys: "⌘⌥S", what: "Scene Heading", group: "Elements", owner: "editor", binding: "Mod-Alt-s" },
  { keys: "⌘⌥A", what: "Action", group: "Elements", owner: "editor", binding: "Mod-Alt-a" },
  { keys: "⌘⌥C", what: "Character", group: "Elements", owner: "editor", binding: "Mod-Alt-c" },
  { keys: "⌘⌥D", what: "Dialogue", group: "Elements", owner: "editor", binding: "Mod-Alt-d" },
  { keys: "⌘⌥P", what: "Parenthetical", group: "Elements", owner: "editor", binding: "Mod-Alt-p" },
  { keys: "⌘⌥T", what: "Transition", group: "Elements", owner: "editor", binding: "Mod-Alt-t" },
  { keys: "⌘⌥L", what: "Lyric", group: "Elements", owner: "editor", binding: "Mod-Alt-l" },
  { keys: "⇥", what: "Change this line’s element", group: "Elements", owner: "editor" },
  { keys: ";", what: "Element menu, on an empty line", group: "Elements", owner: "editor" },
  { keys: "⏎", what: "New line, with the likely next element", group: "Elements", owner: "editor" },
  { keys: "⏎⏎", what: "Element menu for the new line", group: "Elements", owner: "editor" },
  { keys: "⇧⏎", what: "Line Break, same element", group: "Elements", owner: "editor" },
  { keys: "⌘⏎", what: "Page Break", group: "Elements", owner: "editor", binding: "Mod-Enter" },

  { keys: "⌘B", what: "Bold", group: "Emphasis", owner: "editor", binding: "Mod-b" },
  { keys: "⌘I", what: "Italic", group: "Emphasis", owner: "editor", binding: "Mod-i" },
  { keys: "⌘U", what: "Underline", group: "Emphasis", owner: "editor", binding: "Mod-u" },

  { keys: "⌘F", what: "Find", group: "Navigation", owner: "app" },
  { keys: "⌘⌥F", what: "Find and Replace", group: "Navigation", owner: "app" },
  { keys: "⌥⌘↑", what: "Previous Scene", group: "Navigation", owner: "app" },
  { keys: "⌥⌘↓", what: "Next Scene", group: "Navigation", owner: "app" },
  { keys: "⌘⇧J", what: "Go to Scene…", group: "Navigation", owner: "app" },
  {
    keys: "⌃⇥ / ⌃⇧⇥",
    what: "Next or previous area: toolbar, binder, script, inspector, status bar (a notice’s Undo comes first)",
    group: "Navigation",
    owner: "app",
  },
  { keys: "⌘+ / ⌘−", what: "Zoom In and Zoom Out", group: "Navigation", owner: "app" },
  { keys: "⌘0", what: "Actual Size", group: "Navigation", owner: "app" },

  { keys: "⌘1", what: "Script", group: "Views and panels", owner: "app" },
  { keys: "⌘2", what: "Board", group: "Views and panels", owner: "app" },
  { keys: "⌘3", what: "Outline", group: "Views and panels", owner: "app" },
  { keys: "⌘4", what: "Cast", group: "Views and panels", owner: "app" },
  { keys: "⌘5", what: "Changes", group: "Views and panels", owner: "app" },
  { keys: "⌘⌥B", what: "Show or hide the binder", group: "Views and panels", owner: "app" },
  { keys: "⌘⌥I", what: "Show or hide the inspector", group: "Views and panels", owner: "app" },
  { keys: "⌘⇧C", what: "Comments", group: "Views and panels", owner: "app" },
  // StatusList binds the same keys in a status's name (Settings › General and Writing).
  {
    keys: "⌃⌘↑ / ⌃⌘↓",
    what: "Move the binder item, or a status in Settings, up or down",
    group: "Views and panels",
    owner: "app",
  },
  {
    keys: "⌃⌘← / ⌃⌘→",
    what: "Move the binder item out of its folder, or into the folder above",
    group: "Views and panels",
    owner: "app",
  },
  {
    keys: "⇧F10",
    what: "Actions for the selected binder item",
    group: "Views and panels",
    owner: "app",
  },
  // ⌘⇧K listed "The writing room" here after the room itself was removed
  // (docs/app/product.md#PROD-26): nothing binds it.
  {
    keys: "⌃⌘F",
    what: "Focus, which shows only the page",
    group: "Views and panels",
    owner: "app",
  },

  {
    keys: "⌘S",
    what: "Save (Proscenium also saves as you write)",
    group: "The script",
    owner: "editor",
  },
  { keys: "⌘⌥M", what: "Comment on the selection", group: "The script", owner: "editor" },
  {
    keys: "⌘;",
    what: "Next Misspelling, with suggestions",
    group: "The script",
    owner: "editor",
    binding: "Mod-;",
  },
  { keys: "⌘Z / ⌘⇧Z", what: "Undo and Redo", group: "The script", owner: "editor" },

  { keys: "⌘⇧E", what: "Export PDF…", group: "The play", owner: "app" },
  { keys: "⌘P", what: "Print…", group: "The play", owner: "app" },
  { keys: "⌘⇧O", what: "All Plays", group: "The play", owner: "app" },
  { keys: "⌘,", what: "Settings", group: "The play", owner: "app" },
  { keys: "⌘/", what: "Keyboard Shortcuts", group: "The play", owner: "app" },
];

export const GROUPS: ShortcutGroup[] = [
  "Elements",
  "Emphasis",
  "Navigation",
  "Views and panels",
  "The script",
  "The play",
];

/** The leader menu's own alphabet, shown beside the elements. */
export const LEADER_ROWS = LEADER_MENU;
