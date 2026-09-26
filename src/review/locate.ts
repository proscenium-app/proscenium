// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where in the play did a change land?
 *
 * A row in a list tells you a file changed. What a writer wants to know is
 * which SCENE changed — so a pending change can put a mark on the card and the
 * outliner row, and the change feels located in the play rather than filed in
 * an inbox. That is the whole "editing mode" idea, without a change layer
 * inside the document.
 *
 * Scenes are counted exactly as the corkboard counts them: `##` sections when
 * the script has any, else forced scene headings, else the whole script is one
 * scene (docs/app/organizing/workspace-model.md#WORK-D104). Counting is done on
 * the AFTER text, because that is what the writer is looking at.
 */
import { diffLines } from "./diff";

const SECTION_SCENE = /^##\s+/;
const SECTION_ACT = /^#\s+/;
/** A forced scene heading: a line starting with a single dot, e.g. `.A kitchen.` */
const FORCED_HEADING = /^\.[^.\s]/;

function usesSections(lines: string[]): boolean {
  return lines.some((l) => SECTION_SCENE.test(l));
}

/**
 * Scene ordinal for each line of `lines`. Lines before the first scene (a title
 * page, an act heading) belong to scene 0 — a change there is still a change to
 * the play's opening, and reporting -1 would silently drop it.
 */
function sceneOfLine(lines: string[]): number[] {
  const sectioned = usesSections(lines);
  const out: number[] = [];
  let scene = -1;
  for (const line of lines) {
    const isBoundary = sectioned ? SECTION_SCENE.test(line) : FORCED_HEADING.test(line);
    if (isBoundary) scene += 1;
    out.push(Math.max(0, scene));
  }
  return out;
}

/**
 * Which scene ordinals a change touched. Deliberately generous at the edges: a
 * deletion is attributed to the scene it was removed from, so a scene emptied
 * by a change still gets a mark rather than vanishing from the report.
 */
export function touchedScenes(before: string, after: string): Set<number> {
  const afterLines = after.split("\n");
  const sceneAt = sceneOfLine(afterLines);
  const touched = new Set<number>();

  // Walk the diff, tracking position in the AFTER text. A deletion does not
  // advance that position, so it lands on the scene it was cut from.
  let afterIdx = 0;
  for (const line of diffLines(before, after)) {
    if (line.kind === "same") {
      afterIdx += 1;
    } else if (line.kind === "add") {
      touched.add(sceneAt[Math.min(afterIdx, sceneAt.length - 1)] ?? 0);
      afterIdx += 1;
    } else {
      touched.add(sceneAt[Math.min(afterIdx, sceneAt.length - 1)] ?? 0);
    }
  }
  return touched;
}

/** True when this act heading changed too — used to mark a whole act band. */
export function isActHeading(line: string): boolean {
  return SECTION_ACT.test(line) && !SECTION_SCENE.test(line);
}
