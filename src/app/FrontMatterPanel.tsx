// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Opening pages: structured title fields or free prose, plus one optional
 * opening-notes page. Legacy Setting/Time/Place values seed the prose editor. Values live in the fountain
 * title page (canonical, storage rule 3); saving updates the in-memory front
 * matter and lets autosave serialize it. The cast list (Characters) has its
 * own richer home in the Cast panel, so it passes through untouched here,
 * alongside any `_extra` keys.
 */
import { useState } from "react";
import type { FrontMatter } from "../fountain";
import { FrontPageEditor, openingNotesText, titlePageText } from "./FrontPageEditor";
import { Button, Sheet, PopupButton } from "../ui";

export interface FrontMatterPanelProps {
  frontMatter: FrontMatter;
  /**
   * The script this sheet opened on. Taken once: if another script opens while
   * the sheet is up, Save refuses rather than write these fields into it.
   */
  scriptKey: string | null;
  /** False when nothing was saved; the sheet then stays open. */
  onSave: (fm: FrontMatter, forScript: string | null) => boolean | void;
  onClose: () => void;
}

export function FrontMatterPanel({ frontMatter, scriptKey, onSave, onClose }: FrontMatterPanelProps) {
  const [forScript] = useState(scriptKey);
  const [title, setTitle] = useState(frontMatter.title ?? "");
  const [credit, setCredit] = useState(frontMatter.credit ?? "");
  const [authors, setAuthors] = useState((frontMatter.authors ?? []).join(", "));
  const [contact, setContact] = useState((frontMatter.contact ?? []).join("\n"));
  const [draftDate, setDraftDate] = useState(frontMatter.draftDate ?? "");
  const [notes, setNotes] = useState(() => openingNotesText(frontMatter));
  const [notesFirst, setNotesFirst] = useState(frontMatter.openingNotesBeforeCharacters ?? false);
  const [customTitle, setCustomTitle] = useState(frontMatter.titlePage !== undefined);
  const [hasTitleDraft, setHasTitleDraft] = useState(frontMatter.titlePage !== undefined);
  const [titleText, setTitleText] = useState(() => titlePageText(frontMatter));

  const save = () => {
    const authorList = authors
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const contactLines = contact
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const saved = onSave(
      {
      ...frontMatter,
      title: title.trim() || undefined,
      credit: credit.trim() || undefined,
      authors: authorList.length ? authorList : undefined,
      contact: contactLines.length ? contactLines : undefined,
      draftDate: draftDate.trim() || undefined,
      setting: undefined, time: undefined, place: undefined,
      openingNotes: notes,
      openingNotesBeforeCharacters: notesFirst,
      titlePage: customTitle ? titleText : undefined,
      },
      forScript,
    );
    if (saved !== false) onClose();
  };

  return (
    <Sheet
      title="Opening Pages"
      subtitle="Title page, Characters page, then optional opening notes. You choose the content."
      width={640}
      onClose={onClose}
      onDefault={save}
      footer={
        <>
          <span className="sheet__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button treatment="primary" data-tutorial="opening-save" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      {/* Right-aligned labels in a two-column form — Apple's preference-pane
          grid, which is what this is: eight fields and no decisions. */}
      <div className="titlepage">
        <div className="formgrid">
          <label className="formgrid__label" htmlFor="tp-title">
            Title
          </label>
          <input
            id="tp-title"
            className="field"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />

          <label className="formgrid__label" htmlFor="tp-credit">
            Credit
          </label>
          <input
            id="tp-credit"
            className="field"
            value={credit}
            placeholder="a play by"
            onChange={(e) => setCredit(e.target.value)}
          />

          <label className="formgrid__label" htmlFor="tp-authors">
            Authors
          </label>
          <input
            id="tp-authors"
            className="field"
            value={authors}
            placeholder="comma-separated"
            onChange={(e) => setAuthors(e.target.value)}
          />

          <label className="formgrid__label formgrid__label--top" htmlFor="tp-contact">
            Contact
          </label>
          <textarea
            id="tp-contact"
            className="field field--area"
            rows={3}
            value={contact}
            placeholder={"one line per row · address, agent…"}
            onChange={(e) => setContact(e.target.value)}
          />

          <label className="formgrid__label" htmlFor="tp-draft">
            Draft date
          </label>
          <input
            id="tp-draft"
            className="field"
            value={draftDate}
            onChange={(e) => setDraftDate(e.target.value)}
          />

        </div>
        <label className="settings__row"><span>Write the title page freely</span>
          <input type="checkbox" checked={customTitle} onChange={(e) => {
            if (e.target.checked && !hasTitleDraft) {
              setTitleText(titlePageText({ title, credit, authors: authors.split(",").map((a) => a.trim()).filter(Boolean), contact: contact.split("\n"), draftDate }));
              setHasTitleDraft(true);
            }
            setCustomTitle(e.target.checked);
          }} />
        </label>
        {customTitle && <FrontPageEditor label="Title page text" value={titleText} onChange={setTitleText} />}
        <h2 className="castview__title">Opening Notes</h2>
        <p className="settings__note">An optional page for setting, time, place, a dedication or other notes. Write your own headings, or leave it empty to omit the page.</p>
        <div data-tutorial="opening-notes"><FrontPageEditor label="Opening notes text" value={notes} onChange={setNotes} /></div>
        <div className="settings__row"><span>Place opening notes</span>
          <PopupButton label="Place opening notes" value={notesFirst ? "before" : "after"} options={[
            { value: "after", label: "After Characters" }, { value: "before", label: "Before Characters" },
          ]} onChange={(v) => setNotesFirst(v === "before")} />
        </div>
        <p className="settings__note">Edit the Characters page in Cast. Export lets you choose which opening pages to include.</p>
      </div>
    </Sheet>
  );
}
