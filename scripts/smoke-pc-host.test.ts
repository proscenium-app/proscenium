// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { join } from "node:path";
import { DEEP_FOLDERS, DEEP_LENGTH, actLayout, insidePlays, launchEnv } from "./smoke-pc-host.mjs";

test("a check reaches its act's Plays folder and nothing outside it", () => {
  const plays = join("/runs", "3", "plays");
  expect(insidePlays(plays, "The Weight of Water/The Weight of Water.fountain")).toBe(
    join(plays, "The Weight of Water", "The Weight of Water.fountain"),
  );
  for (const out of ["", ".", "..", "../4/plays/x", "The Weight of Water/../../x", "/etc/hosts"])
    expect(() => insidePlays(plays, out)).toThrow("not inside the act's Plays folder");
});

test("a deep Plays folder is named in other scripts, and long enough whatever the run's folder", () => {
  for (const run of [
    join("/r"),
    join("/a", "much", "longer", "folder", "for", "the", "runs", "9"),
  ]) {
    const plays = actLayout(run, { deep: true }).plays;
    expect(plays.length).toBeGreaterThanOrEqual(DEEP_LENGTH);
    expect(plays.endsWith(`${"/"}Plays`) || plays.endsWith("\\Plays")).toBe(true);
    expect(plays.startsWith(join(run, DEEP_FOLDERS[0]))).toBe(true);
  }
  const plain = actLayout("/r", {});
  expect(plain).toEqual({
    plays: join("/r", "dev", "plays"),
    seed: join("/r", "dev", "plays"),
    outside: join("/r", "dev"),
    cloud: null,
    env: {},
    unset: [],
  });
});

test("an act's launch takes OneDrive's own variables from the app's environment, whatever their case, and gives its own", () => {
  const layout = {
    plays: "/r/OneDrive/Documents/Plays",
    seed: "/r/cloud",
    cloud: "/r/cloud",
    env: { OneDrive: "/r/OneDrive" },
    unset: ["OneDrive", "OneDriveCommercial"],
  };
  expect(
    launchEnv({ ONEDRIVE: "C:\\Users\\a\\OneDrive", onedrivecommercial: "x", PATH: "p" }, layout, {
      PROSCENIUM_SELFTEST_FOLDER: layout.plays,
    }),
  ).toEqual({ PATH: "p", OneDrive: "/r/OneDrive", PROSCENIUM_SELFTEST_FOLDER: layout.plays });
});
