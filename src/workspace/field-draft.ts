// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A field that edits a value the store owns — a scene's synopsis, its label, a
 * board note.
 *
 * It shows the store's value until the writer types, and gives back only what
 * they typed. These fields used to keep whatever they first rendered: once the
 * synopsis had changed in the script, clicking into its field and out again
 * wrote the old synopsis back over the new one, and an outside edit to a note
 * replaced what the writer was typing in it.
 */
import { useEffect, useRef, useState } from "react";

/** What leaving the field commits: the typed value, or null when the writer typed nothing new. */
export function draftToCommit(edited: boolean, draft: string, value: string): string | null {
  return edited && draft !== value ? draft : null;
}

export function useFieldDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const edited = useRef(false);
  // The store's value moves (the script changed, another device wrote the
  // play file): an untouched field follows it; one being typed in does not.
  useEffect(() => {
    if (!edited.current) setDraft(value);
  }, [value]);
  return {
    draft,
    change: (next: string) => {
      edited.current = true;
      setDraft(next);
    },
    /** On leaving the field: the value to write, or null. */
    take: (): string | null => {
      const commit = draftToCommit(edited.current, draft, value);
      edited.current = false;
      if (commit === null) setDraft(value);
      return commit;
    },
  };
}
