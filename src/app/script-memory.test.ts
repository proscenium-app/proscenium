// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import type { BinderItem } from "../workspace";
import { scriptToOpen } from "./script-memory";

const binder: BinderItem[] = [
  { id: "first", type: "script", path: "The Weight of Water.fountain" },
  {
    id: "drafts",
    type: "folder",
    path: "Drafts",
    children: [
      { id: "second", type: "script", path: "Drafts/Second Draft.fountain" },
      { id: "mara", type: "character", path: "Drafts/Mara.md" },
    ],
  },
];

describe("the script a play opens on", () => {
  test("is the one last in front, wherever it is filed", () => {
    expect(scriptToOpen(binder, "second")?.path).toBe("Drafts/Second Draft.fountain");
  });

  test("is the first script when nothing was remembered", () => {
    expect(scriptToOpen(binder, null)?.id).toBe("first");
  });

  test("is the first script when the remembered one has gone, or is not a script", () => {
    expect(scriptToOpen(binder, "trashed")?.id).toBe("first");
    expect(scriptToOpen(binder, "mara")?.id).toBe("first");
  });

  test("is nothing in a play with no script", () => {
    expect(scriptToOpen([{ id: "notes", type: "folder", path: "Notes", children: [] }], "first")).toBeNull();
  });
});
