// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The corkboard (docs/app/organizing/workspace-model.md#WORK-D2) — one index card per scene in
 * document order, grouped by act. Heading + synopsis are canonical in the
 * .fountain (synopsis edits write back the `=` line); the color and the note
 * are canonical in the play file. Dragging a card reorders the script on disk.
 *
 * **A card can now come first** (docs/app/organizing/workspace-model.md#WORK-31). The board used to be a lens that
 * could not create what it looked at: a card existed only because a scene
 * already did, which made the relationship between board and script genuinely
 * hard to read — you cannot sketch a play on a board that only reports one.
 * "New Scene" writes an empty scene into the .fountain and the card comes back
 * through the ordinary reconcile, so the board is still a lens; it just has a
 * pen now. Everything else about the contract is unchanged.
 *
 * **A card holds what a writer uses on one** (docs/app/organizing/workspace-model.md#WORK-85):
 * the heading, the summary, a note and a color, each changed on the card
 * itself. A status menu, a label field and a "changed" chip sat here too, and
 * none of them answered a question the writer was asking of the board.
 *
 * **The scenes run across or down** (docs/app/organizing/workspace-model.md#WORK-86).
 * Across, an act is a band and its scenes wrap left to right under it; down,
 * an act is a column and its scenes stack under its name, the acts side by
 * side. The DOM is the same both ways — act, then its cards, in script order —
 * so the order a screen reader and Tab follow is the play's either way, and
 * only the stylesheet turns it.
 */
import { useId, useState } from "react";
import { pageCountLabel, pageRangeLabel, type ScenePageMap, type ScenePages } from "../layout";
import type { SceneCard } from "./card-reconcile";
import { colorOptions } from "./card-colors";
import { useFieldDraft } from "./field-draft";
import type { Card, CardColor } from "./play-file";
import {
  ArrowUpIcon,
  ArrowDownIcon,
  IconButton,
  announce,
  BoardIcon,
  PlusIcon,
  PopupButton,
  Segmented,
} from "../ui";

/** Which way the board runs, a view preference kept app-wide like the outline's. */
export type BoardFlow = "across" | "down";
const FLOW_KEY = "proscenium:boardFlow";

function readFlow(): BoardFlow {
  try {
    return localStorage.getItem(FLOW_KEY) === "down" ? "down" : "across";
  } catch {
    return "across";
  }
}

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
}

export function CorkboardView({
  cards,
  onReorder,
  onSetCard,
  onEditSynopsis,
  onAddScene,
  onOpenScene,
  scenePages,
}: CorkboardProps) {
  const [dragOrd, setDragOrd] = useState<number | null>(null);
  const [flow, setFlowState] = useState<BoardFlow>(readFlow);
  const setFlow = (next: BoardFlow) => {
    setFlowState(next);
    try {
      localStorage.setItem(FLOW_KEY, next);
    } catch {
      /* a preference that won't persist still works this session */
    }
  };
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
            A card is a scene: making one here writes it into the script, and typing{" "}
            <span className="mono">## Scene</span> there makes one here.
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

  // Runs of scenes in one act, in script order. Scenes before the first act
  // (or in a play with none) are a run with no name.
  const groups: { act: string | undefined; key: string; items: SceneCard[] }[] = [];
  for (const rec of ordered) {
    const last = groups[groups.length - 1];
    if (last && last.act === rec.act) last.items.push(rec);
    else groups.push({ act: rec.act, key: rec.id, items: [rec] });
  }

  let index = -1;
  const lanes = groups.map((group, g) => {
    const act = group.act ? actPages.get(group.act) : undefined;
    return (
      <section key={group.key} className="board__lane">
        {group.act && (
          <h3 className="board__act">
            {group.act}
            {/* The act's length in pages, the unit the element bar counts in. A
              minute estimate sat beside it until it was dropped: a page is not a
              minute. */}
            {act && <span className="board__actlen">{pageCountLabel(act.pages)}</span>}
          </h3>
        )}
        <div className="board__cards">
          {group.items.map((rec) => {
            index += 1;
            const at = index;
            return (
              <SceneCard
                key={rec.id}
                rec={rec}
                position={at}
                isDragging={dragOrd === rec.anchor.ordinal}
                onDragStart={() => setDragOrd(rec.anchor.ordinal)}
                onDragEnd={() => setDragOrd(null)}
                onEarlier={
                  at > 0
                    ? () => {
                        onReorder(rec.anchor.ordinal, ordered[at - 1].anchor.ordinal);
                        announce("Scene moved earlier");
                      }
                    : undefined
                }
                onLater={
                  at < ordered.length - 1
                    ? () => {
                        onReorder(rec.anchor.ordinal, ordered[at + 1].anchor.ordinal);
                        announce("Scene moved later");
                      }
                    : undefined
                }
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
              />
            );
          })}
          {/* Last, in the last act, because a new scene lands at the end of the
            play — the tile sits where the scene it makes will be. */}
          {onAddScene && g === groups.length - 1 && (
            <button
              type="button"
              className="card card--new"
              data-tutorial="new-scene"
              onClick={onAddScene}
            >
              <span className="card--new__glyph" aria-hidden="true">
                <PlusIcon size={16} />
              </span>
              New Scene
            </button>
          )}
        </div>
      </section>
    );
  });

  return (
    <div className={`board board--${flow}`}>
      <div className="board__bar">
        <Segmented<BoardFlow>
          label="Arrange scenes"
          size="small"
          options={[
            { id: "across", label: "Across", title: "Each act a row, its scenes left to right" },
            { id: "down", label: "Down", title: "Each act a column, its scenes top to bottom" },
          ]}
          value={flow}
          onChange={setFlow}
        />
      </div>
      <div className="board__lanes">{lanes}</div>
    </div>
  );
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
}: CardProps) {
  const headingId = useId();
  const sceneName = `${rec.act ? `${rec.act} · ` : ""}${rec.heading || `Scene ${rec.anchor.ordinal + 1}`}`;
  const synopsis = useFieldDraft(rec.synopsis ?? "");
  // A board note that arrives from outside — another tool's, another device's —
  // shows here, unless the writer is typing in it (field-draft.ts).
  const note = useFieldDraft(rec.card.boardNote ?? "");
  // Open when there is a note to read; a card with none keeps it folded.
  const [notesOpen, setNotesOpen] = useState(() => (rec.card.boardNote ?? "") !== "");

  return (
    <div
      className={`card card--${rec.card.color}${isDragging ? " is-dragging" : ""}`}
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
        <span
          className="card__drag"
          title="Drag to move scene"
          draggable
          onDragStart={(e) => {
            onDragStart();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", rec.id);
          }}
          onDragEnd={onDragEnd}
        >
          <span aria-hidden="true">⠿</span>
        </span>
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
          canonical in the play file and belongs to the board. */}
      <details
        className="card__details"
        open={notesOpen}
        onToggle={(e) => setNotesOpen(e.currentTarget.open)}
      >
        <summary>Notes</summary>
        <textarea
          aria-label={`Notes — ${sceneName}`}
          className="card__note"
          value={note.draft}
          rows={3}
          placeholder="Notes to yourself about this scene…"
          onChange={(e) => note.change(e.target.value)}
          onBlur={() => {
            const next = note.take();
            if (next !== null) onSetCard({ boardNote: next });
          }}
        />
      </details>
      <div className="card__foot">
        {/* The color is chosen where it shows (docs/app/organizing/workspace-model.md#WORK-85):
            it lived only in the inspector's Scene tab, so the hue along the
            card's top was a mark the writer could see and not find the way to
            change. The menu says each color's name as well as showing it. */}
        <PopupButton<CardColor>
          size="mini"
          label={`Color — ${sceneName}`}
          options={colorOptions()}
          value={rec.card.color}
          onChange={(color) => onSetCard({ color })}
          menuWidth={150}
        />
        <span className="card__footspacer" />
        <IconButton
          data-tutorial={onEarlier ? "scene-move" : undefined}
          label={`Move earlier — ${sceneName}`}
          disabled={!onEarlier}
          onClick={onEarlier}
        >
          <ArrowUpIcon size={13} />
        </IconButton>
        <IconButton label={`Move later — ${sceneName}`} disabled={!onLater} onClick={onLater}>
          <ArrowDownIcon size={13} />
        </IconButton>
      </div>
    </div>
  );
}
