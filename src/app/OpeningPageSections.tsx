// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The opening pages on Cast & Pages (docs/app/formatting/formats-and-layout.md#FMT-167):
 * the title page, and the two pages a play may have or not, the opening notes
 * and the production notes, each with the switch that puts it in the play.
 * Everything is saved as it is written, as the Characters page and the cast
 * rows are: a field when it is left, a page's text as it is typed.
 */
import { useEffect, useState } from "react";
import type { FrontMatter } from "../fountain";
import type { NotesSheetKind } from "../editor";
import { PRODUCTION_NOTES_HEADING } from "../layout";
import { Alert, PopupButton, Switch } from "../ui";
import { FrontPageEditor, printsProse, titlePageText } from "./FrontPageEditor";
import { frontPagePatch, frontPageText } from "./FrontSheetEditor";

type Patch = (patch: Partial<FrontMatter>) => void;

/** Title, credit, authors, contact and draft date, or the title page written freely. */
export function TitlePageSection({
  frontMatter: fm,
  scriptKey,
  onPatch,
}: {
  frontMatter: FrontMatter;
  /** Another script re-seeds the fields. */
  scriptKey: string | null;
  onPatch: Patch;
}) {
  const fromFm = () => ({
    title: fm.title ?? "",
    credit: fm.credit ?? "",
    authors: (fm.authors ?? []).join(", "),
    contact: (fm.contact ?? []).join("\n"),
    draftDate: fm.draftDate ?? "",
  });
  const [fields, setFields] = useState(fromFm);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a script's own fields, once
  useEffect(() => setFields(fromFm()), [scriptKey]);
  const free = fm.titlePage !== undefined;
  const [asking, setAsking] = useState(false);
  /** The page the fields print, which a title page written freely starts from. */
  const seed = () =>
    titlePageText({
      ...fm,
      titlePage: undefined,
      title: fields.title,
      credit: fields.credit,
      authors: fields.authors
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      contact: fields.contact.split("\n"),
      draftDate: fields.draftDate,
    });

  /** A field, kept as it is left: the front matter as Opening Pages' Save wrote it. */
  const commit = () => {
    const list = (text: string, by: string) =>
      text
        .split(by)
        .map((t) => t.trim())
        .filter(Boolean);
    const authors = list(fields.authors, ",");
    const contact = list(fields.contact, "\n");
    const next: Partial<FrontMatter> = {
      title: fields.title.trim() || undefined,
      credit: fields.credit.trim() || undefined,
      authors: authors.length ? authors : undefined,
      contact: contact.length ? contact : undefined,
      draftDate: fields.draftDate.trim() || undefined,
    };
    const same = (Object.keys(next) as (keyof FrontMatter)[]).every(
      (k) => JSON.stringify(next[k]) === JSON.stringify(fm[k]),
    );
    if (!same) onPatch(next);
  };
  const field = (key: keyof typeof fields) => ({
    value: fields[key],
    onChange: (e: { target: { value: string } }) =>
      setFields((f) => ({ ...f, [key]: e.target.value })),
    onBlur: commit,
  });

  return (
    <section className="pages__section" id="pages-title" aria-labelledby="pages-title-head">
      <h2 className="castview__title" id="pages-title-head">
        Title Page
      </h2>
      <div className="formgrid">
        <label className="formgrid__label" htmlFor="tp-title">
          Title
        </label>
        <input id="tp-title" className="field" {...field("title")} />
        <label className="formgrid__label" htmlFor="tp-credit">
          Credit
        </label>
        <input id="tp-credit" className="field" placeholder="a play by" {...field("credit")} />
        <label className="formgrid__label" htmlFor="tp-authors">
          Authors
        </label>
        <input
          id="tp-authors"
          className="field"
          placeholder="comma-separated"
          {...field("authors")}
        />
        <label className="formgrid__label formgrid__label--top" htmlFor="tp-contact">
          Contact
        </label>
        <textarea
          id="tp-contact"
          className="field field--area"
          rows={3}
          placeholder={"one line per row · address, agent…"}
          {...field("contact")}
        />
        <label className="formgrid__label" htmlFor="tp-draft">
          Draft date
        </label>
        <input id="tp-draft" className="field" {...field("draftDate")} />
      </div>
      <label className="settings__row">
        <span>Write the title page freely</span>
        <Switch
          on={free}
          label="Write the title page freely"
          onChange={(on) => {
            if (on) onPatch({ titlePage: seed() });
            // Back to the fields drops the page as written, so a page with
            // words the fields would not print asks first, as an optional
            // page's switch does; one switched on and not written goes at once.
            else if (printsProse(fm.titlePage) && fm.titlePage !== seed()) setAsking(true);
            else onPatch({ titlePage: undefined });
          }}
        />
      </label>
      {free && (
        <FrontPageEditor
          label="Title page text"
          value={fm.titlePage ?? ""}
          onChange={(text) => onPatch({ titlePage: text })}
        />
      )}
      {asking && (
        <Alert
          title="Remove the title page you wrote?"
          body="The title page prints from its fields again. Versions keeps the script as it was."
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            setAsking(false);
            onPatch({ titlePage: undefined });
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </section>
  );
}

const NOTES: Record<NotesSheetKind, { title: string; id: string; about: string }> = {
  setting: {
    title: "Opening Notes",
    id: "pages-setting",
    about:
      "An optional page for setting, time, place, a dedication or other notes, with headings of your own.",
  },
  production: {
    title: "Production Notes",
    id: "pages-production",
    about: `An optional page for whoever stages the play: casting and doubling, the set, music, or how the text marks overlapping lines. It prints under the heading ${PRODUCTION_NOTES_HEADING}, just before the script.`,
  },
};

/**
 * One of the two optional pages, with the switch that puts it in the play.
 * On with nothing written yet, the page stands in the script's page view to
 * be written there too; a page with no word to print never prints. Off takes
 * the page and its words out of the play, after asking when it has words.
 */
export function NotesSection({
  kind,
  frontMatter: fm,
  on,
  onSwitch,
  onPatch,
}: {
  kind: NotesSheetKind;
  frontMatter: FrontMatter;
  /** Turned on and still empty, this session: the page has no words to say so itself. */
  on: boolean;
  onSwitch: (on: boolean) => void;
  onPatch: Patch;
}) {
  const text = frontPageText(kind, fm);
  const written = printsProse(text);
  const shown = written || on;
  const [asking, setAsking] = useState(false);
  const { title, id, about } = NOTES[kind];
  const off = () => {
    onPatch(
      kind === "setting"
        ? { ...frontPagePatch("setting", ""), openingNotes: undefined }
        : { productionNotes: undefined },
    );
    onSwitch(false);
  };
  return (
    <section className="pages__section" id={id} aria-labelledby={`${id}-head`}>
      <div className="pages__switchhead">
        <h2 className="castview__title" id={`${id}-head`}>
          {title}
        </h2>
        <span data-tutorial={kind === "setting" ? "opening-notes-switch" : undefined}>
          <Switch
            on={shown}
            label={`Include ${title.toLowerCase()}`}
            onChange={(next) => {
              if (next) onSwitch(true);
              else if (written) setAsking(true);
              else off();
            }}
          />
        </span>
      </div>
      <p className="settings__note">{about}</p>
      {shown && (
        <>
          <div data-tutorial={kind === "setting" ? "opening-notes" : undefined}>
            <FrontPageEditor
              label={kind === "setting" ? "Opening notes text" : "Production notes text"}
              value={text}
              onChange={(next) => onPatch(frontPagePatch(kind, next))}
            />
          </div>
          {kind === "setting" && (
            <div className="settings__row">
              <span>Place opening notes</span>
              <PopupButton
                label="Place opening notes"
                value={fm.openingNotesBeforeCharacters ? "before" : "after"}
                options={[
                  { value: "after", label: "After Characters" },
                  { value: "before", label: "Before Characters" },
                ]}
                onChange={(v) => onPatch({ openingNotesBeforeCharacters: v === "before" })}
              />
            </div>
          )}
        </>
      )}
      {asking && (
        <Alert
          title={`Take the ${title.toLowerCase()} out of the play?`}
          body="The page and its words are removed. Versions keeps the script as it was."
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            setAsking(false);
            off();
          }}
          onCancel={() => setAsking(false)}
        />
      )}
    </section>
  );
}
