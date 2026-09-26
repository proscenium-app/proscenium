// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The correction menu — what a right-click on an underlined word opens, and
 * what ⌘; opens on the next one.
 *
 * Reads the spell plugin's state directly rather than mirroring it into React
 * state of its own: the plugin already owns which word is under the menu and
 * where, and a second copy is a second thing to get out of step.
 *
 * Three actions, in the order a writer wants them: take a suggestion, keep the
 * word forever, or keep it for now. "Add to Dictionary" is the durable one and
 * says so by sitting apart from the session-only "Ignore".
 *
 * It is the app's one Menu (docs/app/preferences-and-help/accessibility.md#A11Y-18). It was a bespoke popup of buttons
 * with no arrow keys and no focus of its own — the menu a mouse could use and
 * nothing else could — and it is now the anatomy every other menu has.
 */
import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Menu, type MenuAnchor, type MenuEntry } from "../ui";
import { spellState, wordAt, type SpellMenuState } from "./spellcheck";

const GAP = 4;

/** Whether the word under the menu has left the spot it opened over. */
function wordMoved(editor: Editor, menu: SpellMenuState): boolean {
  try {
    const now = wordAt(editor.view, menu.from);
    return Math.abs(now.left - menu.wordAt.left) >= 1 || Math.abs(now.top - menu.wordAt.top) >= 1;
  } catch {
    return true; // a position the page no longer draws
  }
}

export interface SpellMenuProps {
  editor: Editor;
  /** Teach the word permanently — persisted outside the vault by the caller. */
  onLearn: (word: string) => void;
  /** Let it stand for this session only. */
  onIgnore: (word: string) => void;
}

export function SpellMenu({ editor, onLearn, onIgnore }: SpellMenuProps) {
  const [menu, setMenu] = useState<SpellMenuState | null>(null);

  // Same subscription shape as FindBar and ElementBar: the plugin is the truth,
  // and every transaction is a chance for it to have changed.
  useEffect(() => {
    const update = () => setMenu(spellState(editor)?.menu ?? null);
    editor.on("transaction", update);
    update();
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  // A menu anchored to a point on the page is wrong the moment the page moves,
  // so a scroll that moves the word dismisses it rather than dragging it along.
  // Only one that MOVES it: a scroll event is delivered with the frame after
  // the scroll, and a busy machine can hold that frame until after the menu is
  // up. A scroll from just before ⌘; then shut the menu as it opened, over a
  // word that had not moved.
  // The menu's own list scrolling, and any other scroller, moves no word either.
  useEffect(() => {
    if (!menu) return;
    const onScroll = () => {
      if (!wordMoved(editor, menu)) return;
      editor.commands.closeSpellMenu();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [menu, editor]);

  const anchor = useMemo<MenuAnchor | null>(
    () => (menu ? { kind: "point", x: menu.x, y: menu.y + GAP } : null),
    [menu],
  );

  if (!menu || !anchor) return null;

  const close = () => {
    editor.commands.closeSpellMenu();
    editor.commands.focus();
  };

  const entries: MenuEntry[] = [
    ...(menu.suggestions.length === 0
      ? [{ kind: "hint" as const, label: "No suggestions" }]
      : menu.suggestions.map((word) => ({
          label: <span className="menu__script">{word}</span>,
          text: word,
          onSelect: () => {
            editor.commands.acceptSpelling(menu.from, menu.to, word);
            editor.commands.focus();
          },
        }))),
    { kind: "sep" },
    { label: "Learn Spelling", onSelect: () => onLearn(menu.word) },
    { label: "Ignore Spelling", onSelect: () => onIgnore(menu.word) },
  ];

  return (
    <Menu
      anchor={anchor}
      entries={entries}
      onClose={close}
      width={160}
      label={`Spelling of “${menu.word}”`}
    />
  );
}
