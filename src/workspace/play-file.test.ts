// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { validPlayShape } from "./play-file";

/** A play file with one binder item at `path`, as another copy may have written it. */
function withItem(path: string): unknown {
  return {
    kind: "proscenium/play",
    id: "p1",
    schemaVersion: 1,
    created: "2026-10-14T00:00:00Z",
    modified: "2026-10-14T00:00:00Z",
    generator: { app: "Proscenium", version: "1.0.0" },
    settings: {},
    scripts: {},
    binder: [{ id: "i1", type: "document", path }],
  };
}

describe("a binder path stays inside its play", () => {
  it("is taken when it names a file inside, by `/`", () => {
    expect(validPlayShape(withItem("Notes/Ideas.md"))).toBe(true);
  });

  it("is refused when it leaves the play by either system's separator, a root or a drive", () => {
    for (const path of [
      "/etc/x",
      "../x",
      "Notes/../../x",
      "..\\x",
      "Notes\\..\\..\\x",
      "\\x",
      "C:\\x",
      "c:x",
    ]) {
      expect([path, validPlayShape(withItem(path))]).toEqual([path, false]);
    }
  });
});
