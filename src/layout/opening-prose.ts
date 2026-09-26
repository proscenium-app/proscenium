// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { toDoc, type Node } from "../markdown/doc";
import type { ElementAlign } from "../format/spec";
import type { StyleRun } from "./engine";

export interface OpeningParagraph { text: string; heading: boolean; align: ElementAlign; runs: StyleRun[] }

/** The prose editor's marks enter the same measured line layout as every script. */
export function openingParagraphs(markdown: string): OpeningParagraph[] {
  const paragraphs: OpeningParagraph[] = [];
  function block(node: Node, prefix = "") {
    if (["paragraph", "heading", "codeBlock"].includes(node.type)) {
      let text = prefix;
      const runs: StyleRun[] = [];
      const inline = (n: Node) => {
        if (n.type === "hardBreak") text += "\n";
        else if (n.text) {
          const start = text.length; text += n.text;
          runs.push({ start, end: text.length, bold: !!n.marks?.some((m) => m.type === "bold"),
            italic: !!n.marks?.some((m) => m.type === "italic"), underline: false });
        } else n.content?.forEach(inline);
      };
      node.content?.forEach(inline);
      const align = node.attrs?.textAlign;
      paragraphs.push({ text, heading: node.type === "heading", runs,
        align: align === "center" || align === "right" ? align : "left" });
    } else if (node.type === "bulletList" || node.type === "orderedList") {
      node.content?.forEach((item, i) => item.content?.forEach((child, j) => block(child, j ? "" : node.type === "bulletList" ? "• " : `${Number(node.attrs?.start ?? 1) + i}. `)));
    } else if (node.type !== "managedMarker") node.content?.forEach((child) => block(child));
  }
  toDoc(markdown).content?.forEach((node) => block(node));
  return paragraphs;
}
