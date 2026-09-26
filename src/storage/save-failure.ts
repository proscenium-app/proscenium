// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * When the disk refuses a save (docs/app/keeping-work/storage-and-file-format.md#STOR-D9, "When the disk refuses a write").
 *
 * A write that threw used to reach the writer as the operating system's own
 * words. A script locked in Finder read "Operation not permitted (os error 1)",
 * with nothing about the words, which were safe, and nothing to do about it.
 * This reads what went wrong from what the
 * vault said, and says it in the writer's vocabulary (docs/app/keeping-work/storage-and-file-format.md#STOR-D1). It says the words
 * are still here, and what would let the save go through.
 *
 * The OS's words stay out of sight. The diagnostics keep a code for each
 * refusal (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5), never the text, which can name a path.
 */
import type { ErrorCode } from "../diagnostics/error-codes";

/** Why a write did not land, as far as a writer can do anything about it. */
export type SaveRefusal =
  | "locked"
  | "folder-locked"
  | "no-permission"
  | "not-allowed"
  | "disk-full"
  | "read-only"
  | "folder-gone"
  | "unreachable"
  | "unfinished-save"
  | "unknown";

/**
 * A vault write that threw: the disk refused it, or the vault could not try.
 * `vault.write` rejects with this and nothing else, so a catch that also
 * covers reads can tell a refused save from them.
 */
export class VaultWriteError extends Error {
  constructor(said: unknown) {
    super(said instanceof Error ? said.message : String(said));
    this.name = "VaultWriteError";
  }

  /** The vault's words as it said them: a site that shows `String(e)` shows what it always did. */
  toString(): string {
    return this.message;
  }
}

/** What the vault puts in front of the OS's words when it saw more (vault/mod.rs `refused`). */
const SEEN_BY_THE_VAULT = /^(locked|folder-locked|folder-gone|unfinished-save): /;

/** Darwin's errno values: the vault runs on macOS and iOS. */
const BY_ERRNO: Readonly<Record<number, SaveRefusal>> = {
  1: "not-allowed", // EPERM, no lock: a privacy setting, the sandbox, a view-only share
  2: "folder-gone", // ENOENT
  5: "unreachable", // EIO
  6: "unreachable", // ENXIO
  13: "no-permission", // EACCES
  19: "unreachable", // ENODEV
  20: "folder-gone", // ENOTDIR
  28: "disk-full", // ENOSPC
  30: "read-only", // EROFS
  50: "unreachable", // ENETDOWN
  51: "unreachable", // ENETUNREACH
  57: "unreachable", // ENOTCONN
  60: "unreachable", // ETIMEDOUT
  64: "unreachable", // EHOSTDOWN
  65: "unreachable", // EHOSTUNREACH
  69: "disk-full", // EDQUOT
  70: "unreachable", // ESTALE
};

/** The same, by the words the C library gives them, for an error that carries no number. */
const BY_WORDS: readonly [RegExp, SaveRefusal][] = [
  [/operation not permitted/i, "not-allowed"],
  [/permission denied/i, "no-permission"],
  [/no space left|quota exceeded/i, "disk-full"],
  [/read-only file system/i, "read-only"],
  [/no such file or directory|not a directory/i, "folder-gone"],
  [
    /input\/output error|timed out|not connected|network is (down|unreachable)|host is down|no route to host|stale nfs|device not configured/i,
    "unreachable",
  ],
];

/** Why the vault refused a write, read from the error it rejected with. */
export function saveRefusal(error: unknown): SaveRefusal {
  const said = error instanceof Error ? error.message : String(error);
  const seen = SEEN_BY_THE_VAULT.exec(said)?.[1];
  if (seen) return seen as SaveRefusal;
  const errno = /\(os error (\d+)\)/.exec(said)?.[1];
  if (errno !== undefined) return BY_ERRNO[Number(errno)] ?? "unknown";
  return BY_WORDS.find(([words]) => words.test(said))?.[1] ?? "unknown";
}

export interface SaveSubject {
  /**
   * What the words belong to. Every authored buffer receives its own recovery
   * copy within five seconds, including a document or outline behind a gate.
   */
  kind: "script" | "document" | "outline";
  /** Its name as the binder shows it, which is the file's name in Finder. */
  name: string;
  /** The folder it is in, by name. */
  folder: string;
}

export interface SaveProblem {
  title: string;
  detail: string;
  code: ErrorCode;
}

interface Wording {
  code: ErrorCode;
  /** What happened, as a fact about the writer's Mac. */
  title: (name: string, folder: string) => string;
  /** What would let words on their way save. */
  saving: (name: string, folder: string) => string;
  /** What would let a change the writer asked for be made. */
  change: (name: string, folder: string) => string;
}

const WORDING: Readonly<Record<SaveRefusal, Wording>> = {
  locked: {
    code: "E-SAVE-LOCKED",
    title: (name) => `${name} is locked in Finder.`,
    saving: () => "It will save once you unlock it in Finder's Get Info window.",
    change: () => "Unlock it in Finder's Get Info window, then try again.",
  },
  "folder-locked": {
    code: "E-SAVE-LOCKED",
    title: (_, folder) => `The folder ${folder} is locked in Finder.`,
    saving: (name) => `${name} will save once you unlock the folder in Finder's Get Info window.`,
    change: () => "Unlock the folder in Finder's Get Info window, then try again.",
  },
  "no-permission": {
    code: "E-SAVE-PERMISSION",
    title: (_, folder) => `You don't have permission to change the folder ${folder}.`,
    saving: (name) =>
      `${name} will save once you can make changes in that folder (Get Info › Sharing & Permissions).`,
    change: () =>
      "Once you can make changes in that folder (Get Info › Sharing & Permissions), try again.",
  },
  "not-allowed": {
    code: "E-SAVE-NOT-ALLOWED",
    title: (name) => `macOS isn't letting Proscenium save ${name}.`,
    saving: () =>
      "If its folder was shared with you, it may be view-only; if not, choose your Plays folder again in Settings › General.",
    change: () =>
      "If its folder was shared with you, it may be view-only; if not, choose your Plays folder again in Settings › General.",
  },
  "disk-full": {
    code: "E-SAVE-DISK-FULL",
    title: () => "The disk is full.",
    saving: (name) => `${name} will save once there is room on the disk.`,
    change: () => "Make some room on the disk, then try again.",
  },
  "read-only": {
    code: "E-SAVE-READ-ONLY",
    title: (name) => `${name} is on a read-only disk.`,
    saving: () => "To keep writing, copy the play to a disk you can change and open it from there.",
    change: () => "To change it, copy the play to a disk you can change and open it from there.",
  },
  "folder-gone": {
    code: "E-SAVE-FOLDER-GONE",
    title: (name) => `The folder holding ${name} isn't there any more.`,
    saving: () => "If the play is on a drive, it will save once the drive is connected again.",
    change: () => "If the play is on a drive, connect the drive and try again.",
  },
  unreachable: {
    code: "E-SAVE-UNREACHABLE",
    title: (name) => `${name} is on a disk that isn't responding.`,
    saving: () => "It will save once the drive or network it's on is connected again.",
    change: () => "Once the drive or network it's on is connected again, try again.",
  },
  unknown: {
    code: "E-SAVE",
    title: (name) => `${name} couldn't be saved.`,
    saving: () => "Proscenium keeps trying as you write.",
    change: () => "Try again in a moment.",
  },
  "unfinished-save": {
    code: "E-SAVE",
    title: (name) => `An earlier save of ${name} needs to finish.`,
    saving: () => "Reopen the play to finish that save before writing more.",
    change: () => "Reopen the play to finish that save, then try again.",
  },
};

/** A refusal this app has words for — for reading one back from a file (quit-note.ts). */
export function isSaveRefusal(value: unknown): value is SaveRefusal {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(WORDING, value);
}

/**
 * What the writer reads when a save is refused. `saving` is autosave's words,
 * still on their way to the file; `change` is one change the writer asked for,
 * a card moved or a version restored, which was not made; `quitting` is words
 * a quit is waiting on, which could not be saved and could not be kept either
 * (src/app/quit.ts).
 */
export function saveProblem(
  refusal: SaveRefusal,
  subject: SaveSubject,
  what: "saving" | "change" | "quitting" = "saving",
): SaveProblem {
  const wording = WORDING[refusal];
  const name = `“${subject.name}”`;
  const folder = `“${subject.folder}”`;
  // A full disk is usually the one app data is on as well, so the recovery
  // copy is not promised there.
  const copied = refusal !== "disk-full";
  const kept =
    what === "change"
      ? `Nothing in ${name} was changed.`
      : what === "quitting"
        ? "If Proscenium quits now, what was typed is lost."
        : copied
          ? "Your words are still here, and a copy is being kept."
          : "Your words are still here, in this window.";
  const fix = (what === "change" ? wording.change : wording.saving)(name, folder);
  return { title: wording.title(name, folder), detail: `${kept} ${fix}`, code: wording.code };
}
