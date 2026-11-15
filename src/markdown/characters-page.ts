// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CharacterEntry } from "../fountain";
import { toDoc, toMarkdown, type Node } from "./doc";

/** The printed Characters page, as its Markdown: a heading, then each character in bold with what they are. */
export function charactersPageText(characters: readonly CharacterEntry[]): string {
  return toMarkdown({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Characters" }] },
      ...characters.map(
        (c): Node => ({
          type: "paragraph",
          content: [
            { type: "text", text: c.name, marks: [{ type: "bold" }] },
            ...(c.description ? [{ type: "text", text: " — " + c.description }] : []),
          ],
        }),
      ),
    ],
  });
}

/*
 * The Characters page and the cast list, kept in step both ways
 * (docs/app/formatting/formats-and-layout.md#FMT-166). On the page, a
 * character is a paragraph that begins with their name in bold, then their
 * description after a dash, a colon or a comma: the shape `charactersPageText`
 * writes. Every other block is the writer's own prose and is never touched.
 */

/** What a paragraph says of a character, if it begins with a name in bold. */
function castLine(node: Node): CharacterEntry | null {
  if (node.type !== "paragraph") return null;
  const parts = node.content ?? [];
  const bold = (part: Node) => part.type === "text" && !!part.marks?.some((m) => m.type === "bold");
  let at = 0;
  let name = "";
  while (at < parts.length && bold(parts[at]!)) name += parts[at++]!.text ?? "";
  name = name.trim();
  if (!name) return null;
  const rest = parts
    .slice(at)
    .map((part) =>
      part.type === "text" ? (part.text ?? "") : part.type === "hardBreak" ? " " : "",
    )
    .join("");
  const description = rest.replace(/^\s*(?:—|–|-|:|,)?\s*/, "").trim();
  return description ? { name, description } : { name };
}

const sameName = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * The cast list a page shows, in its order, or null when it shows none: a
 * page of the writer's own prose with no name in bold leads no line.
 */
export function castFromPage(markdown: string): CharacterEntry[] | null {
  const lines = (toDoc(markdown).content ?? []).map(castLine).filter((l) => l !== null);
  return lines.length ? lines : null;
}

/**
 * The page with the cast list's names and descriptions in it: each character's
 * line in the place a character's line stood, in the list's order, a new one
 * after the last, a removed one gone. A line that already says what the list
 * says keeps its own wording and emphasis. Null when the page shows no cast
 * (castFromPage), so the writer's own prose is left alone; the page itself,
 * unchanged, when it already shows the list.
 */
export function pageWithCast(
  markdown: string,
  characters: readonly CharacterEntry[],
): string | null {
  const shown = castFromPage(markdown);
  if (!shown) return null;
  const listed = characters.filter((c) => c.name.trim());
  const same =
    shown.length === listed.length &&
    shown.every(
      (s, i) =>
        s.name === listed[i]!.name.trim() &&
        (s.description ?? "") === (listed[i]!.description?.trim() ?? ""),
    );
  if (same) return markdown;
  const doc = toDoc(markdown);
  const blocks = doc.content ?? [];
  const lines = blocks.map(castLine);
  const kept = (c: CharacterEntry): Node | null => {
    const i = lines.findIndex(
      (l) =>
        l && l.name === c.name.trim() && (l.description ?? "") === (c.description?.trim() ?? ""),
    );
    return i >= 0 ? blocks[i]! : null;
  };
  const line = (c: CharacterEntry): Node =>
    kept(c) ?? {
      type: "paragraph",
      content: [
        { type: "text", text: c.name.trim(), marks: [{ type: "bold" }] },
        ...(c.description?.trim() ? [{ type: "text", text: ` — ${c.description.trim()}` }] : []),
      ],
    };
  const cast = listed.map(line);
  const last = lines.reduce((at, l, i) => (l ? i : at), -1);
  const out: Node[] = [];
  let next = 0;
  blocks.forEach((block, i) => {
    if (!lines[i]) {
      out.push(block);
      return;
    }
    if (next < cast.length) out.push(cast[next++]!);
    if (i === last) while (next < cast.length) out.push(cast[next++]!);
  });
  return toMarkdown({ ...doc, content: out });
}

export { sameName as sameCastName };
