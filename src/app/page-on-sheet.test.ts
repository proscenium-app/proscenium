// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import type { FrontMatter } from "../fountain";
import { TITLE_PAGE_FILE } from "../layout/page-files";
import { startingText } from "./PageOnSheet";

/**
 * The words a page's editor opens on, before the store has its file: the
 * page's own, whichever side of the script it is on. A page after the script
 * once opened on nothing, because only the pages before it were looked in:
 * the caret went to the top whatever line was pressed, and a key typed before
 * the file arrived became the whole page.
 */
describe("the words a page's editor opens on", () => {
  const fm: FrontMatter = {
    title: "Water",
    pages: [{ id: "t", name: "Title Page", text: TITLE_PAGE_FILE }],
    backPages: [
      { id: "a", name: "About the Author", text: "## ABOUT THE AUTHOR\n\nShe writes plays.\n" },
    ],
  };

  test("a page before the script, and a page after it, each open on their own file", () => {
    expect(startingText("t", fm)).toBe(TITLE_PAGE_FILE);
    expect(startingText("a", fm)).toBe("## ABOUT THE AUTHOR\n\nShe writes plays.\n");
  });

  test("a page the title page still prints opens on the file its first edit will write", () => {
    expect(startingText("legacy:title", { title: "Water", authors: ["A. Writer"] })).toBe(
      TITLE_PAGE_FILE,
    );
  });

  test("a page not read yet opens on nothing, until its file arrives", () => {
    expect(startingText("unknown", fm)).toBe("");
    expect(startingText("a", { title: "Water" })).toBe("");
  });
});
