// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bridge between the Fountain engine's document model and the editor.
 *
 * Because `src/fountain/model.ts` is already ProseMirror-shaped JSON, the
 * bridge is nearly identity. It does five things:
 *
 *  1. Guarantees the editor always has at least one block (the schema's `doc`
 *     requires `block+`, so an empty parse result becomes a single empty
 *     action to type into).
 *  2. Translates line breaks. The MODEL keeps a literal "\n" inside a block's
 *     text — that is what Fountain, the engine, and the PDF all read. The
 *     EDITOR can't: contenteditable normalizes a newline sitting at the END of
 *     a block back into whitespace, so a break typed at the end of a speech
 *     silently became a space. Inside the editor a break is therefore a
 *     `lineBreak` node, converted at these two boundaries and nowhere else.
 *  3. Moves a cue's extension. The MODEL keeps `(V.O.)` in the character
 *     block's `extension` attribute, where the parser puts it. The EDITOR keeps
 *     it as text: an attribute is not on the page, so a reopened script read
 *     "EDDA", retyping the missing "(V.O.)" wrote `EDDA (V.O.) (V.O.)`, and
 *     renaming the cue carried an extension nobody could see (docs/engineering/fountain-model.md#EDIT-124).
 *     Folded into the text on the way in, split back out on the way out with
 *     the parser's own reading (fountain/cue.ts), so a cue typed in the app and
 *     one read from disk are the same model.
 *  4. Holds the text a comment is about as a mark. The MODEL fences it with
 *     two marker notes, which is all Fountain can say; the EDITOR keeps no
 *     hidden note in the middle of a sentence (comments/ranges.ts).
 *  5. Says which cues keep their case. The MODEL says it with the cue's own
 *     letters, which is all the file can say: `serialize` writes the `@` from
 *     them. The EDITOR has to be told, because auto-caps upper-cases a cue as
 *     it is typed and cannot tell a name read from a file from one half typed:
 *     it reads the `character` block's `forced` attribute, which only typing
 *     `@` set. A script read from disk carried none, so the first keystroke
 *     anywhere in it made `McTeague` MCTEAGUE, and the next save wrote that
 *     (docs/app/writing/editor-ux.md#EDIT-176). Set on the way in for every
 *     cue auto-caps would change, and left as it is on the way out.
 */
import { rangesFromEditor, rangesToEditor } from "../comments/ranges";
import type { BlockNode, Doc, InlineNode, TextNode } from "../fountain";
import { trailingExtension } from "../fountain/cue";

export function emptyEditorDoc(): Doc {
  return { type: "doc", content: [{ type: "action" }] };
}

/** A parsed body doc made safe to load: never empty. */
export function ensureNonEmpty(doc?: Doc | null): Doc {
  if (!doc || doc.content.length === 0) return emptyEditorDoc();
  return doc;
}

/** The editor-only node standing in for a "\n" in the model's text. */
export const LINE_BREAK = "lineBreak";

interface BreakNode {
  type: typeof LINE_BREAK;
}

type EditorInline = InlineNode | BreakNode;

/** Split a text node's "\n"s into break nodes, keeping its marks on each part. */
function explodeText(node: TextNode): EditorInline[] {
  if (!node.text.includes("\n")) return [node];
  const out: EditorInline[] = [];
  node.text.split("\n").forEach((part, i) => {
    if (i > 0) out.push({ type: LINE_BREAK });
    if (part) out.push({ ...node, text: part });
  });
  return out;
}

function toEditorInline(content?: InlineNode[]): EditorInline[] | undefined {
  if (!content) return content;
  const out: EditorInline[] = [];
  for (const node of content) {
    if (node.type === "text") out.push(...explodeText(node));
    else if (node.type === "note") {
      out.push({ ...node, content: toEditorInline(node.content) as InlineNode[] });
    } else out.push(node);
  }
  return out;
}

/** Append text to the previous run when both are unmarked, else start a run. */
function pushText(out: InlineNode[], text: string, marks?: TextNode["marks"]) {
  const prev = out[out.length - 1];
  if (prev?.type === "text" && !prev.marks?.length && !marks?.length) {
    prev.text += text;
    return;
  }
  out.push(marks?.length ? { type: "text", text, marks } : { type: "text", text });
}

function fromEditorInline(content?: EditorInline[]): InlineNode[] | undefined {
  if (!content) return content as InlineNode[] | undefined;
  const out: InlineNode[] = [];
  for (const node of content) {
    if (node.type === LINE_BREAK) pushText(out, "\n");
    else if (node.type === "text") pushText(out, node.text, node.marks);
    else if (node.type === "note") {
      out.push({ ...node, content: fromEditorInline(node.content) });
    } else out.push(node as InlineNode);
  }
  return out;
}

function mapBlocks(doc: Doc, fn: (b: BlockNode) => BlockNode): Doc {
  return { type: "doc", content: doc.content.map(fn) };
}

/** Model → editor: a cue's `extension` attribute becomes the end of its text. */
function foldExtension(block: BlockNode): BlockNode {
  const extension = block.type === "character" ? block.attrs?.extension : null;
  if (typeof extension !== "string" || !extension) return block;
  const rest = { ...(block.attrs ?? {}) };
  delete rest.extension;
  const content = [...(block.content ?? [])];
  const last = content[content.length - 1];
  if (last?.type === "text" && !last.marks?.length) {
    content[content.length - 1] = { ...last, text: `${last.text} ${extension}` };
  } else {
    content.push({ type: "text", text: content.length ? ` ${extension}` : extension });
  }
  const folded: BlockNode = { ...block, content };
  if (Object.keys(rest).length) folded.attrs = rest;
  else delete folded.attrs;
  return folded;
}

/**
 * Editor → model: a cue's trailing parenthetical becomes its `extension`
 * attribute again. A cue that already carries the attribute came from
 * somewhere that sets it, and is left alone. So is a cue with no name in front
 * of the bracket: `(V.O.)` alone is half-typed, not an extension. And so is a
 * cue with a comment after or inside its bracket: the attribute is a string
 * and can hold no comment, so the bracket stays in the cue's text, where the
 * layout engine finds it and the parser reads it back
 * (docs/engineering/fountain-model.md#EDIT-174).
 */
function splitExtension(block: BlockNode): BlockNode {
  if (block.type !== "character") return block;
  const held = block.attrs?.extension;
  if (typeof held === "string" && held) return block;
  const content = block.content ?? [];
  const last = content[content.length - 1];
  if (last?.type !== "text") return block;
  const found = trailingExtension(last.text);
  if (!found) return block;
  const head = last.text.slice(0, found.at);
  const before = content.slice(0, -1);
  const name = before.map((n) => (n.type === "text" ? n.text : "")).join("") + head;
  if (!name.trim()) return block;
  const kept = head ? [...before, { ...last, text: head }] : before;
  return {
    ...block,
    attrs: { ...(block.attrs ?? {}), extension: found.extension },
    content: kept.some((n) => n.type === "note") ? nameWithoutEndSpace(kept) : kept,
  };
}

/**
 * A name that ends in comments, without the white space in front of them:
 * `MARA `, a comment, `(V.O.)`. The space was the one between the name and its
 * bracket, and the page prints one of its own there; kept in the name it
 * printed two, and came back from the script as a second space on the page.
 * The parser reads such a line the same way (fountain/name-notes.ts).
 */
function nameWithoutEndSpace(name: InlineNode[]): InlineNode[] {
  const out = [...name];
  for (let i = out.length - 1; i >= 0; i--) {
    const node = out[i];
    if (node.type !== "text") continue;
    const text = node.text.trimEnd();
    if (text) {
      out[i] = { ...node, text };
      break;
    }
    out.splice(i, 1);
  }
  return out;
}

/**
 * Model → editor: a cue that holds a letter auto-caps would change keeps its
 * case (`forced`). Asked of the cue as the page shows it, so after its
 * extension is text: `HANS (on the radio)` has no `@` in the file and keeps its
 * bracket the same way. A note's letters are not the cue's, as they are not to
 * auto-caps: a comment in lower case on MARA leaves her a cue that upper-cases
 * as it is typed. A cue already `forced` stays so, whatever its letters: the
 * writer typed `@` on it this session.
 */
function keepCase(block: BlockNode): BlockNode {
  if (block.type !== "character" || block.attrs?.forced === true) return block;
  const mixed = (block.content ?? []).some(
    (node) => node.type === "text" && node.text !== node.text.toUpperCase(),
  );
  return mixed ? { ...block, attrs: { ...(block.attrs ?? {}), forced: true } } : block;
}

/**
 * Model → editor: literal newlines become `lineBreak` nodes; extensions become
 * text; a cue in mixed case is `forced`; a comment's range markers become a
 * mark. `rangeIds` names the ranges as a document already on the page does
 * (comments/ranges.ts).
 */
export function toEditorDoc(doc: Doc, rangeIds?: readonly string[]): Doc {
  const mapped = mapBlocks(doc, (model) => {
    const block = keepCase(foldExtension(model));
    return block.content
      ? { ...block, content: toEditorInline(block.content) as InlineNode[] }
      : block;
  });
  return rangesToEditor(mapped, rangeIds);
}

/**
 * Editor → model: `lineBreak` nodes become literal newlines; extensions become
 * attributes; a comment's range becomes its two marker notes. `forced` goes
 * out as the page holds it: nothing reads it from the model but `toEditorDoc`,
 * which is how a cue the writer forced keeps its `@` when a change made off
 * the page (a scene moved on the board) brings the script back onto it.
 */
export function fromEditorDoc(doc: Doc): Doc {
  return mapBlocks(rangesFromEditor(doc), (block) =>
    splitExtension(block.content ? { ...block, content: fromEditorInline(block.content) } : block),
  );
}
