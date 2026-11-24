// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Capitalize Character Names in Directions… (docs/app/writing/editor-ux.md#EDIT-208):
 * for a script written before its names went into capitals as they were
 * typed. Every name the typing rule would capitalize is listed with its line,
 * all ticked. The writer unticks what to keep; applying is one undo step, and
 * an unticked name is declined as an undone capital is
 * (docs/app/writing/editor-ux.md#EDIT-205), and kept in the play file's list,
 * so it is not offered again after a reopen either
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-194).
 */
import type { Editor } from "@tiptap/core";
import { useMemo, useState } from "react";
import {
  capitalizeChosen,
  keptAfter,
  scriptOccurrences,
  type KeptName,
  type ScriptOccurrence,
} from "../editor/names-in-directions";
import { useOrdinaryWords } from "../editor/use-ordinary-words";
import { Button, Checkbox, Sheet, announce } from "../ui";

/** How much of a line stands either side of the name in the list. */
const CONTEXT = 36;

function excerpt(o: ScriptOccurrence): { before: string; after: string } {
  const start = o.at;
  const end = o.at + o.name.length;
  const before = o.line.slice(Math.max(0, start - CONTEXT), start);
  const after = o.line.slice(end, end + CONTEXT);
  return {
    before: (start > CONTEXT ? "…" : "") + before,
    after: after + (end + CONTEXT < o.line.length ? "…" : ""),
  };
}

export function CastNamesSheet({
  editor,
  names,
  language,
  kept,
  onKept,
  onClose,
}: {
  editor: Editor | null;
  /** The play file's list of names kept in their own case, for this script. */
  kept: readonly KeptName[];
  /** The list after an apply, when it changed. */
  onKept: (entries: KeptName[]) => void;
  /** The binder's cast and the title page's Characters list; the cues are read from the page. */
  names: readonly string[];
  language: string;
  onClose: () => void;
}) {
  const ordinary = useOrdinaryWords(language, true);
  // The page as the sheet opened on it: the list's places are its places.
  const [doc] = useState(() => editor?.state.doc ?? null);
  // Taken once, as the sheet opened: the list it was offered against.
  const [keptThen] = useState(kept);
  const found = useMemo(
    () => (doc && ordinary ? scriptOccurrences(doc, { names, ordinary }, keptThen) : null),
    [doc, names, ordinary, keptThen],
  );
  // Every one ticked to begin with; the set holds those unticked.
  const [unticked, setUnticked] = useState<ReadonlySet<number>>(new Set());
  const count = found ? found.length - unticked.size : 0;

  const apply = () => {
    if (!editor || !found || found.length === 0) return;
    if (editor.state.doc !== doc) {
      // Nothing can type into the script behind the sheet, but the script can
      // be read again from disk: then these places are not its places.
      announce("The script changed. Open Capitalize Character Names again.");
      onClose();
      return;
    }
    const chosen = new Set(found.map((_, i) => i).filter((i) => !unticked.has(i)));
    // The play file's list, from the page before the capitals: a line's key is
    // its words in capitals, which the capitals leave as they were.
    const nextKept = keptAfter(
      editor.state.doc,
      keptThen,
      found.filter((_, i) => unticked.has(i)),
    );
    editor.view.dispatch(capitalizeChosen(editor.state, found, chosen));
    if (nextKept) onKept(nextKept);
    announce(
      count === 0
        ? "Every name kept as written."
        : count === 1
          ? "Capitalized 1 name."
          : `Capitalized ${count} names.`,
    );
    onClose();
    // Back in the script, where ⌘Z takes the whole change back. Once the sheet
    // is gone: while it is up it keeps the keyboard, and gives it back to the
    // menu that opened it, where ⌘Z is no undo of the script's.
    const { view } = editor;
    window.requestAnimationFrame(() => {
      if (!view.isDestroyed) view.focus();
    });
  };

  const toggle = (i: number) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Sheet
      title="Capitalize Character Names"
      subtitle="Character names in stage directions and parentheticals, in capitals. Untick any you want to keep as written."
      width={560}
      onClose={onClose}
      onDefault={apply}
      footer={
        <>
          {found && found.length > 0 && (
            <span className="sheet__hint castnames__count" aria-live="polite">
              {count} of {found.length}
            </span>
          )}
          <span className="sheet__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button treatment="primary" disabled={!found?.length} onClick={apply}>
            {count === 0
              ? "Keep All as Written"
              : count === 1
                ? "Capitalize 1 Name"
                : `Capitalize ${count} Names`}
          </Button>
        </>
      }
    >
      {!found ? (
        <p className="castview__empty" role="status">
          Reading the play’s dictionary…
        </p>
      ) : found.length === 0 ? (
        <p className="castview__empty" role="status">
          Every character name in the stage directions is already in capitals.
        </p>
      ) : (
        <>
          <label className="castnames__all">
            <Checkbox
              on={unticked.size === 0}
              label="All names"
              onChange={(on) => setUnticked(on ? new Set() : new Set(found.map((_, i) => i)))}
            />
            <span>All names</span>
          </label>
          <ul className="castnames__list" aria-label="Names in the stage directions">
            {found.map((o, i) => {
              const { before, after } = excerpt(o);
              return (
                <li key={`${o.from}-${o.to}`}>
                  <label className="castnames__row">
                    <Checkbox
                      on={!unticked.has(i)}
                      label={`${o.name}, in: ${o.line}`}
                      onChange={() => toggle(i)}
                    />
                    <span className="castnames__line">
                      {before}
                      <strong>{o.name}</strong>
                      {after}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
