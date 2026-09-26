// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Breaks and emphasis — the two capabilities that were fully built
 * and completely invisible.
 *
 * Both were reachable only by a chord nothing on screen named: Shift+Enter for a
 * line break (docs/app/writing/editor-ux.md#EDIT-38), ⌘B/⌘I/⌘U for emphasis. A forced page break was worse than
 * invisible — the node has been in the schema and honored by the engine from the
 * start, and no key, button or menu row could produce one.
 *
 * They live here rather than in element-entry.ts because three callers need
 * them: the keymap, the element bar's buttons, and the leader menu. The
 * predicates are exported so a button can be *disabled* where a gesture has no
 * business, instead of silently doing nothing when clicked.
 */
import type { CommandProps, Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { LINE_BREAK } from "./bridge";

/**
 * Blocks that hold many lines — and blank lines between them — as ONE element.
 * Headings, cues, and transitions stay single-line by construction: a Fountain
 * cue is one line, and a two-line one re-parses as somebody's speech.
 *
 * Parenthetical is the one absence that looks arbitrary (a design note once flagged it
 * as "the exclusion the code doesn't justify"), and it isn't: the serializer
 * writes a wryly as `(${text})` on ONE line, so a break inside would emit
 * `(first` … `second)` and neither line re-parses as a parenthetical. Admitting
 * it means teaching serialize + parse a multi-line wryly shape first; until
 * then, the fence is what protects the round trip.
 */
const SOFT_BREAK_OK = new Set(["action", "dialogue", "lyric"]);

/** Can Shift+Enter put another line inside this block? */
export function canSoftBreak(node: PMNode): boolean {
  return node.isTextblock && SOFT_BREAK_OK.has(node.type.name);
}

/**
 * Blocks where inline emphasis has meaning.
 *
 * A cue is a NAME, and a heading's weight comes from the format spec's
 * `fontStyle`, which has to stay the single source of truth for element-level
 * styling — so bolding one is either invisible in print or a second, conflicting
 * opinion about how that element looks. It would also travel to the `.fountain`
 * as literal asterisks around the cue. The fence covers the bar's buttons AND
 * ⌘B/⌘I/⌘U, so the two can never disagree about what is allowed.
 */
const EMPHASIS_OK = new Set(["action", "dialogue", "parenthetical", "lyric", "centered"]);

/** Do emphasis marks belong in this block? */
export function canEmphasize(node: PMNode): boolean {
  return node.isTextblock && EMPHASIS_OK.has(node.type.name);
}

/**
 * Shift+Enter: one line break, and stay exactly where you are.
 *
 * Enter is the predictive key — it advances to the next likely element, and can
 * promote an ALL-CAPS Action to a cue or a "… TO:" line to a Transition.
 * Shift+Enter never changes what you're writing and never adds a blank line: the
 * next line simply sits under this one, single-spaced, in the same block. Where
 * a writer wants air between two beats, that is Enter's job (a new block, which
 * the format spaces), not this one's.
 *
 * The break is a `lineBreak` NODE that bridge.ts maps to a literal newline,
 * which galley (pre-wrap), engine (splitParagraphs), serializer and PDF all
 * carry natively — a "\n" in the text would be normalized away by
 * contenteditable at the end of a block.
 */
export function insertLineBreak(editor: Editor): boolean {
  if (!canSoftBreak(editor.state.selection.$from.parent)) return false;
  return editor.chain().focus().insertContent({ type: LINE_BREAK }).scrollIntoView().run();
}

/**
 * `!` or `@` typed at the start of a line that a soft break made: the sigil
 * forces the element there, as it does at the start of a block (docs/app/writing/editor-ux.md#EDIT-D100
 * docs/app/writing/editor-ux.md#EDIT-D111).
 *
 * A Fountain sigil belongs to a LINE. The other rules anchor to the block start
 * because a block is a line almost everywhere — but inside a speech or a stage
 * direction Shift+Enter makes a line that is not a block, and `@SAM` typed
 * there stayed literal dialogue: the writer asked for a cue and got a speech
 * with an at sign in it.
 *
 * So the break is where the new element begins. The break goes, the block
 * splits there, and that line becomes a forced Character (`@`, keeping its case
 * the way a forced cue does) or a forced Action (`!`). Lines after it in the
 * old block stay what they were, in a block of their own below the new element:
 * a cue owns one line, and a speech that carried on beneath it is still that
 * speech. The sigil itself is consumed, never stored.
 *
 * Mutates `tr` and returns whether it did anything — pure over the document, so
 * it is tested without a DOM.
 */
export function sigilAfterBreak(tr: Transaction, pos: number, sigil: "!" | "@"): boolean {
  const $pos = tr.doc.resolve(pos);
  const parent = $pos.parent;
  if (!canSoftBreak(parent) || $pos.nodeBefore?.type.name !== LINE_BREAK) return false;
  const nodes = tr.doc.type.schema.nodes;
  const target = sigil === "@" ? nodes.character : nodes.action;
  if (!target) return false;

  // Where this line ends: the next break in the same block, if there is one.
  const start = $pos.start();
  let nextBreak = -1;
  parent.forEach((child, offset) => {
    const at = start + offset;
    if (nextBreak < 0 && at >= pos && child.type.name === LINE_BREAK) nextBreak = at;
  });

  // Back to front, so the second edit's positions are untouched by the first.
  if (nextBreak >= 0) {
    tr.delete(nextBreak, nextBreak + 1);
    tr.split(nextBreak, 1, [{ type: parent.type, attrs: parent.attrs }]);
  }
  const breakAt = pos - 1;
  tr.delete(breakAt, pos);
  tr.split(breakAt, 1, [{ type: target, attrs: sigil === "@" ? { forced: true } : null }]);
  const inside = breakAt + 2;
  if (sigil === "@") {
    // A cue is a name: emphasis carried over from the speech has no home here
    // (canEmphasize), and would travel to the file as literal asterisks.
    const $cue = tr.doc.resolve(inside);
    tr.removeMark($cue.start(), $cue.end());
  }
  tr.setSelection(TextSelection.create(tr.doc, inside));
  return true;
}

/**
 * A forced page break (Fountain `===`).
 *
 * On an EMPTY block it replaces that block, which is the gesture a writer
 * actually makes: caret on the blank line between two scenes, break here. On a
 * block with words in it the break lands AFTER the whole block rather than
 * splitting it mid-sentence — a page break inside a stage direction is not a
 * thing anyone means. Either way an Action follows it, so the caret always has
 * somewhere to be and the document never ends on an atom.
 *
 * The transform is a pure function of the state (and therefore testable without
 * a DOM); `insertPageBreak` is the command that dispatches it.
 */
export function pageBreakTr(state: EditorState): Transaction | null {
  const pageBreak = state.schema.nodes.pageBreak;
  const action = state.schema.nodes.action;
  if (!pageBreak || !action) return null;
  const $from = state.selection.$from;
  if ($from.depth < 1) return null;
  const parent = $from.parent;
  const empty = parent.isTextblock && parent.content.size === 0;
  const at = empty ? $from.before() : $from.after();
  const tr = state.tr.replaceWith(at, empty ? $from.after() : at, [
    pageBreak.create(),
    action.create(),
  ]);
  // pageBreak is an atom (size 1), so the new Action's content starts at +2.
  return tr.setSelection(TextSelection.create(tr.doc, at + 2));
}

export function insertPageBreak(editor: Editor): boolean {
  return editor
    .chain()
    .focus()
    .command(({ state, dispatch }) => {
      const tr = pageBreakTr(state);
      if (!tr) return false;
      dispatch?.(tr.scrollIntoView());
      return true;
    })
    .run();
}

/** ⌘B/⌘I/⌘U, and the bar's B/I/U — one fence, two doors. */
export function toggleEmphasis(editor: Editor, name: string): boolean {
  if (!canEmphasize(editor.state.selection.$from.parent)) return false;
  return editor.chain().focus().toggleMark(name).run();
}

/**
 * Insert a comment — a Fountain note (`[[ ]]`) — at the caret, born with
 * placeholder text SELECTED so the first keystroke replaces it in place.
 *
 * Born-with-text is load-bearing, not cosmetic: an EMPTY inline node cannot
 * hold the DOM caret — the browser normalizes the cursor to just after the
 * node, so everything typed lands outside it (the same contenteditable
 * family as bridge.ts's trailing-newline note). The typed `[[ … ]]` route
 * (input-rules.ts) avoids the trap the same way, by wrapping on close.
 */
export function insertNoteStep({ tr, state, dispatch }: CommandProps): boolean {
  const noteType = state.schema.nodes.note;
  if (!noteType) return false;
  if (!dispatch) return true;
  const placeholder = "comment";
  const pos = tr.selection.from;
  tr.insert(pos, noteType.create(null, state.schema.text(placeholder)));
  tr.setSelection(
    TextSelection.create(tr.doc, pos + 1, pos + 1 + placeholder.length),
  );
  return true;
}

/** The leader menu's `n`: insert a comment and land inside it. */
export function insertNote(editor: Editor): boolean {
  return editor
    .chain()
    .focus()
    .command(insertNoteStep)
    .scrollIntoView()
    .run();
}

/**
 * Enter INSIDE a comment: one line break, never a new block — and never a
 * blank line, which would end the note on the next parse (a Fountain note may
 * span lines but not blank lines). At the start of the note, or beside an
 * existing break, the key is swallowed rather than allowed to split the note.
 */
export function noteEnter(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if ($from.parent.type.name !== "note") return false;
  const beforeBreak = !$from.nodeBefore || $from.nodeBefore.type.name === LINE_BREAK;
  const afterBreak = $from.nodeAfter?.type.name === LINE_BREAK;
  if (beforeBreak || afterBreak) return true; // swallow: no blank lines in a note
  return editor.chain().insertContent({ type: LINE_BREAK }).run();
}
