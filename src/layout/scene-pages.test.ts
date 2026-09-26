// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../fountain";
import { loadFormatRegistry } from "../format";
import { pageCountLabel, pageRangeLabel, scenePageMap } from "./scene-pages";
import type { Doc } from "../fountain";

const registry = await loadFormatRegistry();
const dg = registry.get("dg-modern")!;

const SAMPLE = join(
  import.meta.dir,
  "../../sample-vault/The Weight of Water/The Weight of Water.fountain",
);

/** A script of `n` scenes under one act, each with `linesEach` speech lines. */
function script(acts: { act: string; scenes: number[] }[]): Doc {
  const content: Doc["content"] = [];
  for (const a of acts) {
    content.push({ type: "act", content: [{ type: "text", text: a.act }] });
    a.scenes.forEach((lines, i) => {
      content.push({ type: "scene", content: [{ type: "text", text: `SCENE ${i + 1}` }] });
      for (let l = 0; l < lines; l++) {
        content.push({ type: "character", content: [{ type: "text", text: "MARA" }] });
        content.push({ type: "dialogue", content: [{ type: "text", text: `Line ${l}.` }] });
      }
    });
  }
  return { type: "doc", content };
}

describe("scene page ranges", () => {
  it("locates every scene in the sample script", () => {
    const { doc } = parse(readFileSync(SAMPLE, "utf8"));
    const map = scenePageMap(doc, dg);
    expect(map.scenes).toHaveLength(3); // ACT ONE ×2, ACT TWO ×1
    expect(map.totalPages).toBeGreaterThan(0);
    // Ordinals are 0-based and in document order, matching the card records.
    expect(map.scenes.map((s) => s.ordinal)).toEqual([0, 1, 2]);
    // Pages only ever move forward through the script.
    for (let i = 1; i < map.scenes.length; i++) {
      expect(map.scenes[i].firstPage).toBeGreaterThanOrEqual(map.scenes[i - 1].firstPage);
    }
    // Every scene sits inside the script's page count.
    for (const s of map.scenes) {
      expect(s.firstPage).toBeGreaterThanOrEqual(1);
      expect(s.lastPage).toBeLessThanOrEqual(map.totalPages);
      expect(s.pages).toBe(s.lastPage - s.firstPage + 1);
    }
  });

  it("attributes each scene to its act, and rolls the acts up", () => {
    const { doc } = parse(readFileSync(SAMPLE, "utf8"));
    const map = scenePageMap(doc, dg);
    expect(map.scenes.map((s) => s.act)).toEqual(["ACT ONE", "ACT ONE", "ACT TWO"]);
    expect(map.acts.map((a) => a.act)).toEqual(["ACT ONE", "ACT TWO"]);
    expect(map.acts[0].scenes).toEqual([0, 1]);
    expect(map.acts[1].scenes).toEqual([2]);
    // An act spans its scenes.
    expect(map.acts[0].firstPage).toBe(map.scenes[0].firstPage);
    expect(map.acts[0].lastPage).toBe(map.scenes[1].lastPage);
  });

  it("gives a long scene more pages than a short one", () => {
    // 400 speech lines will not fit on one page; 2 will.
    const map = scenePageMap(script([{ act: "ACT ONE", scenes: [400, 2] }]), dg);
    expect(map.scenes[0].pages).toBeGreaterThan(1);
    expect(map.scenes[1].pages).toBe(1);
    // The long scene ends where the short one begins (they may share a page).
    expect(map.scenes[1].firstPage).toBeGreaterThanOrEqual(map.scenes[0].lastPage);
  });

  it("counts a scene that shares one page as a single page", () => {
    const map = scenePageMap(script([{ act: "ACT ONE", scenes: [1, 1] }]), dg);
    expect(map.scenes[0].pages).toBe(1);
    expect(map.scenes[1].pages).toBe(1);
    expect(map.totalPages).toBe(1);
  });

  it("survives a script with no scenes and no document at all", () => {
    expect(scenePageMap(null, dg).scenes).toEqual([]);
    const noScenes: Doc = {
      type: "doc",
      content: [{ type: "action", content: [{ type: "text", text: "Just a page of prose." }] }],
    };
    const map = scenePageMap(noScenes, dg);
    expect(map.scenes).toEqual([]);
    expect(map.totalPages).toBe(1);
  });

  it("labels ranges the way a writer says them", () => {
    expect(pageRangeLabel({ ordinal: 0, act: null, firstPage: 4, lastPage: 9, pages: 6 })).toBe(
      "Pages 4–9",
    );
    expect(pageRangeLabel({ ordinal: 0, act: null, firstPage: 4, lastPage: 4, pages: 1 })).toBe(
      "Page 4",
    );
    expect(pageCountLabel(1)).toBe("1 page");
    expect(pageCountLabel(6)).toBe("6 pages");
  });
});
