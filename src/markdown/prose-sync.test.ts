// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { emit, loaded, proseSync, propArrived } from "./prose-sync";

describe("propArrived", () => {
  test("the prop unchanged is nothing to do", () => {
    const sync = proseSync("Notes\n", "Notes\n");
    expect(propArrived(sync, "Notes\n")).toBe("same");
  });

  test("the editor's latest emission coming back is an echo", () => {
    const sync = proseSync("", "");
    emit(sync, "T\n");
    expect(propArrived(sync, "T\n")).toBe("echo");
    expect(sync.pending).toEqual([]);
  });

  test("an emission the render is behind on is an echo, not a new document", () => {
    // The native self-test: the render came back with " Tide " while the page
    // already said " Tide tur", and loading it deleted "tur".
    const sync = proseSync("", "");
    for (const step of ["Tide\n", "Tide t\n", "Tide tu\n", "Tide tur\n"]) emit(sync, step);
    expect(propArrived(sync, "Tide\n")).toBe("echo");
    expect(sync.pending).toEqual(["Tide t\n", "Tide tu\n", "Tide tur\n"]);
    expect(propArrived(sync, "Tide tu\n")).toBe("echo");
    expect(propArrived(sync, "Tide tur\n")).toBe("echo");
    expect(sync.pending).toEqual([]);
  });

  test("a render that skips emissions still catches up", () => {
    const sync = proseSync("", "");
    for (const step of ["a\n", "ab\n", "abc\n"]) emit(sync, step);
    expect(propArrived(sync, "abc\n")).toBe("echo");
    expect(sync.pending).toEqual([]);
  });

  test("a value the editor never produced is a different document", () => {
    const sync = proseSync("Mine\n", "Mine\n");
    emit(sync, "Mine, typed\n");
    expect(propArrived(sync, "From the iPad\n")).toBe("replace");
  });

  test("an old emission the parent sets on purpose, after catching up, is loaded", () => {
    const sync = proseSync("", "");
    emit(sync, "one\n");
    emit(sync, "one two\n");
    expect(propArrived(sync, "one two\n")).toBe("echo");
    // A restore to what the page said a moment ago is a document, not an echo.
    expect(propArrived(sync, "one\n")).toBe("replace");
  });

  test("the document as loaded is not loaded again (the caret stays put)", () => {
    // The editor normalizes on parse: the file's bytes and its own Markdown differ.
    const sync = proseSync("Line  \n", "Line\n");
    expect(propArrived(sync, "Line\n")).toBe("echo");
  });

  test("after a load, nothing from before it counts as an echo", () => {
    const sync = proseSync("", "");
    emit(sync, "draft\n");
    loaded(sync, "theirs\n");
    expect(propArrived(sync, "draft\n")).toBe("replace");
  });

  test("keeps the newest sixty-four emissions", () => {
    const sync = proseSync("", "");
    for (let i = 0; i < 100; i++) emit(sync, `${i}\n`);
    expect(sync.pending.length).toBe(64);
    expect(sync.pending[0]).toBe("36\n");
    expect(propArrived(sync, "40\n")).toBe("echo");
  });
});
