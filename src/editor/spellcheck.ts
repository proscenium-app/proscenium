// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spell check over the script (docs/app/writing/editor-ux.md#EDIT-D116) — the
 * ProseMirror half. The judgement lives in src/spell (pure, tested); this draws
 * it, keeps it current as the writer types, and offers the corrections.
 *
 * Four constraints shape it, and three of them are the same ones find.ts has:
 *
 *  - **Underlines are DECORATIONS, never marks.** A misspelling must not dirty
 *    the buffer, must not reach the `.fountain`, and must vanish completely when
 *    the check is switched off. Nothing here dispatches a document change except
 *    the one the writer asks for by clicking a suggestion.
 *  - **It checks the DOCUMENT, never the chrome.** Page view draws headers,
 *    numbers and the re-printed "(CONT'D)" cue as decorations (docs/app/writing/editor-ux.md#EDIT-D100
 *    docs/app/writing/editor-ux.md#EDIT-D106), so no synthetic string can be underlined and the same words
 *    are checked whether page view is on or off.
 *  - **Cues and headings are out**, by node type (schema.ts NO_SPELLCHECK): a
 *    character name is a name, and a scene heading is a convention.
 *  - **Typing cost does not grow with the script.** A keystroke re-checks only
 *    the blocks the transaction touched; everything else is remapped. A full
 *    pass happens exactly twice — when the dictionary arrives, and when the word
 *    list behind it changes.
 *
 * The dictionary itself is loaded by the caller and pushed in with
 * `setSpeller`, for the reason tracked-changes.ts documents at length: plugin
 * state is the channel, `this.options` is not.
 */
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { wordsIn, type Speller } from "../spell";
import { LINE_BREAK } from "./bridge";
import { NO_SPELLCHECK } from "./schema";
import { announce } from "../ui/announce";

export const spellcheckKey = new PluginKey<SpellState>("prosceniumSpellcheck");

/** The class the squiggle hangs off (stage-format.css). */
const MISSPELLED = "pl-misspelled";

/** An open correction menu: the word, where it is, and where to draw. */
export interface SpellMenuState {
  word: string;
  from: number;
  to: number;
  suggestions: string[];
  /** Viewport coordinates of the click that opened it. */
  x: number;
  y: number;
  /**
   * Where the word itself was on screen as the menu opened. The menu stays up
   * only while the word does: a scroll that moves it shuts the menu, and one
   * that leaves it in place does not (SpellMenu).
   */
  wordAt: { left: number; top: number };
}

/** The word's place on screen now, for `SpellMenuState.wordAt`. */
export function wordAt(view: EditorView, from: number): { left: number; top: number } {
  const at = view.coordsAtPos(from);
  return { left: at.left, top: at.top };
}

export interface SpellState {
  /** Null before the dictionary loads, and whenever the check is switched off. */
  speller: Speller | null;
  decos: DecorationSet;
  menu: SpellMenuState | null;
}

type SpellMeta =
  | { kind: "speller"; speller: Speller | null }
  | { kind: "menu"; menu: SpellMenuState | null };

/**
 * A block's text paired with the position of every character, so a word split
 * by a mark ("*un*settling") is still one word and still maps back exactly —
 * the same indexing find.ts uses.
 *
 * Everything that is not text separates words with a "\n", which no token can
 * contain. For a line break that is literally true. For a NOTE it is the fix
 * for a fused token: a note is an inline node with its own content, so
 * "coat[[check this]]" would otherwise read as the single word "coatcheck".
 * The note's text is still checked — those are the writer's own words — just
 * not welded to whatever it touches.
 */
function readInline(node: PMNode, base: number, text: string[], at: number[]): void {
  node.forEach((child, offset) => {
    const pos = base + offset;
    if (child.isText) {
      const s = child.text ?? "";
      for (let i = 0; i < s.length; i++) {
        text.push(s[i]);
        at.push(pos + i);
      }
      return;
    }
    if (child.type.name === LINE_BREAK || child.isLeaf) {
      text.push("\n");
      at.push(pos);
      return;
    }
    // A note: bracket it, then read what is inside at its real positions. The
    // bracket positions are never dereferenced — "\n" cannot be part of a word.
    text.push("\n");
    at.push(pos);
    readInline(child, pos + 1, text, at);
    text.push("\n");
    at.push(pos + child.nodeSize - 1);
  });
}

/** The misspellings in one block, as decorations in document coordinates. */
function blockMisspellings(node: PMNode, start: number, speller: Speller, out: Decoration[]): void {
  const text: string[] = [];
  const at: number[] = [];
  readInline(node, start + 1, text, at);
  for (const { word, start: from, end } of wordsIn(text.join(""))) {
    if (speller.known(word)) continue;
    out.push(Decoration.inline(at[from], at[end - 1] + 1, { class: MISSPELLED }, { word }));
  }
}

/**
 * Every misspelling in the top-level blocks that overlap [from, to]. The bounds
 * are compared inclusively: an insertion sits exactly ON a block boundary, and
 * checking one neighbour too many is free next to missing the block that
 * changed.
 */
function misspellings(doc: PMNode, from: number, to: number, speller: Speller): Decoration[] {
  const out: Decoration[] = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const end = pos + node.nodeSize;
    if (end >= from && pos <= to && !NO_SPELLCHECK.has(node.type.name)) {
      blockMisspellings(node, pos, speller, out);
    }
    pos = end;
  }
  return out;
}

function checkAll(doc: PMNode, speller: Speller): DecorationSet {
  return DecorationSet.create(doc, misspellings(doc, 0, doc.content.size, speller));
}

/**
 * The span of the new document the transaction's steps touched, or null if it
 * touched nothing. One union range rather than a list: a keystroke's range is a
 * single block either way, and the one case that widens it to the whole script
 * (replace-all) genuinely does need the whole script re-checked.
 */
function changedSpan(tr: Transaction): { from: number; to: number } | null {
  let from = Infinity;
  let to = -Infinity;
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, rest.map(newStart, -1));
      to = Math.max(to, rest.map(newEnd, 1));
    });
  });
  return from > to ? null : { from, to };
}

export const Spellcheck = Extension.create({
  name: "prosceniumSpellcheck",

  addProseMirrorPlugins() {
    return [
      new Plugin<SpellState>({
        key: spellcheckKey,
        state: {
          init: () => ({ speller: null, decos: DecorationSet.empty, menu: null }),

          apply(tr, prev, _old, next): SpellState {
            const meta = tr.getMeta(spellcheckKey) as SpellMeta | undefined;

            // A new dictionary, a changed word list, or the check switched off:
            // the only full pass there is.
            if (meta?.kind === "speller") {
              const { speller } = meta;
              return {
                speller,
                decos: speller ? checkAll(next.doc, speller) : DecorationSet.empty,
                menu: null,
              };
            }

            // The menu closes when the words under it move. NOT on a selection
            // change: opening it selects the word, and a right-click moves the
            // caret in some webviews — either would shut it as it opened.
            const menu = meta?.kind === "menu" ? meta.menu : tr.docChanged ? null : prev.menu;

            if (!prev.speller || !tr.docChanged) {
              return menu === prev.menu ? prev : { ...prev, menu };
            }

            let decos = prev.decos.map(tr.mapping, tr.doc);
            const span = changedSpan(tr);
            if (span) {
              // Remapped underlines in the touched blocks are stale by
              // definition — the word under them just changed. Drop and redo.
              decos = decos.remove(decos.find(span.from, span.to));
              decos = decos.add(tr.doc, misspellings(tr.doc, span.from, span.to, prev.speller));
            }
            return { speller: prev.speller, decos, menu };
          },
        },

        props: {
          decorations: (state) => spellcheckKey.getState(state)?.decos ?? DecorationSet.empty,

          handleDOMEvents: {
            /**
             * Right-click on an underlined word opens OUR menu instead of the
             * webview's. Anywhere else the native menu is left alone — this
             * feature has no opinion about copy and paste.
             */
            contextmenu: (view, event) => {
              const state = spellcheckKey.getState(view.state);
              if (!state?.speller || !view.editable) return false;
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!at) return false;
              const hit = state.decos
                .find(at.pos, at.pos)
                .find((d) => d.from <= at.pos && at.pos <= d.to);
              if (!hit) return false;

              const word = (hit.spec as { word?: string }).word;
              if (!word) return false;
              event.preventDefault();
              const menu: SpellMenuState = {
                word,
                from: hit.from,
                to: hit.to,
                suggestions: state.speller.suggest(word),
                x: event.clientX,
                y: event.clientY,
                wordAt: wordAt(view, hit.from),
              };
              // Selecting the word is both the familiar gesture and what makes
              // the pending correction visible while the menu is up.
              const tr = view.state.tr
                .setSelection(TextSelection.create(view.state.doc, hit.from, hit.to))
                .setMeta(spellcheckKey, { kind: "menu", menu } satisfies SpellMeta);
              view.dispatch(tr);
              return true;
            },
          },
        },
      }),
    ];
  },

  /*
   * ⌘; — the next misspelling, with its corrections open. The correction menu
   * was a right-click and nothing else, so a writer on the keyboard, and every
   * VoiceOver user, could see (or hear of) no underline and fix none. This is
   * the Mac's own key for "Check Document Now": select the next bad word.
   */
  addKeyboardShortcuts() {
    return {
      "Mod-;": () => this.editor.commands.openNextSpelling(),
    };
  },

  addCommands() {
    return {
      /**
       * Select the next underlined word after the caret — wrapping once to the
       * top — and open its correction menu under it.
       *
       * The menu opens as soon as the selection is on the page: in a microtask,
       * because TipTap applies this command's transaction, and ProseMirror
       * scrolls the word into view, only once the command has returned. It
       * used to open 80 ms later, a beat meant to let the scroll's event go by
       * before the menu started listening for scrolls. A scroll event arrives
       * with the next frame, not on a clock, and a busy machine can hold that
       * frame past any beat: the event then shut the menu as it opened, over a
       * word that had not moved. The menu now closes only when the word moves
       * (SpellMenu), so it can open at once.
       */
      openNextSpelling:
        () =>
        ({ state, view, tr, dispatch }) => {
          const st = spellcheckKey.getState(state);
          if (!st?.speller || !view.editable) return false;
          const hits = st.decos.find().sort((a, b) => a.from - b.from);
          if (hits.length === 0) {
            announce("No misspelled words.");
            return true;
          }
          const after = state.selection.to;
          const hit = hits.find((d) => d.from >= after) ?? hits[0];
          const word = (hit.spec as { word?: string }).word;
          if (!word || !dispatch) return !!word;
          const speller = st.speller;
          dispatch(
            tr.setSelection(TextSelection.create(state.doc, hit.from, hit.to)).scrollIntoView(),
          );
          queueMicrotask(() => {
            if (view.isDestroyed) return;
            const now = view.state;
            // Only a word the selection is still on gets a menu: a chain this
            // command ran in may have moved it on.
            if (now.selection.from !== hit.from || now.selection.to !== hit.to) return;
            const at = view.coordsAtPos(hit.from);
            const menu: SpellMenuState = {
              word,
              from: hit.from,
              to: hit.to,
              suggestions: speller.suggest(word),
              x: at.left,
              y: at.bottom,
              wordAt: { left: at.left, top: at.top },
            };
            view.dispatch(
              now.tr.setMeta(spellcheckKey, { kind: "menu", menu } satisfies SpellMeta),
            );
          });
          return true;
        },

      /**
       * Install the speller the underlines are drawn from, or `null` to switch
       * the check off. Triggers the one full pass.
       */
      setSpeller:
        (speller: Speller | null) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(spellcheckKey, { kind: "speller", speller }));
          return true;
        },

      closeSpellMenu:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(spellcheckKey, { kind: "menu", menu: null }));
          return true;
        },

      /**
       * Accept a correction. `insertText` rather than a delete-then-insert so
       * the replacement inherits the marks already on the word — correcting a
       * typo inside an italic phrase must not knock it out of italics.
       */
      acceptSpelling:
        (from: number, to: number, word: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            dispatch(
              tr
                .insertText(word, from, to)
                .setMeta(spellcheckKey, { kind: "menu", menu: null } satisfies SpellMeta),
            );
          }
          return true;
        },
    };
  },
});

/** Read the plugin's state — the correction menu's only source of truth. */
export function spellState(editor: Editor): SpellState | undefined {
  return spellcheckKey.getState(editor.state);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    prosceniumSpellcheck: {
      /** Install (or clear) the speller behind the underlines. */
      setSpeller: (speller: Speller | null) => ReturnType;
      /** Dismiss the correction menu. */
      closeSpellMenu: () => ReturnType;
      /** Select the next misspelled word and open its correction menu (⌘;). */
      openNextSpelling: () => ReturnType;
      /** Replace [from, to] with a chosen spelling, keeping the word's marks. */
      acceptSpelling: (from: number, to: number, word: string) => ReturnType;
    };
  }
}
