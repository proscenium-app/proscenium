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

/**
 * `castCaps` and `castKept` are the page's: whose case a character's name in
 * a direction is in (docs/app/writing/editor-ux.md#EDIT-205). The model carries
 * them out of the editor and back, so a scene moved on the board keeps them;
 * nothing parses them and `serializeInline` drops them.
 */
export type CaseMarkType = "castCaps" | "castKept";
export type MarkType = "strong" | "em" | "underline" | CaseMarkType;

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
  | "horizontalRule"
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
  /**
   * The editor's: this cue keeps its case as it is typed in. The parser does
   * not set it and the serializer does not read it, because the script says the
   * same with the cue's own letters; the editor bridge sets it from them
   * (docs/app/writing/editor-ux.md#EDIT-176).
   */
  forced?: boolean;
}

export interface BlockNode {
  type: BlockType;
  attrs?: Record<string, unknown>;
  /** Inline content. Absent for `pageBreak` and `horizontalRule` (atoms); text-only for `boneyard`. */
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
 * A page before the script as a file of the play's Front Matter folder holds
 * it (src/layout/page-files.ts reads its words, header and fields).
 */
export interface FrontPageSource {
  /** The file's binder id, which a rename or a move within the folder keeps. */
  id: string;
  /** What a writer calls the page: its file's name, "Title Page". */
  name: string;
  /** The file's text, header and all. */
  text: string;
}

/**
 * Front matter is NOT part of the ProseMirror doc; it is a structured object
 * serialized to/from the Fountain title page (docs/engineering/fountain-model.md#FOUN-D107). Standard keys map to named fields; the house keys
 * Setting/Time/Place/Characters are custom title-page keys; anything else is
 * preserved verbatim in `_extra` (storage "preserve-unknown-keys"). A list of
 * none (`authors: []`) is a key the title page names with nothing after it,
 * and is written back as the key alone; a list that is not there has no line
 * (docs/engineering/fountain-model.md#EDIT-192).
 */
export interface FrontMatter {
  title?: string;
  /** A line under the title ("A Play in Two Floods"), from the title page's `Subtitle:` key. */
  subtitle?: string;
  credit?: string;
  authors?: string[];
  source?: string;
  draftDate?: string;
  /**
   * The play's version ("Draft 3", "Rev. 11/26/2026"), from the title page's
   * `Version:` key (docs/app/formatting/formats-and-layout.md#FMT-185).
   */
  version?: string;
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
   * The production notes page, as Markdown: casting and doubling, staging, how
   * the text is marked. Prints on its own sheet just before the script, under
   * the heading PRODUCTION NOTES. Undefined or empty prints no page
   * (docs/app/formatting/formats-and-layout.md#FMT-160).
   */
  productionNotes?: string;
  /**
   * AT RISE mirror for the front-matter panel (unit J). In unit D the AT RISE
   * line lives canonically as the first `action` node of the first scene and is
   * serialized from there; this field is a read-only convenience and is never
   * separately emitted.
   */
  atRise?: string;
  /**
   * The pages before the script when the play keeps them as files, in the
   * folder's order. Read from the folder and never from or into the title
   * page: the serializer writes only the keys above. When present they are
   * the play's pages, and the fields above are only the details they show.
   */
  pages?: FrontPageSource[];
  /**
   * The pages after the script, kept as files in a folder of their own, in
   * that folder's order (docs/app/formatting/formats-and-layout.md#FMT-174).
   * Read from the folder as `pages` is, and never written to the title page.
   * Absent or empty, nothing follows the script's last page.
   */
  backPages?: FrontPageSource[];
  /**
   * The play's acts and scenes with the page each starts on, as the lines a
   * page's `{contents}` field prints (src/layout/contents.ts,
   * docs/app/formatting/formats-and-layout.md#FMT-179). Worked out from the
   * paginated script for whoever lays the pages out, and never written to the
   * title page.
   */
  contents?: string[];
  /**
   * The same, with no page beside an act: what a page's `{contents acts=plain}`
   * prints (docs/app/formatting/formats-and-layout.md#FMT-184). Worked out
   * only for a play with such a page.
   */
  contentsPlainActs?: string[];
  /**
   * Everyone who speaks, in the order they first speak, as the lines a page's
   * `{cast}` field prints (docs/app/formatting/formats-and-layout.md#FMT-183).
   * Worked out from the script for whoever lays the pages out, and never
   * written to the title page.
   */
  cast?: string[];
  /**
   * Unknown / unmodeled title-page keys, preserved verbatim for round-trip. A
   * key named twice holds the lines of each entry, and so does a house key's
   * entry its field did not take (docs/engineering/fountain-model.md#EDIT-190).
   */
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

/**
 * A line of three or more hyphens and nothing else, which is how a horizontal
 * line is written (docs/engineering/fountain-model.md#EDIT-214). Read as the
 * whole of a block it is the line; a stage direction that says only that is
 * written behind a `\`, which this does not match.
 */
export const HORIZONTAL_RULE = /^[^\S\n]*-{3,}[^\S\n]*$/;
