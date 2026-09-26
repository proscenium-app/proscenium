// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page's side of docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D100: what it tells Rust, and the two
 * Help items a writer uses to hand diagnostics to someone.
 *
 * Nothing here sends anything. `telemetry` asks Rust to record an event from
 * its closed list, and Rust decides — by the switch in Settings › Privacy, and
 * by whether this build can send at all — whether it goes anywhere.
 */
import { formatRegistrySnapshot } from "../format";
import { diagnostics as ipc, telemetry, type Surface } from "../storage/ipc";
import type { ToastSpec } from "../ui";
import type { ErrorCode } from "./error-codes";

export { ERROR_CODES, workspaceErrorCode, type ErrorCode } from "./error-codes";
export { pageErrorSignal } from "./page-error";

/** An error toast was shown: kept in the local log, and reported if reports are on. */
export function errorShown(code: ErrorCode): void {
  telemetry.record({ name: "error_shown", code });
}

/** A surface came on screen. Rust reports each one once a launch. */
export function surfaceShown(surface: Surface): void {
  telemetry.record({ name: "surface_shown", surface });
}

/** A play opened, with the number of plays in the Plays folder — which Rust buckets. */
export function playOpened(playsInFolder: number): void {
  telemetry.record({ name: "play_opened", playsInFolder });
}

/** A PDF was written. */
export function pdfExported(kind: "whole" | "range" | "sides", formatId: string): void {
  telemetry.record({ name: "pdf_exported", kind, format: formatForReports(formatId) });
}

/** A format was saved from the designer. */
export function formatSaved(): void {
  telemetry.record({ name: "format_saved" });
}

/**
 * A format as reports and diagnostics name it: a built-in by its id, and a
 * writer's own — including one that overrides a built-in's id — as `user`.
 */
export function formatForReports(id: string): string {
  return formatRegistrySnapshot().isBuiltin(id) ? id : "user";
}

/** The formats in use, as reports name them, each once. */
export function formatsInUse(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => !!id).map(formatForReports))];
}

type Toast = (t: ToastSpec) => void;

/** Help › Copy Diagnostics, and the button in Settings › About. */
export async function copyDiagnostics(formats: string[], toast: Toast): Promise<void> {
  try {
    await ipc.copy(formats);
    toast({
      kind: "ok",
      title: "Diagnostics copied",
      detail:
        "They include no play, file or folder names. Read them before you paste them anywhere.",
    });
  } catch (e) {
    toast({
      kind: "error",
      title: "The diagnostics could not be copied.",
      detail: String(e),
      code: "E-OTHER",
    });
  }
}
