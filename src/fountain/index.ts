// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Fountain engine — parse ⇄ serialize plus scene extraction.
 *
 * This module owns round-trip fidelity (docs/engineering/fountain-model.md#FOUN-D100). It has no DOM
 * or Tauri dependency: the document model is plain ProseMirror-shaped JSON, so
 * the editor loads its output directly and the round-trip suite tests it in
 * isolation under `bun test`.
 */
export { parse } from "./parse";
export { cueName, cueNameEnd, cueNamePart, splitCueExtension, trailingExtension } from "./cue";
export { serialize } from "./serialize";
export { extractScenes } from "./scenes";
export type { SceneSpan } from "./scenes";
export { headingHash, headingPath } from "./heading-hash";
export { addSceneToDoc, moveSceneInDoc, sameSceneOutline, sceneBlockRanges, setSceneSynopsis } from "./scene-move";
export type { SceneBlock } from "./scene-move";
export {
  parseInline,
  serializeInline,
  textContent,
  textNode,
  markKey,
} from "./inline";
export { splitTitlePage, serializeTitlePage } from "./titlepage";
export type {
  BlockNode,
  BlockType,
  CharacterEntry,
  Doc,
  FrontMatter,
  InlineNode,
  Mark,
  MarkType,
  NoteNode,
  ParsedScript,
  TextNode,
} from "./model";

export { fdxToFountain, scriptFromFile, type FdxResult } from "./fdx";
