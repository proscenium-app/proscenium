// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bakedRoll, fetchRoll, listed, parseRoll, underwritten } from "../../../scripts/patrons.mjs";
import { billed, EMPTY_ROLL, inTheWings, isDark, ROLL } from "./patrons";

const roll = (o: Partial<typeof EMPTY_ROLL> = {}) => ({ ...EMPTY_ROLL, ...o });

describe("the program in Settings › About", () => {
  it("opens dark: a build that is not a release carries the empty roll", () => {
    expect(ROLL).toEqual(EMPTY_ROLL);
    expect(isDark(ROLL)).toBe(true);
    expect(billed(ROLL)).toEqual([]);
    expect(inTheWings(ROLL)).toBeNull();
  });

  it("bills the levels in order and leaves an empty one out", () => {
    expect(billed(roll({ benefactors: ["Ada"], friends: ["Cy", "Dee"] }))).toEqual([
      { label: "Benefactors", names: ["Ada"] },
      { label: "Friends of the House", names: ["Cy", "Dee"] },
    ]);
  });

  it("counts the sponsors who asked not to be named, and names none of them", () => {
    expect(inTheWings(roll({ private: 1 }))).toBe("One patron who prefers to remain in the wings.");
    expect(inTheWings(roll({ private: 3 }))).toBe("3 patrons who prefer to remain in the wings.");
    expect(inTheWings(roll({ patrons: ["Bea"], private: 1 }))).toBe("And one more who prefers to remain in the wings.");
    expect(inTheWings(roll({ patrons: ["Bea"], private: 2 }))).toBe("And 2 more who prefer to remain in the wings.");
    expect(isDark(roll({ private: 1 }))).toBe(false);
  });
});

describe("scripts/patrons.mjs", () => {
  it("takes only the Worker's shape", () => {
    expect(parseRoll({ ...roll({ patrons: ["Bea"] }), updated: "2026-10-01T00:00:00Z" })).toEqual(roll({ patrons: ["Bea"] }));
    for (const bad of [null, [], { ...roll(), version: 2 }, { ...roll(), friends: "Cy" }, { ...roll(), friends: [1] }, { ...roll(), friends: [" "] },
      { ...roll(), friends: ["x".repeat(101)] }, { ...roll(), friends: ["Ada\u202E"] }, { ...roll(), private: -1 }, { ...roll(), private: 1.5 },
      { ...roll(), friends: Array(501).fill("Cy") }]) {
      expect(() => parseRoll(bad)).toThrow();
    }
  });

  it("bakes the file a release names, and the empty roll otherwise", () => {
    expect(bakedRoll({})).toEqual(roll());
    const file = join(mkdtempSync(join(tmpdir(), "patrons-")), "roll.json");
    writeFileSync(file, JSON.stringify(roll({ benefactors: ["Ada"] })));
    expect(bakedRoll({ PROSCENIUM_PATRONS_FILE: file })).toEqual(roll({ benefactors: ["Ada"] }));
    writeFileSync(file, JSON.stringify({ version: 1 }));
    expect(() => bakedRoll({ PROSCENIUM_PATRONS_FILE: file })).toThrow();
  });

  it("refuses a failed or malformed answer", async () => {
    const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await fetchRoll({ fetcher: answer(200, roll({ friends: ["Cy"] })) })).toEqual(roll({ friends: ["Cy"] }));
    await expect(fetchRoll({ fetcher: answer(503, {}) })).rejects.toThrow("503");
    await expect(fetchRoll({ fetcher: answer(200, { version: 1 }) })).rejects.toThrow();
  });

  it("underwrites an edition only when it has Benefactors", () => {
    expect(listed(["A"])).toBe("A");
    expect(listed(["A", "B"])).toBe("A and B");
    expect(listed(["A", "B", "C"])).toBe("A, B and C");
    expect(underwritten(roll({ patrons: ["Bea"] }))).toBeNull();
    expect(underwritten(roll({ benefactors: ["Ada", "Zed"] }))).toBe("This edition was underwritten by Ada and Zed.");
  });
});
