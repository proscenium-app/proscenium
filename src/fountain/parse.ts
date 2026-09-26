// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fountain text → structured script ({ frontMatter, doc }).
 *
 * Pipeline (see docs/engineering/fountain-model.md#FOUN-D109):
 *   1. normalize line endings
 *   2. split off the title page (we own it — titlepage.ts)
 *   3. pre-extract boneyard `/* *\/` (fountain-js *strips* it; we must keep it)
 *   4. tokenize the body with fountain-js
 *   5. map tokens → our ProseMirror-shaped doc, restoring boneyard
 *
 * docs/app/keeping-work/storage-and-file-format.md#STOR-107 (docs/app/keeping-work/storage-and-file-format.md#STOR-D9): never throw on bad input. A tokenizer failure degrades to a
 * single raw `action` block so opening a malformed file can't break the app.
 */
import { Fountain } from "fountain-js";
import type { Token } from "fountain-js";
import { splitCueExtension } from "./cue";
import { parseInline } from "./inline";
import type { BlockNode, Doc, InlineNode, ParsedScript } from "./model";
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

function safeTokenize(body: string): Token[] {
  try {
    // The tokenizer's shared blank-line regexp can classify an entire empty
    // speech as spaces (and alternate on repeated parses). Protect Fountain's
    // two-space lines until tokenization is over: a paused cue must survive
    // reopening, even before its dialogue has words (docs/app/writing/editor-ux.md#EDIT-43).
    let emptyLine = "EMPTY-SPEECH";
    while (body.includes(emptyLine)) emptyLine += "";
    const protectedBody = body.replace(/^ {2}$/gm, emptyLine);
    return new Fountain().parse(protectedBody, true).tokens.flatMap((tok) => {
      if (!tok.text?.includes(emptyLine)) return [tok];
      const text = tok.text.replaceAll(emptyLine, "");
      // A standalone two-space line is still just whitespace, not a new Action.
      return tok.type === "action" && !text.trim() ? [] : [{ ...tok, text }];
    });
  } catch {
    // docs/app/keeping-work/storage-and-file-format.md#STOR-107: degrade, don't crash.
    return body.trim() ? [{ type: "action", text: body, addTo: (t: Token[]) => t }] : [];
  }
}

function inline(text: string | undefined): InlineNode[] {
  return parseInline(text ?? "");
}

function tokensToDoc(tokens: Token[], boneyards: string[]): Doc {
  const blocks: BlockNode[] = [];
  // fountain-js carries dual-dialogue on the `dialogue_begin` token; the next
  // `character` is the `^`-marked (right) cue.
  let pendingDual = false;

  for (const tok of tokens) {
    if (tok.is_title) continue; // we parse the title page ourselves
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
        const { name, extension } = splitCueExtension(tok.text ?? "");
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
        // A standalone block note becomes an action whose only content is the
        // note inline node; it serializes back to `[[ … ]]` on its own line.
        blocks.push({
          type: "action",
          content: [{ type: "note", content: inline(tok.text) }],
        });
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
