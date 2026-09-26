// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The editor: the TipTap schema for the play document, the live stage-format
 * render, and basic element entry. Spec: docs/app/writing/editor-ux.md#EDIT-D100, docs/engineering/fountain-model.md#FOUN-D100.
 */
export { PlayEditor } from "./PlayEditor";
export type { PlayEditorProps } from "./PlayEditor";
export { ElementEntry } from "./element-entry";
export { AutoDetect } from "./input-rules";
export { AutoCaps } from "./auto-caps";
export { CharacterAutocomplete } from "./character-autocomplete";
export { LeaderKey, LEADER_ELEMENTS } from "./leader-key";
export {
  cuePrefix,
  normalizeCast,
  matchCast,
  cuesFromDoc,
  castFromBinder,
} from "./cast";
export type { CastSource } from "./cast";
export {
  playExtensions,
  editorExtensions,
  BODY_ELEMENTS,
} from "./schema";
export {
  emptyEditorDoc,
  ensureNonEmpty,
  fromEditorDoc,
  toEditorDoc,
  LINE_BREAK,
} from "./bridge";
export { Find } from "./find";
export { FindBar } from "./FindBar";
export { scrollPosIntoView } from "./scroll-to";
export { layoutPending } from "./pagination";
