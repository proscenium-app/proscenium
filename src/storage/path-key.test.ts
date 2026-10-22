// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import {
  baseName,
  isWindowsPath,
  joinPath,
  matchingPath,
  parentOf,
  pathKey,
  relativeTo,
  samePath,
  replacePathPrefix,
  trimSeparators,
} from "./path-key";

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

test("a Windows path splits and joins on its own separators", () => {
  const plays = "C:\\Users\\w\\Documents\\Plays";
  expect(isWindowsPath(plays)).toBe(true);
  expect(isWindowsPath("\\\\nas\\Plays")).toBe(true);
  expect(isWindowsPath("/Users/w/Plays")).toBe(false);
  expect(baseName(`${plays}\\The Tide\\`)).toBe("The Tide");
  expect(parentOf(`${plays}\\The Tide`)).toBe(plays);
  expect(parentOf("C:\\Plays")).toBe("C:\\");
  expect(trimSeparators("C:\\")).toBe("C:\\");
  expect(joinPath(plays, "The Tide")).toBe(`${plays}\\The Tide`);
  expect(joinPath("C:\\", "Plays/Drafts")).toBe("C:\\Plays\\Drafts");
  // `/` is a separator on Windows too, and its key is a Mac's.
  expect(samePath(`${plays}\\the tide`, "c:/users/w/documents/plays/The Tide")).toBe(true);
  expect(relativeTo(`${plays}\\The Tide\\Scenes\\Draft.fountain`, plays)).toBe(
    "The Tide/Scenes/Draft.fountain",
  );
  expect(relativeTo(`${plays} 2\\The Tide`, plays)).toBeNull();
});

test("a Mac's name may hold a backslash", () => {
  expect(baseName("/Users/w/Plays/A\\B")).toBe("A\\B");
  expect(joinPath("/Users/w/Plays/", "The Tide")).toBe("/Users/w/Plays/The Tide");
  expect(parentOf("/Plays")).toBe("/");
  expect(relativeTo("/Users/w/Plays/The Tide/x.fountain", "/Users/w/Plays")).toBe(
    "The Tide/x.fountain",
  );
});
