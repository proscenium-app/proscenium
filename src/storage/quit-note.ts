// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Words a quit kept in Versions, said when their play next opens (docs/app/keeping-work/storage-and-file-format.md#STOR-D10,
 * docs/app/keeping-work/storage-and-file-format.md#STOR-D13; src/app/quit.ts).
 *
 * Leaving a play keeps a document's unsaved words as a pinned version and says
 * so in a toast. A quit keeps them the same way, and cannot say anything: the
 * window is going. This note is how the next launch says it instead — one small
 * file in the play's app data, read and removed when the play opens. A script's
 * words need no note: its recovery snapshot offers them back when it opens.
 *
 * The note names files, never holds their words, and is read forgivingly: a
 * note nobody can read is no note (docs/app/keeping-work/storage-and-file-format.md#STOR-107).
 */
import {
  isSaveRefusal,
  saveProblem,
  type SaveProblem,
  type SaveRefusal,
  type SaveSubject,
} from "./save-failure";

/** The note's name in the play's app data (`plays/<playId>/`). */
export const KEPT_AT_QUIT = "kept-at-quit.json";

export interface KeptAtQuit {
  kind: SaveSubject["kind"];
  /** As the binder names it: where the writer finds it, and its Versions. */
  name: string;
  /** The folder it is in, for the cause's sentence. */
  folder: string;
  /** Why it could not be saved, when the disk refused it; null behind the "changed somewhere else" choice. */
  refusal: SaveRefusal | null;
}

export function encodeKeptAtQuit(kept: readonly KeptAtQuit[]): string {
  return `${JSON.stringify({ kept }, null, 2)}\n`;
}

const KINDS: ReadonlySet<string> = new Set(["script", "document", "outline"]);

export function decodeKeptAtQuit(raw: string): KeptAtQuit[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = (parsed as { kept?: unknown } | null)?.kept;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown): KeptAtQuit[] => {
    const e = entry as Partial<Record<keyof KeptAtQuit, unknown>> | null;
    if (
      !e ||
      typeof e.name !== "string" ||
      !e.name ||
      typeof e.kind !== "string" ||
      !KINDS.has(e.kind)
    )
      return [];
    return [
      {
        kind: e.kind as KeptAtQuit["kind"],
        name: e.name,
        folder: typeof e.folder === "string" ? e.folder : "",
        refusal: isSaveRefusal(e.refusal) ? e.refusal : null,
      },
    ];
  });
}

/**
 * What the play says when it opens: where the words went, and — when the disk
 * refused them — why, in the same words the refusal used at the time.
 */
export function keptAtQuitMessage(kept: readonly KeptAtQuit[]): string | SaveProblem | null {
  if (kept.length === 0) return null;
  const names = [...new Set(kept.map((k) => `“${k.name}”`))].join(", ");
  const title = `What was typed in ${names} before Proscenium quit is kept in Versions, because it couldn't be saved.`;
  const refused = kept.find((k): k is KeptAtQuit & { refusal: SaveRefusal } => k.refusal !== null);
  if (!refused) return title;
  const cause = saveProblem(refused.refusal, refused);
  return { title, detail: cause.title, code: cause.code };
}
