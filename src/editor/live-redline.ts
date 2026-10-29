// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A change drawn on the script being written
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-185): the same
 * redline Changes draws on its page, laid over the live editor. Cut words are
 * struck through where they stood, added ones underlined, and a whole element
 * that was cut is drawn as that element, in the format's column, struck
 * through. Every change is drawn once, whatever number of saves made it.
 *
 * DECORATIONS ONLY. Nothing here enters the document, so a mark can never be
 * typed into a play or saved to one, and taking the redline away leaves the
 * script as it was. The decorations move with the writer's typing while they
 * are shown; they are made again only when asked for again.
 *
 * The change is the one between two texts the ledger kept (`before` and
 * `after`, what was there and what the change left). The page may have moved
 * on since: the writer can have typed after it arrived. So `after` is matched
 * to the page element by element, and a change is drawn word by word only on
 * an element that still reads as the change left it. An element the writer
 * has rewritten since keeps the rule in its margin and no word marks, because
 * marks laid on words the change never wrote would credit it with the
 * writer's own.
 */
import { Extension, type Editor } from "@tiptap/core";
import { DOMSerializer, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { COMMENT_RANGE, COMMENT_RANGE_END, dropRangeMarkers } from "../comments/ranges";
import { parse } from "../fountain";
import {
  redlineChanges,
  redlineRows,
  tokenize,
  type RedlineRow,
  type RedlineUnit,
} from "../review/redline";
import { LINE_BREAK, toEditorDoc } from "./bridge";

/** Shown whole, as cut or as added: no words to mark inside. */
const WHOLE = new Set(["boneyard", "pageBreak"]);
/** Marks that say where a comment is, not how a word is written. */
const NOT_WRITING = new Set([COMMENT_RANGE, COMMENT_RANGE_END]);

interface Token {
  key: string;
  word: boolean;
  space?: boolean;
  /** Where it stands in its document. */
  from: number;
  to: number;
  text: string;
}

interface Block extends RedlineUnit {
  node: PMNode;
  /** Where the block starts in its document. */
  pos: number;
  tokens: Token[];
}

function attrsKey(attrs: PMNode["attrs"]): string {
  const kept = Object.entries(attrs ?? {}).filter(([, v]) => v !== null && v !== false && v !== "");
  return kept.length ? JSON.stringify(kept.sort(([a], [b]) => a.localeCompare(b))) : "";
}

/**
 * A document's elements as the redline reads them. `withAttrs`: two elements
 * of one kind with different settings (a cue made dual) are different
 * elements. Matching the change to the page leaves them out, since the page
 * keeps settings of its own that a parsed text does not.
 */
function blocksOf(doc: PMNode, withAttrs: boolean): Block[] {
  const out: Block[] = [];
  doc.forEach((node, offset) => {
    const whole = WHOLE.has(node.type.name);
    const tokens: Token[] = [];
    if (whole) {
      const text = node.textContent;
      tokens.push({ key: text, word: true, from: offset, to: offset + node.nodeSize, text });
    } else {
      node.forEach((child, childOffset) => {
        const at = offset + 1 + childOffset;
        if (child.isText) {
          const marks = child.marks
            .filter((m) => !NOT_WRITING.has(m.type.name))
            .map((m) => m.type.name)
            .sort()
            .join("+");
          let p = at;
          for (const t of tokenize(child.text ?? "")) {
            tokens.push({
              key: `${marks}\u0002${t.key}`,
              word: t.word,
              space: t.space,
              from: p,
              to: p + t.key.length,
              text: t.key,
            });
            p += t.key.length;
          }
        } else if (child.type.name === LINE_BREAK) {
          tokens.push({ key: "\n", word: false, from: at, to: at + child.nodeSize, text: "\n" });
        } else {
          const text = child.textContent;
          tokens.push({
            key: `\u0003${child.type.name}\u0002${JSON.stringify(child.attrs)}\u0002${text}`,
            word: true,
            from: at,
            to: at + child.nodeSize,
            text,
          });
        }
      });
    }
    out.push({
      kind: node.type.name,
      extra: withAttrs ? attrsKey(node.attrs) : "",
      whole,
      tokens,
      node,
      pos: offset,
    });
  });
  return out;
}

/** A script's body as the live editor would hold it, or null when the schema refuses it. */
function bodyDoc(schema: Schema, text: string): PMNode | null {
  try {
    const doc = toEditorDoc(dropRangeMarkers(parse(text).doc));
    if (!doc.content.length) return null;
    return schema.nodeFromJSON(doc);
  } catch {
    return null;
  }
}

/** A cut element, drawn as itself and struck through. Never editable. */
function cutElement(schema: Schema, node: PMNode): HTMLElement {
  const el = DOMSerializer.fromSchema(schema).serializeNode(node) as HTMLElement;
  el.setAttribute("data-redline", "del");
  el.setAttribute("contenteditable", "false");
  if (!WHOLE.has(node.type.name)) {
    const del = document.createElement("del");
    del.className = "redline-del";
    while (el.firstChild) del.appendChild(el.firstChild);
    el.appendChild(del);
  }
  return el;
}

/**
 * Cut words inside an element that stays. The space either side of them is
 * drawn as space, never struck: a line through nothing reads as a dash.
 */
function cutWords(text: string): HTMLElement {
  const [, lead = "", core = "", tail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text) ?? [];
  const span = document.createElement("span");
  span.className = "redline-cut";
  const del = document.createElement("del");
  del.className = "redline-del";
  // textContent, never innerHTML: the words came from a file something else wrote.
  del.textContent = core;
  if (lead) span.append(lead);
  span.append(del);
  if (tail) span.append(tail);
  return span;
}

export interface LiveRedline {
  decorations: DecorationSet;
  /** Elements the change cut, added or rewrote. */
  changes: number;
}

/**
 * The decorations that draw the change from `before` to `after` on `doc`, the
 * page as it stands.
 */
export function liveRedline(doc: PMNode, before: string, after: string): LiveRedline {
  const schema = doc.type.schema;
  const was = bodyDoc(schema, before);
  const is = bodyDoc(schema, after);
  if (!was || !is) return { decorations: DecorationSet.empty, changes: 0 };
  const a = blocksOf(was, true);
  const b = blocksOf(is, true);
  const rows = redlineRows(a, b);
  const changes = redlineChanges(rows);
  if (!changes) return { decorations: DecorationSet.empty, changes };

  // The change's elements on the page: the same element where it still reads
  // as the change left it, rewritten where the writer has typed in it since.
  const page = blocksOf(doc, false);
  const plain = blocksOf(is, false);
  const same = new Map<number, number>();
  const rewritten = new Map<number, number>();
  for (const row of redlineRows(plain, page)) {
    if (row.state === "same") same.set(row.a, row.b);
    else if (row.state === "mod") rewritten.set(row.a, row.b);
  }
  const onPage = (bi: number) => same.get(bi) ?? rewritten.get(bi);

  const decos: Decoration[] = [];
  /** Where on the page the next element of the change starts, from row `i` on. */
  const nextStart = (i: number): number | null => {
    for (let k = i; k < rows.length; k++) {
      const row = rows[k] as RedlineRow;
      if (row.state === "del") continue;
      const at = onPage(row.b);
      if (at !== undefined) return page[at]!.pos;
    }
    return null;
  };
  let order = 0;
  const end = doc.content.size;

  rows.forEach((row, i) => {
    if (row.state === "same") return;
    if (row.state === "del") {
      const at = nextStart(i + 1);
      const cut = a[row.a]!.node;
      order += 1;
      decos.push(
        Decoration.widget(at ?? end, () => cutElement(schema, cut), {
          // Cut elements in a row stand in the order they stood.
          side: at === null ? order : -100_000 + order,
          key: `redline-cut-${i}-${order}`,
          ignoreSelection: true,
          redlineStop: true,
        }),
      );
      return;
    }
    const at = onPage(row.b);
    if (at === undefined) return;
    const block = page[at]!;
    const from = block.pos;
    const to = block.pos + block.node.nodeSize;
    decos.push(Decoration.node(from, to, { "data-redline": row.state }, { redlineStop: true }));
    // Words are marked only where the page still holds the change's words.
    if (!same.has(row.b)) return;
    if (row.state === "add") {
      if (!block.whole && block.node.content.size)
        decos.push(Decoration.inline(from + 1, to - 1, { nodeName: "ins", class: "redline-add" }));
      return;
    }
    let anchor = from + 1;
    for (const part of row.parts) {
      if (part.state === "del") {
        const text = part.a.map((k) => a[row.a]!.tokens[k]!.text).join("");
        order += 1;
        decos.push(
          Decoration.widget(anchor, () => cutWords(text), {
            side: -1,
            key: `redline-words-${i}-${order}`,
            ignoreSelection: true,
          }),
        );
        continue;
      }
      if (!part.b.length) continue;
      const tokens = part.b.map((k) => block.tokens[k]).filter((t): t is Token => !!t);
      const last = tokens[tokens.length - 1];
      if (!last) continue;
      // Added words are underlined; the space either side of them is not.
      const words = tokens.filter((t) => !t.space);
      if (part.state === "add" && words.length)
        decos.push(
          Decoration.inline(words[0]!.from, words[words.length - 1]!.to, {
            nodeName: "ins",
            class: "redline-add",
          }),
        );
      anchor = last.to;
    }
  });
  return { decorations: DecorationSet.create(doc, decos), changes };
}

/** What the layer draws: the two texts of the change, and its decorations on the page now. */
interface LayerState {
  texts: { before: string; after: string } | null;
  set: DecorationSet;
}

const NONE: LayerState = { texts: null, set: DecorationSet.empty };

export const liveRedlineKey = new PluginKey<LayerState>("prosceniumLiveRedline");

/** The whole document replaced in one step: a script read again from its file. */
function replacedWhole(tr: Transaction): boolean {
  return tr.steps.some((step, i) => {
    if (!(step instanceof ReplaceStep)) return false;
    const size = tr.docs[i]!.content.size;
    const { from, to } = step as unknown as { from: number; to: number };
    return from === 0 && to === size && size > 0;
  });
}

/**
 * The layer the redline is drawn in, empty until one is shown.
 *
 * What it draws lives in PLUGIN STATE, set by a meta transaction, never in
 * the extension's options: TipTap's `addProseMirrorPlugins` closes over an
 * options object that is not the one `extensionManager` exposes, so an option
 * changed later never reaches the decorations.
 */
export const LiveRedline = Extension.create({
  name: "prosceniumLiveRedline",
  addProseMirrorPlugins() {
    return [
      new Plugin<LayerState>({
        key: liveRedlineKey,
        state: {
          init: () => NONE,
          apply(tr, layer) {
            const next = tr.getMeta(liveRedlineKey) as LayerState["texts"] | undefined;
            if (next !== undefined)
              return next
                ? { texts: next, set: liveRedline(tr.doc, next.before, next.after).decorations }
                : NONE;
            if (!layer.texts || !tr.docChanged) return layer;
            // The script read again from its file (another change arrived,
            // a version was put back): drawn again on what it now says.
            if (replacedWhole(tr))
              return {
                texts: layer.texts,
                set: liveRedline(tr.doc, layer.texts.before, layer.texts.after).decorations,
              };
            // While it is shown, the writer's typing carries it along.
            return { texts: layer.texts, set: layer.set.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => liveRedlineKey.getState(state)?.set,
        },
      }),
    ];
  },
});

/** Draw the change from `before` to `after` on the page, or take it off with null. */
export function setLiveRedline(
  editor: Editor,
  texts: { before: string; after: string } | null,
): void {
  if (editor.isDestroyed) return;
  const now = liveRedlineKey.getState(editor.state)?.texts ?? null;
  if (now === texts || (now && texts && now.before === texts.before && now.after === texts.after))
    return;
  editor.view.dispatch(
    editor.state.tr.setMeta(liveRedlineKey, texts).setMeta("addToHistory", false),
  );
}

/** The changed elements on the page, top to bottom: where Previous and Next go. */
export function redlineStops(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(".ProseMirror [data-redline]")];
}
