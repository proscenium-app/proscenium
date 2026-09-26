// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What kind of material is this file?
 *
 * Used when the binder reconciler finds a file on disk that nobody filed —
 * typically one another tool just created. Getting this wrong is cheap and
 * reversible (the writer re-types it in the binder), so the order of evidence
 * runs strongest-first and bottoms out at something safe rather than clever.
 *
 * Since the taxonomy collapsed (schema.ts), "safe" is also the common case:
 * everything that isn't a script, a character sheet, or a binary reference is a
 * document, and a document has no shape to get wrong.
 */
// Imported from the defining modules rather than the workspace barrel: the
// barrel reaches the vault client, and this file has to stay importable by the
// layout migration, which runs under plain Bun with no Tauri around it.
import { split as splitFrontMatter } from "../workspace/front-matter";
import type { BinderItemType } from "../workspace/play-file";
import { SCHEMAS, normalizeType } from "./schema";

/** Directory name → the type whose conventional home it is. */
const BY_DIR = new Map<string, BinderItemType>(SCHEMAS.map((s) => [s.dir.toLowerCase(), s.type]));

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function lastSegment(dir: string): string {
  const i = dir.lastIndexOf("/");
  return i < 0 ? dir : dir.slice(i + 1);
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/**
 * Infer a binder type for `path`, reading `content` when it is Markdown.
 *
 * Evidence, in order:
 *  1. `.fountain` is a script, whatever folder it is in.
 *  2. Anything that is NOT Markdown is a `reference` — it passes through
 *     untouched and opens read-only/externally. This check has to come BEFORE
 *     the directory rule: `research/tide-tables.pdf` sits in the research
 *     folder but typing it `research` would hand a PDF to the prose editor.
 *  3. The file's own `type:` front-matter — it said what it is. An old name
 *     (`research`, `logline`, `note`) resolves through `normalizeType`.
 *  4. Its conventional directory (`characters/` → character), including a
 *     nested one like `materials/characters/`.
 *  5. Otherwise a document.
 */
export function inferType(path: string, content?: string | null): BinderItemType {
  if (path.endsWith(".fountain")) return "script";
  if (!isMarkdown(path)) return "reference";

  if (content) {
    const declared = splitFrontMatter(content).fields.type;
    // `outline` is the one type a file may claim for itself and be believed
    // beyond the normalizer, because the Outline surface finds its scratchpad
    // by exactly this marker after a resync.
    if (declared === "outline") return "outline";
    if (declared) return normalizeType(declared);
  }

  // Never infer `outline` from a directory, or every file in notes/ would claim
  // to be the scratchpad.
  const byDir = BY_DIR.get(lastSegment(dirOf(path)).toLowerCase());
  if (byDir && byDir !== "outline") return byDir;

  return "document";
}
