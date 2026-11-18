// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every line of speech on the page has a cue over it
 * (docs/app/writing/editor-ux.md#EDIT-193). A line of speech or a bracketed
 * one with no cue over it is a stage direction to every Fountain reader, so it
 * was dialogue on the page and a stage direction on the next reopen, with
 * nothing in between to say so. The gestures that made one are the ordinary
 * ones: a direction typed into the middle of a speech, a paragraph of a speech
 * turned into a direction, a line after a direction turned into speech, a cue
 * deleted or turned into something else.
 *
 * So after each change the page is put the way the script will read it, in
 * the same undo step as the change:
 *  - a speech that a direction now parts from its cue, and a line after a
 *    direction turned into speech, get the speaker's name over them again,
 *    the way a printed play repeats it after a direction: the cue they had,
 *    or for a line that had none, the last cue in the scene above it;
 *  - a speech whose cue is gone, or with no speaker above it in its scene, is
 *    the stage direction the file will make of it now, a bracketed line with
 *    its brackets.
 *
 * Only what has no cue over it is touched: a cue with no name yet is a cue,
 * so a name being typed again never moves the speech under it.
 *
 * Backspace and Delete stop at a cue (docs/app/writing/editor-ux.md#EDIT-210).
 * They joined the lines either side of the key, so Backspace at the start of a
 * name ran it into the line above, the cue was gone, and every line of its
 * speech was a stage direction; Enter to part the lines again left the name a
 * stage direction too. One Backspace too many in a name being typed again did
 * the same. So neither key ever runs a name into another line, or a line into
 * a name, and a cue with no name yet stays over its speech. An empty line next
 * to a cue still goes, and the same speaker twice in a row is one speech again
 * when Backspace takes the second name.
 */
import { Extension, isiOS, isMacOS } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type Command, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { cueNamePart } from "../fountain/cue";

/** What can stand in a speech under its cue. */
const IN_SPEECH = new Set(["dialogue", "parenthetical", "lyric"]);
/** What is what it is only under a cue: a lyric has its own mark. */
const NEEDS_CUE = new Set(["dialogue", "parenthetical"]);
/** Where a scene begins: a speaker above one is no speaker below it. */
const SCENE_START = new Set(["act", "scene", "sceneHeading"]);

/** A run of speech lines with no cue over it, from its first line that needs one. */
interface CuelessRun {
  from: number;
  to: number;
}

/** Each run of speech lines whose spoken or bracketed lines have no cue over them. */
export function cuelessRuns(doc: PMNode): CuelessRun[] {
  const runs: CuelessRun[] = [];
  let i = 0;
  while (i < doc.childCount) {
    if (!IN_SPEECH.has(doc.child(i).type.name)) {
      i++;
      continue;
    }
    const start = i;
    while (i < doc.childCount && IN_SPEECH.has(doc.child(i).type.name)) i++;
    if (start > 0 && doc.child(start - 1).type.name === "character") continue;
    for (let k = start; k < i; k++) {
      if (NEEDS_CUE.has(doc.child(k).type.name)) {
        runs.push({ from: k, to: i });
        break;
      }
    }
  }
  return runs;
}

/** A cue's name without its extension or its comments. */
function nameOf(cue: PMNode): string {
  let text = "";
  cue.forEach((child) => {
    if (child.isText) text += child.text;
  });
  return cueNamePart(text);
}

/** The block a position stands in, at the top of the document. */
function blockAt(doc: PMNode, pos: number): { index: number; node: PMNode } {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  const index = Math.min($pos.index(0), doc.childCount - 1);
  return { index, node: doc.child(index) };
}

function offsetOf(doc: PMNode, index: number): number {
  let pos = 0;
  for (let k = 0; k < index; k++) pos += doc.child(k).nodeSize;
  return pos;
}

/** The last cue with a name above block `index`, in its scene. */
function speakerAbove(doc: PMNode, index: number): PMNode | null {
  for (let k = index - 1; k >= 0; k--) {
    const node = doc.child(k);
    if (SCENE_START.has(node.type.name)) return null;
    if (node.type.name === "character" && nameOf(node)) return node;
  }
  return null;
}

/**
 * Who speaks the run, or null when its speech has lost its cue. A line that
 * stood under a cue before the change keeps that cue's speaker while the cue
 * is still a cue of that name. A line that stood under none takes the last
 * speaker above it in the scene.
 */
function speakerOf(
  run: CuelessRun,
  before: PMNode,
  after: PMNode,
  changes: Mapping,
): PMNode | null {
  const at = offsetOf(after, run.from) + 1;
  const was = blockAt(before, changes.invert().map(at, -1));
  let k = was.index;
  if (IN_SPEECH.has(was.node.type.name)) {
    while (k >= 0 && IN_SPEECH.has(before.child(k).type.name)) k--;
  } else {
    k = -1;
  }
  if (k < 0 || before.child(k).type.name !== "character") return speakerAbove(after, run.from);
  const cue = before.child(k);
  const now = blockAt(after, changes.map(offsetOf(before, k) + 1, 1)).node;
  return now.type.name === "character" && nameOf(now) && nameOf(now) === nameOf(cue) ? now : null;
}

/** The plugin by itself: it needs a document and no editor, so tests run it bare. */
export function speechCuesPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions: readonly Transaction[], oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      const runs = cuelessRuns(newState.doc);
      if (runs.length === 0) return null;
      const changes = new Mapping();
      for (const tr of transactions) changes.appendMapping(tr.mapping);
      const { schema } = newState;
      const tr = newState.tr;
      // From the bottom up, so each run's positions stand while it is changed.
      for (const run of [...runs].reverse()) {
        const speaker = speakerOf(run, oldState.doc, newState.doc, changes);
        if (speaker) {
          const name = nameOf(speaker);
          const cue = schema.nodes.character.create(
            { forced: speaker.attrs.forced === true },
            schema.text(name),
          );
          tr.insert(offsetOf(newState.doc, run.from), cue);
          continue;
        }
        for (let k = run.to - 1; k >= run.from; k--) {
          const node = newState.doc.child(k);
          if (!NEEDS_CUE.has(node.type.name)) continue;
          const pos = offsetOf(newState.doc, k);
          if (node.type.name === "parenthetical") {
            tr.insertText(")", pos + 1 + node.content.size);
            tr.insertText("(", pos + 1);
          }
          tr.setNodeMarkup(pos, schema.nodes.action);
        }
      }
      return tr.docChanged ? tr : null;
    },
  });
}

const isCue = (node: PMNode | null): boolean => node?.type.name === "character";
const isSpeech = (node: PMNode | null): boolean => !!node && IN_SPEECH.has(node.type.name);
const isEmpty = (node: PMNode): boolean => node.content.size === 0;

/** The cue over the speech line at `index`, or null when it stands under none. */
function cueOver(doc: PMNode, index: number): PMNode | null {
  let k = index;
  while (k >= 0 && IN_SPEECH.has(doc.child(k).type.name)) k--;
  return k >= 0 && isCue(doc.child(k)) ? doc.child(k) : null;
}

/**
 * Backspace (`dir` -1) at the start of a line, or Delete (`dir` 1) at the end
 * of one, where joining the two lines would take a cue away
 * (docs/app/writing/editor-ux.md#EDIT-210). True when it has dealt with the
 * key, by stopping or by its own change; false for the keys' usual join.
 *
 * Both keys join the same two lines, `above` and `below`, as ProseMirror's
 * `joinBackward` and `joinForward` do: an empty `above` is taken away and
 * `below` stays as it was; otherwise `below`'s words run onto the end of
 * `above`, and `below` is gone.
 */
export function cueStop(dir: -1 | 1): Command {
  return (state, dispatch, view) => {
    const { selection, doc } = state;
    if (!(selection instanceof TextSelection)) return false;
    const $cursor = selection.$cursor;
    if ($cursor?.depth !== 1) return false;
    let a: number;
    if (dir < 0) {
      const atStart = view ? view.endOfTextblock("backward", state) : $cursor.parentOffset === 0;
      if (!atStart) return false;
      a = $cursor.index(0) - 1;
      // The first line of the script: the editor's own Backspace makes an empty
      // one a stage direction, which an empty cue over a speech must not become.
      if (a < 0) {
        const first = doc.child(0);
        return isCue(first) && isEmpty(first) && doc.childCount > 1 && isSpeech(doc.child(1));
      }
    } else {
      const atEnd = view
        ? view.endOfTextblock("forward", state)
        : $cursor.parentOffset === $cursor.parent.content.size;
      if (!atEnd) return false;
      a = $cursor.index(0);
    }
    if (a < 0 || a + 1 >= doc.childCount) return false;
    const above = doc.child(a);
    const below = doc.child(a + 1);
    const after = a + 2 < doc.childCount ? doc.child(a + 2) : null;
    if (!above.isTextblock || !below.isTextblock) return false;
    const aboveAt = offsetOf(doc, a);
    const belowAt = aboveAt + above.nodeSize;

    // The same speaker twice in a row: the second name goes, and the two
    // speeches are one. Only a name of plain letters, so no comment goes with it.
    const speaker = isSpeech(above) ? cueOver(doc, a) : null;
    if (
      speaker &&
      isCue(below) &&
      !isEmpty(below) &&
      nameOf(below) !== "" &&
      nameOf(below) === nameOf(speaker) &&
      speaker.attrs.dual !== true &&
      below.attrs.dual !== true
    ) {
      let plain = true;
      below.forEach((child) => {
        if (!child.isText) plain = false;
      });
      if (plain) {
        if (dispatch) {
          const tr = state.tr.delete(belowAt, belowAt + below.nodeSize);
          tr.setSelection(TextSelection.create(tr.doc, aboveAt + 1 + above.content.size));
          dispatch(tr.scrollIntoView());
        }
        return true;
      }
    }

    if (isEmpty(above)) {
      // The join takes `above` away: harmless unless it is the cue of `below`.
      if (!(isCue(above) && isSpeech(below))) return false;
      // An empty line under a cue with no name yet: the line goes, the cue stays.
      if (isEmpty(below)) {
        if (dispatch) {
          const tr = state.tr.delete(belowAt, belowAt + below.nodeSize);
          tr.setSelection(TextSelection.create(tr.doc, aboveAt + 1));
          dispatch(tr.scrollIntoView());
        }
      }
      return true;
    }
    // The join runs `below` onto `above`.
    if (isCue(above) && !isEmpty(below)) return true;
    if (isCue(below) && (!isEmpty(below) || isSpeech(after))) return true;
    return false;
  };
}

export const SpeechCues = Extension.create({
  name: "speechCues",

  addKeyboardShortcuts() {
    const key = (dir: -1 | 1) => () => {
      // A rule's own undo comes first, as it does in the editor's own keys.
      if (dir < 0 && this.editor.can().undoInputRule()) return false;
      const { view } = this.editor;
      return cueStop(dir)(view.state, view.dispatch, view);
    };
    const back = key(-1);
    const forward = key(1);
    // Every key the editor's own Backspace and Delete are bound to.
    const keys: Record<string, () => boolean> = {
      Backspace: back,
      "Mod-Backspace": back,
      "Shift-Backspace": back,
      Delete: forward,
      "Mod-Delete": forward,
    };
    if (isMacOS() || isiOS()) {
      Object.assign(keys, {
        "Ctrl-h": back,
        "Alt-Backspace": back,
        "Ctrl-d": forward,
        "Ctrl-Alt-Backspace": forward,
        "Alt-Delete": forward,
        "Alt-d": forward,
      });
    }
    return keys;
  },

  addProseMirrorPlugins() {
    return [speechCuesPlugin()];
  },
});
