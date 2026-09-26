// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The workspace layer — the play file, the binder, and the corkboard/outliner.
 */
export {
  PLAY_EXT,
  PLAY_KIND,
  SCHEMA_VERSION,
  choosePlayFile,
  commitPlay,
  defaultCard,
  emptyScriptData,
  isPlayFileName,
  isReadOnly,
  playFileName,
  pruneScripts,
  readPlayFile,
  sameIgnoringModified,
  scriptDataFor,
  serializePlay,
  withBinder,
  withScriptData,
  writePlayFile,
} from "./play-file";
export type {
  BinderItem,
  BinderItemType,
  Card,
  CardColor,
  CardStatus,
  Loaded,
  PlayCommit,
  PlayFile,
  PlaySettings,
  SceneAnchor,
  SceneRecord,
  ScriptData,
} from "./play-file";

export * as binder from "./binder";
export { titleOf, findItem as locateBinderItem } from "./binder";
export {
  reorderItem,
  renameItem,
  moveItem,
  newFolder,
  newMaterial,
  newScript,
  importIntoPlay,
  deleteItem,
  duplicateItem,
  commitBinder,
  restoreBinderItem,
} from "./binder-apply";
export type { BinderContext, ApplyResult } from "./binder-apply";

export {
  allPlayFiles,
  discoverPlays,
  discoverPlaysBelow,
  resolvePlayFile,
  scaffoldPlayAt,
  scaffoldPlayInVault,
  updatePlayMeta,
} from "./vault-plays";
export type { VaultPlay } from "./vault-plays";
export { playPages, type PlayPages } from "./play-pages";

export {
  binderPaths,
  ignoredDir,
  ignoredFile,
  isTempSibling,
  reconcile,
  reconcileBinder,
  walkPlay,
} from "./binder-reconcile";
export type { DiskNode, Reconciliation } from "./binder-reconcile";

export {
  conflictOriginal,
  isProviderArtifact,
  isProviderConflictCopy,
} from "./sync-names";

export { computeAppearances } from "./appearances";
export type { SceneAppearance } from "./appearances";

export {
  compareByWeight,
  computeWeights,
  detectNewSpeakers,
  groupCast,
  tierFor,
} from "./cast-weight";
export type { CastGroup, CastTier, CharacterWeight } from "./cast-weight";

export { findOutlineNote, hasContent, OUTLINE_NOTE_TITLE } from "./outline-note";
export { split as splitFrontMatter, reconstruct as withFrontMatter, setField, parseTags } from "./front-matter";
export type { FrontMatter } from "./front-matter";

export {
  reconcileCards,
  reorderSceneCards,
  sameScriptData,
  toRecord,
} from "./card-reconcile";
export type { ReconcileInput, ReconcileResult, SceneCard } from "./card-reconcile";

export { classifyOpened, inPlaysFolder, isInside, samePath } from "./open-route";
export {
  playsFolderHint,
  playsFolderRefusal,
  providerKind,
  providerName,
  wherePlaysLive as wherePlaysLiveSentence,
} from "./plays-folder";
export type { FolderOfPlays, PlaysFolderHint } from "./plays-folder";
export type { OpenRoute, PlayLocation } from "./open-route";

export { ulid, isUlid } from "./ulid";
export type { BufferLease, MaterialBuffer, ParkedWords } from "./material-buffer";
export { buildsOn, builtOn, rememberFailed } from "./material-buffer";
export { fileName, titleFromFileName, uniqueFileName, nameMatchesTitle } from "./filename";
export {
  stringifyCanonical,
  parseJson,
  PLAY_TMPL,
  SCRIPT_DATA_TMPL,
} from "./json-io";
export type { KeyTemplate } from "./json-io";
