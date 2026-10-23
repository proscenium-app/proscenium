// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a read-only editor needs to draw a redline (redline-doc.ts): the two
 * marks for added and cut words, the attribute that says what happened to a
 * whole element, and the rule drawn where unchanged elements were left out.
 *
 * None of it is in the play's schema (schema.ts), and the live editor never
 * loads it: a redline is for reading, and nothing drawn with these can be
 * typed into a script or saved to one.
 */
import { Extension, Mark } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { REDLINE_ADD, REDLINE_DEL, type RedlineSkip } from "./redline-doc";

/** Added words: `<ins>`, which says so to a screen reader as well as to the eye. */
export const RedlineAdd = Mark.create({
  name: REDLINE_ADD,
  parseHTML() {
    return [{ tag: "ins" }];
  },
  renderHTML() {
    return ["ins", { class: "redline-add" }, 0];
  },
});

/** Cut words: `<del>`. */
export const RedlineDel = Mark.create({
  name: REDLINE_DEL,
  parseHTML() {
    return [{ tag: "del" }];
  },
  renderHTML() {
    return ["del", { class: "redline-del" }, 0];
  },
});

const BLOCKS = [
  "action",
  "act",
  "scene",
  "sceneHeading",
  "character",
  "parenthetical",
  "dialogue",
  "transition",
  "lyric",
  "centered",
  "synopsis",
  "pageBreak",
  "boneyard",
];

const skipsKey = new PluginKey("prosceniumRedlineSkips");

function skipRule(skip: RedlineSkip): HTMLElement {
  const rule = document.createElement("div");
  rule.className = "redline-skip";
  rule.setAttribute("contenteditable", "false");
  rule.setAttribute("role", "separator");
  const lines = `${skip.count} unchanged ${skip.count === 1 ? "element" : "elements"} not shown`;
  rule.setAttribute("aria-label", skip.label ? `${lines}. ${skip.label}` : lines);
  const dots = document.createElement("span");
  dots.className = "redline-skip__dots";
  dots.setAttribute("aria-hidden", "true");
  dots.textContent = "⋯";
  rule.appendChild(dots);
  if (skip.label) {
    const where = document.createElement("span");
    where.className = "redline-skip__where";
    where.setAttribute("aria-hidden", "true");
    // textContent, never innerHTML: a heading is the writer's words, or someone else's.
    where.textContent = skip.label;
    rule.appendChild(where);
  }
  return rule;
}

export const Redline = Extension.create({
  name: "prosceniumRedline",

  addGlobalAttributes() {
    return [
      {
        types: BLOCKS,
        attributes: {
          redline: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute("data-redline"),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.redline ? { "data-redline": attrs.redline } : {},
          },
          // Read by the plugin below, never drawn on the element.
          redlineSkipBefore: { default: null, rendered: false },
          redlineSkipAfter: { default: null, rendered: false },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: skipsKey,
        props: {
          // From the document alone: a rule stands where its block does.
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.forEach((node, offset, index) => {
              const before = node.attrs.redlineSkipBefore as RedlineSkip | null;
              const after = node.attrs.redlineSkipAfter as RedlineSkip | null;
              if (before) {
                decos.push(
                  Decoration.widget(offset, () => skipRule(before), {
                    side: -1,
                    key: `redline-skip-${index}-${before.count}-${before.label ?? ""}`,
                  }),
                );
              }
              if (after) {
                decos.push(
                  Decoration.widget(offset + node.nodeSize, () => skipRule(after), {
                    side: 1,
                    key: `redline-skip-end-${after.count}`,
                  }),
                );
              }
            });
            return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
