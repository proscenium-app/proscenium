// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fountain's empty line, two spaces, where it opens a block
 * (docs/engineering/fountain-model.md#EDIT-191).
 *
 * Two spaces on a line of their own are an empty line that does not end its
 * block: the speech with no words yet under a cue, the line between two
 * verses, an empty line in the middle of a speech. Each has a line of its
 * block over it. With none over it the line holds no block together, and is
 * the blank line it looks like, as every other line of white space above a
 * block is.
 *
 * The tokenizer has no reading of its own there. Its rule for blank lines
 * leaves the line on the front of the block, and a block that opens with a
 * line of white space is blank lines to it, whatever else the block holds. So
 * the reader holds each two-space line as a word until the tokenizer is done
 * (parse.ts), and that word is in capitals: with a line under it, it was a
 * cue. The block came back as a character with no name and the rest of the
 * block as its speech. The next save wrote an empty line for the cue, and the
 * reading after that was the block as it reads with nothing over it.
 *
 * So the line is made empty before the tokenizer reads, and is written empty
 * (serialize.ts): the block reads as it does with nothing over it on the
 * first reading, on every one after, and in a reader that still has the
 * fault.
 *
 * The text is the one the tokenizer is shown: no note in it runs over a line
 * break (note-breaks.ts), and no boneyard is in it.
 *
 * Pure: text in, text out.
 */

/**
 * A line the reader holds as Fountain's empty one. It is found as the
 * reader's own hold finds it, by a regexp for which a line may also end at a
 * line or paragraph separator.
 */
const EMPTY_LINE = /^ {2}$/m;

/** `body` with every two-space line that opens a block made empty. */
export function blankOverBlocks(body: string): string {
  if (!body.includes("  ")) return body;
  /** No line of a block stands over this one. */
  let opens = true;
  const lines = body.split("\n").map((line) => {
    if (line.trim()) {
      opens = false;
      return line;
    }
    const empty = EMPTY_LINE.test(line);
    if (opens) return empty ? "" : line;
    // Under a line of its block the two spaces keep the block going, and any
    // other white space ends it.
    opens = !empty;
    return line;
  });
  return lines.join("\n");
}
