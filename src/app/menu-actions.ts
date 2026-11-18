// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a menu-bar item means (docs/engineering/design-system.md#UI-D107).
 *
 * The Rust side declares the menus and forwards an id; this is the only place
 * that says what an id does — the same boundary as the rest of the app, where
 * Rust stores bytes and TypeScript assigns meaning.
 *
 * It matters more than tidiness here. macOS consumes an accelerator the menu
 * bar owns BEFORE the webview sees it, so ⌘B, ⌘S and ⌘1 stop reaching the
 * editor's keymap the moment the menu bar exists. Every accelerator in menu.rs
 * therefore has a handler here that does the same thing the keymap would have
 * done — the menu bar is not decoration over the shortcuts, it IS them on the
 * desktop, and `keymap.ts` stays the single description of both.
 */
import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { isTauri } from "@tauri-apps/api/core";
import { insertLineBreak, insertPageBreak, toggleEmphasis } from "../editor/breaks";
import { listen } from "../storage/ipc";
import { formatOnce, formatterWithFocus, markFormat } from "../ui/format-input";
import { anyLayerOpen } from "../ui/layers";
import { updateIsInstalling } from "./update-lock";

const EVENT_MENU_ACTION = "menu://action";

export interface MenuHandlers {
  editor: Editor | null;
  run: (id: string) => void;
  /** An item that may still act while a menu or sheet is up — ⌘/ closing its own overlay. */
  allowWhileLayer?: (id: string) => boolean;
}

/**
 * Element ids are `el-<nodeName>`, marks are `mark-<markName>` — mechanical, so
 * a new element added to the Script menu needs no code here at all.
 */
function handleEditorAction(editor: Editor | null, id: string): boolean {
  if (!editor) return false;
  if (id.startsWith("el-")) {
    const name = id.slice(3);
    editor.chain().focus().setNode(name).run();
    return true;
  }
  if (id.startsWith("mark-")) {
    const mark = id.slice(5);
    const format = markFormat(mark);
    // The editor with the focus formats its own words, a document's as a
    // document does; with none, the script. A press that reached it as its
    // own key or the system's format too runs once (src/ui/format-input.ts).
    const focused = format ? formatterWithFocus() : null;
    if (format && focused) {
      if (formatOnce(focused.editor, format, "menu")) focused.formats[format]?.(focused.editor);
      return true;
    }
    if (!format || formatOnce(editor, format, "menu")) {
      editor.commands.focus();
      toggleEmphasis(editor, mark);
    }
    return true;
  }
  if (id === "line-break") {
    editor.commands.focus();
    insertLineBreak(editor);
    return true;
  }
  if (id === "spelling-next") {
    editor.commands.focus();
    editor.commands.openNextSpelling();
    return true;
  }
  if (id === "page-break") {
    editor.commands.focus();
    insertPageBreak(editor);
    return true;
  }
  if (id === "comment") {
    editor.chain().focus().addComment().run();
    return true;
  }
  return false;
}

/**
 * Runs a menu item's id as the menu bar's item does: the script's own
 * commands first, then the window's. A menu in the page that carries the
 * menu bar's commands where there is no menu bar (an iPad's document menu)
 * sends its ids here, so each runs the one command the Mac's item runs.
 */
export function runMenuItem(editor: Editor | null, run: (id: string) => void, id: string): void {
  if (updateIsInstalling()) return;
  if (handleEditorAction(editor, id)) return;
  run(id);
}

export function useMenuActions({ editor, run, allowWhileLayer }: MenuHandlers): void {
  // Listened for once, for the window's life, with the handlers read when an item
  // arrives. Listening again whenever the editor changed left a gap one IPC round
  // trip wide, and a menu item in it reached nothing: ⌘⇧O pressed as a play opened.
  const latest = useRef({ editor, run, allowWhileLayer });
  latest.current = { editor, run, allowWhileLayer };
  useEffect(() => {
    let dead = false;
    let stop: (() => void) | undefined;
    const handle = (id: string) => {
      const { editor, run, allowWhileLayer } = latest.current;
      /* A menu or sheet is up: a menu-bar item waits for it, exactly as its
         key does at the window (docs/app/preferences-and-help/accessibility.md#A11Y-3). macOS hands the accelerator to
         the menu bar before the webview, so this is the route ⌘1 and ⌘B take
         in the app — and ⌘B used to pull focus out of a sheet's field into
         the script behind it. */
      if (updateIsInstalling()) return;
      if (anyLayerOpen() && !allowWhileLayer?.(id)) return;
      if (handleEditorAction(editor, id)) return;
      run(id);
    };
    if (!isTauri()) {
      if (!(window as unknown as Record<string, unknown>).__PROSCENIUM_FIXTURE__) return;
      const fixtureMenu = (event: Event) => handle((event as CustomEvent<string>).detail);
      window.addEventListener("proscenium:fixture-menu", fixtureMenu);
      return () => window.removeEventListener("proscenium:fixture-menu", fixtureMenu);
    }
    void listen<string>(EVENT_MENU_ACTION, (e) => handle(e.payload)).then((un) => {
      if (dead) un();
      else stop = un;
    });
    return () => {
      dead = true;
      stop?.();
    };
  }, []);
}
