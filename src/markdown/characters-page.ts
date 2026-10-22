// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CharacterEntry } from "../fountain";
import { toMarkdown, type Node } from "./doc";

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
