// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import nspell from "nspell";
import { FormatRegistry } from "./registry";
import { paginateDoc, paginateFrontMatter } from "../layout";
import type { BlockNode, Doc } from "../fountain/model";
import { canonicalLanguage, spellingLanguage } from "../workspace/language";

const registry = FormatRegistry.withBuiltins();
const block = (type: BlockNode["type"], text: string, dual = false): BlockNode => ({
  type,
  content: [{ type: "text", text }],
  ...(dual ? { attrs: { dual: true } } : {}),
});
const doc = (...content: BlockNode[]): Doc => ({ type: "doc", content });

test("Guild samples use a 14.4-point pitch and Modern has upright block directions", () => {
  for (const id of ["dg-modern", "dg-traditional", "dg-musical"]) {
    const spec = registry.get(id)!;
    expect(spec.type.size * spec.type.lineHeight).toBeCloseTo(14.4);
  }
  expect(registry.get("dg-modern")!.elements.action.fontStyle).toBe("regular");
  expect(registry.get("dg-musical")!.elements.lyric.indentFromMargin).toBe(0.4);
});

test("House makes cues scannable and distinguishes readable directions from speech", () => {
  const spec = registry.get("stage-us-modern")!;
  const play = doc(
    block("character", "A"),
    block("dialogue", "Hello."),
    block("action", "A long direction. ".repeat(30)),
    block("character", "A MUCH LONGER NAME"),
    block("dialogue", "Goodbye."),
  );
  const layout = paginateDoc(play, spec);
  const cues = layout.pages
    .flatMap((page) => page.lines)
    .filter((line) => line.type === "character");
  expect(cues[0].xIn).toBe(cues[1].xIn);
  expect(spec.elements.character.fontStyle).toBe("bold");
  expect(spec.elements.action.fontStyle).toBe("italic");
  expect(spec.elements.action.parenWrap).toBe(false);
  expect(layout.maxRows).toBe(45);
  expect(layout.pages[0].header?.right).toBe("1.");
});

test("BBC columns share a baseline, include punctuation and keep each scene on a new sheet", () => {
  const spec = registry.get("stage-uk")!;
  const play = doc(
    block("act", "ACT I"),
    block("scene", "SCENE 1"),
    block("action", "An empty room."),
    block("character", "NELL"),
    block("dialogue", "Colour and honour."),
    block("scene", "SCENE 2"),
    block("dialogue", "Next."),
  );
  const original = JSON.stringify(play);
  const { pages } = paginateDoc(play, spec);
  expect(pages).toHaveLength(2);
  const [act, scene, action, cue, dialogue] = pages[0].lines;
  expect(act.row).toBe(scene.row);
  expect(cue.row).toBe(dialogue.row);
  expect(cue.text).toBe("NELL:");
  expect(cue.xIn + spec.page.margins.left).toBe(1);
  expect(dialogue.xIn + spec.page.margins.left).toBe(2.5);
  expect(action.text).toBe("AN EMPTY ROOM.");
  expect(pages[0].footer?.center).toBe("-1-");
  expect(pages[1].footer?.center).toBe("-2-");
  expect(pages[1].lines[0].xIn).toBe(0);
  expect(JSON.stringify(play)).toBe(original);
});

test("BBC short parentheticals run into dialogue while long directions retain a paragraph", () => {
  const spec = registry.get("stage-uk")!;
  const { pages } = paginateDoc(
    doc(
      block("character", "NELL"),
      block("parenthetical", "pause"),
      block("dialogue", "A thought follows. ".repeat(90)),
    ),
    spec,
  );
  const [cue, direction, speech] = pages[0].lines;
  expect(cue.row).toBe(direction.row);
  expect(direction.row).toBe(speech.row);
  expect(direction.text).toBe("(PAUSE)");
  expect(speech.xIn).toBeGreaterThan(direction.xIn);
  expect(
    pages[0].lines.find((line) => line.type === "dialogue" && line.row > speech.row)!.xIn,
  ).toBe(1.5);
  expect(
    pages
      .flatMap((p) => p.lines)
      .filter((line) => line.type === "dialogue")
      .map((l) => l.text)
      .join(""),
  ).toBe("A thought follows. ".repeat(90));
  const long = paginateDoc(
    doc(
      block("character", "NELL"),
      block("parenthetical", "She looks at the door. ".repeat(6)),
      block("dialogue", "Hello."),
    ),
    spec,
  ).pages[0].lines;
  const directions = long.filter((l) => l.type === "parenthetical");
  expect(long[long.length - 1].row).toBeGreaterThan(directions[directions.length - 1].row);
});

test("a BBC speech crosses sheets without losing words or inventing a cue", () => {
  const spec = registry.get("stage-uk")!;
  const words = "A long speech keeps going. ".repeat(500);
  const { pages, maxRows } = paginateDoc(
    doc(block("character", "A VERY LONG CHARACTER NAME"), block("dialogue", words)),
    spec,
  );
  expect(pages.length).toBeGreaterThan(2);
  expect(
    pages
      .flatMap((p) => p.lines)
      .filter((l) => l.type === "dialogue")
      .map((l) => l.text)
      .join(""),
  ).toBe(words);
  for (const page of pages) {
    expect(page.usedRows).toBeLessThanOrEqual(maxRows);
    expect(page.lines.every((line) => line.row < maxRows)).toBe(true);
    expect(page.breakBefore?.contd ?? null).toBeNull();
  }
});

test("DG traditional uses parenthesized roman directions; musical preserves stanzas and duets", () => {
  const traditional = registry.get("dg-traditional")!;
  const action = paginateDoc(doc(block("action", "She opens the door.")), traditional).pages[0]
    .lines[0];
  expect(action.text).toBe("(She opens the door.)");
  expect(action.xIn + traditional.page.margins.left).toBe(3);
  expect(traditional.elements.action.fontStyle).toBe("regular");
  const musical = registry.get("dg-musical")!;
  const play = doc(
    block("character", "NELL"),
    block("lyric", "First line\nSecond line"),
    block("lyric", "Next stanza"),
    block("character", "DEV", true),
    block("lyric", "Counterpoint"),
  );
  const lines = paginateDoc(play, musical).pages[0].lines;
  const left = lines.find((l) => l.text === "NELL")!,
    right = lines.find((l) => l.text === "DEV")!;
  expect(left.row).toBe(right.row);
  expect(right.xIn).toBeGreaterThan(left.xIn);
  const second = lines.find((l) => l.text === "SECOND LINE")!,
    stanza = lines.find((l) => l.text === "NEXT STANZA")!;
  expect(stanza.row - second.row).toBe(2);
});

test("Samuel French manuscript puts scenes on new pages, underlines them and aligns title contact right", () => {
  const spec = registry.get("samuel-french")!;
  const lines = paginateDoc(
    doc(block("scene", "Scene 1"), block("dialogue", "Hello."), block("scene", "Scene 2")),
    spec,
  ).pages;
  expect(lines).toHaveLength(2);
  expect(lines[0].lines[0].runs.some((run) => run.underline)).toBe(true);
  const title = paginateFrontMatter({ title: "The Room", contact: ["The author"] }, spec)[0];
  expect(title.lines.find((line) => line.paragraphId === "contact-0")!.xIn).toBeGreaterThan(0);
  expect(
    paginateDoc(
      doc(block("act", "ACT I"), block("scene", "Scene 1"), block("dialogue", "Hello.")),
      spec,
    ).pages,
  ).toHaveLength(1);
  const long = paginateDoc(
    doc(block("character", "NELL"), block("dialogue", "A continuing speech. ".repeat(300))),
    spec,
  );
  expect(long.pages[1].lines[0].text).toBe("NELL (Cont.)");
});

test("language selection uses only a matching bundled dictionary", () => {
  expect(canonicalLanguage("en-gb")).toBe("en-GB");
  for (const value of ["en", "en-US", "en-US-u-hc-h12"])
    expect(spellingLanguage(value)).toBe("en-US");
  for (const value of ["en-GB", "en-gb", "en-GB-u-hc-h12"])
    expect(spellingLanguage(value)).toBe("en-GB");
  for (const value of ["fr", "en-AU", "fr-CA", "en_US", ""])
    expect(spellingLanguage(value)).toBeNull();
});

test("the shipped British and American dictionaries disagree on regional spellings", () => {
  const load = (prefix: string) =>
    nspell(
      readFileSync(`dictionaries/${prefix}.aff`, "utf8"),
      readFileSync(`dictionaries/${prefix}.dic`, "utf8"),
    );
  const us = load("en"),
    gb = load("en-GB");
  for (const [british, american] of [
    ["colour", "color"],
    ["honour", "honor"],
    ["centre", "center"],
  ]) {
    expect(gb.correct(british)).toBe(true);
    expect(gb.correct(american)).toBe(false);
    expect(us.correct(american)).toBe(true);
    expect(us.correct(british)).toBe(false);
  }
});
