// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Auto-caps (docs/app/writing/editor-ux.md#EDIT-D111): character cues and act/scene/
 * transition headings uppercase as you type. Implemented as an
 * `appendTransaction` plugin so the uppercasing joins the SAME undo step as the
 * keystroke (⌘Z reverts both at once).
 *
 * Two guards from the design critique:
 *  - a `forced` character keeps its case. The plugin reads the whole document
 *    on every change, so the attribute is all that stands between a keystroke
 *    in one speech and every cue in the script. Typing `@` sets it
 *    (input-rules.ts, breaks.ts), and so does reading a cue that already holds
 *    lower case (bridge.ts, docs/app/writing/editor-ux.md#EDIT-176).
 *  - the uppercasing is STRUCTURAL: it skips `note` subtrees, so an inline
 *    `[[ note ]]` inside a cue is never capitalized (critique M7).
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const CAPS_TYPES = new Set(["character", "act", "scene", "transition"]);

/**
 * Each stretch of `text` that upper-cases to something else, as its offset
 * and its letters. Read a code point at a time, so a letter outside the basic
 * plane is never split.
 */
export function lowerStretches(text: string): [start: number, letters: string][] {
  const stretches: [number, string][] = [];
  let start = -1;
  let at = 0;
  for (const letter of text) {
    const changes = letter.toUpperCase() !== letter;
    if (changes && start < 0) start = at;
    if (!changes && start >= 0) {
      stretches.push([start, text.slice(start, at)]);
      start = -1;
    }
    at += letter.length;
  }
  if (start >= 0) stretches.push([start, text.slice(start)]);
  return stretches;
}

/**
 * On unless the writer turns it off (Settings › Writing, docs/app/writing/editor-ux.md#EDIT-54):
 * off, nothing is put in capitals as it is typed, and names in the directions
 * neither (names-in-directions.ts is told the same).
 */
export const autoCapsKey = new PluginKey<{ on: boolean }>("autoCaps");

/** The plugin by itself: it needs a document and no editor, so tests run it bare. */
export function autoCapsPlugin(on = true): Plugin {
  return new Plugin({
    key: autoCapsKey,
    state: {
      init: () => ({ on }),
      apply: (tr, prev) => {
        const next = tr.getMeta(autoCapsKey) as { on: boolean } | undefined;
        return next ? { on: next.on } : prev;
      },
    },
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (!autoCapsKey.getState(newState)?.on) return null;
      const tr = newState.tr;
      let modified = false;

      newState.doc.descendants((node, pos) => {
        if (!node.isTextblock || !CAPS_TYPES.has(node.type.name)) return;
        if (node.type.name === "character" && node.attrs.forced) return;
        node.descendants((child, offset) => {
          if (child.type.name === "note") return false; // never enter a note
          if (child.isText && child.text) {
            // Only the letters that change, each stretch of them alone: the
            // whole run replaced took the caret inside it to its end, and in a
            // heading typed into from its start, "Kept" came out as "KE",
            // the heading, then "PT" (docs/app/writing/editor-ux.md#EDIT-201).
            for (const [start, lower] of lowerStretches(child.text)) {
              // Marks preserved. A letter can upper-case to two (ß → SS), and
              // everything after it has then moved: each stretch is found
              // through what this transaction has already done. Taken as
              // standing still, the next heading in the script was replaced
              // one place off, across its own end, and came out a stage
              // direction (docs/app/writing/editor-ux.md#EDIT-178).
              const from = tr.mapping.map(pos + 1 + offset + start);
              const up = newState.schema.text(lower.toUpperCase(), child.marks);
              tr.replaceWith(from, from + lower.length, up);
              modified = true;
            }
          }
          return true;
        });
      });

      return modified ? tr : null;
    },
  });
}

export const AutoCaps = Extension.create({
  name: "autoCaps",

  addProseMirrorPlugins() {
    return [autoCapsPlugin()];
  },

  addCommands() {
    return {
      setAutoCaps:
        (on: boolean) =>
        ({ tr, state, dispatch }) => {
          // A command dispatches whether or not it changes anything: only a
          // change of the switch is a transaction.
          if (autoCapsKey.getState(state)?.on === on) return false;
          if (dispatch) tr.setMeta(autoCapsKey, { on });
          return true;
        },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    autoCaps: {
      /** Capitals as they are typed, on or off (Settings › Writing). */
      setAutoCaps: (on: boolean) => ReturnType;
    };
  }
}
