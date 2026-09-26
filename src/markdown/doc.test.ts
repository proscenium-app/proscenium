// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toDoc, toMarkdown, type Node } from "./doc";
import { parseBlocks } from "./parse";

/**
 * The contract, in one function: meaning round-trips, formatting normalizes.
 * A file may come back spelled differently; it must never come back MEANING
 * something else, and a second pass must change nothing at all.
 */
function assertStable(src: string) {
  const once = toMarkdown(toDoc(src));
  const twice = toMarkdown(toDoc(once));
  expect(twice).toBe(once); // a fixed point after one pass
  expect(toDoc(once)).toEqual(toDoc(src)); // and the same document
}

/** What the editor would write back for `src`. */
const round = (src: string) => toMarkdown(toDoc(src));

describe("blocks survive the trip", () => {
  test("headings, paragraphs and rules", () => {
    expect(round("# Title\n\nSome prose.\n\n---\n\n## Next")).toBe(
      "# Title\n\nSome prose.\n\n---\n\n## Next\n",
    );
  });

  test("stacked lines stay stacked — a character sheet's shape is its content", () => {
    const src = "**Wants:** to land.\n**Fears:** the quiet.\n";
    expect(round(src)).toBe(src);
  });

  test("bullet and numbered lists, including where the numbering started", () => {
    expect(round("- one\n- two")).toBe("- one\n- two\n");
    expect(round("3. three\n4. four")).toBe("3. three\n4. four\n");
  });

  test("nested lists keep their depth", () => {
    const src = "- top\n  - under\n    - deeper\n- next\n";
    expect(round(src)).toBe(src);
  });

  test("a nested ordered list under a bullet", () => {
    expect(round("- outer\n  1. first\n  2. second")).toBe("- outer\n  1. first\n  2. second\n");
  });

  test("blockquotes", () => {
    expect(round("> the house is not a metaphor")).toBe("> the house is not a metaphor\n");
  });

  test("fenced code keeps its language and its exact text", () => {
    const src = "```fountain\nMARA\nI never said that.\n```\n";
    expect(round(src)).toBe(src);
  });

  test("tables keep their columns and their alignment", () => {
    const src = "| # | Role | Real? |\n| --- | :---: | ---: |\n| 1 | Protag | Real |\n";
    expect(round(src)).toBe(src);
  });

  test("a ragged table is squared up, not dropped", () => {
    const out = round("a | b | c\n---|---|---\n1 | 2");
    expect(out).toBe("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 |  |\n");
  });

  test("an escaped pipe stays inside its cell", () => {
    const src = "| a | b |\n| --- | --- |\n| x \\| y | z |\n";
    expect(round(src)).toBe(src);
  });
});

describe("inline marks survive the trip", () => {
  test("bold, italic, code and links", () => {
    expect(round("a **b** c _d_ e `f` and [g](https://h.i)")).toBe(
      "a **b** c _d_ e `f` and [g](https://h.i)\n",
    );
  });

  // Italics are written `_like this_` throughout a writer's vault, so that is what
  // the serializer emits — churn a writer can SEE is churn they didn't ask for.
  test("underscore emphasis is left as underscores", () => {
    expect(round("_soft_")).toBe("_soft_\n");
  });

  test("asterisk emphasis normalizes to underscores but stays emphasis", () => {
    expect(round("*soft*")).toBe("_soft_\n");
    assertStable("*soft*");
  });

  test("intraword emphasis falls back to asterisks — `_` cannot open in a word", () => {
    const doc: Node = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "un" },
            { type: "text", text: "frigging", marks: [{ type: "italic" }] },
            { type: "text", text: "believable" },
          ],
        },
      ],
    };
    expect(toMarkdown(doc)).toBe("un*frigging*believable\n");
    expect(toDoc(toMarkdown(doc))).toEqual(doc);
  });

  test("nested emphasis inside bold stays nested", () => {
    expect(round("**bold *and italic***")).toBe("**bold _and italic_**\n");
    assertStable("**bold *and italic***");
  });

  test("code containing a backtick gets a longer fence", () => {
    assertStable("``a ` b``");
    expect(round("``a ` b``")).toContain("``");
  });

  test("a refused link scheme stays literal text, both ways", () => {
    assertStable("[click](javascript:alert(1))");
  });
});

describe("escaping — what a writer types stays what they typed", () => {
  test("a literal asterisk does not become emphasis on the next open", () => {
    const doc: Node = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "2 * 3 * 4" }] }],
    };
    const md = toMarkdown(doc);
    expect(md).toBe("2 \\* 3 \\* 4\n");
    expect(toDoc(md)).toEqual(doc);
  });

  test("a line that starts with a dash does not become a list", () => {
    const doc: Node = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "- not a bullet" }] }],
    };
    expect(toDoc(toMarkdown(doc))).toEqual(doc);
  });

  test("a line of dashes does not become a rule", () => {
    const doc: Node = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "---" }] }],
    };
    expect(toDoc(toMarkdown(doc))).toEqual(doc);
  });

  test("snake_case is left alone — over-escaping is its own bug", () => {
    expect(round("read snake_case_name please")).toBe("read snake_case_name please\n");
  });

  // Both of these were found by round-tripping a real vault, not by taste.
  test("a fill-in-the-blank rule of underscores is not bold", () => {
    const src = 'Finish it: "If I say the true thing, then ______."';
    expect(toDoc(src).content![0]!.content).toEqual([{ type: "text", text: src }]);
    assertStable(src);
  });

  test("bold ending at a wrapped line keeps its closing marker on that line", () => {
    const src = "the right filenames is **not**\nevidence that it is the one\n";
    expect(round(src)).toBe(src);
  });

  test("bold inside italic does not close and reopen the italic", () => {
    // Notes migrated from another app are full of this, and getting it wrong
    // rewrote `_a **b** c_` as `_a _**_b_**_ c_` — which then read back as something else.
    const src = "_Casting model re-ruled: **MANY characters; the rest doubles up.** Clay stays._\n";
    expect(round(src)).toBe(src);
  });

  test("a heading's own text can start with a marker", () => {
    const doc: Node = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "# hashtag" }] },
      ],
    };
    expect(toDoc(toMarkdown(doc))).toEqual(doc);
  });
});

describe("editor shapes the parser never produces", () => {
  test("an empty document is an empty file, not a blank line", () => {
    expect(toMarkdown({ type: "doc", content: [{ type: "paragraph" }] })).toBe("");
  });

  test("an empty file still gives the caret somewhere to live", () => {
    expect(toDoc("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  test("a run split into two text nodes comes back as one phrase", () => {
    const doc: Node = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "half ", marks: [{ type: "bold" }] },
            { type: "text", text: "and half", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    expect(toMarkdown(doc)).toBe("**half and half**\n");
  });

  test("a second paragraph pasted into a list item folds in rather than breaking the list", () => {
    const doc: Node = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "item" }] },
                { type: "paragraph", content: [{ type: "text", text: "more about it" }] },
              ],
            },
          ],
        },
      ],
    };
    const md = toMarkdown(doc);
    expect(md).toBe("- item\n  more about it\n");
    // Still one list, one item, and no text lost.
    expect(parseBlocks(md)).toHaveLength(1);
    expect(md).toContain("more about it");
  });
});

describe("the sample vault round-trips", () => {
  const root = join(import.meta.dir, "../../sample-vault");
  const files = [
    "The Weight of Water/Notes/Structure.md",
    "The Weight of Water/Characters/Mara.md",
    "The Weight of Water/Characters/Jonah.md",
    "The Weight of Water/Research/1953 North Sea Flood.md",
    "The Weight of Water/Loglines/Logline.md",
    "The Lighthouse/Notes/Ideas.md",
  ];

  for (const rel of files) {
    test(rel, () => {
      const raw = readFileSync(join(root, rel), "utf8");
      // Front matter is split off by the editor before this bridge sees it.
      const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
      assertStable(body);
    });
  }

  test("a realistic character sheet is byte-identical, not merely equivalent", () => {
    // The shapes a writer actually writes should not be reformatted at all — a
    // normalization the writer can SEE is a normalization they didn't ask for.
    const src = [
      "# CHARLIE",
      "",
      "## Want",
      "",
      "Tonight: to land.",
      "",
      "- Title: **The Weight of Water**. Two acts.",
      "- Cast: Protag + Sister + Mover.",
      "",
      "> The water remembers every weight.",
      "",
      "| Role | Actor |",
      "| --- | --- |",
      "| Protag | CHARLIE |",
      "",
      "---",
      "",
      "Next pass: read it aloud.",
      "",
    ].join("\n");
    expect(round(src)).toBe(src);
  });
});

test("paragraph alignment survives editing without showing its storage marker", () => {
  for (const alignment of ["center", "right"]) {
    const source = `<!-- proscenium:align=${alignment} -->\n\n# My heading\n\n<!-- proscenium:align=${alignment} -->\n\n**A name**, a description.\n`;
    assertStable(source);
    const doc = toDoc(source);
    expect(doc.content).toHaveLength(2);
    expect(doc.content?.[0].attrs?.textAlign).toBe(alignment);
    expect(doc.content?.[1].attrs?.textAlign).toBe(alignment);
  }
});

test("the character appearance marker survives edits as an invisible node", () => {
  const marker =
    "<!-- proscenium:managed — regenerated from the script; edits here are overwritten -->";
  const source = `## Appearances\n\n${marker}\n- Scene 1\n\n## Notes\n\nMy words.\n`;
  assertStable(source);
  expect(toDoc(source).content?.filter((node) => node.type === "managedMarker")).toHaveLength(1);
  expect(toMarkdown(toDoc(source))).toContain(marker);
});

test("an empty aligned paragraph never leaks an alignment marker into the page", () => {
  const text = toMarkdown({
    type: "doc",
    content: [{ type: "paragraph", attrs: { textAlign: "center" } }],
  });
  expect(text).toBe("");
  expect(toDoc(text).content).toEqual([{ type: "paragraph" }]);
});
