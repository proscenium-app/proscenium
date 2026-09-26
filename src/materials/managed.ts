// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * App-maintained sections inside a Markdown material.
 *
 * This is the one place in the design where a DERIVED value lands inside a
 * canonical file, and it is deliberate rather than smuggled. Rule 3 (docs/app/keeping-work/storage-and-file-format.md#STOR-D0)
 * says no canonical datum lives in two places; a character's appearances are
 * canonical in the SCRIPT — who speaks where is what the .fountain says. What
 * goes in the sheet is a labelled cache with exactly the status of a
 * derived cache: the script wins on any divergence, the
 * fence says so in the file itself, and deleting it loses nothing.
 *
 * The payoff is that a character sheet stops being stale prose the moment a
 * scene moves. The cost is this module, and the rule that it may only ever
 * write BETWEEN the marker and the next heading — never a byte outside.
 */
import type { SceneAppearance } from "../workspace";
import { MANAGED_MARK } from "./schema";

/** The appearances list body, marker included. Empty list still renders. */
export function renderAppearances(scenes: SceneAppearance[]): string {
  if (scenes.length === 0) {
    return `${MANAGED_MARK}\n_Does not speak in the script yet._`;
  }
  return [MANAGED_MARK, ...scenes.map((s) => `- ${s.label}`)].join("\n");
}

/** Line index of a `## <heading>` in `lines`, or -1. Case-insensitive. */
function headingIndex(lines: string[], heading: string): number {
  const want = heading.trim().toLowerCase();
  return lines.findIndex(
    (l) =>
      /^##\s+/.test(l) &&
      l
        .replace(/^##\s+/, "")
        .trim()
        .toLowerCase() === want,
  );
}

/** Index of the next ATX heading at any level after `from`, or lines.length. */
function nextHeading(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i += 1) {
    if (/^#{1,6}\s+/.test(lines[i])) return i;
  }
  return lines.length;
}

/**
 * Replace the body under `## <heading>` with `body`, leaving every other byte
 * alone. Returns the content unchanged when the heading is absent — a writer
 * who deleted the section has said they don't want it, and re-adding it would
 * be the app arguing with them.
 */
export function writeManagedSection(content: string, heading: string, body: string): string {
  const lines = content.split("\n");
  const at = headingIndex(lines, heading);
  if (at === -1) return content;

  const end = nextHeading(lines, at + 1);
  const next = [...lines.slice(0, at + 1), ...body.split("\n"), ...lines.slice(end)];

  // Keep one blank line before the following heading, so repeated writes are
  // idempotent rather than slowly eating (or growing) the separator.
  const bodyEnd = at + 1 + body.split("\n").length;
  if (bodyEnd < next.length && next[bodyEnd] !== "") next.splice(bodyEnd, 0, "");
  return next.join("\n");
}

/** True when the material declares a managed section the app should maintain. */
export function hasManagedSection(content: string, heading: string): boolean {
  return headingIndex(content.split("\n"), heading) !== -1;
}
