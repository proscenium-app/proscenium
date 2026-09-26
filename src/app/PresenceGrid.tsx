// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The presence grid — characters down, scenes across, a mark where each speaks.
 *
 * It lives under the cast list because it answers the same question at a
 * different altitude: the list says who is in the play, this says how they are
 * distributed through it. Entrances and exits read as the shape of each row; the
 * fullest scene reads as the tallest column; and a character who drops out of the
 * middle of the play leaves a visible hole, which is the thing a writer most
 * often fails to notice in their own draft.
 *
 * Colour is never the only carrier (docs/engineering/design-system.md#EDIT-D105): a
 * scene with a line is a filled mark, one without is a dot, and the gap warning
 * is a number in words as well as a tint — so it survives monochrome,
 * high-contrast and e-ink.
 */
import { NOTABLE_GAP, presenceGrid } from "../workspace/presence";
import type { SceneAppearance } from "../workspace/appearances";
import type { SceneCard } from "../workspace";

export interface PresenceGridProps {
  /** The writer's cast order, so the grid reads like the printed page. */
  names: string[];
  appearances: Map<string, SceneAppearance[]>;
  cards: SceneCard[];
  /** Jump to a scene in the script — the column headings are handles. */
  onOpenScene?: (ordinal: number) => void;
}

export function PresenceGrid({ names, appearances, cards, onOpenScene }: PresenceGridProps) {
  const scenes = [...cards]
    .sort((a, b) => a.anchor.ordinal - b.anchor.ordinal)
    .map((rec) => ({
      ordinal: rec.anchor.ordinal,
      label: rec.heading?.trim() || `Sc ${rec.anchor.ordinal + 1}`,
      act: rec.act?.trim() || null,
    }));
  const grid = presenceGrid(names, appearances, scenes);

  if (grid.scenes.length === 0 || grid.rows.length === 0) return null;

  // Act bands across the top, so a gap can be read as "absent for act two".
  const actSpans: { act: string; span: number }[] = [];
  for (const scene of grid.scenes) {
    const act = scene.act ?? "";
    const last = actSpans[actSpans.length - 1];
    if (last && last.act === act) last.span += 1;
    else actSpans.push({ act, span: 1 });
  }
  const hasActs = actSpans.some((a) => a.act);

  return (
    <section className="presence">
      <h3 className="presence__title">Who’s on stage</h3>
      <p className="presence__sub">
        A mark where a character speaks. Read across for a part’s shape, down for
        how full a scene is.
      </p>
      <div className="presence__scroll">
        <table className="presence__grid">
          {/* One head for both rows: two `thead`s is invalid
              table markup, and the act row's association was anyone's guess. */}
          <thead>
            {hasActs && (
              <tr>
                <th className="presence__corner">
                  <span className="sr-only">Act</span>
                </th>
                {actSpans.map((a, i) => (
                  <th key={`${a.act}-${i}`} colSpan={a.span} scope="colgroup" className="presence__act">
                    {a.act}
                  </th>
                ))}
                <th className="presence__corner">
                  <span className="sr-only">Total</span>
                </th>
              </tr>
            )}
            <tr>
              <th className="presence__corner" scope="col">
                Character
              </th>
              {grid.scenes.map((scene) => (
                <th key={scene.ordinal} className="presence__scene" scope="col">
                  <button
                    className="presence__scenebtn"
                    title={`${scene.label} — ${scene.onStage} speaking${
                      scene.ordinal === grid.fullestScene ? " · the fullest scene" : ""
                    }`}
                    onClick={() => onOpenScene?.(scene.ordinal)}
                  >
                    {scene.label}
                  </button>
                </th>
              ))}
              <th className="presence__total" scope="col">
                Scenes
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.name} className="presence__row">
                <th className="presence__name" scope="row">
                  {row.name || <span className="presence__unnamed">(unnamed)</span>}
                </th>
                {grid.scenes.map((scene) => {
                  const here = row.scenes.has(scene.ordinal);
                  const inside =
                    row.first >= 0 && scene.ordinal > row.first && scene.ordinal < row.last;
                  return (
                    <td
                      key={scene.ordinal}
                      className={`presence__cell${here ? " is-on" : ""}${
                        !here && inside ? " is-gap" : ""
                      }`}
                      title={`${row.name} · ${scene.label} — ${here ? "speaks" : "silent"}`}
                    >
                      {/* The mark is for the eye; the word is for everyone
                          else — VoiceOver read the dot as "middle dot". */}
                      <span aria-hidden="true">{here ? "●" : "·"}</span>
                      <span className="sr-only">
                        {here ? "speaks" : inside ? "silent, between entrances" : "silent"}
                      </span>
                    </td>
                  );
                })}
                <td className="presence__total">
                  {row.count === 0 ? (
                    <span className="presence__never">never speaks</span>
                  ) : (
                    <>
                      {row.count}
                      {row.longestGap > NOTABLE_GAP && (
                        <span
                          className="presence__gap"
                          title={`Off stage for ${row.longestGap} scenes in the middle of the play`}
                        >
                          gap of {row.longestGap}
                        </span>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="presence__name" scope="row">
                On stage
              </th>
              {grid.scenes.map((scene) => (
                <td
                  key={scene.ordinal}
                  className={`presence__count${
                    scene.ordinal === grid.fullestScene ? " is-fullest" : ""
                  }`}
                >
                  {scene.onStage}
                </td>
              ))}
              <td className="presence__total" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
