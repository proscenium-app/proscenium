// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page map, once the running-time strip.
 *
 * Length in pages was only ever visible on the board, which means it was only
 * visible when you had stopped writing. This puts pacing under the writer's
 * hands while they write: one segment per scene, width proportional to its
 * pages, coloured by the card's own hue, with the scene on screen marked and
 * the acts divided by a tick.
 *
 * It was named for the minutes it claimed, one page to a minute. That
 * translation is gone: a page is not a minute, so the strip says
 * pages and calls itself what it is. The component, its classes and the
 * `runningTimeStrip` setting keep the old name, because renaming a settings key
 * means a migration and nothing a writer reads says it.
 *
 * It reads `scenePages`, which comes from the same `paginate()` the editor and
 * the PDF use — so a scene's width here and its page breaks in the script can
 * never disagree. Nothing is stored and nothing is computed twice.
 *
 * **To a screen reader it is one picture with a sentence, and to a keyboard it
 * is not a stop** (docs/app/preferences-and-help/accessibility.md#A11Y-6). It was a button per scene: thirty Tab stops at
 * the foot of the page for a jump that ⌘⇧J, ⌥⌘↑/↓ and the binder's scene rows
 * already make, and 6px-tall targets no pointer-impaired hand could hit. The
 * segments stay clickable for the mouse — a minimap, not a control — and the
 * strip says what it shows: how many pages the play runs and where the writer
 * is.
 */
import { pageCountLabel, pageRangeLabel, type ScenePageMap } from "../layout";
import type { SceneCard } from "../workspace";

export function RunningTimeStrip({
  cards,
  scenePages,
  caretOrdinal,
  onJump,
}: {
  cards: SceneCard[];
  scenePages: ScenePageMap;
  caretOrdinal: number | null;
  onJump: (ordinal: number) => void;
}) {
  if (scenePages.scenes.length === 0) return null;
  const cardFor = new Map(cards.map((c) => [c.anchor.ordinal, c]));

  let lastAct: string | null | undefined;
  const cells: React.ReactNode[] = [];

  for (const s of scenePages.scenes) {
    // A tick between acts, so the strip reads as a shape and not a bar chart.
    if (lastAct !== undefined && s.act !== lastAct) {
      cells.push(<span key={`tick-${s.ordinal}`} className="rts__tick" aria-hidden="true" />);
    }
    lastAct = s.act;
    const card = cardFor.get(s.ordinal);
    const hue = card?.card.color ?? "cream";
    const heading = card?.heading ?? `Scene ${s.ordinal + 1}`;
    cells.push(
      <span
        key={s.ordinal}
        className={`rts__seg rts__seg--${hue}${s.ordinal === caretOrdinal ? " is-here" : ""}`}
        style={{ flexGrow: Math.max(1, s.pages) }}
        title={`${heading} · ${pageRangeLabel(s)} · ${pageCountLabel(s.pages)}`}
        onClick={() => onJump(s.ordinal)}
      />,
    );
  }

  const here = scenePages.scenes.findIndex((s) => s.ordinal === caretOrdinal);
  const hereCard = here >= 0 ? cardFor.get(scenePages.scenes[here].ordinal) : undefined;
  const where =
    here >= 0
      ? ` On screen: ${hereCard?.heading ?? `scene ${here + 1}`}, scene ${here + 1} of ${scenePages.scenes.length}.`
      : "";

  return (
    <div
      className="rts"
      role="img"
      aria-label={`Scene navigation: ${scenePages.totalPages} page${
        scenePages.totalPages === 1 ? "" : "s"
      }.${where}`}
    >
      {cells}
    </div>
  );
}
