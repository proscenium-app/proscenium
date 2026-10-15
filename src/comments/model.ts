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

/** The longest name a comment may be signed with, in characters. */
export const COMMENT_NAME_MAX = 24;

/**
 * What a name may hold after its opening letter: letters in any script, the
 * marks that ride on them, digits, a space, and the three marks a name is
 * written with (`.`, `'` straight or curled, `-`).
 */
const NAME_REST = String.raw`[\p{L}\p{M}\p{N} .'’-]`;
const NAME_CHAR_RE = new RegExp(`^${NAME_REST}$`, "u");

/**
 * Optional leading `Name:` token — display attribution only, never stored
 * anywhere else. A letter to open, then up to 23 more of a name's characters,
 * a colon, and at least one space before the body ("Robin: …", "Zoë: …").
 * Letters are any script's, because a name is: the first grammar was ASCII,
 * and read a comment signed "Zoë" as nobody's.
 */
const AUTHOR_RE = new RegExp(
  String.raw`^(\p{L}${NAME_REST}{0,${COMMENT_NAME_MAX - 1}}):\s+(.*)$`,
  "su",
);

/** A `todo:` flag after the name that signed the comment. */
const TODO_RE = /^todo:\s+(.*)$/is;

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

/**
 * `[[{]]` and `[[}]]` mark where the text a comment is about begins and ends
 * (docs/app/writing/comments.md#COMM-61): machinery like the scene anchor,
 * never a comment. A pair may carry a number, `[[{2]]` … `[[}2]]`, which is
 * how two stretches that overlap without one holding the other are told apart.
 * The match is exact: a note of ` { ` is the writer's own.
 */
const RANGE_MARKER_RE = /^([{}])(\d{0,4})$/;

export interface RangeMarker {
  side: "open" | "close";
  /** The pair's number, or "" for the usual pair with none. */
  label: string;
}

/** Read a note's text as a range marker, or null when it is anything else. */
export function rangeMarker(text: string): RangeMarker | null {
  const m = RANGE_MARKER_RE.exec(text);
  return m ? { side: m[1] === "{" ? "open" : "close", label: m[2] } : null;
}

/** The note text a range marker is written as. */
export function rangeMarkerText(side: RangeMarker["side"], label = ""): string {
  return `${side === "open" ? "{" : "}"}${label}`;
}

/**
 * Lines whose text is a name the app reads: a cue, a heading. A range is
 * neither started nor ended in one (docs/app/writing/comments.md#COMM-63).
 */
const NAME_LINES: ReadonlySet<string> = new Set(["character", "sceneHeading", "scene", "act"]);

/** May a comment's range begin or end in a block of this type? */
export function holdsCommentRange(blockType: string): boolean {
  return !NAME_LINES.has(blockType);
}

/** The plain text inside a note node (model shape). */
export function noteText(note: NoteNode): string {
  return (note.content ?? []).map((n) => (n.type === "text" ? n.text : "")).join("");
}

/**
 * Display-parse a comment's text: `Name:` chip, `todo:` flag, verbatim body.
 * A signed to-do reads `Name: todo: …`, so a flag keeps whose it is.
 */
export function parseCommentText(raw: string): ParsedComment {
  const trimmed = raw.trim();
  const m = trimmed.match(AUTHOR_RE);
  if (!m) return { author: null, todo: false, body: trimmed };
  const token = m[1].trim();
  const body = m[2].trim();
  if (/^todo$/i.test(token)) return { author: null, todo: true, body };
  const flagged = body.match(TODO_RE);
  if (flagged) return { author: token, todo: true, body: flagged[1].trim() };
  return { author: token, todo: false, body };
}

/**
 * A name as the name field holds it while it is typed: only what a signature
 * can carry, and no longer than one. Spaces stay as typed, so "Mary Ann" can
 * be typed at all; `cleanCommentName` settles them.
 */
export function commentNameInput(raw: string): string {
  return [...raw]
    .filter((ch) => NAME_CHAR_RE.test(ch))
    .slice(0, COMMENT_NAME_MAX)
    .join("");
}

/**
 * The name comments are signed with, or "" for none: single-spaced, opening on
 * a letter, and never `todo`, which is the flag's own word. What this returns
 * always reads back as the author of a comment it signs.
 */
export function cleanCommentName(raw: string): string {
  const name = commentNameInput(raw)
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}]+/u, "")
    .trimEnd();
  return /^todo$/i.test(name) ? "" : name;
}

/**
 * A comment as the composer writes it into the script (docs/app/writing/comments.md#COMM-52):
 * `Name: body` when the writer has a name, the body alone when they have none.
 * A body that already opens with this same name is not signed twice. Only the
 * composer signs: a note typed into the script as `[[ ]]` is the writer's own
 * source and stays as typed.
 */
export function signComment(text: string, name: string): string {
  const body = text.trim();
  const who = cleanCommentName(name);
  if (!who || !body) return body;
  if (parseCommentText(body).author === who) return body;
  return `${who}: ${body}`;
}

/**
 * How far back the derived highlight may reach — a phrase, never an essay.
 */
const ANCHOR_MAX = 64;

/** A clause ending: the last one inside the window bounds the highlight. */
const CLAUSE_RE = /^[\s\S]*[.!?;:—–]["')\]]?\s+/;

/**
 * The span a comment's highlight paints when the script does not say what the
 * comment is about, inside the text run that precedes it
 * (docs/app/writing/comments.md#COMM-59).
 *
 * A Fountain note anchors at a POINT. A comment made on a selection has its
 * stretch marked in the script (ranges.ts); one typed as `[[ ]]`, made with
 * nothing selected or left by another tool has the point alone, so this is
 * presentation and nothing else: derived on every render, stored nowhere, and
 * free to change without touching a single play. It exists because a comment
 * needs something to point at — the highlight is what makes a comment
 * visible, and a point anchor alone is a dot you have to hunt for.
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

/**
 * The span a comment's highlight paints on a cue or a heading
 * (docs/app/writing/comments.md#COMM-66): all of the name in front of it. A
 * name is not a sentence, and the clause rule above took the full stop of
 * `MR. SMITH` or `INT. KITCHEN` for the end of one and painted half a name.
 * Null when no text stands in front of the comment.
 */
export function nameSpan(before: string): { start: number; end: number } | null {
  const end = before.trimEnd().length;
  return end === 0 ? null : { start: before.length - before.trimStart().length, end };
}

/**
 * Does the text between two comments leave them one conversation? Nothing, or
 * white space only (docs/app/writing/comments.md#COMM-50): `[[a]][[b]]`, `[[a]] [[b]]`, and
 * one under the other on consecutive lines. A word between them is script, and
 * the comment after it is about that word.
 */
export function joinsThread(between: string): boolean {
  return /^\s*$/.test(between);
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
  /**
   * Index, in the collected list, of the comment this one answers: the first
   * of its thread. A comment that starts a thread holds its own index.
   */
  thread: number;
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
    // A heading names what is under it, and a comment on the heading is under
    // it too (docs/app/writing/comments.md#COMM-66).
    if (block.type === "act") {
      act = inlineText(block.content) || null;
      scene = null;
    } else if (block.type === "scene" || block.type === "sceneHeading") {
      scene = inlineText(block.content) || null;
    }
    const standalone = isCommentOnlyBlock(block);
    // The comment a following one would answer: the first of the run it is in.
    let open: number | null = null;
    (block.content ?? []).forEach((child, childIndex) => {
      if (child.type !== "note") {
        if (!joinsThread(child.text)) open = null;
        return;
      }
      const text = noteText(child);
      if (isAnchorNoteText(text)) {
        open = null; // machinery, never a comment
        return;
      }
      // A range marker is machinery too, and stands between nothing: the
      // editor never holds one that is in use (ranges.ts).
      if (rangeMarker(text)) return;
      const thread: number = open ?? out.length;
      open = thread;
      out.push({
        blockIndex,
        childIndex,
        standalone,
        text,
        parsed: parseCommentText(text),
        act,
        scene,
        thread,
      });
    });
  });
  return out;
}
