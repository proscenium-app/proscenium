// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The structured play document model.
 *
 * This is deliberately shaped as **ProseMirror/TipTap document JSON** so the
 * editor (unit E) can load a parsed script directly with `setContent`, and the
 * Fountain module (unit D) can be tested with zero DOM dependency. The schema
 * mirrors docs/engineering/fountain-model.md#FOUN-D102.
 *
 * Ownership rule (docs/app/keeping-work/storage-and-file-format.md#STOR-D0): the `.fountain` file is canonical for anything
 * Fountain can express — which is everything in this model. Nothing here is a
 * play-file concern.
 */

export type MarkType = "strong" | "em" | "underline";

export interface Mark {
  type: MarkType;
}

export interface TextNode {
  type: "text";
  text: string;
  marks?: Mark[];
}

/** Inline annotation chip — Fountain `[[ note ]]`, invisible in print output. */
export interface NoteNode {
  type: "note";
  content?: InlineNode[];
}

export type InlineNode = TextNode | NoteNode;

export type BlockType =
  | "act"
  | "scene"
  | "sceneHeading"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition"
  | "lyric"
  | "centered"
  | "synopsis"
  | "pageBreak"
  | "boneyard";

export interface SceneHeadingAttrs {
  sceneNumber?: string | null;
  /** Did the heading need a leading `.` because it isn't an INT/EXT slug? */
  forced?: boolean;
}

export interface CharacterAttrs {
  /** A parenthetical extension carried on the cue, e.g. "(O.S.)". */
  extension?: string | null;
  /** Fountain `^` — second half of a dual-dialogue pair. */
  dual?: boolean;
  /** Did the cue need a leading `@` because it isn't all-caps? */
  forced?: boolean;
}

export interface BlockNode {
  type: BlockType;
  attrs?: Record<string, unknown>;
  /** Inline content. Absent for `pageBreak` (atom); text-only for `boneyard`. */
  content?: InlineNode[];
}

export interface Doc {
  type: "doc";
  content: BlockNode[];
}

/** A cast entry on the title page (`Characters:` house key). */
export interface CharacterEntry {
  name: string;
  description?: string;
}

/**
 * Front matter is NOT part of the ProseMirror doc; it is a structured object
 * serialized to/from the Fountain title page (docs/engineering/fountain-model.md#FOUN-D107). Standard keys map to named fields; the house keys
 * Setting/Time/Place/Characters are custom title-page keys; anything else is
 * preserved verbatim in `_extra` (storage "preserve-unknown-keys").
 */
export interface FrontMatter {
  title?: string;
  credit?: string;
  authors?: string[];
  source?: string;
  draftDate?: string;
  contact?: string[];
  setting?: string;
  time?: string;
  place?: string;
  characters?: CharacterEntry[];
  /** Writer-owned opening pages, as Markdown. Undefined uses the structured fields. */
  titlePage?: string;
  charactersPage?: string;
  openingNotes?: string;
  openingNotesBeforeCharacters?: boolean;
  /**
   * AT RISE mirror for the front-matter panel (unit J). In unit D the AT RISE
   * line lives canonically as the first `action` node of the first scene and is
   * serialized from there; this field is a read-only convenience and is never
   * separately emitted.
   */
  atRise?: string;
  /** Unknown / unmodeled title-page keys, preserved verbatim for round-trip. */
  _extra?: Record<string, string>;
}

export interface ParsedScript {
  frontMatter: FrontMatter;
  doc: Doc;
}

export function isText(node: InlineNode): node is TextNode {
  return node.type === "text";
}

export function emptyDoc(): Doc {
  return { type: "doc", content: [] };
}
