// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  backPageItems,
  frontPageItems,
  hasPageKeys,
  pageFolderId,
  pageFolderOf,
  withoutPageKeys,
} from "./front-folder";
import type { PlayFile } from "./play-file";

const play = (frontMatter?: { folder: string }): PlayFile =>
  ({
    binder: [
      {
        id: "fm",
        type: "folder",
        path: "Front Matter",
        children: [
          { id: "t", type: "document", path: "Front Matter/Title Page.md" },
          { id: "img", type: "reference", path: "Front Matter/logo.png" },
          { id: "sub", type: "folder", path: "Front Matter/Old", children: [] },
          { id: "c", type: "document", path: "Front Matter/Characters.md" },
        ],
      },
      { id: "script", type: "script", path: "Play.fountain" },
    ],
    scripts: { script: { scenes: [], orphans: [], ...(frontMatter ? { frontMatter } : {}) } },
  }) as unknown as PlayFile;

describe("a script's pages after the script (docs/app/formatting/formats-and-layout.md#FMT-174)", () => {
  const withBack = (backMatter?: { folder: string }): PlayFile => {
    const p = play({ folder: "fm" });
    p.binder.push({
      id: "bm",
      type: "folder",
      path: "Back Matter",
      children: [
        { id: "a", type: "document", path: "Back Matter/About the Author.md" },
        { id: "pic", type: "reference", path: "Back Matter/portrait.png" },
        { id: "g", type: "document", path: "Back Matter/Glossary.md" },
      ],
    } as PlayFile["binder"][number]);
    if (backMatter) p.scripts.script!.backMatter = backMatter;
    return p;
  };
  it("are the Markdown files of the folder the play file names for them, in binder order", () => {
    const p = withBack({ folder: "bm" });
    expect(backPageItems(p.binder, p, "script").map((item) => item.id)).toEqual(["a", "g"]);
    // The pages before the script are the other folder's, as they were.
    expect(frontPageItems(p.binder, p, "script")?.map((item) => item.id)).toEqual(["t", "c"]);
  });
  it("are none while the script names no folder for them, or the folder has gone", () => {
    const none = withBack();
    expect(backPageItems(none.binder, none, "script")).toEqual([]);
    const gone = withBack({ folder: "gone" });
    expect(backPageItems(gone.binder, gone, "script")).toEqual([]);
  });
  it("say whose pages a folder holds, and on which side of that script", () => {
    const p = withBack({ folder: "bm" });
    expect(pageFolderOf(p, "fm")).toEqual({ scriptId: "script", side: "front" });
    expect(pageFolderOf(p, "bm")).toEqual({ scriptId: "script", side: "back" });
    expect(pageFolderOf(p, "sub")).toBeNull();
    expect(pageFolderId(p, "script", "front")).toBe("fm");
    expect(pageFolderId(p, "script", "back")).toBe("bm");
    expect(pageFolderId(withBack(), "script", "back")).toBeUndefined();
  });
});

describe("a script's pages before the script, kept as files (docs/app/formatting/formats-and-layout.md#FMT-169)", () => {
  it("are the Markdown files of the folder the play file names, in binder order", () => {
    const p = play({ folder: "fm" });
    expect(frontPageItems(p.binder, p, "script")?.map((item) => item.id)).toEqual(["t", "c"]);
  });
  it("are still the title page's while the script names no folder", () => {
    const p = play();
    expect(frontPageItems(p.binder, p, "script")).toBeUndefined();
  });
  it("are none when the folder the script names has gone", () => {
    const p = play({ folder: "gone" });
    expect(frontPageItems(p.binder, p, "script")).toEqual([]);
  });
  it("leave the script holding its facts and none of the keys that held pages", () => {
    const fm = {
      title: "Play",
      authors: ["A. Playwright"],
      contact: ["a@example.com"],
      characters: [{ name: "MARA" }],
      charactersPage: "**MARA**",
      openingNotes: "A kitchen.",
      openingNotesBeforeCharacters: true,
      productionNotes: "Notes.",
      titlePage: "# Play",
      setting: "A kitchen.",
      time: "Now.",
      place: "Here.",
    };
    expect(hasPageKeys(fm)).toBe(true);
    expect(withoutPageKeys(fm)).toEqual({
      title: "Play",
      authors: ["A. Playwright"],
      contact: ["a@example.com"],
    });
    expect(hasPageKeys(withoutPageKeys(fm))).toBe(false);
  });
});
