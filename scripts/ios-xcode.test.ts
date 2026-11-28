// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sceneProblems } from "./check-bundle-ios.mjs";
import { IOS_SDK_FLOOR, IOS_XCODE, iosDeveloperDir, iosEnv, sdkProblems } from "./ios-xcode.mjs";

const BESIDE = `${IOS_XCODE}/Contents/Developer`;
const here = () => true;
const absent = () => false;

describe("which Xcode the iPad's commands run with", () => {
  test("the one beside the selected Xcode, where a host has it", () => {
    expect(iosDeveloperDir({}, here)).toBe(BESIDE);
    expect(iosEnv({ PATH: "/usr/bin" }, here)).toEqual({
      PATH: `${BESIDE}/usr/bin:/usr/bin`,
      DEVELOPER_DIR: BESIDE,
    });
  });

  test("the selected one, with nothing set, where there is no second", () => {
    expect(iosDeveloperDir({}, absent)).toBeNull();
    expect(iosEnv({ PATH: "/usr/bin" }, absent)).toEqual({ PATH: "/usr/bin" });
    // A Developer directory the caller already chose is left as it is.
    expect(iosEnv({ DEVELOPER_DIR: "/elsewhere" }, absent).DEVELOPER_DIR).toBe("/elsewhere");
  });

  test("another directory a host names, before either", () => {
    const env = { PROSCENIUM_IOS_DEVELOPER_DIR: "/Volumes/Tools/Xcode.app/Contents/Developer" };
    expect(iosDeveloperDir(env, here)).toBe(env.PROSCENIUM_IOS_DEVELOPER_DIR);
    expect(iosEnv(env, absent).DEVELOPER_DIR).toBe(env.PROSCENIUM_IOS_DEVELOPER_DIR);
  });

  test("its tools stand first on the path, once, since the build tool hands on the path and not the variable", () => {
    const bin = `${BESIDE}/usr/bin`;
    expect(iosEnv({}, here).PATH).toBe(bin);
    expect(iosEnv({ PATH: `/opt/bin:${bin}:/usr/bin` }, here).PATH).toBe(
      `${bin}:/opt/bin:/usr/bin`,
    );
    const named = { PROSCENIUM_IOS_DEVELOPER_DIR: "/named/Developer", PATH: "/usr/bin" };
    expect(iosEnv(named, absent).PATH).toBe("/named/Developer/usr/bin:/usr/bin");
  });

  test("the environment given is never changed in place", () => {
    const env = { PATH: "/usr/bin" };
    iosEnv(env, here);
    expect(env).toEqual({ PATH: "/usr/bin" });
  });
});

describe("the SDK a built app says it was made with", () => {
  test("the floor is the App Store's from April 2027", () => {
    expect(IOS_SDK_FLOOR).toBe(27);
  });

  test("the floor or newer passes, by the platform version or the SDK's name", () => {
    expect(sdkProblems({ DTPlatformVersion: "27.2" })).toEqual([]);
    expect(sdkProblems({ DTPlatformVersion: "28.0" })).toEqual([]);
    expect(sdkProblems({ DTSDKName: "iphoneos27.2" })).toEqual([]);
  });

  test("an older one is refused, saying which and where a newer Xcode goes", () => {
    const [line, ...more] = sdkProblems({ DTPlatformVersion: "26.5", DTSDKName: "iphoneos26.5" });
    expect(more).toEqual([]);
    expect(line).toContain("built with the iOS 26.5 SDK");
    expect(line).toContain("iOS 27 or later");
    expect(line).toContain(IOS_XCODE);
  });

  test("a plist that does not say is refused too", () => {
    expect(sdkProblems({})).toHaveLength(1);
    expect(sdkProblems(undefined)).toHaveLength(1);
  });
});

describe("the scene life cycle a built app declares", () => {
  const declared = {
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "TaoSceneDelegate",
          },
        ],
      },
    },
  };

  test("one configuration for the window, naming its delegate, passes", () => {
    expect(sceneProblems(declared)).toEqual([]);
  });

  test("no manifest is refused", () => {
    expect(sceneProblems({})).toHaveLength(1);
    expect(sceneProblems({})[0]).toContain("no UIApplicationSceneManifest");
  });

  test("a manifest with its configurations empty is refused as none is", () => {
    for (const manifest of [
      {},
      { UISceneConfigurations: {} },
      { UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [] } },
      { UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{}] } },
    ])
      expect(sceneProblems({ UIApplicationSceneManifest: manifest })).toHaveLength(1);
  });

  test("the iPad's own plist declares it, as the check asks", () => {
    const plist = join(import.meta.dir, "../src-tauri/Info.ios.plist");
    const read = spawnSync("plutil", ["-convert", "json", "-o", "-", plist], { encoding: "utf8" });
    // plutil is the Mac's; where there is none the plist's text is held instead.
    if (read.status === 0) expect(sceneProblems(JSON.parse(read.stdout))).toEqual([]);
    const text = readFileSync(plist, "utf8");
    expect(text).toContain("<key>UIApplicationSceneManifest</key>");
    expect(text).toContain("<string>TaoSceneDelegate</string>");
  });
});

describe("the iPad's commands go through it", () => {
  const source = (name: string) => readFileSync(join(import.meta.dir, name), "utf8");

  test("a command run through the script gets the Developer directory, and its exit is the command's", () => {
    const script = join(import.meta.dir, "ios-xcode.mjs");
    const env = { ...process.env, PROSCENIUM_IOS_DEVELOPER_DIR: "/named/Developer" };
    const said = spawnSync(
      process.execPath,
      [
        script,
        "--",
        process.execPath,
        "-e",
        "console.log(process.env.DEVELOPER_DIR)",
        "--",
        "kept",
      ],
      { encoding: "utf8", env },
    );
    expect(said.stdout.trim()).toBe("/named/Developer");
    expect(said.status).toBe(0);
    const failed = spawnSync(
      process.execPath,
      [script, "--", process.execPath, "-e", "process.exit(7)"],
      { encoding: "utf8", env },
    );
    expect(failed.status).toBe(7);
  });

  test("the release's build and its export, and never its upload", () => {
    const release = source("release-ios.mjs");
    expect(release).toContain("{ cwd: ROOT, env: iosEnv() }");
    expect(release).toContain(
      "{ env: iosEnv({ ...process.env, PATH: systemToolsFirst(process.env.PATH) }) }",
    );
    expect(release.match(/iosEnv\(/g)?.length).toBe(2);
  });

  test("the simulator pass, whole, and the build check holds the SDK and the scenes", () => {
    const sim = source("ipad-sim.mjs");
    expect(sim).toContain(
      "if (IOS_ENV.DEVELOPER_DIR) process.env.DEVELOPER_DIR = IOS_ENV.DEVELOPER_DIR;",
    );
    expect(sim).toContain("if (IOS_ENV.PATH) process.env.PATH = IOS_ENV.PATH;");
    expect(sim).toContain("const sdk = sdkProblems(info);");
    // The pass's exit is every result held and every step run, never a count of results.
    expect(sim).toContain("steps.every((step) => ran.has(step))");
    expect(sim).not.toContain("results.length === steps.length");
    const check = source("check-bundle-ios.mjs");
    expect(check).toContain("const sdk = sdkProblems(info);");
    expect(check).toContain("const scenes = sceneProblems(info);");
  });
});
