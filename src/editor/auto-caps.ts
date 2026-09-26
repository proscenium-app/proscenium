// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Auto-caps (docs/app/writing/editor-ux.md#EDIT-D111): character cues and act/scene/
 * transition headings uppercase as you type. Implemented as an
 * `appendTransaction` plugin so the uppercasing joins the SAME undo step as the
 * keystroke (⌘Z reverts both at once).
 *
 * Two guards from the design critique:
 *  - a `@`-forced character keeps its mixed case (`forced` attr).
 *  - the uppercasing is STRUCTURAL: it skips `note` subtrees, so an inline
 *    `[[ note ]]` inside a cue is never capitalized (critique M7).
 */
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

const CAPS_TYPES = new Set(["character", "act", "scene", "transition"]);

export const AutoCaps = Extension.create({
  name: "autoCaps",

  addProseMirrorPlugins() {
    return [
      new Plugin({
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
                  const from = pos + 1 + offset;
                  // Same length → positions don't shift; marks preserved.
                  tr.replaceWith(
                    from,
                    from + child.text.length,
                    newState.schema.text(up, child.marks),
                  );
                  modified = true;
                }
              }
              return true;
            });
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});
