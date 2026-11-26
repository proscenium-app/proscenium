// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A play's subtitle (docs/app/formatting/formats-and-layout.md#FMT-181): a
 * detail of the play kept in the script's title page as `Subtitle:`, with a
 * line of its own under the title that prints only when it has words.
 */
import { describe, expect, it } from "bun:test";
import { parse, serialize } from "../fountain";
import type { FrontMatter } from "../fountain";
import { loadFormatRegistry } from "../format";
import { DETAILS, DETAIL_OF, detailText, detailValue } from "../app/play-details";
import { layoutFrontPages, paginate, blocksFromDoc } from "./engine";
import {
  TITLE_PAGE_FILE,
  fieldValue,
  frontPagesFor,
  legacyBlockAt,
  legacyPageFiles,
} from "./page-files";

const registry = await loadFormatRegistry();
const dg = registry.get("dg-modern")!;
const sketch = registry.get("sketch-comedy")!;

const SCRIPT =
  "Title: The Weight of Water\nSubtitle: A Play in Two Floods\nCredit: a play by\nAuthor: A. Playwright\n\n# ACT ONE\n\nMARA\nHello.\n";

/** What a title page prints, line by line, in a format. */
const printed = (fm: FrontMatter, spec = dg) =>
  layoutFrontPages(frontPagesFor(fm, spec.frontMatter), spec)[0]?.lines.map((l) => l.text) ?? [];

describe("a play's subtitle", () => {
  it("is read from the title page's Subtitle key and written back after the title", () => {
    const parsed = parse(SCRIPT);
    expect(parsed.frontMatter.subtitle).toBe("A Play in Two Floods");
    const out = serialize(parsed);
    expect(out.indexOf("Title:")).toBeLessThan(out.indexOf("Subtitle: A Play in Two Floods"));
    expect(out.indexOf("Subtitle:")).toBeLessThan(out.indexOf("Credit:"));
    expect(parse(out).frontMatter.subtitle).toBe("A Play in Two Floods");
    // A play with none writes no key.
    const none = parse(SCRIPT.replace("Subtitle: A Play in Two Floods\n", ""));
    expect(none.frontMatter.subtitle).toBeUndefined();
    expect(serialize(none)).not.toContain("Subtitle");
  });

  it("prints under the title, on a title page from the script's keys and on one that is a file", () => {
    const fm = parse(SCRIPT).frontMatter;
    const fromKeys = printed(fm);
    expect(fromKeys.slice(0, 4)).toEqual([
      "THE WEIGHT OF WATER",
      "A Play in Two Floods",
      "a play by",
      "A. Playwright",
    ]);
    const asFile = printed({
      ...fm,
      pages: [{ id: "t", name: "Title Page", text: TITLE_PAGE_FILE }],
    });
    expect(asFile).toEqual(fromKeys);
    // Each stands where the other does: the page is the same page once it is a file.
    const rows = (f: FrontMatter) =>
      layoutFrontPages(frontPagesFor(f, dg.frontMatter), dg)[0]!.lines.map((l) => l.row);
    expect(
      rows({ ...fm, pages: [{ id: "t", name: "Title Page", text: TITLE_PAGE_FILE }] }),
    ).toEqual(rows(fm));
    expect(legacyPageFiles(fm)[0]?.text).toBe(TITLE_PAGE_FILE);
  });

  it("prints nothing, and takes no room, when the play has none", () => {
    const { subtitle: _none, ...fm } = parse(SCRIPT).frontMatter;
    const without = printed(fm);
    expect(without.slice(0, 3)).toEqual(["THE WEIGHT OF WATER", "a play by", "A. Playwright"]);
    const rowsOf = (f: FrontMatter) =>
      layoutFrontPages(frontPagesFor(f, dg.frontMatter), dg)[0]!.lines.map((l) => l.row);
    const file = { ...fm, pages: [{ id: "t", name: "Title Page", text: TITLE_PAGE_FILE }] };
    expect(printed(file)).toEqual(without);
    expect(rowsOf(file)).toEqual(rowsOf(fm));
  });

  it("stands in an opening that runs in with the first numbered page", () => {
    const { doc, frontMatter } = parse(SCRIPT);
    const page = paginate(blocksFromDoc(doc, sketch), sketch, { frontMatter }).pages[0]!;
    const intro = (page.intro ?? []).map((l) => l.text);
    expect(intro[0]).toBe("THE WEIGHT OF WATER");
    expect(intro[1]).toBe("A Play in Two Floods");
  });

  it("is a detail a field writes, and a press on its line of the sheet finds its line of the file", () => {
    const fm = parse(SCRIPT).frontMatter;
    expect(DETAILS).toContain("subtitle");
    expect(DETAIL_OF.subtitle).toBe("subtitle");
    expect(fieldValue("subtitle", fm)).toBe("A Play in Two Floods");
    expect(detailText(fm, "subtitle")).toBe("A Play in Two Floods");
    expect(detailValue("subtitle", "  ")).toBeUndefined();
    expect(legacyBlockAt("title", "subtitle", fm)).toBe(1);
    expect(legacyBlockAt("title", "credit", fm)).toBe(2);
    expect(legacyBlockAt("title", "authors", fm)).toBe(3);
    expect(legacyBlockAt("title", "contact-0", fm)).toBe(5);
    expect(legacyBlockAt("title", "draft-date", fm)).toBe(6);
  });
});
