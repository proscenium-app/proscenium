// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHIPS,
  fileNames,
  packageVersion,
  renderManifest,
  storeIdentity,
  sumsText,
  TEST_IDENTITY,
  versionOfTag,
} from "./release-build.mjs";

const ROOT = join(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("a stable tag builds its version, a beta's tag its whole version", () => {
  expect(versionOfTag("v1.0.2", "1.0.2")).toEqual({ version: "1.0.2", track: "stable" });
  expect(versionOfTag("v1.0.2-beta.3", "1.0.2")).toEqual({
    version: "1.0.2-beta.3",
    track: "beta",
  });
  expect(versionOfTag("v1.0.2-beta.0", "1.0.2").version).toBe("1.0.2-beta.0");
});

test("nothing else is a release's tag, and a tag must name its commit's version", () => {
  for (const bad of [
    "1.0.2",
    "v1.0.2-alpha.4",
    "v1.0.2-beta",
    "v1.0.2-beta.03",
    "v1.0.2-rc.1",
    "v1.0",
    "v1.0.2 ",
    "refs/tags/v1.0.2",
  ])
    expect(() => versionOfTag(bad, "1.0.2")).toThrow();
  expect(() => versionOfTag("v1.0.3", "1.0.2")).toThrow(/this commit's version is 1.0.2/);
});

test("the Store's version has four numbers, whatever the track", () => {
  expect(packageVersion("1.0.2")).toBe("1.0.2.0");
  expect(packageVersion("1.0.2-beta.3")).toBe("1.0.2.0");
  expect(() => packageVersion("beta")).toThrow();
});

test("the test identity until Partner Center gives one, and never half of each", () => {
  const empty = { name: null, publisher: null, publisherDisplayName: null };
  expect(storeIdentity(empty)).toEqual({ ...TEST_IDENTITY, forStore: false });
  // The file as committed: no identity yet.
  expect(storeIdentity(JSON.parse(read("src-tauri/windows/store-identity.json"))).forStore).toBe(
    false,
  );
  const real = {
    name: "HabibyLLC.Proscenium",
    publisher: "CN=ABCDEF12-3456",
    publisherDisplayName: "Habiby LLC",
  };
  expect(storeIdentity(real)).toEqual({ ...real, forStore: true });
  expect(() => storeIdentity({ ...empty, name: "HabibyLLC.Proscenium" })).toThrow(/not all/);
  expect(() => storeIdentity({ ...real, name: "no spaces allowed" })).toThrow();
  expect(() => storeIdentity({ ...real, publisher: "Habiby LLC" })).toThrow();
});

test("the manifest's every blank is filled, and filled as XML", () => {
  const template = read("src-tauri/windows/Package.appxmanifest");
  const text = renderManifest(template, {
    identity: { ...TEST_IDENTITY, publisherDisplayName: "A & B" },
    version: "1.0.2-beta.3",
    chip: "arm64",
  });
  expect(text).not.toMatch(/\{\{/);
  expect(text).toContain(
    `<Identity Name="${TEST_IDENTITY.name}" Publisher="${TEST_IDENTITY.publisher}" Version="1.0.2.0" ProcessorArchitecture="arm64" />`,
  );
  expect(text).toContain("<PublisherDisplayName>A &amp; B</PublisherDisplayName>");
  expect(() =>
    renderManifest("{{SOMETHING_ELSE}}", {
      identity: TEST_IDENTITY,
      version: "1.0.2",
      chip: "x64",
    }),
  ).toThrow(/nothing fills/);
});

test("the Store's package declares what the installer registers, and asks for full trust", () => {
  const manifest = read("src-tauri/windows/Package.appxmanifest");
  const hooks = read("src-tauri/windows/installer-hooks.nsh");
  const conf = JSON.parse(read("src-tauri/tauri.windows.conf.json"));
  const declared = [...manifest.matchAll(/<uap:FileType>\.([a-z]+)<\/uap:FileType>/g)].map(
    (m) => m[1],
  );
  const installed = [
    ...conf.bundle.fileAssociations.flatMap((a: { ext: string[] }) => a.ext),
    ...[...hooks.matchAll(/!insertmacro PROSCENIUM_OPEN_WITH "([a-z]+)"/g)].map((m) => m[1]),
  ];
  expect(declared.sort()).toEqual(installed.sort());
  expect(manifest).toContain('<rescap:Capability Name="runFullTrust" />');
  expect(manifest).toContain('EntryPoint="Windows.FullTrustApplication"');
  // Windows 10 22H2, the oldest Windows Proscenium is offered for.
  expect(manifest).toContain('MinVersion="10.0.19045.0"');
});

test("each chip's files are named as the release names them", () => {
  expect(Object.values(CHIPS).sort()).toEqual(["arm64", "x64"]);
  expect(fileNames("1.0.2", "x64")).toEqual({
    installer: "Proscenium_1.0.2_x64-setup.exe",
    msix: "Proscenium_1.0.2_x64.msix",
    roll: "roll-x64.json",
    sums: "SHA256SUMS-x64",
  });
  expect(fileNames("1.0.2-beta.3", "arm64").installer).toBe(
    "Proscenium_1.0.2-beta.3_arm64-setup.exe",
  );
  expect(sumsText([{ name: "a.exe", sha256: "f".repeat(64) }])).toBe(`${"f".repeat(64)}  a.exe\n`);
});
