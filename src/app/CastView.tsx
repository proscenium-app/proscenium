// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Cast surface — a real, top-level view (peer to Script / Board / Outline).
 *
 * The list fills itself. A speaker who says something in the script is a
 * character, so they appear here without anyone pressing a button; what the
 * writer can reorder and describe them. The printed Characters page is an
 * independent prose document once edited; no role receives a rank.
 *
 * Three homes, unchanged (storage rule 3):
 *   - name + short description → the fountain title page (prints on the cast page)
 *   - deep-dive notes           → the characters/<slug>.md sheet
 *   - appearances and weight    → derived from the script (read-only)
 * Plus one thing the script cannot express: a speaker deliberately kept OFF the
 * cast page, which lives in the play file so auto-add never undoes a removal.
 *
 * Edits auto-save on blur, matching the Board/Outline surfaces (no Save button).
 */
import { useId, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CharacterEntry } from "../fountain";
import {
  titleOf,
  type BinderItem,
  type CharacterWeight,
  type SceneAppearance,
  type SceneCard,
} from "../workspace";
import { PresenceGrid } from "./PresenceGrid";
import { FrontPageEditor, charactersPageText } from "./FrontPageEditor";
import {
  Button,
  CloseIcon,
  PlusIcon,
  IconButton,
  ArrowUpIcon,
  ArrowDownIcon,
  announce,
} from "../ui";

export interface CastViewProps {
  characters: CharacterEntry[];
  printedPage?: string;
  onSavePage: (text: string | undefined) => void;
  appearances: Map<string, SceneAppearance[]>;
  weights: Map<string, CharacterWeight>;
  /** Scenes in the play — the denominator for "appears throughout". */
  sceneCount: number;
  /** Speakers kept off the cast page despite speaking. */
  hidden: string[];
  binder: BinderItem[];
  /** A key that changes when the play/script changes, to re-seed local rows. */
  scriptKey: string | null;
  onSave: (entries: CharacterEntry[]) => void;
  onOpenSheet: (item: BinderItem) => void;
  onCreateSheet: (name: string) => void;
  /** Remove from the cast page for good (a speaking name would otherwise return). */
  onHide: (name: string) => void;
  onUnhide: (name: string) => void;
  /** Scene records, for the presence grid's columns. */
  cards: SceneCard[];
  /** Jump to a scene from a grid column heading. */
  onOpenScene?: (ordinal: number) => void;
  /** Open the export dialog on this character's sides. */
  onExportSides?: (name: string) => void;
}

function findSheet(binder: BinderItem[], name: string): BinderItem | null {
  const target = name.trim().toUpperCase();
  if (!target) return null;
  const walk = (items: BinderItem[]): BinderItem | null => {
    for (const it of items) {
      if (it.type === "character" && titleOf(it).trim().toUpperCase() === target) return it;
      if (it.children) {
        const found = walk(it.children);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(binder);
}

/** "12 lines · 3 scenes" — the evidence behind a row's tier, in plain words. */
function weightSummary(w: CharacterWeight | undefined): string | null {
  if (!w || w.cues === 0) return null;
  const lines = `${w.lines} ${w.lines === 1 ? "line" : "lines"}`;
  const scenes = `${w.scenes} ${w.scenes === 1 ? "scene" : "scenes"}`;
  return `${lines} · ${scenes}`;
}

export function CastView(props: CastViewProps) {
  // Local working copy, re-seeded when the play changes (so switching plays or
  // an external edit is picked up on (re)mount of this surface). A ref
  // mirrors the rows so save-on-blur never depends on a stale render closure.
  const [rows, setRows] = useState<CharacterEntry[]>(() => props.characters.map((c) => ({ ...c })));
  const rowsRef = useRef(rows);
  const apply = (next: CharacterEntry[]) => {
    rowsRef.current = next;
    setRows(next);
  };
  const { onSave } = props;
  const save = useRef(onSave);
  save.current = onSave;
  /** Something was typed or removed here since the last save. */
  const dirty = useRef(false);

  useEffect(() => {
    dirty.current = false;
    apply(props.characters.map((c) => ({ ...c })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scriptKey]);

  // The cast as the script now has it. Clean, the rows follow it whole — a
  // description changed outside shows here, instead of the stale one being
  // saved back over it at the next blur. Mid-edit, only new
  // names are added — never a row being typed into overwritten.
  useEffect(() => {
    if (!dirty.current) {
      apply(props.characters.map((c) => ({ ...c })));
      return;
    }
    const known = new Set(rowsRef.current.map((r) => r.name.trim().toUpperCase()));
    const fresh = props.characters.filter((c) => !known.has(c.name.trim().toUpperCase()));
    if (fresh.length) apply([...rowsRef.current, ...fresh.map((c) => ({ ...c }))]);
  }, [props.characters]);

  // Persist the printed cast list (name + description) from the live ref —
  // only when something here changed. An untouched field losing focus is not
  // an edit, and saving it could overwrite a change made outside.
  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    save.current(
      rowsRef.current
        .map((r) => ({ name: r.name.trim(), description: r.description?.trim() || undefined }))
        .filter((r) => r.name),
    );
  };

  /**
   * Removing a row is two things at once: drop it from the printed list, and —
   * if the name actually speaks — record that the omission was deliberate.
   * Otherwise the next save would auto-add it straight back.
   */
  const removeRow = (i: number) => {
    const name = rowsRef.current[i]?.name.trim() ?? "";
    const next = rowsRef.current.filter((_, j) => j !== i);
    dirty.current = true;
    apply(next);
    commit();
    if (name && (props.weights.get(name.toUpperCase())?.cues ?? 0) > 0) props.onHide(name);
  };

  const [focusRow, setFocusRow] = useState<number | null>(null);
  const names = useRef<(HTMLInputElement | null)[]>([]);
  useLayoutEffect(() => {
    if (focusRow !== null) {
      names.current[focusRow]?.focus();
      setFocusRow(null);
    }
  }, [focusRow, rows]);
  const addRow = () => {
    dirty.current = true;
    setFocusRow(rowsRef.current.length);
    apply([...rowsRef.current, { name: "" }]);
  };
  const moveRow = (from: number, to: number) => {
    if (to < 0 || to >= rowsRef.current.length) return;
    const next = [...rowsRef.current];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    dirty.current = true;
    apply(next);
    commit();
    setFocusRow(to);
    announce(`Moved “${row.name}” to ${to + 1}.`);
  };

  const castId = useId();

  const groups = [{ tier: "cast", indices: rows.map((_, i) => i) }];
  const appearanceFor = (name: string): SceneAppearance[] =>
    props.appearances.get(name.trim().toUpperCase()) ?? [];

  return (
    <div className="castview">
      <div className="castview__inner">
        <header className="castview__head">
          <h1 className="castview__title">Characters Page</h1>
          <p className="castview__sub">
            Edit the page your readers will see. Cast tools and private notes are below.
          </p>
        </header>

        <div data-tutorial="characters-page">
          <FrontPageEditor
            label="Printed characters page"
            value={props.printedPage ?? charactersPageText(props.characters)}
            onChange={props.onSavePage}
          />
        </div>
        <details className="castview__page-options">
          <summary>Page Options</summary>
          <Button size="small" onClick={() => props.onSavePage(undefined)}>
            Use Cast List Automatically
          </Button>
          <Button
            size="small"
            onClick={() =>
              props.onSavePage(charactersPageText(rowsRef.current.filter((r) => r.name.trim())))
            }
          >
            Replace Page from Cast List
          </Button>
          <p className="settings__note">
            Replacing uses the names and descriptions below. Changes to the cast list do not change
            a page you have edited.
          </p>
        </details>
        <header className="castview__head">
          <h2 className="castview__title">Cast Tools</h2>
          <p className="castview__sub">Names, private notes, appearances and sides.</p>
        </header>
        {rows.length === 0 && (
          <p className="castview__empty">
            No characters yet — write a cue in the script and they'll appear here.
          </p>
        )}

        {groups.map((group) => (
          <section className="castgroup" key={group.tier}>
            <div className="castview__list">
              {group.indices.map((i) => {
                const row = rows[i]!;
                const characterName = row.name.trim() || `New character ${i + 1}`;
                const headingId = `${castId}-${i}`;
                const weight = props.weights.get(row.name.trim().toUpperCase());
                const appearances = appearanceFor(row.name);
                const sheet = findSheet(props.binder, row.name);
                const setField = (patch: Partial<CharacterEntry>) => {
                  dirty.current = true;
                  apply(rowsRef.current.map((r, j) => (j === i ? { ...r, ...patch } : r)));
                };
                const summary = weightSummary(weight);
                return (
                  <div className="castcard" key={i} role="group" aria-labelledby={headingId}>
                    <span className="sr-only" id={headingId}>
                      {characterName}
                    </span>
                    <div className="castcard__fields">
                      <input
                        ref={(el) => {
                          names.current[i] = el;
                        }}
                        data-tutorial="character-name"
                        aria-label={`Name — ${characterName}`}
                        className="castcard__name"
                        value={row.name}
                        placeholder="NAME"
                        onChange={(e) => setField({ name: e.target.value })}
                        onBlur={commit}
                      />
                      <input
                        aria-label={`Description — ${characterName}`}
                        className="castcard__desc"
                        value={row.description ?? ""}
                        placeholder="Short description"
                        onChange={(e) => setField({ description: e.target.value })}
                        onBlur={commit}
                      />
                      <button
                        className="castcard__remove"
                        title={
                          (weight?.cues ?? 0) > 0
                            ? "Remove from the cast list (they will not be added again automatically)"
                            : "Remove from cast list"
                        }
                        aria-label={`Remove ${row.name || "character"}`}
                        onClick={() => removeRow(i)}
                      >
                        <CloseIcon size={11} />
                      </button>
                    </div>
                    <div className="castcard__meta">
                      <IconButton
                        label={`Move ${characterName} up`}
                        disabled={i === 0}
                        onClick={() => moveRow(i, i - 1)}
                      >
                        <ArrowUpIcon size={12} />
                      </IconButton>
                      <IconButton
                        label={`Move ${characterName} down`}
                        disabled={i === rows.length - 1}
                        onClick={() => moveRow(i, i + 1)}
                      >
                        <ArrowDownIcon size={12} />
                      </IconButton>
                      {summary && <span className="castcard__weight">{summary}</span>}
                      <span className="castcard__appears">
                        {appearances.length
                          ? `Appears in ${appearances.map((a) => a.label).join(", ")}`
                          : "Not in the script yet"}
                      </span>
                      {row.name.trim() && (weight?.lines ?? 0) > 0 && props.onExportSides && (
                        <button
                          className="castcard__notes"
                          title="Export this character's part — speeches with their cue lines"
                          onClick={() => props.onExportSides!(row.name.trim().toUpperCase())}
                        >
                          Sides (PDF) ↗
                        </button>
                      )}
                      {row.name.trim() &&
                        (sheet ? (
                          <button
                            className="castcard__notes"
                            onClick={() => props.onOpenSheet(sheet)}
                          >
                            Open notes ↗
                          </button>
                        ) : (
                          <button
                            className="castcard__notes castcard__notes--new"
                            onClick={() => props.onCreateSheet(row.name.trim())}
                          >
                            Add Notes
                          </button>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {props.hidden.length > 0 && (
          <section className="castgroup castgroup--hidden">
            <h2 className="castgroup__head" title="Speakers removed from the cast list">
              Removed from the cast list
              <span className="castgroup__count">{props.hidden.length}</span>
            </h2>
            <div className="casthidden">
              {props.hidden.map((name) => (
                <button
                  key={name}
                  className="casthidden__chip"
                  title="Put them back on the cast page"
                  onClick={() => props.onUnhide(name)}
                >
                  {name} <span aria-hidden="true">+</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="castview__adders">
          <Button
            size="small"
            treatment="borderless"
            data-tutorial="add-character"
            onClick={addRow}
          >
            <PlusIcon size={11} />
            Add Character
          </Button>
          <span className="sheet__spacer" />
        </div>

        {/* The same company, seen as distribution rather than as a list. */}
        <PresenceGrid
          names={rows.map((r) => r.name)}
          appearances={props.appearances}
          cards={props.cards}
          onOpenScene={props.onOpenScene}
        />
      </div>
    </div>
  );
}
