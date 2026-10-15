// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The text a comment is about (docs/app/writing/comments.md#COMM-D13), held two
 * ways, with this module the only place one becomes the other.
 *
 * **In the script** a comment is a Fountain note at a point, and Fountain has
 * no way to say "from here to there". So the stretch is fenced by two more
 * notes: `[[{]]` where it begins, `[[}]]` where it ends, directly before the
 * comment it belongs to.
 *
 *     She pauses [[{]]at the door[[}]][[Robin: too long?]] and turns.
 *
 * **In the editor** a hidden note in the middle of a sentence is a place the
 * caret can be lost in, and one the writer can delete half of without seeing
 * it. So the editor holds no marker at all: the stretch is a MARK on its
 * words (`commentRange`) and one on its comment (`commentRangeEnd`), with one
 * `id` between them, which the editor already knows how to keep through
 * typing, cutting, splitting and undo. The stretch runs from the first words
 * that carry the id to the comment that does.
 *
 * Two marks and not one, because a browser draws one mark over neighbours as
 * one element: with the comment inside the words' element, selecting the words
 * and typing over them deleted the element, and the hidden comment with it.
 *
 * `rangesToEditor` and `rangesFromEditor` are each other's inverse on anything
 * the app wrote. A pair of markers that is not one the app would write (no
 * comment after the `}`, no text after the `{`, one of them in a cue or a
 * heading) is left as the two notes it is: hidden, never shown as comments,
 * and written back exactly as it was read.
 *
 * Pure: document JSON in, document JSON out.
 */
import type { Doc } from "../fountain";
import { holdsCommentRange, isAnchorNoteText, rangeMarker, rangeMarkerText } from "./model";

/** The editor mark on the words a comment is about. */
export const COMMENT_RANGE = "commentRange";
/** The editor mark on the comment those words belong to. */
export const COMMENT_RANGE_END = "commentRangeEnd";

const isRangeMark = (mark: { type: string }) =>
  mark.type === COMMENT_RANGE || mark.type === COMMENT_RANGE_END;

interface JsonMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface JsonInline {
  type: string;
  text?: string;
  marks?: JsonMark[];
  content?: JsonInline[];
}

interface JsonBlock {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JsonInline[];
}

/** Where an inline node stands: its block, and its place among the block's children. */
interface Spot {
  b: number;
  i: number;
}

const before = (a: Spot, b: Spot) => a.b < b.b || (a.b === b.b && a.i < b.i);

/** A note's text as the script holds it: a line break is a node on the page. */
function noteInner(node: JsonInline): string {
  return (node.content ?? []).map((n) => (n.type === "lineBreak" ? "\n" : (n.text ?? ""))).join("");
}

function markerOf(node: JsonInline) {
  return node.type === "note" ? rangeMarker(noteInner(node)) : null;
}

/** A note a writer or a reader wrote: not a marker, not a scene anchor. */
function isCommentNote(node: JsonInline | undefined): boolean {
  if (node?.type !== "note") return false;
  const text = noteInner(node);
  return !rangeMarker(text) && !isAnchorNoteText(text);
}

const isWords = (node: JsonInline | undefined) => node?.type === "text" && !!node.text;

function markerNote(side: "open" | "close", label: string): JsonInline {
  return { type: "note", content: [{ type: "text", text: rangeMarkerText(side, label) }] };
}

function rangeIdsOn(node: JsonInline, type: string): string[] {
  const ids: string[] = [];
  for (const mark of node.marks ?? []) {
    if (mark.type === type && typeof mark.attrs?.id === "string") ids.push(mark.attrs.id);
  }
  return ids;
}

function withRange(node: JsonInline, type: string, ids: readonly string[]): JsonInline {
  if (!ids.length) return node;
  const added = ids.map((id) => ({ type, attrs: { id } }));
  return { ...node, marks: [...(node.marks ?? []), ...added] };
}

function withoutRanges(node: JsonInline): JsonInline {
  if (!node.marks?.some(isRangeMark)) return node;
  const marks = node.marks.filter((mark) => !isRangeMark(mark));
  const { marks: _dropped, ...rest } = node;
  return marks.length ? { ...rest, marks } : rest;
}

const sameMarks = (a: JsonInline, b: JsonInline) =>
  JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? []);

/** Append a node, joining it to the text before it when nothing tells them apart. */
function pushInline(out: JsonInline[], node: JsonInline): void {
  const last = out[out.length - 1];
  if (last?.type === "text" && node.type === "text" && sameMarks(last, node)) {
    out[out.length - 1] = { ...last, text: `${last.text ?? ""}${node.text ?? ""}` };
  } else {
    out.push(node);
  }
}

interface MarkerToken<T> {
  side: "open" | "close";
  label: string;
  ref: T;
}

/**
 * Which `{` each `}` closes: the nearest one before it, with the same number,
 * that nothing has closed yet. Pairs with no number nest like brackets; a
 * numbered pair finds its own whatever stands between.
 */
function matchMarkers<T>(tokens: readonly MarkerToken<T>[]): Map<T, T> {
  const waiting = new Map<string, T[]>();
  const pairs = new Map<T, T>();
  for (const token of tokens) {
    const stack = waiting.get(token.label) ?? [];
    waiting.set(token.label, stack);
    if (token.side === "open") stack.push(token.ref);
    else {
      const open = stack.pop();
      if (open !== undefined) pairs.set(token.ref, open);
    }
  }
  return pairs;
}

interface ReadRange {
  open: Spot;
  close: Spot;
}

/** The marker pairs the app would have written, in the order of their comments. */
function readRanges(blocks: readonly JsonBlock[]): ReadRange[] {
  const tokens: MarkerToken<Spot>[] = [];
  blocks.forEach((block, b) =>
    (block.content ?? []).forEach((node, i) => {
      const marker = markerOf(node);
      if (marker) tokens.push({ ...marker, ref: { b, i } });
    }),
  );
  if (!tokens.length) return [];
  const live: ReadRange[] = [];
  for (const [close, open] of matchMarkers(tokens)) {
    const closing = blocks[close.b];
    const opening = blocks[open.b];
    // The `}` stands directly before its comment.
    if (!holdsCommentRange(closing.type)) continue;
    if (!isCommentNote(closing.content?.[close.i + 1])) continue;
    // The `{` stands directly before the first word of the stretch; two
    // stretches may begin at one word, their markers side by side.
    if (!holdsCommentRange(opening.type)) continue;
    let first = open.i + 1;
    while (markerOf(opening.content?.[first] ?? { type: "" })?.side === "open") first += 1;
    if (!isWords(opening.content?.[first])) continue;
    live.push({ open, close });
  }
  return live.sort((x, y) => (before(x.close, y.close) ? -1 : 1));
}

/**
 * Script → editor: every pair of markers the app wrote becomes a mark on the
 * text between them and on the comment after them, and the two notes go.
 *
 * `ids` names the ranges in the order of their comments. A caller that will
 * compare the result with a document already on the page passes that
 * document's (`liveRangeIds`), so an unchanged range is an unchanged node.
 */
export function rangesToEditor(doc: Doc, ids: readonly string[] = []): Doc {
  const blocks = doc.content as JsonBlock[];
  const live = readRanges(blocks);
  if (!live.length) return doc;

  const taken = new Set(ids);
  let next = 0;
  const fresh = () => {
    let id: string;
    do id = `r${++next}`;
    while (taken.has(id));
    return id;
  };

  const gone = new Set<JsonInline>();
  const marked = new Map<JsonInline, string[]>();
  const owned = new Map<JsonInline, string>();
  const mark = (node: JsonInline, id: string) =>
    marked.set(node, [...(marked.get(node) ?? []), id]);
  for (const { open, close } of live) {
    gone.add(blocks[open.b].content![open.i]);
    gone.add(blocks[close.b].content![close.i]);
  }
  live.forEach(({ open, close }, k) => {
    const id = ids[k] ?? fresh();
    owned.set(blocks[close.b].content![close.i + 1], id);
    for (let b = open.b; b <= close.b; b++) {
      const block = blocks[b];
      // A cue or a heading inside the stretch is highlighted with it, and
      // carries nothing: the stretch is found from the text around it.
      if (!holdsCommentRange(block.type)) continue;
      const content = block.content ?? [];
      const from = b === open.b ? open.i + 1 : 0;
      const to = b === close.b ? close.i : content.length;
      for (let i = from; i < to; i++) {
        // Words only: a comment inside the stretch is not part of what is
        // commented on, and a line break begins nothing.
        if (isWords(content[i])) mark(content[i], id);
      }
    }
  });

  return {
    ...doc,
    content: blocks.map((block) => {
      const content = block.content;
      if (!content?.some((node) => gone.has(node) || marked.has(node) || owned.has(node))) {
        return block;
      }
      return {
        ...block,
        content: content
          .filter((node) => !gone.has(node))
          .map((node) => {
            const end = owned.get(node);
            return end === undefined
              ? withRange(node, COMMENT_RANGE, marked.get(node) ?? [])
              : withRange(node, COMMENT_RANGE_END, [end]);
          }),
      };
    }),
  } as Doc;
}

interface HeldRange {
  id: string;
  /** The first text of the stretch: its `{` is written directly before it. */
  start: Spot;
  /** The comment: its `}` is written directly before it. */
  owner: Spot;
}

/**
 * The ranges an editor document holds, in the order of their comments. A range
 * is the first words marked with an id, and the first comment marked as its
 * end, in that order, neither of them in a cue or a heading. An id with only
 * one of the two is nothing: its comment was deleted, or all of its words were.
 */
function heldRanges(blocks: readonly JsonBlock[]): HeldRange[] {
  const starts = new Map<string, Spot>();
  const owners = new Map<string, Spot>();
  blocks.forEach((block, b) => {
    if (!holdsCommentRange(block.type)) return;
    (block.content ?? []).forEach((node, i) => {
      if (isWords(node)) {
        for (const id of rangeIdsOn(node, COMMENT_RANGE)) {
          if (!starts.has(id) && !owners.has(id)) starts.set(id, { b, i });
        }
      } else if (isCommentNote(node)) {
        // One `}` stands before a comment, so a comment ends one range.
        const id = rangeIdsOn(node, COMMENT_RANGE_END).find((id) => !owners.has(id));
        if (id !== undefined) owners.set(id, { b, i });
      }
    });
  });
  const held: HeldRange[] = [];
  for (const [id, owner] of owners) {
    const start = starts.get(id);
    if (start) held.push({ id, start, owner });
  }
  return held.sort((x, y) => (before(x.owner, y.owner) ? -1 : 1));
}

/** The ids of an editor document's ranges, in the order of their comments. */
export function liveRangeIds(doc: Doc): string[] {
  return heldRanges(doc.content as JsonBlock[]).map((range) => range.id);
}

/** Where each range's two markers are written: before which child of which block. */
interface MarkerPlaces {
  opensAt: Map<string, HeldRange[]>;
  closeAt: Map<string, HeldRange>;
}

function markerPlaces(held: readonly HeldRange[]): MarkerPlaces {
  const opensAt = new Map<string, HeldRange[]>();
  const closeAt = new Map<string, HeldRange>();
  // Where two stretches begin at one word, the one that ends last opens first.
  for (const range of [...held].reverse()) {
    const key = `${range.start.b}:${range.start.i}`;
    opensAt.set(key, [...(opensAt.get(key) ?? []), range]);
    closeAt.set(`${range.owner.b}:${range.owner.i}`, range);
  }
  return { opensAt, closeAt };
}

/**
 * The number each range's markers must carry to be read back as written. A pair
 * with none closes like a bracket, so two stretches that overlap without one
 * holding the other would trade their beginnings; so would a stretch around a
 * stray marker somebody else left in the script. Each range that would be read
 * wrong takes a number nothing in the script uses, until every one reads right.
 */
function rangeLabels(
  blocks: readonly JsonBlock[],
  held: readonly HeldRange[],
  where: MarkerPlaces,
): Map<string, string> {
  const labels = new Map<string, string>();
  const used = new Set<string>();
  for (const block of blocks) {
    for (const node of block.content ?? []) {
      const marker = markerOf(node);
      if (marker?.label) used.add(marker.label);
    }
  }
  const { opensAt, closeAt } = where;
  const stream = (): MarkerToken<string>[] => {
    const tokens: MarkerToken<string>[] = [];
    blocks.forEach((block, b) =>
      (block.content ?? []).forEach((node, i) => {
        for (const range of opensAt.get(`${b}:${i}`) ?? []) {
          tokens.push({ side: "open", label: labels.get(range.id) ?? "", ref: `open ${range.id}` });
        }
        const closing = closeAt.get(`${b}:${i}`);
        if (closing) {
          const label = labels.get(closing.id) ?? "";
          tokens.push({ side: "close", label, ref: `close ${closing.id}` });
        }
        const stray = markerOf(node);
        if (stray) tokens.push({ ...stray, ref: `stray ${b}:${i}` });
      }),
    );
    return tokens;
  };
  for (;;) {
    const pairs = matchMarkers(stream());
    const wrong = held.find(
      (range) => !labels.has(range.id) && pairs.get(`close ${range.id}`) !== `open ${range.id}`,
    );
    if (!wrong) return labels;
    let n = 1;
    while (used.has(String(n))) n += 1;
    used.add(String(n));
    labels.set(wrong.id, String(n));
  }
}

/**
 * Editor → script: every range becomes its two markers again, and no mark is
 * left on anything. The marks of a range with no comment, or no text, go
 * without a trace: nothing is written for a comment that is gone.
 */
export function rangesFromEditor(doc: Doc): Doc {
  const blocks = doc.content as JsonBlock[];
  const ranged = (node: JsonInline) => !!node.marks?.some(isRangeMark);
  if (!blocks.some((block) => block.content?.some(ranged))) return doc;

  const held = heldRanges(blocks);
  const where = markerPlaces(held);
  const labels = rangeLabels(blocks, held, where);
  const { opensAt, closeAt } = where;

  return {
    ...doc,
    content: blocks.map((block, b) => {
      const content = block.content;
      if (!content) return block;
      const touched = content.some(
        (node, i) => ranged(node) || opensAt.has(`${b}:${i}`) || closeAt.has(`${b}:${i}`),
      );
      if (!touched) return block;
      const out: JsonInline[] = [];
      content.forEach((node, i) => {
        for (const range of opensAt.get(`${b}:${i}`) ?? []) {
          out.push(markerNote("open", labels.get(range.id) ?? ""));
        }
        const closing = closeAt.get(`${b}:${i}`);
        if (closing) out.push(markerNote("close", labels.get(closing.id) ?? ""));
        pushInline(out, withoutRanges(node));
      });
      return { ...block, content: out };
    }),
  } as Doc;
}

/**
 * The script without its range markers: what two versions are compared as, so
 * a stretch marked or unmarked is not read as a change to the words.
 */
export function dropRangeMarkers(doc: Doc): Doc {
  const blocks = doc.content as JsonBlock[];
  if (!blocks.some((block) => block.content?.some((node) => markerOf(node)))) return doc;
  return {
    ...doc,
    content: blocks.map((block) => {
      const content = block.content;
      if (!content?.some((node) => markerOf(node))) return block;
      const out: JsonInline[] = [];
      for (const node of content) if (!markerOf(node)) pushInline(out, node);
      return { ...block, content: out };
    }),
  } as Doc;
}
