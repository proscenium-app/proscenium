// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { PLAY_TMPL, parseJson, stringifyCanonical, type KeyTemplate } from "./json-io";

describe("canonical JSON emitter", () => {
  it("keeps all-primitive objects/arrays inline, nests the rest", () => {
    const value = {
      kind: "x",
      generator: { app: "Proscenium", version: "0.1.0" },
      settings: { format: "s", autosave: { debounceMs: 600, maxWaitMs: 2000 } },
      tags: ["a", "b"],
    };
    const tmpl: KeyTemplate = {
      kind: true,
      generator: { app: true, version: true },
      settings: { format: true, autosave: true },
      tags: true,
    };
    expect(stringifyCanonical(value, tmpl)).toBe(
      [
        "{",
        '  "kind": "x",',
        '  "generator": { "app": "Proscenium", "version": "0.1.0" },',
        '  "settings": {',
        '    "format": "s",',
        '    "autosave": { "debounceMs": 600, "maxWaitMs": 2000 }',
        "  },",
        '  "tags": ["a", "b"]',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("orders known keys by template, preserves unknown keys after, in order", () => {
    // A nested value forces multi-line so per-key order is visible.
    const value = { z: 1, title: "T", _ai: "keep", id: "I", nested: { x: 1 } };
    const tmpl: KeyTemplate = { id: true, title: true, nested: true };
    const out = stringifyCanonical(value, tmpl);
    expect(out).toBe(
      [
        "{",
        '  "id": "I",',
        '  "title": "T",',
        '  "nested": { "x": 1 },',
        '  "z": 1,',
        '  "_ai": "keep"',
        "}",
        "",
      ].join("\n"),
    );
  });

  it("never reorders array element order", () => {
    const value = { binder: [{ id: "b" }, { id: "a" }] };
    const tmpl: KeyTemplate = { binder: { id: true } };
    const out = parseJson(stringifyCanonical(value, tmpl)) as typeof value;
    expect(out.binder.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("is byte-idempotent through a parse→stringify round-trip", () => {
    const play = {
      kind: "proscenium/play",
      schemaVersion: 1,
      id: "01J9Z8B4C7H0M2N5Q8R1T3V6W9",
      status: "drafting",
      created: "2026-06-18T21:42:00Z",
      modified: "2026-06-18T22:10:13Z",
      generator: { app: "Proscenium", version: "1.0.0" },
      settings: {
        format: "stage-us-modern",
        sceneAnchors: "manifest",
        autosave: { debounceMs: 600, maxWaitMs: 2000 },
      },
      binder: [{ id: "S1", type: "script", path: "The Weight of Water.fountain" }],
      scripts: {
        S1: {
          scenes: [
            {
              id: "01J9ZS1",
              anchor: { ordinal: 0, headingHash: "6eafa9b29d1b9810", embeddedId: null },
              card: { color: "oxide", status: "draft", label: "setup", boardNote: "" },
            },
          ],
          orphans: [],
        },
      },
      _futureField: { nested: "kept" },
    };
    const once = stringifyCanonical(play, PLAY_TMPL);
    const twice = stringifyCanonical(parseJson(once), PLAY_TMPL);
    expect(twice).toBe(once);
    // unknown nested key survived
    expect(once).toContain('"_futureField"');
  });

  it("reaches a scene's shape through `scripts`, whose keys are data", () => {
    // `scripts` is keyed by binder id, so the template cannot name its keys —
    // it uses a wildcard. Without one, a scene would serialize in whatever
    // order it happened to be built in, and deterministic bytes are the point
    // (docs/app/keeping-work/storage-and-file-format.md#STOR-D5): a play file whose bytes drift rewrites itself on every
    // open, and a file that rewrites itself in a synced folder conflicts.
    const built = {
      kind: "proscenium/play",
      scripts: {
        S1: {
          orphans: [],
          scenes: [
            {
              // deliberately out of schema order
              card: { boardNote: "", label: "", status: "draft", color: "cream" },
              anchor: { embeddedId: null, headingHash: "abc", ordinal: 0 },
              id: "X",
            },
          ],
        },
      },
    };
    const out = stringifyCanonical(built, PLAY_TMPL);
    expect(out).toContain('"scenes": [');
    expect(out).toContain('{ "color": "cream", "status": "draft", "label": "", "boardNote": "" }');
    expect(out).toContain('{ "ordinal": 0, "headingHash": "abc", "embeddedId": null }');
    // `orphans` is declared after `scenes` in the schema, and follows it here.
    expect(out.indexOf('"scenes"')).toBeLessThan(out.indexOf('"orphans"'));
  });

  it("handles empty arrays/objects", () => {
    expect(stringifyCanonical({ orphans: [], meta: {} }, { orphans: true, meta: true })).toBe(
      '{\n  "orphans": [],\n  "meta": {}\n}\n',
    );
  });

  it("emits a recursive binder folder multi-line with inline leaves", () => {
    const play = {
      kind: "proscenium/play",
      schemaVersion: 1,
      id: "S",
      binder: [
        { id: "1", type: "script", path: "T.fountain" },
        {
          id: "2",
          type: "folder",
          path: "Characters",
          children: [{ id: "3", type: "character", path: "Characters/Mara.md" }],
        },
      ],
      scripts: {},
    };
    const out = stringifyCanonical(play, PLAY_TMPL);
    // leaf script item inline
    expect(out).toContain('    { "id": "1", "type": "script", "path": "T.fountain" }');
    // folder multi-line, child inline
    expect(out).toContain('      "children": [\n');
    expect(out).toContain(
      '        { "id": "3", "type": "character", "path": "Characters/Mara.md" }',
    );
    // no `title`, no `index`: the filename is the title and cards live in
    // `scripts` (docs/app/keeping-work/storage-and-file-format.md#STOR-D5).
    expect(out).not.toContain('"title"');
    expect(out).not.toContain('"index"');
  });
});
