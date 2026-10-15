// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fountain text → structured script ({ frontMatter, doc }).
 *
 * Pipeline (see docs/engineering/fountain-model.md#FOUN-D109):
 *   1. normalize line endings
 *   2. split off the title page (we own it — titlepage.ts)
 *   3. pre-extract boneyard `/* *\/` (fountain-js *strips* it; we must keep it)
 *   4. hold back what the tokenizer would misread: every note's line breaks
 *      (note-breaks.ts), Fountain's two-space line where it opens a block
 *      (empty-line.ts), a line's own characters that it would take for marks
 *      (own-marks.ts), then the notes on a forced cue (name-notes.ts)
 *   5. tokenize the body with fountain-js: its script half only, which looks
 *      for no title page (docs/engineering/fountain-model.md#EDIT-184), and
 *      behind a line break, so that white space at the top of the script is
 *      blank lines and nothing more (docs/engineering/fountain-model.md#EDIT-188)
 *   6. map tokens → our ProseMirror-shaped doc, restoring boneyard and notes
 *
 * docs/app/keeping-work/storage-and-file-format.md#STOR-107 (docs/app/keeping-work/storage-and-file-format.md#STOR-D9): never throw on bad input. A tokenizer failure degrades to a
 * single raw `action` block so opening a malformed file can't break the app.
 */
import { Lexer, rules } from "fountain-js";
import type { Token } from "fountain-js";
import { splitCueExtension } from "./cue";
import { blankOverBlocks } from "./empty-line";
import { parseInline } from "./inline";
import type { BlockNode, Doc, InlineNode, ParsedScript } from "./model";
import { holdNameNotes } from "./name-notes";
import { holdNoteBreaks } from "./note-breaks";
import { holdOwnMarks } from "./own-marks";
import { splitTitlePage } from "./titlepage";

const BONEYARD_SENTINEL = /^BY(\d+)$/;

function extractBoneyard(body: string): { body: string; boneyards: string[] } {
  const boneyards: string[] = [];
  const replaced = body.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    const i = boneyards.length;
    boneyards.push(m.slice(2, -2)); // inner, without the /*  */ fences
    return `\n\nBY${i}\n\n`;
  });
  return { body: replaced, boneyards };
}

/** A line the tokenizer takes for sung when it stands in a speech: `~`, and no space after it. */
const SUNG_LINE = /^~(?! ).+$/;

/**
 * `body` with `standIn` on a line of its own wherever a block's first line is
 * not sung and its second is. Only there: a lyric lower in a speech has a line
 * before it, and the tokenizer reads it.
 */
function beforeSungLines(body: string, standIn: string): string {
  if (!body.includes("~")) return body;
  const lines = body.split("\n");
  const out: string[] = [];
  let opens = true;
  lines.forEach((line, i) => {
    const text = line.trim();
    out.push(line);
    if (opens && text && !SUNG_LINE.test(text) && SUNG_LINE.test((lines[i + 1] ?? "").trim())) {
      out.push(standIn);
    }
    opens = !text;
  });
  return out.join("\n");
}

/** A token, and for a cue whose notes were held back, the cue as it was written. */
type BodyToken = Token & { cue?: { name: string; extension: string | null } };

/**
 * A line of its own that ends in ` TO:` is a transition to the tokenizer
 * whatever it opens with: it tries that ending before it looks for a forcing
 * mark, and hands back the whole line, mark and all. So `> Smash cut TO:` kept
 * its `> ` and went out with a second one, `!He points TO:` was a transition
 * with a `!` in it, and `## Back TO:` was no scene. The mark says what a line
 * is (docs/engineering/fountain-model.md#EDIT-181): the token is made the one
 * the tokenizer's own rule for that mark would have made.
 */
function byItsMark(tok: Token): Token {
  const text = tok.type === "transition" ? (tok.text ?? "") : "";
  if (!text.endsWith(" TO:")) return tok;
  if (text.startsWith(">")) return { ...tok, text: text.replace(/^> */, "") };
  const section = /^(#+) *(.*)$/.exec(text);
  if (section) return { ...tok, type: "section", depth: section[1].length, text: section[2] };
  const synopsis = /^=(?!=) *(.*)$/.exec(text);
  if (synopsis) return { ...tok, type: "synopsis", text: synopsis[1] };
  if (/^~(?! )/.test(text)) return { ...tok, type: "lyrics", text: text.slice(1) };
  // As the tokenizer's action does: a `!` with a space after it stays. The
  // `!` that opens a block has none after it by now, whatever was written
  // (own-marks.ts), so this takes that one off as the action does.
  if (text.startsWith("!")) return { ...tok, type: "action", text: text.replace(/^!(?! )/, "") };
  return tok;
}

/**
 * Is this the empty line that parts two verses of one speech
 * (docs/engineering/fountain-model.md#EDIT-183)? The tokenizer runs sung lines
 * that touch into one lyric, so two verses in a cue's block are written with
 * Fountain's two-space line between them, which it reads as a line of speech
 * with no words. Between two sung lines that line is the break and no block:
 * kept, it would print as a row of its own between every two verses. Under a
 * cue, after a parenthetical or at the end of a speech it is the speech with
 * no words yet that it always was.
 */
function isVerseBreak(tok: Token, before?: Token, after?: Token): boolean {
  return (
    tok.type === "dialogue" &&
    !tok.text?.trim() &&
    before?.type === "lyrics" &&
    after?.type === "lyrics"
  );
}

function safeTokenize(source: string): BodyToken[] {
  try {
    // The tokenizer reads a block line by line, so a line break inside a note
    // ended the line the note stood on. Each is held back until it has read
    // the line (note-breaks.ts, docs/engineering/fountain-model.md#EDIT-180).
    const breaks = holdNoteBreaks(source);
    // Fountain's two-space line keeps a block going, and where it opens one
    // there is none to keep: it is the blank line every other line of white
    // space above a block is. Left in, it was a cue with no name to the
    // tokenizer, by the word that holds it below, and the rest of the block
    // its speech (empty-line.ts, docs/engineering/fountain-model.md#EDIT-191).
    const blocks = blankOverBlocks(breaks.body);
    // It takes some of a line's own text for the line's marks: the space
    // after a `!`, and every `<` and `>` inside a centered line
    // (own-marks.ts, docs/engineering/fountain-model.md#EDIT-185).
    const marks = holdOwnMarks(blocks);
    // A note on a forced cue can still make it read the line as something
    // else, so those notes are held back whole
    // (name-notes.ts, docs/engineering/fountain-model.md#EDIT-174).
    const held = holdNameNotes(marks.body);
    const body = held.body;
    // The tokenizer's shared blank-line regexp can classify an entire empty
    // speech as spaces (and alternate on repeated parses). Protect Fountain's
    // two-space lines until tokenization is over: a paused cue must survive
    // reopening, even before its dialogue has words (docs/app/writing/editor-ux.md#EDIT-43).
    let emptyLine = "EMPTY-SPEECH";
    while (body.includes(emptyLine)) emptyLine += "";
    // The tokenizer throws on a speech that opens with a sung line, a cue
    // directly over `~`: it asks what the line before the lyric was, and in
    // the speech there is none. One throw turned the whole script into a
    // single stage direction. A line of our own stands between the two until
    // tokenization is over (docs/engineering/fountain-model.md#EDIT-175).
    let standIn = "SUNG";
    while (body.includes(standIn)) standIn += "";
    const protectedBody = beforeSungLines(body.replace(/^ {2}$/gm, emptyLine), standIn);
    // The title page is off already, and is ours alone to find (titlepage.ts).
    // Asked for a whole script, the tokenizer looks for one of its own first:
    // a body that opened with a standard key and a value (`Notes: buy milk`,
    // or a cue `TITLE: X`) was a title page to it, and the line was dropped.
    // Its script half reads every line as script
    // (docs/engineering/fountain-model.md#EDIT-184).
    //
    // Its rule for blank lines has two halves: a line break and every line of
    // white space after it, or the first line of what it is handed, alone. So
    // at the top of a script a line of white space was taken by itself, the
    // empty line under it was left on the front of the next block, and a
    // block that opens with an empty line is blank lines to the tokenizer:
    // the script's first block was dropped. Behind a line break the top of a
    // script is read by the first half, as every other place in one is
    // (docs/engineering/fountain-model.md#EDIT-188).
    //
    // That rule is one regexp, which keeps its place between calls, and the
    // tokenizer asks it of every block. After a block it took for blank lines
    // the next one asked, in this script or the next, was asked from past its
    // start, and the same script read differently on its next reading. No
    // block is blank lines now, the two-space line being held above, so the
    // place is never moved; it is put back first for whoever else moved it.
    rules.blank_lines.lastIndex = 0;
    const tokens = Lexer.tokenizeScript(`\n${protectedBody}`).flatMap((read): BodyToken[] => {
      const found = byItsMark(read);
      const cue = found.type === "character" ? held.cue(found.text ?? "") : null;
      if (cue) return [{ ...found, cue: { ...cue, name: breaks.restore(cue.name) } }];
      // In a speech the stand-in is a line of its own, and goes. A block the
      // tokenizer took for something else reads as it was written.
      if (found.type === "dialogue" && found.text === standIn) return [];
      const whole = found.text?.replaceAll(`${standIn}\n`, "");
      const written =
        whole === undefined
          ? undefined
          : breaks.restore(marks.restore(held.restore(whole)), found.type === "lyrics");
      const tok = written === found.text ? found : { ...found, text: written };
      if (!tok.text?.includes(emptyLine)) return [tok];
      const text = tok.text.replaceAll(emptyLine, "");
      // A standalone two-space line is still just whitespace, not a new Action.
      return tok.type === "action" && !text.trim() ? [] : [{ ...tok, text }];
    });
    return tokens.filter((tok, i) => !isVerseBreak(tok, tokens[i - 1], tokens[i + 1]));
  } catch {
    // docs/app/keeping-work/storage-and-file-format.md#STOR-107: degrade, don't crash.
    return source.trim() ? [{ type: "action", text: source, addTo: (t: Token[]) => t }] : [];
  }
}

function inline(text: string | undefined): InlineNode[] {
  return parseInline(text ?? "");
}

function tokensToDoc(tokens: BodyToken[], boneyards: string[]): Doc {
  const blocks: BlockNode[] = [];
  // fountain-js carries dual-dialogue on the `dialogue_begin` token; the next
  // `character` is the `^`-marked (right) cue.
  let pendingDual = false;

  for (const tok of tokens) {
    switch (tok.type) {
      case "dialogue_begin":
        pendingDual = tok.dual === "right";
        break;
      case "dialogue_end":
      case "dual_dialogue_begin":
      case "dual_dialogue_end":
      case "spaces":
        break;

      case "section": {
        const depth = tok.depth ?? 1;
        if (depth <= 1) {
          blocks.push({ type: "act", content: inline(tok.text) });
        } else {
          const node: BlockNode = { type: "scene", content: inline(tok.text) };
          if (depth !== 2) node.attrs = { level: depth };
          blocks.push(node);
        }
        break;
      }

      case "scene_heading": {
        const attrs: Record<string, unknown> = {};
        if (tok.scene_number) attrs.sceneNumber = tok.scene_number;
        blocks.push({
          type: "sceneHeading",
          ...(Object.keys(attrs).length ? { attrs } : {}),
          content: inline(tok.text),
        });
        break;
      }

      case "synopsis":
        blocks.push({ type: "synopsis", content: inline(tok.text) });
        break;

      case "character": {
        const { name, extension } = tok.cue ?? splitCueExtension(tok.text ?? "");
        const attrs: Record<string, unknown> = {};
        if (extension) attrs.extension = extension;
        if (pendingDual) attrs.dual = true;
        pendingDual = false;
        blocks.push({
          type: "character",
          ...(Object.keys(attrs).length ? { attrs } : {}),
          content: inline(name),
        });
        break;
      }

      case "parenthetical": {
        const text = (tok.text ?? "").replace(/^\(/, "").replace(/\)$/, "");
        blocks.push({ type: "parenthetical", content: inline(text) });
        break;
      }

      case "dialogue":
        blocks.push({ type: "dialogue", content: inline(tok.text) });
        break;

      case "lyrics":
        blocks.push({ type: "lyric", content: inline(tok.text) });
        break;

      case "transition":
        blocks.push({ type: "transition", content: inline(tok.text) });
        break;

      case "centered":
        blocks.push({ type: "centered", content: inline(tok.text) });
        break;

      case "note":
        // A line of notes and nothing else becomes an action whose only
        // content is notes; it serializes back to `[[ … ]]` on its own line.
        //
        // The tokenizer's rule for such a line is greedy: it takes everything
        // from the line's first `[[` to its last `]]` as ONE note. A line of
        // two (`[[a]][[b]]`, a comment and its reply) came back as a single
        // note holding `a]][[b`, and a word between two notes was hidden
        // inside it. So the line is read as inline text, which finds each,
        // and which takes a note's words as they stand: read for emphasis,
        // `[[see snake_case_name]]` lost its underscores on the next save
        // (docs/engineering/fountain-model.md#EDIT-182).
        blocks.push({ type: "action", content: inline(`[[${tok.text ?? ""}]]`) });
        break;

      case "page_break":
        blocks.push({ type: "pageBreak" });
        break;

      case "action": {
        const m = (tok.text ?? "").match(BONEYARD_SENTINEL);
        if (m) {
          const idx = Number(m[1]);
          blocks.push({
            type: "boneyard",
            content: [{ type: "text", text: boneyards[idx] ?? "" }],
          });
        } else {
          blocks.push({ type: "action", content: inline(tok.text) });
        }
        break;
      }

      default:
        // Unknown token type — keep its text as action rather than drop it.
        if (tok.text) blocks.push({ type: "action", content: inline(tok.text) });
    }
  }

  return { type: "doc", content: blocks };
}

export function parse(source: string): ParsedScript {
  const normalized = source.replace(/\r\n|\r/g, "\n");
  const { frontMatter, body } = splitTitlePage(normalized);
  const { body: bodyNoBone, boneyards } = extractBoneyard(body);
  const tokens = safeTokenize(bodyNoBone);
  const doc = tokensToDoc(tokens, boneyards);
  return { frontMatter, doc };
}
