// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Find, and find-and-replace, over the script.
 *
 * The search itself is in find-core.ts; this is the ProseMirror half — reading
 * the document into searchable blocks, drawing the highlights, and applying a
 * replace. Four constraints shape it:
 *
 *  - **It searches the DOCUMENT, never the chrome.** Page view draws headers,
 *    page numbers and the re-printed "(CONT'D)" cue as decorations and does not
 *    mutate the doc (docs/app/writing/editor-ux.md#EDIT-D106), so those synthetic strings can
 *    never be hits and every match is findable whether page view is on or off.
 *  - **Highlights are decorations, never marks.** A search must not dirty the
 *    buffer or leave anything in the `.fountain`.
 *  - **Replace-all is ONE transaction**, so it is one undo step and one entry in
 *    Versions (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). A loop of N transactions would litter the
 *    ring and make undo miserable.
 *  - **Replacing inside a cue is a rename**, so it doesn't happen here; nor
 *    does replacing inside a comment, which is a note about the script rather
 *    than the script (docs/app/writing/comments.md#COMM-D9). See `partitionForReplace`.
 */
import { Extension } from "@tiptap/core";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { cuePrefix } from "./cast";
import { LINE_BREAK } from "./bridge";
import { scrollPosIntoView } from "./scroll-to";
import {
  DEFAULT_FIND_OPTIONS,
  findMatches,
  heldBack,
  matchAtOrAfter,
  partitionForReplace,
  stepIndex,
  type FindMatch,
  type FindOptions,
  type IndexedChar,
  type SearchBlock,
} from "./find-core";

export type { FindMatch, FindOptions, FindScope } from "./find-core";
export { DEFAULT_FIND_OPTIONS } from "./find-core";

export const findKey = new PluginKey<FindPluginState>("find");

interface FindPluginState {
  open: boolean;
  replaceOpen: boolean;
  query: string;
  opts: FindOptions;
  matches: FindMatch[];
  /** Index into `matches`; -1 when there are none. */
  index: number;
}

/** What the bar needs to render, mirrored into `editor.storage.find`. */
export interface FindStorage {
  open: boolean;
  replaceOpen: boolean;
  query: string;
  opts: FindOptions;
  total: number;
  /** 1-based position of the current match, or 0 when there are none. */
  current: number;
  /** Matches inside character cues — excluded from replace, shown as a reason. */
  cueMatches: number;
  /** Matches touching a comment — excluded from replace the same way. */
  noteMatches: number;
  /** Why Replace is off for the current match, when it is. */
  currentHeldBack: "cue" | "note" | null;
  /** Cast names present in the doc, for the "MARA's speeches" scope options. */
  speakers: string[];
}

type FindMeta =
  | { kind: "open"; replace: boolean }
  | { kind: "close" }
  | { kind: "query"; query: string }
  | { kind: "opts"; opts: Partial<FindOptions> }
  | { kind: "index"; index: number }
  /** Re-search, then land on the first match at or after `pos`. */
  | { kind: "resume"; pos: number };

/**
 * The document as searchable blocks.
 *
 * Only top-level blocks, because the play document is flat (node order = line
 * order), and each one carries its characters paired with their positions so a
 * match maps back exactly. A `lineBreak` leaf becomes a "\n" that no ordinary
 * query can match through — which is what stops a match from spanning two lines
 * of a speech. Notes ARE searched: they are the writer's own words, and their
 * inner text indexes at its real positions, flagged so Replace can leave it be.
 */
export function searchBlocks(doc: PMNode): SearchBlock[] {
  const blocks: SearchBlock[] = [];
  let speaker: string | null = null;
  doc.forEach((node, offset) => {
    const type = node.type.name;
    const chars: IndexedChar[] = [];
    // Walked by hand rather than with `descendants`, so a note's depth is
    // carried down: everything under a note is in it, however it is nested.
    const walk = (parent: PMNode, start: number, inNote: boolean) => {
      parent.forEach((child, childOffset) => {
        const base = start + childOffset;
        if (child.isText) {
          const text = child.text ?? "";
          for (let i = 0; i < text.length; i++) chars.push({ ch: text[i], pos: base + i, inNote });
        } else if (child.type.name === LINE_BREAK) {
          chars.push({ ch: "\n", pos: base, inNote });
        } else {
          // A note: its content starts one position inside it.
          walk(child, base + 1, inNote || child.type.name === "note");
        }
      });
    };
    // `offset + 1` is the first position inside the block.
    walk(node, offset + 1, false);
    if (type === "character") {
      speaker = cuePrefix(node.textContent).toUpperCase() || null;
    } else if (type !== "dialogue" && type !== "parenthetical" && type !== "lyric") {
      // Anything that isn't part of the speech ends it, so the next speech is
      // never misattributed to the cue above the wrong block.
      speaker = null;
    }
    blocks.push({ type, speaker, chars });
  });
  return blocks;
}

/** Cue names used in the document — the speaker-scope options. */
export function speakersInDoc(doc: PMNode): string[] {
  const seen = new Set<string>();
  doc.forEach((node) => {
    if (node.type.name !== "character") return;
    const name = cuePrefix(node.textContent).toUpperCase();
    if (name) seen.add(name);
  });
  return [...seen].sort();
}

const EMPTY: FindPluginState = {
  open: false,
  replaceOpen: false,
  query: "",
  opts: DEFAULT_FIND_OPTIONS,
  matches: [],
  index: -1,
};

function recompute(
  doc: PMNode,
  query: string,
  opts: FindOptions,
  caret: number,
  keepIndex: number | null,
): { matches: FindMatch[]; index: number } {
  const matches = query ? findMatches(searchBlocks(doc), query, opts) : [];
  if (matches.length === 0) return { matches, index: -1 };
  if (keepIndex !== null && keepIndex >= 0) {
    return { matches, index: Math.min(keepIndex, matches.length - 1) };
  }
  return { matches, index: matchAtOrAfter(matches, caret) };
}

export const Find = Extension.create<Record<string, never>, FindStorage>({
  name: "find",
  // Above ElementEntry so Escape closes the bar, and so the bar's own keys are
  // never eaten by the element ring.
  priority: 250,

  addStorage() {
    return {
      open: false,
      replaceOpen: false,
      query: "",
      opts: DEFAULT_FIND_OPTIONS,
      total: 0,
      current: 0,
      cueMatches: 0,
      noteMatches: 0,
      currentHeldBack: null,
      speakers: [],
    };
  },

  addCommands() {
    const send =
      (meta: FindMeta) =>
      () =>
      ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        // Not a document change, so it must never become an undo step.
        if (dispatch) dispatch(tr.setMeta(findKey, meta).setMeta("addToHistory", false));
        return true;
      };

    return {
      openFind: (replace = false) => send({ kind: "open", replace })(),
      closeFind: () => send({ kind: "close" })(),
      setFindQuery: (query: string) => send({ kind: "query", query })(),
      setFindOptions: (opts: Partial<FindOptions>) => send({ kind: "opts", opts })(),

      /**
       * Move to the next/previous match and put the caret on it — selection,
       * plugin state and scroll in ONE transaction. (Mutating the transaction
       * the command is handed is the only correct way: dispatching a second one
       * of our own makes TipTap apply a transaction built from the state before
       * ours landed, which ProseMirror rejects as "mismatched".)
       */
      stepFind:
        (delta: number) =>
        ({ tr, state, dispatch, editor }) => {
          const st = findKey.getState(state);
          if (!st || st.matches.length === 0) return false;
          if (!dispatch) return true;
          const index = stepIndex(st.index, st.matches.length, delta);
          const match = st.matches[index];
          tr.setMeta(findKey, { kind: "index", index });
          tr.setMeta("addToHistory", false);
          if (match) {
            tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
            // Scrolled explicitly after the transaction lands: PM's own
            // `tr.scrollIntoView()` does not move this layout's scroller at all
            // (see scroll-to.ts).
            const at = match.from;
            queueMicrotask(() => scrollPosIntoView(editor.view, at, { center: true }));
          }
          return true;
        },

      /**
       * Replace the current match. Refuses inside a character cue — that is a
       * rename, and it has three homes to update (storage rule 3) — and inside
       * a comment, which is not the script's text (docs/app/writing/comments.md#COMM-D9).
       */
      replaceCurrent:
        (text: string) =>
        ({ tr, state, dispatch }) => {
          const st = findKey.getState(state);
          const match = st?.matches[st.index];
          if (!match || heldBack(match) !== null) return false;
          if (!dispatch) return true;
          tr.insertText(text, match.from, match.to);
          // Resume from just past what we wrote, so Replace-Replace-Replace
          // walks forward. An index would not do: replacing "water" with
          // "spring water" leaves a match inside the replacement, and holding
          // the ordinal would replace it again forever.
          tr.setMeta(findKey, { kind: "resume", pos: match.from + text.length });
          return true;
        },

      /**
       * Replace every match outside a cue or a comment, in ONE transaction —
       * one undo step, one version (docs/app/keeping-work/storage-and-file-format.md#STOR-D10). Applied back to front so
       * each edit cannot shift the positions of the ones not yet done.
       */
      replaceAll:
        (text: string) =>
        ({ tr, state, dispatch }) => {
          const st = findKey.getState(state);
          if (!st) return false;
          const { replaceable } = partitionForReplace(st.matches);
          if (replaceable.length === 0) return false;
          if (!dispatch) return true;
          for (let i = replaceable.length - 1; i >= 0; i--) {
            const m = replaceable[i];
            tr.insertText(text, m.from, m.to);
          }
          tr.setMeta(findKey, { kind: "resume", pos: 0 });
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-f": () => this.editor.commands.openFind(false),
      "Mod-Alt-f": () => this.editor.commands.openFind(true),
      // Only while the bar is open, so Escape keeps its other jobs otherwise.
      Escape: () => {
        if (!findKey.getState(this.editor.state)?.open) return false;
        return this.editor.commands.closeFind();
      },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<FindPluginState>({
        key: findKey,
        state: {
          init: () => ({ ...EMPTY }),
          apply: (tr, prev, _old, next): FindPluginState => {
            const meta = tr.getMeta(findKey) as FindMeta | undefined;
            let state = prev;
            const caret = next.selection.from;

            if (meta?.kind === "close") {
              state = { ...prev, open: false, replaceOpen: false, matches: [], index: -1 };
            } else if (meta?.kind === "open") {
              const seed = seedQuery(next) ?? prev.query;
              const { matches, index } = recompute(next.doc, seed, prev.opts, caret, null);
              state = {
                ...prev,
                open: true,
                replaceOpen: prev.replaceOpen || meta.replace,
                query: seed,
                matches,
                index,
              };
            } else if (meta?.kind === "query") {
              const { matches, index } = recompute(next.doc, meta.query, prev.opts, caret, null);
              state = { ...prev, query: meta.query, matches, index };
            } else if (meta?.kind === "opts") {
              const opts = { ...prev.opts, ...meta.opts };
              const { matches, index } = recompute(next.doc, prev.query, opts, caret, null);
              state = { ...prev, opts, matches, index };
            } else if (meta?.kind === "index") {
              state = {
                ...prev,
                index: Math.min(meta.index, prev.matches.length - 1),
              };
            } else if (meta?.kind === "resume") {
              // A replace just landed: re-search the changed document and pick
              // up at the first match past what we wrote.
              const matches = prev.query
                ? findMatches(searchBlocks(next.doc), prev.query, prev.opts)
                : [];
              state = { ...prev, matches, index: matchAtOrAfter(matches, meta.pos) };
            } else if (tr.docChanged && prev.open) {
              // Typing under an open bar: re-search rather than remap, so the
              // count stays honest as the text changes.
              const { matches, index } = recompute(
                next.doc,
                prev.query,
                prev.opts,
                caret,
                prev.index,
              );
              state = { ...prev, matches, index };
            }

            const { cueMatches, noteMatches } = partitionForReplace(state.matches);
            const current = state.matches[state.index];
            storage.open = state.open;
            storage.replaceOpen = state.replaceOpen;
            storage.query = state.query;
            storage.opts = state.opts;
            storage.total = state.matches.length;
            storage.current = state.index >= 0 ? state.index + 1 : 0;
            storage.cueMatches = cueMatches.length;
            storage.noteMatches = noteMatches.length;
            storage.currentHeldBack = current ? heldBack(current) : null;
            if (state.open) storage.speakers = speakersInDoc(next.doc);
            return state;
          },
        },
        props: {
          decorations(state) {
            const st = findKey.getState(state);
            if (!st?.open || st.matches.length === 0) return DecorationSet.empty;
            const decos = st.matches.map((m, i) =>
              Decoration.inline(m.from, m.to, {
                class: i === st.index ? "pl-find pl-find--current" : "pl-find",
              }),
            );
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

/** Seed the bar from the selection, the way every editor does. */
function seedQuery(state: {
  doc: PMNode;
  selection: { from: number; to: number; empty: boolean };
}): string | null {
  const { selection, doc } = state;
  if (selection.empty || selection.to - selection.from > 200) return null;
  const text = doc.textBetween(selection.from, selection.to, "\n", "");
  return text.includes("\n") ? null : text || null;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    find: {
      /** Open the find bar (with the replace row when `replace`). */
      openFind: (replace?: boolean) => ReturnType;
      closeFind: () => ReturnType;
      setFindQuery: (query: string) => ReturnType;
      setFindOptions: (opts: Partial<FindOptions>) => ReturnType;
      /** Next (+1) / previous (−1) match, moving the caret to it. */
      stepFind: (delta: number) => ReturnType;
      /** Replace the current match; false inside a character cue or a comment. */
      replaceCurrent: (text: string) => ReturnType;
      /** Replace every match outside cues and comments in one transaction. */
      replaceAll: (text: string) => ReturnType;
    };
  }
  interface Storage {
    find: FindStorage;
  }
}
