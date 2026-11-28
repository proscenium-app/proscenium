// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The workspace layer — the play file, the binder, and the corkboard/outliner.
 */
export {
  PLAY_EXT,
  PLAY_KIND,
  SCHEMA_VERSION,
  BASE_SCHEMA,
  DRAFTS_SCHEMA,
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
  DraftRecord,
  PlaySettings,
  SceneAnchor,
  SceneRecord,
  ScriptData,
} from "./play-file";

export * as binder from "./binder";
export { titleOf, isKeptScript, findItem as locateBinderItem } from "./binder";
export {
  reorderItem,
  renameItem,
  followPlayRename,
  saveDraftItem,
  workingCopyItem,
  DRAFTS_DIR,
  moveItem,
  newFolder,
  newMaterial,
  newScript,
  importIntoPlay,
  deleteItem,
  duplicateItem,
  commitBinder,
  restoreBinderItem,
  makeFrontMatterFolder,
  newPageFile,
} from "./binder-apply";
export {
  SIDE_NAME,
  backFolderId,
  backPageItems,
  frontFolderId,
  frontPageItems,
  frontPageSource,
  hasPageKeys,
  pageFolderId,
  pageFolderOf,
  withoutPageKeys,
  type PageSide,
} from "./front-folder";
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
export {
  addZippedPlay,
  duplicatePlay,
  newPlayLike,
  playFolderName,
  PlayNameTaken,
  playZip,
  readZippedPlay,
  renamePlay,
  scriptToFollow,
  titleFacts,
} from "./play-ops";
export { carryPlayMemory } from "./play-memory";
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
export {
  split as splitFrontMatter,
  reconstruct as withFrontMatter,
  setField,
  parseTags,
} from "./front-matter";
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

export { ulid, isUlid } from "../storage/ulid";
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
