// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A page that holds only what its template put there is a page not yet
 * written, and prints nothing (docs/app/formatting/formats-and-layout.md#FMT-183):
 * the Characters page a play begun blank starts with, and any page added from
 * a template until a word is written on it. A heading the writer gave a page
 * prints, as does a title page's own title.
 */
import { describe, expect, it } from "bun:test";
import { builtinFormats } from "../format";
import { toDoc } from "../markdown/doc";
import { layoutFrontPages } from "./engine";
import { backPagesAsFountain, pagesAsFountain } from "./fountain-with-pages";
import {
  CHARACTERS_PAGE_FILE,
  TITLE_PAGE_FILE,
  backPagesFor,
  frontPagesFor,
  writePageFile,
} from "./page-files";
import { SCAFFOLDS, scaffoldById } from "./scaffolds";
import { TEMPLATE_HEADINGS, isTemplateHeading } from "./template-headings";

const dg = builtinFormats().find((spec) => spec.id === "dg-modern")!;
const NOBODY = { speakers: [] };

const printed = (text: string, fm: object = { title: "Hay Fever" }) =>
  layoutFrontPages(
    frontPagesFor({ ...fm, pages: [{ id: "p", name: "Page", text }] }, dg.frontMatter),
    dg,
  ).flatMap((sheet) => sheet.lines.map((line) => line.text));

describe("a page with nothing written on it yet", () => {
  it("knows every heading a template writes, and no other", () => {
    const written = new Set<string>();
    for (const scaffold of SCAFFOLDS.filter((each) => each.id !== "title-page"))
      for (const node of toDoc(scaffold.text(NOBODY).replace(/^---\n[\s\S]*?\n---\n/, ""))
        .content ?? [])
        if (node.type === "heading")
          written.add((node.content ?? []).map((n) => n.text ?? "").join(""));
    expect([...written].sort()).toEqual([...TEMPLATE_HEADINGS].sort());
    expect(isTemplateHeading(" characters ")).toBe(true);
    expect(isTemplateHeading("PART ONE")).toBe(false);
  });

  it("is the Characters page a play begun blank starts with, as its template writes it", () => {
    expect(CHARACTERS_PAGE_FILE).toBe(scaffoldById("characters")!.text(NOBODY));
    expect(printed(CHARACTERS_PAGE_FILE)).toEqual([]);
  });

  it("prints nothing from any template until a word is written on it", () => {
    for (const scaffold of SCAFFOLDS) {
      if (scaffold.id === "title-page") continue;
      expect([scaffold.id, printed(scaffold.text(NOBODY))]).toEqual([scaffold.id, []]);
    }
    // After the script too.
    const back = layoutFrontPages(
      backPagesFor(
        {
          backPages: [{ id: "b", name: "Glossary", text: scaffoldById("glossary")!.text(NOBODY) }],
        },
        dg.frontMatter,
      ),
      dg,
    );
    expect(back).toEqual([]);
  });

  it("prints its heading with the first word written under it", () => {
    expect(printed(`${CHARACTERS_PAGE_FILE}\n**SOREL**\n`)).toEqual(["CHARACTERS", "SOREL"]);
    // A blank row under the heading is still nothing written.
    expect(printed(`${CHARACTERS_PAGE_FILE}\n<!-- proscenium:line -->\n`)).toEqual([]);
  });

  it("prints a heading the writer gave a page, and a title page's title", () => {
    expect(printed(writePageFile({ layout: "top" }, "## PART ONE"))).toEqual(["PART ONE"]);
    expect(printed(TITLE_PAGE_FILE)).toEqual(["HAY FEVER"]);
    // A title page whose title is a template's word is still a title page.
    expect(printed(TITLE_PAGE_FILE, { title: "Characters" })).toEqual(["CHARACTERS"]);
  });

  it("goes to no Fountain file", () => {
    const page = { id: "c", name: "Characters", text: CHARACTERS_PAGE_FILE };
    expect(pagesAsFountain([page], {})).toBe("");
    const glossary = { id: "g", name: "Glossary", text: scaffoldById("glossary")!.text(NOBODY) };
    expect(backPagesAsFountain([glossary], {})).toBe("");
  });
});
