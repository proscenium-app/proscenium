// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { matchingPath, pathKey, samePath, replacePathPrefix } from "./path-key";

test("docs/app/keeping-work/storage-and-file-format.md#STOR-36: disk, manifest and event spellings share one NFC/case key", () => {
  expect(pathKey("Notes/Café.md")).toBe(pathKey("NOTES/Cafe\u0301.MD/"));
  expect(samePath("Notes/Café.md", "Notes/Cafe.md")).toBe(false);
  expect(matchingPath("NOTES/Cafe\u0301.MD", ["Notes/Café.md"])).toBe("Notes/Café.md");
  expect(matchingPath("NOTE.md", ["Note.md", "note.md"])).toBeUndefined();
  expect(matchingPath("note.md", ["Note.md", "note.md"])).toBe("note.md");
  expect(replacePathPrefix("Cafe\u0301/Notes/Test.md", "Café", "Drafts")).toBe(
    "Drafts/Notes/Test.md",
  );
  expect(replacePathPrefix("Cafétoo/Notes.md", "Café", "Drafts")).toBe("Cafétoo/Notes.md");
});
