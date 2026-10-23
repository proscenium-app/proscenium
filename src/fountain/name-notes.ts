// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The notes on a forced cue, kept out of the tokenizer's sight
 * (docs/engineering/fountain-model.md#EDIT-174).
 *
 * The tokenizer reads what a line is from every character on it, a note's
 * among them. To it a forced cue is `@`, a name with no `(`, `)` or `^` in it,
 * an optional `(extension)`, and then spaces and nothing more. So
 * `@MARA[[Robin: (too formal?)]]` is no cue, and neither is
 * `@MARA (V.O.)[[Robin: rename?]]`: each came back as a stage direction, with
 * the speech under it run into the same block.
 *
 * So, before the body is tokenized, a **forced cue** gives up its notes
 * whole. The tokenizer judges the line without them, tagged so it can be found
 * again. A line it takes for a cue is read from what was written (`cue`); one
 * it refuses is put back exactly as it stood (`restore`).
 *
 * Nothing else is touched. A cue with no `@` is left to the tokenizer: a line
 * in capitals with a note in lower case may as well be a stage direction, and
 * every script already on disk reads as it did. The serializer forces every
 * cue that holds a note (serialize.ts), so a cue the app wrote is a forced one.
 *
 * A note that holds a line break is one line by the time it gets here, on a
 * cue as on any line: note-breaks.ts runs first.
 *
 * Pure: text in, text out.
 */
import { trailingExtension } from "./cue";
import { isBlank } from "./note-breaks";

/** Private use, so it is in no script; lengthened until it is in none. */
const MARK = "";

/** A line that opens a block is a forced cue when `@` is the first thing on it. */
const CUE = /^[^\S\n]*@/;

/** A stretch of a line: its text, or one note as written, brackets and all. */
interface Piece {
  note: boolean;
  text: string;
}

const written = (pieces: readonly Piece[]) => pieces.map((p) => p.text).join("");

/**
 * A line as text and notes. A note is read as inline.ts reads one: `[[` to
 * the next `]]`, and a backslash makes the character after it a literal. Null
 * when the line holds no note.
 */
function readLine(text: string): Piece[] | null {
  const pieces: Piece[] = [];
  let buf = "";
  let found = false;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      buf += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    const close = text.startsWith("[[", i) ? text.indexOf("]]", i + 2) : -1;
    if (close === -1) {
      buf += text[i];
      i += 1;
      continue;
    }
    if (buf) pieces.push({ note: false, text: buf });
    buf = "";
    pieces.push({ note: true, text: text.slice(i, close + 2) });
    found = true;
    i = close + 2;
  }
  if (!found) return null;
  if (buf) pieces.push({ note: false, text: buf });
  return pieces;
}

/**
 * A cue as its name and its extension, read from what was written.
 *
 * The extension is the last bracket of the cue's own text, as it is for a cue
 * with no note (cue.ts). It is the block's attribute only while every note
 * stands before it: the attribute is a string and can hold none, so a cue
 * with a note inside or after its bracket keeps the bracket in its text,
 * which is how the editor hands such a cue over (editor/bridge.ts). White
 * space goes from the two ends of the line and from in front of the bracket,
 * as it does for a cue with no note.
 */
function readCue(line: readonly Piece[]): { name: string; extension: string | null } {
  const pieces = line.map((p) => ({ ...p }));
  // The `^` of a dual cue is the tokenizer's to read, and is not the name's.
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (pieces[i].note || !pieces[i].text.trim()) continue;
    const text = pieces[i].text.trimEnd();
    if (text.endsWith("^")) pieces[i].text = text.slice(0, -1);
    break;
  }
  const first = pieces[0];
  const last = pieces[pieces.length - 1];
  if (!first.note) first.text = first.text.trimStart();
  if (!last.note) last.text = last.text.trimEnd();

  let plain = "";
  const notes: number[] = [];
  for (const piece of pieces) {
    if (piece.note) notes.push(plain.length);
    else plain += piece.text;
  }
  const found = trailingExtension(plain);
  const bracket = found ? plain.indexOf("(", found.at) : -1;
  if (!found || !plain.slice(0, found.at).trim() || notes.some((at) => at > bracket)) {
    return { name: written(pieces), extension: null };
  }
  // The name ends where the space before the bracket begins. A note standing
  // in that space stays, at the name's end, and the space does not: the page
  // prints one space between a name and its extension, and a name that kept
  // its own would print two.
  let name = "";
  let seen = 0;
  for (const piece of pieces) {
    if (piece.note) name += piece.text;
    else {
      name += piece.text.slice(0, Math.max(0, found.at - seen));
      seen += piece.text.length;
    }
  }
  return { name, extension: found.extension };
}

export interface HeldNotes {
  /** The body for the tokenizer. */
  body: string;
  /** A token's text with the notes of its line back where they stood. */
  restore(text: string): string;
  /**
   * The cue a character token names, when its line's notes were held: the
   * name with its notes, as inline text, and the extension. Null for a cue
   * that had none held, which is read as it always was.
   */
  cue(text: string): { name: string; extension: string | null } | null;
}

export function holdNameNotes(body: string): HeldNotes {
  if (!body.includes("[[")) return { body, restore: (text) => text, cue: () => null };

  let mark = MARK;
  while (body.includes(mark)) mark += MARK;
  let count = 0;
  const tag = () => `${mark}${count++}${mark}`;
  /** A forced cue's line: what the tokenizer was shown after the tag, and what was written. */
  const cues = new Map<string, { plain: string; pieces: Piece[] }>();

  const lines = body.split("\n");
  const out: string[] = [];
  let opens = true;
  lines.forEach((line, i) => {
    const first = opens && !isBlank(line);
    opens = isBlank(line);
    const cue = first ? CUE.exec(line) : null;
    // A cue has a line under it. A line alone is none, with or without its
    // notes, and stays as it is.
    const under = i + 1 < lines.length && !isBlank(lines[i + 1]);
    const pieces = cue && under ? readLine(line.slice(cue[0].length)) : null;
    if (!cue || !pieces) {
      out.push(line);
      return;
    }
    const plain = pieces.map((p) => (p.note ? "" : p.text)).join("");
    const id = tag();
    cues.set(id, { plain, pieces });
    out.push(cue[0] + id + plain);
  });
  if (!count) return { body, restore: (text) => text, cue: () => null };

  return {
    body: out.join("\n"),
    restore(text) {
      if (!text.includes(mark)) return text;
      let back = text;
      for (const [id, held] of cues) {
        if (!back.includes(id)) continue;
        // A line the tokenizer did not take for a cue, as it was written. The
        // second replacement finds nothing; it is there so that no note is
        // ever dropped.
        const kept = held.pieces.filter((p) => p.note);
        back = back.split(id + held.plain).join(written(held.pieces));
        back = back.split(id).join(written(kept));
      }
      return back;
    },
    cue(text) {
      if (!text.startsWith(mark)) return null;
      const close = text.indexOf(mark, mark.length);
      const held = close === -1 ? undefined : cues.get(text.slice(0, close + mark.length));
      return held ? readCue(held.pieces) : null;
    },
  };
}
