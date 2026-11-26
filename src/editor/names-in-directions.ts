// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Character names in the directions go to capitals as the writer types them,
 * where the play's format asks (docs/app/writing/editor-ux.md#EDIT-202 to
 * docs/app/writing/editor-ux.md#EDIT-209).
 *
 * Auto-caps (auto-caps.ts) reads the whole script on every change, because a
 * cue is in capitals whatever touched it last (docs/app/writing/editor-ux.md#EDIT-176). This is the other
 * way round: the writer's own case is the point, so only the keystroke that
 * finishes a name may change it. Nothing here reads the script as a whole
 * while the writer types, and a word already on the page is never touched.
 *
 * - **What fires it.** A word boundary typed (a space, punctuation, Enter or
 *   Shift+Enter) straight after a letter typed, in a stage direction or a
 *   parenthetical, when the word before it is a cast name. Typing is known by
 *   `handleTextInput` and the Enter key, noted against the document they were
 *   typed into and matched to the transaction that follows; a paste, a drop,
 *   an undo, a composition, Find and Replace or a script read again never
 *   passes through either.
 * - **Its own undo step.** The capitals are a transaction appended to the
 *   keystroke with `closeHistory`, so ⌘Z takes them back and keeps the
 *   boundary. Before it, with `addToHistory: false`, the writer's letters are
 *   marked `castKept`: the step's inverse puts those letters back, and the
 *   mark with them, so an undone occurrence is a declined one by itself.
 *   Backspace as the very next key is that undo (Word's convention).
 * - **What the page remembers.** Two marks, held with the letters as `forced`
 *   is held with a cue (docs/app/writing/editor-ux.md#EDIT-177): `castCaps` on capitals this made, `castKept`
 *   on an occurrence the writer declined. Neither is written to the script
 *   (fountain/inline.ts drops both); after a reopen, rule one protects every
 *   word: none is changed by a key typed after it.
 */
import { Extension } from "@tiptap/core";
import { closeHistory, isHistoryTransaction, undo } from "@tiptap/pm/history";
import type { Mark, MarkType, Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { ownText } from "../comments/own-text";
import type { FormatSpec } from "../format";
import type { Lexicon } from "../spell";
import { cuePrefix } from "./cast";

/** The mark on capitals this rule made. */
export const CAST_CAPS = "castCaps";
/** The mark on an occurrence the writer kept in their own case. */
export const CAST_KEPT = "castKept";

/** The directions: where a name typed goes to capitals. */
const DIRECTIONS: ReadonlySet<string> = new Set(["action", "parenthetical"]);

/** A character of a word: a letter, a mark on one, a digit, an apostrophe or a hyphen. */
const WORD_CHAR = /[\p{L}\p{M}\p{N}'’-]/u;
const TRAILING_BOUNDARY = /[^\p{L}\p{M}\p{N}'’-]+$/u;
const LETTER = /\p{L}/u;
const UPPER_START = /^\p{Lu}/u;

/**
 * Is this word, as the writer typed it, an ordinary word of the play's
 * language rather than a name (`ordinaryWords`)?
 */
export type OrdinaryWord = (typed: string) => boolean;

/**
 * The play's dictionary as the rule asks it: a word is ordinary when the
 * dictionary has it in lower case, unless the writer gave it a capital and
 * the dictionary carries it as a name too. So `it` and `It`, `will`,
 * `rose` and `charlie` are ordinary, and `Will`, `Rose` and `Charlie` are
 * names; `June` and `Mara`, which it has only as names, never are. With no
 * dictionary for the play's language, no word is.
 */
export function ordinaryWords(
  lexicon: Pick<Lexicon, "correct" | "names"> | null,
  extra: Iterable<string> = [],
): OrdinaryWord {
  if (!lexicon) return () => false;
  const more = new Set([...extra].map((w) => w.toLowerCase()));
  return (typed) => {
    const lower = typed.toLowerCase();
    if (!lexicon.correct(lower) && !more.has(lower)) return false;
    return !(UPPER_START.test(typed) && lexicon.names?.has(lower));
  };
}

export interface CastNamesConfig {
  /** The format asks for it and auto-caps is on. */
  on: boolean;
  /**
   * The cast the editor knows apart from the script's own cues, which are read
   * from the page when a name is finished: the binder's characters and the
   * title page's Characters list.
   */
  names: readonly string[];
  /**
   * The play's dictionary (`ordinaryWords`), or null while it loads or when
   * it could not be: until it answers, no one-word name is capitalized.
   */
  ordinary: OrdinaryWord | null;
}

export const NO_CAST_NAMES: CastNamesConfig = { on: false, names: [], ordinary: null };

/**
 * Whether the rule is on: the play's format asks for it on its stage
 * directions (docs/app/formatting/formats-and-layout.md#FMT-163), and auto-caps is on (docs/app/writing/editor-ux.md#EDIT-54).
 */
export function namesInDirectionsOn(autoCaps: boolean, format: FormatSpec): boolean {
  return autoCaps && format.elements.action.capitalizeCastNames;
}

// ---------------------------------------------------------------------------
// Finding a name

interface NameEntry {
  /** The name's words, upper-cased: ["THE", "HOST"]. */
  words: string[];
}

/** Names by their last word, for the lookup a finished word makes. */
export type NameIndex = Map<string, NameEntry[]>;

const norm = (s: string) => s.normalize("NFC").replace(/’/g, "'");

export function indexNames(names: Iterable<string>): NameIndex {
  const index: NameIndex = new Map();
  const seen = new Set<string>();
  for (const raw of names) {
    const name = norm(cuePrefix(raw)).toUpperCase().replace(/\s+/g, " ").trim();
    if (!name || seen.has(name) || !LETTER.test(name)) continue;
    seen.add(name);
    const words = name.split(" ");
    const last = words[words.length - 1]!;
    const list = index.get(last) ?? [];
    list.push({ words });
    index.set(last, list);
  }
  return index;
}

/** A name found in a line: what the rule would put in capitals. */
export interface Occurrence {
  /** Offsets in the line's text, the letters to capitalize: no possessive. */
  start: number;
  end: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The name, if any, that ends `text` (the run of text before a boundary).
 * Whole words only; a possessive ending stays as typed; a name of several
 * words is taken whole when it is typed whole, and as its last word when the
 * words before it are in lower case and that word is not ("the Host").
 */
export function nameEnding(
  text: string,
  index: NameIndex,
  ordinary: OrdinaryWord | null,
): Occurrence | null {
  let tokenStart = text.length;
  while (tokenStart > 0 && WORD_CHAR.test(text[tokenStart - 1]!)) tokenStart--;
  const token = text.slice(tokenStart);
  if (!token) return null;
  // The word, without what may stand around a name in it: a possessive or a
  // dash after it, a quote before it.
  const lead = /^['’-]*/.exec(token)![0].length;
  const trail = /(?:['’][sS]?|-+)$/.exec(token.slice(lead))?.[0].length ?? 0;
  const stem = token.slice(lead, token.length - trail);
  if (!LETTER.test(stem)) return null;
  const stemStart = tokenStart + lead;
  const stemEnd = stemStart + stem.length;
  const upper = norm(stem).toUpperCase();
  const entries = index.get(upper);
  if (!entries) return null;

  const before = lead === 0 ? text.slice(0, tokenStart) : "";
  // A name of several words, typed whole: the longest wins.
  let whole: Occurrence | null = null;
  let wholeWords = 0;
  for (const { words } of entries) {
    if (words.length < 2 || words.length <= wholeWords || !before) continue;
    const prefix = words.slice(0, -1).map(escape).join("\\s+");
    // Same length as `before`, so the match's offsets are the line's.
    const hit = new RegExp(`(?:^|[^\\p{L}\\p{M}\\p{N}'’-])(${prefix})(\\s+)$`, "iu").exec(
      before.replace(/’/g, "'"),
    );
    if (!hit) continue;
    const typed = hit[1]!;
    // "the Host": the words before it are the writer's prose, not the name.
    if (typed === typed.toLowerCase() && UPPER_START.test(stem)) continue;
    whole = { start: before.length - hit[2]!.length - typed.length, end: stemEnd };
    wholeWords = words.length;
  }
  if (whole) return whole;

  const isOrdinary = ordinary ? ordinary(stem) : null;
  for (const { words } of entries) {
    if (words.length === 1) {
      // A one-word name that is an ordinary word (IT, DO): the writer types
      // it in capitals. Unknown until the dictionary answers.
      if (isOrdinary !== false) continue;
      return { start: stemStart, end: stemEnd };
    }
  }
  // The last word of a longer name, alone. An ordinary word ("host") counts
  // only when the writer gave it a capital, as in "the Host": after the words
  // before it in lower case, the capital says it is the name.
  if (entries.some(({ words }) => words.length > 1)) {
    if (isOrdinary !== false && !UPPER_START.test(stem)) return null;
    return { start: stemStart, end: stemEnd };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading the page

/**
 * The run of text before `offset` in a line, back to the line's start or to
 * the nearest thing in it that is not text (a comment, a line break), and the
 * line offset it starts at.
 */
export function textBefore(line: PMNode, offset: number): { text: string; from: number } {
  let text = "";
  let from = 0;
  let at = 0;
  line.forEach((child) => {
    if (at >= offset) return;
    const end = at + child.nodeSize;
    if (child.isText) {
      const part = child.text!.slice(0, Math.min(child.nodeSize, offset - at));
      if (text === "" && from !== at) from = at;
      text += part;
    } else {
      text = "";
      from = end;
    }
    at = end;
  });
  return { text, from };
}

/** The cast the page names: the configured names and every cue's. */
function poolFor(doc: PMNode, names: readonly string[]): NameIndex {
  const all: string[] = [...names];
  doc.forEach((block) => {
    if (block.type.name === "character") all.push(ownText(block));
  });
  return indexNames(all);
}

/** Does every character of [from, to) carry the mark? */
function wholly(doc: PMNode, from: number, to: number, type: MarkType): boolean {
  let all = to > from;
  doc.nodesBetween(from, to, (node) => {
    if (node.isText && !type.isInSet(node.marks)) all = false;
  });
  return all;
}

/** A name ending at `pos` in a direction, as positions in `doc`. */
export function occurrenceAt(
  doc: PMNode,
  pos: number,
  config: CastNamesConfig,
  index?: NameIndex,
): { from: number; to: number } | null {
  if (!config.on) return null;
  const $pos = doc.resolve(pos);
  if (!DIRECTIONS.has($pos.parent.type.name)) return null;
  const { text, from } = textBefore($pos.parent, $pos.parentOffset);
  const found = nameEnding(text, index ?? poolFor(doc, config.names), config.ordinary);
  if (!found) return null;
  const start = $pos.start() + from;
  return { from: start + found.start, to: start + found.end };
}

// ---------------------------------------------------------------------------
// Changing the page

/** The occurrence in capitals, each text node keeping its own marks, marked as made here. */
export function capitalize(tr: Transaction, from: number, to: number): Transaction {
  const schema = tr.doc.type.schema;
  const caps = schema.marks[CAST_CAPS]!;
  const kept = schema.marks[CAST_KEPT]!;
  const parts: { at: number; text: string; marks: readonly Mark[] }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    parts.push({ at: a, text: node.text!.slice(a - pos, b - pos), marks: node.marks });
  });
  const start = tr.steps.length;
  for (const part of parts) {
    // A letter can upper-case to two (ß → SS): each part is found through
    // what this transaction has done already (docs/app/writing/editor-ux.md#EDIT-178).
    const at = tr.mapping.slice(start).map(part.at);
    const marks = caps.create().addToSet(kept.removeFromSet(part.marks));
    tr.replaceWith(at, at + part.text.length, schema.text(part.text.toUpperCase(), marks));
  }
  return tr;
}

/** Is a name ending here declined, or capitalized before and since changed by hand? */
function declined(doc: PMNode, from: number, to: number): boolean {
  const schema = doc.type.schema;
  return (
    doc.rangeHasMark(from, to, schema.marks[CAST_KEPT]!) ||
    doc.rangeHasMark(from, to, schema.marks[CAST_CAPS]!)
  );
}

/** The occurrence declined, whole: no capitals made here left on it. */
function keep(tr: Transaction, from: number, to: number): Transaction {
  const schema = tr.doc.type.schema;
  tr.removeMark(from, to, schema.marks[CAST_CAPS]!);
  tr.addMark(from, to, schema.marks[CAST_KEPT]!.create());
  return tr;
}

// ---------------------------------------------------------------------------
// The plugin

interface Typed {
  from: number;
  to: number;
  text: string;
}

/**
 * What was typed into a document, noted by `handleTextInput` (or a test) just
 * before the transaction that types it, and found again by that document.
 */
const typedInto = new WeakMap<PMNode, Typed>();
/** An Enter or Shift+Enter pressed in a document, at the caret. */
const enteredIn = new WeakMap<PMNode, number>();

/** Note that `text` is about to be typed over [from, to) of `doc`. */
export function noteTyped(doc: PMNode, from: number, to: number, text: string): void {
  typedInto.set(doc, { from, to, text });
}

/** Note that Enter is about to be pressed with the caret at `pos` of `doc`. */
export function noteEnter(doc: PMNode, pos: number): void {
  enteredIn.set(doc, pos);
}

/** Is `tr` the typing noted against the document it starts from? */
function typingOf(tr: Transaction, doc: PMNode): Typed | null {
  const typed = typedInto.get(doc);
  if (!typed || tr.steps.length === 0) return null;
  const step = tr.steps[0];
  if (!(step instanceof ReplaceStep) || step.from !== typed.from || step.to !== typed.to)
    return null;
  return step.slice.content.textBetween(0, step.slice.content.size) === typed.text ? typed : null;
}

/** Capitals this rule made as the writer typed, and the letters they replaced. */
interface Made {
  from: number;
  to: number;
  /** The writer's letters, as typed. */
  text: string;
}

/** How many of them the page remembers: enough for any run of ⌘Z. */
const MADE_KEPT = 100;

interface NamesState {
  config: CastNamesConfig;
  /** Where the caret stood after the last letter typed, while nothing else happened since. */
  typedAt: number | null;
  /** Where the caret stood after capitals just made, for a Backspace that takes them back. */
  capped: number | null;
  made: readonly Made[];
}

type NamesMeta =
  | { type: "config"; config: CastNamesConfig }
  | { type: "caps"; caret: number; made: Made | null };

export const castNamesKey = new PluginKey<NamesState>("castNames");

/** Each remembered occurrence through a transaction; one it deleted is forgotten. */
function mapMade(made: readonly Made[], tr: Transaction): readonly Made[] {
  if (!tr.docChanged || made.length === 0) return made;
  const out: Made[] = [];
  for (const m of made) {
    const from = tr.mapping.map(m.from, 1);
    const to = tr.mapping.map(m.to, -1);
    if (to > from) out.push({ ...m, from, to });
  }
  return out;
}

function nextState(
  tr: Transaction,
  prev: NamesState,
  oldState: EditorState,
  newState: EditorState,
): NamesState {
  const meta = tr.getMeta(castNamesKey) as NamesMeta | undefined;
  const config = meta?.type === "config" ? meta.config : prev.config;
  const made = mapMade(prev.made, tr);
  if (meta?.type === "caps") {
    const kept = meta.made
      ? [
          ...made,
          {
            ...meta.made,
            from: tr.mapping.map(meta.made.from, 1),
            to: tr.mapping.map(meta.made.to, -1),
          },
        ].slice(-MADE_KEPT)
      : made;
    return { config, typedAt: null, capped: meta.caret, made: kept };
  }
  if (!tr.docChanged) {
    const moved = tr.selectionSet && !newState.selection.eq(oldState.selection);
    return moved ? { config, typedAt: null, capped: null, made } : { ...prev, config };
  }
  const typed = typingOf(tr, oldState.doc);
  if (typed) {
    const end = tr.mapping.slice(1).map(typed.from + typed.text.length);
    const last = typed.text[typed.text.length - 1] ?? "";
    return { config, typedAt: WORD_CHAR.test(last) ? end : null, capped: null, made };
  }
  // What another plugin adds to a keystroke is part of it; anything else that
  // changes the page is not typing.
  if (tr.getMeta("appendedTransaction")) {
    return {
      config,
      typedAt: prev.typedAt === null ? null : tr.mapping.map(prev.typedAt),
      capped: prev.capped === null ? null : tr.mapping.map(prev.capped),
      made,
    };
  }
  return { config, typedAt: null, capped: null, made };
}

/** Where a name typed just now ends, if this dispatch began with typing that finished one. */
function finishedName(
  trs: readonly Transaction[],
  oldState: EditorState,
  prev: NamesState,
): number | null {
  const root = trs[0];
  if (!root?.docChanged || root.getMeta("appendedTransaction")) return null;
  const typed = typingOf(root, oldState.doc);
  if (typed) {
    const boundary = TRAILING_BOUNDARY.exec(typed.text)?.[0];
    if (!boundary) return null;
    const wordEnd = typed.from + typed.text.length - boundary.length;
    // The letter before the boundary was typed: in this input, or the one before.
    const lettersHere = wordEnd > typed.from;
    if (!lettersHere && prev.typedAt !== typed.from) return null;
    if (lettersHere && !WORD_CHAR.test(typed.text[wordEnd - typed.from - 1]!)) return null;
    // `wordEnd` is past the keystroke's own step already.
    return mapThrough(trs, wordEnd, 1);
  }
  const entered = enteredIn.get(oldState.doc);
  if (entered !== undefined && prev.typedAt === entered) return mapThrough(trs, entered, 0);
  return null;
}

/** A position mapped through `trs`, the first `skip` steps of the first left out. */
function mapThrough(trs: readonly Transaction[], pos: number, skip: number): number {
  let at = trs[0]!.mapping.slice(skip).map(pos, -1);
  for (const tr of trs.slice(1)) at = tr.mapping.map(at, -1);
  return at;
}

/**
 * Text typed, pasted or replaced over capitals this rule made is the writer
 * changing their case by hand: the new letters are declined.
 */
function keptOver(trs: readonly Transaction[], state: EditorState): Transaction | null {
  const caps = state.schema.marks[CAST_CAPS]!;
  const ranges: [number, number][] = [];
  trs.forEach((tr, t) => {
    if (isHistoryTransaction(tr) || tr.getMeta("addToHistory") === false) return;
    // The writer's own change, not what a plugin adds to one.
    if (tr.getMeta(castNamesKey) || tr.getMeta("appendedTransaction")) return;
    tr.steps.forEach((step, i) => {
      if (!(step instanceof ReplaceStep) || step.to <= step.from || step.slice.size === 0) return;
      if (!wholly(tr.docs[i]!, step.from, step.to, caps)) return;
      let from = step.from;
      let to = step.from + step.slice.size;
      const rest = tr.mapping.slice(i + 1);
      from = rest.map(from, 1);
      to = rest.map(to, -1);
      for (const later of trs.slice(t + 1)) {
        from = later.mapping.map(from, 1);
        to = later.mapping.map(to, -1);
      }
      ranges.push([from, to]);
    });
  });
  if (ranges.length === 0) return null;
  const tr = state.tr;
  for (const [from, to] of ranges) if (to > from) keep(tr, from, to);
  return tr.docChanged ? tr : null;
}

/**
 * An undo that put back the writer's letters over capitals this rule made:
 * those letters are declined. The mark is appended to the undo, so a redo
 * takes it away again with the capitals it brings back.
 */
function keptByUndo(
  trs: readonly Transaction[],
  prev: NamesState,
  state: EditorState,
): Transaction | null {
  if (!trs.some(isHistoryTransaction)) return null;
  const caps = state.schema.marks[CAST_CAPS]!;
  const tr = state.tr;
  for (const m of prev.made) {
    let from = m.from;
    let to = m.to;
    for (const t of trs) {
      from = t.mapping.map(from, 1);
      to = t.mapping.map(to, -1);
    }
    if (to <= from || state.doc.textBetween(from, to) !== m.text) continue;
    if (state.doc.rangeHasMark(from, to, caps)) continue;
    keep(tr, from, to);
  }
  return tr.docChanged ? tr : null;
}

export function castNamesPlugin(initial: CastNamesConfig = NO_CAST_NAMES): Plugin<NamesState> {
  return new Plugin<NamesState>({
    key: castNamesKey,
    state: {
      init: () => ({ config: initial, typedAt: null, capped: null, made: [] }),
      apply: (tr, prev, oldState, newState) => nextState(tr, prev, oldState, newState),
    },
    props: {
      handleTextInput(view, from, to, text) {
        enteredIn.delete(view.state.doc);
        if (!view.composing) noteTyped(view.state.doc, from, to, text);
        return false;
      },
      handleKeyDown(view, event) {
        enteredIn.delete(view.state.doc);
        const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
        const { selection } = view.state;
        if (!plain || view.composing || !selection.empty) return false;
        const state = castNamesKey.getState(view.state);
        if (event.key === "Backspace" && state?.capped === selection.head) {
          // The capitals taken back and the boundary kept: one undo, the same
          // as ⌘Z, which also declines the letters it puts back.
          return undo(view.state, view.dispatch);
        }
        if (event.key === "Enter") noteEnter(view.state.doc, selection.head);
        return false;
      },
    },
    appendTransaction(trs, oldState, newState) {
      const prev = castNamesKey.getState(oldState)!;
      const byUndo = keptByUndo(trs, prev, newState);
      if (byUndo) return byUndo;

      const config = castNamesKey.getState(newState)!.config;
      const end = config.on ? finishedName(trs, oldState, prev) : null;
      const found = end === null ? null : occurrenceAt(newState.doc, end, config);
      if (found) {
        const text = newState.doc.textBetween(found.from, found.to);
        if (text !== text.toUpperCase()) {
          if (declined(newState.doc, found.from, found.to)) {
            const tr = keep(newState.tr, found.from, found.to);
            return tr.docChanged ? tr : null;
          }
          // Its own undo step, after the keystroke's.
          const tr = closeHistory(capitalize(newState.tr, found.from, found.to));
          return tr.setMeta(castNamesKey, {
            type: "caps",
            caret: tr.selection.head,
            made: { from: found.from, to: found.to, text },
          } satisfies NamesMeta);
        }
      }
      return keptOver(trs, newState);
    },
  });
}

// ---------------------------------------------------------------------------
// Every name in a script (the document menu's Capitalize Character Names in Directions…)

export interface ScriptOccurrence {
  from: number;
  to: number;
  /** The name as the line has it now. */
  name: string;
  /** The whole line it is in, for the list. */
  line: string;
  /** Where the name stands in `line`. */
  at: number;
}

/**
 * A direction as the list shows it: its words, a break as a space, no
 * comment; and its runs of text, which a comment or a break ends.
 */
function lineOf(block: PMNode): {
  line: string;
  runs: { text: string; from: number; at: number }[];
} {
  const runs: { text: string; from: number; at: number }[] = [];
  let line = "";
  let open = false;
  block.forEach((child, childOffset) => {
    if (child.isText) {
      if (!open) runs.push({ text: "", from: childOffset, at: line.length });
      runs[runs.length - 1]!.text += child.text!;
      line += child.text!;
      open = true;
      return;
    }
    open = false;
    if (child.type.name === "lineBreak") line += " ";
  });
  return { line, runs };
}

/**
 * An occurrence the writer kept in their own case from the command, as the
 * play file holds it (docs/app/keeping-work/storage-and-file-format.md#STOR-194):
 * the name in capitals, its line's key, and which appearance of the name on
 * the line it is. Nothing of the line's words is kept, only their key.
 */
export interface KeptName {
  name: string;
  line: string;
  nth: number;
}

/**
 * A line's key: its words in capitals, white space as one space, hashed
 * (FNV-1a, 32 bits, as hex). In capitals, so capitalizing a name on the line,
 * which is all the command changes, leaves its key as it was.
 */
export function lineKey(line: string): string {
  const text = line.toUpperCase().replace(/\s+/g, " ").trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** How many times `name` stands on `line` before `at`: whole words, whatever their case. */
function appearancesBefore(name: string, line: string, at: number): number {
  const word = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}'’-])${escape(name)}(?![\\p{L}\\p{M}\\p{N}])`,
    "giu",
  );
  let n = 0;
  for (const m of line.matchAll(word)) {
    if (m.index >= at) break;
    n++;
  }
  return n;
}

/** The play file's record of an occurrence the writer kept. */
export function keptName(o: Pick<ScriptOccurrence, "name" | "line" | "at">): KeptName {
  return {
    name: o.name.toUpperCase(),
    line: lineKey(o.line),
    nth: appearancesBefore(o.name, o.line, o.at),
  };
}

const sameKept = (a: KeptName, b: KeptName) =>
  a.name === b.name && a.line === b.line && a.nth === b.nth;

/**
 * The records that still name a place in the script: a line with that key,
 * holding the name that many times. One whose line was changed or deleted is
 * gone with it, so the list never outgrows the script.
 */
export function keptStill(doc: PMNode, entries: readonly KeptName[]): KeptName[] {
  const lines = new Map<string, string>();
  doc.forEach((block) => {
    if (!DIRECTIONS.has(block.type.name)) return;
    const { line } = lineOf(block);
    lines.set(lineKey(line), line);
  });
  return entries.filter((e) => {
    const line = lines.get(e.line);
    return line !== undefined && appearancesBefore(e.name, line, line.length) > e.nth;
  });
}

/**
 * The play file's list after the command applies: what of it still names a
 * place, and the occurrences the writer left unticked this time. Null when
 * that is the list it already holds, so an apply with nothing new writes
 * nothing.
 */
export function keptAfter(
  doc: PMNode,
  entries: readonly KeptName[],
  unticked: readonly Pick<ScriptOccurrence, "name" | "line" | "at">[],
): KeptName[] | null {
  const next = keptStill(doc, entries);
  for (const o of unticked) {
    const k = keptName(o);
    if (!next.some((e) => sameKept(e, k))) next.push(k);
  }
  const same =
    next.length === entries.length && next.every((e) => entries.some((f) => sameKept(e, f)));
  return same ? null : next;
}

/**
 * Every occurrence the rule would capitalize, in script order: each name in a
 * direction, whole words only, not in capitals already, and not declined on
 * the page (`castKept`) or in the play file's list (`keptNames`).
 */
export function scriptOccurrences(
  doc: PMNode,
  config: Pick<CastNamesConfig, "names" | "ordinary">,
  keptNames: readonly KeptName[] = [],
): ScriptOccurrence[] {
  const index = poolFor(doc, config.names);
  const kept = doc.type.schema.marks[CAST_KEPT]!;
  const out: ScriptOccurrence[] = [];
  doc.forEach((block, offset) => {
    if (!DIRECTIONS.has(block.type.name)) return;
    const start = offset + 1;
    const { line, runs } = lineOf(block);
    for (const run of runs) {
      // A name ends where a word does.
      for (let end = 1; end <= run.text.length; end++) {
        if (!WORD_CHAR.test(run.text[end - 1]!)) continue;
        if (end < run.text.length && WORD_CHAR.test(run.text[end]!)) continue;
        const found = nameEnding(run.text.slice(0, end), index, config.ordinary);
        if (!found) continue;
        const a = start + run.from + found.start;
        const b = start + run.from + found.end;
        const name = run.text.slice(found.start, found.end);
        if (name === name.toUpperCase() || doc.rangeHasMark(a, b, kept)) continue;
        const o = { from: a, to: b, name, line, at: run.at + found.start };
        const k = keptName(o);
        if (keptNames.some((e) => sameKept(e, k))) continue;
        out.push(o);
      }
    }
  });
  return out;
}

/**
 * The command's change, as one undo step: the occurrences chosen in capitals,
 * the others declined.
 */
export function capitalizeChosen(
  state: EditorState,
  occurrences: readonly ScriptOccurrence[],
  chosen: ReadonlySet<number>,
): Transaction {
  const tr = state.tr;
  occurrences.forEach((o, i) => {
    const from = tr.mapping.map(o.from);
    const to = tr.mapping.map(o.to, -1);
    if (chosen.has(i)) capitalize(tr, from, to);
    else keep(tr, from, to);
  });
  closeHistory(tr);
  return tr.setMeta(castNamesKey, { type: "caps", caret: -1, made: null } satisfies NamesMeta);
}

export const CastNames = Extension.create({
  name: "castNames",
  // Before the keymaps and input rules of every other extension: it only
  // notes what was typed, and Backspace straight after capitals is its own.
  priority: 1100,

  addProseMirrorPlugins() {
    return [castNamesPlugin()];
  },

  addCommands() {
    return {
      setCastNames:
        (config: CastNamesConfig) =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(castNamesKey, { type: "config", config } satisfies NamesMeta);
          return true;
        },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    castNames: {
      /** What the rule knows: on or off, the cast, the play's dictionary. */
      setCastNames: (config: CastNamesConfig) => ReturnType;
    };
  }
}
