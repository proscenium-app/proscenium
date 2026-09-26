// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The script edits the guide makes itself, as plain transactions: preparing a
 * step's line, a Show Me, a Skip that later steps build on, a Fix, and the
 * bundled exchange a lesson opened first needs (docs/app/preferences-and-help/tutorials.md#TUT-D104,
 * docs/app/keeping-work/storage-and-file-format.md#STOR-176).
 *
 * Every one of them ADDS or CONVERTS; none removes a word the writer typed.
 * They run only in the practice play (the controller checks that before it
 * dispatches), through `view.dispatch`, so they take the same path as typing:
 * the editor's plugins, the undo history, autosave and recovery.
 *
 * Each is a function of the editor state alone, so they are tested headlessly.
 */
import { Fragment, type Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { pageBreakTr } from "../editor/breaks";
import { LINE_BREAK } from "../editor/bridge";
import { blockPos } from "./ghost";
import { EXAMPLE } from "./lessons";
import { nameLike } from "./coach";

const empty = (n: PMNode | null | undefined) => !!n && n.isTextblock && n.content.size === 0;
const endOf = (state: EditorState, index: number) => (blockPos(state, index) ?? 0) + 1 + state.doc.child(index).content.size;
const last = (state: EditorState) => state.doc.childCount - 1;
function lastCue(state: EditorState): number | null {
  for (let i = last(state); i >= 0; i--) {const n = state.doc.child(i); if (n.type.name === "character" && n.textContent.trim()) return i;}
  return null;
}
const block = (state: EditorState, type: string, text = "") => state.schema.nodes[type].create(null, text ? state.schema.text(text) : null);
const caretAt = (tr: Transaction, pos: number) => tr.setSelection(TextSelection.create(tr.doc, pos));

/** An empty line at the end of the script, with the cursor in it. */
export function endLineTr(state: EditorState, type = "action"): Transaction {
  const tr = state.tr;
  const end = state.doc.lastChild;
  if (empty(end) && (end!.type.name === type || end!.type.name === "action")) {
    if (end!.type.name !== type) tr.setNodeMarkup(blockPos(state, last(state))!, state.schema.nodes[type]);
    return caretAt(tr, state.doc.content.size - 1);
  }
  tr.insert(state.doc.content.size, block(state, type));
  return caretAt(tr, tr.doc.content.size - 1);
}

/** The newest cue's speech, with the cursor at its end; null when there is no cue to speak for. */
export function speechTr(state: EditorState): Transaction | null {
  const cue = lastCue(state);
  if (cue === null) return null;
  const tr = state.tr;
  const next = cue + 1 < state.doc.childCount ? state.doc.child(cue + 1) : null;
  const at = blockPos(state, cue)! + state.doc.child(cue).nodeSize;
  if (next?.type.name === "dialogue") return caretAt(tr, endOf(state, cue + 1));
  if (empty(next)) tr.setNodeMarkup(at, state.schema.nodes.dialogue);
  else tr.insert(at, block(state, "dialogue"));
  return caretAt(tr, tr.doc.resolve(at + 1).end());
}

/** A speaker at the end of the script: the typed name if the end line holds one, else `name`. */
export function nameTr(state: EditorState, name: string): Transaction {
  const end = state.doc.lastChild!;
  const endText = end.textContent.trim();
  const tr = state.tr;
  let at: number;
  if (end.isTextblock && (end.type.name === "action" || end.type.name === "character") && (!endText || nameLike(endText))) {
    at = blockPos(state, last(state))!;
    const text = (endText || name).toUpperCase();
    tr.replaceWith(at, at + end.nodeSize, block(state, "character", text));
  } else {
    at = state.doc.content.size;
    tr.insert(at, block(state, "character", name));
  }
  const after = at + tr.doc.nodeAt(at)!.nodeSize;
  tr.insert(after, block(state, "dialogue"));
  return caretAt(tr, after + 1);
}

/** Words for the newest speech when it is empty; `finish` then starts the next line, as Return does. */
export function speakTr(state: EditorState, text: string, finish: boolean): Transaction | null {
  const prepared = speechTr(state);
  if (!prepared) return null;
  const tr = prepared;
  const $at = tr.selection.$from;
  if ($at.parent.content.size === 0) tr.insertText(text, $at.pos);
  if (!finish) return caretAt(tr, tr.doc.resolve(tr.selection.from).end());
  const after = tr.doc.resolve(tr.selection.from).after();
  const following = after < tr.doc.content.size ? tr.doc.nodeAt(after) : null;
  if (!empty(following)) tr.insert(after, block(state, "action"));
  return caretAt(tr, after + 1);
}

/** The bundled exchange, after everything else, for a lesson that needs a speech to work on. */
export function exchangeTr(state: EditorState): Transaction {
  const nodes = [block(state, "character", EXAMPLE.first), block(state, "dialogue", EXAMPLE.line),
    block(state, "character", EXAMPLE.second), block(state, "dialogue", EXAMPLE.reply)];
  const end = state.doc.lastChild;
  const tr = state.tr;
  if (empty(end)) tr.replaceWith(blockPos(state, last(state))!, state.doc.content.size, Fragment.from(nodes));
  else tr.insert(state.doc.content.size, Fragment.from(nodes));
  return caretAt(tr, tr.doc.content.size - 1);
}

/** The first spoken line's block index, or null. */
function firstSpeech(state: EditorState): number | null {
  for (let i = 0; i < state.doc.childCount; i++) {const n = state.doc.child(i); if (n.type.name === "dialogue" && n.textContent.trim()) return i;}
  return null;
}
/** Show Me for emphasis: the first word of the first speech, in bold. */
export function emphasisTr(state: EditorState): Transaction | null {
  const i = firstSpeech(state);
  if (i === null) return null;
  const start = blockPos(state, i)! + 1;
  const word = state.doc.child(i).textContent.match(/^\s*\S+/)?.[0].length ?? 0;
  if (!word) return null;
  const strong = state.schema.marks.strong;
  return caretAt(state.tr.addMark(start, start + word, strong.create()), start + word);
}
/** Show Me for Line Break: the first speech goes on, on a new line. */
export function lineBreakTr(state: EditorState): Transaction | null {
  const i = firstSpeech(state);
  if (i === null) return null;
  const end = endOf(state, i);
  const tr = state.tr.insert(end, [state.schema.nodes[LINE_BREAK].create(), state.schema.text(EXAMPLE.more)]);
  return caretAt(tr, end + 1 + EXAMPLE.more.length);
}
/** Show Me for Page Break: one after the last line, so a scene added next starts on a fresh page. */
export function pageBreakAtEndTr(state: EditorState): Transaction | null {
  const at = state.apply(caretAt(state.tr, endOf(state, last(state))));
  const tr = pageBreakTr(at);
  if (!tr) return null;
  // Rebase the break onto a transaction that starts from `state`.
  const out = caretAt(state.tr, endOf(state, last(state)));
  for (const step of tr.steps) out.step(step);
  return caretAt(out, tr.selection.from);
}

/** Fix: the line a name was typed on becomes the cue it was meant to be, and the line under it Dialogue. */
export function cueFixTr(state: EditorState, index: number): Transaction | null {
  const at = blockPos(state, index);
  if (at === null) return null;
  const node = state.doc.child(index);
  const tr = state.tr.replaceWith(at, at + node.nodeSize, block(state, "character", node.textContent.trim().toUpperCase()));
  const after = at + tr.doc.nodeAt(at)!.nodeSize;
  const next = after < tr.doc.content.size ? tr.doc.nodeAt(after) : null;
  if (empty(next)) tr.setNodeMarkup(after, state.schema.nodes.dialogue);
  else tr.insert(after, block(state, "dialogue"));
  return caretAt(tr, after + 1);
}
/** Fix: block `index` becomes `type`, with the cursor at its end. */
export function retypeTr(state: EditorState, index: number, type: string): Transaction | null {
  const at = blockPos(state, index);
  if (at === null || !state.doc.child(index).isTextblock) return null;
  const tr = state.tr.setNodeMarkup(at, state.schema.nodes[type]);
  return caretAt(tr, endOf(state, index));
}
