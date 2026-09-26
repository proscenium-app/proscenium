// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stable codes for the errors the app shows (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D5).
 *
 * A writer reads a sentence; the local error log, Copy Diagnostics and the
 * `error_shown` event keep only its code, because the sentence names plays and
 * folders. `src-tauri/src/telemetry/events.rs` declares the same list and
 * refuses a code that is not on it; error-codes.test.ts holds the two together.
 *
 * Most error toasts say which code they are where they are raised. The
 * workspace's own errors arrive as sentences, from dozens of places in
 * useWorkspace.ts, so `workspaceErrorCode` reads the sentence instead — by the
 * phrases the workspace writes, which the test checks against every literal
 * `setError` there, so a new sentence without a code fails rather than hiding
 * under E-WORKSPACE.
 */

export const ERROR_CODES = [
  "E-BOOT",
  "E-FOLDER-OPEN",
  "E-FOLDER-REFUSED",
  "E-FOLDER-ACCESS",
  "E-ICLOUD",
  "E-PLAY-OPEN",
  "E-PLAY-MISSING",
  "E-PLAY-CREATE",
  "E-SAVE",
  "E-SAVE-LOCKED",
  "E-SAVE-PERMISSION",
  "E-SAVE-NOT-ALLOWED",
  "E-SAVE-DISK-FULL",
  "E-SAVE-READ-ONLY",
  "E-SAVE-FOLDER-GONE",
  "E-SAVE-UNREACHABLE",
  "E-CHANGED-ON-DISK",
  "E-VERSIONS",
  "E-BINDER",
  "E-ACTION-STALE",
  "E-VAULT-READ",
  "E-VAULT-PERMISSION",
  "E-EXPORT-PDF",
  "E-EXPORT-FONT",
  "E-PRINT",
  "E-FORMAT-READ",
  "E-FORMAT-IMPORT",
  "E-FORMAT-EXPORT",
  "E-FORMAT-SAVE",
  "E-FORMAT-TRASH",
  "E-FORMATS-FOLDER",
  "E-REVEAL",
  "E-FINDER-OPEN",
  "E-UPDATE-RESTART",
  "E-WATCH",
  "E-WORKSPACE",
  "E-OTHER",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * The phrases the workspace's sentences are recognised by, first match wins.
 * Order matters where one sentence carries two phrases: "couldn't be saved to
 * “Hamlet”, so it is kept in Versions" is a save that failed, and "couldn't
 * be kept in Versions" is Versions failing.
 */
const WORKSPACE_PHRASES: readonly [RegExp, ErrorCode][] = [
  [/^(PDF export|Printing) failed:.*\bfont\b/is, "E-EXPORT-FONT"],
  [/^PDF export failed|script open to export/i, "E-EXPORT-PDF"],
  [/^Printing failed|script open to print/i, "E-PRINT"],
  // A .docx or .odt export (docs/app/formatting/formats-and-layout.md#FMT-145).
  // A code of its own would add one to the published list, which is the maintainer's
  // call (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-64); until then it is honestly "other".
  [/^\.(?:docx|odt) export failed/i, "E-OTHER"],
  [
    /Choose the folder that holds your plays|Choose a folder that isn't inside a play|Choose a folder only one of them keeps|Choose the Plays folder itself/,
    "E-FOLDER-REFUSED",
  ],
  [/iCloud Drive isn't available/, "E-ICLOUD"],
  [
    /changed on disk|changed again|changed since this entry|two versions of this sheet/i,
    "E-CHANGED-ON-DISK",
  ],
  [/couldn't be kept in Versions|can't be read here/, "E-VERSIONS"],
  [/couldn't be saved|was still changing|typed in .* couldn't be kept/, "E-SAVE"],
  [/binder operation failed|file move needs recovery|file move needs to finish/, "E-BINDER"],
  [
    /opened before .* so nothing was|in a play that isn't open any more|changed while that change was being saved/,
    "E-ACTION-STALE",
  ],
  [
    /could not be opened|has no script yet|play's details changed and could not be read/,
    "E-PLAY-OPEN",
  ],
  [
    /isn't in your Plays folder any more|isn't your Plays folder now|isn't showing on the Plays screen/,
    "E-PLAY-MISSING",
  ],
  [/is already there/, "E-PLAY-CREATE"],
  [/was not chosen or opened/, "E-FOLDER-OPEN"],
  [/couldn't watch the folder/, "E-WATCH"],
  [/permission denied|operation not permitted|os error (1|13)\b/i, "E-VAULT-PERMISSION"],
  [/no such file|not found|ENOENT|os error 2\b|not where it was/i, "E-VAULT-READ"],
];

/** The code for a sentence the workspace showed. */
export function workspaceErrorCode(message: string): ErrorCode {
  for (const [phrase, code] of WORKSPACE_PHRASES) {
    if (phrase.test(message)) return code;
  }
  return "E-WORKSPACE";
}
