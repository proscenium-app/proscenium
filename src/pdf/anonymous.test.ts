// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PDFDocument } from "pdf-lib";

import dgModernRaw from "../../formats/dg-modern.json";
import type { Doc, FrontMatter } from "../fountain/model";
import type { FormatSpec } from "../format/spec";
import { validateFormatSpec } from "../format/validate";
import { paginateDoc, paginateFrontMatter, type LayoutMeta } from "../layout";
import {
  anonymousFrontMatter,
  anonymousMeta,
  identityOf,
  sheetList,
  sheetsNaming,
} from "./anonymous";
import { planSheets } from "./plan";
import { renderPdf, type PdfFontBytes } from "./render";

const font = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fonts/${name}`, import.meta.url))));
const FONTS: PdfFontBytes = {
  regular: font("CourierPrime-Regular.ttf"),
  bold: font("CourierPrime-Bold.ttf"),
  italic: font("CourierPrime-Italic.ttf"),
  boldItalic: font("CourierPrime-BoldItalic.ttf"),
};

function spec(header?: unknown): FormatSpec {
  const raw = structuredClone(dgModernRaw) as Record<string, unknown>;
  if (header) raw.header = header;
  const v = validateFormatSpec(raw);
  if (!v.ok) throw new Error(v.errors.join("\n"));
  return v.spec;
}

const FM: FrontMatter = {
  title: "Harbour Lights",
  credit: "Written by",
  authors: ["Jo Marlowe"],
  draftDate: "Draft 4",
  contact: ["jo@example.com", "", "555 0100"],
  characters: [{ name: "SOPHIE", description: "the daughter" }],
};
const META: LayoutMeta = { title: FM.title, author: "Jo Marlowe", frontMatter: FM };

const play = (...lines: string[]): Doc => ({
  type: "doc",
  content: lines.map((text) => ({ type: "action", content: [{ type: "text", text }] })),
});

const printed = (fm: FrontMatter | null, s = spec()) =>
  paginateFrontMatter(fm, s).flatMap((page) => page.lines.map((line) => line.text));

describe("an anonymous copy (docs/app/formatting/formats-and-layout.md#FMT-143)", () => {
  it("prints the title page without byline, authors or contact details", () => {
    expect(printed(FM)).toEqual(
      expect.arrayContaining(["Written by", "Jo Marlowe", "jo@example.com"]),
    );
    const lines = printed(anonymousFrontMatter(FM, "fallback"));
    expect(lines).toContain("HARBOUR LIGHTS");
    expect(lines).toContain("Draft 4");
    expect(lines.join(" ")).not.toMatch(/Written by|Marlowe|example\.com|555/);
    // The cast is the play's, not the writer's.
    expect(lines.some((line) => line.startsWith("SOPHIE"))).toBe(true);
  });

  it("replaces a title page written as prose with the title alone", () => {
    const prose = {
      ...FM,
      title: undefined,
      titlePage: "**The Weight of Water**\n\nby Jo Marlowe",
    };
    const lines = printed(anonymousFrontMatter(prose, "The Weight of Water"));
    expect(lines).toContain("THE WEIGHT OF WATER");
    expect(lines.join(" ")).not.toContain("Marlowe");
  });

  it("leaves the author out of headers and the file's properties", async () => {
    const s = spec({
      content: { left: "{author}", right: "{page}." },
      position: 0.85,
      suppressOnFirstPage: false,
    });
    const meta = anonymousMeta(META, "fallback");
    const layout = paginateDoc(play("A kitchen."), s, meta);
    expect(layout.pages[0].header).toEqual({ right: "1." });

    const withName = await PDFDocument.load(
      await renderPdf({
        layout: paginateDoc(play("A kitchen."), s, META),
        spec: s,
        meta: META,
        fonts: FONTS,
      }),
    );
    expect(withName.getAuthor()).toBe("Jo Marlowe");
    const without = await PDFDocument.load(
      await renderPdf({ layout, spec: s, meta, frontMatter: meta.frontMatter, fonts: FONTS }),
    );
    expect(without.getAuthor()).toBeUndefined();
    expect(without.getTitle()).toBe("Harbour Lights");
  });
});

describe("finding the name the copy could not remove (docs/app/formatting/formats-and-layout.md#FMT-144)", () => {
  it("knows the authors and contact lines, and nothing shorter than a name", () => {
    expect(identityOf({ ...FM, authors: ["Jo Marlowe", "Al"] })).toEqual([
      "jo marlowe",
      "jo@example.com",
      "555 0100",
    ]);
    expect(identityOf(null)).toEqual([]);
  });

  it("names the sheets that still carry the writer, wrapped lines included", () => {
    const s = spec();
    const meta = anonymousMeta(META, "fallback");
    const layout = paginateDoc(
      play("Lights up.", "For my mother, from Jo\nMarlowe.", "Write to JO@EXAMPLE.COM."),
      s,
      meta,
    );
    const plan = planSheets({
      front: paginateFrontMatter(meta.frontMatter, s),
      layout,
      frontKinds: ["title", "characters"],
      pages: [1],
    });
    expect(sheetsNaming(plan.chosen, identityOf(FM))).toEqual(["Page 1"]);
    expect(sheetsNaming(plan.chosen, [])).toEqual([]);
  });

  it("lists them the way a sentence would", () => {
    expect(sheetList(["Page 12"])).toBe("page 12");
    expect(sheetList(["Characters page", "Page 12"])).toBe("the characters page and page 12");
    expect(sheetList(["Page 1", "Page 2", "Page 3", "Page 4", "Page 9"])).toBe(
      "page 1, page 2, page 3 and 2 more",
    );
  });
});
