// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which `markdown` props are the editor's own words coming back, and which are
 * a different document to load (ProseEditor).
 *
 * The page a writer types on tells its parent every change, and the parent
 * renders that back as the prop. The render can come back late. In WebKit,
 * ProseMirror reads typing from DOM mutations, outside any input event, so
 * React does not flush that render's effects with the event, and a render that
 * runs past its time slice leaves them for later. By then the writer has
 * typed on, so the prop is one of the editor's own earlier emissions.
 * Comparing it against only the LATEST emission called it a different document
 * and loaded it over the page, deleting every keystroke since. The native
 * self-test typed " Tide turns at the stair." into the outline notes and kept
 * "Tide ns at the stair.".
 *
 * So a prop the editor itself emitted, and the parent has not yet caught up
 * past, is an echo. Only a value the editor never produced is a new document.
 */
export interface ProseSync {
  /** The prop as last seen. */
  seeded: string;
  /** The editor's newest Markdown: its last emission, or the document as loaded. */
  last: string;
  /** Emissions the parent has not yet rendered back, oldest first. */
  pending: string[];
}

/** More than any render could be behind; the oldest go first. */
const KEEP = 64;

export function proseSync(markdown: string, loaded: string): ProseSync {
  return { seeded: markdown, last: loaded, pending: [] };
}

/** The editor produced `markdown` from a real edit, and is telling its parent. */
export function emit(sync: ProseSync, markdown: string): void {
  sync.last = markdown;
  sync.pending.push(markdown);
  if (sync.pending.length > KEEP) sync.pending.splice(0, sync.pending.length - KEEP);
}

/** The document was loaded wholesale: nothing before it is still coming back. */
export function loaded(sync: ProseSync, markdown: string): void {
  sync.last = markdown;
  sync.pending = [];
}

/**
 * A prop arrived. "same": it has not changed. "echo": the editor's own words,
 * possibly late — the page already holds them or newer, so it is left alone.
 * "replace": a different document, which the caller loads.
 */
export function propArrived(sync: ProseSync, markdown: string): "same" | "echo" | "replace" {
  if (markdown === sync.seeded) return "same";
  sync.seeded = markdown;
  const at = sync.pending.lastIndexOf(markdown);
  if (at >= 0) {
    // Caught up to this emission: the older ones are never coming back.
    sync.pending.splice(0, at + 1);
    return "echo";
  }
  // The page as it stands (the document as loaded, normalized): loading it
  // again would change nothing but throw the caret to the start.
  if (markdown === sync.last) {
    sync.pending = [];
    return "echo";
  }
  return "replace";
}
