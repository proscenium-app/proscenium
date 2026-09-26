// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { revertReviewedFile } from "./revert";

function fixture(content = "REVIEWED AFTER") {
  let disk = content;
  const pins: string[] = [];
  const args = {
    afterHash: "REVIEWED AFTER", before: "BEFORE",
    read: async () => ({ content: disk, hash: disk }),
    pin: async (content: string) => { pins.push(content); },
    stillReviewed: () => true,
    write: async (content: string, expected: string) => {
      expect(pins).toContain(expected);
      if (disk !== expected) return false;
      disk = content;
      return true;
    },
  };
  return { args, pins, disk: () => disk, external: (text: string) => { disk = text; } };
}

test("docs/app/keeping-work/storage-and-file-format.md#STOR-119: the review's newer closed-file words survive an old Changes revert", async () => {
  const f = fixture("NEWER UNIQUE WORDS");
  expect(await revertReviewedFile(f.args)).toBe("changed");
  expect(f.disk()).toBe("NEWER UNIQUE WORDS");
  expect(f.pins).toEqual([]);
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-119: pin the exact displaced version before a guarded replacement", async () => {
  const f = fixture();
  expect(await revertReviewedFile(f.args)).toBe("saved");
  expect(f.disk()).toBe("BEFORE");
  expect(f.pins).toEqual(["REVIEWED AFTER"]);
});

test("docs/app/keeping-work/storage-and-file-format.md#STOR-119: a failed pre-image or another edit replaces nothing", async () => {
  const f = fixture(); f.args.pin = async () => { throw new Error("disk full"); };
  expect(await revertReviewedFile(f.args)).toBe("unpreserved");
  expect(f.disk()).toBe("REVIEWED AFTER");
  const g = fixture();
  g.args.pin = async (content) => { g.pins.push(content); g.external("ANOTHER EXTERNAL EDIT"); };
  expect(await revertReviewedFile(g.args)).toBe("refused");
  expect(g.disk()).toBe("ANOTHER EXTERNAL EDIT");
  const h = fixture(); h.args.stillReviewed = () => false;
  expect(await revertReviewedFile(h.args)).toBe("changed");
  expect(h.disk()).toBe("REVIEWED AFTER");
});
