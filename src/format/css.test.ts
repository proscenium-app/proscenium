// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import dgModernRaw from "../../formats/dg-modern.json";
import stageUsModernRaw from "../../formats/stage-us-modern.json";
import { formatToCss } from "./css";
import { inchesToCh } from "./metrics";
import { validateFormatSpec } from "./validate";
import type { FormatSpec } from "./spec";

function spec(raw: unknown): FormatSpec {
  const v = validateFormatSpec(raw);
  if (!v.ok) throw new Error(v.errors.join("\n"));
  return v.spec;
}

/** The rules emitted for one selector, as a single string. */
function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no block for ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

describe("formatToCss (dg-modern)", () => {
  const css = formatToCss(spec(dgModernRaw));

  it("emits the page frame from the spec, not from constants", () => {
    const page = block(css, ".play-page");
    expect(page).toContain("width: var(--fmt-page-width)");
    expect(css).toContain("--fmt-page-width: 8.5in;");
    expect(page).toContain(
      "padding: var(--fmt-margin-top) var(--fmt-margin-right) var(--fmt-margin-bottom) var(--fmt-margin-left);",
    );
    expect(css).toContain("--fmt-margin-left: 1.5in;");
    expect(page).toContain("font-size: 12pt;");
    expect(page).toContain("line-height: 1.2;");
    expect(css).toContain("--fmt-line: 14.4pt;");
  });

  it("emits element columns on the character grid (ch units)", () => {
    // Courier Prime's true advance is just shy of nominal 10 cpi. Derive the
    // ch conversion from that face, keeping the physical column width exact.
    const ch = (inches: number) => Math.round(inchesToCh(spec(dgModernRaw), inches) * 1e4) / 1e4;
    expect(block(css, ".play-page .pl-character")).toContain(`margin-left: ${ch(2.5)}ch;`);
    expect(block(css, ".play-page .pl-action")).toContain(`margin-left: ${ch(2.5)}ch;`);
    expect(block(css, ".play-page .pl-action")).toContain(`max-width: ${ch(3.5)}ch;`);
    // Dialogue: full 6.0" block, margin to margin.
    const dialogue = block(css, ".play-page .pl-dialogue");
    expect(dialogue).toContain(`max-width: ${ch(6)}ch;`);
    expect(dialogue).not.toContain("margin-left:");
  });

  it("emits rhythm as line-pitch multiples with collapsing margins", () => {
    const character = block(css, ".play-page .pl-character");
    expect(character).toContain("margin-top: calc(1 * var(--fmt-line));");
    expect(character).not.toContain("margin-bottom:");
    const scene = block(css, ".play-page .pl-scene");
    expect(scene).toContain("margin-top: calc(2 * var(--fmt-line));");
  });

  it("wraps parentheticals via decorations, per the spec flag", () => {
    expect(css).toContain(`.play-page .pl-parenthetical::before { content: "("; }`);
  });

  it("keeps an empty parenthetical's parens on one line", () => {
    expect(css).toContain(
      ".play-page .pl-parenthetical > br.ProseMirror-trailingBreak:only-child { display: none; }",
    );
  });

  /** dg-modern: left-aligned, where the caret sat in front of the "(". */
  it("starts an empty left-aligned parenthetical one paren in, so the caret sits inside", () => {
    const empty = ".play-page .pl-parenthetical:has(> br.ProseMirror-trailingBreak:only-child)";
    expect(css).toContain(`${empty} { text-indent: 1ch; }`);
    expect(css).toContain(`${empty}::before { margin-left: -1ch; }`);
    expect(css).not.toContain(`${empty} { position: relative;`);
  });

  it("does the same for any element the format wraps in parens, and nothing for the rest", () => {
    const raw = structuredClone(dgModernRaw) as { elements: { lyric: Record<string, unknown> } };
    raw.elements.lyric.parenWrap = true;
    const wrapped = formatToCss(spec(raw));
    expect(wrapped).toContain(
      ".play-page .pl-lyric > br.ProseMirror-trailingBreak:only-child { display: none; }",
    );
    expect(wrapped).toContain(
      ".play-page .pl-lyric:has(> br.ProseMirror-trailingBreak:only-child)",
    );
    expect(css).not.toContain(".pl-lyric > br.ProseMirror-trailingBreak");
    expect(css).not.toContain(".pl-dialogue:has(");
  });

  it("hides non-printing elements only in the paginated view", () => {
    expect(css).toContain(".play-page.is-paginated .pl-synopsis { display: none; }");
    expect(css).toContain(".play-page.is-paginated .pl-note { display: none; }");
    // A standalone-comment block hides WHOLE (engine skips it entirely).
    expect(css).toContain(".play-page.is-paginated .pl-commentonly { display: none; }");
    expect(css).not.toContain(".play-page .pl-synopsis { display: none; }");
  });

  it("styles transitions right-aligned and uppercase (dg spec)", () => {
    const transition = block(css, ".play-page .pl-transition");
    expect(transition).toContain("text-align: right;");
    expect(transition).toContain("text-transform: uppercase;");
  });
});

describe("formatToCss (stage-us-modern)", () => {
  const css = formatToCss(spec(stageUsModernRaw));

  it("uses fixed bold cues and restrained headings", () => {
    expect(block(css, ".play-page .pl-character")).toContain("font-weight: 700;");
    const act = block(css, ".play-page .pl-act");
    expect(act).toContain("font-weight: 700;");
    expect(act).not.toContain("letter-spacing:");
    expect(block(css, ".play-page")).toContain("line-height: 1.2;");
  });

  it("separates lyric stanzas", () => {
    expect(css).not.toContain(".play-page .pl-lyric + .pl-lyric { margin-top: 0; }");
  });

  /** Centred, an empty line's caret is already between the parens. Moving it would push it onto the ")". */
  it("leaves an empty centred parenthetical's caret where the engines put it", () => {
    const custom = spec(stageUsModernRaw);
    custom.elements.parenthetical.align = "center";
    const css = formatToCss(custom);
    expect(block(css, ".play-page .pl-parenthetical")).toContain("text-align: center;");
    expect(css).toContain(
      ".play-page .pl-parenthetical > br.ProseMirror-trailingBreak:only-child { display: none; }",
    );
    expect(css).not.toContain(".pl-parenthetical:has(> br.ProseMirror-trailingBreak:only-child) {");
  });
});

describe("formatToCss: the caret in an empty right-aligned parenthetical", () => {
  const raw = structuredClone(dgModernRaw) as {
    elements: { parenthetical: Record<string, unknown> };
  };
  raw.elements.parenthetical.align = "right";
  const css = formatToCss(spec(raw));

  it("ends the line one paren in and shifts it back, so both parens stay put", () => {
    const empty = ".play-page .pl-parenthetical:has(> br.ProseMirror-trailingBreak:only-child)";
    expect(css).toContain(`${empty} { position: relative; left: -1ch; padding-right: 1ch; }`);
    expect(css).toContain(`${empty}::after { margin-right: -1ch; }`);
    expect(css).not.toContain(`${empty} { text-indent: 1ch; }`);
  });
});
