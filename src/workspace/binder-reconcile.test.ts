// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import {
  ignoredDir,
  ignoredFile,
  isTempSibling,
  reconcile,
  type DiskNode,
} from "./binder-reconcile";
import type { BinderItem, BinderItemType } from "./play-file";

const leaf = (id: string, path: string, type: BinderItemType = "document"): BinderItem => ({
  id,
  type,
  path,
});
const folder = (id: string, path: string, children: BinderItem[] = []): BinderItem => ({
  id,
  type: "folder",
  path,
  children,
});

const file = (path: string): DiskNode => ({ path, isDir: false });
const dir = (path: string): DiskNode => ({ path, isDir: true });

/** Deterministic ids so a test can name what was filed. */
function mintFactory() {
  let n = 0;
  return () => `new${n++}`;
}

function run(binder: BinderItem[], disk: DiskNode[], typeOf = () => "document" as const) {
  return reconcile(binder, disk, typeOf, mintFactory());
}

describe("binder reconciliation (docs/app/keeping-work/storage-and-file-format.md#STOR-D8)", () => {
  it("docs/app/keeping-work/storage-and-file-format.md#STOR-36: NFC/NFD and case changes retain the script identity and use the actual disk name", () => {
    const original = [folder("f", "Scènes", [leaf("s", "Scènes/Café.fountain", "script")])];
    const actual = "SCE\u0300NES/Cafe\u0301.FOUNTAIN";
    const r = run(original, [dir("SCE\u0300NES"), file(actual)]);
    expect(r.added).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.updated).toEqual(["f", "s"]);
    expect(r.binder[0].children![0]).toEqual(leaf("s", actual, "script"));
    expect(original[0].children![0].path).toBe("Scènes/Café.fountain");
  });

  it("a relocated typed document retains its embedded id and metadata", () => {
    const id = "01KYFQCPRAN26GEJ79GA4HQAVM";
    const document = { ...leaf(id, "Characters/Old.md", "character"), custom: "kept" };
    const r = reconcile(
      [folder("old", "Characters", [document])],
      [dir("Notes"), file("Notes/New.md")],
      () => "character",
      mintFactory(),
      true,
      () => id,
    );
    expect(r.removed).toEqual([]);
    expect(r.updated).toEqual([id]);
    expect(r.binder.find((b) => b.path === "Notes")?.children).toEqual([
      { ...document, path: "Notes/New.md" },
    ]);
    expect(r.binder[0].children).toEqual([]);
  });

  it("a known legacy document id survives relocation too", () => {
    const r = reconcile(
      [leaf("legacy-sheet", "Old.md", "character")],
      [file("New.md")],
      () => "character",
      mintFactory(),
      true,
      () => "legacy-sheet",
    );
    expect(r.binder).toEqual([leaf("legacy-sheet", "New.md", "character")]);
    expect(r.added).toEqual([]);
  });

  it("duplicated embedded ids do not steal an existing document's identity", () => {
    const id = "01KYFQCPRAN26GEJ79GA4HQAVM";
    const r = reconcile(
      [leaf(id, "Old.md", "character")],
      [file("Old.md"), file("Copy.md")],
      () => "character",
      mintFactory(),
      true,
      () => id,
    );
    expect(r.binder.find((b) => b.path === "Old.md")?.id).toBe(id);
    expect(r.binder.find((b) => b.path === "Copy.md")?.id).not.toBe(id);
    const copies = reconcile(
      [],
      [file("Copy.md"), file("Another.md")],
      () => "character",
      mintFactory(),
      true,
      () => id,
    );
    expect(new Set(copies.binder.map((b) => b.id)).size).toBe(2);
    expect(copies.binder.every((b) => b.id !== id)).toBe(true);
  });

  it("docs/app/keeping-work/storage-and-file-format.md#STOR-36: case-colliding files supplied by another tool are both kept visible", () => {
    const r = run([leaf("old", "Note.md")], [file("Note.md"), file("note.md")]);
    expect(r.binder.map((b) => b.path).sort()).toEqual(["Note.md", "note.md"]);
    expect(r.binder.find((b) => b.path === "Note.md")?.id).toBe("old");
    const removedCopy = run(r.binder, [file("Note.md")]);
    expect(removedCopy.binder).toEqual([leaf("old", "Note.md")]);
    expect(removedCopy.removed.map((b) => b.path)).toEqual(["note.md"]);
  });

  it("an incomplete walk cannot relocate a possibly still-present identity", () => {
    const id = "01KYFQCPRAN26GEJ79GA4HQAVM";
    const r = reconcile(
      [leaf(id, "Old.md", "character")],
      [file("New.md")],
      () => "character",
      mintFactory(),
      false,
      () => id,
    );
    expect(r.binder.find((b) => b.path === "Old.md")?.id).toBe(id);
    expect(r.binder.find((b) => b.path === "New.md")?.id).not.toBe(id);
  });
  it("files a file that arrived, into the folder it sits in", () => {
    const binder = [folder("f", "Notes")];
    const r = run(binder, [dir("Notes"), file("Notes/Retreat.md")]);
    expect(r.added).toEqual(["new0"]);
    const notes = r.binder[0];
    expect(notes.children?.map((c) => c.path)).toEqual(["Notes/Retreat.md"]);
  });

  it("makes a binder folder out of a directory that appeared", () => {
    // The binder IS the folder: a directory the writer made in Finder is a
    // binder folder, not something to be ignored or asked about.
    const r = run([], [dir("Scenes"), file("Scenes/Parked bedroom.fountain")]);
    expect(r.binder.map((i) => [i.type, i.path])).toEqual([["folder", "Scenes"]]);
    expect(r.binder[0].children?.map((c) => c.path)).toEqual(["Scenes/Parked bedroom.fountain"]);
  });

  it("nests deeply, parents before children", () => {
    const r = run([], [dir("A"), dir("A/B"), file("A/B/c.md")]);
    const a = r.binder[0];
    expect(a.path).toBe("A");
    const b = a.children![0];
    expect(b.path).toBe("A/B");
    expect(b.children!.map((c) => c.path)).toEqual(["A/B/c.md"]);
  });

  it("has no reserved folder names — archive and exports are ordinary now", () => {
    // Before 1.0 these were skipped by name, so a `.fountain` in `archive/`
    // was invisible to the app and an exported PDF was noise nobody could see.
    const r = run(
      [],
      [dir("Archive"), file("Archive/Draft one.fountain"), dir("Exports"), file("Exports/x.pdf")],
    );
    const paths = r.binder.flatMap((f) => [f.path, ...(f.children ?? []).map((c) => c.path)]);
    expect(paths).toContain("Archive/Draft one.fountain");
    expect(paths).toContain("Exports/x.pdf");
  });

  it("leaves an already-filed file exactly where it is", () => {
    const binder = [folder("f", "Notes", [leaf("a", "Notes/a.md")])];
    const r = run(binder, [dir("Notes"), file("Notes/a.md")]);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.binder[0].children!.map((c) => c.id)).toEqual(["a"]);
  });

  it("treats a folder with no directory as EMPTY, not missing", () => {
    // Folders are create-on-demand (docs/app/keeping-work/storage-and-file-format.md#STOR-29): a new play's Characters and Notes
    // have no directory until the first file lands, and reporting them as
    // missing would make every new play look broken.
    const binder = [folder("c", "Characters"), folder("n", "Notes")];
    const r = run(binder, []);
    expect(r.missing).toEqual([]);
    expect(r.removed).toEqual([]);
    expect(r.binder.map((i) => i.path)).toEqual(["Characters", "Notes"]);
  });

  it("KEEPS a script whose file is gone, and surfaces it", () => {
    // It carries card metadata and a version ring, and a script vanishing is
    // exactly when the app should speak up rather than tidy up.
    const binder = [leaf("s", "Play.fountain", "script"), leaf("d", "Notes/n.md")];
    const r = run(binder, [file("Notes/n.md")]);
    expect(r.missing.map((m) => m.id)).toEqual(["s"]);
    expect(r.binder.map((i) => i.id)).toContain("s");
  });

  it("REMOVES a document whose file is gone, and reports it", () => {
    const binder = [leaf("s", "Play.fountain", "script"), leaf("d", "Notes/n.md")];
    const r = run(binder, [file("Play.fountain")]);
    expect(r.removed.map((m) => m.id)).toEqual(["d"]);
    expect(r.binder.map((i) => i.id)).not.toContain("d");
    expect(r.missing).toEqual([]);
  });

  it("uses the type the caller inferred, per path", () => {
    const r = reconcile(
      [],
      [file("Characters/Sophie.md"), file("Play.fountain")],
      (p) => (p.endsWith(".fountain") ? "script" : "character"),
      mintFactory(),
    );
    const byPath = new Map(r.binder.map((i) => [i.path, i.type]));
    expect(byPath.get("Play.fountain")).toBe("script");
    expect(byPath.get("Characters/Sophie.md")).toBe("character");
  });

  it("is deterministic: same disk, same order", () => {
    const disk = [dir("B"), dir("A"), file("B/two.md"), file("A/one.md")];
    const a = run([], disk);
    const b = run([], [...disk].reverse());
    expect(JSON.stringify(a.binder)).toBe(JSON.stringify(b.binder));
  });
});

describe("what is never a binder item", () => {
  it("ignores the play file itself", () => {
    // It is the app's, Finder shows it with its own icon, and a row for it
    // inside its own binder would be a loop.
    expect(ignoredFile("The Weight of Water.proscenium")).toBe(true);
  });

  it("ignores an atomic write's temp sibling (docs/app/keeping-work/storage-and-file-format.md#STOR-D9)", () => {
    expect(isTempSibling(".The Weight of Water.fountain.a1b2c3.tmp")).toBe(true);
    expect(ignoredFile(".The Weight of Water.fountain.a1b2c3.tmp")).toBe(true);
    // A writer's own `.tmp` is theirs.
    expect(isTempSibling("draft.tmp")).toBe(false);
  });

  it("ignores a provider's conflict copy (docs/app/keeping-work/storage-and-file-format.md#STOR-D11)", () => {
    expect(ignoredFile("Play.sync-conflict-20260618-120000-ABCDEFG.fountain")).toBe(true);
    expect(ignoredFile("Play (Robin's conflicted copy 2026-07-18).fountain")).toBe(true);
    // iCloud's `<name> 2` is indistinguishable from a file a writer made, so
    // it is one: hiding it would hide real work.
    expect(ignoredFile("Play 2.fountain")).toBe(false);
  });

  it("ignores dotfiles wholesale", () => {
    // `.DS_Store` was once filed as a reference whose title — the stem of a
    // name that is all extension — was the empty string, leaving a nameless,
    // un-clickable row in the binder.
    expect(ignoredFile(".DS_Store")).toBe(true);
    expect(ignoredDir(".git")).toBe(true);
    expect(ignoredDir("Archive")).toBe(false);
  });

  it("does not ignore an ordinary file or folder", () => {
    expect(ignoredFile("Structure.md")).toBe(false);
    expect(ignoredFile("tide-tables.pdf")).toBe(false);
    expect(ignoredDir("Characters")).toBe(false);
  });
});
