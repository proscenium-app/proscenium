// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A note's line breaks, kept out of the tokenizer's sight
 * (docs/engineering/fountain-model.md#EDIT-180).
 *
 * A note may run over line breaks, and the tokenizer does not know it. It
 * cuts a block into lines and reads each for what it is, so a break inside a
 * note ended the line the note stood on. A transition, a centered line or a
 * synopsis with such a note was two lines, and so a stage direction. A
 * parenthetical lost its closing bracket to the next line and became speech.
 * A note's own second line was read as script: one in brackets was a
 * parenthetical in the middle of the note. And the tokenizer did to a note's
 * lines what it does to a line of script: took a `!` off the front, turned
 * tabs into spaces, trimmed the ends, emptied a line of two spaces.
 *
 * So, before the body is tokenized, every line break inside a note is swapped
 * for a tag, and each token's text gets them back (`restore`). The tokenizer
 * then reads a note that holds a line break exactly as it reads the same note
 * written on one line. Nothing else about its reading changes: a line with no
 * forcing mark is still judged on every character, the note's among them.
 *
 * One more thing goes with the breaks, because the tokenizer takes it: **the
 * `~` in front of a note's later lines in a lyric.** Every line of a lyric is
 * written with one (serialize.ts), a note's own lines included, which keeps
 * the block a lyric to any reader. The tokenizer takes it off the lines it is
 * shown, and `restore` off the ones it was not.
 *
 * The `<` and `>` in a note on a centered line, which the tokenizer strips,
 * are held with the line's own (own-marks.ts).
 *
 * A note is read as inline.ts reads one: `[[` to the next `]]`, a backslash
 * making the character after it a literal. It does not run past the blank
 * line that ends its block; a `[[` with no `]]` before that is text.
 *
 * Pure: text in, text out.
 */

/** Private use, and no other sentinel's character; lengthened until the script holds none. */
const MARK = "";

/** Two spaces are a line of a speech, not the end of a block (Fountain's own rule). */
export const isBlank = (line: string) => line !== "  " && !line.trim();

export interface HeldBreaks {
  /** The body for the tokenizer: no note in it runs over a line break. */
  body: string;
  /**
   * A token's text as it was written. A lyric's lines each lose the `~` the
   * serializer put in front of them; the tokenizer has seen to the others.
   */
  restore(text: string, lyric?: boolean): string;
}

export function holdNoteBreaks(body: string): HeldBreaks {
  const same: HeldBreaks = { body, restore: (text) => text };
  if (!body.includes("[[")) return same;

  let mark = MARK;
  while (body.includes(mark)) mark += MARK;
  /** The tag a line break is swapped for. */
  const lineBreak = `${mark}0${mark}`;
  let held = false;

  /** One block, each note in it made one line. */
  const hold = (block: string): string => {
    let out = "";
    let i = 0;
    while (i < block.length) {
      if (block[i] === "\\" && i + 1 < block.length && block[i + 1] !== "\n") {
        out += block.slice(i, i + 2);
        i += 2;
        continue;
      }
      const close = block.startsWith("[[", i) ? block.indexOf("]]", i + 2) : -1;
      if (close === -1) {
        out += block[i];
        i += 1;
        continue;
      }
      const inner = block.slice(i + 2, close);
      if (inner.includes("\n")) held = true;
      out += `[[${inner.replaceAll("\n", lineBreak)}]]`;
      i = close + 2;
    }
    return out;
  };

  const lines = body.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    let end = i;
    while (end < lines.length && !isBlank(lines[end])) end += 1;
    if (end === i) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const block = lines.slice(i, end).join("\n");
    out.push(block.includes("[[") ? hold(block) : block);
    i = end;
  }
  if (!held) return same;

  return {
    body: out.join("\n"),
    restore(text, lyric = false) {
      if (!text.includes(mark)) return text;
      const own = lyric ? text.replaceAll(`${lineBreak}~`, lineBreak) : text;
      return own.replaceAll(lineBreak, "\n");
    },
  };
}
