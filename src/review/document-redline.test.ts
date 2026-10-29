// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import type { Node } from "../markdown/doc";
import { REDLINE_ADD, REDLINE_DEL, REDLINE_SKIP, documentRedline } from "./document-redline";

/** Each element drawn, as "<kind>[ state]: words" with {+added+} and [-cut-] marked. */
function drawn(doc: Node | null, depth = 0): string[] {
  const out: string[] = [];
  for (const node of doc?.content ?? []) {
    if (node.type === "bulletList" || node.type === "orderedList") {
      for (const item of node.content ?? []) {
        const [first, ...rest] = item.content ?? [];
        out.push(
          ...line(first!, `${"  ".repeat(depth)}${node.type === "orderedList" ? "1." : "-"}`),
        );
        for (const child of rest) out.push(...drawn({ type: "doc", content: [child] }, depth + 1));
      }
    } else if (node.type === "blockquote") out.push(...line(node.content![0]!, ">"));
    else if (node.type === REDLINE_SKIP) out.push(`⋯ ${String(node.attrs?.count)}`);
    else
      out.push(
        ...line(node, node.type === "heading" ? `h${String(node.attrs?.level)}` : node.type),
      );
  }
  return out;
}

function line(node: Node, kind: string): string[] {
  const state = node.attrs?.redline ? ` ${String(node.attrs.redline)}` : "";
  const words = (node.content ?? [])
    .map((n) => {
      const text = n.text ?? (n.type === "hardBreak" ? "⏎" : "");
      const marks = (n.marks ?? []).map((m) => m.type);
      const styled = marks.includes("bold")
        ? `**${text}**`
        : marks.includes("italic")
          ? `*${text}*`
          : text;
      if (marks.includes(REDLINE_ADD)) return `{+${styled}+}`;
      if (marks.includes(REDLINE_DEL)) return `[-${styled}-]`;
      return styled;
    })
    .join("");
  return [`${kind}${state}: ${words}`];
}

const SHEET = `# Mara

## Want

She wants the house to stay *hers*.

## Wound

- Her mother left the water to Jonah.
- She never learned to swim.
  - Her father drowned when she was nine.
- She keeps the pipe because it cries.
`;

describe("docs/app/keeping-work/storage-and-file-format.md#STOR-177: a document read on its page", () => {
  test("words changed in a paragraph are marked where they stand, its emphasis kept", () => {
    const after = SHEET.replace("to stay *hers*.", "to stay *hers*, and Jonah to leave.");
    expect(drawn(documentRedline(SHEET, after).doc)).toContain(
      "paragraph mod: She wants the house to stay *hers*{+, and Jonah to leave+}.",
    );
  });

  test("a heading is a heading, and a cut list item is struck as an item of its list", () => {
    const after = SHEET.replace("- She keeps the pipe because it cries.\n", "").replace(
      "## Wound",
      "## Wounds",
    );
    const lines = drawn(documentRedline(SHEET, after).doc);
    expect(lines).toContain("h2 mod: [-Wound-]{+Wounds+}");
    expect(lines).toContain("- del: [-She keeps the pipe because it cries.-]");
    // No line of the file's markup is ever on the page.
    expect(lines.join("\n")).not.toMatch(/^#|\n#|\*\*|^- -/);
  });

  test("a nested item added is drawn under the item it hangs from", () => {
    const after = SHEET.replace(
      "  - Her father drowned when she was nine.\n",
      "  - Her father drowned when she was nine.\n  - Nobody looked for him.\n",
    );
    const lines = drawn(documentRedline(SHEET, after).doc);
    const parent = lines.indexOf("-: She never learned to swim.");
    expect(parent).toBeGreaterThanOrEqual(0);
    expect(lines.slice(parent + 1)).toContain("  - add: {+Nobody looked for him.+}");
  });

  test("unchanged stretches are left out, and the same text twice draws nothing", () => {
    const long = `${SHEET}\n${Array.from({ length: 12 }, (_, i) => `Note ${i}.`).join("\n\n")}\n`;
    const after = long.replace("Note 11.", "Note eleven.");
    const lines = drawn(documentRedline(long, after).doc);
    expect(lines[0]).toMatch(/^⋯ \d+$/);
    expect(lines[lines.length - 1]).toBe("paragraph mod: Note [-11-]{+eleven+}.");
    expect(documentRedline(SHEET, SHEET).doc).toBeNull();
  });
});
