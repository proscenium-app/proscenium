// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The storage layer: the typed vault client plus the conflict safety floor
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-D9) and autosave policy (docs/app/keeping-work/storage-and-file-format.md#STOR-D13). The Rust vault owns durable bytes;
 * this owns dirty-state, the dirty-gate decision, and write scheduling.
 */
export {
  vault,
  NO_FILE_YET,
  platform,
  settings,
  formats,
  exporter,
  versions,
  playStore,
  recovery,
  opened,
  onOpened,
  onExternalChange,
  onConflictCopy,
  EVENT_EXTERNAL_CHANGE,
  EVENT_CONFLICT_COPY,
} from "./ipc";
export { onOwnWrite } from "./own-writes";
export type { OwnWrite } from "./own-writes";
export type {
  Capabilities,
  VaultEntry,
  OpenResult,
  ReadResult,
  UserFormatFile,
  WriteOutcome,
  ExternalChangeEvent,
  ConflictCopyEvent,
  VersionEntry,
  OpenedFacts,
  FolderFacts,
} from "./ipc";
export {
  DocumentSession,
  decideExternalChange,
} from "./conflict-floor";
export type {
  Hash,
  ExternalChangeDecision,
  SessionStatus,
} from "./conflict-floor";
export {
  AutosaveScheduler,
  DEFAULT_AUTOSAVE,
} from "./autosave";
export type { AutosaveOptions, TimerHost } from "./autosave";
export { SnapshotPolicy } from "./version-policy";
export { RecoverySnapshots, RECOVERY_INTERVAL_MS } from "./recovery";
export type { RecoveryIO, RecoveryScript, RecoveryTarget } from "./recovery";
export {
  decideRecovery,
  decodeSnapshot,
  encodeSnapshot,
  sameScriptText,
} from "./recovery-policy";
export type { RecoveryDecision, RecoveryFacts, RecoverySnapshot } from "./recovery-policy";
export { saveProblem, saveRefusal, VaultWriteError } from "./save-failure";
export type { SaveProblem, SaveRefusal, SaveSubject } from "./save-failure";
export { KEPT_AT_QUIT, decodeKeptAtQuit, encodeKeptAtQuit, keptAtQuitMessage } from "./quit-note";
export type { KeptAtQuit } from "./quit-note";
