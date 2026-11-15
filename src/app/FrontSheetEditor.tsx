// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page before the script, edited where it stands in the script's page view
 * (docs/app/formatting/formats-and-layout.md#FMT-165): the Characters page, the
 * opening notes or the production notes, in the same prose editor as Cast and
 * Opening Pages, on the sheet the page prints on, its formatting bar at the
 * top of the script where the element bar stands. What is typed is saved as it
 * is typed, the way Cast saves the Characters page; Done, Esc or a click into
 * the script lays the page out again.
 */
import { useState, type KeyboardEvent } from "react";
import type { FrontMatter } from "../fountain";
import type { FrontEditKind } from "../editor";
import { openingParagraphs } from "../layout";
import { Button } from "../ui";
import {
  FrontPageEditor,
  charactersPageText,
  notesBlock,
  openingNotesText,
  printsProse,
} from "./FrontPageEditor";

const LABEL: Record<FrontEditKind, string> = {
  characters: "Characters Page",
  setting: "Opening Notes",
  production: "Production Notes",
};
/** The text's own name, as Opening Pages names its editors. */
const TEXT_LABEL: Record<FrontEditKind, string> = {
  characters: "Characters page text",
  setting: "Opening notes text",
  production: "Production notes text",
};

/** The page's text as its editor opens on it. */
export function frontPageText(kind: FrontEditKind, fm: FrontMatter): string {
  if (kind === "characters") return fm.charactersPage ?? charactersPageText(fm.characters ?? []);
  if (kind === "setting") return openingNotesText(fm);
  return fm.productionNotes ?? "";
}

/** The front matter with the page's new text in it. */
export function frontPagePatch(kind: FrontEditKind, text: string): Partial<FrontMatter> {
  if (kind === "characters") return { charactersPage: text };
  // Written once, the opening notes are the page's text, and the old
  // Setting, Time and Place fields that seeded it go, as Opening Pages' Save does.
  if (kind === "setting")
    return { openingNotes: text, setting: undefined, time: undefined, place: undefined };
  // Notes with no word to print are no page, and no line in the script.
  return { productionNotes: printsProse(text) ? text : undefined };
}

/** The paragraph a double-click on the printed page asks for, as the editor's block. */
export function blockAt(
  kind: FrontEditKind,
  at: string | null,
  text: string,
  fm: FrontMatter,
): number {
  if (kind !== "characters") return notesBlock(kind, at, text, fm);
  // An edited page's lines are named by their place among its printed
  // paragraphs, and a list prints a paragraph for each item while the editor
  // holds it as one block: the block is the paragraph's own, as on the notes
  // pages (notesBlock). Read as the place, a line under a list opened the
  // editor that many blocks too far down.
  const prose = /^characters-prose-(\d+)$/.exec(at ?? "");
  if (prose) return openingParagraphs(text)[Number(prose[1])]?.block ?? 0;
  // A page made from the cast list: its heading, then one paragraph each.
  const cast = /^cast-(\d+)$/.exec(at ?? "");
  return cast && fm.charactersPage === undefined ? Number(cast[1]) + 1 : 0;
}

export function FrontSheetEditor({
  kind,
  at,
  frontMatter,
  onPatch,
  onDone,
  bar,
}: {
  kind: FrontEditKind;
  at: string | null;
  frontMatter: FrontMatter;
  onPatch: (patch: Partial<FrontMatter>) => void;
  onDone: () => void;
  /** The strip at the top of the script that holds the page's formatting bar. */
  bar?: HTMLElement | null;
}) {
  const text = frontPageText(kind, frontMatter);
  // Taken once, against the text the editor opens on.
  const [focusAt] = useState(() => ({ paragraph: blockAt(kind, at, text, frontMatter) }));
  const following = kind === "characters" && frontMatter.charactersPage === undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    // Taken on the way in: the prose editor keeps its own Esc. A menu of its
    // formatting bar is drawn elsewhere, and its Esc never comes here.
    if (event.key === "Escape") {
      event.preventDefault();
      onDone();
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Esc from anywhere in the page's editor
    <div className="frontedit" role="group" aria-label={LABEL[kind]} onKeyDownCapture={onKeyDown}>
      <div className="frontedit__head">
        <span className="frontedit__title">{LABEL[kind]}</span>
        <Button treatment="primary" onClick={onDone}>
          Done
        </Button>
      </div>
      <FrontPageEditor
        label={TEXT_LABEL[kind]}
        value={text}
        onChange={(next) => onPatch(frontPagePatch(kind, next))}
        focusAt={focusAt}
        barHost={bar}
      />
      {following && (
        <p className="frontedit__note">
          A name in bold starts a character’s line: the cast list in Cast & Pages follows this page,
          and this page follows the list.
        </p>
      )}
    </div>
  );
}
