// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A script's redline as a document the editor can draw: both texts in one,
 * each element once, with what was cut and what was added marked
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-177).
 *
 * The page a writer reads a change on is the script's own: the cue centred,
 * the speech in its column, the direction in its parentheses. So the redline
 * is not drawn beside the script, it IS one, made for reading only: the
 * elements of the new text, the cut ones put back where they stood, and two
 * marks no play has (`redlineAdd`, `redlineDel`) on the words that changed.
 * It is loaded into a read-only editor (RedlineScript.tsx) and never
 * serialized: nothing here can reach a `.fountain`.
 *
 * Unchanged stretches are left out, with a few elements kept around each
 * change, and a cue is never shown without its speech.
 */
import type { JSONContent } from "@tiptap/core";
import { parse, type BlockNode, type Doc } from "../fountain";
import {
  compactRedline,
  redlineChanges,
  redlineRows,
  tokenize,
  type RedlinePart,
  type RedlineRow,
  type RedlineToken,
  type RedlineUnit,
} from "../review/redline";
import { dropRangeMarkers } from "../comments/ranges";
import { LINE_BREAK, toEditorDoc } from "./bridge";

export const REDLINE_ADD = "redlineAdd";
export const REDLINE_DEL = "redlineDel";

/** What happened to an element: the `redline` attribute its block carries. */
export type RedlineState = "add" | "del" | "mod";

/**
 * Unchanged elements left out, as the attribute of the block they stood
 * beside (`redlineSkipBefore`, and `redlineSkipAfter` on the last): in the
 * document itself, so the rule drawn for them can never be out of step with it.
 */
export interface RedlineSkip {
  count: number;
  /** The act and scene the next element is in, when their headings are not on show. */
  label: string | null;
}

export interface ScriptRedline {
  /** The document to load, or null when no element of the script changed. */
  doc: JSONContent | null;
  /** Elements cut, added or rewritten. */
  changes: number;
  /** The opening pages differ: they are not elements of the script. */
  openingPages: boolean;
}

/** Elements left on show around a change. */
const CONTEXT = 3;
/** What follows a cue, and belongs to it. */
const SPOKEN = new Set(["parenthetical", "dialogue", "lyric"]);
const SCENE = new Set(["scene", "sceneHeading"]);
/** Shown whole, as cut or as added: no words to mark inside. */
const WHOLE = new Set(["boneyard", "pageBreak"]);

/** A token, and the inline node that draws it. */
interface Piece extends RedlineToken {
  node: JSONContent;
}

interface Element extends RedlineUnit {
  block: BlockNode;
  tokens: Piece[];
}

function marksKey(marks: JSONContent["marks"]): string {
  return (marks ?? [])
    .map((m) => m.type)
    .sort()
    .join("+");
}

function pieces(content: JSONContent[] | undefined): Piece[] {
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
    } else if (node.type === LINE_BREAK) {
      out.push({ key: "\n", word: false, node });
    } else {
      // A comment: one thing, changed or not.
      out.push({ key: `\u0003${JSON.stringify(node)}`, word: true, node });
    }
  }
  return out;
}

function attrsKey(attrs: BlockNode["attrs"]): string {
  const kept = Object.entries(attrs ?? {}).filter(([, v]) => v !== null && v !== false && v !== "");
  return kept.length ? JSON.stringify(kept.sort(([a], [b]) => a.localeCompare(b))) : "";
}

function elements(doc: Doc): Element[] {
  // Read without the markers of what a comment is about: they are not words,
  // and a stretch marked or unmarked is no change to the script.
  return toEditorDoc(dropRangeMarkers(doc)).content.map((block) => {
    const whole = WHOLE.has(block.type);
    const content = block.content as JSONContent[] | undefined;
    return {
      kind: block.type,
      extra: attrsKey(block.attrs),
      whole,
      block,
      tokens: whole
        ? [{ key: JSON.stringify(content ?? []), word: true, node: { type: "text", text: "" } }]
        : pieces(content),
    };
  });
}

/** Inline nodes for these pieces, each carrying `mark` as well as its own. */
function marked(list: Piece[], mark: string | null): JSONContent[] {
  const out: JSONContent[] = [];
  for (const { node } of list) {
    const marks = mark ? [...(node.marks ?? []), { type: mark }] : node.marks;
    const next: JSONContent = marks?.length ? { ...node, marks } : { ...node };
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

function withState(el: Element, state: RedlineState, content?: JSONContent[]): JSONContent {
  const block: JSONContent = { type: el.block.type, attrs: { ...el.block.attrs, redline: state } };
  const inner = content ?? (el.block.content as JSONContent[] | undefined);
  if (inner?.length) block.content = inner;
  return block;
}

function partContent(a: Element, b: Element, parts: RedlinePart[]): JSONContent[] {
  const all: JSONContent[] = [];
  for (const part of parts) {
    const run =
      part.state === "del"
        ? marked(
            part.a.map((at) => a.tokens[at]),
            REDLINE_DEL,
          )
        : marked(
            part.b.map((at) => b.tokens[at]),
            part.state === "add" ? REDLINE_ADD : null,
          );
    all.push(...run);
  }
  // Runs meet where two parts carried the same marks.
  return marked(
    all.map((node) => ({ key: "", word: false, node })),
    null,
  );
}

function drawn(row: RedlineRow, a: Element[], b: Element[]): JSONContent {
  switch (row.state) {
    case "same":
      return b[row.b].block as JSONContent;
    case "add":
      return b[row.b].whole
        ? withState(b[row.b], "add")
        : withState(b[row.b], "add", marked(b[row.b].tokens, REDLINE_ADD));
    case "del":
      return a[row.a].whole
        ? withState(a[row.a], "del")
        : withState(a[row.a], "del", marked(a[row.a].tokens, REDLINE_DEL));
    case "mod":
      return withState(b[row.b], "mod", partContent(a[row.a], b[row.b], row.parts));
  }
}

function textOf(el: Element): string {
  return el.tokens
    .map((t) =>
      t.node.type === "text" ? (t.node.text ?? "") : t.node.type === LINE_BREAK ? " " : "",
    )
    .join("")
    .trim();
}

/** Both texts of a script as one read-only document, the unchanged stretches left out. */
export function scriptRedline(before: string, after: string): ScriptRedline {
  const was = parse(before);
  const is = parse(after);
  const a = elements(was.doc);
  const b = elements(is.doc);
  const rows = redlineRows(a, b);
  const changes = redlineChanges(rows);
  const openingPages = JSON.stringify(was.frontMatter) !== JSON.stringify(is.frontMatter);
  if (!changes) return { doc: null, changes, openingPages };

  const kindOf = (row: RedlineRow) => (row.state === "del" ? a[row.a].kind : b[row.b].kind);
  const items = compactRedline(rows, CONTEXT, (i) => {
    const next = kindOf(rows[i + 1]);
    const here = kindOf(rows[i]);
    return SPOKEN.has(next) && (here === "character" || SPOKEN.has(here));
  });

  // The act and the scene in force at each row of the new text, by the row of its heading.
  const actAt: (number | null)[] = [];
  const sceneAt: (number | null)[] = [];
  let act: number | null = null;
  let scene: number | null = null;
  rows.forEach((row, i) => {
    if (row.state !== "del") {
      const kind = b[row.b].kind;
      if (kind === "act") {
        act = i;
        scene = null;
      } else if (SCENE.has(kind)) scene = i;
    }
    actAt.push(act);
    sceneAt.push(scene);
  });
  const heading = (i: number) => {
    const row = rows[i];
    return row.state === "del" ? "" : textOf(b[row.b]);
  };

  const content: JSONContent[] = [];
  let pending: RedlineSkip | null = null;
  let saidAct: number | null = null;
  let saidScene: number | null = null;
  for (const item of items) {
    if (item.kind === "row") {
      if (actAt[item.index] === item.index) saidAct = item.index;
      if (sceneAt[item.index] === item.index) saidScene = item.index;
      const block = drawn(item.row, a, b);
      content.push(
        pending ? { ...block, attrs: { ...block.attrs, redlineSkipBefore: pending } } : block,
      );
      pending = null;
      continue;
    }
    const names: string[] = [];
    if (item.next < rows.length) {
      const inAct = actAt[item.next];
      const inScene = sceneAt[item.next];
      if (inAct !== null && inAct !== item.next && inAct !== saidAct) {
        names.push(heading(inAct));
        saidAct = inAct;
      }
      if (inScene !== null && inScene !== item.next && inScene !== saidScene) {
        names.push(heading(inScene));
        saidScene = inScene;
      }
    }
    pending = { count: item.count, label: names.filter(Boolean).join(" · ") || null };
  }
  const last = content[content.length - 1];
  if (pending && last) {
    content[content.length - 1] = { ...last, attrs: { ...last.attrs, redlineSkipAfter: pending } };
  }
  return { doc: { type: "doc", content }, changes, openingPages };
}
