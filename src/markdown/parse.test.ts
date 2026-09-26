// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { parseBlocks, parseSpans, type ListBlock, type Span, type TableBlock } from "./parse";

/** Flatten spans to a debug string: **bold**, _em_, `code`, [text](href), ⏎. */
function show(spans: Span[]): string {
  return spans
    .map((s) => {
      switch (s.kind) {
        case "text":
          return s.text;
        case "break":
          return "⏎";
        case "code":
          return `\`${s.text}\``;
        case "strong":
          return `**${show(s.spans)}**`;
        case "em":
          return `_${show(s.spans)}_`;
        case "link":
          return `[${show(s.spans)}](${s.href})`;
      }
    })
    .join("");
}

/** The item texts of a list block, flattened. */
function itemTexts(block: ListBlock): string[] {
  return block.items.map((i) => show(i.spans));
}

describe("blocks", () => {
  test("paragraphs split on blank lines", () => {
    const b = parseBlocks("one\n\ntwo");
    expect(b).toHaveLength(2);
    expect(b.every((x) => x.kind === "paragraph")).toBe(true);
  });

  test("headings carry their level, capped content aside", () => {
    const b = parseBlocks("# Big\n## Smaller");
    expect(b.map((x) => x.kind === "heading" && x.level)).toEqual([1, 2]);
  });

  test("fenced code keeps its text verbatim, including markdown-looking lines", () => {
    const b = parseBlocks("```ts\nconst a = **1**;\n# not a heading\n```");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({
      kind: "code",
      lang: "ts",
      text: "const a = **1**;\n# not a heading",
    });
  });

  test("an unterminated fence still renders as code — a cut-off turn stays readable", () => {
    const b = parseBlocks("```py\nprint(1)");
    expect(b[0]).toMatchObject({ kind: "code", text: "print(1)" });
  });

  test("tilde fences work, and a different marker doesn't close them", () => {
    const b = parseBlocks("~~~\n```\nstill code\n~~~");
    expect(b[0]).toMatchObject({ kind: "code", text: "```\nstill code" });
  });

  test("bullet and numbered lists group their items", () => {
    const bullets = parseBlocks("- one\n- two\n- three");
    expect(bullets[0]).toMatchObject({ kind: "list", ordered: false });
    expect(itemTexts(bullets[0] as ListBlock)).toEqual(["one", "two", "three"]);
    const numbers = parseBlocks("1. one\n2. two");
    expect(numbers[0]).toMatchObject({ kind: "list", ordered: true, start: 1 });
  });

  test("a numbered list keeps the number it started at", () => {
    expect(parseBlocks("3. three\n4. four")[0]).toMatchObject({ start: 3 });
  });

  test("an indented continuation line joins its item", () => {
    const b = parseBlocks("- first line\n  wrapped on\n- second");
    const items = (b[0] as ListBlock).items;
    expect(items).toHaveLength(2);
    expect(show(items[0]!.spans)).toBe("first line wrapped on");
  });

  test("a list right after a paragraph is its own block", () => {
    const b = parseBlocks("Here:\n- one\n- two");
    expect(b.map((x) => x.kind)).toEqual(["paragraph", "list"]);
  });

  test("blockquotes merge their lines", () => {
    const b = parseBlocks("> one\n> two");
    expect(b).toHaveLength(1);
    expect(b[0]!.kind).toBe("quote");
  });

  test("horizontal rules", () => {
    expect(parseBlocks("---")[0]!.kind).toBe("rule");
    expect(parseBlocks("***")[0]!.kind).toBe("rule");
  });

  test("empty input produces nothing", () => {
    expect(parseBlocks("")).toEqual([]);
    expect(parseBlocks("\n\n  \n")).toEqual([]);
  });
});

describe("nested lists", () => {
  test("an indented item hangs off the item above it", () => {
    const list = parseBlocks("- top\n  - under\n  - also under\n- next") as ListBlock[];
    const items = list[0]!.items;
    expect(itemTexts(list[0]!)).toEqual(["top", "next"]);
    expect(items[0]!.children).toHaveLength(1);
    expect(itemTexts(items[0]!.children[0]!)).toEqual(["under", "also under"]);
    expect(items[1]!.children).toHaveLength(0);
  });

  test("nesting goes deeper than one level", () => {
    const [list] = parseBlocks("- a\n  - b\n    - c") as ListBlock[];
    const b = list!.items[0]!.children[0]!;
    expect(itemTexts(b)).toEqual(["b"]);
    expect(itemTexts(b.items[0]!.children[0]!)).toEqual(["c"]);
  });

  test("a nested list can change kind", () => {
    const [list] = parseBlocks("- outer\n  1. first\n  2. second") as ListBlock[];
    expect(list!.items[0]!.children[0]).toMatchObject({ ordered: true });
  });

  test("a blank line between items keeps one list — notes are written loose", () => {
    const b = parseBlocks("- one\n\n- two");
    expect(b).toHaveLength(1);
    expect(itemTexts(b[0] as ListBlock)).toEqual(["one", "two"]);
  });

  test("a blank line then prose ends the list", () => {
    const b = parseBlocks("- one\n\nAfter.");
    expect(b.map((x) => x.kind)).toEqual(["list", "paragraph"]);
  });

  test("switching kind at the same level starts a new list", () => {
    const b = parseBlocks("- bullet\n1. number");
    expect(b.map((x) => x.kind)).toEqual(["list", "list"]);
    expect(b[1]).toMatchObject({ ordered: true });
  });

  test("a rule is a rule, not a one-item list", () => {
    expect(parseBlocks("- one\n\n---\n\n- two").map((x) => x.kind)).toEqual([
      "list",
      "rule",
      "list",
    ]);
  });
});

describe("tables", () => {
  const src = [
    "| # | Role | Real? |",
    "|---|:----:|------:|",
    "| 1 | Protag | Real |",
    "| 2 | Sister | **Real** |",
  ].join("\n");

  test("a header plus a delimiter row makes a table", () => {
    const b = parseBlocks(src);
    expect(b).toHaveLength(1);
    const t = b[0] as TableBlock;
    expect(t.head.map(show)).toEqual(["#", "Role", "Real?"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]!.map(show)).toEqual(["2", "Sister", "**Real**"]);
  });

  test("the delimiter row sets alignment", () => {
    expect((parseBlocks(src)[0] as TableBlock).aligns).toEqual([null, "center", "right"]);
  });

  test("a pipe in prose is not a table", () => {
    expect(parseBlocks("a | b\nplain prose")[0]!.kind).toBe("paragraph");
  });

  test("outer pipes are optional and an escaped pipe stays literal", () => {
    const t = parseBlocks("a | b\n--- | ---\nx \\| y | z")[0] as TableBlock;
    expect(t.rows[0]!.map(show)).toEqual(["x | y", "z"]);
  });

  test("a short row is padded so the columns still line up", () => {
    const t = parseBlocks("a | b | c\n---|---|---\n1 | 2")[0] as TableBlock;
    expect(t.rows[0]).toHaveLength(3);
  });

  test("the table ends where the pipes do", () => {
    const b = parseBlocks("a | b\n---|---\n1 | 2\n\nAfter.");
    expect(b.map((x) => x.kind)).toEqual(["table", "paragraph"]);
  });
});

describe("inline spans", () => {
  test("bold, italic and code", () => {
    expect(show(parseSpans("a **b** c _d_ e `f`"))).toBe("a **b** c _d_ e `f`");
  });

  test("code wins over emphasis, so markers inside backticks stay literal", () => {
    const spans = parseSpans("`**not bold**`");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ kind: "code", text: "**not bold**" });
  });

  test("double backticks let a backtick live inside code", () => {
    expect(parseSpans("``a ` b``")[0]).toMatchObject({ kind: "code", text: "a ` b" });
  });

  test("an unmatched marker stays literal rather than eating the rest", () => {
    expect(show(parseSpans("2 * 3 * 4"))).toBe("2 * 3 * 4");
    expect(show(parseSpans("a ** b"))).toBe("a ** b");
    expect(show(parseSpans("snake_case_name"))).toBe("snake_case_name");
  });

  test("links keep their label and href", () => {
    expect(show(parseSpans("see [docs](https://example.com)"))).toBe(
      "see [docs](https://example.com)",
    );
  });

  test("a javascript: link is rendered as plain text, never as a link", () => {
    const spans = parseSpans("[click](javascript:alert(1))");
    expect(spans.every((s) => s.kind !== "link")).toBe(true);
    expect(show(spans)).toContain("[click](javascript:alert(1))");
  });

  test("other unsafe schemes are refused too", () => {
    for (const href of ["data:text/html;base64,x", "file:///etc/passwd", "vbscript:x"]) {
      const spans = parseSpans(`[x](${href})`);
      expect(spans.every((s) => s.kind !== "link")).toBe(true);
    }
  });

  test("mailto is allowed", () => {
    expect(parseSpans("[me](mailto:a@b.c)")[0]).toMatchObject({ kind: "link" });
  });

  test("raw HTML is never markup — it survives as text for the renderer to escape", () => {
    const spans = parseSpans("<img src=x onerror=alert(1)>");
    expect(spans.every((s) => s.kind === "text")).toBe(true);
    expect(show(spans)).toBe("<img src=x onerror=alert(1)>");
  });

  test("nested emphasis inside bold", () => {
    expect(show(parseSpans("**bold _and italic_**"))).toBe("**bold _and italic_**");
  });
});

describe("line breaks inside a paragraph", () => {
  // A character sheet is written as stacked lines. Reflowing them into one
  // block loses the shape the writer typed, so a single newline is a break.
  test("stacked lines stay stacked", () => {
    const [p] = parseBlocks("**Wants:** to land.\n**Fears:** the quiet.");
    expect(p!.kind).toBe("paragraph");
    expect(show((p as { spans: Span[] }).spans)).toBe("**Wants:** to land.⏎**Fears:** the quiet.");
  });

  test("a blank line is still a new paragraph, not two breaks", () => {
    expect(parseBlocks("one\n\ntwo")).toHaveLength(2);
  });

  test("a wrapped list item still reflows — that indent means continuation", () => {
    const [list] = parseBlocks("- a line\n  continued") as ListBlock[];
    expect(show(list!.items[0]!.spans)).toBe("a line continued");
  });
});

describe("round-trip sanity on realistic assistant prose", () => {
  const reply = [
    "Here's what I changed:",
    "",
    "- Renamed **MARA** to `MARIA` in act one",
    "- Left the *stage directions* alone",
    "",
    "```fountain",
    "MARIA",
    "I never said that.",
    "```",
    "",
    "> Note: the cast page updates on save.",
  ].join("\n");

  test("produces the blocks you'd expect, in order", () => {
    expect(parseBlocks(reply).map((b) => b.kind)).toEqual([
      "paragraph",
      "list",
      "code",
      "quote",
    ]);
  });

  test("the fountain block keeps its exact text", () => {
    const code = parseBlocks(reply).find((b) => b.kind === "code");
    expect(code).toMatchObject({ lang: "fountain", text: "MARIA\nI never said that." });
  });
});
