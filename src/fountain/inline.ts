// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Inline emphasis + notes ⇄ Fountain inline markup.
 *
 * fountain-js (the jonnygreenwald fork) leaves inline markup intact in token
 * text — it does not convert `*bold*` to HTML during tokenizing — so we map
 * marks ourselves, which gives full control over reversible escaping
 * (docs/engineering/fountain-model.md#FOUN-D100 round-trip rule 7).
 *
 * Fountain emphasis: `*italic*`, `**bold**`, `***bold italic***`, `_underline_`
 * (underline is distinct from italics). They compose. Inline `[[ … ]]` is a note.
 * A leading `\` escapes the next character to a literal.
 */
import type { InlineNode, Mark, MarkType, NoteNode, TextNode } from "./model";

type Delim = "*" | "**" | "***" | "_";

type Atom =
  | { kind: "text"; text: string }
  | { kind: "note"; inner: string }
  | { kind: "delim"; delim: Delim };

const DELIM_MARKS: Record<Delim, MarkType[]> = {
  "*": ["em"],
  "**": ["strong"],
  "***": ["strong", "em"],
  _: ["underline"],
};

function tokenizeInline(raw: string): Atom[] {
  const atoms: Atom[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      atoms.push({ kind: "text", text: buf });
      buf = "";
    }
  };

  let i = 0;
  while (i < raw.length) {
    const c = raw[i];

    // Escape: backslash makes the next character a literal.
    if (c === "\\" && i + 1 < raw.length) {
      buf += raw[i + 1];
      i += 2;
      continue;
    }

    // Inline note [[ ... ]]
    if (c === "[" && raw[i + 1] === "[") {
      const end = raw.indexOf("]]", i + 2);
      if (end !== -1) {
        flush();
        atoms.push({ kind: "note", inner: raw.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }

    // Emphasis runs
    if (c === "*") {
      let n = 0;
      while (raw[i + n] === "*") n += 1;
      flush();
      const take = Math.min(n, 3);
      atoms.push({ kind: "delim", delim: "*".repeat(take) as Delim });
      // Any extra stars beyond 3 are literal.
      if (n > 3) buf += "*".repeat(n - 3);
      i += n;
      continue;
    }
    if (c === "_") {
      flush();
      atoms.push({ kind: "delim", delim: "_" });
      i += 1;
      continue;
    }

    buf += c;
    i += 1;
  }
  flush();
  return atoms;
}

interface Frame {
  delim: Delim | "";
  marks: MarkType[];
  children: InlineNode[];
}

function addMarks(node: InlineNode, marks: MarkType[]): InlineNode {
  if (node.type !== "text" || marks.length === 0) return node;
  const have = new Set((node.marks ?? []).map((m) => m.type));
  for (const m of marks) have.add(m);
  return { type: "text", text: node.text, marks: marksFromSet(have) };
}

function marksFromSet(set: Set<MarkType>): Mark[] {
  // Canonical order keeps mark arrays comparable across parse/serialize.
  const order: MarkType[] = ["strong", "em", "underline"];
  return order.filter((m) => set.has(m)).map((type) => ({ type }));
}

function closeFrame(frame: Frame, parent: Frame): void {
  for (const child of frame.children) {
    parent.children.push(addMarks(child, frame.marks));
  }
}

function mergeAdjacent(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const node of nodes) {
    if (node.type === "text" && node.text === "") continue;
    const prev = out[out.length - 1];
    if (
      node.type === "text" &&
      prev &&
      prev.type === "text" &&
      markKey(prev.marks) === markKey(node.marks)
    ) {
      out[out.length - 1] = {
        type: "text",
        text: prev.text + node.text,
        ...(prev.marks ? { marks: prev.marks } : {}),
      };
    } else {
      out.push(node);
    }
  }
  return out;
}

export function markKey(marks?: Mark[]): string {
  if (!marks || marks.length === 0) return "";
  return marks
    .map((m) => m.type)
    .sort()
    .join(",");
}

/** Parse a raw inline string into inline nodes with marks and notes. */
export function parseInline(raw: string): InlineNode[] {
  const atoms = tokenizeInline(raw);
  const root: Frame = { delim: "", marks: [], children: [] };
  const stack: Frame[] = [root];

  for (const atom of atoms) {
    const top = stack[stack.length - 1];
    if (atom.kind === "text") {
      top.children.push({ type: "text", text: atom.text });
    } else if (atom.kind === "note") {
      const note: NoteNode = { type: "note" };
      const inner = atom.inner;
      if (inner.length) note.content = [{ type: "text", text: inner }];
      top.children.push(note);
    } else {
      // Delimiter: close the top frame if it matches (LIFO nesting), else open.
      if (top.delim === atom.delim) {
        stack.pop();
        closeFrame(top, stack[stack.length - 1]);
      } else {
        stack.push({
          delim: atom.delim,
          marks: DELIM_MARKS[atom.delim],
          children: [],
        });
      }
    }
  }

  // Any unclosed frames fold back to literal delimiter text.
  while (stack.length > 1) {
    const frame = stack.pop()!;
    const parent = stack[stack.length - 1];
    parent.children.push({ type: "text", text: frame.delim });
    for (const child of frame.children) parent.children.push(child);
  }

  return mergeAdjacent(root.children);
}

const INLINE_ESCAPE = /[\\*_[\]]/g;

function escapeText(text: string): string {
  return text.replace(INLINE_ESCAPE, (m) => "\\" + m);
}

function emphasisDelim(set: Set<MarkType>): string {
  if (set.has("strong") && set.has("em")) return "***";
  if (set.has("strong")) return "**";
  if (set.has("em")) return "*";
  return "";
}

/** Serialize inline nodes back to canonical Fountain inline markup. */
export function serializeInline(nodes: InlineNode[]): string {
  const merged = mergeAdjacent(nodes);
  let out = "";
  for (const node of merged) {
    if (node.type === "note") {
      out += "[[" + noteInner(node) + "]]";
      continue;
    }
    const set = new Set((node.marks ?? []).map((m) => m.type));
    const emph = emphasisDelim(set);
    const under = set.has("underline") ? "_" : "";
    const open = under + emph;
    const close = emph + under;
    out += open + escapeText(node.text) + close;
  }
  return out;
}

function noteInner(note: NoteNode): string {
  if (!note.content) return "";
  return note.content.map((n) => (n.type === "text" ? n.text : "")).join("");
}

/** Plain text of an inline run, dropping notes and marks (for synopsis caches). */
export function textContent(nodes: InlineNode[] | undefined): string {
  if (!nodes) return "";
  return nodes.map((n) => (n.type === "text" ? n.text : "")).join("");
}

export function textNode(text: string, marks?: MarkType[]): TextNode {
  if (!marks || marks.length === 0) return { type: "text", text };
  return { type: "text", text, marks: marks.map((type) => ({ type })) };
}
