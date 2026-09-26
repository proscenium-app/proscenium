// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Home-row leader key (docs/app/writing/editor-ux.md#EDIT-D113, Q3 "tune by
 * feel"). On an empty block, ";" arms a one-shot leader; the next mnemonic
 * letter sets the element directly — hands never leave the home row. Any other
 * key disarms and inserts the withheld ";" so a literal semicolon still types.
 * Escape disarms without typing anything.
 *
 * While armed, a caret-anchored MENU (the element picker) lists every
 * block type with its key, so the leader teaches itself: press the letter or
 * click a row. The same letters stay usable blind once learned.
 *
 * A tiny plugin state machine (`armed`): the ";" is withheld on arm and only
 * committed if the follow-up isn't a mnemonic. The mnemonic letters are the
 * fixed contract; they mirror the ⌘⌥ chords in element-entry.ts and add the
 * extended elements (synopsis `=`, note `n`, centered `>`).
 */
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { insertNote, insertPageBreak } from "./breaks";
import { placeAtCaret } from "./popup-position";
import { announce } from "../ui/announce";
import { bindCaretPopup, openCaretMenu } from "../ui/Menu";

/** Leader letter → element node name. The fixed contract (docs/app/writing/editor-ux.md#EDIT-D100). */
export const LEADER_ELEMENTS: Record<string, string> = {
  s: "sceneHeading",
  a: "action",
  c: "character",
  d: "dialogue",
  p: "parenthetical",
  t: "transition",
  "1": "act",
  "2": "scene",
  l: "lyric",
  "=": "synopsis",
  n: "note",
  ">": "centered",
  // Not an element you *set* — a node you insert (see runLeader). The leader
  // only arms on an empty block, which is exactly where a page break belongs.
  "-": "pageBreak",
};

/** Menu rows, in reach-for order (body elements first, structure, extended). */
export const LEADER_MENU: { key: string; label: string }[] = [
  { key: "a", label: "Action" },
  { key: "c", label: "Character" },
  { key: "d", label: "Dialogue" },
  { key: "p", label: "Parenthetical" },
  { key: "s", label: "Scene Heading" },
  { key: "t", label: "Transition" },
  { key: "1", label: "Act" },
  { key: "2", label: "Scene" },
  { key: "l", label: "Lyric" },
  { key: "=", label: "Scene Summary (Not Printed)" },
  { key: ">", label: "Centered Text" },
  // The writer's word for a Fountain note (docs/app/writing/comments.md#COMM-5).
  { key: "n", label: "Comment" },
  { key: "-", label: "Page Break" },
];

const LEADER_CHAR = ";";

/** A mnemonic as a screen reader should say it: "=" and ">" are not letters. */
function spokenKey(key: string): string {
  if (key === "=") return "equals";
  if (key === ">") return "greater than";
  if (key === "-") return "hyphen";
  return key.toUpperCase();
}
/** `pending` holds a withheld ";" (armed by typing the leader); an arm via
 * Tab (docs/app/writing/editor-ux.md#EDIT-58) has nothing to commit on fallthrough.
 * `suggested` is the element whose row the menu opens on (Enter's guess). */
interface LeaderState { armed: boolean; pending: string | null; suggested: string | null }
const leaderKey = new PluginKey<LeaderState>("leaderKey");

/**
 * Open the element menu programmatically: Tab on an empty line opens it on its
 * first row, and a second Enter on the row for `suggested`, so a third Enter
 * takes the element that Enter alone used to make. Same armed state as the ";"
 * leader — mnemonics, Esc, and click rows all work.
 */
export function armLeaderMenu(view: EditorView, suggested: string | null = null): boolean {
  view.dispatch(view.state.tr.setMeta(leaderKey, { armed: true, pending: null, suggested }));
  return true;
}

function hasMod(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey;
}

function isModifierKey(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}

/**
 * Apply a leader letter. Two rows aren't element types and are inserted rather
 * than set: `note` is inline (cursor lands inside it) and `pageBreak` is an atom
 * with its own placement rules (breaks.ts).
 */
function runLeader(editor: Editor, letter: string): boolean {
  const name = LEADER_ELEMENTS[letter];
  if (!name) return false;
  if (name === "pageBreak") return insertPageBreak(editor);
  if (name === "note") return insertNote(editor);
  return editor.chain().focus().setNode(name).run();
}

/** The caret-anchored element menu shown while the leader is armed. */
class LeaderMenuView {
  private readonly dom: HTMLDivElement;
  private wasArmed = false;
  private readonly activation: ReturnType<typeof bindCaretPopup>;
  private closeLayer?: () => void;

  constructor(
    private readonly view: EditorView,
    private readonly editor: Editor,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "pl-elementmenu";
    this.dom.setAttribute("role", "menu");
    this.dom.style.display = "none";
    this.dom.setAttribute("aria-label", "Element menu");
    this.activation = bindCaretPopup(this.dom, view.dom, (item) => {
      const key = item.getAttribute("data-key") ?? "";
      this.view.focus();
      this.view.dispatch(this.view.state.tr.setMeta(leaderKey, { armed: false }));
      runLeader(this.editor, key);
    });
    document.body.appendChild(this.dom);
    this.render();
  }

  update() {
    this.render();
  }

  private render() {
    const state = leaderKey.getState(this.view.state);
    const armed = state?.armed ?? false;
    if (!armed) {
      this.closeLayer?.();
      this.closeLayer = undefined;
      this.activation.unlink();
      this.dom.style.display = "none";
      this.dom.replaceChildren();
      this.wasArmed = false;
      return;
    }
    if (this.wasArmed) return;
    /* The menu teaches the letters by showing them, and focus stays on the
       page, so it taught nothing out loud: `;` went silent and waited. It says
       its alphabet once, as it opens. */
    if (!this.wasArmed) {
      announce(
        `Element menu. ${LEADER_MENU.map(({ key, label }) => `${spokenKey(key)}, ${label}`).join("; ")}. Escape cancels.`,
      );
    }
    this.wasArmed = true;
    const rows = LEADER_MENU.map(({ key, label }) => {
      const row = document.createElement("button");
      row.type = "button";
      row.tabIndex = -1;
      row.className = "pl-elementmenu__item";
      row.setAttribute("data-key", key);
      row.setAttribute("role", "menuitem");
      const kbd = document.createElement("kbd");
      kbd.className = "pl-elementmenu__key";
      kbd.textContent = key;
      const span = document.createElement("span");
      span.textContent = label;
      row.append(kbd, span);
      return row;
    });
    const hint = document.createElement("div");
    hint.className = "pl-elementmenu__hint";
    hint.textContent = "press a key · esc cancels · ⌘⌥ chords work anywhere";
    this.dom.replaceChildren(...rows, hint);
    placeAtCaret(this.dom, this.view);
    this.activation.link();
    const suggestedKey = Object.keys(LEADER_ELEMENTS).find((key) => LEADER_ELEMENTS[key] === state?.suggested);
    this.closeLayer = openCaretMenu(this.dom, this.view.dom,
      () => this.view.dispatch(this.view.state.tr.setMeta(leaderKey, { armed: false })),
      (event) => {
        if (isModifierKey(event.key)) return;
        // Mnemonics and literal fallthrough retain the existing plugin contract.
        // Refocus first so an ordinary unhandled character types into the page.
        this.view.focus();
        // As ProseMirror's own keydown does: a key the script takes (Shift+Enter's
        // line break, ⌘Enter's page break) has no default action left to run.
        if (this.view.someProp("handleKeyDown", (handler) => handler(this.view, event))) {
          event.preventDefault();
        }
      },
      Math.max(0, LEADER_MENU.findIndex(({ key }) => key === suggestedKey)));
  }

  destroy() {
    this.closeLayer?.();
    this.activation.destroy();
    this.dom.remove();
  }
}

export const LeaderKey = Extension.create({
  name: "leaderKey",
  // Above ElementEntry (100) so the leader sees ";" and the mnemonic before the
  // Tab ring / predictive Enter.
  priority: 150,

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<LeaderState>({
        key: leaderKey,
        state: {
          init: () => ({ armed: false, pending: null, suggested: null }),
          apply(tr, value) {
            const meta = tr.getMeta(leaderKey) as
              | { armed: boolean; pending?: string | null; suggested?: string | null }
              | undefined;
            if (meta && typeof meta.armed === "boolean") {
              return { armed: meta.armed, pending: meta.pending ?? null, suggested: meta.suggested ?? null };
            }
            // Any real edit or cursor move cancels a pending leader.
            if (value.armed && (tr.docChanged || tr.selectionSet)) {
              return { armed: false, pending: null, suggested: null };
            }
            return value;
          },
        },
        props: {
          handleKeyDown(view, event) {
            const st = leaderKey.getState(view.state);
            const armed = st?.armed ?? false;

            if (!armed) {
              if (event.key !== LEADER_CHAR || hasMod(event)) return false;
              const { selection } = view.state;
              const parent = selection.$from.parent;
              const onEmptyBlock =
                selection.empty && parent.isTextblock && parent.content.size === 0;
              if (!onEmptyBlock) return false;
              // Arm; withhold the ";" until we see the follow-up key. The
              // LeaderMenuView draws the element menu while armed.
              view.dispatch(
                view.state.tr.setMeta(leaderKey, { armed: true, pending: LEADER_CHAR }),
              );
              event.preventDefault();
              return true;
            }

            // Armed: ignore lone modifier presses — wait for the real key.
            if (isModifierKey(event.key)) return false;

            // Escape closes the menu without typing anything.
            if (event.key === "Escape") {
              event.preventDefault();
              view.dispatch(view.state.tr.setMeta(leaderKey, { armed: false, pending: null }));
              return true;
            }

            if (!hasMod(event) && Object.prototype.hasOwnProperty.call(LEADER_ELEMENTS, event.key)) {
              event.preventDefault();
              view.dispatch(view.state.tr.setMeta(leaderKey, { armed: false, pending: null }));
              runLeader(editor, event.key);
              return true;
            }

            // Any other key: commit the withheld ";" (if the leader was typed —
            // a Tab-opened menu has nothing pending), disarm, let the key proceed.
            const tr = view.state.tr.setMeta(leaderKey, { armed: false, pending: null });
            if (st?.pending) tr.insertText(st.pending);
            view.dispatch(tr);
            return false;
          },
        },
        view: (view) => new LeaderMenuView(view, editor),
      }),
    ];
  },
});
