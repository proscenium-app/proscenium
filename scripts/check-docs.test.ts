// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anchors, checkReference, missingAllocatedIds, reachableDocumentation } from "./check-docs";

const root = mkdtempSync(join(tmpdir(), "proscenium-docs-"));
mkdirSync(join(root, "docs"));
writeFileSync(
  join(root, "docs/storage.md"),
  '# Storage\n\n<a id="STOR-12"></a>\n\n## Atomic writes\n\n## Atomic writes\n',
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("a moved file and a removed id fail independently", () => {
  expect(checkReference(root, "src/save.ts", "docs/storage.md#STOR-12")).toBeUndefined();
  expect(checkReference(root, "src/save.ts", "docs/missing.md#STOR-12")).toContain(
    "missing document",
  );
  expect(checkReference(root, "src/save.ts", "docs/storage.md#STOR-99")).toContain(
    "missing anchor",
  );
});
test("heading citations validate the actual section, including duplicate headings", () => {
  expect(checkReference(root, "docs/README.md", "storage.md#atomic-writes-1")).toBeUndefined();
  expect(checkReference(root, "docs/README.md", "storage.md#former-section")).toContain(
    "missing anchor",
  );
});
test("code examples cannot manufacture valid ids or headings", () => {
  expect(anchors('```md\n<a id="FAKE-1"></a>\n## False\n```\n## Real')).toEqual(new Set(["real"]));
});

test("relative fragments, malformed escapes and compressed lists do not hide a missing target", () => {
  expect(checkReference(root, "docs/storage.md", "#STOR-12")).toBeUndefined();
  expect(checkReference(root, "src/save.ts", "docs/storage.md#STOR-12/99")).toContain(
    "missing anchor",
  );
  expect(checkReference(root, "src/save.ts", "docs/storage.md#STOR-12–14")).toContain(
    "missing anchor",
  );
  expect(checkReference(root, "src/save.ts", "docs/storage.md#STOR-12#missing")).toContain(
    "missing anchor",
  );
  expect(checkReference(root, "src/save.ts", "docs/storage.md#%GG")).toContain("malformed anchor");
});

test("allocated ids survive moves and withdrawals, and cannot disappear", () => {
  const register = "| STOR | 1 | 2 |";
  expect(missingAllocatedIds(register, new Set(["STOR-1"]))).toEqual([
    "allocated id STOR-2 was removed; retain a withdrawal anchor",
  ]);
  const withdrawn = anchors(
    '<a id="STOR-2"></a>\n\n**STOR-2 — Withdrawn.** Replaced by another requirement.',
  );
  expect(missingAllocatedIds(register, new Set(["STOR-1", ...withdrawn]))).toEqual([]);
  // A row the public export drops is still held to its range where it is kept.
  expect(missingAllocatedIds("| CICD | 1 | 1 | <!-- private -->", new Set())).toEqual([
    "allocated id CICD-1 was removed; retain a withdrawal anchor",
  ]);
});

test("area indexes reach nested features, linked records and embedded evidence through cycles", () => {
  const documents = new Map([
    ["docs/README.md", "[Writing](app/writing/README.md)\n[Backstage](backstage/README.md)"],
    ["docs/app/writing/README.md", "[Editor](editor.md#entry)\n[Home](../../README.md)"],
    ["docs/app/writing/editor.md", "[Area](README.md)"],
    ["docs/backstage/README.md", "[Record](records/proof.md)"],
    ["docs/backstage/records/proof.md", "![Proof](evidence.png)"],
    ["docs/backstage/records/evidence.png", ""],
  ]);
  expect(reachableDocumentation(documents)).toEqual(new Set(documents.keys()));
});

test("an orphan cannot make itself reachable, and examples or external links do not index it", () => {
  const documents = new Map([
    [
      "docs/README.md",
      "```md\n[Orphan](orphan.md)\n```\n[External](https://example.invalid/docs/orphan.md)",
    ],
    ["docs/orphan.md", "[Home](README.md)\n[Self](orphan.md)"],
  ]);
  expect(reachableDocumentation(documents)).toEqual(new Set(["docs/README.md"]));
});
