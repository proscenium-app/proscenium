// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { serializePlay, validPlayShape, type PlayFile } from "./play-file";

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

describe("a script's names kept in their own case (docs/app/keeping-work/storage-and-file-format.md#STOR-194)", () => {
  const withKept = (castKept: unknown): unknown => ({
    ...(withItem("Script.fountain") as object),
    scripts: { s1: { scenes: [], orphans: [], castKept } },
  });

  it("is a list of a name, a line's key and a count", () => {
    expect(validPlayShape(withKept([{ name: "JUNE", line: "0a1b2c3d", nth: 0 }]))).toBe(true);
    expect(validPlayShape(withKept([]))).toBe(true);
  });

  it("refuses an entry that is anything else", () => {
    for (const bad of [
      [{ name: "JUNE", line: "not-a-key", nth: 0 }],
      [{ name: "JUNE", line: "0a1b2c3d", nth: -1 }],
      [{ name: "JUNE", line: "0a1b2c3d", nth: 1.5 }],
      [{ line: "0a1b2c3d", nth: 0 }],
      ["JUNE"],
      "JUNE",
    ])
      expect(validPlayShape(withKept(bad))).toBe(false);
  });

  it("is written after castHidden, each entry's keys in one order", () => {
    const play = {
      ...(withItem("Script.fountain") as Record<string, unknown>),
      scripts: {
        s1: {
          castKept: [{ nth: 0, line: "0a1b2c3d", name: "JUNE" }],
          castHidden: ["VOICE"],
          orphans: [],
          scenes: [],
        },
      },
    } as unknown as PlayFile;
    const text = serializePlay(play);
    expect(text.indexOf('"castHidden"')).toBeLessThan(text.indexOf('"castKept"'));
    expect(text).toContain('{ "name": "JUNE", "line": "0a1b2c3d", "nth": 0 }');
  });
});
