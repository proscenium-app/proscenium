// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Auto-detection (docs/app/writing/editor-ux.md#EDIT-D111) — as you type a Fountain cue,
 * the block becomes the right element and the trigger sigil is stripped, so the
 * stored text stays canonical. Each rule fires inside the input transaction, so
 * it's a single undo step (Backspace reverts it).
 *
 * Round-trip-safe: sigils are stripped from stored text (`@ ! ~ = > # (`); a
 * forced `@` cue sets `forced` so auto-caps preserves its case; INT/EXT slug
 * lines keep their text (the heading IS that text).
 */
import { Extension, InputRule, markInputRule, textblockTypeInputRule } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { canEmphasize, sigilAfterBreak } from "./breaks";

/** The input range is authoritative: the DOM caret can move before the
 * selection transaction arrives (for example after clicking another cue). */
export function dualCueInput(tr: Transaction, range: { from: number; to: number }): boolean {
  const $from = tr.doc.resolve(range.from);
  if ($from.parent.type.name !== "character" || range.to !== $from.end()) return false;
  const pos = $from.before();
  const dual = $from.parent.attrs.dual === true;
  tr.delete(range.from, range.to).setNodeAttribute(pos, "dual", !dual);
  return true;
}

export const AutoDetect = Extension.create({
  name: "autoDetect",

  addInputRules() {
    const nodes = this.editor.schema.nodes;
    const t = (name: string) => nodes[name];

    return [
      // Structural sections
      textblockTypeInputRule({ find: /^#\s$/, type: t("act") }),
      textblockTypeInputRule({ find: /^##\s$/, type: t("scene") }),
      textblockTypeInputRule({
        find: /^###\s$/,
        type: t("scene"),
        getAttributes: () => ({ level: 3 }),
      }),

      // Body sigils (strip the sigil, set the element)
      textblockTypeInputRule({ find: /^=\s$/, type: t("synopsis") }),
      textblockTypeInputRule({ find: /^>\s$/, type: t("transition") }),
      textblockTypeInputRule({ find: /^~$/, type: t("lyric") }),
      textblockTypeInputRule({ find: /^!$/, type: t("action") }),
      // `(` → parenthetical; the closing paren is the node's CSS rendering, never
      // stored text (so it can't double on round-trip).
      textblockTypeInputRule({ find: /^\($/, type: t("parenthetical") }),
      // `@` → forced character, preserving mixed case (auto-caps skips `forced`).
      textblockTypeInputRule({
        find: /^@$/,
        type: t("character"),
        getAttributes: () => ({ forced: true }),
      }),
      // …and the same two at the start of a line a soft break made, which is a
      // line but not a block (breaks.ts `sigilAfterBreak`). At a block start the
      // rules above match first; anywhere but right after a break these decline
      // and the character is typed as itself.
      ...(["!", "@"] as const).map(
        (sigil) =>
          new InputRule({
            find: sigil === "!" ? /!$/ : /@$/,
            handler: ({ range, chain }) => {
              chain()
                .command(({ tr }) => sigilAfterBreak(tr, range.from, sigil))
                .run();
            },
          }),
      ),

      // INT/EXT/EST/I/E slug → scene heading, keeping the slug text.
      new InputRule({
        find: /^(?:int|ext|est|i\/e|e\/i)[.\s]$/i,
        handler: ({ chain }) => {
          chain().setNode("sceneHeading").run();
        },
      }),
      // Leading `.` then non-space → forced scene heading; the matched dot is
      // stripped and the text after it kept (forcing is re-derived on serialize).
      textblockTypeInputRule({ find: /^\.(?=[^\s.])/, type: t("sceneHeading") }),

      // A script is typed on a grid: an ellipsis is THREE DOTS, never the
      // single "…" glyph (one cell where three belong). This rule catches the
      // glyph when it arrives as TYPED TEXT; EllipsisFloor below catches every
      // other route, including the one that actually bites.
      new InputRule({
        find: /…/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).insertContent("...").run();
        },
      }),

      // Fountain `^` at the end of a cue toggles dual dialogue: the sigil is
      // stripped (never stored text — serialize re-emits it from the attr) and
      // this cue becomes/stops being the RIGHT half of a side-by-side pair.
      new InputRule({
        find: /\s?\^$/,
        handler: ({ state, range }) => { dualCueInput(state.tr, range); },
      }),

      // ---- Typed Fountain parity (audit 2026-08-12; docs/app/writing/comments.md#COMM-D6) ----

      // Typed comments wrap ON CLOSE: `[[` stays literal while you type, and
      // the closing `]]` turns the whole `[[ … ]]` into a note node with the
      // brackets stripped (they are sigils, never stored text). Wrapping on
      // close rather than opening an empty note is load-bearing: an EMPTY
      // inline node cannot hold the DOM caret — the browser drops the cursor
      // just after it, so the first typed character lands OUTSIDE the node
      // (same normalization family as the trailing-newline problem bridge.ts
      // documents). A note born with its text inside never hits that.
      new InputRule({
        find: /\[\[([^[\]]+)\]\]$/,
        handler: ({ state, range, match, chain }) => {
          const parent = state.doc.resolve(range.from).parent.type.name;
          // Inside a note the brackets stay literal; boneyard is verbatim
          // omitted text (its content model has no inline nodes).
          if (parent === "note" || parent === "boneyard") return;
          const noteType = state.schema.nodes.note;
          if (!noteType) return;
          const inner = match[1];
          chain()
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true;
              const node = noteType.create(null, state.schema.text(inner));
              tr.replaceWith(range.from, range.to, node);
              tr.setSelection(TextSelection.create(tr.doc, range.from + node.nodeSize));
              return true;
            })
            .run();
        },
      }),

      // `]]` typed inside an EXISTING comment (editing its chip) steps back
      // out of it, dropping the stray `]` the first keypress left behind.
      new InputRule({
        find: /\]\]$/,
        handler: ({ state, range, chain }) => {
          const $pos = state.doc.resolve(range.from);
          if ($pos.parent.type.name !== "note") return;
          const empty = $pos.parent.content.size - (range.to - range.from) <= 0;
          const from = empty ? $pos.before() : range.from;
          const to = empty ? $pos.after() : range.to;
          chain()
            .command(({ tr, dispatch }) => {
              if (!dispatch) return true;
              tr.delete(from, to);
              tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map($pos.after())));
              return true;
            })
            .run();
        },
      }),

      // A line of exactly `===` becomes a forced page break (the same node the
      // leader's `-`, ⌘⏎ and the bar button insert; serialize writes `===`).
      new InputRule({
        find: /^===$/,
        handler: ({ state, range, chain }) => {
          // The ^$-anchored find already proves the line up to the caret is
          // exactly the (partly pending) `===` — input may arrive per-key OR
          // as one batched insert, so never read the block's current text.
          // The one thing the regex cannot see is content AFTER the caret.
          const $to = state.doc.resolve(range.to);
          if ($to.parent.type.name !== "action") return;
          if ($to.parentOffset !== $to.parent.content.size) return;
          const before = $to.before();
          const after = $to.after();
          chain()
            .command(({ tr, state: s, dispatch }) => {
              const pageBreak = s.schema.nodes.pageBreak;
              const action = s.schema.nodes.action;
              if (!pageBreak || !action) return false;
              if (!dispatch) return true;
              tr.replaceWith(before, after, [pageBreak.create(), action.create()]);
              // pageBreak is an atom (size 1): the new Action starts at +2.
              tr.setSelection(TextSelection.create(tr.doc, before + 2));
              return true;
            })
            .run();
        },
      }),

      // Fountain's `> text <`: a trailing `<` on a transition makes it
      // centered text (the `>` already made it a transition as it was typed).
      new InputRule({
        find: /<$/,
        handler: ({ state, chain }) => {
          const $from = state.selection.$from;
          if ($from.parent.type.name !== "transition") return;
          if ($from.parentOffset !== $from.parent.content.size) return;
          chain().setNode("centered").run();
        },
      }),

      // Typed emphasis — `**bold**`, `*italic*`, `_underline_` — behind the
      // same fence as ⌘B/⌘I/⌘U (breaks.ts): a cue is a name, a heading's
      // weight belongs to the format spec. Outside the fence the characters
      // stay literal, exactly as typed.
      ...(["strong", "em", "underline"] as const).map((markName) => {
        // TipTap's own word-boundary shapes (bold/italic), underscore mapped
        // to Fountain's underline. Mid-word emphasis stays on ⌘B/⌘I/⌘U.
        const find = {
          strong: /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/,
          em: /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/,
          underline: /(?:^|\s)(_(?!\s+_)((?:[^_]+))_(?!\s+_))$/,
        }[markName];
        const base = markInputRule({ find, type: this.editor.schema.marks[markName] });
        return new InputRule({
          find,
          handler: (props) => {
            if (!canEmphasize(props.state.selection.$from.parent)) return;
            base.handler(props);
          },
        });
      }),
    ];
  },
});

const ellipsisKey = new PluginKey("ellipsisFloor");

/**
 * The ellipsis floor: `…` cannot survive in the document, by ANY route.
 *
 * The input rule above only fires for text that arrives through
 * `handleTextInput` — i.e. keystrokes. macOS's own smart substitution does not
 * come that way: it rewrites the contenteditable DOM directly (the same
 * mechanism as an autocorrect replacement), so the rule never sees it. What the
 * writer gets instead is the symptom they see — the three dots they typed
 * become one narrow glyph on a monospace grid, and then snap back to three cells
 * when ProseMirror re-syncs the DOM against the document. Everything after the
 * ellipsis on that line visibly moves.
 *
 * Measured in browser dev by rewriting the text node the way substitution does:
 * the DOM read "She waits…" while the document still read "She waits...", and
 * the next flush repainted the DOM back. Divergence either way is a bug — if the
 * read had gone the other way, the glyph would have landed in the `.fountain`.
 *
 * So the normalization moves off the typing path and onto the DOCUMENT, as an
 * appendTransaction: whatever put a `…` there — OS substitution, a drop, an IME,
 * a restored version — it is three dots again in the same dispatch. Marks
 * are carried over, so a glyph inside emphasis stays emphasized. Boneyard is
 * left alone: it is verbatim omitted content, not text the format governs.
 *
 * This terminates: the appended transaction is itself re-examined, finds no
 * glyph, and returns null.
 */
export function ellipsisTr(state: EditorState): Transaction | null {
  const hits: { from: number; to: number; marks: readonly Mark[] }[] = [];
  state.doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text) return;
    if (parent?.type.name === "boneyard") return;
    for (let i = node.text.indexOf("…"); i !== -1; i = node.text.indexOf("…", i + 1)) {
      hits.push({ from: pos + i, to: pos + i + 1, marks: node.marks });
    }
  });
  if (hits.length === 0) return null;
  const tr = state.tr;
  // Right to left, so the positions collected above stay valid.
  for (let i = hits.length - 1; i >= 0; i--) {
    const hit = hits[i]!;
    tr.replaceWith(hit.from, hit.to, state.schema.text("...", hit.marks));
  }
  return tr;
}

export const EllipsisFloor = Extension.create({
  name: "ellipsisFloor",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ellipsisKey,
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          return ellipsisTr(newState);
        },
      }),
    ];
  },
});
