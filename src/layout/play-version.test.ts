// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A play's version (docs/app/formatting/formats-and-layout.md#FMT-185): a
 * detail of the play kept in the script's title page as `Version:`, printed in
 * the title page's foot and, as the play file says
 * (docs/app/keeping-work/storage-and-file-format.md#STOR-196), in the page
 * header or footer.
 */
import { describe, expect, it } from "bun:test";
import { parse, serialize } from "../fountain";
import type { FrontMatter } from "../fountain";
import { loadFormatRegistry, type FormatSpec } from "../format";
import { DETAILS, DETAIL_OF, detailValue } from "../app/play-details";
import { validPlayShape } from "../workspace/play-file";
import { FIELD_MENU } from "../markdown/page-fields";
import { blocksFromDoc, layoutFrontPages, paginate } from "./engine";
import {
  defaultVersionPrint,
  fillSlot,
  slotValues,
  START_POSITION,
  withVersionPrint,
} from "./furniture";
import {
  TITLE_PAGE_FILE,
  fieldValue,
  frontPagesFor,
  legacyBlockAt,
  legacyPageFiles,
  showsVersion,
  titlePageOf,
  withVersionLine,
} from "./page-files";

const registry = await loadFormatRegistry();
const dg = registry.get("dg-modern")!;
const us = registry.get("stage-us-modern")!;
const uk = registry.get("stage-uk")!;
const sketch = registry.get("sketch-comedy")!;

const SCRIPT = [
  "Title: The Weight of Water",
  "Author: A. Playwright",
  "Draft date: 26 November 2026",
  "Version: Draft 3",
  "Contact:",
  "    1 Main Street",
  "",
  "# ACT ONE",
  "",
  "MARA",
  "Hello.",
  "",
  "===",
  "",
  "JONAH",
  "Hello again.",
  "",
].join("\n");

const printed = (fm: FrontMatter, spec = dg) =>
  layoutFrontPages(frontPagesFor(fm, spec.frontMatter), spec)[0]?.lines ?? [];
const asFile = (fm: FrontMatter, text = withVersionLine(TITLE_PAGE_FILE)!) => ({
  ...fm,
  pages: [{ id: "t", name: "Title Page", text }],
});

/** Each numbered page's header and footer, as the paginator resolves them. */
function furniture(spec: FormatSpec, fm: FrontMatter) {
  const { doc } = parse(SCRIPT);
  return paginate(blocksFromDoc(doc, spec), spec, { frontMatter: fm, title: fm.title }).pages.map(
    (p) => ({ header: p.header, footer: p.footer }),
  );
}

describe("a play's version", () => {
  it("is read from the title page's Version key and written back after the draft date", () => {
    const parsed = parse(SCRIPT);
    expect(parsed.frontMatter.version).toBe("Draft 3");
    const out = serialize(parsed);
    expect(out.indexOf("Draft date:")).toBeLessThan(out.indexOf("Version: Draft 3"));
    expect(parse(out).frontMatter.version).toBe("Draft 3");
    const none = parse(SCRIPT.replace("Version: Draft 3\n", ""));
    expect(none.frontMatter.version).toBeUndefined();
    expect(serialize(none)).not.toContain("Version");
  });

  it("is a detail a field writes and Insert Field offers", () => {
    const fm = parse(SCRIPT).frontMatter;
    expect(DETAILS).toContain("version");
    expect(DETAIL_OF.version).toBe("version");
    expect(FIELD_MENU).toContain("version");
    expect(fieldValue("version", fm)).toBe("Draft 3");
    expect(detailValue("version", "  ")).toBeUndefined();
    expect(legacyBlockAt("title", "version", fm)).toBe(7);
  });

  it("prints under the draft date, on a title page from the keys and on one that is a file", () => {
    const fm = parse(SCRIPT).frontMatter;
    const fromKeys = printed(fm);
    const texts = fromKeys.map((l) => l.text);
    expect(texts.slice(-3)).toEqual(["1 Main Street", "26 November 2026", "Draft 3"]);
    const file = printed(asFile(fm));
    expect(file.map((l) => l.text)).toEqual(texts);
    expect(file.map((l) => l.row)).toEqual(fromKeys.map((l) => l.row));
    // The draft date and the version stand the format's gap apart.
    const date = fromKeys.find((l) => l.text === "26 November 2026")!;
    const version = fromKeys.find((l) => l.text === "Draft 3")!;
    expect(version.row - date.row).toBe(dg.frontMatter.fieldGapRows + 1);
    // Its pages become files with the version still on the title page.
    expect(showsVersion(legacyPageFiles(fm)[0]!.text)).toBe(true);
  });

  it("prints nothing, and takes no room, without one", () => {
    const { version: _none, ...fm } = parse(SCRIPT).frontMatter;
    const without = printed(fm);
    expect(without.map((l) => l.text)).not.toContain("Draft 3");
    expect(printed(asFile(fm)).map((l) => l.row)).toEqual(without.map((l) => l.row));
    expect(legacyPageFiles(fm)[0]?.text).toBe(TITLE_PAGE_FILE);
  });

  it("stands in an opening that runs in with the first numbered page", () => {
    const { doc, frontMatter } = parse(SCRIPT);
    const page = paginate(blocksFromDoc(doc, sketch), sketch, { frontMatter }).pages[0]!;
    expect((page.intro ?? []).map((l) => l.text)).toContain("Draft 3");
  });
});

describe("a Version line added to a title page's file", () => {
  it("goes under the draft date's paragraph, once", () => {
    const next = withVersionLine(TITLE_PAGE_FILE)!;
    expect(next.endsWith("{draftDate}\n\n{version}\n")).toBe(true);
    expect(showsVersion(next)).toBe(true);
    expect(withVersionLine(next)).toBeNull();
    const moved = TITLE_PAGE_FILE.replace("{draftDate}", "{draftDate}\n\n<!-- proscenium:line -->");
    expect(withVersionLine(moved)).toContain(
      "{draftDate}\n\n{version}\n\n<!-- proscenium:line -->",
    );
  });

  it("goes at the end of a page that shows no draft date", () => {
    const page = "---\nlayout: title\n---\n\n# {TITLE}\n";
    expect(withVersionLine(page)).toBe("---\nlayout: title\n---\n\n# {TITLE}\n\n{version}\n");
  });

  it("finds the play's title page among its files", () => {
    const pages = [
      { id: "c", name: "Characters", text: "## CHARACTERS\n" },
      { id: "t", name: "Title Page", text: TITLE_PAGE_FILE },
    ];
    expect(titlePageOf(pages)?.id).toBe("t");
    expect(titlePageOf(pages.slice(0, 1))).toBeUndefined();
    expect(titlePageOf(undefined)).toBeUndefined();
  });
});

describe("the version in a header or footer", () => {
  const fm = parse(SCRIPT).frontMatter;

  it("goes to the header's first empty side when the play has not said", () => {
    expect(defaultVersionPrint(dg)).toEqual({ in: "header", side: "left" });
    expect(defaultVersionPrint(uk)).toEqual({ in: "header", side: "left" });
    const pages = furniture(withVersionPrint(dg, null, fm.version), fm);
    // dg-modern leaves page 1's header off, and the version with it.
    expect(pages[0]!.header).toBeNull();
    expect(pages[1]!.header).toEqual({ left: "Draft 3", right: "2." });
  });

  it("prints in the band and on the side chosen, and nowhere else", () => {
    const spec = withVersionPrint(us, { in: "footer", side: "right" }, fm.version);
    for (const page of furniture(spec, fm)) {
      expect(page.footer?.right).toBe("Draft 3");
      expect(JSON.stringify(page.header)).not.toContain("Draft 3");
    }
    const center = withVersionPrint(us, { in: "header", side: "center" }, fm.version);
    expect(furniture(center, fm)[0]!.header).toEqual({ center: "Draft 3", right: "1." });
  });

  it("comes before what a filled slot prints", () => {
    const spec = withVersionPrint(dg, { in: "header", side: "right" }, fm.version);
    expect(furniture(spec, fm)[1]!.header).toEqual({ right: "Draft 3  2." });
    const footer = withVersionPrint(uk, { in: "footer", side: "center" }, fm.version);
    expect(furniture(footer, fm)[0]!.footer).toEqual({ center: "Draft 3  -1-" });
  });

  it("prints nowhere with Title Page Only, or with no version", () => {
    expect(withVersionPrint(dg, { in: "none" }, fm.version)).toBe(dg);
    expect(withVersionPrint(dg, { in: "header", side: "left" }, undefined)).toBe(dg);
    expect(withVersionPrint(dg, { in: "header", side: "left" }, "  ")).toBe(dg);
  });

  it("is not added again where the format prints it itself", () => {
    const own: FormatSpec = { ...us, footer: { ...us.footer, content: { left: "{version}" } } };
    expect(withVersionPrint(own, { in: "header", side: "left" }, fm.version)).toBe(own);
  });

  it("is a token that prints on one line, and takes its separator when empty", () => {
    const values = (version?: string) => slotValues({ pageNumber: 4, at: START_POSITION, version });
    expect(fillSlot("{version} - {page}", values("Rev.\n11/26"))).toBe("Rev. 11/26 - 4");
    expect(fillSlot("{version} - {page}", values())).toBe("4");
  });
});

describe("where the version prints, in the play file (docs/app/keeping-work/storage-and-file-format.md#STOR-196)", () => {
  const withPrint = (versionPrint: unknown): unknown => ({
    kind: "proscenium/play",
    id: "p1",
    schemaVersion: 1,
    created: "2026-11-26T00:00:00Z",
    modified: "2026-11-26T00:00:00Z",
    generator: { app: "Proscenium", version: "1.1.1" },
    settings: {},
    scripts: { s1: { scenes: [], orphans: [], versionPrint } },
    binder: [],
  });

  it("is nowhere else, or a band and a side", () => {
    expect(validPlayShape(withPrint(undefined))).toBe(true);
    expect(validPlayShape(withPrint({ in: "none" }))).toBe(true);
    expect(validPlayShape(withPrint({ in: "header", side: "left" }))).toBe(true);
    expect(validPlayShape(withPrint({ in: "footer", side: "right" }))).toBe(true);
  });

  it("refuses anything else", () => {
    for (const bad of [
      "header",
      { in: "header" },
      { in: "footer", side: "top" },
      { in: "margin", side: "left" },
      { in: "none", side: "left" },
      { in: "header", side: "left", extra: 1 },
      ["header", "left"],
    ]) {
      expect([bad, validPlayShape(withPrint(bad))]).toEqual([bad, false]);
    }
  });
});
