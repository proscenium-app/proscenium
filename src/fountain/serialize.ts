// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structured script ({ frontMatter, doc }) → canonical Fountain text.
 *
 * Serialization is canonical and **defensive**: any node whose natural text
 * could re-parse as a different element is force-prefixed (`.`/`@`/`!`/`>`/`~`).
 * That forcing is the mechanism behind the round-trip guarantees
 * (docs/engineering/fountain-model.md#FOUN-D100 rules 1, 2, 4). Normalization: one blank line between
 * body elements, none between a cue and its dialogue; LF; single trailing NL.
 */
import { serializeInline, textContent } from "./inline";
import type { BlockNode, BlockType, ParsedScript } from "./model";
import { serializeTitlePage } from "./titlepage";

// Matches Fountain's scene-heading prefixes: INT/EXT/EST and the I/E slash
// forms — but NOT a bare leading "I" or "E" (so "I keep listening." is action).
const NATURAL_SLUG = /^(?:(?:int|i)\.?\/(?:ext|e)|int|ext|est)[. ]/i;
const NATURAL_TRANSITION = /^(?:[^a-z]*\bTO:|FADE (?:TO BLACK|OUT)\.|CUT TO BLACK\.)$/;
const FORCE_CHARS = /^[ \t]*[.>@~=#!]/;

function isAllCaps(line: string): boolean {
  return /[A-Z]/.test(line) && !/[a-z]/.test(line);
}

/** Would this action's first line re-parse as a non-action element? */
function actionNeedsForce(text: string): boolean {
  const first = text.split("\n", 1)[0];
  return (
    FORCE_CHARS.test(text) ||
    isAllCaps(first) ||
    NATURAL_SLUG.test(first) ||
    /\bTO:\s*$/.test(first)
  );
}

function attr<T>(block: BlockNode, key: string): T | undefined {
  return block.attrs?.[key] as T | undefined;
}

function serializeBlock(block: BlockNode): string {
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
      // A lone block note serializes as `[[ … ]]`, never force-prefixed.
      const onlyNote = block.content?.length === 1 && block.content[0].type === "note";
      if (onlyNote) return text;
      return actionNeedsForce(text) ? `!${text}` : text;
    }
    case "character": {
      const extension = attr<string>(block, "extension");
      const dual = attr<boolean>(block, "dual");
      const forced = /[a-z]/.test(textContent(block.content));
      let out = forced ? `@${text}` : text;
      if (extension) out += ` ${extension}`;
      if (dual) out += " ^";
      return out;
    }
    case "parenthetical":
      return `(${text})`;
    case "dialogue":
      // A blank line inside a speech is written as Fountain's two-space line:
      // a bare empty line would END the dialogue block on the next parse and
      // demote the rest of the speech to action (rule 1, round-trip fidelity).
      return text.replace(/^[ \t]*$/gm, "  ");
    case "transition":
      return NATURAL_TRANSITION.test(text) ? text : `> ${text}`;
    case "lyric":
      return text
        .split("\n")
        .map((l) => `~${l}`)
        .join("\n");
    case "centered":
      return `> ${text} <`;
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

/** No blank line between a cue and the dialogue/parenthetical lines it leads. */
function joinedToPrevious(prev: BlockType, cur: BlockType): boolean {
  return SPEECH_HEAD.has(prev) && SPEECH_CONT.has(cur);
}

function serializeBody(blocks: BlockNode[]): string {
  let out = "";
  let prev: BlockType | null = null;
  for (const block of blocks) {
    if (prev !== null) out += joinedToPrevious(prev, block.type) ? "\n" : "\n\n";
    out += serializeBlock(block);
    prev = block.type;
  }
  return out;
}

export function serialize(script: ParsedScript): string {
  const title = serializeTitlePage(script.frontMatter);
  const body = serializeBody(script.doc.content);

  let out = "";
  if (title) out += title + (body ? "\n\n" : "\n");
  out += body;
  // LF, single trailing newline.
  out = out.replace(/\n*$/, "\n");
  return out;
}
