// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The format registry: bundled built-ins plus the user's own format files.
 *
 * Built-ins are imported from formats/*.json at the repo root and validated at
 * construction — an invalid built-in is a programmer error and throws. User
 * files are untrusted input (docs/app/keeping-work/storage-and-file-format.md#STOR-107: never break on bad input): an invalid one is
 * skipped and recorded in `warnings` for the UI to surface. A user format
 * cannot replace a built-in id; the writer must import it with a new name.
 *
 * The registry also remembers where each format came from — built in, or which
 * file — because the format designer edits a file in place, and a user file's
 * name need not be its id.
 */
import dgModernRaw from "../../formats/dg-modern.json";
import stageUkRaw from "../../formats/stage-uk.json";
import dgTraditionalRaw from "../../formats/dg-traditional.json";
import dgMusicalRaw from "../../formats/dg-musical.json";
import samuelFrenchRaw from "../../formats/samuel-french.json";
import stageUsModernRaw from "../../formats/stage-us-modern.json";
import sketchComedyRaw from "../../formats/sketch-comedy.json";

import { formats as formatsIpc, type UserFormatFile } from "../storage";
import type { FormatSpec } from "./spec";
import { parseFormatFile, validateFormatSpec } from "./validate";

/** The format applied when a project names none (docs/app/keeping-work/storage-and-file-format.md#STOR-D4 `settings.houseStyle`). */
export const DEFAULT_FORMAT_ID = "dg-modern";

const BUILTIN_RAW: readonly unknown[] = [
  dgModernRaw,
  stageUsModernRaw,
  stageUkRaw,
  samuelFrenchRaw,
  dgTraditionalRaw,
  dgMusicalRaw,
  sketchComedyRaw,
];

/** Validate and return the shipped formats; throws on any invalid built-in. */
export function builtinFormats(): FormatSpec[] {
  return BUILTIN_RAW.map((raw) => {
    const result = validateFormatSpec(raw);
    if (!result.ok) {
      throw new Error(`built-in format file is invalid:\n${result.errors.join("\n")}`);
    }
    return result.spec;
  });
}

export interface FormatProblem {
  /** What was being loaded — a file name, or the id of a project reference. */
  source: string;
  message: string;
}

/** Where a registered format came from. */
export type FormatOrigin = { kind: "builtin" } | { kind: "user"; fileName: string };

export class FormatRegistry {
  private byId = new Map<string, FormatSpec>();
  private origins = new Map<string, FormatOrigin>();
  /** Non-fatal load problems (bad user files, overrides) for the UI to surface. */
  readonly warnings: FormatProblem[] = [];

  static withBuiltins(): FormatRegistry {
    const registry = new FormatRegistry();
    for (const spec of builtinFormats()) {
      registry.byId.set(spec.id, spec);
      registry.origins.set(spec.id, { kind: "builtin" });
    }
    return registry;
  }

  /** Parse + add one user format file; problems become warnings, never throws. */
  addUserFormat(fileName: string, content: string): void {
    const result = parseFormatFile(fileName, content);
    if (!result.ok) {
      this.warnings.push({ source: fileName, message: result.errors.join("; ") });
      return;
    }
    if (this.isBuiltin(result.spec.id)) {
      this.warnings.push({
        source: fileName,
        message: `Built-in format "${result.spec.id}" is read-only. Import this file with a new name to use your copy.`,
      });
      return;
    }
    if (this.byId.has(result.spec.id)) {
      this.warnings.push({
        source: fileName,
        message: `has the same ID as another format file (${result.spec.id}) and replaces it`,
      });
    }
    this.byId.set(result.spec.id, result.spec);
    this.origins.set(result.spec.id, { kind: "user", fileName });
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): FormatSpec | undefined {
    return this.byId.get(id);
  }

  /** Built in, or the user file it was read from; undefined for an unknown id. */
  origin(id: string): FormatOrigin | undefined {
    return this.origins.get(id);
  }

  /** True for a shipped format; always read-only in the designer. */
  isBuiltin(id: string): boolean {
    return this.origins.get(id)?.kind === "builtin";
  }

  /**
   * Resolve a project's format reference. A missing reference gets the default
   * silently (older manifests); an unknown id falls back to the default with a
   * warning — visibly, never silently wrong.
   */
  resolve(id: string | null | undefined): { spec: FormatSpec; warning?: string } {
    const fallback = this.byId.get(DEFAULT_FORMAT_ID);
    if (!fallback) throw new Error(`default format "${DEFAULT_FORMAT_ID}" is not registered`);
    if (!id) return { spec: fallback };
    const spec = this.byId.get(id);
    if (spec) return { spec };
    return {
      spec: fallback,
      warning: `unknown format "${id}" — using "${DEFAULT_FORMAT_ID}"`,
    };
  }

  /** All formats in registration order (built-ins first) — the picker's list. */
  list(): FormatSpec[] {
    return [...this.byId.values()];
  }
}

/**
 * Built-ins plus everything in the user formats directory
 * (<app-config-dir>/formats/*.json; the dev vault keeps its own).
 */
export async function loadFormatRegistry(): Promise<FormatRegistry> {
  const registry = FormatRegistry.withBuiltins();
  let files: UserFormatFile[] = [];
  try {
    files = await formatsIpc.listUser();
  } catch (e) {
    registry.warnings.push({
      source: "Formats folder",
      message: `could not be read: ${(e as Error).message ?? String(e)}`,
    });
  }
  for (const file of files) registry.addUserFormat(file.fileName, file.content);
  return registry;
}

/* ── The app's one registry ─────────────────────────────────────────────── */

/**
 * The registry every surface reads: the document menu's format list, the open
 * play's format, Settings › Formats and the format designer. It used to be
 * loaded once, at startup, by the workspace alone — so a format saved in the
 * designer would not have reached the menu until the next launch. A save,
 * import or delete calls `reloadFormats()`, and every reader gets the new list.
 *
 * Built-ins are the first snapshot, so nothing waits on the user directory to
 * have a format to paint with.
 */
let current: FormatRegistry | null = null;
let loadSeq = 0;
let loaded = false;
const listeners = new Set<() => void>();

export function formatRegistrySnapshot(): FormatRegistry {
  return (current ??= FormatRegistry.withBuiltins());
}

export function subscribeFormats(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Read the user formats again and hand every reader the result. Overlapping
 * reloads are resolved by order of asking, not of answering: an older read that
 * arrives late is dropped, so a slow directory listing cannot put back a format
 * that was just deleted.
 */
export function reloadFormats(): Promise<FormatRegistry> {
  const mine = ++loadSeq;
  return loadFormatRegistry().then((registry) => {
    if (mine === loadSeq) {
      current = registry;
      loaded = true;
      for (const listener of [...listeners]) listener();
    }
    return formatRegistrySnapshot();
  });
}

/** The first read of the user directory, once; later reads come from `reloadFormats`. */
export function ensureFormatsLoaded(): void {
  if (!loaded && loadSeq === 0) void reloadFormats();
}
