// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { parseBlocks, parseSpans } from "./parse";
import { fdxToFountain } from "../fountain/fdx";

test("docs/app/keeping-work/storage-and-file-format.md#STOR-33: unmatched Markdown runs and brackets finish within 250ms", () => {
  for (const source of ["hello " + "`".repeat(40_000) + "a", "[".repeat(40_000), "*a ".repeat(40_000), "[a](x".repeat(40_000), "[a](x".repeat(40_000) + ' "title")']) {
    const started = performance.now();
    const spans = parseSpans(source);
    expect(performance.now() - started).toBeLessThan(250);
    expect(spans.length).toBeGreaterThan(0);
  }
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-33: the entire unmatched code run stays literal", () => {
  const text = "hello " + "`".repeat(40_000) + "a";
  expect(parseSpans(text)).toEqual([{ kind: "text", text }]);
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-33: a table cannot amplify a short file into millions of empty cells", () => {
  const source = "|x".repeat(500) + "\n" + "|---".repeat(500) + "\n" + "|a|b\n".repeat(500);
  expect(parseBlocks(source)).toEqual([{ kind: "code", lang: null, text: source }]);
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-33: malformed block delimiters and heading suffixes also have bounded work", () => {
  for (const source of ["# heading" + " ".repeat(40_000) + "x", "a|b\n|---|" + " ".repeat(40_000) + "x"]) {
    const started = performance.now();
    expect(parseBlocks(source).length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(250);
  }
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-33: unclosed FDX paragraphs finish within 250ms", () => {
  const xml = "<FinalDraft><Content>" + "<Paragraph>".repeat(40_000) + "</Content></FinalDraft>";
  const started = performance.now();
  expect(fdxToFountain(xml)).toBeNull();
  expect(performance.now() - started).toBeLessThan(250);
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-33: deeply nested notes retain their literal source instead of overflowing", () => {
  const source = Array.from({ length: 500 }, (_, i) => "  ".repeat(i) + "- item").join("\n");
  expect(parseBlocks(source)).toEqual([{ kind: "code", lang: null, text: source }]);
});
