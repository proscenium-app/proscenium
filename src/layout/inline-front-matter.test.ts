// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import {
  FormatRegistry,
  charAdvanceIn,
  textBlockWidthIn,
  formatFileObject,
  validateFormatSpec,
} from "../format";
import { parse, serialize } from "../fountain";
import { paginateDoc, paginateFrontMatter } from "./engine";
import { countPages } from "../workspace/play-pages";

const sketch = FormatRegistry.withBuiltins().get("sketch-comedy")!;
const play = parse(
  "Title: The Queue\nAuthor: A. Writer\nDraft date: September 2026\nCharacters: NELL, DEV\nSetting: A ticket office.\n\n@NELL\nNext, please.\n\n@DEV\nI was next yesterday.\n\n> LIGHTS OUT\n",
);

test("the sketch opening and dialogue share numbered page one without modifying the source", () => {
  const before = JSON.stringify(play);
  const layout = paginateDoc(play.doc, sketch, { frontMatter: play.frontMatter });
  expect(paginateFrontMatter(play.frontMatter, sketch)).toEqual([]);
  expect(layout.pages).toHaveLength(1);
  const page = layout.pages[0];
  expect(page.header?.right).toBe("1");
  expect(page.intro?.map((line) => line.text)).toEqual([
    "THE QUEUE",
    "by A. Writer",
    "September 2026",
    "Characters: NELL, DEV",
    "Setting: A ticket office.",
  ]);
  expect(page.lines[0].text).toBe("NELL");
  expect(page.lines[0].row).toBe(page.intro![page.intro!.length - 1].row + 2);
  expect(page.lines[0].xIn + sketch.page.margins.left).toBe(3.5);
  expect(page.lines[1].xIn + sketch.page.margins.left).toBe(2.5);
  expect(JSON.stringify(play)).toBe(before);
});

test("large opening metadata wraps and continues; body and count cache use the same remaining space", () => {
  const frontMatter = {
    ...play.frontMatter,
    setting: "Waiting room. ".repeat(600),
    contact: ["CONTACT-END"],
    characters: [{ name: "NELL", description: "First in the queue." }],
  };
  const layout = paginateDoc(play.doc, sketch, { frontMatter });
  expect(layout.pages.length).toBeGreaterThan(2);
  for (const page of layout.pages) {
    expect(page.usedRows).toBeLessThanOrEqual(layout.maxRows);
    let previous = -1;
    for (const line of [...(page.intro ?? []), ...page.lines]) {
      expect(line.row).toBeGreaterThan(previous);
      expect(line.row).toBeLessThan(layout.maxRows);
      expect(line.xIn + line.text.trimEnd().length * charAdvanceIn(sketch)).toBeLessThanOrEqual(
        textBlockWidthIn(sketch) + 1e-9,
      );
      previous = line.row;
    }
  }
  const intro = layout.pages.flatMap((page) => page.intro ?? []);
  expect(intro.some((line) => line.text === "CONTACT-END")).toBe(true);
  expect(
    intro
      .filter((line) => line.paragraphId === "Setting")
      .map((line) => line.text)
      .join(" ")
      .trim(),
  ).toBe(`Setting: ${frontMatter.setting.trim()}`);
  expect(layout.pages.flatMap((page) => page.lines).map((line) => line.text)).toEqual(
    paginateDoc(play.doc, sketch)
      .pages.flatMap((page) => page.lines)
      .map((line) => line.text),
  );
  expect(countPages(serialize({ doc: play.doc, frontMatter }), sketch)).toBe(layout.pages.length);
});

test("an opening that fills its page moves the first cue with its speech", () => {
  const spec = structuredClone(sketch);
  spec.frontMatter.inlineGapRows = 100;
  const layout = paginateDoc(play.doc, spec, { frontMatter: play.frontMatter });
  expect(layout.pages).toHaveLength(2);
  expect(layout.pages[0].lines).toEqual([]);
  expect(layout.pages[1].intro).toBeUndefined();
  expect(layout.pages[1].lines[0].text).toBe("NELL");
  expect(layout.pages[1].lines[0].row).toBe(0);
  expect(layout.pages[1].lines[1].text).toBe("Next, please.");
});

test("opening placement survives a custom format round trip and rejects bad settings", () => {
  const roundtrip = validateFormatSpec(formatFileObject(sketch));
  expect(roundtrip.ok && roundtrip.spec.frontMatter).toEqual(sketch.frontMatter);
  for (const frontMatter of [{ placement: "sideways" }, { inlineGapRows: -1 }]) {
    expect(validateFormatSpec({ ...formatFileObject(sketch), frontMatter }).ok).toBe(false);
  }
});
