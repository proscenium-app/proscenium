// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The play's details: title, credit, authors, contact, draft date and
 * source (docs/app/formatting/formats-and-layout.md#FMT-169). They stay in
 * the script's title page, where every Fountain app reads them; a page of
 * the play shows them as fields, headers and file properties use them, and
 * an anonymous copy leaves the authors and contact blank. Saved together, as
 * a sheet's fields are. Each can be written where it stands on a page, too
 * (docs/app/formatting/formats-and-layout.md#FMT-176): this is the place
 * that lists them all, read and written the same way (play-details.ts).
 */
import { useState } from "react";
import type { FrontMatter } from "../fountain";
import { Button, Sheet } from "../ui";
import { DETAILS, detailText, detailValue, type Details } from "./play-details";

export function PlayDetailsSheet({
  frontMatter: fm,
  onSave,
  onClose,
}: {
  frontMatter: FrontMatter;
  onSave: (patch: Details) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(() => ({
    title: detailText(fm, "title"),
    credit: detailText(fm, "credit"),
    authors: detailText(fm, "authors"),
    contact: detailText(fm, "contact"),
    draftDate: detailText(fm, "draftDate"),
    source: detailText(fm, "source"),
  }));
  const field = (key: keyof typeof fields) => ({
    value: fields[key],
    onChange: (e: { target: { value: string } }) =>
      setFields((f) => ({ ...f, [key]: e.target.value })),
  });
  const save = () => {
    const next: Details = {
      title: detailValue("title", fields.title),
      credit: detailValue("credit", fields.credit),
      authors: detailValue("authors", fields.authors),
      contact: detailValue("contact", fields.contact),
      draftDate: detailValue("draftDate", fields.draftDate),
      source: detailValue("source", fields.source),
    };
    const same = DETAILS.every((k) => JSON.stringify(next[k]) === JSON.stringify(fm[k]));
    if (!same) onSave(next);
    onClose();
  };
  return (
    <Sheet
      title="Play Details"
      subtitle="The title page’s fields show these, and so do headers and the file’s properties. An anonymous copy leaves the authors and contact blank."
      width={520}
      onClose={onClose}
      onDefault={save}
      footer={
        <>
          <span className="sheet__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button treatment="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="formgrid">
        <label className="formgrid__label" htmlFor="pd-title">
          Title
        </label>
        <input id="pd-title" className="field" {...field("title")} />
        <label className="formgrid__label" htmlFor="pd-credit">
          Credit
        </label>
        <input id="pd-credit" className="field" placeholder="a play by" {...field("credit")} />
        <label className="formgrid__label" htmlFor="pd-authors">
          Authors
        </label>
        <input
          id="pd-authors"
          className="field"
          placeholder="comma-separated"
          {...field("authors")}
        />
        <label className="formgrid__label formgrid__label--top" htmlFor="pd-contact">
          Contact
        </label>
        <textarea
          id="pd-contact"
          className="field field--area"
          rows={3}
          placeholder={"one line per row · address, agent…"}
          {...field("contact")}
        />
        <label className="formgrid__label" htmlFor="pd-draft">
          Draft date
        </label>
        <input id="pd-draft" className="field" {...field("draftDate")} />
        <label className="formgrid__label" htmlFor="pd-source">
          Source
        </label>
        <input id="pd-source" className="field" placeholder="based on…" {...field("source")} />
      </div>
    </Sheet>
  );
}
