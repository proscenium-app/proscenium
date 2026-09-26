// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";

import { defaultDirFor } from "../materials";
import { MATERIAL_FOLDERS, startingBinder } from "./play-shape";
import type { BinderItem } from "./play-file";

const SCRIPT: BinderItem = {
  id: "s",
  type: "script",
  path: "A Play.fountain",
};

describe("play shape", () => {
  it("gives every material kind a folder its own writer will land in", () => {
    // The bug this file exists to prevent: a binder folder that `newMaterial`
    // never files into, so sheets pile up loose at the root.
    for (const type of ["character", "research", "logline", "note"] as const) {
      expect(MATERIAL_FOLDERS).toContain(defaultDirFor(type));
    }
  });

  it("has no generic bucket", () => {
    expect(MATERIAL_FOLDERS).not.toContain("Materials");
    expect(MATERIAL_FOLDERS).not.toContain("materials");
  });

  it("has no support directories at all", () => {
    // `script/`, `exports/` and `archive/` were scaffolded and then hidden from
    // the binder. They are gone: a second script lands beside the first, an
    // export goes through a save dialog, and there are no reserved folder
    // names left (docs/app/keeping-work/storage-and-file-format.md#STOR-D3).
    for (const gone of ["script", "exports", "archive", "Exports", "Archive"]) {
      expect(MATERIAL_FOLDERS).not.toContain(gone);
    }
  });

  it("lists each directory once, even where two kinds share a home", () => {
    // `document` and `outline` both live in Notes/.
    expect(new Set(MATERIAL_FOLDERS).size).toBe(MATERIAL_FOLDERS.length);
    expect(MATERIAL_FOLDERS).toContain("Notes");
  });

  it("starts the binder with the script, then a folder per material home", () => {
    const binder = startingBinder(SCRIPT);
    expect(binder[0]).toEqual(SCRIPT);
    const folders = binder.slice(1);
    expect(folders.map((f) => f.path)).toEqual(MATERIAL_FOLDERS);
    for (const f of folders) {
      expect(f.type).toBe("folder");
      expect(f.children).toEqual([]);
    }
  });

  it("carries no title on any entry — the filename is the title (docs/app/keeping-work/storage-and-file-format.md#STOR-D4)", () => {
    for (const item of startingBinder(SCRIPT)) {
      expect(item).not.toHaveProperty("title");
      expect(item.path).toBeTruthy();
    }
  });

  it("gives every folder a distinct id", () => {
    const ids = startingBinder(SCRIPT).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
