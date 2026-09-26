// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Comments extension (docs/app/writing/comments.md#COMM-D4, docs/app/writing/comments.md#COMM-D5) — presentation over Fountain
 * notes, never a second store. Four jobs:
 *
 *  1. **Anchor highlights.** An inline decoration over the phrase each comment
 *     follows (model.ts `anchorSpan`), so a comment is visible IN the text —
 *     not a dot you have to find. A decoration that
 *     only paints a background can't change wrapping, which is the invariant
 *     the engine's note handling rests on.
 *  2. **Markers.** A widget at every comment's anchor: chrome at the anchor
 *     point, absolutely positioned, so it occupies zero width and zero height
 *     and can never move a wrap or a page break. It carries the comments a
 *     highlight can't (one opening a block, or standing alone).
 *  3. **The comment-only class.** A block whose only content is comments gets
 *     `pl-commentonly`, which page view hides WHOLE — the DOM twin of the
 *     engine skipping the block (engine.ts / pagination.ts).
 *  4. **Surface state.** `focusPos` (the comment being read) / `hoverPos` /
 *     `doomedPos` / `composing` / `count` live in extension storage,
 *     Find-style; commands dispatch a meta-only transaction so React chrome
 *     re-renders without a document change. Which SURFACES are open is App's
 *     business, not the document's — the feed is a pane.
 */
import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { anchorSpan, isAnchorNoteText, parseCommentText, type ParsedComment } from "./model";

let nextCommentId = 0;

export interface PmCommentEntry {
  /** Runtime identity, mapped through edits; never serialized into Fountain. */
  id: string;
  /** Position of the note node in the editor document. */
  pos: number;
  /** The derived highlight's span, or null when there's nothing to paint. */
  anchorFrom: number | null;
  anchorTo: number | null;
  /** Start position of the block holding it. */
  blockPos: number;
  /** The note's raw text, verbatim. */
  text: string;
  parsed: ParsedComment;
  /** The block's only content is comments (a standalone `[[ ]]` line). */
  standalone: boolean;
  /** Nearest act / scene labels above the anchor, for grouping. */
  act: string | null;
  scene: string | null;
}

/** Every comment in the live editor doc, in document order, with anchors. */
export function collectPmComments(doc: PMNode): PmCommentEntry[] {
  const out: PmCommentEntry[] = [];
  let act: string | null = null;
  let scene: string | null = null;
  doc.forEach((node, offset) => {
    const name = node.type.name;
    if (name === "act") {
      act = node.textContent || null;
      scene = null;
      return;
    }
    if (name === "scene" || name === "sceneHeading") {
      scene = node.textContent || null;
      return;
    }
    let hasNote = false;
    let hasText = false;
    node.forEach((child) => {
      if (child.type.name === "note") hasNote = true;
      else if (child.isText && child.text) hasText = true;
    });
    if (!hasNote) return;
    const standalone = !hasText;
    // The run immediately before a note is what its highlight paints; anything
    // else in between (a line break, another comment) ends the phrase.
    let run: { text: string; offset: number } | null = null;
    node.forEach((child, childOffset) => {
      if (child.type.name !== "note") {
        run = child.isText && child.text ? { text: child.text, offset: childOffset } : null;
        return;
      }
      const before: { text: string; offset: number } | null = run;
      run = null;
      const text = child.textContent;
      if (isAnchorNoteText(text)) return; // scene anchors are machinery
      const span = before ? anchorSpan(before.text) : null;
      const runStart = before ? offset + 1 + before.offset : 0;
      out.push({
        id: `comment-${++nextCommentId}`,
        pos: offset + 1 + childOffset,
        anchorFrom: span ? runStart + span.start : null,
        anchorTo: span ? runStart + span.end : null,
        blockPos: offset,
        text,
        parsed: parseCommentText(text),
        standalone,
        act,
        scene,
      });
    });
  });
  return out;
}

/** Existing notes keep identity when text before or inside them changes. */
export function commentIdsAfter(tr: Transaction, entries: PmCommentEntry[]): Map<number, string> {
  const identities = new Map<number, string>();
  for (const entry of entries) {
    const mapped = tr.mapping.mapResult(entry.pos, 1);
    if (!mapped.deleted) identities.set(mapped.pos, entry.id);
  }
  return identities;
}

export interface CommentsStorage {
  /** The comment being read — highlighted in the text, raised in the margin. */
  focusPos: number | null;
  /** The focused comment is newly made and its card should open for typing. */
  composing: boolean;
  /** The comment the pointer is over — its text lights up, lightly. */
  hoverPos: number | null;
  /** The comment about to be resolved: the text says what is going away. */
  doomedPos: number | null;
  /** Comments in the current doc — the bar chip's badge. */
  count: number;
}

interface PluginState {
  entries: PmCommentEntry[];
  deco: DecorationSet;
  /** The three ways a comment can be emphasised, in rising order. */
  activePos: number | null;
  hoverPos: number | null;
  doomedPos: number | null;
}

/** Emphasis on a comment's text, strongest first — one class, never two. */
function emphasis(pos: number, state: Pick<PluginState, "activePos" | "hoverPos" | "doomedPos">) {
  if (pos === state.doomedPos) return " is-doomed";
  if (pos === state.activePos) return " is-active";
  if (pos === state.hoverPos) return " is-hover";
  return "";
}

const KEY = new PluginKey<PluginState>("comments");

/** What the margin and the panel read: the collected comments, once. */
export function commentsState(state: EditorState): PluginState | undefined {
  return KEY.getState(state);
}

/**
 * A position with real coordinates for the comment at `pos`.
 *
 * You cannot scroll to a comment by its own position: page view hides the note
 * (so the engine's wrapping is matched exactly), and a hidden node has no
 * coordinates at all — `coordsAtPos` answers 0, and a jump lands at the top of
 * the document. So the jump goes to the text the comment is ABOUT: the end of
 * its highlighted phrase, or the block it sits in, or — for a standalone
 * comment, whose whole block is hidden — the nearest block that isn't.
 */
export function commentJumpTarget(state: EditorState, pos: number): number | null {
  const plugin = KEY.getState(state);
  const entry = plugin?.entries.find((e) => e.pos === pos);
  if (!entry) return null;
  if (entry.anchorTo !== null) return entry.anchorTo;
  if (!entry.standalone) return entry.blockPos + 1;
  const hidden = new Set(plugin!.entries.filter((e) => e.standalone).map((e) => e.blockPos));
  const blocks: number[] = [];
  state.doc.forEach((_node, offset) => blocks.push(offset));
  const here = blocks.indexOf(entry.blockPos);
  if (here === -1) return null;
  for (let i = here - 1; i >= 0; i--) if (!hidden.has(blocks[i])) return blocks[i] + 1;
  for (let i = here + 1; i < blocks.length; i++) if (!hidden.has(blocks[i])) return blocks[i] + 1;
  return null;
}

/** Meta marking a UI-only transaction (focus/open/compose — no doc change). */
interface UiMeta {
  kind: "ui";
}

function truncate(text: string, max = 160): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

export const Comments = Extension.create<Record<string, never>, CommentsStorage>({
  name: "comments",

  addStorage() {
    return {
      focusPos: null,
      composing: false,
      hoverPos: null,
      doomedPos: null,
      count: 0,
    };
  },

  addCommands() {
    const storage = this.storage;
    const ui = (tr: Transaction) => tr.setMeta(KEY, { kind: "ui" } satisfies UiMeta);
    return {
      /** Read this comment: highlight its text, raise its card. */
      focusComment:
        (pos: number | null) =>
        ({ tr, dispatch }) => {
          if (storage.focusPos === pos && !storage.composing) return false;
          storage.focusPos = pos;
          storage.composing = false;
          dispatch?.(ui(tr));
          return true;
        },
      /** The pointer is over this comment's card or row (or nothing). */
      hoverComment:
        (pos: number | null) =>
        ({ tr, dispatch }) => {
          if (storage.hoverPos === pos) return false;
          storage.hoverPos = pos;
          dispatch?.(ui(tr));
          return true;
        },
      /**
       * The pointer is over this comment's Resolve button. Deleting a comment
       * deletes text, and in page view that text is hidden — so the script
       * says what is about to go before it goes.
       */
      doomComment:
        (pos: number | null) =>
        ({ tr, dispatch }) => {
          if (storage.doomedPos === pos) return false;
          storage.doomedPos = pos;
          dispatch?.(ui(tr));
          return true;
        },
      /**
       * Comment on the selection (docs/app/writing/comments.md#COMM-D6) — Docs' ⌘⌥M. A Fountain note anchors at
       * a point, so the comment lands immediately AFTER the selected phrase,
       * which is also what the highlight then paints. Born with placeholder
       * text because an empty inline node cannot hold the DOM caret
       * (breaks.ts); the card opens over it and the first save replaces it.
       */
      addComment:
        () =>
        ({ tr, state, dispatch }) => {
          const noteType = state.schema.nodes.note;
          if (!noteType) return false;
          const { $to, to } = state.selection;
          if (!$to.parent.isTextblock) return false;
          if ($to.parent.type.name === "note" || $to.parent.type.name === "boneyard") return false;
          if (!dispatch) return true;
          tr.insert(to, noteType.create(null, state.schema.text("comment")));
          storage.focusPos = to;
          storage.composing = true;
          dispatch(ui(tr));
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    // ⌘⇧C (the feed) is bound at the window, not here: it opens a PANE, which
    // is App's business, and it has to work while the caret is anywhere.
    return {
      "Mod-Alt-m": () => this.editor.commands.addComment(),
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const storage = this.storage;

    const marker = (pos: number, text: string, mark: string): HTMLElement => {
      const el = document.createElement("span");
      el.className = `pl-comment-marker${mark}`;
      el.title = truncate(text);
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", "Comment");
      el.addEventListener("mousedown", (e) => {
        // Keep the editor's selection; the marker only moves the reading focus.
        e.preventDefault();
        e.stopPropagation();
        editor.commands.focusComment(pos);
      });
      return el;
    };

    const build = (
      doc: PMNode,
      marks: Pick<PluginState, "activePos" | "hoverPos" | "doomedPos">,
      identities = new Map<number, string>(),
    ): PluginState => {
      const entries = collectPmComments(doc).map((entry) => ({
        ...entry,
        id: identities.get(entry.pos) ?? entry.id,
      }));
      storage.count = entries.length;
      const decos: Decoration[] = [];
      const commentOnlyBlocks = new Set<number>();
      for (const entry of entries) {
        const { pos, text, anchorFrom, anchorTo } = entry;
        const mark = emphasis(pos, marks);
        // A standalone comment's block is hidden whole in page view, and a
        // marker inside it would be hidden with it — so that one hangs off the
        // block's position instead, where it can be seen and hovered.
        const markerPos = entry.standalone ? entry.blockPos : pos;
        decos.push(
          Decoration.widget(markerPos, () => marker(pos, text, mark), {
            side: -1,
            key: `cm-${pos}-${mark}-${text.length}-${text.slice(0, 16)}`,
          }),
        );
        if (anchorFrom !== null && anchorTo !== null && anchorFrom < anchorTo) {
          decos.push(
            Decoration.inline(anchorFrom, anchorTo, { class: `pl-comment-anchor${mark}` }),
          );
        }
        if (entry.standalone) commentOnlyBlocks.add(entry.blockPos);
      }
      for (const blockPos of commentOnlyBlocks) {
        const node = doc.nodeAt(blockPos);
        if (node) {
          decos.push(
            Decoration.node(blockPos, blockPos + node.nodeSize, { class: "pl-commentonly" }),
          );
        }
      }
      return {
        entries,
        ...marks,
        deco: decos.length ? DecorationSet.create(doc, decos) : DecorationSet.empty,
      };
    };

    return [
      new Plugin<PluginState>({
        key: KEY,
        state: {
          init: (_config, state) =>
            build(state.doc, { activePos: null, hoverPos: null, doomedPos: null }),
          apply: (tr: Transaction, prev: PluginState): PluginState => {
            const ui = tr.getMeta(KEY) as UiMeta | undefined;
            const next = ui
              ? {
                  activePos: storage.focusPos,
                  hoverPos: storage.hoverPos,
                  doomedPos: storage.doomedPos,
                }
              : { activePos: prev.activePos, hoverPos: prev.hoverPos, doomedPos: prev.doomedPos };
            if (tr.docChanged) {
              // Every emphasis moves with the text it annotates.
              const move = (pos: number | null) => (pos === null ? null : tr.mapping.map(pos, -1));
              next.activePos = move(next.activePos);
              next.hoverPos = move(next.hoverPos);
              next.doomedPos = move(next.doomedPos);
              storage.focusPos = next.activePos;
              storage.hoverPos = next.hoverPos;
              storage.doomedPos = next.doomedPos;
              return build(tr.doc, next, commentIdsAfter(tr, prev.entries));
            }
            if (
              next.activePos !== prev.activePos ||
              next.hoverPos !== prev.hoverPos ||
              next.doomedPos !== prev.doomedPos
            ) {
              return build(
                tr.doc,
                next,
                new Map(prev.entries.map((entry) => [entry.pos, entry.id])),
              );
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return KEY.getState(state)?.deco ?? DecorationSet.empty;
          },
          /**
           * Clicking commented text reads that comment — Docs' gesture, and
           * the reason the highlight is worth painting. Returns false: the
           * caret still lands where the writer clicked.
           */
          handleClick(view, pos) {
            const state = KEY.getState(view.state);
            if (!state) return false;
            for (const entry of state.entries) {
              const from = entry.anchorFrom ?? entry.pos;
              const node = view.state.doc.nodeAt(entry.pos);
              const to = entry.pos + (node?.nodeSize ?? 1);
              if (pos >= from && pos <= to) {
                if (entry.pos !== state.activePos) editor.commands.focusComment(entry.pos);
                return false;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    comments: {
      /** Read the comment at `pos` — highlight its text, raise its card. */
      focusComment: (pos: number | null) => ReturnType;
      /** The pointer is over this comment: light its text up. */
      hoverComment: (pos: number | null) => ReturnType;
      /** This comment is about to be resolved: show the text it takes. */
      doomComment: (pos: number | null) => ReturnType;
      /** Comment on the selection (⌘⌥M): a note after it, card open. */
      addComment: () => ReturnType;
    };
  }
  interface Storage {
    comments: CommentsStorage;
  }
}
