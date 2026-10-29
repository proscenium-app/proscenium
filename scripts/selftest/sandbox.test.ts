// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { judgeSandbox } from "./sandbox.mjs";

const container = "/Users/x/Library/Containers/org.habiby.proscenium.sandbox.selftest/Data";
const sandbox = {
  sandboxed: true,
  container: "org.habiby.proscenium.sandbox.selftest",
  containerHome: container,
  refusedOutside: "Operation not permitted (os error 1)",
  appData: `${container}/tmp/proscenium-selftest-1/home/Library/Application Support/org.habiby.proscenium.sandbox.selftest`,
  cloudRoot: null,
};
const grants = [
  { path: "/w/world/0/dev/plays-0", write: true, why: "the folder panel" },
  { path: "/w/world/exports/Play.pdf", write: true, why: "the Save panel" },
  { path: "/w/world/3/dev/loose.fountain", write: true, why: "Finder" },
];
const judge = (over: Record<string, unknown> = {}) =>
  judgeSandbox({
    report: { sandbox },
    bundleId: "org.habiby.proscenium.sandbox.selftest",
    container,
    grants,
    acts: ["opening", "export", "from Finder"],
    exports: "/w/world/exports",
    names: ["Play.pdf"],
    ...over,
  });

test("a sandboxed run that held to its grants is clean (docs/engineering/release-engineering.md#REL-56)", () => {
  expect(judge()).toEqual([]);
});

test("an app that never ran sandboxed proves nothing", () => {
  expect(judge({ report: { sandbox: { sandboxed: false } } })).toEqual([
    "the app did not run in the App Sandbox",
  ]);
  expect(judge({ report: null })).toEqual(["the app did not run in the App Sandbox"]);
});

test("a write nothing granted that went through is the sandbox not holding", () => {
  const report = { sandbox: { ...sandbox, refusedOutside: "written" } };
  expect(judge({ report })[0]).toContain("the sandbox is not holding the app");
});

test("app data outside the container, or an iCloud container with no entitlement, fails (docs/app/keeping-work/storage-and-file-format.md#STOR-142)", () => {
  const outside = { sandbox: { ...sandbox, appData: "/Users/x/Library/Application Support/p" } };
  expect(judge({ report: outside })[0]).toContain("outside its container");
  const cloud = { sandbox: { ...sandbox, cloudRoot: "/Users/x/Library/Mobile Documents/p" } };
  expect(judge({ report: cloud })[0]).toContain("without the iCloud entitlement");
});

test("anything beside an export that no Save panel named fails (docs/app/keeping-work/storage-and-file-format.md#STOR-187)", () => {
  expect(judge({ names: ["Play.pdf", ".Play.pdf.x1.tmp"] })).toEqual([
    "exports: .Play.pdf.x1.tmp is beside the exports, and no Save panel named it",
  ]);
});

test("an act whose grant was never asked for proves nothing about it", () => {
  const folder = grants.filter((g) => g.why === "the folder panel");
  expect(judge({ grants: folder, names: [] })).toEqual([
    "the export act ran, and no file was granted by the Save panel",
    "the Finder act ran, and Finder granted no file",
  ]);
  expect(judge({ grants: [], acts: ["settings"], names: [] })).toEqual([
    "no folder was granted by the folder panel",
  ]);
});
