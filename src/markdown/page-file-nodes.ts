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
 * To the page a field is one object. A selection that covers it takes it
 * whole, and `{author}` typed, pasted or dictated as text becomes one, since
 * it prints as one either way: the page never shows a token as words that
 * will print as a value.
 *
 * A field is also where its detail is written
 * (docs/app/formatting/formats-and-layout.md#FMT-180), and it is written in
 * place. Where the editor is given a way to write one (`write`), the field's
 * words are a text of their own inside it: a press puts the caret in them
 * where the press was, and what is typed there is the play's detail, kept as
 * the caret leaves. On a line that is one field and nothing else the caret
 * never stands beside the field, only in it, so the line is written as any
 * line is; the arrows walk out of it to the lines above and below, Return
 * starts a new line under it, and Backspace in a field with no words takes
 * the field off the page. A field among other words is entered with Return,
 * Space or by typing with it selected. Typing over a field used to take it
 * off the page and leave a name the play did not know was its author's.
 */
import { Node, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
  type Command,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@tiptap/pm/view";
import {
  FIELD_LABEL,
  FIELD_NAMES,
  FIELD_PROMPT,
  FIELD_TOKEN,
  fieldEdits,
  fieldFace,
  fieldShows,
  fieldToken,
  isFieldName,
  readFieldOptions,
  writeFieldOptions,
  type FieldFace,
  type FieldName,
  type FieldValues,
} from "./page-fields";
import { PageHead, PagePlace } from "./page-place";

/** The node names, as doc.ts reads and writes them. */
export const FIELD_NODE = "field";
export const FOOT_NODE = "foot";

/** What the foot's rule says, and what it is called to a screen reader. */
export const FOOT_LABEL = "Bottom of the page";

/** The class of a field's own text, where its detail is written. */
export const FIELD_TEXT_CLASS = "pagefield__text";

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

/**
 * The page's way to write a detail of the play where a field shows it. Without
 * one a field only shows its value.
 */
export interface FieldWriter {
  /** Whether this field is written by hand. One that follows the script is not. */
  writes(name: FieldName): boolean;
  /** The words the writer left in a field: that detail of the play, from now on. */
  commit(name: FieldName, text: string): void;
  /** What a screen reader is told a field is for. */
  help?(name: FieldName): string;
  /**
   * The field the caret is in and where its words are drawn, or null when it
   * is in none: for the page to say, beside it, what that detail is.
   */
  onActive?(name: FieldName | null, at?: HTMLElement): void;
}

/** The field the selection holds whole, and where it stands; null for any other selection. */
function selectedField(state: EditorState): { name: FieldName; pos: number } | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== FIELD_NODE) return null;
  const name = selection.node.attrs.name;
  return isFieldName(name) ? { name, pos: selection.from } : null;
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
  /** The words the field holds while it is written in (`fieldEdits`). */
  fieldText: string;
}

function facesOf(doc: PMNode, values: FieldValues): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== FIELD_NODE || !isFieldName(node.attrs.name)) return;
    const face = fieldFace(node.attrs.name, values, node.attrs.options);
    const spec: FaceSpec = {
      fieldLines: face.lines.join("\n"),
      fieldEmpty: face.empty,
      fieldLabel: face.label,
      fieldText: fieldEdits(node.attrs.name, values),
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
  const found: { from: number; to: number; name: FieldName; options: string; node: PMNode }[] = [];
  state.doc.descendants((node, pos, parent) => {
    if (!node.isText || parent?.type.spec.code || node.marks.some((m) => m.type.spec.code)) return;
    for (const match of (node.text ?? "").matchAll(FIELD_TOKEN)) {
      const name = match[1];
      if (!isFieldName(name)) continue;
      const from = pos + (match.index ?? 0);
      const options = writeFieldOptions(readFieldOptions(match[2]));
      found.push({ from, to: from + match[0].length, name, options, node });
    }
  });
  if (!found.length) return null;
  const tr = state.tr;
  // From the last, so each one's place is still where it was found.
  for (const { from, to, name, options, node } of found.reverse())
    tr.replaceWith(from, to, type.create({ name, options }, null, node.marks));
  return tr;
}

// --- a field's own text ------------------------------------------------------

/** Where the caret goes in a field's text as it is entered. */
export type FieldEntry = "start" | "end" | "all" | { seed: string };

/** What a field's text answers to, by the element that holds it. */
interface FieldText {
  enter(how: FieldEntry): void;
}
const fieldTexts = new WeakMap<HTMLElement, FieldText>();

/**
 * A field whose words the engine carried the caret out of, on a key that
 * moves it, and the end it was going to. The page's editor puts it back as
 * the keyboard reaches it, before the next key is read.
 */
let escaping: { text: HTMLElement; dir: -1 | 1 } | null = null;

/** The field's own text an event came from, if it came from one. */
export function fieldTextOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(`.${FIELD_TEXT_CLASS}`) : null;
}

/**
 * Put the caret in the text of the field at `pos`. False for a field that is
 * not written by hand, or not drawn.
 */
export function enterField(view: EditorView, pos: number, how: FieldEntry): boolean {
  const dom = view.nodeDOM(pos);
  const text =
    dom instanceof HTMLElement ? dom.querySelector<HTMLElement>(`.${FIELD_TEXT_CLASS}`) : null;
  const field = text ? fieldTexts.get(text) : undefined;
  if (!field) return false;
  field.enter(how);
  return true;
}

/** Whether the field at `$pos`'s parent is that paragraph's only content. */
function alone(parent: PMNode): boolean {
  return parent.childCount === 1 && parent.firstChild?.type.name === FIELD_NODE;
}

/**
 * A caret beside a field that is its whole line goes into the field: there is
 * nowhere beside it to write. True when it went in.
 */
export function settleIntoField(view: EditorView): boolean {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const $head = selection.$head;
  if (!alone($head.parent)) return false;
  return enterField(view, $head.start(), $head.parentOffset === 0 ? "start" : "end");
}

/** A field's words as text: a line break of any making is a new line. */
function readText(el: HTMLElement): string {
  let out = "";
  const walk = (node: globalThis.Node) => {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    // A block an engine made for a new line starts one.
    if ((node.tagName === "DIV" || node.tagName === "P") && out && !out.endsWith("\n")) out += "\n";
    node.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  return out;
}

/** The words as they are kept: one line for a field that is one, no blank lines at either end. */
export function settled(text: string, lines: boolean): string {
  // A no-break space is what an engine types for a space at a line's end.
  const clean = text.replace(/\r\n?/g, "\n").split(String.fromCharCode(160)).join(" ");
  if (!lines) return clean.replace(/\s*\n\s*/g, " ").trim();
  return clean
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Where the caret stands in a field's text. */
function caretIn(el: HTMLElement): {
  collapsed: boolean;
  start: boolean;
  end: boolean;
  first: boolean;
  last: boolean;
} | null {
  const selection = el.ownerDocument.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const before = el.ownerDocument.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const after = el.ownerDocument.createRange();
  after.selectNodeContents(el);
  after.setStart(range.endContainer, range.endOffset);
  const start = before.toString().length === 0;
  // An engine keeps a last line break of its own so an empty last line shows.
  const end = after.toString().replace(/\n$/, "").length === 0;
  // The line the caret is on, against the lines the text is drawn on.
  const boxes = el.getClientRects();
  const at = range.getClientRects()[0] ?? range.getBoundingClientRect();
  let first = true;
  let last = true;
  if (boxes.length > 1 && (at.height || at.top)) {
    const line = boxes[0]!.height || 1;
    first = at.top - boxes[0]!.top < line / 2;
    last = boxes[boxes.length - 1]!.bottom - at.bottom < line / 2;
  } else if (boxes.length > 1) {
    first = start;
    last = end;
  }
  return { collapsed: range.collapsed, start, end, first, last };
}

function placeCaret(el: HTMLElement, where: "start" | "end" | "all"): void {
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  if (where !== "all") range.collapse(where === "start");
  const selection = el.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/** A face's values, from the decoration that carries them. */
function faceIn(decorations: readonly Decoration[], name: FieldName): FieldFace & { text: string } {
  for (const decoration of decorations) {
    const spec = decoration.spec as Partial<FaceSpec>;
    if (typeof spec.fieldLines === "string")
      return {
        lines: spec.fieldLines.split("\n"),
        empty: spec.fieldEmpty === true,
        label: spec.fieldLabel ?? FIELD_LABEL[name],
        text: spec.fieldText ?? "",
      };
  }
  return { ...fieldFace(name, {}), text: "" };
}

/**
 * A field that only shows its value: shaded as a field, its lines one under
 * another. To a screen reader it is one object with a name, as an image in
 * text is, read as "Author: A. Playwright, field"; its drawn words are not
 * read a second time.
 */
function shownField(node: PMNode, decorations: readonly Decoration[]): NodeView {
  const dom = document.createElement("span");
  dom.className = "pagefield";
  dom.contentEditable = "false";
  dom.setAttribute("role", "img");
  dom.setAttribute("aria-roledescription", "field");
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

/**
 * A field that is written in place: its words are a text of their own inside
 * the field, an editing host the page's editor leaves alone. The play's detail
 * is what the writer leaves there; Esc puts back what it held.
 */
function writtenField(
  node: PMNode,
  decorations: readonly Decoration[],
  view: EditorView,
  getPos: () => number | undefined,
  write: FieldWriter,
): NodeView {
  const dom = document.createElement("span");
  dom.className = "pagefield pagefield--editable";
  dom.contentEditable = "false";
  const text = document.createElement("span");
  text.className = FIELD_TEXT_CLASS;
  text.setAttribute("contenteditable", "plaintext-only");
  text.setAttribute("role", "textbox");
  text.spellcheck = false;
  text.setAttribute("writingsuggestions", "false");
  dom.append(text);

  let name: FieldName = node.attrs.name;
  let decos = decorations;
  let editing = false;
  let dirty = false;
  /** Changes typed here since the caret came in: what this field's own undo may take back. */
  let edits = 0;
  /** A key the engine moves the caret for is in flight, and which way it goes. */
  let travel: -1 | 0 | 1 = 0;
  /** What the field held as the caret came into it: what Esc puts back. */
  let held = "";
  let drawn = "";

  const lines = () => name === "contact";
  const isEmpty = () => readText(text).replace(/\n/g, "") === "";
  const markEmpty = () => dom.classList.toggle("pagefield--empty", isEmpty());

  const draw = (force = false) => {
    const face = faceIn(decos, name);
    dom.dataset.pageField = name;
    dom.classList.toggle("pagefield--caps", name === "TITLE");
    text.setAttribute("aria-label", FIELD_LABEL[name]);
    text.setAttribute("aria-placeholder", FIELD_PROMPT[name]);
    text.setAttribute("aria-multiline", lines() ? "true" : "false");
    // A touch keyboard's capitals: a title's and a name's words, and nothing
    // of a credit ("a play by"), an address or a date.
    text.setAttribute(
      "autocapitalize",
      name === "title" || name === "TITLE" || name === "author"
        ? "words"
        : name === "subtitle"
          ? "sentences"
          : "off",
    );
    text.dataset.placeholder = FIELD_PROMPT[name];
    const help = write.help?.(name);
    if (help) text.setAttribute("aria-description", help);
    else text.removeAttribute("aria-description");
    // Words being written are the writer's until the caret leaves them.
    if (editing && !force) return;
    const key = JSON.stringify([name, face.text]);
    if (key === drawn && !force) return;
    drawn = key;
    text.textContent = face.text.trim() ? face.text : "";
    markEmpty();
  };

  const commit = () => {
    if (!dirty) return;
    dirty = false;
    const words = settled(readText(text), lines());
    text.textContent = words;
    drawn = "";
    markEmpty();
    write.commit(name, words);
  };

  /** The paragraph this field is the whole of, when it is one. */
  const whole = (): { pos: number; lone: boolean } | null => {
    const pos = getPos();
    if (pos === undefined) return null;
    return { pos, lone: alone(view.state.doc.resolve(pos).parent) };
  };

  /** Out of the field, to the page: before it or after it, the caret in the page's own words. */
  const leave = (dir: -1 | 1): boolean => {
    const here = whole();
    if (!here) return false;
    const { doc } = view.state;
    let target: Selection | null;
    if (here.lone) {
      const $pos = doc.resolve(here.pos);
      const edge = dir < 0 ? $pos.before() : $pos.after();
      target = Selection.findFrom(doc.resolve(edge), dir);
    } else {
      target = TextSelection.create(doc, dir < 0 ? here.pos : here.pos + node.nodeSize);
    }
    if (!target) return false;
    view.focus();
    view.dispatch(view.state.tr.setSelection(target).scrollIntoView());
    return true;
  };

  /** A new line of the page above or below a field that is its whole line. */
  const newLine = (dir: -1 | 1): void => {
    const here = whole();
    if (!here) return;
    const { doc, schema } = view.state;
    const $pos = doc.resolve(here.pos);
    const parent = $pos.parent;
    const paragraph = schema.nodes.paragraph;
    if (!here.lone || !paragraph || (parent.type !== paragraph && parent.type.name !== "heading")) {
      leave(1);
      return;
    }
    // Set as the line it comes from is: a line under a centered author is
    // centered. Under a heading (the title) it is a line of the page's own
    // words, set where the heading is: where a subtitle goes.
    const line =
      parent.type === paragraph
        ? paragraph.create(parent.attrs)
        : paragraph.create(parent.attrs.textAlign ? { textAlign: parent.attrs.textAlign } : null);
    const at = dir < 0 ? $pos.before() : $pos.after();
    view.focus();
    const tr = view.state.tr.insert(at, line);
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView());
  };

  /** The field off the page: its words were gone already. */
  const remove = (): void => {
    const pos = getPos();
    if (pos === undefined) return;
    dirty = false;
    view.focus();
    const tr = view.state.tr.delete(pos, pos + node.nodeSize);
    view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(pos))).scrollIntoView());
  };

  /** The next field of the page, or the one before: Tab's way down a title page. */
  const tabTo = (dir: -1 | 1): boolean => {
    const pos = getPos();
    if (pos === undefined) return false;
    const fields: number[] = [];
    view.state.doc.descendants((n, at) => {
      if (n.type.name === FIELD_NODE && isFieldName(n.attrs.name) && write.writes(n.attrs.name))
        fields.push(at);
    });
    const next = fields[fields.indexOf(pos) + dir];
    return next !== undefined && enterField(view, next, "all");
  };

  const onFocus = () => {
    if (editing) return;
    editing = true;
    dirty = false;
    edits = 0;
    held = readText(text);
    dom.classList.add("pagefield--editing");
    // The field is what the page has selected while its words are written:
    // the bar's formatting is the field's, and the keyboard comes back to it.
    const pos = getPos();
    if (pos !== undefined) {
      const { state } = view;
      const selected = selectedField(state);
      if (selected?.pos !== pos)
        view.dispatch(
          state.tr
            .setSelection(NodeSelection.create(state.doc, pos))
            .setMeta("addToHistory", false),
        );
    }
    write.onActive?.(name, text);
  };

  /** The caret has left the field: what it holds is the play's detail. */
  const settle = () => {
    editing = false;
    dom.classList.remove("pagefield--editing");
    commit();
    draw(true);
    write.onActive?.(null);
  };

  const onBlur = () => {
    if (!editing) return;
    if (!travel) {
      settle();
      return;
    }
    // The engine carried the caret out of the field's words on a key that
    // moves it (the end of the line, a word on): it stays in them, at the
    // end it was going to. Only a press, Tab, Return or an arrow at an end
    // leaves a field. The page's editor sends the caret back as the keyboard
    // reaches it (the plugin's focus, below); had it gone anywhere else, the
    // field is left as any is.
    escaping = { text, dir: travel };
    travel = 0;
    setTimeout(() => {
      if (escaping?.text === text) escaping = null;
      if (editing && text.ownerDocument.activeElement !== text) settle();
    }, 0);
  };

  const onInput = (event: Event) => {
    const kind = (event as InputEvent).inputType;
    edits = kind === "historyUndo" ? Math.max(0, edits - 1) : edits + 1;
    dirty = true;
    // An engine leaves a line break in a text the writer emptied.
    if (isEmpty() && text.childNodes.length) text.textContent = "";
    markEmpty();
  };

  /**
   * A new row of the contact block, at the caret. Left to the engine, Return
   * at the end of the words put a line break after the caret and left it
   * where it was: a last line with nothing on it is not drawn until a second
   * break stands after it. So the break is written here, the words kept as
   * one run of text, with that second break after an empty last line.
   */
  const breakLine = () => {
    const doc = text.ownerDocument;
    const selection = doc.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!text.contains(range.startContainer) || !text.contains(range.endContainer)) return;
    const before = doc.createRange();
    before.selectNodeContents(text);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const value = text.textContent ?? "";
    let next = `${value.slice(0, start)}\n${value.slice(start + range.toString().length)}`;
    if (next.endsWith("\n") && !next.endsWith("\n\n")) next += "\n";
    text.textContent = next;
    const caret = doc.createRange();
    caret.setStart(text.firstChild ?? text, text.firstChild ? start + 1 : 0);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
    dirty = true;
    // The engine's history knows nothing of a change made here.
    edits = 0;
    markEmpty();
  };

  const onBeforeInput = (event: InputEvent) => {
    if (event.inputType !== "insertParagraph" && event.inputType !== "insertLineBreak") return;
    // One line is one line; in the contact block a break is a new row of it.
    event.preventDefault();
    if (lines()) breakLine();
  };

  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    const words = lines() ? pasted.replace(/\r\n?/g, "\n") : pasted.replace(/\s*[\r\n]+\s*/g, " ");
    if (words) text.ownerDocument.execCommand("insertText", false, words);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // An input method's keys are its own.
    if (event.isComposing || event.keyCode === 229) return;
    const mod = event.metaKey || event.ctrlKey;
    const plain = !mod && !event.altKey;
    const at = caretIn(text);
    // Select All is this field's words. Left to the engine it took the
    // highest text that can be written in, which is the whole script, and
    // the next key typed there replaced it.
    if (mod && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      placeCaret(text, "all");
      return;
    }
    // Undo takes back what was typed here, and stops there: the engine keeps
    // one history for every field on the page.
    if (mod && !event.altKey && event.key.toLowerCase() === "z") {
      event.stopPropagation();
      if (event.shiftKey ? !dirty : edits === 0) event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (dirty) {
        text.textContent = held;
        dirty = false;
        markEmpty();
      }
      // Back to the page, the field selected as one object.
      view.focus();
      return;
    }
    if (event.key === "Enter") {
      // In the contact block Return is a new row of it.
      if (lines() && plain && !event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      newLine(at?.start && !at.end && !lines() ? -1 : 1);
      return;
    }
    if (event.key === "Tab" && plain) {
      event.preventDefault();
      event.stopPropagation();
      if (!tabTo(event.shiftKey ? -1 : 1)) leave(event.shiftKey ? -1 : 1);
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && isEmpty()) {
      event.preventDefault();
      event.stopPropagation();
      remove();
      return;
    }
    // Any other key that moves the caret is the engine's, within the words.
    travel = ["ArrowLeft", "ArrowUp", "Home", "PageUp"].includes(event.key)
      ? -1
      : ["ArrowRight", "ArrowDown", "End", "PageDown"].includes(event.key)
        ? 1
        : 0;
    // In flight until the key comes up: an engine may move the caret in a
    // task of its own, after this one.
    if (travel) setTimeout(() => (travel = 0), 300);
    if (!plain || event.shiftKey || !at?.collapsed) return;
    const out =
      (event.key === "ArrowLeft" && at.start) || (event.key === "ArrowUp" && at.first)
        ? -1
        : (event.key === "ArrowRight" && at.end) || (event.key === "ArrowDown" && at.last)
          ? 1
          : 0;
    if (!out) return;
    travel = 0;
    event.preventDefault();
    event.stopPropagation();
    leave(out);
  };

  text.addEventListener("focus", onFocus);
  text.addEventListener("blur", onBlur);
  text.addEventListener("input", onInput);
  text.addEventListener("beforeinput", onBeforeInput);
  text.addEventListener("paste", onPaste);
  text.addEventListener("keydown", onKeyDown);
  text.addEventListener("keyup", () => {
    travel = 0;
  });
  // Nothing is dropped into a detail: a drop is the page's.
  text.addEventListener("drop", (event) => event.preventDefault());

  fieldTexts.set(text, {
    enter(how) {
      text.focus({ preventScroll: true });
      if (typeof how === "object") {
        // Typed with the field selected: the new value begins with it.
        text.textContent = how.seed;
        dirty = true;
        markEmpty();
        placeCaret(text, "end");
      } else {
        placeCaret(text, how);
      }
      text.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
  });

  draw();
  return {
    dom,
    update(next, nextDecos) {
      if (next.type !== node.type || next.attrs.name !== name) return false;
      decos = nextDecos;
      draw();
      return true;
    },
    // The field's words are its own: the page's editor reads no key, press or
    // change inside them.
    stopEvent: (event) => event.target instanceof globalThis.Node && text.contains(event.target),
    ignoreMutation: () => true,
    destroy() {
      // Taken off the page with the caret in it: what was typed is still the detail.
      if (editing) {
        editing = false;
        commit();
        write.onActive?.(null);
      }
      fieldTexts.delete(text);
    },
  };
}

function fieldsPlugin(initial: FieldValues, write: FieldWriter | undefined): Plugin<Fields> {
  /** Whether the field the selection holds is one the writer writes in. */
  const written = (state: EditorState) => {
    const field = write ? selectedField(state) : null;
    return field && write?.writes(field.name) ? field : null;
  };
  /**
   * Words typed with a field selected that the writer does not write in (the
   * contents, which the script fills): set after the field, which stays.
   * False when no such field is selected, or in an editor with no writer.
   */
  const typedBeside = (view: EditorView, text: string): boolean => {
    if (!write) return false;
    const { selection } = view.state;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== FIELD_NODE)
      return false;
    const tr = view.state.tr.insertText(text, selection.to);
    view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, selection.to + text.length)).scrollIntoView(),
    );
    return true;
  };
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
    /*
     * A caret that comes to rest beside a field that is its whole line goes
     * into the field. After the change that moved it, never within it: going
     * in moves the keyboard, and the editor says so in a change of its own.
     */
    view: () => ({
      update(view, prev) {
        if (!write || view.state.selection.eq(prev.selection)) return;
        const state = view.state;
        queueMicrotask(() => {
          if (view.isDestroyed || view.state !== state || !view.hasFocus()) return;
          settleIntoField(view);
        });
      },
    }),
    props: {
      decorations: (state) => fieldsKey.getState(state)?.faces,
      // With a field selected, Return or Space puts the caret in its words,
      // and a key that would type a character starts its new value with it.
      handleKeyDown(view, event) {
        if (event.metaKey || event.ctrlKey || event.altKey) return false;
        const field = written(view.state);
        if (!field) {
          // A field no one writes in (the contents) is never typed over: a
          // key that would type a character types it after the field.
          if (event.key.length !== 1 || event.isComposing || event.keyCode === 229) return false;
          if (!typedBeside(view, event.key)) return false;
          event.preventDefault();
          return true;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          return enterField(view, field.pos, "end");
        }
        // An input method's keys are its own (229 is the key it reports
        // while it composes): what it makes is dealt with as it starts, below.
        if (event.key.length !== 1 || event.isComposing || event.keyCode === 229) return false;
        event.preventDefault();
        return enterField(view, field.pos, { seed: event.key });
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
        // The keyboard back in the page with the caret beside a field that is
        // its whole line: into the field, as it would have gone on arriving.
        focus(view) {
          if (!write) return false;
          // The engine carried the caret out of a field on a key that moves
          // it: back into the field, at the end it was going to.
          const back = escaping;
          if (back && view.dom.contains(back.text)) {
            escaping = null;
            queueMicrotask(() => {
              back.text.focus({ preventScroll: true });
              placeCaret(back.text, back.dir < 0 ? "start" : "end");
            });
            return false;
          }
          queueMicrotask(() => {
            if (!view.isDestroyed && view.hasFocus()) settleIntoField(view);
          });
          return false;
        },
      },
      // The same for words that arrive any other way: dictated, or composed.
      handleTextInput(view, _from, _to, text) {
        const field = written(view.state);
        return field ? enterField(view, field.pos, { seed: text }) : typedBeside(view, text);
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
  if (
    !now ||
    FIELD_NAMES.every(
      (name) =>
        fieldShows(name, now) === fieldShows(name, values) &&
        fieldEdits(name, now) === fieldEdits(name, values),
    )
  )
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

/** A field: the token `{name}` in a page file, drawn as the play's detail it names. */
export const PageField = Node.create<{
  values: FieldValues;
  write?: FieldWriter;
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
      // A component's settings, as its token writes them (`acts=plain`).
      options: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-page-field-options") ?? "",
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.options ? { "data-page-field-options": attrs.options } : {},
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
    return ["span", HTMLAttributes, fieldToken(node.attrs.name, node.attrs.options)];
  },

  renderText({ node }) {
    return fieldToken(node.attrs.name, node.attrs.options);
  },

  addNodeView() {
    return ({ node, decorations, view, getPos }) => {
      const write = this.options.write;
      const name = node.attrs.name;
      return write && isFieldName(name) && write.writes(name)
        ? writtenField(node, decorations, view, getPos, write)
        : shownField(node, decorations);
    };
  },

  addProseMirrorPlugins() {
    return [fieldsPlugin(this.options.values, this.options.write)];
  },

  addCommands() {
    return {
      insertField:
        (name) =>
        ({ state, tr, dispatch }) => {
          if (!isFieldName(name) || !canInsertField(state)) return false;
          if (!dispatch) return true;
          // A field is what the page has selected while its words are
          // written: a new one goes after it, never in its place. After a
          // field that is its whole line, on a line of its own under it.
          const held = selectedField(state);
          if (held) {
            const $pos = state.doc.resolve(held.pos);
            const parent = $pos.parent;
            const after = held.pos + state.selection.content().size;
            if (alone(parent) && parent.type === state.schema.nodes.paragraph) {
              const at = $pos.after();
              tr.insert(at, parent.type.create(parent.attrs, this.type.create({ name })));
              tr.setSelection(TextSelection.create(tr.doc, at + 1));
            } else {
              tr.insert(after, this.type.create({ name }, null, state.selection.$from.marks()));
              tr.setSelection(TextSelection.create(tr.doc, after + 1));
            }
            tr.scrollIntoView();
            return true;
          }
          tr.replaceSelectionWith(this.type.create({ name }), true).scrollIntoView();
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
 * first showing `values`; with `write`, a field is where its detail is written.
 */
export function pageFileExtensions(values: FieldValues, write?: FieldWriter) {
  return [PageField.configure({ values, write }), PageFoot, PageHead, PagePlace];
}
