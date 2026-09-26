// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Undo/redo for the play (Q13, docs/app/writing/editor-ux.md#EDIT-D118) — ProseMirror's
 * history, plus the one thing TipTap's own `UndoRedo` cannot do: **forget**.
 *
 * The editor instance deliberately outlives a script switch, so the document is
 * swapped into it with `setContent` rather than by remounting. That swap is a
 * transaction, and a transaction goes into the undo stack — so a freshly opened
 * play arrived with two undoable events already on it and ⌘Z, pressed before the
 * writer had typed anything, reverted the load and replaced the play with the
 * empty document the editor was created with. Autosave then wrote that empty
 * document to the `.fountain`.
 *
 * docs/app/writing/editor-ux.md#EDIT-D100 already specifies the correct behavior — "it resets on
 * reload/reopen … you cannot undo *across* a reload" — so the fix is to make
 * that true: `resetHistory` drops the stack, and the load itself is dispatched
 * with `addToHistory: false` (see useWorkspace's `loadDocIntoEditor`) so it is
 * never a step in the first place. Both matter: the meta keeps ⌘Z from undoing
 * the load, the reset keeps a *previous* script's steps from being replayed
 * against the document that replaced it.
 *
 * Undo/redo behavior and keymap are otherwise identical to `@tiptap/extensions`
 * UndoRedo, which this replaces.
 */
import { Extension } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import type { Plugin } from "@tiptap/pm/state";

export interface PlayHistoryOptions {
  /** Events kept before the oldest are discarded. */
  depth: number;
  /** Idle gap (ms) after which a new undo group starts. */
  newGroupDelay: number;
}

export const PlayHistory = Extension.create<PlayHistoryOptions, { plugin: Plugin | null }>({
  name: "playHistory",

  addOptions() {
    return { depth: 100, newGroupDelay: 500 };
  },

  addStorage() {
    return { plugin: null };
  },

  addProseMirrorPlugins() {
    // Held so `resetHistory` can reconfigure exactly this plugin rather than
    // guessing at prosemirror-history's private key.
    const plugin = history({
      depth: this.options.depth,
      newGroupDelay: this.options.newGroupDelay,
    });
    this.storage.plugin = plugin;
    return [plugin];
  },

  addCommands() {
    return {
      undo:
        () =>
        ({ state, dispatch }) =>
          undo(state, dispatch),
      redo:
        () =>
        ({ state, dispatch }) =>
          redo(state, dispatch),
      /**
       * Empty the undo/redo stack, leaving the document alone.
       *
       * prosemirror-history has no "clear", so drop the plugin and put it back:
       * `reconfigure` keeps the state of every plugin present in both
       * configurations and initializes the ones that are new, so the history
       * starts empty and pagination, autocomplete and the leader menu keep
       * theirs. Not a transaction, so it cannot itself become an undo step.
       */
      resetHistory:
        () =>
        ({ editor, dispatch }) => {
          const plugin = this.storage.plugin;
          if (!plugin) return false;
          if (!dispatch) return true;
          const { view } = editor;
          const plugins = view.state.plugins;
          if (!plugins.includes(plugin)) return false;
          view.updateState(
            view.state.reconfigure({ plugins: plugins.filter((p) => p !== plugin) }),
          );
          view.updateState(view.state.reconfigure({ plugins }));
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-z": () => this.editor.commands.undo(),
      "Shift-Mod-z": () => this.editor.commands.redo(),
      "Mod-y": () => this.editor.commands.redo(),
      // Russian keyboard layouts (parity with TipTap's UndoRedo).
      "Mod-я": () => this.editor.commands.undo(),
      "Shift-Mod-я": () => this.editor.commands.redo(),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    playHistory: {
      /** Undo recent changes. */
      undo: () => ReturnType;
      /** Reapply reverted changes. */
      redo: () => ReturnType;
      /** Forget the undo/redo stack (a load/reload starts a fresh one). */
      resetHistory: () => ReturnType;
    };
  }
}
