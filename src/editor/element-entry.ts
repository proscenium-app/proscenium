// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Basic element entry (build-plan E: "manual set + minimal predictive Enter —
 * enough to draft"). The full system — auto-detection input rules, character
 * autocomplete, leader keys — is unit I (docs/app/writing/editor-ux.md#EDIT-D107).
 *
 * What ships here:
 *  - Predictive Enter: advance to the most likely next element. On an empty
 *    element — the second Enter of a pair — open the element menu instead, with
 *    the obvious other thing already chosen.
 *  - Tab / Shift-Tab: cycle the current line through the body-element ring.
 *  - ⌘⌥ mnemonic chords: set the current element directly (the contract letters).
 *  - ⌘B/⌘I/⌘U: bold / italic / underline.
 */
import { Extension } from "@tiptap/core";
import type { CommandProps, Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { insertLineBreak, insertPageBreak, noteEnter, toggleEmphasis } from "./breaks";
import { LINE_BREAK } from "./bridge";
import { armLeaderMenu } from "./leader-key";
import { BODY_ELEMENTS } from "./schema";

// Enter on a NON-EMPTY element → the most likely next element.
const ADVANCE: Record<string, string> = {
  act: "scene",
  scene: "action",
  sceneHeading: "action",
  action: "action",
  character: "dialogue",
  parenthetical: "dialogue",
  dialogue: "action",
  transition: "scene",
  lyric: "lyric",
};

// Enter on an EMPTY element opens the element menu with this row chosen: the
// obvious other thing, which the same Enter used to turn the line into.
const EMPTY_PROMOTE: Record<string, string> = {
  action: "character",
  dialogue: "action",
  character: "action",
  parenthetical: "dialogue",
  // A verse advances to another lyric line while there's text; an empty one is
  // the writer saying they're done singing, so the menu offers Action rather
  // than another lyric.
  lyric: "action",
};

// Enter-time confirmers (docs/app/writing/editor-ux.md#EDIT-D100): an ALL-CAPS action becomes a Character
// cue; an uppercase line ending TO: becomes a Transition.
const NATURAL_SLUG = /^(?:(?:int|i)\.?\/(?:ext|e)|int|ext|est)[. ]/i;
/**
 * Lines that are transitions rather than cues.
 *
 * The screen vocabulary (`… TO:`, `FADE OUT.`) is what serialize.ts recognises,
 * because those are the lines Fountain re-parses as transitions unforced. But
 * this is a STAGE app, and the stage words were missing: docs/app/writing/editor-ux.md#EDIT-D100's own
 * element table gives "BLACKOUT." and "END OF ACT ONE" as the Transition
 * examples, and typing either of them made a character named BLACKOUT. Curtain
 * belongs to the same family.
 *
 * Deliberately NOT mirrored into serialize.ts, despite the near-identical shape.
 * Serialize uses its regex to decide whether a transition can be written bare;
 * a bare "BLACKOUT." re-parses as a cue, so the serializer must keep forcing
 * `> BLACKOUT.` — and it does. The two regexes answer different questions.
 */
const NATURAL_TRANSITION =
  /^(?:[^a-z]*\bTO:|FADE (?:TO BLACK|OUT)\.|CUT TO BLACK\.|BLACKOUT\.?|CURTAIN\.?|END OF (?:ACT\b.*|PLAY|SCENE\b.*))$/;

function isAllCaps(line: string): boolean {
  return /[A-Z]/.test(line) && !/[a-z]/.test(line);
}

/** Does this block hold a soft break (so it is several lines, not one)? */
function hasLineBreak(node: PMNode): boolean {
  let found = false;
  node.forEach((child) => {
    if (child.type.name === LINE_BREAK) found = true;
  });
  return found;
}

/**
 * What an Enter on this ACTION block confirms it as — a cue, a transition, or
 * nothing (just advance). Exported so the decision is testable without a DOM.
 *
 * The confirmers read the block as ONE line of text, and `textContent` silently
 * concatenates across `lineBreak` nodes. So a two-line ALL-CAPS stage direction
 * ("LIGHTS UP." ⇧⏎ "A DOOR SLAMS.") read as the single caps string
 * "LIGHTS UP.A DOOR SLAMS.", and Enter promoted the whole block to a character
 * cue — which serialized as a cue line followed by a dialogue line, so on the
 * next parse the stage direction had become somebody's speech.
 *
 * A block with breaks in it is prose the writer has been shaping across lines,
 * never a name they have just typed, so it confirms as nothing.
 */
export function confirmActionAs(node: PMNode): "character" | "transition" | null {
  if (node.type.name !== "action" || node.content.size === 0) return null;
  if (hasLineBreak(node)) return null;
  const text = node.textContent;
  if (NATURAL_TRANSITION.test(text)) return "transition";
  if (isAllCaps(text) && !NATURAL_SLUG.test(text)) return "character";
  return null;
}

/**
 * What Enter on this block does, before any key reaches it. Exported so the
 * decision is testable without a DOM.
 *
 * A second Enter lands on the empty line the first one made, which is where a
 * writer reaches for the element picker: dialogue, parenthetical, action
 * (docs/app/writing/editor-ux.md#EDIT-29). It used to turn the line into the likeliest other
 * element (an empty Action became a Character), which left a parenthetical or
 * a transition a chord away; the menu offers every element, and Enter still
 * takes the one it used to make. Shift+Enter is a different key (a line break,
 * breaks.ts) and never reaches this.
 */
export function enterDecision(
  node: PMNode,
):
  | { kind: "confirm"; as: "character" | "transition" }
  | { kind: "menu"; suggested: string }
  | { kind: "advance"; to: string } {
  const confirmed = confirmActionAs(node);
  if (confirmed) return { kind: "confirm", as: confirmed };
  const type = node.type.name;
  if (node.content.size === 0) {
    return { kind: "menu", suggested: EMPTY_PROMOTE[type] ?? ADVANCE[type] ?? "action" };
  }
  return { kind: "advance", to: ADVANCE[type] ?? "action" };
}

function currentType(editor: Editor): string | null {
  const node = editor.state.selection.$from.parent;
  return node.isTextblock ? node.type.name : null;
}

/**
 * Set the current block's element — as a chain step, and only when it isn't
 * already that element.
 *
 * The "only when it isn't already" is load-bearing: asking TipTap's `setNode`
 * for a transform it has nothing to do THROWS if anything earlier in the chain
 * changed the document. It tries `setBlockType` as a dry run,
 * prosemirror-commands answers false when the block is already that type,
 * `setNode` reads that as "can't" and falls back to `clearNodes()` — which walks
 * the doc it captured when the chain started while using positions from the
 * transaction as it stands now, and dies on the first position past the old
 * doc's end ("Position N out of range").
 *
 * A plain split has produced an `action` ever since Action became the schema's
 * default block, and Enter in a stage direction advances to Action — so the
 * gesture at the dead centre of drafting walked straight into it. Reading the
 * post-split block first keeps the whole advance one transaction (one undo step)
 * and never asks for a no-op.
 */
const setElement =
  (target: string) =>
  ({ state, commands }: CommandProps): boolean =>
    state.selection.$from.parent.type.name === target ? true : commands.setNode(target);

function handleEnter(editor: Editor): boolean {
  let node = editor.state.selection.$from.parent;
  // Inside a comment ([[ ]]): mid-text, Enter is a line break, never a split
  // — and never a blank line, which would end the note on the next parse
  // (breaks.ts). AT the note's boundary, though, the writer means the block:
  // in page view the note is hidden, and the DOM caret at the marker's edge
  // resolves as inside-the-note — swallowing Enter there made the key go
  // dead at the end of any commented line. Hop outside and fall through.
  if (node.type.name === "note") {
    const $from = editor.state.selection.$from;
    const atStart = $from.parentOffset === 0;
    const atEnd = $from.parentOffset === node.content.size;
    if (!atStart && !atEnd) return noteEnter(editor);
    // Hop PAST the note from either boundary before the normal split: the
    // comment then stays anchored to its own line and the caret lands in a
    // genuinely empty block — a position the DOM can represent, so the
    // visible caret and the document agree (a caret directly beside hidden
    // note content has no DOM anchor, and typing follows the DOM).
    editor.commands.setTextSelection($from.after());
    node = editor.state.selection.$from.parent;
  }
  if (!node.isTextblock) return false;

  const decision = enterDecision(node);
  // Confirm an ALL-CAPS action as a Character cue (→ Dialogue), or a `… TO:`
  // line as a Transition (→ Scene), before the normal predictive advance.
  if (decision.kind === "confirm" && decision.as === "character") {
    return editor
      .chain()
      .command(setElement("character"))
      .splitBlock()
      .command(setElement("dialogue"))
      .run();
  }
  if (decision.kind === "confirm") {
    return editor
      .chain()
      .command(setElement("transition"))
      .splitBlock()
      .command(setElement("scene"))
      .run();
  }
  if (decision.kind === "menu") return armLeaderMenu(editor.view, decision.suggested);

  return editor.chain().splitBlock().command(setElement(decision.to)).run();
}

function cycle(editor: Editor, dir: 1 | -1): boolean {
  const type = currentType(editor);
  const ring = BODY_ELEMENTS as readonly string[];
  const i = type ? ring.indexOf(type) : -1;
  const next = i === -1 ? ring[0] : ring[(i + dir + ring.length) % ring.length];
  return editor.chain().focus().setNode(next).run();
}

/**
 * Tab (docs/app/writing/editor-ux.md#EDIT-58): on an EMPTY line, open the element menu
 * (the same picker the ";" leader draws) — you haven't typed yet, so picking
 * beats cycling. On a non-empty line, cycle the ring as always.
 */
function handleTab(editor: Editor): boolean {
  const node = editor.state.selection.$from.parent;
  if (node.isTextblock && node.content.size === 0) {
    return armLeaderMenu(editor.view);
  }
  return cycle(editor, 1);
}

export const ElementEntry = Extension.create({
  name: "elementEntry",

  addKeyboardShortcuts() {
    const set = (name: string) => () => this.editor.chain().focus().setNode(name).run();
    const mark = (name: string) => () => toggleEmphasis(this.editor, name);

    return {
      Enter: () => handleEnter(this.editor),
      // In a comment, Shift+Enter matches Enter (a break; never a split).
      "Shift-Enter": () => insertLineBreak(this.editor) || noteEnter(this.editor),
      // A forced page break — the same node `===` parses to (docs/app/writing/editor-ux.md#EDIT-60).
      "Mod-Enter": () => insertPageBreak(this.editor),
      Tab: () => handleTab(this.editor),
      "Shift-Tab": () => cycle(this.editor, -1),

      // ⌘⌥ mnemonic chords — the fixed contract letters (docs/app/writing/editor-ux.md#EDIT-D100).
      "Mod-Alt-a": set("action"),
      "Mod-Alt-c": set("character"),
      "Mod-Alt-d": set("dialogue"),
      "Mod-Alt-p": set("parenthetical"),
      "Mod-Alt-t": set("transition"),
      "Mod-Alt-s": set("sceneHeading"), // ⌘S is save → scene heading is ⌘⌥S
      "Mod-Alt-1": set("act"),
      "Mod-Alt-2": set("scene"),
      "Mod-Alt-l": set("lyric"),

      // Emphasis.
      "Mod-b": mark("strong"),
      "Mod-i": mark("em"),
      "Mod-u": mark("underline"),
    };
  },
});
