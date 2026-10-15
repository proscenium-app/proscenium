// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where each scene begins on the page.
 *
 * The outline's rule (src/fountain/scenes.ts `extractScenes`): a `##` scene
 * title begins a scene when the script has any, and a scene heading begins one
 * only when it has none. A scene is the stretch from its first line to the
 * next scene's, so its number in this list is the one name for it that two
 * scenes with one title do not share.
 *
 * Whatever on the page asks which scene a position is in reads it here: the
 * scene the caret is in, and the scene whose comments the inspector counts
 * (docs/app/writing/comments.md#COMM-70), so it cannot show one scene and
 * count another's.
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
  return titles.length ? titles : headings;
}
