// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import {
  buildNumber,
  exportOptions,
  missingMaterial,
  nextUpload,
  patiently,
  systemToolsFirst,
  uploadRefused,
  uploaderRefused,
  versionOf,
} from "./release-ios.mjs";

describe("the iPad's version is the Mac's of the same commit (docs/engineering/cross-platform.md#PLAT-65)", () => {
  test("an alpha is a pre-release of the next release, numbered by its commit, as the Mac alpha is", () => {
    // main says the last release's 1.0.5, and the next is 1.0.6: the Mac's alpha of commit 998 is 1.0.6-alpha.998.
    expect(versionOf({ track: "alpha", pkg: "1.0.5", next: "1.0.6", n: 998 })).toEqual({
      base: "1.0.6",
      whole: "1.0.6-alpha.998",
    });
  });

  test("a beta is of its line's release, numbered by its one tag at HEAD", () => {
    const beta = { track: "beta", pkg: "1.0.6", next: "1.0.7", lineof: "1.0.6", n: 1002 };
    expect(versionOf({ ...beta, tags: ["", "v1.0.6-beta.2"] })).toEqual({
      base: "1.0.6",
      whole: "1.0.6-beta.2",
    });
    expect(() => versionOf({ ...beta, tags: [] })).toThrow(/one vX\.Y\.Z-beta\.N tag/);
    expect(() => versionOf({ ...beta, tags: ["v1.0.6-beta.1", "v1.0.6-beta.2"] })).toThrow(
      /found 2/,
    );
    expect(() => versionOf({ ...beta, tags: ["v1.0.7-beta.1"] })).toThrow(/the line of 1\.0\.6/);
    expect(() => versionOf({ ...beta, tags: ["stand-in/v1.0.6-beta.1", "v1.0.6-rc.1"] })).toThrow(
      /found 0/,
    );
  });

  test("a release is package.json's, and carries no whole version", () => {
    expect(versionOf({ track: "stable", pkg: "1.0.6", next: "1.0.6", n: 1010 })).toEqual({
      base: "1.0.6",
      whole: null,
    });
  });

  test("nothing App Store Connect, or the reports service, would take wrongly", () => {
    expect(() => versionOf({ track: "alpha", pkg: "1.0.5", next: "1.0.6-alpha.1", n: 9 })).toThrow(
      /not X\.Y\.Z/,
    );
    expect(() => versionOf({ track: "alpha", pkg: "1.0.5", next: "1.0.6", n: 0 })).toThrow(
      /not a count/,
    );
    expect(() => versionOf({ track: "nightly", pkg: "1.0.5", next: "1.0.6", n: 9 })).toThrow(
      /alpha, beta or stable/,
    );
  });
});

describe("App Store Connect's calls after the upload's long wait", () => {
  const dropped = () =>
    Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });

  test("a dropped connection is tried again, waiting longer each time", async () => {
    const waits: number[] = [];
    let calls = 0;
    const answer = await patiently(
      "What to Test",
      async () => {
        calls += 1;
        if (calls < 3) throw dropped();
        return "written";
      },
      { wait: async (ms: number) => void waits.push(ms) },
    );
    expect(answer).toBe("written");
    expect(calls).toBe(3);
    expect(waits).toEqual([5000, 10000]);
  });

  test("it gives up after its tries, naming the call and the cause", async () => {
    let calls = 0;
    const failing = patiently(
      "the build's listing",
      async () => {
        calls += 1;
        throw dropped();
      },
      { tries: 3, wait: async () => {} },
    );
    await expect(failing).rejects.toThrow("the build's listing: fetch failed (UND_ERR_SOCKET)");
    expect(calls).toBe(3);
  });

  test("any other error is the call's own, and is not tried again", async () => {
    let calls = 0;
    const failing = patiently(
      "What to Test",
      async () => {
        calls += 1;
        throw new Error("409 the build has its localization");
      },
      { wait: async () => {} },
    );
    await expect(failing).rejects.toThrow("What to Test: 409 the build has its localization");
    expect(calls).toBe(1);
  });
});

describe("the export finds the system's own tools first", () => {
  test("Homebrew's rsync comes after the system's openrsync", () => {
    expect(
      systemToolsFirst("/opt/toolchain/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"),
    ).toBe("/usr/bin:/bin:/usr/sbin:/sbin:/opt/toolchain/bin:/opt/homebrew/bin");
  });

  test("an empty or bare PATH still has the system's folders, each once", () => {
    expect(systemToolsFirst("")).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
    expect(systemToolsFirst(undefined)).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
    expect(systemToolsFirst("/usr/bin::/usr/bin:/x")).toBe("/usr/bin:/bin:/usr/sbin:/sbin:/x");
  });
});

describe("the iPad's build number (docs/engineering/cross-platform.md#PLAT-65)", () => {
  test("N.u: the commit's count, then the upload's number for it", () => {
    expect(buildNumber(1873, 1)).toBe("1873.1");
    expect(buildNumber(1873, 2)).toBe("1873.2");
  });

  test("never anything App Store Connect would refuse", () => {
    expect(() => buildNumber(0, 1)).toThrow(/not a count/);
    expect(() => buildNumber(12.5, 1)).toThrow(/not a count/);
    expect(() => buildNumber(12, 0)).toThrow(/not one/);
  });

  test("the next upload follows the highest of this commit's, from 1", () => {
    expect(nextUpload([], 1873)).toBe(1);
    expect(nextUpload(["1873.1"], 1873)).toBe(2);
    expect(nextUpload(["1873.1", "1873.3", "1873.2"], 1873)).toBe(4);
  });

  test("another commit's numbers, and anything not N.u, say nothing of this one's", () => {
    expect(nextUpload(["1872.4", "1874.1"], 1873)).toBe(1);
    expect(nextUpload(["1.0.5", "1873", null, undefined, "1873.x"], 1873)).toBe(1);
  });
});

describe("only the iPad alpha's main queue uploads", () => {
  const ok = { GITHUB_WORKFLOW: "iPad alpha", IOS_ALPHA_QUEUE: "main" };

  test("the alpha's own step may", () => {
    expect(uploadRefused(ok)).toBeNull();
  });

  test("a run by hand, another workflow, or a private build may not", () => {
    expect(uploadRefused({})).toMatch(/by hand/);
    expect(uploadRefused({ ...ok, GITHUB_WORKFLOW: "Pipeline" })).toMatch(/"Pipeline"/);
    expect(uploadRefused({ ...ok, IOS_ALPHA_QUEUE: "private" })).toMatch(/private/);
    expect(uploadRefused({ GITHUB_WORKFLOW: "iPad alpha" })).toMatch(/unsaid/);
  });

  test("a beta's queue uploads a beta, and each queue only its own track", () => {
    const beta = { GITHUB_WORKFLOW: "iPad alpha", IOS_ALPHA_QUEUE: "beta" };
    expect(uploadRefused(beta, "beta")).toBeNull();
    expect(uploadRefused(beta)).toMatch(/uploads a beta, and this build is an alpha/);
    expect(uploadRefused(beta, "alpha")).toMatch(/uploads a beta/);
    const main = { GITHUB_WORKFLOW: "iPad alpha", IOS_ALPHA_QUEUE: "main" };
    expect(uploadRefused(main, "alpha")).toBeNull();
    expect(uploadRefused(main, "beta")).toMatch(/uploads an alpha, and this build is a beta/);
    expect(uploadRefused(main, "stable")).toMatch(/a stable/);
  });

  test("before a build is looked for, the question is the queue's own: each uploading queue may, a beta's included", () => {
    // `upload` asked this with no track, which is an alpha's, so the beta
    // queue refused every beta it built (v1.0.7-beta.1 to beta.3).
    const beta = { GITHUB_WORKFLOW: "iPad alpha", IOS_ALPHA_QUEUE: "beta" };
    expect(uploaderRefused(beta)).toBeNull();
    expect(uploaderRefused(ok)).toBeNull();
    expect(uploaderRefused({})).toMatch(/by hand/);
    expect(uploaderRefused({ ...beta, GITHUB_WORKFLOW: "Pipeline" })).toMatch(/"Pipeline"/);
    expect(uploaderRefused({ ...beta, IOS_ALPHA_QUEUE: "private" })).toMatch(/private/);
    expect(uploaderRefused({ GITHUB_WORKFLOW: "iPad alpha" })).toMatch(/unsaid/);
  });
});

describe("the export's options", () => {
  const options = (internalOnly: boolean) =>
    exportOptions({
      team: "TEAM123456",
      identifier: "org.example.app",
      profileUuid: "0000-1111",
      internalOnly,
    });

  test("App Store Connect's method, signed by hand with the named profile", () => {
    const plist = options(true);
    expect(plist).toContain("<string>app-store-connect</string>");
    expect(plist).toContain("<string>manual</string>");
    expect(plist).toContain("<key>org.example.app</key>\n    <string>0000-1111</string>");
    expect(plist).toContain("<string>TEAM123456</string>");
  });

  test("an alpha is for internal testers alone; a beta's and a stable's are not", () => {
    expect(options(true)).toMatch(/testFlightInternalTestingOnly<\/key>\s*<true\/>/);
    expect(options(false)).toMatch(/testFlightInternalTestingOnly<\/key>\s*<false\/>/);
  });

  test("the build number is never Xcode's to change", () => {
    expect(options(true)).toMatch(/manageAppVersionAndBuildNumber<\/key>\s*<false\/>/);
  });
});

describe("what a build waits on", () => {
  const one = [{ identity: "Apple Distribution: Example (TEAM123456)", sha1: "AB", team: "T" }];

  test("nothing, with every piece there", () => {
    expect(missingMaterial({ key: {}, distribution: one, record: true, profile: "/p" })).toEqual(
      [],
    );
  });

  test("each missing piece by name, never a value", () => {
    expect(missingMaterial({ key: null, distribution: [], record: false, profile: null })).toEqual([
      "the App Store Connect API key",
      "one Apple Distribution identity (the keychain has 0)",
      "the app's record in App Store Connect",
      "the iPad's App Store profile",
    ]);
  });

  test("two identities are as unusable as none", () => {
    expect(
      missingMaterial({ key: {}, distribution: [...one, ...one], record: true, profile: "/p" }),
    ).toEqual(["one Apple Distribution identity (the keychain has 2)"]);
  });

  test("a profile the API would not make says why", () => {
    expect(
      missingMaterial({
        key: {},
        distribution: one,
        record: true,
        profile: null,
        profileWhy: "409 the bundle id has no iOS platform",
      }),
    ).toEqual([
      "the iPad's App Store profile (the API made none: 409 the bundle id has no iOS platform)",
    ]);
  });
});
