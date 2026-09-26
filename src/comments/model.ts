// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Comments (docs/app/writing/comments.md) — a comment IS a Fountain note (`[[ ]]`): the
 * note text's one home is the script, and everything in this module is
 * presentation-side derivation. Pure (no DOM, no editor): the attribution
 * display-parse and collection over the model doc, testable without a browser.
 *
 * Vocabulary fence: the node type stays `note` (the Fountain name); every
 * writer-facing surface says **Comments** — "note" is already claimed by the
 * `notes/` binder materials and `card.boardNote`.
 */
import type { BlockNode, Doc, InlineNode, NoteNode } from "../fountain";

/**
 * `[[id:<ULID>]]` is the embedded scene anchor (docs/engineering/fountain-model.md#FOUN-D110):
 * app machinery, recognized by its prefix, never an author comment. The ULID
 * shape mirrors src/fountain/scenes.ts EMBEDDED_RE.
 */
const ANCHOR_RE = /^\s*id:[0-9A-HJKMNP-TV-Z]{26}\s*$/i;

/**
 * Optional leading `Name:` token — display attribution only, never stored
 * anywhere else. Letters to open, then up to 23 more of a name's characters,
 * a colon, and at least one space before the body ("Robin: …", "Sam: …").
 */
const AUTHOR_RE = /^([A-Za-z][A-Za-z0-9 .'-]{0,23}):\s+(.*)$/s;

export interface ParsedComment {
  /** Leading `Name:` token when present; null for an unattributed comment. */
  author: string | null;
  /** `todo:`-prefixed (case-insensitive) — the panel can filter for these. */
  todo: boolean;
  /** The comment with any recognized prefix stripped (for display only). */
  body: string;
}

/** Is this note text a scene anchor rather than a comment? */
export function isAnchorNoteText(text: string): boolean {
  return ANCHOR_RE.test(text);
}

/** The plain text inside a note node (model shape). */
export function noteText(note: NoteNode): string {
  return (note.content ?? []).map((n) => (n.type === "text" ? n.text : "")).join("");
}

/** Display-parse a comment's text: `Name:` chip, `todo:` flag, verbatim body. */
export function parseCommentText(raw: string): ParsedComment {
  const trimmed = raw.trim();
  const m = trimmed.match(AUTHOR_RE);
  if (!m) return { author: null, todo: false, body: trimmed };
  const token = m[1].trim();
  const body = m[2].trim();
  if (/^todo$/i.test(token)) return { author: null, todo: true, body };
  return { author: token, todo: false, body };
}

/**
 * How far back the derived highlight may reach — a phrase, never an essay.
 */
const ANCHOR_MAX = 64;

/** A clause ending: the last one inside the window bounds the highlight. */
const CLAUSE_RE = /^[\s\S]*[.!?;:—–]["')\]]?\s+/;

/**
 * The span a comment's highlight paints, inside the text run that precedes it.
 *
 * A Fountain note anchors at a POINT (docs/app/writing/comments.md#COMM-D7: ranges are a non-goal — nothing in
 * the file could hold one), so this is presentation and nothing else: derived
 * on every render, stored nowhere, and free to change without touching a
 * single play. It exists because a comment needs something to point at — the
 * highlight is what makes a comment visible, and a point anchor
 * alone is a dot you have to hunt for.
 *
 * The rule: back from the note to the start of the phrase it follows, bounded
 * by the run, by the last clause ending inside it, and by ANCHOR_MAX.
 * Returns null when there is nothing to paint (a note opening a block).
 */
export function anchorSpan(before: string): { start: number; end: number } | null {
  const end = before.replace(/\s+$/, "").length; // never paint trailing space
  if (end === 0) return null;
  const windowStart = Math.max(0, end - ANCHOR_MAX);
  const slice = before.slice(windowStart, end);
  const clause = slice.match(CLAUSE_RE);
  if (clause) return { start: windowStart + clause[0].length, end };
  if (windowStart === 0) return { start: 0, end };
  // The cap landed mid-word: step forward to the next word instead.
  const space = slice.search(/\s\S/);
  return { start: space === -1 ? windowStart : windowStart + space + 1, end };
}

export interface CommentEntry {
  /** Index of the block holding the note, in doc order. */
  blockIndex: number;
  /** Index of the note among the block's inline children. */
  childIndex: number;
  /** The block's only content is comments — a standalone `[[ ]]` line. */
  standalone: boolean;
  /** The note's raw text, verbatim (prefix included). */
  text: string;
  parsed: ParsedComment;
  /** Nearest `#` act label above, if any. */
  act: string | null;
  /** Nearest `##` scene / scene-heading label above, if any. */
  scene: string | null;
}

function inlineText(content: InlineNode[] | undefined): string {
  return (content ?? []).map((n) => (n.type === "text" ? n.text : "")).join("");
}

/**
 * Does this block print nothing at all because its only content is comments?
 * The criterion is strict — at least one note, zero text nodes with characters
 * (`[[a]] [[b]]` sharing a line with a space between keeps its printed line).
 * The layout engine, the page-view CSS, and this module must agree on it, or a
 * comment could move a page break.
 */
export function isCommentOnlyBlock(block: BlockNode): boolean {
  const content = block.content ?? [];
  const hasNote = content.some((n) => n.type === "note");
  const hasText = content.some((n) => n.type === "text" && n.text.length > 0);
  return hasNote && !hasText;
}

/** Every comment in the script, in script order, with its scene context. */
export function collectComments(doc: Doc): CommentEntry[] {
  const out: CommentEntry[] = [];
  let act: string | null = null;
  let scene: string | null = null;
  doc.content.forEach((block, blockIndex) => {
    if (block.type === "act") {
      act = inlineText(block.content) || null;
      scene = null;
      return;
    }
    if (block.type === "scene" || block.type === "sceneHeading") {
      scene = inlineText(block.content) || null;
      return;
    }
    const standalone = isCommentOnlyBlock(block);
    (block.content ?? []).forEach((child, childIndex) => {
      if (child.type !== "note") return;
      const text = noteText(child);
      if (isAnchorNoteText(text)) return; // machinery, never a comment
      out.push({
        blockIndex,
        childIndex,
        standalone,
        text,
        parsed: parseCommentText(text),
        act,
        scene,
      });
    });
  });
  return out;
}
