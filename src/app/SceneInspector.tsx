// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Scene tab (docs/app/organizing/workspace-model.md#WORK-D2) — the corkboard card's data, available
 * while writing.
 *
 * The board already holds all of this; what it could not do was be open at the
 * same time as the script. A writer deciding whether a scene is finished is
 * looking at the scene, not at a grid of cards, so the same fields come to the
 * page instead.
 *
 * The field labels name their write target, because these two rows go to
 * different files and that has always been invisible: **Synopsis writes the
 * script** (the `=` line, canonical in the .fountain) and everything else
 * writes the play file. Getting that backwards is how a
 * board note would end up printed.
 */
import { useEffect, useRef, useState } from "react";
import type { ScenePageMap } from "../layout";
import type { SceneCard } from "../workspace";
import { useSceneStatusOptions } from "./settings/scene-statuses";
import type { Card, CardColor } from "../workspace";
import { Capsule, PopupButton, WarnIcon } from "../ui";

const COLORS: { id: CardColor; name: string }[] = [
  { id: "cream", name: "Unmarked" },
  { id: "oxide", name: "Setup" },
  { id: "ink", name: "Turns" },
  { id: "sea", name: "Interior" },
  { id: "moss", name: "Subplot" },
  { id: "amber", name: "Revise" },
  { id: "ash", name: "Parked" },
];


/** A field that commits on blur, so every keystroke is not a disk write. */
function LazyField({
  value,
  onCommit,
  placeholder,
  area,
  rows,
  label,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  area?: boolean;
  rows?: number;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const edited = useRef(false);
  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };
  // A change from elsewhere (a sync, the board) has to land here, but not
  // while the writer is mid-word in this very field.
  useEffect(() => {
    if (!edited.current) setDraft(value);
  }, [value]);
  // Committed on leaving, or when the field goes away first: the inspector is
  // keyed by scene, so moving the caret to another scene replaces the field
  // before its blur, and the words go to the scene they were typed for.
  const commit = () => {
    const { draft: d, value: v, onCommit: c } = latest.current;
    const was = edited.current;
    edited.current = false;
    if (was && d !== v) c(d);
  };
  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const props = {
    value: draft,
    "aria-label": label,
    placeholder,
    onChange: (e: { target: { value: string } }) => {
      edited.current = true;
      setDraft(e.target.value);
    },
    onBlur: commit,
  };
  return area ? (
    <textarea className="field field--area" rows={rows ?? 3} {...props} />
  ) : (
    <input
      className="field"
      {...props}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function SceneInspector({
  scene,
  scenePages,
  onSetCard,
  onEditSynopsis,
  speakers,
  commentCount,
  todoCount,
  onShowComments,
  pendingChange,
  onReviewChange,
}: {
  scene: SceneCard | null;
  scenePages?: ScenePageMap;
  onSetCard: (sceneId: string, partial: Partial<Card>) => void;
  onEditSynopsis: (ordinal: number, text: string) => void;
  /** Who speaks here, and how many times. */
  speakers: { name: string; lines: number }[];
  commentCount: number;
  todoCount: number;
  onShowComments: () => void;
  /** Set when something arrived from outside and touched this scene. */
  pendingChange: { when: string } | null;
  onReviewChange: () => void;
}) {
  const statuses = useSceneStatusOptions(scene?.card.status ?? "");
  if (!scene) {
    return (
      <div className="emptysurface">
        <span className="emptysurface__glyph">
          <WarnIcon size={22} />
        </span>
        <p className="emptysurface__title">No scene here</p>
        <p className="emptysurface__body">
          Put the caret in a scene, or type <span className="mono">## Scene</span> in
          the script, and its card appears here.
        </p>
      </div>
    );
  }

  const pages = scenePages?.scenes.find((s) => s.ordinal === scene.anchor.ordinal);
  const ordinalInAct = (scenePages?.acts ?? [])
    .find((a) => a.act === scene.act)
    ?.scenes.indexOf(scene.anchor.ordinal);
  const sceneNo = (ordinalInAct ?? scene.anchor.ordinal) + 1;

  return (
    <div className="inspector__scroll insp">
      <div className="insp__head">
        <div className="seclabel">
          {scene.act ? `${scene.act} · Scene ${sceneNo}` : `Scene ${sceneNo}`}
        </div>
        <h2 className="insp__title">{scene.heading || "Untitled scene"}</h2>
        <div className="insp__meta">
          {pages && (
            <>
              {pages.firstPage === pages.lastPage
                ? `Page ${pages.firstPage}`
                : `Pages ${pages.firstPage}–${pages.lastPage}`}{" "}
              · {pages.pages} page{pages.pages === 1 ? "" : "s"} ·{" "}
            </>
          )}
          {speakers.reduce((n, s) => n + s.lines, 0)} speeches
        </div>
      </div>

      <section className="insp__group">
        <div className="seclabel">
          Summary <span className="insp__where">· not printed</span>
        </div>
        <LazyField
          label="Summary"
          area
          value={scene.synopsis ?? ""}
          placeholder="What happens, in one line."
          onCommit={(v) => onEditSynopsis(scene.anchor.ordinal, v)}
        />
      </section>

      <div className="insp__pair">
        <section className="insp__group">
          <div className="seclabel">Status</div>
          <PopupButton
            label="Scene status"
            options={statuses}
            value={scene.card.status}
            onChange={(v) => onSetCard(scene.id, { status: v })}
            menuWidth={150}
          />
        </section>
        <section className="insp__group">
          <div className="seclabel">Label</div>
          <LazyField
            label="Label"
            value={scene.card.label ?? ""}
            placeholder="Thread A"
            onCommit={(v) => onSetCard(scene.id, { label: v })}
          />
        </section>
      </div>

      <section className="insp__group">
        <div className="seclabel">Colour</div>
        {/* A radio group moves on arrows, with one Tab stop for the set —
            seven Tab stops in a row was a corridor, and ← → did nothing. */}
        <div
          className="insp__swatches"
          role="radiogroup"
          aria-label="Card colour"
          onKeyDown={(e) => {
            const step =
              e.key === "ArrowRight" || e.key === "ArrowDown"
                ? 1
                : e.key === "ArrowLeft" || e.key === "ArrowUp"
                  ? -1
                  : 0;
            if (!step) return;
            e.preventDefault();
            const at = Math.max(0, COLORS.findIndex((c) => c.id === scene.card.color));
            const next = COLORS[(at + step + COLORS.length) % COLORS.length];
            onSetCard(scene.id, { color: next.id });
            e.currentTarget
              .querySelector<HTMLButtonElement>(`[data-swatch="${next.id}"]`)
              ?.focus();
          }}
        >
          {COLORS.map((c, i) => {
            const on =
              scene.card.color === c.id ||
              (!COLORS.some((k) => k.id === scene.card.color) && i === 0);
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                data-swatch={c.id}
                aria-checked={scene.card.color === c.id}
                tabIndex={on ? 0 : -1}
                aria-label={c.name}
                title={c.name}
                className={`swatch swatch--${c.id}${scene.card.color === c.id ? " is-on" : ""}`}
                onClick={() => onSetCard(scene.id, { color: c.id })}
              />
            );
          })}
          {/* Colour is never the only carrier: the chosen hue says its name. */}
          <span className="insp__swatchname">
            {COLORS.find((c) => c.id === scene.card.color)?.name.toLowerCase()}
          </span>
        </div>
      </section>

      <section className="insp__group">
        <div className="seclabel">
          Board note <span className="insp__where">· never prints</span>
        </div>
        <LazyField
          label="Board note"
          area
          value={scene.card.boardNote ?? ""}
          placeholder="Thinking that is not in the script yet."
          onCommit={(v) => onSetCard(scene.id, { boardNote: v })}
        />
      </section>

      {speakers.length > 0 && (
        <section className="insp__group">
          <div className="seclabel">On stage</div>
          <div className="insp__capsules">
            {speakers.map((s) => (
              <Capsule key={s.name} kind="cast">
                {s.name} <span className="insp__count">{s.lines}</span>
              </Capsule>
            ))}
          </div>
        </section>
      )}

      <section className="insp__group">
        <div className="seclabel">Comments here</div>
        <div className="insp__row">
          <span>
            {commentCount} in this scene
            {todoCount > 0 ? ` · ${todoCount} to-do` : ""}
          </span>
          <button type="button" className="insp__link" onClick={onShowComments}>
            Show
          </button>
        </div>
      </section>

      {pendingChange && (
        <div className="insp__notice">
          <span className="insp__noticedot" />
          <span className="insp__noticetext">
            Changed somewhere else {pendingChange.when}.
          </span>
          <button type="button" className="insp__noticelink" onClick={onReviewChange}>
            Review
          </button>
        </div>
      )}

      <p className="insp__foot">The synopsis is part of the script. The rest is card metadata.</p>
    </div>
  );
}
