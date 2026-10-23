// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Comments extension (docs/app/writing/comments.md#COMM-D4, docs/app/writing/comments.md#COMM-D5) — presentation over Fountain
 * notes, never a second store. Five jobs:
 *
 *  1. **Anchor highlights.** An inline decoration over the text each comment
 *     is about: the stretch it was made on (job 5), else the phrase it follows
 *     (model.ts `anchorSpan`), so a comment is visible IN the text — not a dot
 *     you have to find. A decoration that only paints a background can't
 *     change wrapping, which is the invariant the engine's note handling
 *     rests on.
 *  2. **Markers.** A widget at every comment's anchor: chrome at the anchor
 *     point, absolutely positioned, so it occupies zero width and zero height
 *     and can never move a wrap or a page break. It carries the comments a
 *     highlight can't (one opening a block, or standing alone).
 *  3. **The comment-only class.** A block whose only content is comments gets
 *     `pl-commentonly`, which page view hides WHOLE — the DOM twin of the
 *     engine skipping the block (engine.ts / pagination.ts).
 *  4. **Surface state.** `focusPos` (the comment being read) / `hoverPos` /
 *     `doomedPos` / `composing` / `replying` / `count` / `marginRoom` live in
 *     extension storage, Find-style; commands dispatch a meta-only transaction
 *     so React chrome re-renders without a document change. Which SURFACES are
 *     open is App's business, not the document's — the feed is a pane.
 *  5. **Ranges.** ⌘⌥M marks the selected words (`commentRange`) and the
 *     comment (`commentRangeEnd`) with one id
 *     (docs/app/writing/comments.md#COMM-D13). The editor
 *     keeps a mark through the writer's edits by itself; all that is done
 *     here is to make one, to take the marks of a range that has lost its
 *     comment or all of its words off the page, and to give a pasted range an
 *     id of its own. The script holds two marker notes instead (ranges.ts).
 *
 * A comment directly after another answers it (docs/app/writing/comments.md#COMM-50), so the
 * comments are also collected as THREADS, and the first three jobs are done
 * once per thread: one highlight and one marker, at the comment its replies
 * are under.
 */
import { binding } from "../ui/keys";
import { Extension } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  anchorSpan,
  holdsCommentRange,
  isAnchorNoteText,
  joinsThread,
  nameSpan,
  parseCommentText,
  rangeMarker,
  type ParsedComment,
} from "./model";
import { commentText, ownText } from "./own-text";
import { COMMENT_RANGE, COMMENT_RANGE_END } from "./ranges";

let nextCommentId = 0;
let nextRangeId = 0;

/** An id for a range made on the page; the script holds none (ranges.ts). */
function newRangeId(): string {
  return `n${++nextRangeId}`;
}

/** The ranges a node is marked for: as their words, or as the comment they end at. */
function rangeIds(node: PMNode, type: string): string[] {
  const ids: string[] = [];
  for (const mark of node.marks) {
    if (mark.type.name === type && typeof mark.attrs.id === "string") ids.push(mark.attrs.id);
  }
  return ids;
}

const isRangeMark = (mark: { type: { name: string } }) =>
  mark.type.name === COMMENT_RANGE || mark.type.name === COMMENT_RANGE_END;

export interface PmCommentEntry {
  /** Runtime identity, mapped through edits; never serialized into Fountain. */
  id: string;
  /** Position of the note node in the editor document. */
  pos: number;
  /** Position just past the note node. */
  end: number;
  /**
   * Position of the comment this one answers — the first of its thread
   * (docs/app/writing/comments.md#COMM-50). A comment that starts a thread holds its own.
   */
  root: number;
  /**
   * The highlight's span, or null when there's nothing to paint: the text the
   * comment was made on when it has a range, else the phrase before it.
   */
  anchorFrom: number | null;
  anchorTo: number | null;
  /** The range this comment ends, when it has one (ranges.ts). */
  rangeId: string | null;
  /** Start position of the block holding it. */
  blockPos: number;
  /** The note's raw text, verbatim. */
  text: string;
  parsed: ParsedComment;
  /** The block's only content is comments (a standalone `[[ ]]` line). */
  standalone: boolean;
  /**
   * The headings it is listed under: the nearest act title above it, and the
   * nearest scene title or scene heading since
   * (docs/app/writing/comments.md#COMM-71).
   */
  act: string | null;
  scene: string | null;
  /**
   * Where the heading it is listed under stands: the scene's when it has one,
   * else the act's, and null at the front of the script. Two headings with
   * one text are two places, and this tells them apart.
   */
  headingPos: number | null;
}

/** What one reading of the document finds. */
interface CommentScan {
  entries: PmCommentEntry[];
  /**
   * Range ids that are no range any more: marked text whose comment is gone,
   * or a comment whose text is. The plugin takes their marks off the page.
   */
  deadRanges: string[];
  /** Range markers the script holds that fence nothing: hidden, never comments. */
  strayMarkers: { pos: number; size: number }[];
}

/** Every comment in the live editor doc, in document order, with anchors. */
export function collectPmComments(doc: PMNode): PmCommentEntry[] {
  return scanComments(doc).entries;
}

function scanComments(doc: PMNode): CommentScan {
  const out: PmCommentEntry[] = [];
  const strayMarkers: CommentScan["strayMarkers"] = [];
  // A range is the first text carrying its id and the first comment carrying
  // it, in that order, neither of them in a cue or a heading: the same
  // reading the bridge writes the script from (ranges.ts heldRanges).
  const starts = new Map<string, number>();
  const owners = new Map<string, number>();
  const seen = new Set<string>();
  let act: string | null = null;
  let scene: string | null = null;
  let actPos: number | null = null;
  let scenePos: number | null = null;
  doc.forEach((node, offset) => {
    const name = node.type.name;
    const holds = holdsCommentRange(name);
    node.forEach((child, childOffset) => {
      const pos = offset + 1 + childOffset;
      // A marker the bridge left in place fences nothing, in any line.
      if (child.type.name === "note" && rangeMarker(commentText(child))) {
        strayMarkers.push({ pos, size: child.nodeSize });
        return;
      }
      const words = rangeIds(child, COMMENT_RANGE);
      const ends = rangeIds(child, COMMENT_RANGE_END);
      for (const id of words) seen.add(id);
      for (const id of ends) seen.add(id);
      if (!holds) return;
      if (child.isText) {
        for (const id of words) if (!starts.has(id) && !owners.has(id)) starts.set(id, pos);
      } else if (child.type.name === "note") {
        if (isAnchorNoteText(commentText(child))) return;
        const id = ends.find((id) => !owners.has(id));
        if (id !== undefined) owners.set(id, pos);
      }
    });
    // A heading names what is under it, and a comment on the heading is under
    // it too (docs/app/writing/comments.md#COMM-66). The label is the
    // heading's own text, as the outline and the inspector read it: with a
    // comment's words in it, it named no scene either of them knew
    // (docs/app/writing/comments.md#COMM-67). A heading with no text of its
    // own names no place: it has no label, so it has no position either.
    if (name === "act") {
      act = ownText(node) || null;
      actPos = act === null ? null : offset;
      scene = null;
      scenePos = null;
    } else if (name === "scene" || name === "sceneHeading") {
      scene = ownText(node) || null;
      scenePos = scene === null ? null : offset;
    }
    let hasNote = false;
    let hasText = false;
    node.forEach((child) => {
      if (child.type.name === "note") hasNote = true;
      else if (child.isText && child.text) hasText = true;
    });
    if (!hasNote) return;
    const standalone = !hasText;
    // The run immediately before a note is what its highlight paints; anything
    // else in between (a line break, another comment) ends the phrase.
    let run: { text: string; offset: number } | null = null;
    // The comment a following one would answer: the first of the run it is in.
    // White space between two comments leaves them one conversation; a word
    // between them is script, and ends it (model.ts joinsThread).
    let open: number | null = null;
    node.forEach((child, childOffset) => {
      if (child.type.name !== "note") {
        run = child.isText && child.text ? { text: child.text, offset: childOffset } : null;
        // A line break is white space too: the editor holds it as a node, the
        // script as a newline.
        const space =
          child.type.name === "lineBreak" || (child.isText && joinsThread(child.text ?? ""));
        if (!space) open = null;
        return;
      }
      const before: { text: string; offset: number } | null = run;
      run = null;
      // With its line breaks, as the script holds it: the card shows this
      // and the field that edits the comment starts from it.
      const text = commentText(child);
      if (isAnchorNoteText(text)) {
        open = null; // scene anchors are machinery
        return;
      }
      // A stray marker is no comment, and it stands between none: a reply
      // after it is still a reply.
      if (rangeMarker(text)) return;
      const pos = offset + 1 + childOffset;
      const root: number = open ?? pos;
      open = root;
      const rangeId = rangeIds(child, COMMENT_RANGE_END).find(
        (id) => owners.get(id) === pos && starts.has(id),
      );
      const rangeFrom = rangeId === undefined ? undefined : starts.get(rangeId);
      // A reply has no phrase of its own: it is about what its comment is about.
      // On a cue or a heading the phrase is the name in front of the comment.
      const phrase = holds ? anchorSpan : nameSpan;
      const span = before && root === pos ? phrase(before.text) : null;
      const runStart = before ? offset + 1 + before.offset : 0;
      // The text the comment was made on, when the script says what it was;
      // else the phrase before it.
      const ranged = root === pos && rangeFrom !== undefined;
      out.push({
        id: `comment-${++nextCommentId}`,
        pos,
        end: pos + child.nodeSize,
        root,
        anchorFrom: ranged ? rangeFrom : span ? runStart + span.start : null,
        anchorTo: ranged ? pos : span ? runStart + span.end : null,
        rangeId: rangeId ?? null,
        blockPos: offset,
        text,
        parsed: parseCommentText(text),
        standalone,
        act,
        scene,
        headingPos: scenePos ?? actPos,
      });
    });
  });
  const deadRanges = [...seen].filter((id) => !(owners.has(id) && starts.has(id)));
  return { entries: out, deadRanges, strayMarkers };
}

/**
 * Where a comment on the selection goes: the end of what is selected, or null
 * where a comment cannot stand.
 *
 * A selection of whole lines ends at the start of the line after them. The
 * comment belongs at the end of the last line selected, not in front of the
 * next one, which may be a cue.
 */
export function commentPlace(state: EditorState): number | null {
  if (!state.schema.nodes.note) return null;
  const { from, empty } = state.selection;
  let { $to } = state.selection;
  if (!empty && $to.parentOffset === 0 && $to.depth > 0) {
    const last = Selection.findFrom(state.doc.resolve($to.before()), -1, true);
    if (last && last.head >= from) $to = last.$head;
  }
  if (!$to.parent.isTextblock) return null;
  if ($to.parent.type.name === "note" || $to.parent.type.name === "boneyard") return null;
  return $to.pos;
}

/**
 * Put a new comment at `to`, about the text selected before it
 * (docs/app/writing/comments.md#COMM-60): the selected words take the range's
 * mark, and so does the comment. A range is not kept in a cue or a heading,
 * whose text is a name the app reads (docs/app/writing/comments.md#COMM-63): a
 * comment that lands in one has the phrase before it, as a comment made with
 * nothing selected has.
 */
export function insertComment(state: EditorState, tr: Transaction, to: number): void {
  const { from, empty } = state.selection;
  const noteType = state.schema.nodes.note;
  const id = newRangeId();
  const range = state.schema.marks[COMMENT_RANGE]?.create({ id });
  const end = state.schema.marks[COMMENT_RANGE_END]?.create({ id });
  let marked = 0;
  if (range && end && !empty && holdsCommentRange(state.doc.resolve(to).parent.type.name)) {
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (!holdsCommentRange(node.type.name)) return false;
      node.forEach((child, offset) => {
        const start = Math.max(from, pos + 1 + offset);
        const end = Math.min(to, pos + 1 + offset + child.nodeSize);
        // Words only: a comment already inside the stretch is not part of
        // what this one is about.
        if (!child.isText || start >= end) return;
        tr.addMark(start, end, range);
        marked += 1;
      });
      return false;
    });
  }
  const text = state.schema.text("comment");
  tr.insert(to, noteType.create(null, text, end && marked ? [end] : undefined));
}

/**
 * The marks of ranges that are ranges no more, taken off: a comment deleted
 * with its text left behind, or a comment left with none of its text. Returns
 * the transaction, or null when every range on the page is whole.
 */
export function clearDeadRanges(state: EditorState, dead?: readonly string[]): Transaction | null {
  const words = state.schema.marks[COMMENT_RANGE];
  const end = state.schema.marks[COMMENT_RANGE_END];
  const ids = dead ?? scanComments(state.doc).deadRanges;
  if (!words || !end || !ids.length) return null;
  const tr = state.tr;
  for (const id of ids) {
    tr.removeMark(0, state.doc.content.size, words.create({ id }));
    tr.removeMark(0, state.doc.content.size, end.create({ id }));
  }
  return tr.docChanged ? tr : null;
}

/**
 * A pasted or dropped slice with its ranges made its own. A range copied with
 * its comment is a second range, under a new id: two with one id would be read
 * as one stretch from the first copy to the second. Marked text that came
 * without its comment is plain text.
 */
export function ownPastedRanges(slice: Slice): Slice {
  const owned = new Map<string, string>();
  let marked = false;
  slice.content.descendants((node) => {
    if (node.marks.some(isRangeMark)) marked = true;
    for (const id of rangeIds(node, COMMENT_RANGE_END)) {
      if (node.type.name === "note" && !owned.has(id)) owned.set(id, newRangeId());
    }
    return node.type.name !== "note";
  });
  if (!marked) return slice;
  const own = (fragment: Fragment): Fragment => {
    const nodes: PMNode[] = [];
    fragment.forEach((node) => {
      let next = node;
      if (node.marks.some(isRangeMark)) {
        const marks = node.marks.flatMap((mark) => {
          if (!isRangeMark(mark)) return [mark];
          const id = owned.get(mark.attrs.id as string);
          return id ? [mark.type.create({ id })] : [];
        });
        next = node.mark(marks);
      }
      if (!next.isText && next.type.name !== "note" && next.content.size) {
        next = next.copy(own(next.content));
      }
      nodes.push(next);
    });
    return Fragment.fromArray(nodes);
  };
  return new Slice(own(slice.content), slice.openStart, slice.openEnd);
}

/** A comment and the replies under it, in the order they were written. */
export interface CommentThread {
  root: PmCommentEntry;
  replies: PmCommentEntry[];
  /** Position just past the thread's last comment: where the next reply goes. */
  end: number;
}

/** The collected comments as conversations, in script order. */
export function commentThreads(entries: readonly PmCommentEntry[]): CommentThread[] {
  const threads: CommentThread[] = [];
  const byRoot = new Map<number, CommentThread>();
  for (const entry of entries) {
    const thread = byRoot.get(entry.root);
    if (thread && entry.pos !== entry.root) {
      thread.replies.push(entry);
      thread.end = entry.end;
      continue;
    }
    const started: CommentThread = { root: entry, replies: [], end: entry.end };
    byRoot.set(entry.pos, started);
    threads.push(started);
  }
  return threads;
}

/** Existing notes keep identity when text before or inside them changes. */
export function commentIdsAfter(tr: Transaction, entries: PmCommentEntry[]): Map<number, string> {
  const identities = new Map<number, string>();
  for (const entry of entries) {
    const mapped = tr.mapping.mapResult(entry.pos, 1);
    if (!mapped.deleted) identities.set(mapped.pos, entry.id);
  }
  return identities;
}

export interface CommentsStorage {
  /**
   * The comment being read — highlighted in the text, raised in the margin.
   * Always the first comment of its thread: a reply is read with its comment.
   */
  focusPos: number | null;
  /** The focused comment is newly made and should open for typing. */
  composing: boolean;
  /** The focused comment is to be answered: its reply field should open. */
  replying: boolean;
  /** The comment the pointer is over — its text lights up, lightly. */
  hoverPos: number | null;
  /** The comment about to be resolved: the text says what is going away. */
  doomedPos: number | null;
  /** Comments in the current doc, a reply not counted — the bar chip's badge. */
  count: number;
  /**
   * There is room beside the page for the margin's cards (CommentsMargin.tsx
   * measures it). It decides which surface a new comment is typed in: the
   * margin when it has room, the feed when it has not
   * (docs/app/writing/comments.md#COMM-56).
   */
  marginRoom: boolean;
}

interface PluginState {
  entries: PmCommentEntry[];
  /** The same comments as conversations: a comment and the replies under it. */
  threads: CommentThread[];
  /** Range ids whose comment or whose text is gone; their marks come off. */
  deadRanges: string[];
  deco: DecorationSet;
  /** The three ways a comment can be emphasised, in rising order. */
  activePos: number | null;
  hoverPos: number | null;
  doomedPos: number | null;
}

/** Emphasis on a comment's text, strongest first — one class, never two. */
function emphasis(pos: number, state: Pick<PluginState, "activePos" | "hoverPos" | "doomedPos">) {
  if (pos === state.doomedPos) return " is-doomed";
  if (pos === state.activePos) return " is-active";
  if (pos === state.hoverPos) return " is-hover";
  return "";
}

const KEY = new PluginKey<PluginState>("comments");

/** What the margin and the panel read: the collected comments, once. */
export function commentsState(state: EditorState): PluginState | undefined {
  return KEY.getState(state);
}

/**
 * A position with real coordinates for the comment at `pos`.
 *
 * You cannot scroll to a comment by its own position: page view hides the note
 * (so the engine's wrapping is matched exactly), and a hidden node has no
 * coordinates at all — `coordsAtPos` answers 0, and a jump lands at the top of
 * the document. So the jump goes to the text the comment is ABOUT: the end of
 * its highlighted phrase, or the block it sits in, or — for a standalone
 * comment, whose whole block is hidden — the nearest block that isn't.
 */
export function commentJumpTarget(state: EditorState, pos: number): number | null {
  const plugin = KEY.getState(state);
  const asked = plugin?.entries.find((e) => e.pos === pos);
  // A reply is about what its comment is about.
  const entry = asked && plugin?.entries.find((e) => e.pos === asked.root);
  if (!entry) return null;
  if (entry.anchorTo !== null) return entry.anchorTo;
  if (!entry.standalone) return entry.blockPos + 1;
  const hidden = new Set(plugin!.entries.filter((e) => e.standalone).map((e) => e.blockPos));
  const blocks: number[] = [];
  state.doc.forEach((_node, offset) => blocks.push(offset));
  const here = blocks.indexOf(entry.blockPos);
  if (here === -1) return null;
  for (let i = here - 1; i >= 0; i--) if (!hidden.has(blocks[i])) return blocks[i] + 1;
  for (let i = here + 1; i < blocks.length; i++) if (!hidden.has(blocks[i])) return blocks[i] + 1;
  return null;
}

/** Meta marking a UI-only transaction (focus/open/compose — no doc change). */
interface UiMeta {
  kind: "ui";
}

function truncate(text: string, max = 160): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

export const Comments = Extension.create<Record<string, never>, CommentsStorage>({
  name: "comments",

  addStorage() {
    return {
      focusPos: null,
      composing: false,
      replying: false,
      hoverPos: null,
      doomedPos: null,
      count: 0,
      marginRoom: false,
    };
  },

  addCommands() {
    const storage = this.storage;
    const ui = (tr: Transaction) => tr.setMeta(KEY, { kind: "ui" } satisfies UiMeta);
    return {
      /**
       * Read this comment: highlight its text, raise its card. It also ends a
       * request to type one — the comment that was being made or answered is
       * saved, cancelled or left by the time anything asks to read.
       */
      focusComment:
        (pos: number | null) =>
        ({ tr, dispatch }) => {
          if (storage.focusPos === pos && !storage.composing && !storage.replying) return false;
          storage.focusPos = pos;
          storage.composing = false;
          storage.replying = false;
          dispatch?.(ui(tr));
          return true;
        },
      /** The margin measured its room, and it changed (CommentsMargin.tsx). */
      setCommentMarginRoom:
        (room: boolean) =>
        ({ tr, dispatch }) => {
          if (storage.marginRoom === room) return false;
          storage.marginRoom = room;
          dispatch?.(ui(tr));
          return true;
        },
      /** The pointer is over this comment's card or row (or nothing). */
      hoverComment:
        (pos: number | null) =>
        ({ tr, dispatch }) => {
          if (storage.hoverPos === pos) return false;
          storage.hoverPos = pos;
          dispatch?.(ui(tr));
          return true;
        },
      /**
       * The pointer is over this comment's Resolve button. Deleting a comment
       * deletes text, and in page view that text is hidden — so the script
       * says what is about to go before it goes.
       */
      doomComment:
        (pos: number | null) =>
        ({ tr, dispatch }) => {
          if (storage.doomedPos === pos) return false;
          storage.doomedPos = pos;
          dispatch?.(ui(tr));
          return true;
        },
      /**
       * Comment on the selection (docs/app/writing/comments.md#COMM-D6) — Docs' ⌘⌥M. A Fountain note anchors at
       * a point, so the comment lands immediately AFTER the selected text,
       * and that text is marked as what the comment is about
       * (docs/app/writing/comments.md#COMM-60): the highlight paints it and
       * nothing else. Born with placeholder text because an empty inline node
       * cannot hold the DOM caret (breaks.ts); the card opens over it and the
       * first save replaces it.
       */
      addComment:
        () =>
        ({ tr, state, dispatch }) => {
          const to = commentPlace(state);
          if (to === null) return false;
          if (!dispatch) return true;
          // A phrase that already has a comment gets an answer, not a second
          // comment in front of the first: a note put here would become the
          // head of that thread and turn the comment into its reply.
          const here = KEY.getState(state)?.threads.find(
            (thread) => to >= thread.root.pos && to <= thread.end,
          );
          if (here) {
            storage.focusPos = here.root.pos;
            storage.composing = false;
            storage.replying = true;
            dispatch(ui(tr));
            return true;
          }
          insertComment(state, tr, to);
          storage.focusPos = to;
          storage.composing = true;
          storage.replying = false;
          dispatch(ui(tr));
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    // ⌘⇧C (the feed) is bound at the window, not here: it opens a PANE, which
    // is App's business, and it has to work while the caret is anywhere.
    return {
      [binding("⌘⌥M")]: () => this.editor.commands.addComment(),
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const storage = this.storage;

    const marker = (pos: number, text: string, mark: string): HTMLElement => {
      const el = document.createElement("span");
      el.className = `pl-comment-marker${mark}`;
      el.title = truncate(text);
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", "Comment");
      el.addEventListener("mousedown", (e) => {
        // Keep the editor's selection; the marker only moves the reading focus.
        e.preventDefault();
        e.stopPropagation();
        editor.commands.focusComment(pos);
      });
      return el;
    };

    const build = (
      doc: PMNode,
      marks: Pick<PluginState, "activePos" | "hoverPos" | "doomedPos">,
      identities = new Map<number, string>(),
    ): PluginState => {
      const scan = scanComments(doc);
      const entries = scan.entries.map((entry) => ({
        ...entry,
        id: identities.get(entry.pos) ?? entry.id,
      }));
      const threads = commentThreads(entries);
      storage.count = threads.length;
      const decos: Decoration[] = [];
      const commentOnlyBlocks = new Set<number>();
      // One marker and one highlight for a conversation, at its comment: the
      // replies sit at the same point and are read on the same card.
      for (const { root, replies } of threads) {
        const { pos, text, anchorFrom, anchorTo } = root;
        const mark = emphasis(pos, marks);
        // A standalone comment's block is hidden whole in page view, and a
        // marker inside it would be hidden with it — so that one hangs off the
        // block's position instead, where it can be seen and hovered.
        const markerPos = root.standalone ? root.blockPos : pos;
        decos.push(
          Decoration.widget(markerPos, () => marker(pos, text, mark), {
            // In a line the marker is drawn past the caret, so a caret or a
            // selection that ends at the comment ends in the words before it.
            // Drawn before the caret, it left the selection's end between the
            // marker and the hidden comment, and both browsers then took the
            // comment out with the words typed over
            // (docs/app/writing/comments.md#COMM-62).
            side: root.standalone ? -1 : 1,
            key: `cm-${pos}-${mark}-${replies.length}-${text.length}-${text.slice(0, 16)}`,
          }),
        );
        if (anchorFrom !== null && anchorTo !== null && anchorFrom < anchorTo) {
          decos.push(
            Decoration.inline(anchorFrom, anchorTo, { class: `pl-comment-anchor${mark}` }),
          );
        }
      }
      // A marker that fences nothing is a note nobody should see or count.
      for (const { pos, size } of scan.strayMarkers) {
        decos.push(Decoration.node(pos, pos + size, { class: "pl-range-marker" }));
      }
      for (const entry of entries) {
        if (entry.standalone) commentOnlyBlocks.add(entry.blockPos);
      }
      for (const blockPos of commentOnlyBlocks) {
        const node = doc.nodeAt(blockPos);
        if (node) {
          decos.push(
            Decoration.node(blockPos, blockPos + node.nodeSize, { class: "pl-commentonly" }),
          );
        }
      }
      return {
        entries,
        threads,
        deadRanges: scan.deadRanges,
        ...marks,
        deco: decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty,
      };
    };

    return [
      new Plugin<PluginState>({
        key: KEY,
        state: {
          init: (_config, state) =>
            build(state.doc, { activePos: null, hoverPos: null, doomedPos: null }),
          apply: (tr: Transaction, prev: PluginState): PluginState => {
            const ui = tr.getMeta(KEY) as UiMeta | undefined;
            const next = ui
              ? {
                  activePos: storage.focusPos,
                  hoverPos: storage.hoverPos,
                  doomedPos: storage.doomedPos,
                }
              : { activePos: prev.activePos, hoverPos: prev.hoverPos, doomedPos: prev.doomedPos };
            if (tr.docChanged) {
              // Every emphasis moves with the text it annotates.
              const move = (pos: number | null) => (pos === null ? null : tr.mapping.map(pos, -1));
              next.activePos = move(next.activePos);
              next.hoverPos = move(next.hoverPos);
              next.doomedPos = move(next.doomedPos);
              storage.focusPos = next.activePos;
              storage.hoverPos = next.hoverPos;
              storage.doomedPos = next.doomedPos;
              return build(tr.doc, next, commentIdsAfter(tr, prev.entries));
            }
            if (
              next.activePos !== prev.activePos ||
              next.hoverPos !== prev.hoverPos ||
              next.doomedPos !== prev.doomedPos
            ) {
              return build(
                tr.doc,
                next,
                new Map(prev.entries.map((entry) => [entry.pos, entry.id])),
              );
            }
            return prev;
          },
        },
        /**
         * A range whose comment was deleted, or whose text all was, is no
         * range: its marks come off, in the step that ended it, so undo puts
         * the whole of it back. Nothing is added here, only taken away, and
         * never from the text being typed.
         */
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          return clearDeadRanges(newState, KEY.getState(newState)?.deadRanges ?? []);
        },
        props: {
          decorations(state) {
            return KEY.getState(state)?.deco ?? DecorationSet.empty;
          },
          transformPasted(slice) {
            return ownPastedRanges(slice);
          },
          /**
           * Clicking commented text reads that comment — Docs' gesture, and
           * the reason the highlight is worth painting. Returns false: the
           * caret still lands where the writer clicked.
           */
          handleClick(view, pos) {
            const state = KEY.getState(view.state);
            if (!state) return false;
            for (const { root, end } of state.threads) {
              const from = root.anchorFrom ?? root.pos;
              if (pos >= from && pos <= end) {
                if (root.pos !== state.activePos) editor.commands.focusComment(root.pos);
                return false;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comments: {
      /** Read the comment at `pos` — highlight its text, raise its card. */
      focusComment: (pos: number | null) => ReturnType;
      /** The pointer is over this comment: light its text up. */
      hoverComment: (pos: number | null) => ReturnType;
      /** This comment is about to be resolved: show the text it takes. */
      doomComment: (pos: number | null) => ReturnType;
      /** Comment on the selection (⌘⌥M): a note after it, open for typing. */
      addComment: () => ReturnType;
      /** Whether the margin has room for its cards, as it last measured. */
      setCommentMarginRoom: (room: boolean) => ReturnType;
    };
  }
  interface Storage {
    comments: CommentsStorage;
  }
}
