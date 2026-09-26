// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { FormatRegistry } from "../format";
import { parse } from "../fountain";
import { scenePageMap } from "../layout";
import { SAMPLE_PLAY } from "./sample-play";
import {
  cachedPages,
  countPages,
  playPages,
  specFingerprint,
  type PageCountIo,
} from "./play-pages";
import type { VaultPlay } from "./vault-plays";

const registry = FormatRegistry.withBuiltins();
const dg = registry.get("dg-modern")!;
const stage = registry.get("stage-us-modern")!;

const play = (over: Partial<VaultPlay> = {}): VaultPlay => ({
  dir: "The Weight of Water",
  title: "The Weight of Water",
  id: "01KYFQCPT4C7J7D6VPZPJMSSJ5",
  file: "The Weight of Water.proscenium",
  format: "dg-modern",
  script: "The Weight of Water/The Weight of Water.fountain",
  scriptModified: "2026-09-16T12:00:00.000Z",
  ...over,
});

/** An app-data cache and a Plays folder in memory, counting what was asked of them. */
function io(
  files: Record<string, string> = {
    "The Weight of Water/The Weight of Water.fountain": SAMPLE_PLAY,
  },
) {
  const cache = new Map<string, string>();
  const asked = { reads: 0, writes: 0 };
  const methods: PageCountIo = {
    read: async (rel) => {
      asked.reads++;
      if (!(rel in files)) throw new Error(`no ${rel}`);
      return files[rel];
    },
    cacheRead: async (id) => cache.get(id) ?? null,
    cacheWrite: async (id, content) => {
      asked.writes++;
      cache.set(id, content);
    },
  };
  return { methods, cache, asked };
}

describe("a play's pages (docs/app/keeping-work/storage-and-file-format.md#STOR-121)", () => {
  test("are the engine's count, the one the element bar and the page map give", () => {
    const pages = countPages(SAMPLE_PLAY, dg);
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBe(scenePageMap(parse(SAMPLE_PLAY).doc, dg).totalPages);
    expect(countPages(SAMPLE_PLAY, stage)).toBe(
      scenePageMap(parse(SAMPLE_PLAY).doc, stage).totalPages,
    );
  });

  test("are counted once, then read back while the script and the format are the same", async () => {
    const disk = io();
    const first = await playPages(play(), registry, disk.methods);
    expect(first).toEqual({
      pages: { kind: "pages", pages: countPages(SAMPLE_PLAY, dg) },
      counted: true,
    });
    expect(disk.asked).toEqual({ reads: 1, writes: 1 });

    const again = await playPages(play(), registry, disk.methods);
    expect(again).toEqual({ pages: first.pages, counted: false });
    expect(disk.asked.reads).toBe(1);
  });

  test("are counted again when the script changed, or the play's format did", async () => {
    const disk = io();
    await playPages(play(), registry, disk.methods);
    await playPages(play({ scriptModified: "2026-09-17T08:00:00.000Z" }), registry, disk.methods);
    expect(disk.asked.reads).toBe(2);
    const restyled = await playPages(play({ format: "stage-us-modern" }), registry, disk.methods);
    expect(restyled.counted).toBe(true);
    expect(restyled.pages).toEqual({ kind: "pages", pages: countPages(SAMPLE_PLAY, stage) });
  });

  test("are never cached without a modified time to key them by", async () => {
    const disk = io();
    await playPages(play({ scriptModified: undefined }), registry, disk.methods);
    await playPages(play({ scriptModified: undefined }), registry, disk.methods);
    expect(disk.asked).toEqual({ reads: 2, writes: 0 });
  });

  test("are a dash in a format this Mac does not have, and nothing is read", async () => {
    const disk = io();
    const result = await playPages(play({ format: "made-on-another-mac" }), registry, disk.methods);
    expect(result).toEqual({
      pages: { kind: "no-format", format: "made-on-another-mac" },
      counted: false,
    });
    expect(disk.asked.reads).toBe(0);
  });

  test("are counted in the default format for a play file that names none", async () => {
    const result = await playPages(play({ format: undefined }), registry, io().methods);
    expect(result.pages).toEqual({ kind: "pages", pages: countPages(SAMPLE_PLAY, dg) });
  });

  test("are unknown with no script, a play file to repair, or a script that will not read", async () => {
    const disk = io({});
    expect((await playPages(play({ script: undefined }), registry, disk.methods)).pages).toEqual({
      kind: "unknown",
    });
    expect((await playPages(play({ problem: "malformed" }), registry, disk.methods)).pages).toEqual(
      { kind: "unknown" },
    );
    expect((await playPages(play(), registry, disk.methods)).pages).toEqual({ kind: "unknown" });
    expect(disk.asked.writes).toBe(0);
  });

  test("a cache holding another key, or garbage, is no count at all", () => {
    const key = {
      script: "a.fountain",
      modified: "t",
      format: "dg-modern",
      spec: specFingerprint(dg),
    };
    expect(cachedPages(JSON.stringify({ ...key, pages: 42 }), key)).toBe(42);
    expect(
      cachedPages(JSON.stringify({ ...key, pages: 42 }), { ...key, modified: "u" }),
    ).toBeNull();
    expect(cachedPages(JSON.stringify({ ...key, pages: -1 }), key)).toBeNull();
    expect(cachedPages("{ not json", key)).toBeNull();
    expect(cachedPages(null, key)).toBeNull();
  });

  test("a format edited in the designer fingerprints differently", () => {
    expect(specFingerprint(dg)).toBe(specFingerprint(structuredClone(dg)));
    expect(specFingerprint({ ...dg, name: `${dg.name} (edited)` })).not.toBe(specFingerprint(dg));
  });
});
