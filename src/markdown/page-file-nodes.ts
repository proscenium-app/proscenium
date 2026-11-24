// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page file's fields and foot in the prose editor (page-fields.ts says what
 * they are). ProseEditor loads these for a page before the script only, the
 * same pages doc.ts reads with `{ pageFile: true }`.
 *
 * A field is drawn as what it shows, from values the editor is handed and may
 * be handed again at any time, as the writer changes the play's details
 * elsewhere. A node decoration carries each field's face to its view, so new
 * values are a transaction that changes no word: every field is drawn again
 * where it stands, the caret stays where it was, and there is nothing to save.
 *
 * A field is one object. The caret goes around it, Backspace after it or
 * Delete before it takes it whole, and a click selects it. `{author}` typed,
 * pasted or dictated as text becomes one too, since it prints as one either
 * way: the page never shows a token as words that will print as a value.
 *
 * A field is also where its detail is written
 * (docs/app/formatting/formats-and-layout.md#FMT-176). Where the editor is
 * given a way to edit one (`onEdit`), a click on a field asks for it, and so
 * does Return or Space with the field selected; and what is typed, dictated
 * or composed with a field selected is the start of that detail's new value,
 * never loose words in the field's place. Typing over a field used to take
 * it off the page and leave a name the play did not know was its author's.
 */
import { Node, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type NodeView } from "@tiptap/pm/view";
import {
  FIELD_LABEL,
  FIELD_NAMES,
  FIELD_TOKEN,
  fieldFace,
  fieldShows,
  fieldToken,
  isFieldName,
  type FieldFace,
  type FieldName,
  type FieldValues,
} from "./page-fields";

/** The node names, as doc.ts reads and writes them. */
export const FIELD_NODE = "field";
export const FOOT_NODE = "foot";

/** What the foot's rule says, and what it is called to a screen reader. */
export const FOOT_LABEL = "Bottom of the page";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    field: {
      /** A field at the caret, in place of what is selected, with the marks typing there would take. */
      insertField: (name: FieldName) => ReturnType;
    };
  }
}

interface Fields {
  values: FieldValues;
  /** One node decoration a field, carrying its face. */
  faces: DecorationSet;
}

/** A field asked to be edited: which, where it is drawn, and what was typed to start it. */
export interface FieldEditRequest {
  name: FieldName;
  /** The field as drawn, to stand the editor beside. */
  dom: HTMLElement;
  /** What the writer typed with the field selected: the new value begins with it. */
  seed?: string;
}

/** The field the selection holds whole, and where it is drawn; null for any other selection. */
function selectedField(
  state: EditorState,
  domAt: (pos: number) => globalThis.Node | null,
): { name: FieldName; dom: HTMLElement } | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== FIELD_NODE) return null;
  const name = selection.node.attrs.name;
  const dom = domAt(selection.from);
  return isFieldName(name) && dom instanceof HTMLElement ? { name, dom } : null;
}

/** The fields' state: the values they show, and each field's face. */
export const fieldsKey = new PluginKey<Fields>("pageFields");

/**
 * A face as a decoration carries it: plain values, which is how decorations
 * are compared, so a field whose face did not change is not drawn again.
 */
export interface FaceSpec {
  fieldLines: string;
  fieldEmpty: boolean;
  fieldLabel: string;
}

function facesOf(doc: PMNode, values: FieldValues): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== FIELD_NODE || !isFieldName(node.attrs.name)) return;
    const face = fieldFace(node.attrs.name, values);
    const spec: FaceSpec = {
      fieldLines: face.lines.join("\n"),
      fieldEmpty: face.empty,
      fieldLabel: face.label,
    };
    decorations.push(Decoration.node(pos, pos + node.nodeSize, {}, spec));
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * Every field token left in the page's words, as the field it prints as. A
 * token is read within one run of text, and never in code, as doc.ts reads it.
 */
function tokensToFields(state: EditorState): Transaction | null {
  const type = state.schema.nodes[FIELD_NODE];
  if (!type) return null;
  const found: { from: number; to: number; name: FieldName; node: PMNode }[] = [];
  state.doc.descendants((node, pos, parent) => {
    if (!node.isText || parent?.type.spec.code || node.marks.some((m) => m.type.spec.code)) return;
    for (const match of (node.text ?? "").matchAll(FIELD_TOKEN)) {
      const name = match[1];
      if (!isFieldName(name)) continue;
      const from = pos + (match.index ?? 0);
      found.push({ from, to: from + match[0].length, name, node });
    }
  });
  if (!found.length) return null;
  const tr = state.tr;
  // From the last, so each one's place is still where it was found.
  for (const { from, to, name, node } of found.reverse())
    tr.replaceWith(from, to, type.create({ name }, null, node.marks));
  return tr;
}

function fieldsPlugin(
  initial: FieldValues,
  onEdit: ((request: FieldEditRequest) => void) | undefined,
): Plugin<Fields> {
  return new Plugin<Fields>({
    key: fieldsKey,
    state: {
      init: (_config, state) => ({ values: initial, faces: facesOf(state.doc, initial) }),
      apply(tr, prev) {
        const asked = tr.getMeta(fieldsKey) as FieldValues | undefined;
        if (!asked && !tr.docChanged) return prev;
        const values = asked ?? prev.values;
        return { values, faces: facesOf(tr.doc, values) };
      },
    },
    /*
     * A token that came in as words, however it came: typed a key at a time,
     * several keys read from the page at once, dictated, pasted or dropped. It
     * joins the change that brought it, so one undo takes both. An input
     * method's words are its own until it commits them, so a token in them
     * waits for the next change.
     */
    appendTransaction(transactions, _before, state) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (transactions.some((tr) => tr.getMeta("composition") !== undefined)) return null;
      return tokensToFields(state);
    },
    props: {
      decorations: (state) => fieldsKey.getState(state)?.faces,
      // With a field selected, Return or Space opens its detail, and a key
      // that would type a character starts the detail's new value with it.
      handleKeyDown(view, event) {
        if (!onEdit || event.metaKey || event.ctrlKey || event.altKey) return false;
        const field = selectedField(view.state, (pos) => view.nodeDOM(pos));
        if (!field) return false;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit(field);
          return true;
        }
        // An input method's keys are its own (229 is the key it reports
        // while it composes): what it makes is dealt with as it starts, below.
        if (event.key.length !== 1 || event.isComposing || event.keyCode === 229) return false;
        event.preventDefault();
        onEdit({ ...field, seed: event.key });
        return true;
      },
      handleDOMEvents: {
        // A composition begun with a field selected would be written over
        // the field. The caret goes after the field first, so what is
        // composed stands beside it and the field stays.
        compositionstart(view) {
          const { selection, doc } = view.state;
          if (selection instanceof NodeSelection && selection.node.type.name === FIELD_NODE)
            view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, selection.to)));
          return false;
        },
      },
      // The same for words that arrive any other way: dictated, or composed.
      handleTextInput(view, _from, _to, text) {
        if (!onEdit) return false;
        const field = selectedField(view.state, (pos) => view.nodeDOM(pos));
        if (!field) return false;
        onEdit({ ...field, seed: text });
        return true;
      },
    },
  });
}

/** The values the fields show now; null in an editor that is not a page file's. */
export function fieldValuesIn(state: EditorState): FieldValues | null {
  return fieldsKey.getState(state)?.values ?? null;
}

/**
 * The transaction that shows `values`: no word changes, and it is no step to
 * undo. Null when the editor has no fields, or every field would show what it
 * shows now.
 */
export function showValues(state: EditorState, values: FieldValues): Transaction | null {
  const now = fieldValuesIn(state);
  if (!now || FIELD_NAMES.every((name) => fieldShows(name, now) === fieldShows(name, values)))
    return null;
  return state.tr.setMeta(fieldsKey, values).setMeta("addToHistory", false);
}

/** Give the fields new values: each is drawn again where it stands. */
export function setFieldValues(editor: Editor, values: FieldValues): void {
  if (editor.isDestroyed) return;
  const tr = showValues(editor.state, values);
  if (tr) editor.view.dispatch(tr);
}

/** Whether the editor holds a page file's fields (ProseEditor's `pageFile`). */
export function hasPageFields(editor: Editor): boolean {
  // A bar can outlive its editor for a render (a document's Page → Source →
  // Page): a destroyed editor has no schema to ask.
  return !editor.isDestroyed && !!editor.schema?.nodes[FIELD_NODE];
}

/** Whether a field can go at the selection: anywhere text can but in code, whose text is literal. */
export function canInsertField(state: EditorState): boolean {
  return !!state.schema.nodes[FIELD_NODE] && !state.selection.$from.parent.type.spec.code;
}

/** Backspace just after a field (-1), or Delete just before one (1): the field goes whole. */
export function deleteFieldBeside(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!selection.empty) return false;
    const $at = selection.$head;
    const node = dir < 0 ? $at.nodeBefore : $at.nodeAfter;
    if (node?.type.name !== FIELD_NODE) return false;
    const from = dir < 0 ? $at.pos - node.nodeSize : $at.pos;
    dispatch?.(state.tr.delete(from, from + node.nodeSize).scrollIntoView());
    return true;
  };
}

/** A field's face, from the decoration that carries it. */
function faceIn(decorations: readonly Decoration[], name: FieldName): FieldFace {
  for (const decoration of decorations) {
    const spec = decoration.spec as Partial<FaceSpec>;
    if (typeof spec.fieldLines === "string")
      return {
        lines: spec.fieldLines.split("\n"),
        empty: spec.fieldEmpty === true,
        label: spec.fieldLabel ?? FIELD_LABEL[name],
      };
  }
  return fieldFace(name, {});
}

/**
 * A field on the page: what it shows, shaded as a field, its lines one under
 * another. To a screen reader it is one object with a name, as an image in
 * text is, read as "Author: A. Playwright, field"; its drawn words are not
 * read a second time.
 */
function fieldView(
  node: PMNode,
  decorations: readonly Decoration[],
  onEdit: ((request: FieldEditRequest) => void) | undefined,
): NodeView {
  const dom = document.createElement("span");
  dom.className = onEdit ? "pagefield pagefield--editable" : "pagefield";
  dom.contentEditable = "false";
  dom.setAttribute("role", onEdit ? "button" : "img");
  dom.setAttribute("aria-roledescription", "field");
  if (onEdit) {
    dom.setAttribute("aria-haspopup", "dialog");
    dom.setAttribute("aria-description", "Press to edit this detail of the play.");
    // A click on a field edits its detail; the press before it has selected
    // the field, as a press on it always did.
    dom.addEventListener("click", (event) => {
      if (event.button !== 0) return;
      const name = dom.dataset.pageField;
      if (isFieldName(name)) onEdit({ name, dom });
    });
  }
  let drawn = "";
  const draw = (name: FieldName, decos: readonly Decoration[]) => {
    const face = faceIn(decos, name);
    const key = JSON.stringify([name, face]);
    if (key === drawn) return;
    drawn = key;
    dom.dataset.pageField = name;
    dom.classList.toggle("pagefield--empty", face.empty);
    dom.setAttribute("aria-label", face.label);
    dom.textContent = face.lines.join("\n");
  };
  draw(node.attrs.name, decorations);
  return {
    dom,
    update(next, decos) {
      if (next.type !== node.type) return false;
      draw(next.attrs.name, decos);
      return true;
    },
  };
}

/** A field: the token `{name}` in a page file, drawn as the play's detail it names. */
export const PageField = Node.create<{
  values: FieldValues;
  onEdit?: (request: FieldEditRequest) => void;
}>({
  name: FIELD_NODE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { values: {} };
  },

  addAttributes() {
    return {
      name: {
        default: "title",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-page-field"),
        renderHTML: (attrs: Record<string, unknown>) => ({ "data-page-field": attrs.name }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-page-field]",
        getAttrs: (el: HTMLElement) =>
          isFieldName(el.getAttribute("data-page-field")) ? null : false,
      },
    ];
  },

  // Copied, a field is its token, the way the file holds it: pasted into a
  // page it is the field again, and into anything else it says what it is.
  renderHTML({ node, HTMLAttributes }) {
    return ["span", HTMLAttributes, fieldToken(node.attrs.name)];
  },

  renderText({ node }) {
    return fieldToken(node.attrs.name);
  },

  addNodeView() {
    return ({ node, decorations }) => fieldView(node, decorations, this.options.onEdit);
  },

  addProseMirrorPlugins() {
    return [fieldsPlugin(this.options.values, this.options.onEdit)];
  },

  addCommands() {
    return {
      insertField:
        (name) =>
        ({ state, tr, dispatch }) => {
          if (!isFieldName(name) || !canInsertField(state)) return false;
          if (dispatch) tr.replaceSelectionWith(this.type.create({ name }), true).scrollIntoView();
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => deleteFieldBeside(-1)(editor.state, editor.view.dispatch),
      Delete: ({ editor }) => deleteFieldBeside(1)(editor.state, editor.view.dispatch),
    };
  },
});

/**
 * Where a title page's foot begins: a hairline across the page with its name
 * on it, neither of them words of the page. One object, selected and deleted
 * whole; a screen reader hears a separator called "Bottom of the page".
 */
export const PageFoot = Node.create({
  name: FOOT_NODE,
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-page-foot]" }];
  },

  renderHTML() {
    return [
      "div",
      { "data-page-foot": "", class: "pagefoot", role: "separator", "aria-label": FOOT_LABEL },
      ["span", { class: "pagefoot__caption", "aria-hidden": "true" }, FOOT_LABEL],
    ];
  },
});

/**
 * The extensions a page file's editor adds to the prose editor's, its fields
 * first showing `values`; with `onEdit`, a field is where its detail is edited.
 */
export function pageFileExtensions(
  values: FieldValues,
  onEdit?: (request: FieldEditRequest) => void,
) {
  return [PageField.configure({ values, onEdit }), PageFoot];
}
