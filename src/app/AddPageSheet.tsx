// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Add a Page: the pages a script can have before it and after it, and what
 * each starts from (src/layout/scaffolds.ts;
 * docs/app/formatting/formats-and-layout.md#FMT-175).
 *
 * The pages are listed by where they go, Before the script and After the
 * script, each by its name, with a mark on one the play already has. Beside
 * the list stands the chosen page at a size that can be read: laid out by the
 * engine in the play's format with the play's details in its fields
 * (`scaffoldSheet`) and drawn by the export preview's own sheet, so the
 * picture is the page. Under it: what the page is for, where it will land
 * among the play's pages, and the switch that puts it on the other side of
 * the script.
 *
 * The choices are one set of radios: the arrows move between them and choose,
 * ⏎ adds the chosen page (the sheet's default), a double-click adds the page
 * clicked, and Esc is the sheet's. A play has one title page: chosen in a
 * play that has one, the sheet shows that page in place of making a second.
 *
 * The same sheet gives a page already in the play another template
 * (`change`, docs/app/formatting/formats-and-layout.md#FMT-178): it opens on
 * the template the page has, the picture is that page's own words as each
 * template would set them, and the line under it says what the page keeps.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { pageSizeIn, type FormatSpec } from "../format";
import type { FrontMatter, FrontPageSource } from "../fountain";
import { readPageFile } from "../layout";
import {
  SCAFFOLDS,
  SCAFFOLD_PLACES,
  landsAt,
  pageAlready,
  pageSheet,
  retemplate,
  scaffoldById,
  scaffoldOf,
  scaffoldSheet,
  sideOf,
  type ScaffoldId,
  type ScaffoldSide,
} from "../layout/scaffolds";
import { Button, Segmented, Sheet } from "../ui";
import { BlankSheet, FrontPreviewPage } from "./ExportPanel";
import { measurePxPerInch } from "./use-zoom";

/** The picture's width. Chrome, not layout: the sheet inside is scaled to it,
 * so the format still owns every proportion. */
const PICTURE_PX = 264;

const SIDES: { id: ScaffoldSide; label: string }[] = [
  { id: "front", label: "Before the script" },
  { id: "back", label: "After the script" },
];

export function AddPageSheet({
  spec,
  details,
  speakers,
  side,
  front,
  back,
  change,
  onAdd,
  onShow,
  onChange,
  onCancel,
}: {
  /** The play's format, which the picture is laid out in. */
  spec: FormatSpec;
  /** The play's front matter facts, which a page's fields show. */
  details: FrontMatter;
  /** The play's character names, in the order they first enter. */
  speakers: readonly string[];
  /** The side of the script the sheet was asked for from, when it was asked for from one. */
  side: ScaffoldSide | null;
  /** The play's pages before the script and after it, in their order. */
  front: readonly FrontPageSource[];
  back: readonly FrontPageSource[];
  /** A page of the play to give another template, in place of adding one. */
  change?: FrontPageSource | null;
  onAdd: (scaffoldId: ScaffoldId, side: ScaffoldSide) => void;
  /** Give the page named by `change` this template. */
  onChange?: (scaffoldId: ScaffoldId) => void;
  /** Show a page the play already has, where it prints. */
  onShow: (source: string) => void;
  onCancel: () => void;
}) {
  /** The play's pages but the one that is changing. */
  const others = useMemo(
    () => [...front, ...back].filter((page) => page.id !== change?.id),
    [front, back, change],
  );
  const has = useMemo(
    () => new Map(SCAFFOLDS.map((s) => [s.id, pageAlready(s, others)])),
    [others],
  );
  /** The template the changing page has now. */
  const current = useMemo(() => (change ? scaffoldOf(change).id : null), [change]);
  // The template the page has; or the first page the play does not have yet,
  // on the side it was asked for from.
  const [chosen, setChosen] = useState<ScaffoldId>(() => {
    if (current) return current;
    const wanted = SCAFFOLDS.filter((s) => (side ? sideOf(s) === side : true));
    return (wanted.find((s) => !has.get(s.id)) ?? wanted[0] ?? SCAFFOLDS[0]!).id;
  });
  const [where, setWhere] = useState<ScaffoldSide>(
    () => side ?? sideOf(scaffoldById(chosen) ?? SCAFFOLDS[0]!),
  );
  const id = useId();
  const choices = useRef<HTMLDivElement | null>(null);
  const scaffold = scaffoldById(chosen) ?? SCAFFOLDS[0]!;
  /** What a scaffold is told of the play. */
  const ctx = useMemo(
    () => ({ speakers, listed: !!details.contents?.length }),
    [speakers, details.contents],
  );
  /** The changing page as the chosen template would have it. */
  const changed = useMemo(
    () =>
      change
        ? retemplate(
            change,
            scaffold,
            ctx,
            others.map((page) => page.name),
          )
        : null,
    [change, scaffold, ctx, others],
  );
  // The picture: the page's own words in the template, when it has any.
  const sheet = useMemo(
    () =>
      change && changed?.kept
        ? pageSheet({ id: change.id, name: change.name, text: changed.text }, details, spec)
        : scaffoldSheet(scaffold, ctx, details, spec),
    [change, changed, scaffold, ctx, details, spec],
  );
  const scale = useMemo(() => PICTURE_PX / (pageSizeIn(spec).widthIn * measurePxPerInch()), [spec]);

  // Focus starts on the chosen page, so the arrows work from the first frame.
  useEffect(() => {
    choices.current
      ?.querySelector<HTMLInputElement>("input:checked")
      ?.focus({ preventScroll: true });
  }, []);

  const choose = (next: ScaffoldId) => {
    setChosen(next);
    const to = scaffoldById(next);
    // A page goes where it usually does; one that goes either way stays on
    // the side the writer last had in hand.
    if (to && to.place !== "either") setWhere(to.place);
  };

  const title = scaffold.id === "title-page";
  const already = has.get(scaffold.id) ?? null;
  const showInstead = !change && title && already ? already : null;
  const goesOn: ScaffoldSide = title ? "front" : where;
  /** A change that cannot be made: the template the page has, or a second title page. */
  const refused = change ? chosen === current || (title && !!already) : false;
  /** Where the page will stand among the play's pages, in words; or what a changing page keeps. */
  const lands = useMemo(() => {
    if (change && changed) {
      if (chosen === current) return "This page uses this template.";
      if (title && already) return "This play has a title page.";
      if (!changed.kept) return "The page has no words yet, so it starts as this template does.";
      return changed.name
        ? `Keeps its words, and is named ${changed.name}.`
        : "Keeps its words and its name.";
    }
    if (showInstead) return "This play has a title page.";
    if (goesOn === "back") {
      const last = back[back.length - 1];
      return last ? `Goes after ${last.name}, at the end.` : "Goes after the script's last page.";
    }
    const at = landsAt(
      scaffold.id,
      front.map((p) => ({ name: p.name, layout: readPageFile(p.text).layout })),
    );
    const before = front[at - 1];
    if (before) return `Goes after ${before.name}.`;
    return front.length ? "Goes first, before every other page." : "Goes before the script.";
  }, [
    change,
    changed,
    chosen,
    current,
    title,
    already,
    showInstead,
    goesOn,
    back,
    front,
    scaffold.id,
  ]);

  const act = () => {
    if (change) {
      if (!refused) onChange?.(scaffold.id);
      return;
    }
    if (showInstead) onShow(showInstead.id);
    else onAdd(scaffold.id, goesOn);
  };

  return (
    <Sheet
      title={change ? "Change Template" : "Add a Page"}
      subtitle={
        change
          ? `“${change.name}” keeps its words. It takes the template's heading and its place on the sheet.`
          : "A page before the script or after it. It prints with the play and is written where it prints."
      }
      width={736}
      onClose={onCancel}
      onDefault={act}
      footer={
        <>
          <span className="sheet__spacer" />
          <Button onClick={onCancel}>Cancel</Button>
          <Button treatment="primary" onClick={act} disabled={refused}>
            {change ? "Use Template" : showInstead ? "Show Title Page" : "Add Page"}
          </Button>
        </>
      }
    >
      <div className="addpage">
        <div className="addpage__list" ref={choices}>
          {SCAFFOLD_PLACES.map((place) => (
            <fieldset key={place.id} className="addpage__group">
              <legend className="addpage__legend seclabel">{place.label}</legend>
              {SCAFFOLDS.filter((s) => s.place === place.id).map((s) => {
                const on = s.id === chosen;
                const there = has.get(s.id);
                return (
                  <div key={s.id} className="addpage__choice">
                    {/* The radio lies under the row, the whole row's size: the
                        row is what a pointer, a finger and VoiceOver's cursor
                        find, and the radio draws its chosen and focused states. */}
                    <input
                      type="radio"
                      className="addpage__radio"
                      name={id}
                      value={s.id}
                      checked={on}
                      tabIndex={on ? 0 : -1}
                      aria-labelledby={`${id}-${s.id}-name`}
                      aria-describedby={`${there || s.id === current ? `${id}-${s.id}-has ` : ""}${id}-${s.id}-about`}
                      onChange={() => choose(s.id)}
                      onDoubleClick={() => {
                        if (change) {
                          if (s.id !== current && !(s.id === "title-page" && there))
                            onChange?.(s.id);
                        } else if (s.id === "title-page" && there) onShow(there.id);
                        else onAdd(s.id, s.id === chosen ? goesOn : sideOf(s));
                      }}
                    />
                    <span className="addpage__name" id={`${id}-${s.id}-name`} aria-hidden="true">
                      {s.name}
                    </span>
                    {(there || s.id === current) && (
                      <span className="addpage__has" id={`${id}-${s.id}-has`} aria-hidden="true">
                        {s.id === current ? "This page" : "In this play"}
                      </span>
                    )}
                    <span id={`${id}-${s.id}-about`} hidden>
                      {s.description}
                    </span>
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
        <div className="addpage__side">
          <div className="addpage__picture" aria-hidden="true">
            {sheet ? (
              <FrontPreviewPage page={sheet} spec={spec} scale={scale} />
            ) : (
              <BlankSheet spec={spec} scale={scale} />
            )}
          </div>
          <p className="addpage__about">{scaffold.description}</p>
          <p className="addpage__lands" role="status">
            {lands}
          </p>
          {!title && !change && (
            <Segmented
              size="small"
              label="Where the page goes"
              options={SIDES}
              value={where}
              onChange={setWhere}
            />
          )}
        </div>
      </div>
    </Sheet>
  );
}
