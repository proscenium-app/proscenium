// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, it } from "bun:test";
import { reviewRecoveryFiles } from "./recover-sessions";
import { encodeSnapshot } from "./recovery-policy";

it("docs/app/keeping-work/storage-and-file-format.md#STOR-118: all abandoned owners are pinned before removal and offered independently", async () => {
  const files = ["A", "B", "same", "malformed"].map((owner, i) => ({ scriptId: "S", owner,
    content: owner === "malformed" ? "broken original" : encodeSnapshot({ path: "A.fountain", savedAtMs: 100 + i, content: owner }) }));
  const kept: string[] = [], removed: string[] = [];
  const offers = await reviewRecoveryFiles(files, {
    fileModifiedMs: 0, sameContent: (text) => text === "same",
    keep: async (text) => { if (text === "A") throw new Error("disk full"); kept.push(text); return "version-" + text; },
    remove: async (owner) => { expect(owner === "same" || kept.includes(owner)).toBe(true); removed.push(owner); },
  });
  expect(removed).toEqual(["B", "same"]);
  expect(offers.map((offer) => [offer.owner, offer.versionName])).toEqual([["B", "version-B"], ["A", null]]);
});
