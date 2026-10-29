// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a list holds together in a document (the prose editor's lists; a script
 * has none).
 *
 * A list is easy to make and should be hard to break by accident. The editor's
 * stock keys broke one in four ways: Backspace at the start of an item tore the
 * list in two with a loose paragraph between; a numbered list split by anything
 * started again at 1 below the split; Shift-Tab at the top level threw the item
 * out of the list; and Tab on an item that could not indent sent the keyboard
 * to whatever control came next. None of those is something a writer asked for.
 *
 * The rules here, which are what a writer's hands already know from a word
 * processor:
 *
 *  - Return makes the next item; Return on an empty item steps out one level,
 *    and out of the list from the top level. That is the one way out by key,
 *    and every editor shares it.
 *  - Shift-Return makes a new line inside the same item.
 *  - Backspace at the start of an item takes its marker away and keeps its
 *    words in the list, as a line of the item above; a second Backspace joins
 *    the two lines. The first item of a nested list steps out a level, and the
 *    first item of the whole list becomes a paragraph above it.
 *  - Tab and Shift-Tab indent and outdent, and do nothing else: the top level
 *    is as far out as Shift-Tab goes.
 *  - Two lists of one kind that come to touch are one list.
 *  - A numbered list goes on counting across whatever interrupts it, until the
 *    writer starts it again at 1 or at a number they type.
 *
 * The keys are plain ProseMirror commands, so the tests run them on a bare
 * state with no page.
 */
import { Extension } from "@tiptap/core";
import { Fragment, type Node as PMNode, type NodeType } from "@tiptap/pm/model";
import { liftListItem, sinkListItem } from "@tiptap/pm/schema-list";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { canJoin, Mapping } from "@tiptap/pm/transform";

const ITEM = "listItem";
const NUMBERED = "orderedList";
const isList = (node: PMNode | null | undefined): boolean =>
  !!node && (node.type.name === NUMBERED || node.type.name === "bulletList");

/** The items the selection covers, as the list commands see them. */
function itemRange(state: EditorState, item: NodeType) {
  const { $from, $to } = state.selection;
  return $from.blockRange($to, (node) => node.childCount > 0 && node.firstChild!.type === item);
}

/**
 * Backspace at the very start of an item.
 *
 * With an item above, at any depth: the marker goes and the words stay in the
 * list, as a new line at the end of the line above. Items nested under this one
 * keep their depth, under the item it joined. With no item above in its list:
 * a nested item steps out one level and a top-level one leaves the list, which
 * is the only thing Backspace can mean on the first line of a list.
 */
export const backspaceAtItemStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  const depth = $from.depth - 1;
  if (!empty || $from.parentOffset !== 0 || depth < 1) return false;
  const item = $from.node(depth);
  const para = $from.parent;
  if (item.type.name !== ITEM || $from.index(depth) !== 0 || para.type.name !== "paragraph")
    return false;

  const index = $from.index(depth - 1);
  if (index === 0) return liftListItem(item.type)(state, dispatch);

  // The line above: the last line of the item before this one, however deep
  // that item's own lists go.
  const itemStart = $from.before(depth);
  let node = $from.node(depth - 1).child(index - 1);
  let pos = itemStart - node.nodeSize;
  let line: PMNode;
  let linePos: number;
  for (;;) {
    const last = node.lastChild;
    if (!last) return false;
    const lastPos = pos + 1 + node.content.size - last.nodeSize;
    if (isList(last) && last.lastChild) {
      node = last.lastChild;
      pos = lastPos + 1 + last.content.size - node.nodeSize;
      continue;
    }
    // A quote or a table as an item's last block has no line to join.
    if (last.type.name !== "paragraph") return false;
    line = last;
    linePos = lastPos;
    break;
  }

  if (dispatch) {
    const end = linePos + 1 + line.content.size;
    const under = item.content.cut(para.nodeSize);
    const br = state.schema.nodes.hardBreak;
    const broken = !!br && line.content.size > 0 && para.content.size > 0;
    const words = broken ? Fragment.from(br.create()).append(para.content) : para.content;
    // Last position first, so no step moves the ground under the next.
    const tr = state.tr.delete(itemStart, $from.after(depth));
    if (under.size) tr.insert(itemStart - 1, under);
    if (words.size) tr.insert(end, words);
    tr.setSelection(TextSelection.create(tr.doc, end + (broken ? 1 : 0)));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Tab in a list indents the item under the one above it. An item with nothing
 * above it has nowhere to go, and `stay` says whether the key is spent anyway:
 * on a page it is, so the keyboard does not leave for the next control.
 */
export function indentItem(stay: boolean): Command {
  return (state, dispatch) => {
    const item = state.schema.nodes[ITEM];
    if (!item || !itemRange(state, item)) return false;
    return sinkListItem(item)(state, dispatch) || stay;
  };
}

/** Shift-Tab steps a nested item out one level, and stops at the top level. */
export function outdentItem(stay: boolean): Command {
  return (state, dispatch) => {
    const item = state.schema.nodes[ITEM];
    const range = item && itemRange(state, item);
    if (!item || !range) return false;
    if (state.selection.$from.node(range.depth - 1).type !== item) return stay;
    return liftListItem(item)(state, dispatch);
  };
}

// ----------------------------------------------------------------- numbering

/** The innermost numbered list the caret is in, and where it starts. */
function numberedAt(state: EditorState): { node: PMNode; pos: number; depth: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === NUMBERED) return { node, pos: $from.before(depth), depth };
  }
  return null;
}

/** The number the numbered list before `index`, among `parent`'s children, would give next. */
function nextBefore(parent: PMNode, index: number): number | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const node = parent.child(i);
    if (node.type.name === NUMBERED) return Number(node.attrs.start ?? 1) + node.childCount;
  }
  return null;
}

export interface Numbering {
  /** The number the list's first item shows. */
  start: number;
  /** Whether it is counting on from the numbered list above it. */
  continues: boolean;
  /** The number it would take up if it continued, or null with no list above. */
  next: number | null;
}

/** What the formatting bar shows for the list the caret is in; null outside a numbered list. */
export function numberingAt(state: EditorState): Numbering | null {
  const at = numberedAt(state);
  if (!at) return null;
  const { $from } = state.selection;
  return {
    start: Number(at.node.attrs.start ?? 1),
    continues: !!at.node.attrs.continues,
    next: nextBefore($from.node(at.depth - 1), $from.index(at.depth - 1)),
  };
}

/** Start the list the caret is in at `start`, on its own count. */
export function startNumberingAt(start: number): Command {
  return (state, dispatch) => {
    const at = numberedAt(state);
    if (!at) return false;
    dispatch?.(state.tr.setNodeMarkup(at.pos, null, { ...at.node.attrs, start, continues: false }));
    return true;
  };
}

/** Have the list the caret is in count on from the numbered list above it. */
export const continueNumbering: Command = (state, dispatch) => {
  const at = numberedAt(state);
  const next = numberingAt(state)?.next ?? null;
  if (!at || next === null) return false;
  dispatch?.(
    state.tr.setNodeMarkup(at.pos, null, { ...at.node.attrs, start: next, continues: true }),
  );
  return true;
};

/**
 * What a change leaves behind, put right in the same step, so it is one undo:
 *
 *  1. A numbered list cut in two (an item in its middle turned into a
 *     paragraph) goes on counting below the cut. Lifting copies the list's
 *     attributes to both halves, so the lower half would say 1 again.
 *  2. Two lists of one kind with nothing between them are one list. The file
 *     cannot say otherwise: a blank line between items is still one list.
 *  3. A list that continues takes the number the list above it has reached,
 *     and a list whose number IS the next number continues. That second half
 *     is the file's rule (doc.ts), kept here so the page and the file agree
 *     while the page is being edited.
 */
export function settleLists(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
): Transaction | null {
  if (!transactions.some((tr) => tr.docChanged)) return null;
  const tr = newState.tr;

  // 1. The lower halves of lists this change cut.
  const mapping = new Mapping();
  for (const t of transactions) mapping.appendMapping(t.mapping);
  const back = mapping.invert();
  newState.doc.descendants((node, pos) => {
    if (node.type.name !== NUMBERED || node.attrs.continues) return;
    const depth = newState.doc.resolve(pos).depth + 1;
    const $old = oldState.doc.resolve(back.map(pos, 1));
    // Where this list starts now was, before, the inside of a numbered list
    // among the same siblings...
    if ($old.depth < depth || $old.node(depth).type.name !== NUMBERED) return;
    // ...whose upper half is still a list, above this one.
    const head = mapping.map($old.before(depth), -1);
    if (head < pos && newState.doc.nodeAt(head)?.type.name === NUMBERED)
      tr.setNodeMarkup(pos, null, { ...node.attrs, continues: true });
  });

  // 2. Lists that touch. From the end, so each join leaves the earlier ones where they were.
  const seams: number[] = [];
  tr.doc.descendants((node, pos) => {
    if (node.isTextblock) return false;
    let at = pos + 1;
    for (let i = 0; i < node.childCount - 1; i += 1) {
      const child = node.child(i);
      at += child.nodeSize;
      if (isList(child) && child.type === node.child(i + 1).type) seams.push(at);
    }
    return true;
  });
  // The document's own children: `descendants` starts below the root.
  let at = 0;
  for (let i = 0; i < tr.doc.childCount - 1; i += 1) {
    const child = tr.doc.child(i);
    at += child.nodeSize;
    if (isList(child) && child.type === tr.doc.child(i + 1).type) seams.push(at);
  }
  for (const seam of seams.sort((a, b) => b - a)) if (canJoin(tr.doc, seam)) tr.join(seam);

  // 3. The numbers.
  const count = (parent: PMNode, inside: number) => {
    let next: number | null = null;
    let pos = inside;
    parent.forEach((node) => {
      if (node.type.name === NUMBERED) {
        let start = Number(node.attrs.start ?? 1);
        let continues = !!node.attrs.continues;
        if (continues && next === null) continues = false;
        else if (continues) start = next!;
        else if (start === next) continues = true;
        if (start !== Number(node.attrs.start ?? 1) || continues !== !!node.attrs.continues)
          tr.setNodeMarkup(pos, null, { ...node.attrs, start, continues });
        next = start + node.childCount;
      }
      pos += node.nodeSize;
    });
  };
  const settled = tr.doc;
  count(settled, 0);
  settled.descendants((node, pos) => {
    if (node.isBlock && !node.isTextblock && node.childCount) count(node, pos + 1);
    return !node.isTextblock;
  });

  return tr.steps.length ? tr : null;
}

const key = new PluginKey("documentLists");

/**
 * The extension the prose editor loads. Its keys come before the stock list
 * keys, which stay for everything these decline (Delete at the end of an item,
 * Backspace on the paragraph under a list).
 */
export const DocumentLists = Extension.create({
  name: "documentLists",
  priority: 1000,

  addGlobalAttributes() {
    return [
      {
        types: [NUMBERED],
        attributes: {
          continues: {
            default: false,
            parseHTML: (el: HTMLElement) => el.hasAttribute("data-continues"),
            /* The page draws its own numbers (`.prose li::before`), from a
               counter, and a counter cannot read `start`: a list that does not
               begin at 1 says here where its count stands before its first
               item. */
            renderHTML: (attrs: Record<string, unknown>) => {
              const before = Number(attrs.start ?? 1) - 1;
              return {
                ...(attrs.continues ? { "data-continues": "" } : {}),
                ...(before ? { style: `counter-reset: prose-item ${before}` } : {}),
              };
            },
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    /* On a page, ⌃⇥ is the key that leaves it (the accessibility contract's
       areas), so Tab in a list is the list's. In a sheet there is no such key,
       and a Tab the list cannot use moves on, as Tab does everywhere else in
       the sheet: a list alone in a field must not hold the keyboard. */
    const stay = () => !this.editor.view.dom.closest('[aria-modal="true"]');
    const run = (command: Command) => command(this.editor.state, this.editor.view.dispatch);
    return {
      // Straight after a list was made by typing its marker, Backspace takes
      // the automatic change back, as it does for every other one.
      Backspace: () => this.editor.commands.undoInputRule() || run(backspaceAtItemStart),
      // ⌘⌫ at the start of an item has no line to clear, and is the same key.
      "Mod-Backspace": () => run(backspaceAtItemStart),
      Tab: () => run(indentItem(stay())),
      "Shift-Tab": () => run(outdentItem(stay())),
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin({ key, appendTransaction: settleLists })];
  },
});
