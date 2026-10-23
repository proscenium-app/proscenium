// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cask, caskOptions, RELEASE_URL } from "./homebrew-cask.mjs";

const SHA = "a".repeat(64);

test("a release's cask names its own DMG on GitHub, by version", () => {
  const text = cask({ version: "1.0.1", sha256: SHA });
  expect(text).toContain('  version "1.0.1"\n');
  expect(text).toContain(`  sha256 "${SHA}"\n`);
  expect(text).toContain(`  url "${RELEASE_URL}"\n`);
  expect(RELEASE_URL).toContain(
    "releases/download/v#{version}/Proscenium_#{version}_universal.dmg",
  );
});

test("--url names a DMG elsewhere, a local file for a rehearsal among them", () => {
  const url = "file:///Users/Shared/stand-in/Proscenium_1.0.1_universal.dmg";
  const text = cask(caskOptions(["1.0.1", "--sha256", SHA, "--url", url]));
  expect(text).toContain(`  url "${url}"\n`);
  expect(text).not.toContain("github.com/proscenium-app/proscenium/releases");
  expect(caskOptions(["1.0.1", "--url", url, "--sha256", SHA])).toEqual({
    version: "1.0.1",
    sha256: SHA,
    url,
  });
});

test("the old command line still gives the release's cask", () => {
  expect(caskOptions(["1.0.1", SHA])).toEqual({ version: "1.0.1", sha256: SHA });
  const script = fileURLToPath(new URL("./homebrew-cask.mjs", import.meta.url));
  const r = spawnSync("node", [script, "1.0.1", SHA], { encoding: "utf8" });
  expect(r.status).toBe(0);
  expect(r.stdout).toBe(cask({ version: "1.0.1", sha256: SHA }));
});

test("nothing the cask would carry into Ruby or a download unexamined is written", () => {
  for (const url of [
    'file:///x"; system("id") #',
    "file:///x#{version}",
    "http://example.org/Proscenium.dmg",
    "file:///with space.dmg",
    "ftp://example.org/x.dmg",
    "/Users/Shared/x.dmg",
  ])
    expect(() => cask({ version: "1.0.1", sha256: SHA, url })).toThrow("address");
  expect(() => cask({ version: "1.0", sha256: SHA })).toThrow("version");
  expect(() => cask({ version: "1.0.1", sha256: "A".repeat(64) })).toThrow("SHA-256");
  expect(() => caskOptions(["1.0.1", "--url", "file:///x.dmg"])).toThrow("usage");
  expect(() => caskOptions(["1.0.1", "--sha256", SHA, "--sha256", SHA])).toThrow("usage");
  expect(() => caskOptions(["1.0.1", "--name", "x", "--sha256", SHA])).toThrow("usage");
});
