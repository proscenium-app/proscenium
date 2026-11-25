// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pages after the script in the .docx, .odt and .rtf export: the model's
 * section for them, and what each writer makes of it. They follow the script
 * from a new page, each page from a page of its own, and carry no header,
 * footer or page number, as the pages before the script do.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { DOMParser, type Element } from "@xmldom/xmldom";
import { unzipSync } from "fflate";

import dgModernRaw from "../../formats/dg-modern.json";
import { parse } from "../fountain";
import { validateFormatSpec } from "../format/validate";
import type { FontFaces } from "./fonts";
import { buildDocument, writeScriptDocument } from "./index";
import type { WpInput, WpParagraph, WpSection } from "./model";

function ttf(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../pdf/fonts/${name}`, import.meta.url))),
  );
}

const FONTS: FontFaces = {
  regular: ttf("CourierPrime-Regular.ttf"),
  bold: ttf("CourierPrime-Bold.ttf"),
  italic: ttf("CourierPrime-Italic.ttf"),
  boldItalic: ttf("CourierPrime-BoldItalic.ttf"),
};

const DG = (() => {
  const v = validateFormatSpec(dgModernRaw);
  if (!v.ok) throw new Error(v.errors.join("\n"));
  return v.spec;
})();

/** A play with a title page and one page of script, which ends on "Morning." */
const PLAY = `Title: The Tide Table
Credit: a play by
Author: Jo Marlowe

# ACT ONE

## SCENE 1

A kitchen at dawn.

MARA
The pipe's been crying all night.

Morning.
`;

const BACK = [
  {
    id: "about",
    name: "About the Author",
    text: "## ABOUT THE AUTHOR\n\nShe writes by the *sea*.\n",
  },
  { id: "thanks", name: "Acknowledgments", text: "With thanks to the lighthouse.\n" },
];

/** A play of `scenes` scenes, each long enough that the script runs to several pages. */
function longPlay(scenes: number): string {
  let text = "Title: Long\n\n# ACT ONE\n\n";
  for (let s = 1; s <= scenes; s++) {
    text += `## SCENE ${s}\n\n`;
    for (let i = 0; i < 9; i++)
      text += `MARA\nLine ${s}.${i}, which runs on long enough to take two lines of the page at the format's width.\n\n`;
  }
  return text;
}

/** The play with the two pages in its Back Matter folder. */
function withBack(overrides: Partial<WpInput> = {}, text = PLAY, backPages = BACK): WpInput {
  const { doc, frontMatter } = parse(text);
  return {
    doc,
    spec: DG,
    meta: {
      title: frontMatter.title ?? "Untitled",
      author: frontMatter.authors?.join(", ") ?? "",
      frontMatter: { ...frontMatter, backPages },
    },
    language: "en-US",
    ...overrides,
  };
}

function xmlOf(parts: Record<string, Uint8Array>, path: string): Element {
  const part = parts[path];
  if (!part) throw new Error(`no ${path} in the package`);
  let failed = "";
  const root = new DOMParser({
    onError: (level, message) => {
      if (level !== "warning") failed = message;
    },
  }).parseFromString(new TextDecoder().decode(part), "application/xml").documentElement;
  if (failed || !root) throw new Error(`${path} is not well-formed: ${failed}`);
  return root as unknown as Element;
}

function all(node: Element, name: string): Element[] {
  return [...(node.getElementsByTagName(name) as unknown as Element[])];
}

function attr(node: Element | undefined, name: string): string {
  return node?.getAttribute(name) ?? "";
}

const paragraphsOf = (section: WpSection) =>
  section.items.flatMap((item) => (item.kind === "p" ? [item] : []));
const wordsOf = (p: WpParagraph) =>
  p.inlines.map((i) => (i.kind === "text" ? i.text : " ")).join("");

describe("the pages after the script", () => {
  it("follow the script from a new page, each page from a page of its own, with no header or footer", () => {
    const doc = buildDocument(withBack());
    expect(doc.sections.map((s) => s.kind)).toEqual(["front", "script", "back"]);
    const back = doc.sections[2];
    expect(back.begins).toBe("page");
    expect(back.header).toBeNull();
    expect(back.footer).toBeNull();
    expect(back.firstPageNumber).toBeUndefined();
    // The script before it still has its own.
    expect(doc.sections[1].header).not.toBeNull();
    const ps = paragraphsOf(back);
    expect(ps.map((p) => [p.style, wordsOf(p), !!p.pageBreakBefore])).toEqual([
      ["openingHeading", "ABOUT THE AUTHOR", false],
      ["openingText", "She writes by the sea.", false],
      ["openingText", "With thanks to the lighthouse.", true],
    ]);
    // Each page starts as far down its sheet as the engine put it, and the
    // writer's emphasis stays on its word.
    expect(ps[0].spaceBeforeRows ?? 0).toBe(DG.frontMatter.sectionTopRows);
    expect(ps[2].spaceBeforeRows ?? 0).toBe(DG.frontMatter.sectionTopRows);
    expect(JSON.stringify(ps[1])).toContain('"italic":true');
  });

  it("go only when their kind is chosen, with an excerpt as with the whole script", () => {
    expect(buildDocument(withBack({ frontSheets: [] })).sections.map((s) => s.kind)).toEqual([
      "script",
    ]);
    const one = buildDocument(withBack({ frontSheets: ["page:thanks"] }));
    expect(one.sections.map((s) => s.kind)).toEqual(["script", "back"]);
    expect(paragraphsOf(one.sections[1]).map(wordsOf)).toEqual(["With thanks to the lighthouse."]);
    const excerpt = buildDocument(
      withBack({ pages: [1, 3], frontSheets: ["page:about"] }, longPlay(4)),
    );
    expect(excerpt.sections.map((s) => s.kind)).toEqual(["script", "script", "back"]);
    // A play with none is the document it was.
    expect(buildDocument(withBack({}, PLAY, [])).sections.map((s) => s.kind)).toEqual([
      "front",
      "script",
    ]);
  });

  it("a .docx names an empty header for them, so the script's page number does not run on", () => {
    const docx = unzipSync(
      writeScriptDocument("docx", withBack({ frontSheets: ["page:about"] }), FONTS),
    );
    const sects = all(xmlOf(docx, "word/document.xml"), "w:sectPr");
    expect(sects).toHaveLength(2);
    const last = sects[sects.length - 1];
    expect(attr(all(last, "w:type")[0], "w:val")).toBe("nextPage");
    expect(all(last, "w:pgNumType")).toHaveLength(0);
    expect(all(last, "w:titlePg")).toHaveLength(0);
    const rels = Object.fromEntries(
      all(xmlOf(docx, "word/_rels/document.xml.rels"), "Relationship").map((r) => [
        attr(r, "Id"),
        attr(r, "Target"),
      ]),
    );
    const partOf = (ref: Element) => `word/${rels[attr(ref, "r:id")]}`;
    const refs = all(last, "w:headerReference");
    expect(refs.map((r) => attr(r, "w:type"))).toEqual(["default"]);
    expect(new TextDecoder().decode(docx[partOf(refs[0])])).not.toContain("PAGE");
    expect(all(xmlOf(docx, partOf(refs[0])), "w:t")).toHaveLength(0);
    // The script's own section still prints its page number.
    const numbered = all(sects[0], "w:headerReference").find(
      (r) => attr(r, "w:type") === "default",
    )!;
    expect(new TextDecoder().decode(docx[partOf(numbered)])).toContain('w:instr=" PAGE "');
    // Its words are in the body, after the script's.
    const body = new TextDecoder().decode(docx["word/document.xml"]);
    expect(body.indexOf("ABOUT THE AUTHOR")).toBeGreaterThan(body.indexOf("Morning."));
  });

  it("an .odt gives them a master page of their own, with no header or footer", () => {
    const odt = unzipSync(
      writeScriptDocument("odt", withBack({ frontSheets: ["page:about"] }), FONTS),
    );
    const masters = Object.fromEntries(
      all(xmlOf(odt, "styles.xml"), "style:master-page").map((m) => [attr(m, "style:name"), m]),
    );
    expect(attr(masters.Back, "style:display-name")).toBe("Closing Pages");
    expect(all(masters.Back, "style:header")).toHaveLength(0);
    expect(all(masters.Back, "style:footer")).toHaveLength(0);
    expect(all(masters.Script, "text:page-number")).toHaveLength(1);
    const content = xmlOf(odt, "content.xml");
    const opens = all(content, "style:style").filter(
      (style) => attr(style, "style:master-page-name") === "Back",
    );
    expect(opens).toHaveLength(1);
    const first = [...all(content, "text:p"), ...all(content, "text:h")].filter(
      (p) => attr(p, "text:style-name") === attr(opens[0], "style:name"),
    );
    expect(first.map((p) => p.textContent)).toEqual(["ABOUT THE AUTHOR"]);
    // A play with none has no such master page.
    const plain = unzipSync(writeScriptDocument("odt", withBack({}, PLAY, []), FONTS));
    expect(
      all(xmlOf(plain, "styles.xml"), "style:master-page").map((m) => attr(m, "style:name")),
    ).not.toContain("Back");
  });

  it("an .rtf starts them a new section on a new page, under an empty header", () => {
    const file = new TextDecoder().decode(
      writeScriptDocument("rtf", withBack({ frontSheets: ["page:about"] }), null),
    );
    const sections = file.split("\\sectd").slice(1);
    expect(sections).toHaveLength(2);
    expect(sections[1].startsWith("\\sbkpage")).toBe(true);
    expect(sections[1]).not.toContain("\\pgnrestart");
    const header = /\{\\header[^{}]*\}/.exec(sections[1])?.[0] ?? "";
    expect(header).not.toBe("");
    expect(header).not.toContain("PAGE");
    // The script's own header still holds the page-number field.
    expect(sections[0]).toContain("\\fldinst  PAGE ");
    expect(sections[1]).not.toContain("\\fldinst");
    expect(sections[1]).toContain("ABOUT THE AUTHOR");
    expect(sections[0]).not.toContain("ABOUT THE AUTHOR");
  });
});
