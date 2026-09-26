// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { reconstruct, split } from "./front-matter";
import { findOutlineNote, hasContent } from "./outline-note";
import type { BinderItem } from "./play-file";

const item = (p: Partial<BinderItem>): BinderItem =>
  ({ id: "x", type: "document", path: "t.md", ...p }) as BinderItem;

describe("findOutlineNote", () => {
  test("finds it at the binder root", () => {
    const binder = [
      item({ id: "s", type: "script", path: "script/play.fountain" }),
      item({ id: "o", type: "outline", path: "notes/outline.md" }),
    ];
    expect(findOutlineNote(binder)?.id).toBe("o");
  });

  test("finds it after the writer files it in a folder", () => {
    const binder = [
      item({
        id: "f",
        type: "folder",
        path: "notes",
        children: [item({ id: "o", type: "outline", path: "notes/outline.md" })],
      }),
    ];
    expect(findOutlineNote(binder)?.id).toBe("o");
  });

  test("is null when the play has none, and when one exists only as an entry", () => {
    expect(findOutlineNote([])).toBeNull();
    expect(findOutlineNote([item({ id: "n", type: "document", path: "Notes/x.md" })])).toBeNull();
  });

  test("takes the first in binder order, so a duplicate is inert not ambiguous", () => {
    const binder = [
      item({ id: "first", type: "outline", path: "notes/outline.md" }),
      item({ id: "second", type: "outline", path: "notes/outline-2.md" }),
    ];
    expect(findOutlineNote(binder)?.id).toBe("first");
  });
});

describe("hasContent — the lazy-birth guard", () => {
  test("whitespace alone never creates a file", () => {
    expect(hasContent("")).toBe(false);
    expect(hasContent("   \n\n\t ")).toBe(false);
  });
  test("a real keystroke does", () => {
    expect(hasContent("what if the brother arrives in act two")).toBe(true);
  });
});

describe("front matter round trip", () => {
  const file = [
    "---",
    "id: 01J9ZE5L6M7N8P9Q0R1S2T3U4V",
    "type: outline",
    "title: Outline",
    "tool-note: added by an outside tool",
    "---",
    "",
    "# Outline",
    "",
    "Act two is the problem.",
    "",
  ].join("\n");

  test("splits the header from the body", () => {
    const fm = split(file);
    expect(fm.fields.type).toBe("outline");
    expect(fm.body).toBe("# Outline\n\nAct two is the problem.\n");
  });

  test("editing the body leaves every header field untouched — including unknown ones", () => {
    const fm = split(file);
    const out = reconstruct(fm.header, "Act two is fine. Act three is the problem.");
    expect(out).toContain("tool-note: added by an outside tool");
    expect(out).toContain("id: 01J9ZE5L6M7N8P9Q0R1S2T3U4V");
    expect(split(out).body).toBe("Act two is fine. Act three is the problem.\n");
  });

  test("re-splitting a reconstructed file is a fixed point", () => {
    const once = reconstruct(split(file).header, split(file).body);
    const twice = reconstruct(split(once).header, split(once).body);
    expect(twice).toBe(once);
  });

  test("a file with no header stays headerless", () => {
    const fm = split("just prose\n");
    expect(fm.header).toBeNull();
    expect(reconstruct(fm.header, fm.body)).toBe("just prose\n");
  });

  test("always ends in exactly one newline, however the writer left it", () => {
    for (const body of ["a", "a\n", "a\n\n\n", "a   \n  \n"]) {
      expect(reconstruct(null, body)).toBe("a\n");
    }
  });
});
