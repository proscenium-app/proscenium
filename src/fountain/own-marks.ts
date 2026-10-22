// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A line's own characters that the tokenizer would take for its marks, kept
 * out of the tokenizer's sight (docs/engineering/fountain-model.md#EDIT-185,
 * docs/engineering/fountain-model.md#EDIT-187).
 *
 * A mark says what a line is: `!` a stage direction, `>` to `<` a centered
 * line, `>` alone a transition. What stands behind the mark is the line's
 * text, and the tokenizer does not always leave it be:
 *
 *  - **The space after a `!`.** It takes a `!` off the front of a stage
 *    direction only when no space follows, so a forced direction that opens
 *    with one, `!    FADE`, came back reading `!    FADE` and was saved with a
 *    second `!` from then on. Here the `!` that opens a block is parted from
 *    the space after it, and the tokenizer takes it off as it does any other.
 *  - **`<` and `>` inside a centered line.** A centered line's text is read
 *    with every one of them stripped, and the white space around each, so
 *    `> a < b <` came back as `ab`. The line's marks are its first `>` and
 *    its last `<`; every one between them is held, a note's among them.
 *  - **A `<` behind a backslash at the end of a line that opens with `>`.**
 *    A transition whose text ends in `<` is `> FADE <` to the tokenizer, a
 *    centered line. It is written `> FADE \<` (serialize.ts), and that `<` is
 *    held so the line is the transition it says it is.
 *
 * Each is swapped for a tag before the body is tokenized, and each token's
 * text gets them back (`restore`). A line is read as inline.ts reads one: a
 * backslash makes the character after it a literal, and a note is `[[` to the
 * next `]]`. A note that runs over a line break is one line by the time it
 * gets here: note-breaks.ts runs first.
 *
 * Pure: text in, text out.
 */
import { isBlank } from "./note-breaks";

/** Private use, and no other sentinel's character; lengthened until the script holds none. */
const MARK = "";

/** What a tag stands for, by the digit in it. Nothing, for the tag that parts a `!` from its space. */
const HELD = ["", "<", ">"];

export interface HeldMarks {
  /** The body for the tokenizer. */
  body: string;
  /** A token's text as it was written. */
  restore(text: string): string;
}

/**
 * Does the line hold anything but white space, once it is read as inline
 * text? A backslash is nothing held: it makes a literal of what follows it, a
 * space or the line's end too. Nor is an emphasis mark, which may stand
 * around nothing.
 */
const hasWords = (line: string) =>
  /\S/.test(line.replace(/\\(.|$)|[*_]/g, (_, literal?: string) => literal ?? ""));

/**
 * A line that opens with `>`, its own `<` and `>` held. Its closing mark is a
 * `<` at its end with no backslash in front; that and the `>` it opens with
 * stay for the tokenizer to read.
 */
function holdAngles(line: string, tag: (held: string) => string): string {
  const open = /^[^\S\n]*>/.exec(line)?.[0].length;
  const end = line.trimEnd().length - 1;
  if (!open || end < open || line[end] !== "<") return line;
  let escaped = false;
  for (let i = open; i < end; ) {
    if (line[i] === "\\") {
      escaped = i + 1 === end;
      i += 2;
      continue;
    }
    const close = line.startsWith("[[", i) ? line.indexOf("]]", i + 2) : -1;
    i = close === -1 ? i + 1 : close + 2;
  }
  // The text's own `<`: with it held the line has no closing mark, and is no centered line.
  if (escaped) return line.slice(0, end) + tag("<") + line.slice(end + 1);
  return line.slice(0, open) + line.slice(open, end).replace(/[<>]/g, tag) + line.slice(end);
}

export function holdOwnMarks(body: string): HeldMarks {
  const same: HeldMarks = { body, restore: (text) => text };
  if (!body.includes("<") && !body.includes("! ")) return same;

  let mark = MARK;
  while (body.includes(mark)) mark += MARK;
  const tag = (held: string) => `${mark}${HELD.indexOf(held)}${mark}`;

  let opens = true;
  const lines = body.split("\n").map((line) => {
    const first = opens && !isBlank(line);
    opens = isBlank(line);
    // Only the `!` that opens a block is a mark the serializer wrote, and it
    // writes one in front of a line that holds something. On a later line of
    // a stage direction a `!` with a space after it is text, to the tokenizer
    // and to us, and so is one with nothing but white space after it.
    if (first && line.startsWith("! ") && hasWords(line.slice(1))) {
      return `!${tag("")}${line.slice(1)}`;
    }
    return holdAngles(line, tag);
  });
  const held = lines.join("\n");
  if (held === body) return same;

  const tags = new RegExp(`${mark}(\\d)${mark}`, "g");
  return {
    body: held,
    restore: (text) =>
      text.includes(mark)
        ? text.replace(tags, (whole, digit: string) => HELD[Number(digit)] ?? whole)
        : text,
  };
}
