// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cast — a real, top-level view (peer to Script / Board / Outline): the
 * company, as the script and the pages before it have it
 * (docs/app/formatting/formats-and-layout.md#FMT-170).
 *
 * It edits no page. The play's front and back matter are written where they
 * print, in the script's page view (docs/app/formatting/formats-and-layout.md#FMT-169);
 * Cast reads them. A speaker who says something in the script is in the
 * company without anyone pressing a button, and each row says which page
 * names them, as a way to that page. One who speaks and is named on no page is offered two things:
 * Add to Characters Page, which writes one paragraph on the page that names
 * most of the cast (the one thing Cast ever writes on a page, and only when
 * asked), or Leave Off, which the play file keeps (`castHidden`) so a list
 * of letters or a voice is never asked about again.
 *
 * Three homes, unchanged (storage rule 3):
 *   - what the company reads as → the pages before the script
 *   - deep-dive notes           → the Characters/<Name>.md sheet
 *   - appearances and weight    → derived from the script (read-only)
 * Plus the speakers deliberately kept off the pages, in the play file.
 */
import { useId, useMemo } from "react";
import type { FrontPageSource } from "../fountain";
import { castSheetFor } from "../materials";
import { namedOnPage, namesOnPages } from "../layout";
import {
  type BinderItem,
  type CharacterWeight,
  type SceneAppearance,
  type SceneCard,
} from "../workspace";
import { PresenceGrid } from "./PresenceGrid";
import { Button } from "../ui";

export interface CastViewProps {
  /** The play's pages before and after the script, as the page view draws them: what Cast reads names from. */
  pages: readonly FrontPageSource[];
  /** Show a page where it prints, the caret in it: what a row's page name does. */
  onOpenPage?: (source: string) => void;
  appearances: Map<string, SceneAppearance[]>;
  weights: Map<string, CharacterWeight>;
  /** Scenes in the play — the denominator for "appears throughout". */
  sceneCount: number;
  /** Speakers the writer chose to leave off the pages. */
  hidden: string[];
  binder: BinderItem[];
  onOpenSheet: (item: BinderItem) => void;
  onCreateSheet: (name: string) => void;
  /** Leave a speaker off the pages for good: they are not offered again. */
  onHide: (name: string) => void;
  onUnhide: (name: string) => void;
  /** Write the name on the Characters page, as a paragraph of its own. */
  onAddToPage: (name: string) => void;
  /** Scene records, for the presence grid's columns. */
  cards: SceneCard[];
  /** Jump to a scene from a grid column heading. */
  onOpenScene?: (ordinal: number) => void;
  /** Open the export dialog on this character's sides. */
  onExportSides?: (name: string) => void;
}

/** "12 lines · 3 scenes" — the evidence behind a row's tier, in plain words. */
function weightSummary(w: CharacterWeight | undefined): string | null {
  if (!w || w.cues === 0) return null;
  const lines = `${w.lines} ${w.lines === 1 ? "line" : "lines"}`;
  const scenes = `${w.scenes} ${w.scenes === 1 ? "scene" : "scenes"}`;
  return `${lines} · ${scenes}`;
}

/**
 * The company in order: the names a page lists, as it lists them, then
 * everyone else who speaks, in the order they first speak.
 */
export function companyOf(
  pages: readonly FrontPageSource[],
  appearances: Map<string, SceneAppearance[]>,
  weights: Map<string, CharacterWeight>,
): string[] {
  const names = namesOnPages(pages);
  const seen = new Set(names);
  for (const name of appearances.keys()) {
    const key = name.trim().toUpperCase();
    if (!key || seen.has(key) || (weights.get(key)?.cues ?? 0) === 0) continue;
    seen.add(key);
    names.push(key);
  }
  return names;
}

export function CastView(props: CastViewProps) {
  const castId = useId();
  const company = useMemo(
    () => companyOf(props.pages, props.appearances, props.weights),
    [props.pages, props.appearances, props.weights],
  );
  const hidden = useMemo(
    () => new Set(props.hidden.map((name) => name.trim().toUpperCase())),
    [props.hidden],
  );
  const appearanceFor = (name: string): SceneAppearance[] =>
    props.appearances.get(name.trim().toUpperCase()) ?? [];
  /** The first row that offers Add to Characters Page: where the guide points (lesson 4). */
  const firstOffer = company.find(
    (name) => !props.pages.some((page) => namedOnPage(name, page.text)),
  );

  return (
    <div className="castview">
      <div className="castview__inner">
        <header className="castview__head">
          <h1 className="castview__title">Cast</h1>
          <p className="castview__sub">
            Who speaks, where, and which page of the play names them. Those pages are written in the
            script’s page view, where they print.
          </p>
        </header>
        {company.length === 0 && (
          <p className="castview__empty">
            No characters yet — write a cue in the script and they’ll appear here.
          </p>
        )}

        <section className="castgroup">
          <div className="castview__list">
            {company.map((name, i) => {
              const headingId = `${castId}-${i}`;
              const weight = props.weights.get(name);
              const appearances = appearanceFor(name);
              const speaks = (weight?.cues ?? 0) > 0;
              const page = props.pages.find((p) => namedOnPage(name, p.text));
              const named = !!page;
              const leftOff = !named && hidden.has(name);
              // "On the Characters page", and "On the Title Page" for a page named as one.
              const onPage = page
                ? `On the ${page.name}${/\bpage$/i.test(page.name.trim()) ? "" : " page"}`
                : "";
              // Only a sheet in the Characters folder is this character's
              // (docs/app/organizing/workspace-model.md#WORK-84): one filed
              // away with an old draft is not opened as the current one.
              const sheet = castSheetFor(props.binder, name);
              const summary = weightSummary(weight);
              return (
                <div className="castcard" key={name} role="group" aria-labelledby={headingId}>
                  <div className="castcard__fields">
                    <span className="castcard__name castcard__name--read" id={headingId}>
                      {name}
                    </span>
                    {page && props.onOpenPage ? (
                      <button
                        type="button"
                        className="castcard__onpage castcard__onpage--link"
                        data-on-page="yes"
                        title="Show this page in the script, where it prints"
                        onClick={() => props.onOpenPage?.(page.id)}
                      >
                        {onPage}
                      </button>
                    ) : (
                      <span className="castcard__onpage" data-on-page={named ? "yes" : "no"}>
                        {named ? onPage : leftOff ? "Left off the pages" : "Not on a page"}
                      </span>
                    )}
                  </div>
                  <div className="castcard__meta">
                    {summary && <span className="castcard__weight">{summary}</span>}
                    <span className="castcard__appears">
                      {appearances.length
                        ? `Appears in ${appearances.map((a) => a.label).join(", ")}`
                        : "Not in the script yet"}
                    </span>
                    {!named && (
                      <Button
                        size="small"
                        data-tutorial={name === firstOffer ? "add-to-page" : undefined}
                        onClick={() => {
                          if (leftOff) props.onUnhide(name);
                          props.onAddToPage(name);
                        }}
                      >
                        Add to Characters Page
                      </Button>
                    )}
                    {!named && !leftOff && speaks && (
                      <Button
                        size="small"
                        treatment="borderless"
                        onClick={() => props.onHide(name)}
                      >
                        Leave Off
                      </Button>
                    )}
                    {(weight?.lines ?? 0) > 0 && props.onExportSides && (
                      <button
                        type="button"
                        className="castcard__notes"
                        title="Export this character's part — speeches with their cue lines"
                        onClick={() => props.onExportSides!(name)}
                      >
                        Sides (PDF) ↗
                      </button>
                    )}
                    {sheet ? (
                      <button
                        type="button"
                        className="castcard__notes"
                        onClick={() => props.onOpenSheet(sheet)}
                      >
                        Open notes ↗
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="castcard__notes castcard__notes--new"
                        onClick={() => props.onCreateSheet(name)}
                      >
                        Add Notes
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* The same company, seen as distribution rather than as a list. */}
        <PresenceGrid
          names={company}
          appearances={props.appearances}
          cards={props.cards}
          onOpenScene={props.onOpenScene}
        />
      </div>
    </div>
  );
}
