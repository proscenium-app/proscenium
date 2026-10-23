// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A document's redline as a document the page can draw
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-177): a note, a
 * character sheet or an outline read as it is written, with headings, lists
 * and emphasis on the page, and the words that were cut struck through and
 * the ones added underlined where they stand. Its Markdown is never on show.
 *
 * Both texts are read by the one Markdown grammar the page uses (doc.ts),
 * then compared element against element (a heading, a paragraph, a list item,
 * a quote) and word against word inside an element that was rewritten, by the
 * same rules as a script's redline. The result is loaded into a read-only
 * editor (src/app/RedlineDocument.tsx) and never serialized: nothing here can reach a
 * file. Unchanged stretches are left out, with a few elements kept around each
 * change, and a nested list item is never shown without the item it hangs
 * from.
 */
import {
  compactRedline,
  redlineChanges,
  redlineRows,
  tokenize,
  type RedlinePart,
  type RedlineRow,
  type RedlineToken,
  type RedlineUnit,
} from "./redline";
import { toDoc, type Node } from "../markdown/doc";

export const REDLINE_ADD = "redlineAdd";
export const REDLINE_DEL = "redlineDel";
export const REDLINE_SKIP = "redlineSkip";

/** What happened to an element: the `redline` attribute it carries. */
export type RedlineState = "add" | "del" | "mod";

/** Elements left on show around a change. */
const CONTEXT = 2;

/** Lists, outermost first, that hold a list item. */
type Chain = { type: string; attrs?: Node["attrs"] }[];

/** A token, and the inline node that draws it. */
interface Piece extends RedlineToken {
  node: Node;
}

interface Element extends RedlineUnit {
  /** The block that draws it: a heading, a paragraph, a list item's paragraph… */
  node: Node;
  /** For a list item, the lists it stands in; its number in its own list. */
  chain: Chain | null;
  number: number;
  tokens: Piece[];
}

/** Shown whole, as cut or as added: no words to mark inside. */
const WHOLE = new Set(["horizontalRule", "table"]);

function marksKey(marks: Node["marks"]): string {
  return JSON.stringify(
    [...(marks ?? [])].sort((a, b) => a.type.localeCompare(b.type)).map((m) => [m.type, m.attrs]),
  );
}

function pieces(content: Node[] | undefined): Piece[] {
  const out: Piece[] = [];
  for (const node of content ?? []) {
    if (node.type === "text") {
      const marks = marksKey(node.marks);
      for (const token of tokenize(node.text ?? "")) {
        out.push({
          key: `${marks}\u0002${token.key}`,
          word: token.word,
          space: token.space,
          node: { ...node, text: token.key },
        });
      }
    } else {
      // A line break inside a paragraph: one thing, changed or not.
      out.push({ key: `\u0003${node.type}`, word: false, node });
    }
  }
  return out;
}

function element(node: Node, kind: string, chain: Chain | null, number = 0): Element {
  const whole = WHOLE.has(node.type);
  const align = node.attrs?.textAlign;
  return {
    kind,
    extra: align ? String(align) : "",
    whole,
    node,
    chain,
    number,
    tokens: whole
      ? [{ key: JSON.stringify(node), word: true, node: { type: "text", text: "" } }]
      : pieces(node.content),
  };
}

const LISTS = new Set(["bulletList", "orderedList"]);

/** A document's elements, in reading order, its lists opened out item by item. */
function elements(markdown: string): Element[] {
  const out: Element[] = [];
  const list = (node: Node, chain: Chain) => {
    const here: Chain = [...chain, { type: node.type, attrs: node.attrs }];
    const start = Number(node.attrs?.start ?? 1);
    (node.content ?? []).forEach((item, i) => {
      const [first, ...rest] = item.content ?? [];
      const kind = `item:${here.map((l) => l.type).join(">")}`;
      out.push(element(first ?? { type: "paragraph" }, kind, here, start + i));
      for (const child of rest) if (LISTS.has(child.type)) list(child, here);
    });
  };
  for (const block of toDoc(markdown).content ?? []) {
    if (block.type === "managedMarker") continue;
    if (LISTS.has(block.type)) list(block, []);
    else if (block.type === "blockquote")
      out.push(element(block.content?.[0] ?? { type: "paragraph" }, "blockquote", null));
    else if (block.type === "heading")
      out.push(element(block, `heading:${String(block.attrs?.level ?? 1)}`, null));
    else out.push(element(block, block.type, null));
  }
  return out;
}

/** Inline nodes for these pieces, each carrying `mark` as well as its own. */
function marked(list: Piece[], mark: string | null): Node[] {
  const out: Node[] = [];
  for (const { node } of list) {
    if (node.type === "text" && !node.text) continue;
    const marks = mark ? [...(node.marks ?? []), { type: mark }] : node.marks;
    const next: Node = marks?.length ? { ...node, marks } : { ...node };
    if (!marks?.length) delete next.marks;
    const last = out[out.length - 1];
    if (
      last?.type === "text" &&
      next.type === "text" &&
      JSON.stringify(last.marks ?? []) === JSON.stringify(next.marks ?? [])
    ) {
      last.text = `${last.text ?? ""}${next.text ?? ""}`;
    } else {
      out.push(next);
    }
  }
  return out;
}

/** Cut or added words with `mark` on the words alone: the space either side is drawn as space. */
function markedWords(list: Piece[], mark: string): Node[] {
  let from = 0;
  let to = list.length;
  while (from < to && list[from]!.space) from++;
  while (to > from && list[to - 1]!.space) to--;
  return [
    ...marked(list.slice(0, from), null),
    ...marked(list.slice(from, to), mark),
    ...marked(list.slice(to), null),
  ];
}

/** Every text node under `node` carrying `mark`: a table cut or added whole. */
function markAll(node: Node, mark: string): Node {
  if (node.type === "text") return { ...node, marks: [...(node.marks ?? []), { type: mark }] };
  return node.content ? { ...node, content: node.content.map((n) => markAll(n, mark)) } : node;
}

function partContent(a: Element, b: Element, parts: RedlinePart[]): Node[] {
  const all: Node[] = [];
  for (const part of parts) {
    if (part.state === "del")
      all.push(
        ...markedWords(
          part.a.map((at) => a.tokens[at]!),
          REDLINE_DEL,
        ),
      );
    else if (part.state === "add")
      all.push(
        ...markedWords(
          part.b.map((at) => b.tokens[at]!),
          REDLINE_ADD,
        ),
      );
    else
      all.push(
        ...marked(
          part.b.map((at) => b.tokens[at]!),
          null,
        ),
      );
  }
  return marked(
    all.map((node) => ({ key: "", word: false, node })),
    null,
  );
}

/** The block an element is drawn as, with what happened to it. */
function drawn(row: RedlineRow, a: Element[], b: Element[]): { el: Element; node: Node } {
  const el = row.state === "del" ? a[row.a]! : b[row.b]!;
  const state: RedlineState | null = row.state === "same" ? null : row.state;
  const mark = row.state === "add" ? REDLINE_ADD : row.state === "del" ? REDLINE_DEL : null;
  let block: Node;
  if (el.whole) block = mark ? markAll(el.node, mark) : el.node;
  else {
    const content =
      row.state === "mod" ? partContent(a[row.a]!, b[row.b]!, row.parts) : marked(el.tokens, mark);
    block = { ...el.node, content: content.length ? content : undefined };
    if (!block.content) delete block.content;
  }
  if (state) block = { ...block, attrs: { ...block.attrs, redline: state } };
  if (el.kind === "blockquote") block = { type: "blockquote", content: [block] };
  return { el, node: block };
}

export interface DocumentRedline {
  /** The document to load, or null when no element changed. */
  doc: Node | null;
  /** Elements cut, added or rewritten. */
  changes: number;
}

/** Both texts of a document as one read-only document, the unchanged stretches left out. */
export function documentRedline(before: string, after: string): DocumentRedline {
  const a = elements(before);
  const b = elements(after);
  const rows = redlineRows(a, b);
  const changes = redlineChanges(rows);
  if (!changes) return { doc: null, changes };

  const elOf = (i: number) => {
    const row = rows[i]!;
    return row.state === "del" ? a[row.a]! : b[row.b]!;
  };
  // The item a nested item hangs from: the nearest item before it one list out.
  const needs = (i: number): number[] => {
    const depth = elOf(i).chain?.length ?? 0;
    if (depth < 2) return [];
    for (let k = i - 1; k >= 0; k--) {
      const d = elOf(k).chain?.length ?? 0;
      if (d === 0) return [];
      if (d === depth - 1) return [k];
    }
    return [];
  };
  const items = compactRedline(rows, CONTEXT, undefined, needs);

  const content: Node[] = [];
  /** The lists open at the end of what is drawn so far, outermost first. */
  let open: { type: string; node: Node; item: Node | null }[] = [];
  for (const item of items) {
    if (item.kind === "skip") {
      open = [];
      content.push({ type: REDLINE_SKIP, attrs: { count: item.count } });
      continue;
    }
    const { el, node } = drawn(item.row, a, b);
    if (!el.chain) {
      open = [];
      content.push(node);
      continue;
    }
    // Keep the lists this item shares with the one before; close the rest.
    let keep = 0;
    while (
      keep < open.length &&
      keep < el.chain.length &&
      open[keep]!.type === el.chain[keep]!.type
    )
      keep++;
    open = open.slice(0, keep);
    for (let depth = open.length; depth < el.chain.length; depth++) {
      const ref = el.chain[depth]!;
      const ordered = ref.type === "orderedList";
      const list: Node = {
        type: ref.type,
        ...(ordered ? { attrs: { start: depth === el.chain.length - 1 ? el.number : 1 } } : {}),
        content: [],
      };
      const parent = open[depth - 1];
      if (depth === 0) content.push(list);
      else if (parent?.item) parent.item.content!.push(list);
      else content.push(list);
      open.push({ type: ref.type, node: list, item: null });
    }
    const listItem: Node = { type: "listItem", content: [node] };
    const own = open[open.length - 1]!;
    own.node.content!.push(listItem);
    own.item = listItem;
  }
  return { doc: { type: "doc", content }, changes };
}
