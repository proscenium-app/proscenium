// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structured script ({ frontMatter, doc }) → canonical Fountain text.
 *
 * Serialization is canonical and **defensive**: any node whose natural text
 * could re-parse as a different element is force-prefixed (`.`/`@`/`!`/`>`/`~`).
 * That forcing is the mechanism behind the round-trip guarantees
 * (docs/engineering/fountain-model.md#FOUN-D100 rules 1, 2, 4). So is the
 * script's first line, where a reader would take it for a title page
 * (docs/engineering/fountain-model.md#EDIT-184), and no line of white space
 * is written above it (docs/engineering/fountain-model.md#EDIT-189). No block
 * opens with Fountain's two-space line
 * (docs/engineering/fountain-model.md#EDIT-191).
 * Normalization: one blank line between
 * body elements, none between a cue and its dialogue; a cue never the last
 * line of its block; a speech one block as far as its last spoken or
 * bracketed line (docs/engineering/fountain-model.md#EDIT-183); LF; single
 * trailing NL.
 */
import { Lexer, rules } from "fountain-js";
import { blankOverBlocks } from "./empty-line";
import { serializeInline, textContent } from "./inline";
import type { BlockNode, BlockType, InlineNode, ParsedScript } from "./model";
import { holdNoteBreaks, isBlank } from "./note-breaks";
import { opensWithTitlePage, serializeTitlePage } from "./titlepage";

// Matches Fountain's scene-heading prefixes: INT/EXT/EST and the I/E slash
// forms — but NOT a bare leading "I" or "E" (so "I keep listening." is action).
const NATURAL_SLUG = /^(?:(?:int|i)\.?\/(?:ext|e)|int|ext|est)[. ]/i;
// What the tokenizer takes for a transition with no mark, in capitals: it
// wants words and a space before `TO:`, so `TO:` alone and `CUT-TO:` are none.
const NATURAL_TRANSITION = /^(?:[^a-z\n]+ TO:|FADE (?:TO BLACK|OUT)\.|CUT TO BLACK\.)$/;
const FORCE_CHARS = /^[ \t]*[.>@~=#!]/;
/** Fountain's line that is empty and still part of its block: two spaces. */
const EMPTY_LINE = "  ";
/** What parts two verses of one speech: that line, where a blank one would end the speech. */
const VERSE_BREAK = `\n${EMPTY_LINE}\n`;

function isAllCaps(line: string): boolean {
  return /[A-Z]/.test(line) && !/[a-z]/.test(line);
}

function attr<T>(block: BlockNode, key: string): T | undefined {
  return block.attrs?.[key] as T | undefined;
}

/**
 * The tokenizer's rule for a cue with no `@` (fountain-js, `rules.dialogue`),
 * cut down to the cue's own line: the line has another under it, which is how
 * every cue is written. It refuses a line that opens with `!`, `.`, `>`, `~`,
 * `=` or `#`; a line that is only digits, spaces, `*` and `_`; and a name that
 * ends as a transition does, in `TO:`, `BLACK.` or `OUT.`. A line that opens
 * with `@` it takes for a forced cue, and the `@` is gone from the name, so
 * that is no cue as it stands either. Anything else with no lower case is one,
 * `INT. HOUSE` included: its rules for a scene heading, a transition and a
 * centered line want the line alone in its block.
 */
const NATURAL_CUE =
  /^(?!\s*\\@|\s*[!.>~=#@])(?!\s*[0-9 _*]+(?:\(.*\))?[*_]*\^?\s*$)\s*[^^()\na-z]+(?<!(?:BLACK|OUT)\.|TO:\s*)(?:\(.*\))?[ *_]*\^?\s*$/;
/**
 * Its rule for a forced one: `@`, a name with no `^`, `(` or `)` in it, at
 * most one bracket, which runs to the end of the line, and the `^` of a dual
 * cue.
 */
const FORCED_CUE = /^@[^^()\n]+(?:\(.*\))?[ *_]*(\^?)\s*$/;

/**
 * Is this cue's line one the tokenizer refuses as it stands and takes behind
 * an `@` (docs/engineering/fountain-model.md#EDIT-179)? Only then: an `@` on a
 * line that needs none would rewrite every script on its next save, and one on
 * a line it refuses either way (a `^` or a bracket in the name) would come
 * back as a stage direction with the `@` in its text. A `^` it would read as
 * the dual mark has to be the dual mark.
 */
function cueNeedsForce(line: string, dual: boolean): boolean {
  if (line.includes("\n") || NATURAL_CUE.test(line)) return false;
  const forced = FORCED_CUE.exec(`@${line}`);
  return !!forced && !!forced[1] === dual;
}

/**
 * The tokenizer's rules for every element it looks for before it settles on a
 * stage direction (fountain-js, lexer.js). A line of notes is left out: the
 * parser reads that as inline text whatever it was taken for (parse.ts).
 */
const NOT_ACTION = [
  rules.scene_heading,
  rules.centered,
  rules.transition,
  rules.dialogue,
  rules.section,
  rules.synopsis,
  rules.lyrics,
  rules.page_break,
];

/**
 * Would this action re-parse as a non-action element? `lines` are the ones the
 * next reader is shown: a note's line breaks are not the block's
 * (note-breaks.ts), so a line may end in `TO:` past a note that holds one, and
 * a note's first line in capitals is not the whole of it.
 *
 * The first four tests are older than the last and wider than the tokenizer:
 * a line in capitals is forced with nothing under it, and a slug with a line
 * under it. They stay as they are, because a script is written the same on
 * its next save. The last asks the tokenizer's own rules, for what the four
 * miss (docs/engineering/fountain-model.md#EDIT-186): a first line with a
 * line under it that it takes for a cue, which is any with no lower case, a
 * letter in it or not; a line alone that it takes for a scene heading behind
 * an indent or an emphasis mark; a mark behind a no-break space.
 */
function actionNeedsForce(text: string, lines: string[]): boolean {
  const first = lines[0];
  if (
    FORCE_CHARS.test(text) ||
    isAllCaps(first) ||
    NATURAL_SLUG.test(first) ||
    /\bTO:\s*$/.test(first)
  ) {
    return true;
  }
  // The block as the next reader has it: an empty line ends it.
  const end = lines.findIndex(isBlank);
  const block = (end === -1 ? lines : lines.slice(0, end)).join("\n");
  return NOT_ACTION.some((rule) => rule.test(block));
}

/**
 * A `!` the tokenizer takes off the front of a line of a stage direction: any
 * but one with a space after it, on every line of the block and not the first
 * alone.
 */
const TAKEN_MARK = /^([^\S\n]*)!(?! )/;

/**
 * A stage direction as it is written (docs/engineering/fountain-model.md#EDIT-185).
 * Forced, it is `!` and then the text as it stands, an indent included: the
 * reader takes that `!` for the mark whatever follows it (own-marks.ts). A
 * line that opens with a `!` of its own is written with a second, which is
 * the one the tokenizer takes.
 */
function stageDirection(text: string): string {
  const shown = holdNoteBreaks(text);
  const lines = shown.body.split("\n");
  const forced = actionNeedsForce(text, lines);
  const written = lines.map((line, i) =>
    i === 0 && forced ? `!${line}` : line.replace(TAKEN_MARK, "$1!!"),
  );
  return shown.restore(written.join("\n"));
}

function hasNote(block: BlockNode): boolean {
  return !!block.content?.some((node) => node.type === "note");
}

/**
 * A sung line as it can be written: `~ Row` is no lyric to any Fountain
 * reader, so the space in front of the line goes. Emphasis that opens with a
 * space is written behind its own mark, and stays as it is.
 */
function sungLine(line: InlineNode[]): InlineNode[] {
  const sung = [...line];
  while (sung[0]?.type === "text" && !sung[0].marks?.length) {
    const text = sung[0].text.replace(/^ +/, "");
    if (text) {
      sung[0] = { ...sung[0], text };
      break;
    }
    sung.shift();
  }
  return sung;
}

/**
 * A lyric as the verses it is written as, each line behind its `~`
 * (docs/engineering/fountain-model.md#EDIT-183). A line with nothing on it
 * ends a verse and is not written: `~` alone is no lyric to any Fountain
 * reader, and came back as a line reading `~`. A lyric with no words has no
 * verse.
 *
 * The lines are the block's own, cut where its text breaks and never inside a
 * note. Each verse is written from its own nodes, so emphasis that ran over
 * the line between two verses closes in the first and opens again in the
 * second; inside a verse a break keeps the emphasis it had, and a verse with
 * no empty line in it is written exactly as the whole lyric always was.
 */
function verses(block: BlockNode): string[] {
  const out: string[] = [];
  let verse: InlineNode[] = [];
  let line: InlineNode[] = [];
  /** The break that ended the line before this one, with its emphasis. */
  let broke: InlineNode | null = null;
  const endVerse = () => {
    // A note's own later lines get the `~` every line of a lyric is given.
    if (verse.length) out.push(serializeInline(verse).replace(/^/gm, "~"));
    verse = [];
  };
  const endLine = () => {
    if (line.every((node) => node.type === "text" && !node.text.trim())) endVerse();
    else verse.push(...(verse.length && broke ? [broke] : []), ...sungLine(line));
    line = [];
  };
  for (const node of block.content ?? []) {
    if (node.type !== "text") {
      line.push(node);
      continue;
    }
    node.text.split("\n").forEach((part, i) => {
      if (i > 0) {
        endLine();
        broke = { ...node, text: "\n" };
      }
      if (part) line.push({ ...node, text: part });
    });
  }
  endLine();
  endVerse();
  return out;
}

/**
 * A block the script has no line for: a lyric with no words, and a
 * parenthetical with none, which was written `()` and came back as a speech
 * reading `()`. Fountain has neither, so neither is written
 * (docs/engineering/fountain-model.md#EDIT-183).
 */
function hasNoLine(block: BlockNode): boolean {
  if (block.type === "lyric") return verses(block).length === 0;
  return block.type === "parenthetical" && !serializeInline(block.content ?? []);
}

/**
 * The blocks that are written. Besides the ones with no line, a speech with no
 * words that stands between two sung lines is not: the empty line between two
 * verses is the break between them, in the script and when it is read
 * (parse.ts, `isVerseBreak`), so one written there would be read as the break
 * and nothing more.
 */
function writtenBlocks(blocks: BlockNode[]): BlockNode[] {
  const lined = blocks.filter((block) => !hasNoLine(block));
  const wordless = (block?: BlockNode) =>
    block?.type === "dialogue" && !textContent(block.content).trim() && !hasNote(block);
  return lined.filter((block, i) => {
    if (!wordless(block)) return true;
    let before = i - 1;
    while (wordless(lined[before])) before--;
    let after = i + 1;
    while (wordless(lined[after])) after++;
    return lined[before]?.type !== "lyric" || lined[after]?.type !== "lyric";
  });
}

/**
 * One block as its lines. `inSpeech`: it stands in its cue's own block of
 * lines, where a blank line would end the speech, so a lyric's verses are
 * parted there by the empty line that does not.
 */
function serializeBlock(block: BlockNode, inSpeech = false): string {
  const text = serializeInline(block.content ?? []);

  switch (block.type) {
    case "act":
      return `# ${text}`;
    case "scene": {
      const level = attr<number>(block, "level") ?? 2;
      return `${"#".repeat(level)} ${text}`;
    }
    case "sceneHeading": {
      const sceneNumber = attr<string>(block, "sceneNumber");
      const head = NATURAL_SLUG.test(text) ? text : `.${text}`;
      return sceneNumber ? `${head} #${sceneNumber}#` : head;
    }
    case "action": {
      // A line of notes and nothing else (one, or a comment and its replies)
      // serializes as `[[ … ]]`, never force-prefixed: a reply in capitals
      // must not put a `!` into the file.
      const onlyNotes =
        !!block.content?.length && block.content.every((node) => node.type === "note");
      return onlyNotes ? text : stageDirection(text);
    }
    case "character": {
      const extension = attr<string>(block, "extension");
      const dual = attr<boolean>(block, "dual");
      // A note is part of the line the next reader sees. One in lower case
      // makes a cue in capitals a stage direction to any Fountain reader, and
      // one with a bracket or a line break in it does the same to ours, so a
      // cue that holds a note is always forced: it is the `@` that lets the
      // parser keep the note out of the tokenizer's way (name-notes.ts).
      const noted = !!block.content?.some((node) => node.type === "note");
      const name = textContent(block.content);
      let line = text;
      if (extension) line += ` ${extension}`;
      if (dual) line += " ^";
      // So is a cue whose name alone would make the line something else: a
      // number, a name that opens with another element's mark, one that ends
      // as a transition does. A cue with no name is left the line it was.
      const forced = noted || /[a-z]/.test(name) || (!!name.trim() && cueNeedsForce(line, !!dual));
      return forced ? `@${line}` : line;
    }
    case "parenthetical":
      return `(${text})`;
    case "dialogue":
      // A blank line inside a speech is written as Fountain's two-space line:
      // a bare empty line would END the dialogue block on the next parse and
      // demote the rest of the speech to action (rule 1, round-trip fidelity).
      return text.replace(/^[ \t]*$/gm, EMPTY_LINE);
    case "transition": {
      // As for a cue: a note is part of the line the next reader sees, and
      // `CUT [[x]]TO:` is no transition to it. One that holds a note is
      // forced, and so is one whose own text opens with a mark: `#1 TO:` with
      // no `>` in front is a section (parse.ts byItsMark). And one that opens
      // as a scene heading does, which is the first thing the next reader
      // looks for: `INT. HOUSE - CUT TO:`
      // (docs/engineering/fountain-model.md#EDIT-187).
      const noted = !!block.content?.some((node) => node.type === "note");
      const natural =
        !noted &&
        !FORCE_CHARS.test(text) &&
        !rules.scene_heading.test(text) &&
        NATURAL_TRANSITION.test(text);
      // A `<` that ends the line would close a centered one, `> FADE <`. Behind
      // a backslash it is the transition's own, and the reader keeps it from
      // the tokenizer (own-marks.ts).
      return natural ? text : `> ${text.replace(/<(?=[^\S\n]*$)/, "\\<")}`;
    }
    case "lyric":
      return verses(block).join(inSpeech ? VERSE_BREAK : "\n\n");
    case "centered": {
      // Each line stands between the marks, which is how two centered lines
      // in one block are read. With the marks around the block the second
      // line had none, and the block came back a stage direction
      // (docs/engineering/fountain-model.md#EDIT-187). A note's line breaks
      // are the note's (note-breaks.ts).
      const shown = holdNoteBreaks(text);
      const lines = shown.body.split("\n").map((line) => `> ${line} <`);
      return shown.restore(lines.join("\n"));
    }
    case "synopsis":
      return `= ${text}`;
    case "pageBreak":
      return "===";
    case "boneyard":
      return `/*${textContent(block.content)}*/`;
    default:
      return text;
  }
}

const SPEECH_HEAD = new Set<BlockType>(["character", "parenthetical", "dialogue"]);
const SPEECH_CONT = new Set<BlockType>(["parenthetical", "dialogue"]);
/** What can stand directly under a cue: spoken, bracketed or sung. */
const UNDER_A_CUE = new Set<BlockType>(["parenthetical", "dialogue", "lyric"]);

/** Does this cue put anything on its line? A name, or a note: an empty cue is an empty line. */
function hasCueLine(block: BlockNode): boolean {
  return hasNote(block) || !!textContent(block.content).trim();
}

/**
 * The blocks that have to stand in their cue's own block of lines
 * (docs/engineering/fountain-model.md#EDIT-183): every line of a speech down
 * to its last parenthetical or dialogue. Either is what it is only inside a
 * cue's block, so one written after a blank line came back as a stage
 * direction, which is what happened to each that followed a lyric.
 *
 * A lyric after that line needs no cue, and is written as it always was: after
 * a blank line, so a script that ends its speeches on a song is the same
 * bytes on its next save. No cue's line, no block to stand in.
 */
function heldInSpeech(blocks: BlockNode[]): Set<number> {
  const held = new Set<number>();
  blocks.forEach((cue, at) => {
    if (cue.type !== "character" || !hasCueLine(cue)) return;
    let last = at;
    for (let i = at + 1; i < blocks.length && UNDER_A_CUE.has(blocks[i].type); i++) {
      if (blocks[i].type !== "lyric") last = i;
    }
    for (let i = at + 1; i <= last; i++) held.add(i);
  });
  return held;
}

/**
 * What stands between two blocks. No blank line between a cue and the
 * dialogue/parenthetical lines it leads, nor between a cue and a song: a line
 * alone is no cue to any Fountain reader, so a sung speech written with a
 * blank line under its cue lost the cue. None before any line held in the
 * speech either, and between two verses there the empty line: with nothing
 * between them the two would be read back as one, which four of the seven
 * formats print a row shorter.
 */
function separator(prev: BlockType, cur: BlockType, held: boolean): string {
  if (cur === "lyric") {
    if (held) return prev === "lyric" ? VERSE_BREAK : "\n";
    return prev === "character" ? "\n" : "\n\n";
  }
  const joined = SPEECH_CONT.has(cur) && (SPEECH_HEAD.has(prev) || (prev === "lyric" && held));
  return joined ? "\n" : "\n\n";
}

/**
 * A cue with something on its line and nothing under it
 * (docs/engineering/fountain-model.md#EDIT-175). Something is a name, or a
 * note: a cue that holds one is forced, and a forced line alone came back as a
 * stage direction reading `@`. An empty cue is an empty line, and is left as
 * it was; so is a cue whose own text holds a line break, which already has a
 * line under it. A break inside a note is the note's, not the cue's.
 */
function isLoneCue(block: BlockNode, next: BlockNode | undefined): boolean {
  if (block.type !== "character" || (next && UNDER_A_CUE.has(next.type))) return false;
  return hasCueLine(block) && !textContent(block.content).includes("\n");
}

/**
 * Would a reader take the top of this script for a title page
 * (docs/engineering/fountain-model.md#EDIT-184)? Each reader is asked itself.
 * Ours looks only at the top of a file, so it is asked where no title page is
 * written above the script. The tokenizer is asked either way: a version of
 * this app from before the rule hands it the script with our title page off,
 * and it takes a standard key with a value there for a title page of its own,
 * after any white space. Its title-page half says what it takes, which is
 * less than its rule for looking matches: a value under the key that opens
 * as a key itself it leaves, and the block with it.
 */
function opensAsTitlePage(body: string, atTop: boolean): boolean {
  return Lexer.tokenizeTitlePage(body).length > 0 || (atTop && opensWithTitlePage(body));
}

/**
 * A block's lines behind the mark that says what they are, for the block a
 * reader would take for a title page as it stands. A transition gets its `>`,
 * and a cue its `@` where the tokenizer takes the line behind one. Any other
 * line is a stage direction to the next reader with a mark or without (a line
 * of speech with no cue over it, a cue no `@` can make one), and gets the `!`.
 * That goes directly in front of the first character: the tokenizer takes it
 * off behind white space, and leaves one that has a space after it in the
 * text.
 */
function behindItsMark(block: BlockNode, lines: string): string {
  if (block.type === "transition") return `> ${lines}`;
  if (block.type === "character" && FORCED_CUE.test(`@${lines.split("\n", 1)[0]}`)) {
    return `@${lines}`;
  }
  return lines.replace(/\S/, "!$&");
}

/**
 * The lines a script opens with that hold only white space. Fountain's empty
 * line is one of them: a line of two spaces at the top of a script opens the
 * first block, and is a blank line to the reader
 * (docs/engineering/fountain-model.md#EDIT-191).
 */
const WHITE_TOP = /^(?:[^\S\n]*(?:\n|$))+/;

/**
 * The script with each of those lines written empty
 * (docs/engineering/fountain-model.md#EDIT-189). The tokenizer's rule for
 * blank lines takes a first line of white space alone, and then reads the
 * block after the next blank line as blank lines: a first stage direction of
 * one space, or a cue with spaces for a name, cost the block after it. This
 * app reads the top of a script behind a line break now
 * (docs/engineering/fountain-model.md#EDIT-188). A version of it from before
 * that rule does not, nor does any other reader built on the tokenizer, and
 * to either an empty first line is the blank line it looks like. Every line
 * above the script's first words, and not the first alone: under a title
 * page the reader takes the empty lines off the top of the script, and a
 * line of white space behind them is the first.
 *
 * A line of white space is not read back as a block, here or lower in a
 * script, so the empty line holds all that was ever read back from it.
 */
function fromItsFirstWords(script: string): string {
  return script.replace(WHITE_TOP, (top) => top.replace(/[^\n]+/g, ""));
}

/** A boneyard, as the reader finds one before it reads a line (parse.ts). */
const BONEYARD = /\/\*[\s\S]*?\*\//g;
/** Private use, and no other sentinel's character; lengthened until the script holds none. */
const CUT = "";

/**
 * The script with no block opened by Fountain's two-space line: each such
 * line is written empty (docs/engineering/fountain-model.md#EDIT-191). The
 * line keeps a block going, and with no line of the block over it there is
 * none to keep. A speech with no words and no cue over it puts one there,
 * and so does a stage direction typed with two spaces on its first line; a
 * line of speech or of the direction under it made the pair a character with
 * no name and a speech, to this app before the rule. It is a blank line to
 * the reader now, and an empty line is one to every reader. A line of other
 * white space lower in a script is one already, and is written as typed.
 *
 * The lines are the ones the reader is shown (empty-line.ts): a boneyard is a
 * line of its own between blank ones by then, and a note's line breaks are
 * the note's. Neither's own two-space lines are lines of the script.
 */
function overNoBlock(script: string): string {
  if (!script.includes(EMPTY_LINE)) return script;
  let cut = CUT;
  while (script.includes(cut)) cut += CUT;
  const cuts: string[] = [];
  const shown = holdNoteBreaks(
    script.replace(BONEYARD, (text) => `\n\n${cut}${cuts.push(text) - 1}${cut}\n\n`),
  );
  const written = shown.restore(blankOverBlocks(shown.body));
  return cuts.reduce(
    (out, text, i) => out.replace(`\n\n${cut}${i}${cut}\n\n`, () => text),
    written,
  );
}

/** `atTop`: no title page is written above these blocks. */
function serializeBody(blocks: BlockNode[], atTop: boolean): string {
  // A block that is not written is not there: the lines around it meet, and
  // a cue over nothing else is a cue with no speech.
  const written = writtenBlocks(blocks);
  const held = heldInSpeech(written);
  const lines = written.map((block, i) => serializeBlock(block, held.has(i)));
  const joined = () => {
    let out = "";
    written.forEach((block, i) => {
      if (i > 0) out += separator(written[i - 1].type, block.type, held.has(i));
      out += lines[i];
      // A cue is a cue only with a line under it. Where the writer has put none
      // the line is Fountain's empty one, exactly as a speech with no words yet
      // is written: without it the cue came back as a stage direction, and a
      // forced one as a direction reading `@Ivo`.
      if (isLoneCue(block, written[i + 1])) out += `\n${EMPTY_LINE}`;
    });
    return overNoBlock(fromItsFirstWords(out));
  };
  const out = joined();
  if (!opensAsTitlePage(out, atTop)) return out;
  // The script's first line is the script's. The block that puts it there is
  // forced, and that is the whole of it: both readers look at the top only.
  const first = lines.findIndex((line) => line.trim());
  lines[first] = behindItsMark(written[first], lines[first]);
  return joined();
}

export function serialize(script: ParsedScript): string {
  const title = serializeTitlePage(script.frontMatter);
  const body = serializeBody(script.doc.content, !title);

  let out = "";
  if (title) out += title + (body ? "\n\n" : "\n");
  out += body;
  // LF, single trailing newline.
  out = out.replace(/\n*$/, "\n");
  return out;
}
