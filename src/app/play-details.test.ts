// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import type { FrontMatter } from "../fountain";
import { FIELD_NAMES } from "../markdown/page-fields";
import {
  DETAILS,
  DETAIL_HELP,
  DETAIL_OF,
  detailText,
  detailValue,
  sameDetail,
} from "./play-details";

/**
 * One reading of the play's details for a field written where it stands on
 * a page (docs/app/formatting/formats-and-layout.md#FMT-180): a name typed on
 * any page is the same author.
 */
describe("the play's details, as a writer types them", () => {
  const fm: FrontMatter = {
    title: "Water",
    credit: "a play by",
    authors: ["A. Writer", "B. Other"],
    contact: ["12 Pier Road", "agent@example.com"],
    draftDate: "June 2026",
  };

  test("every field of a page shows a detail, and every detail is explained", () => {
    // Every field but the contents and the cast, which follow the script and are no detail.
    for (const field of FIELD_NAMES)
      if (field === "contents" || field === "cast") expect(DETAIL_OF[field]).toBeUndefined();
      else expect(DETAILS).toContain(DETAIL_OF[field]!);
    for (const detail of DETAILS) {
      expect(DETAIL_HELP[detail].help).toMatch(/\.$/);
    }
    // The title and the title in capitals are one detail, the title.
    expect(DETAIL_OF.TITLE).toBe("title");
    expect(DETAIL_OF.author).toBe("authors");
  });

  test("authors are one line with commas, and the contact one line a row", () => {
    expect(detailText(fm, "authors")).toBe("A. Writer, B. Other");
    expect(detailText(fm, "contact")).toBe("12 Pier Road\nagent@example.com");
    expect(detailText(fm, "title")).toBe("Water");
    expect(detailText(fm, "source")).toBe("");
    expect(detailText({}, "authors")).toBe("");
  });

  test("what is typed is kept as the title page keeps it, and nothing at all is no key", () => {
    expect(detailValue("authors", " Jane Doe ,, John Roe ")).toEqual(["Jane Doe", "John Roe"]);
    expect(detailValue("authors", "  ")).toBeUndefined();
    expect(detailValue("contact", "12 Elm Street\n\n jane@example.com \n")).toEqual([
      "12 Elm Street",
      "jane@example.com",
    ]);
    expect(detailValue("contact", "\n")).toBeUndefined();
    expect(detailValue("title", "  The Long Way Home ")).toBe("The Long Way Home");
    expect(detailValue("draftDate", "")).toBeUndefined();
  });

  test("a detail typed as it stands changes nothing, and so is not written", () => {
    for (const detail of DETAILS) expect(sameDetail(fm, detail, detailText(fm, detail))).toBe(true);
    expect(sameDetail(fm, "authors", "A. Writer,B. Other")).toBe(true);
    expect(sameDetail(fm, "authors", "A. Writer")).toBe(false);
    expect(sameDetail({}, "authors", "")).toBe(true);
    expect(sameDetail({}, "authors", "Jane Doe")).toBe(false);
  });
});
