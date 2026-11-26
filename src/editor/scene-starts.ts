// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where each scene begins on the page.
 *
 * The outline's rule (src/fountain/scenes.ts `extractScenes`,
 * docs/app/organizing/workspace-model.md#WORK-41): a `##` scene title begins a
 * scene when the script has any, a scene heading begins one only when it has
 * none, and a script with neither is one scene, from its first line to its
 * last. A scene is the stretch from its first line to the next scene's, so its
 * number in this list is the one name for it that two scenes with one title do
 * not share.
 *
 * The third rule is the one a short play meets: ten minutes in one place, no
 * heading anywhere. The board already held such a play as one card; this list
 * held it as no scene at all, so the caret was in none, the inspector's Scene
 * tab said so, and the card opened nothing (docs/app/organizing/workspace-model.md#WORK-93).
 *
 * Whatever on the page asks which scene a position is in reads it here: the
 * scene the caret is in, the scene a card opens, and the scene whose comments
 * the inspector counts (docs/app/writing/comments.md#COMM-70), so it cannot
 * show one scene and count another's.
 *
 * Works on the editor's nodes and needs nothing else of the editor.
 */
import type { Node as PmNode } from "@tiptap/pm/model";

/** The offset of the line each scene begins at, in script order. */
export function sceneStarts(doc: PmNode): number[] {
  const titles: number[] = [];
  const headings: number[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name === "scene") titles.push(offset);
    else if (node.type.name === "sceneHeading") headings.push(offset);
  });
  if (titles.length) return titles;
  if (headings.length) return headings;
  // Neither: the whole script is its one scene, once it has a word in it. An
  // empty script is no scene, as the outline has no card for it.
  return wholeScript(doc) ? [0] : [];
}

/**
 * Whether the script has words in it and nothing that divides it: no `##`
 * scene title and no scene heading, so it is one scene from top to bottom.
 */
export function wholeScript(doc: PmNode): boolean {
  let divided = false;
  doc.forEach((node) => {
    if (node.type.name === "scene" || node.type.name === "sceneHeading") divided = true;
  });
  return !divided && doc.textContent.trim() !== "";
}
