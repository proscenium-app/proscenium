// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The corkboard (docs/app/organizing/workspace-model.md#WORK-D2) — one index card per scene in
 * document order, grouped into act bands. Heading + synopsis are canonical in
 * the .fountain (synopsis edits write back the `=` line); color/status/label are
 * canonical in the play file. Dragging a card reorders the script on disk.
 *
 * **A card can now come first** (docs/app/organizing/workspace-model.md#WORK-31). The board used to be a lens that
 * could not create what it looked at: a card existed only because a scene
 * already did, which made the relationship between board and script genuinely
 * hard to read — you cannot sketch a play on a board that only reports one.
 * "New Scene" writes an empty scene into the .fountain and the card comes back
 * through the ordinary reconcile, so the board is still a lens; it just has a
 * pen now. Everything else about the contract is unchanged.
 */
import { useId, useState } from "react";
import { pageCountLabel, pageRangeLabel, type ScenePageMap, type ScenePages } from "../layout";
import type { SceneCard } from "./card-reconcile";
import { useFieldDraft } from "./field-draft";
import { useSceneStatusOptions } from "../app/settings/scene-statuses";
import type { Card } from "./play-file";
import { ArrowUpIcon, ArrowDownIcon, IconButton, announce, BoardIcon, PlusIcon, PopupButton, WarnIcon } from "../ui";


export interface CorkboardProps {
  cards: SceneCard[];
  onReorder: (from: number, to: number) => void;
  onSetCard: (sceneId: string, partial: Partial<Card>) => void;
  onEditSynopsis: (ordinal: number, text: string) => void;
  /** Write a new, empty scene into the script — the board's own "New Scene". */
  onAddScene?: () => void;
  /** Jump to this scene in the script editor. */
  onOpenScene: (ordinal: number) => void;
  /** Where each scene sits in the paginated script, and how long it runs. */
  scenePages?: ScenePageMap;
  /** Scenes touched by a change that arrived from outside. */
  changedScenes?: Set<number>;
}

export function CorkboardView({
  cards,
  onReorder,
  onSetCard,
  onEditSynopsis,
  onAddScene,
  onOpenScene,
  scenePages,
  changedScenes,
}: CorkboardProps) {
  const [dragOrd, setDragOrd] = useState<number | null>(null);
  const ordered = [...cards].sort((a, b) => a.anchor.ordinal - b.anchor.ordinal);
  const pagesFor = new Map((scenePages?.scenes ?? []).map((s) => [s.ordinal, s]));
  const actPages = new Map((scenePages?.acts ?? []).map((a) => [a.act, a]));

  if (ordered.length === 0) {
    return (
      <div className="board board--empty">
        <div className="emptysurface">
          <span className="emptysurface__glyph">
            <BoardIcon size={22} />
          </span>
          <p className="emptysurface__title">No scenes yet</p>
          <p className="emptysurface__body">
            A card is a scene: making one here writes it into the script, and
            typing <span className="mono">## Scene</span> there makes one here.
          </p>
          {onAddScene && (
            <button type="button" className="btn btn--primary" onClick={onAddScene}>
              New Scene
            </button>
          )}
        </div>
      </div>
    );
  }

  let lastAct: string | undefined;
  const rows: React.ReactNode[] = [];
  ordered.forEach((rec, index) => {
    if (rec.act !== lastAct) {
      lastAct = rec.act;
      if (lastAct) {
        const act = actPages.get(lastAct);
        rows.push(
          <h3 key={`act-${rec.id}`} className="board__act">
            {lastAct}
            {/* The act's length in pages, the unit the element bar counts in. A
                minute estimate sat beside it until it was dropped: a page is not a
                minute. */}
            {act && <span className="board__actlen">{pageCountLabel(act.pages)}</span>}
          </h3>,
        );
      }
    }
    rows.push(
      <SceneCard
        key={rec.id}
        rec={rec}
        position={index}
        isDragging={dragOrd === rec.anchor.ordinal}
        onDragStart={() => setDragOrd(rec.anchor.ordinal)}
        onDragEnd={() => setDragOrd(null)}
        onEarlier={index > 0 ? () => { onReorder(rec.anchor.ordinal, ordered[index - 1].anchor.ordinal); announce("Scene moved earlier"); } : undefined}
        onLater={index < ordered.length - 1 ? () => { onReorder(rec.anchor.ordinal, ordered[index + 1].anchor.ordinal); announce("Scene moved later"); } : undefined}
        onDropHere={() => {
          if (dragOrd !== null && dragOrd !== rec.anchor.ordinal) {
            onReorder(dragOrd, rec.anchor.ordinal);
          }
          setDragOrd(null);
        }}
        onSetCard={(p) => onSetCard(rec.id, p)}
        onEditSynopsis={(t) => onEditSynopsis(rec.anchor.ordinal, t)}
        onOpen={() => onOpenScene(rec.anchor.ordinal)}
        pages={pagesFor.get(rec.anchor.ordinal)}
        changed={changedScenes?.has(rec.anchor.ordinal) ?? false}
      />,
    );
  });

  // Last, and after the final act band, because a new scene lands at the end of
  // the play — the tile sits where the scene it makes will be.
  if (onAddScene) {
    rows.push(
      <button key="new-scene" type="button" className="card card--new" data-tutorial="new-scene" onClick={onAddScene}>
        <span className="card--new__glyph" aria-hidden="true">
          <PlusIcon size={16} />
        </span>
        New Scene
      </button>,
    );
  }

  return <div className="board">{rows}</div>;
}

interface CardProps {
  rec: SceneCard;
  /** Its place on the Board, which the guide points at by (docs/app/preferences-and-help/tutorials.md#TUT-D9). */
  position: number;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onEarlier?: () => void;
  onLater?: () => void;
  onDropHere: () => void;
  onSetCard: (partial: Partial<Card>) => void;
  onEditSynopsis: (text: string) => void;
  onOpen: () => void;
  pages?: ScenePages;
  changed: boolean;
}

function SceneCard({
  rec,
  position,
  isDragging,
  onDragStart,
  onDragEnd,
  onEarlier,
  onLater,
  onDropHere,
  onSetCard,
  onEditSynopsis,
  onOpen,
  pages,
  changed,
}: CardProps) {
  const headingId = useId();
  const statusOptions = useSceneStatusOptions(rec.card.status);
  const sceneName = `${rec.act ? `${rec.act} · ` : ""}${rec.heading || `Scene ${rec.anchor.ordinal + 1}`}`;
  const synopsis = useFieldDraft(rec.synopsis ?? "");
  const label = useFieldDraft(rec.card.label ?? "");
  // A board note that arrives from outside — another tool's, another device's —
  // shows here, unless the writer is typing in it (field-draft.ts).
  const note = useFieldDraft(rec.card.boardNote ?? "");


  return (
    <div
      className={`card card--${rec.card.color}${isDragging ? " is-dragging" : ""}${changed ? " is-changed" : ""}`}
      data-tutorial-card={position}
      role="group"
      aria-labelledby={headingId}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropHere();
      }}
    >
      <div className="card__head">
        <span className="card__drag" title="Drag to move scene" draggable onDragStart={(e) => { onDragStart(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", rec.id); }} onDragEnd={onDragEnd}><span aria-hidden="true">⠿</span></span>
        <button
          id={headingId}
          className="card__heading"
          title="Open this scene in the script"
          onClick={onOpen}
        >
          {rec.act && <span className="sr-only">{rec.act} · </span>}
          {rec.heading || `Scene ${rec.anchor.ordinal + 1}`}
        </button>
        {/* Length, so the board can answer the pacing question it exists for. */}
        {pages && (
          <span
            className="card__pages"
            title={`This scene runs ${pages.pages} page${pages.pages === 1 ? "" : "s"}`}
          >
            {pageRangeLabel(pages)}
          </span>
        )}
      </div>

      <textarea
        aria-label={`Summary — ${sceneName}`}
        className="card__synopsis"
        data-tutorial="scene-summary"
        value={synopsis.draft}
        placeholder="What happens in this scene?"
        onChange={(e) => synopsis.change(e.target.value)}
        onBlur={() => {
          const next = synopsis.take();
          if (next !== null) onEditSynopsis(next);
        }}
      />

      {/* Thinking about the scene that is NOT in the script yet — the synopsis
          above is Fountain (a `=` line, canonical in the .fountain), this is
          canonical in the play file and belongs to the board. It has been in the
          schema from the start with nowhere on screen to read it, so a note
          left here by anything else was one the writer could never see. */}
      <details className="card__details">
        <summary>Details{note.draft || label.draft ? " · Notes & label" : ""}</summary>
        <textarea
          aria-label={`Notes — ${sceneName}`}
          className="card__note"
          value={note.draft}
          rows={2}
          placeholder="Notes to yourself about this scene…"
          onChange={(e) => note.change(e.target.value)}
          onBlur={() => {
            const next = note.take();
            if (next !== null) onSetCard({ boardNote: next });
          }}
        />


      {/* The swatch row left the card (docs/engineering/design-system.md#UI-D103). Seven circles on every card is
          seven decisions the writer is not making, and the hue lives one click
          away in the inspector's Scene tab beside the rest of this card's data.
          What stays is the hue itself, as the 3px rule along the card's top. */}
      <input aria-label={`Label — ${sceneName}`} className="card__label" value={label.draft} placeholder="Label" onChange={(e) => label.change(e.target.value)} onBlur={() => { const next = label.take(); if (next !== null) onSetCard({ label: next }); }} />
      </details>
      <div className="card__foot">
        <PopupButton
          size="mini"
          label={`Scene status — ${sceneName}`}
          options={statusOptions}
          value={rec.card.status}
          onChange={(v) => onSetCard({ status: v })}
          menuWidth={150}
        />
        {changed && (
          <span className="card__changed" title="Changed from outside the app — see Changes">
            <WarnIcon size={10} />
            changed
          </span>
        )}
        <span className="card__footspacer" />
        <IconButton data-tutorial={onEarlier ? "scene-move" : undefined} label={`Move earlier — ${sceneName}`} disabled={!onEarlier} onClick={onEarlier}><ArrowUpIcon size={13} /></IconButton>
        <IconButton label={`Move later — ${sceneName}`} disabled={!onLater} onClick={onLater}><ArrowDownIcon size={13} /></IconButton>
      </div>
    </div>
  );
}
