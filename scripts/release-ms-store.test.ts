// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SHAPE, keptIn, missingKey, packagesWrong } from "./release-ms-store.mjs";
import { updatedSubmission } from "./ms-store.mjs";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const X64 = new Uint8Array([1, 2, 3]);
const ARM = new Uint8Array([4, 5]);
const SAID = {
  version: "1.0.5",
  packages: [
    { chip: "x64", name: "Proscenium_1.0.5_x64.msix", bytes: 3, sha256: sha(X64) },
    { chip: "arm64", name: "Proscenium_1.0.5_arm64.msix", bytes: 2, sha256: sha(ARM) },
  ],
};

test("the kept packages are held to packages.json: both chips, the bytes it hashed, this version", () => {
  const files = { "Proscenium_1.0.5_x64.msix": X64, "Proscenium_1.0.5_arm64.msix": ARM };
  expect(packagesWrong(SAID, files, "1.0.5")).toEqual([]);
  expect(packagesWrong(SAID, files, "1.0.6")).toEqual(["packages.json is 1.0.5's, not 1.0.6's"]);
  expect(packagesWrong(SAID, { "Proscenium_1.0.5_x64.msix": X64 }, "1.0.5")).toEqual([
    "Proscenium_1.0.5_arm64.msix is not there",
  ]);
  expect(
    packagesWrong(SAID, { ...files, "Proscenium_1.0.5_arm64.msix": new Uint8Array([9]) }, "1.0.5"),
  ).toEqual(["Proscenium_1.0.5_arm64.msix is not the bytes packages.json hashed"]);
  expect(packagesWrong({ ...SAID, packages: SAID.packages.slice(0, 1) }, files, "1.0.5")).toEqual([
    "packages.json names no arm64 package",
  ]);
});

test("the key's parts missing are named, never a value; the packages are where the store stage keeps them", () => {
  expect(missingKey({ tenantId: "t", clientId: "c", secret: "s" })).toEqual([]);
  expect(missingKey({ tenantId: null, clientId: "c", secret: null })).toEqual([
    "the Microsoft Store key's tenant ID",
    "the Microsoft Store key's secret",
  ]);
  expect(keptIn("1.0.5", "/Users/writer")).toBe("/Users/writer/.proscenium/store/v1.0.5");
});

test("a dry run makes its data from a submission of the shape Partner Center returns", () => {
  const body = updatedSubmission(SHAPE, {
    files: ["Proscenium_1.0.5_x64.msix", "Proscenium_1.0.5_arm64.msix"],
    notes: "n",
  });
  expect(body.pricing.priceId).toBe("Free");
  expect(body.applicationPackages).toHaveLength(4);
  expect(body.listings["en-us"].baseListing.releaseNotes).toBe("n");
});
