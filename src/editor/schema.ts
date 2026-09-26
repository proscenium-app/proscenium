// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The TipTap/ProseMirror schema for the play document (docs/engineering/fountain-model.md#FOUN-D100
 * docs/engineering/fountain-model.md#FOUN-D102).
 *
 * Node and mark names + attrs match src/fountain/model.ts EXACTLY, so a parsed
 * script (which is already ProseMirror-shaped JSON) loads straight into the
 * editor, and `editor.getJSON()` feeds the serializer with no translation. The
 * document is flat — node order = line order — which is what keeps round-trip
 * trivial.
 */
import { Mark, Node, mergeAttributes } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { PlayHistory } from "./history";

/**
 * Elements where a spell check would only nag (docs/app/writing/editor-ux.md#EDIT-83): cue names,
 * headings, and transitions are names and ALL-CAPS conventions, not prose.
 *
 * The set is the contract for BOTH checkers. The app's own one skips these
 * blocks (spellcheck.ts), and the `spellcheck="false"` attribute keeps the OS
 * off them too — the root turns the native check off (PlayEditor), so the attr
 * is belt-and-braces for a webview that decides to check anyway.
 */
export const NO_SPELLCHECK: ReadonlySet<string> = new Set([
  "character",
  "sceneHeading",
  "transition",
  "act",
  "scene",
]);

/** A block element that holds inline content and renders as a classed div. */
function blockNode(name: string, opts: { attrs?: Record<string, unknown> } = {}) {
  return Node.create({
    name,
    group: "block",
    content: "inline*",
    addAttributes: opts.attrs ? () => opts.attrs! : undefined,
    parseHTML() {
      return [{ tag: `div[data-pl="${name}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, {
          "data-pl": name,
          class: `pl pl-${name}`,
          ...(NO_SPELLCHECK.has(name) ? { spellcheck: "false" } : {}),
        }),
        0,
      ];
    },
  });
}

/** A persisted attribute carried on the DOM as `data-*` (survives copy/paste). */
function dataAttr(dataName: string, def: unknown = null) {
  return {
    default: def,
    parseHTML: (el: HTMLElement) => el.getAttribute(dataName),
    renderHTML: (attrs: Record<string, unknown>) => {
      const key = dataName;
      const val = attrs[camel(dataName)];
      return val === null || val === undefined || val === false
        ? {}
        : { [key]: val === true ? "" : String(val) };
    },
  };
}

function camel(dataName: string): string {
  return dataName.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// --- structural ---
export const Act = blockNode("act");
export const Scene = blockNode("scene", {
  attrs: { level: { default: null } },
});
export const SceneHeading = blockNode("sceneHeading", {
  attrs: { sceneNumber: dataAttr("data-scene-number") },
});

// --- body ---
export const Action = blockNode("action");
export const Character = blockNode("character", {
  attrs: {
    extension: dataAttr("data-extension"),
    dual: dataAttr("data-dual", false),
    // `@`-forced (mixed-case) cue — auto-caps skips it. Cosmetic: serialize
    // re-derives forcing, so this never affects round-trip.
    forced: dataAttr("data-forced", false),
  },
});
export const Parenthetical = blockNode("parenthetical");
export const Dialogue = blockNode("dialogue");
export const Transition = blockNode("transition");
export const Lyric = blockNode("lyric");
export const Centered = blockNode("centered");
export const Synopsis = blockNode("synopsis");

export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-pl="pageBreak"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-pl": "pageBreak",
        class: "pl pl-pageBreak",
      }),
    ];
  },
});

/** Omitted content (Fountain `/* … *\/`) — rendered collapsed, never discarded. */
export const Boneyard = Node.create({
  name: "boneyard",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  parseHTML() {
    return [{ tag: 'div[data-pl="boneyard"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-pl": "boneyard", class: "pl pl-boneyard" }),
      0,
    ];
  },
});

/** Inline annotation chip — invisible in print output. */
export const Note = Node.create({
  name: "note",
  group: "inline",
  inline: true,
  content: "inline*",
  parseHTML() {
    return [{ tag: "span.pl-note" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "pl-note" }), 0];
  },
});

/**
 * A line break INSIDE a block — Shift+Enter, and Enter inside a speech. It is
 * a node rather than a "\n" in the text because contenteditable normalizes a
 * trailing newline back into whitespace: a break typed at the end of a block
 * would silently vanish. The model never sees this node; bridge.ts converts it
 * to and from "\n" at the editor boundary (fountain, engine and PDF are
 * unchanged).
 */
export const LineBreak = Node.create({
  name: "lineBreak",
  group: "inline",
  inline: true,
  selectable: false,
  parseHTML() {
    return [{ tag: "br" }];
  },
  renderHTML() {
    return ["br"];
  },
});

// --- marks ---
export const Strong = Mark.create({
  name: "strong",
  parseHTML() {
    return [{ tag: "strong" }, { tag: "b" }];
  },
  renderHTML() {
    return ["strong", 0];
  },
});
export const Em = Mark.create({
  name: "em",
  parseHTML() {
    return [{ tag: "em" }, { tag: "i" }];
  },
  renderHTML() {
    return ["em", 0];
  },
});
export const Underline = Mark.create({
  name: "underline",
  parseHTML() {
    return [{ tag: "u" }];
  },
  renderHTML() {
    return ["u", 0];
  },
});

/** The element type names that carry inline content, in keymap-ring order. */
export const BODY_ELEMENTS = [
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "sceneHeading",
  "transition",
] as const;

/**
 * Every extension that defines the play schema, in dependency order.
 *
 * **Action comes first among the blocks, and that ordering is load-bearing.**
 * ProseMirror's `defaultBlockAt` picks the FIRST block type the content
 * expression allows, and it reaches for that type every time it needs a block
 * nobody named: each paragraph after the first in a plain-text paste, a
 * `clearNodes`, an empty-block lift. With `Act` first, pasting three paragraphs
 * of stage directions turned two of them into ACT headings — and auto-caps then
 * uppercased them, so the writer's own casing was gone for good. A stage
 * direction is the neutral thing an unlabelled block should be (it is what
 * `emptyEditorDoc()` already uses), so Action leads.
 */
export const playExtensions = [
  Document,
  Text,
  Action,
  Act,
  Scene,
  SceneHeading,
  Character,
  Parenthetical,
  Dialogue,
  Transition,
  Lyric,
  Centered,
  Synopsis,
  PageBreak,
  Boneyard,
  Note,
  LineBreak,
  Strong,
  Em,
  Underline,
];

/** The same set plus editor behavior (undo/redo). Used by the live editor. */
export function editorExtensions() {
  return [...playExtensions, PlayHistory];
}
