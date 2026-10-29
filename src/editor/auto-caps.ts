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
import { Plugin } from "@tiptap/pm/state";

const CAPS_TYPES = new Set(["character", "act", "scene", "transition"]);

/** The plugin by itself: it needs a document and no editor, so tests run it bare. */
export function autoCapsPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const tr = newState.tr;
      let modified = false;

      newState.doc.descendants((node, pos) => {
        if (!node.isTextblock || !CAPS_TYPES.has(node.type.name)) return;
        if (node.type.name === "character" && node.attrs.forced) return;
        node.descendants((child, offset) => {
          if (child.type.name === "note") return false; // never enter a note
          if (child.isText && child.text) {
            const up = child.text.toUpperCase();
            if (up !== child.text) {
              // Marks preserved. A letter can upper-case to two (ß → SS), and
              // everything after it has then moved: each run is found through
              // what this transaction has already done. Taken as standing
              // still, the next heading in the script was replaced one place
              // off, across its own end, and came out a stage direction
              // (docs/app/writing/editor-ux.md#EDIT-178).
              const from = tr.mapping.map(pos + 1 + offset);
              tr.replaceWith(from, from + child.text.length, newState.schema.text(up, child.marks));
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
});
