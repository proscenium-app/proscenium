// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Character autocomplete (docs/app/writing/editor-ux.md#EDIT-D112). In a
 * `character` node, offers cast names — injected from the binder plus the cues
 * already used in the open doc — in a small popup. Enter/Tab accepts the
 * highlighted name; ↑/↓ move; Escape dismisses.
 *
 * Two modes:
 *  - TYPING: a name prefix filters the pool; Enter/Tab accept the highlight.
 *  - EMPTY CUE (docs/app/writing/editor-ux.md#EDIT-56): landing in an empty character
 *    element opens the list with the PREDICTED next speaker pre-selected, so
 *    Enter accepts it immediately; ↑/↓ or typing picks a different name. A
 *    different element stays one keystroke away: Tab deliberately does NOT
 *    accept here (it falls through to the element menu / ring), and Esc
 *    dismisses the popup, after which Enter opens the element menu on Action
 *    (element-entry.ts).
 *
 * Composition: this is a separate extension at a higher priority than
 * ElementEntry, so its Enter/Tab handlers run FIRST and, when the popup is
 * open, swallow the key (accept). When the popup is closed every handler
 * returns false and the key falls through to the predictive Enter / Tab ring —
 * the ALL-CAPS→character→dialogue gesture is untouched (it lives in `action`,
 * where this extension is always inactive).
 *
 * Round-trip-safe: it only ever inserts plain cue text; no attrs, no sigils.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { cueNameEnd } from "../fountain/cue";
import { cuePrefix, matchCast, normalizeCast, rankSuggestions } from "./cast";
import { placeAtCaret } from "./popup-position";
import { announce } from "../ui/announce";
import { bindCaretPopup } from "../ui/Menu";

export interface CharacterAutocompleteOptions {
  /** Cast names from the binder; merged with the open doc's cues. */
  cast: string[];
}

interface ACState {
  /** Normalized pool injected from the binder (live cues are added per keystroke). */
  cast: string[];
  active: boolean;
  items: string[];
  index: number;
  /** Inclusive range of the name prefix to replace on accept. */
  from: number;
  to: number;
  query: string;
  /** Escape was pressed; suppress until the next keystroke. */
  dismissed: boolean;
  /** Empty-cue mode: the writer has arrowed into the list (gates accept). */
  navigated: boolean;
}

type ACMeta =
  | { type: "setCast"; cast: string[] }
  | { type: "setIndex"; index: number }
  | { type: "dismiss" };

export const characterAutocompleteKey = new PluginKey<ACState>("characterAutocomplete");

const INACTIVE = {
  active: false as const,
  items: [] as string[],
  index: 0,
  from: 0,
  to: 0,
  navigated: false,
};

/** How many ranked names the empty-cue popup offers. */
const SUGGESTION_LIMIT = 8;

/** Cue prefixes (ALL-CAPS) already present in the doc — the "used cues" source. */
function scanCues(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name !== "character") return true;
    const name = cuePrefix(node.textContent).toUpperCase();
    if (name) out.push(name);
    return false; // a cue holds no nested character nodes
  });
  return out;
}

/** Cues ABOVE a block position, in document order — the prediction's input. */
function cuesBefore(doc: PMNode, blockPos: number): string[] {
  const out: string[] = [];
  doc.forEach((node, offset) => {
    if (offset >= blockPos || node.type.name !== "character") return;
    const name = cuePrefix(node.textContent).toUpperCase();
    if (name) out.push(name);
  });
  return out;
}

function nextState(tr: Transaction, prev: ACState, state: EditorState): ACState {
  const meta = tr.getMeta(characterAutocompleteKey) as ACMeta | undefined;
  const cast = meta?.type === "setCast" ? normalizeCast(meta.cast) : prev.cast;
  // Typing re-shows a dismissed popup; Escape dismisses it.
  let dismissed = prev.dismissed;
  if (tr.docChanged) dismissed = false;
  if (meta?.type === "dismiss") dismissed = true;

  const base = { ...INACTIVE, cast, query: "", dismissed: false };
  const { selection } = state;
  const $from = selection.$from;
  const parent = $from.parent;
  if (!selection.empty || parent.type.name !== "character") return base;

  const text = parent.textContent;
  const caret = $from.parentOffset;
  const cut = cueNameEnd(text);
  // Cursor inside the extension part — the name is done; don't autocomplete.
  if (cut !== -1 && caret > cut) return base;

  const prefix = cut === -1 ? text : text.slice(0, cut);
  const query = prefix.trim().toUpperCase();
  const pool = normalizeCast([...cast, ...scanCues(state.doc)]);
  const start = $from.start();

  if (!query) {
    // Empty cue: offer the ranked cast with the PREDICTION pre-selected —
    // Enter accepts it immediately (docs/app/writing/editor-ux.md#EDIT-56). Esc dismisses,
    // and Enter then falls through to the element menu.
    if (dismissed) return { ...base, dismissed };
    const items = rankSuggestions(pool, cuesBefore(state.doc, $from.before())).slice(
      0,
      SUGGESTION_LIMIT,
    );
    if (items.length === 0) return base;
    let index = 0;
    let navigated = false;
    if (meta?.type === "setIndex") {
      index = ((meta.index % items.length) + items.length) % items.length;
      navigated = true;
    } else if (prev.active && prev.query === "" && prev.navigated) {
      index = Math.min(prev.index, items.length - 1);
      navigated = true;
    }
    return {
      cast,
      active: true,
      items,
      index,
      from: start,
      to: start,
      query: "",
      dismissed: false,
      navigated,
    };
  }

  const items = matchCast(query, pool);
  if (items.length === 0 || dismissed) return { ...base, query, dismissed };

  let index = 0;
  if (meta?.type === "setIndex") index = meta.index;
  else if (prev.active && prev.query === query) index = prev.index;
  index = ((index % items.length) + items.length) % items.length;

  return {
    cast,
    active: true,
    items,
    index,
    from: start,
    to: start + prefix.length,
    query,
    dismissed: false,
    navigated: true,
  };
}

/** Replace the typed prefix with the highlighted name; return false if no popup. */
function accept(view: EditorView): boolean {
  const st = characterAutocompleteKey.getState(view.state);
  if (!st?.active) return false;
  const name = st.items[st.index];
  if (!name) return false;
  const tr = view.state.tr.insertText(name, st.from, st.to);
  tr.setSelection(TextSelection.create(tr.doc, st.from + name.length));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** The floating list, positioned at the caret with `coordsAtPos`. */
class AutocompleteView {
  private readonly dom: HTMLDivElement;
  /** What was last said, so a keystroke that changes nothing says nothing. */
  private said = "";
  private readonly activation: ReturnType<typeof bindCaretPopup>;

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "pl-autocomplete";
    this.dom.setAttribute("role", "listbox");
    this.dom.setAttribute("aria-label", "Character suggestions");
    this.dom.style.display = "none";
    this.activation = bindCaretPopup(this.dom, view.dom, (item) => {
      const index = Number(item.getAttribute("data-index"));
      this.view.dispatch(
        this.view.state.tr.setMeta(characterAutocompleteKey, { type: "setIndex", index }),
      );
      accept(this.view);
      this.view.focus();
    });
    document.body.appendChild(this.dom);
    this.render();
  }

  update() {
    this.render();
  }

  private render() {
    const st = characterAutocompleteKey.getState(this.view.state);
    if (!st?.active) {
      this.activation.unlink();
      this.dom.style.display = "none";
      this.dom.replaceChildren();
      this.said = "";
      return;
    }
    /* The list is drawn beside the caret and focus never leaves the page, so
       nothing about it reached a screen reader: Enter took a name the writer
       had never heard offered. The highlighted name is said as it changes —
       "MARGARET, 1 of 3" — and Enter's pre-selected guess says so. */
    const name = st.items[st.index];
    const words = name
      ? `${name}, ${st.index + 1} of ${st.items.length}${st.query === "" && st.index === 0 ? ", Enter takes it" : ""}`
      : "";
    if (words && words !== this.said) announce(words);
    this.said = words;
    this.dom.replaceChildren(
      ...st.items.map((name, i) => {
        const el = document.createElement("div");
        el.className =
          "pl-autocomplete__item" +
          (i === st.index ? " is-sel" : "") +
          (st.query === "" && i === 0 ? " is-guess" : "");
        el.setAttribute("data-index", String(i));
        el.setAttribute("role", "option");
        el.id = `${this.dom.id}-${encodeURIComponent(name)}`;
        el.setAttribute("aria-selected", i === st.index ? "true" : "false");
        el.textContent = name;
        return el;
      }),
    );
    this.activation.link(`${this.dom.id}-${encodeURIComponent(name)}`);
    placeAtCaret(this.dom, this.view);
    this.dom
      .querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }

  destroy() {
    this.activation.destroy();
    this.dom.remove();
  }
}

export const CharacterAutocomplete = Extension.create<CharacterAutocompleteOptions>({
  name: "characterAutocomplete",
  // Above ElementEntry (100) so Enter/Tab accept the popup before the predictive
  // advance / Tab ring get a turn.
  priority: 200,

  addOptions() {
    return { cast: [] };
  },

  addCommands() {
    return {
      setCharacterCast:
        (cast: string[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(characterAutocompleteKey, { type: "setCast", cast }));
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    const state = () => characterAutocompleteKey.getState(this.editor.state);
    const move = (delta: number) => () => {
      const st = state();
      if (!st?.active) return false;
      const len = st.items.length;
      const current = st.index < 0 ? (delta > 0 ? -1 : 0) : st.index;
      const index = (((current + delta) % len) + len) % len;
      this.editor.view.dispatch(
        this.editor.state.tr.setMeta(characterAutocompleteKey, { type: "setIndex", index }),
      );
      return true;
    };
    // Enter always accepts the highlight (the pre-selected prediction on an
    // empty cue — docs/app/writing/editor-ux.md#EDIT-56). Tab accepts only in typing mode or
    // after arrowing in: on an untouched empty cue it falls through, keeping
    // "a different element one keystroke away".
    const acceptEnter = () => {
      const st = state();
      if (!st?.active) return false;
      return accept(this.editor.view);
    };
    const acceptTab = () => {
      const st = state();
      if (!st?.active) return false;
      if (st.query === "" && !st.navigated) return false;
      return accept(this.editor.view);
    };
    return {
      Enter: acceptEnter,
      Tab: acceptTab,
      ArrowDown: move(1),
      ArrowUp: move(-1),
      Escape: () => {
        if (!state()?.active) return false;
        this.editor.view.dispatch(
          this.editor.state.tr.setMeta(characterAutocompleteKey, { type: "dismiss" }),
        );
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const initialCast = normalizeCast(this.options.cast);
    return [
      new Plugin<ACState>({
        key: characterAutocompleteKey,
        state: {
          init: () => ({ cast: initialCast, query: "", dismissed: false, ...INACTIVE }),
          apply: (tr, prev, _old, next) => nextState(tr, prev, next),
        },
        view: (view) => new AutocompleteView(view),
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    characterAutocomplete: {
      /** Replace the cast pool offered in `character` nodes. */
      setCharacterCast: (cast: string[]) => ReturnType;
    };
  }
}
