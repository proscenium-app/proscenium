// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * FDX (.fdx) → Fountain (docs/app/importing/document-import.md#IMPT-25).
 *
 * Every playwright who tries this app has a draft somewhere else, and the two
 * places it lives are a `.fountain` file (which is already the app's format)
 * an `.fdx`. This is a PARSER, not a data-model change: FDX's XML names
 * the same elements the schema already has, so the conversion is a table.
 *
 * What it does not do is guess. An FDX paragraph type this table does not know
 * comes across as action — text a writer typed is never dropped, and a wrong
 * element is one Tab away from right, while a missing line is gone.
 */

import { assertDocumentText } from "../storage/read-limit";
import { scanFdx } from "./fdx-scan";

/** FDX's `Paragraph Type` → what to write in the .fountain. */
type Emit = (text: string) => string;

const AS_IS: Emit = (t) => t;

const TYPES: Record<string, Emit> = {
  "Scene Heading": (t) => `## ${t}`,
  Action: AS_IS,
  Character: (t) => t.toUpperCase(),
  // Fountain writes a parenthetical with its own brackets; an FDX usually
  // stores them, so add them only when they are missing.
  Parenthetical: (t) => (/^\(.*\)$/.test(t) ? t : `(${t})`),
  Dialogue: AS_IS,
  Transition: (t) => `> ${t.replace(/^>\s*/, "")}`,
  Shot: AS_IS,
  General: AS_IS,
  Lyrics: (t) => `~${t.replace(/^~/, "")}`,
  "Cast List": AS_IS,
  Act: (t) => `# ${t}`,
};

/** Blocks that must be followed by a blank line for Fountain to re-read them. */
const BREAKS_AFTER = new Set(["Scene Heading", "Action", "Transition", "General", "Shot", "Act"]);

export interface FdxResult {
  fountain: string;
  /** Title-page keys the FDX carried, for the front matter. */
  title: string | null;
  /** Paragraph types this table did not know, for an honest report. */
  unknownTypes: string[];
}

/**
 * Convert an FDX document. Returns null when the bytes are not an FDX at all —
 * the caller says so rather than writing a file of error messages into a play.
 */
export function fdxToFountain(xml: string): FdxResult | null {
  assertDocumentText(xml);
  const scanned = scanFdx(xml);
  if (!scanned) return null;
  const title = scanned.title.find((p) => p.text)?.text ?? null;

  const unknown = new Set<string>();
  const lines: string[] = [];
  let lastType = "";

  for (const { type, text } of scanned.body) {
    if (!text) continue;
    // Own properties only: a `Paragraph Type="__proto__"` found Object's
    // prototype on the lookup and threw mid-import.
    const emit = Object.prototype.hasOwnProperty.call(TYPES, type) ? TYPES[type] : undefined;
    if (!emit) unknown.add(type);

    /* A blank line between blocks is what makes Fountain re-read them as the
       same elements. Dialogue must stay welded to its cue, so the blank goes
       BEFORE a cue rather than after every line. */
    const needsGap =
      lines.length > 0 &&
      (BREAKS_AFTER.has(lastType) ||
        type === "Character" ||
        type === "Scene Heading" ||
        type === "Act");
    if (needsGap) lines.push("");

    lines.push((emit ?? AS_IS)(text));
    lastType = type;
  }

  if (lines.length === 0) return null;
  return {
    fountain: lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n",
    title,
    unknownTypes: [...unknown],
  };
}

/**
 * Read whichever of the two a writer dropped. Fountain passes straight through
 * — it IS the format — so this is only ever doing work for an FDX.
 */
export function scriptFromFile(name: string, content: string): FdxResult | null {
  assertDocumentText(content);
  if (/\.fdx$/i.test(name)) return fdxToFountain(content);
  if (/\.(fountain|txt|spmd)$/i.test(name)) {
    const lines = content.split("\n");
    let title: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!/^Title:/i.test(line)) continue;
      let value = line.slice(6).trim();
      while (!value && i + 1 < lines.length) value = lines[++i]!.trim();
      if (value) title = value;
      break;
    }
    return { fountain: content, title, unknownTypes: [] };
  }
  return null;
}
