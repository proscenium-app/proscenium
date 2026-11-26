// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toDoc, type Node } from "../markdown/doc";
import type { ElementAlign } from "../format/spec";
import type { StyleRun } from "./engine";

export interface OpeningParagraph {
  text: string;
  heading: boolean;
  /** A heading's level, 1 to 6; 0 for any other paragraph. */
  level: number;
  align: ElementAlign;
  runs: StyleRun[];
  /**
   * Which of the document's top-level blocks it came from: the paragraph
   * itself, or the list or table that holds it. The prose editor's document
   * has the same blocks, so this is where its caret goes for a line of the
   * printed page (docs/app/formatting/formats-and-layout.md#FMT-161).
   */
  block: number;
}

/** The prose editor's marks enter the same measured line layout as every script. */
export function openingParagraphs(markdown: string): OpeningParagraph[] {
  const paragraphs: OpeningParagraph[] = [];
  let top = 0;
  function block(node: Node, prefix = "") {
    if (["paragraph", "heading", "codeBlock"].includes(node.type)) {
      let text = prefix;
      const runs: StyleRun[] = [];
      const inline = (n: Node) => {
        if (n.type === "hardBreak") text += "\n";
        else if (n.text) {
          const start = text.length;
          text += n.text;
          runs.push({
            start,
            end: text.length,
            bold: !!n.marks?.some((m) => m.type === "bold"),
            italic: !!n.marks?.some((m) => m.type === "italic"),
            underline: false,
          });
        } else n.content?.forEach(inline);
      };
      node.content?.forEach(inline);
      const align = node.attrs?.textAlign;
      paragraphs.push({
        text,
        heading: node.type === "heading",
        level: node.type === "heading" ? Number(node.attrs?.level ?? 1) : 0,
        runs,
        align: align === "center" || align === "right" ? align : "left",
        block: top,
      });
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      node.content?.forEach((item, i) =>
        item.content?.forEach((child, j) =>
          block(
            child,
            j ? "" : node.type === "bulletList" ? "• " : `${Number(node.attrs?.start ?? 1) + i}. `,
          ),
        ),
      );
    } else if (node.type !== "managedMarker") node.content?.forEach((child) => block(child));
  }
  toDoc(markdown).content?.forEach((node, i) => {
    top = i;
    block(node);
  });
  return paragraphs;
}
