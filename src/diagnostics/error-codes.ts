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
 * under E-WORKSPACE. An error passed on in the system's own words is coded by
 * `raisedError`: by its cause when the words name one, else by where it arose.
 */

export const ERROR_CODES = [
  "E-BOOT",
  "E-FOLDER-OPEN",
  "E-FOLDER-REFUSED",
  "E-FOLDER-ACCESS",
  "E-ICLOUD",
  "E-PLAY-OPEN",
  "E-PLAY-NO-SCRIPT",
  "E-PLAY-DETAILS",
  "E-PLAY-SETTINGS",
  "E-PLAY-TRASH",
  "E-IMPORT-OPEN",
  "E-SCRIPT-OPEN",
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
  "E-PRACTICE",
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
  // A .docx, .odt or .rtf export (docs/app/formatting/formats-and-layout.md#FMT-145),
  // or the script as one .fountain (docs/app/formatting/formats-and-layout.md#FMT-171).
  // A code of its own would add one to the published list, which is the maintainer's
  // call (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-64); until then it is honestly "other".
  [/^(?:\.(?:docx|odt|rtf)|Fountain) export failed/i, "E-OTHER"],
  // The whole play as one .zip (docs/app/keeping-work/storage-and-file-format.md#STOR-199), the same.
  [
    /^No play is open to export|^A play is exported from|so it was not exported|^The play could not be exported/i,
    "E-OTHER",
  ],
  [
    /Choose the folder that holds your plays|Choose a folder that isn't inside a play|Choose a folder only one of them keeps|Choose the Plays folder itself/,
    "E-FOLDER-REFUSED",
  ],
  [/iCloud Drive isn't available/, "E-ICLOUD"],
  // What used to be one E-PLAY-OPEN, told apart so a report says which the
  // writer saw. Ahead of the rest: an import's sentence ends with the raw error.
  [/has no script yet/, "E-PLAY-NO-SCRIPT"],
  [/was created\b.* but could not be opened/, "E-IMPORT-OPEN"],
  [/play's details changed and could not be read/, "E-PLAY-DETAILS"],
  [
    /practice folder could not be opened|This practice could not be opened|The copy could not be opened|Practice is still opening/,
    "E-PRACTICE",
  ],
  [
    /changed on disk|changed again|changed since this entry|two versions of this sheet/i,
    "E-CHANGED-ON-DISK",
  ],
  [/couldn't be kept in Versions|can't be read here/, "E-VERSIONS"],
  [/couldn't be saved|was still changing|typed in .* couldn't be kept/, "E-SAVE"],
  [/binder operation failed|file move needs recovery|file move needs to finish/, "E-BINDER"],
  [
    // An Undo overtaken too: what was trashed cannot go back where something stands now.
    /opened before .* so nothing was|in a play that isn't open any more|changed while that change was being saved|was not put back: something is there now/,
    "E-ACTION-STALE",
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

/** Every code whose phrases a sentence carries; one, for a sentence the app writes. */
export function phraseCodes(message: string): ErrorCode[] {
  return [...new Set(WORKSPACE_PHRASES.filter(([p]) => p.test(message)).map(([, c]) => c))];
}

/** The code for a sentence the workspace showed. */
export function workspaceErrorCode(message: string): ErrorCode {
  for (const [phrase, code] of WORKSPACE_PHRASES) {
    if (phrase.test(message)) return code;
  }
  return "E-WORKSPACE";
}

/** An error shown with its code, and a detail to read when there is one. */
export interface ShownError {
  title: string;
  code: ErrorCode;
  detail?: string;
}

/**
 * An error raised somewhere the app passes the system's own words on, coded by
 * what went wrong when its words say (a permission, a missing file) and
 * otherwise by `where` it happened, so it never falls to E-WORKSPACE.
 */
export function raisedError(e: unknown, where: ErrorCode): ShownError {
  const title = String(e);
  const said = workspaceErrorCode(title);
  return { title, code: said === "E-WORKSPACE" ? where : said };
}
