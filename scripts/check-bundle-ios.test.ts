// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  categoriesDeclared,
  categoriesReached,
  COLLECTED,
  collectedProblems,
  TEST_WORDS,
  versionProblems,
} from "./check-bundle-ios.mjs";

/** The app's own manifest. */
const MANIFEST = readFileSync(
  join(import.meta.dir, "../src-tauri/gen/apple/proscenium_iOS/PrivacyInfo.xcprivacy"),
  "utf8",
);

/**
 * A manifest's collected data types, read from its XML as plutil would give
 * them: enough of a plist for this one array, so the test runs where plutil
 * does not.
 */
function collectedIn(xml: string) {
  const array =
    xml.match(
      /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array>([\s\S]*?)<\/array>\s*<key>/,
    )?.[1] ?? "";
  const flag = (block: string, key: string) =>
    block.match(new RegExp(`<key>${key}</key>\\s*<(true|false)/>`))?.[1] === "true";
  return {
    NSPrivacyCollectedDataTypes: [...array.matchAll(/<dict>([\s\S]*?)<\/dict>/g)].map(([, b]) => ({
      NSPrivacyCollectedDataType: b.match(
        /<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>/,
      )?.[1],
      NSPrivacyCollectedDataTypeLinked: flag(b, "NSPrivacyCollectedDataTypeLinked"),
      NSPrivacyCollectedDataTypeTracking: flag(b, "NSPrivacyCollectedDataTypeTracking"),
      NSPrivacyCollectedDataTypePurposes: [
        ...(
          b.match(
            /<key>NSPrivacyCollectedDataTypePurposes<\/key>\s*<array>([\s\S]*?)<\/array>/,
          )?.[1] ?? ""
        ).matchAll(/<string>([^<]+)<\/string>/g),
      ].map((m) => m[1]),
    })),
  };
}

describe("what the build collects, as the App Store record's privacy answers say (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-82)", () => {
  test("the app's own manifest declares what a build with reports sends, and nothing else", () => {
    const manifest = collectedIn(MANIFEST);
    expect(manifest.NSPrivacyCollectedDataTypes).toHaveLength(5);
    expect(collectedProblems(manifest, { reports: true })).toEqual([]);
  });

  test("a build without reports declares the feedback's two alone", () => {
    const manifest = collectedIn(MANIFEST);
    expect(collectedProblems(manifest, { reports: false })).toEqual([
      "it declares ProductInteraction, which the build does not send",
      "it declares CrashData, which the build does not send",
      "it declares OtherDiagnosticData, which the build does not send",
    ]);
  });

  test("each type missing, linked wrongly, tracking, or with other purposes, is said", () => {
    const right = Object.entries({ ...COLLECTED.reports, ...COLLECTED.feedback }).map(
      ([type, rule]) => ({
        NSPrivacyCollectedDataType: type,
        NSPrivacyCollectedDataTypeLinked: rule.linked,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: rule.purposes.map(
          (p) => `NSPrivacyCollectedDataTypePurpose${p}`,
        ),
      }),
    );
    expect(collectedProblems({ NSPrivacyCollectedDataTypes: right }, { reports: true })).toEqual(
      [],
    );
    const [product, crash, ...rest] = right;
    expect(
      collectedProblems(
        {
          NSPrivacyCollectedDataTypes: [
            { ...product, NSPrivacyCollectedDataTypeLinked: true },
            { ...crash, NSPrivacyCollectedDataTypeTracking: true },
            { ...rest[0], NSPrivacyCollectedDataTypePurposes: [] },
            rest[1],
          ],
        },
        { reports: true },
      ),
    ).toEqual([
      "it says ProductInteraction is linked to the writer",
      "it does not say CrashData is never used for tracking",
      "it gives OtherDiagnosticData the purposes none",
      "it does not declare EmailAddress, which the build sends",
    ]);
    expect(collectedProblems(null, { reports: false })).toEqual([
      "it does not declare CustomerSupport, which the build sends",
      "it does not declare EmailAddress, which the build sends",
    ]);
  });
});

describe("the version a build says, against what it was given", () => {
  test("an alpha says App Store Connect's X.Y.Z and its whole version in its own key", () => {
    const info = { CFBundleShortVersionString: "1.0.6", ProsceniumVersion: "1.0.6-alpha.998" };
    expect(versionProblems(info, { version: "1.0.6", whole: "1.0.6-alpha.998" })).toEqual([]);
    expect(versionProblems(info, { version: "1.0.5", whole: "1.0.6-alpha.998" })).toEqual([
      "CFBundleShortVersionString is 1.0.6, not 1.0.5",
      "1.0.6-alpha.998 is not a pre-release of 1.0.5",
    ]);
  });

  test("an alpha without its key would report as a release, and is refused", () => {
    expect(
      versionProblems(
        { CFBundleShortVersionString: "1.0.6" },
        { version: "1.0.6", whole: "1.0.6-alpha.998" },
      ),
    ).toEqual(["ProsceniumVersion is missing, not 1.0.6-alpha.998"]);
  });

  test("a release carries no key", () => {
    expect(
      versionProblems({ CFBundleShortVersionString: "1.0.6" }, { version: "1.0.6", whole: null }),
    ).toEqual([]);
    expect(
      versionProblems(
        { CFBundleShortVersionString: "1.0.6", ProsceniumVersion: "1.0.6-beta.1" },
        { version: "1.0.6", whole: null },
      ),
    ).toEqual(["a release carries no ProsceniumVersion, and this one says 1.0.6-beta.1"]);
  });
});

describe("the privacy manifest against what the binary imports", () => {
  test("each required-reason API's symbol reaches its category, once", () => {
    expect(
      categoriesReached([
        "_stat",
        "_fstat$INODE64",
        "_getattrlist",
        "_mach_absolute_time",
        "_statfs",
        "_OBJC_CLASS_$_NSUserDefaults",
        "_malloc",
      ]),
    ).toEqual([
      "NSPrivacyAccessedAPICategoryDiskSpace",
      "NSPrivacyAccessedAPICategoryFileTimestamp",
      "NSPrivacyAccessedAPICategorySystemBootTime",
      "NSPrivacyAccessedAPICategoryUserDefaults",
    ]);
  });

  test("a symbol with nm's spacing around it still counts", () => {
    expect(categoriesReached(["  _lstat \n"])).toEqual([
      "NSPrivacyAccessedAPICategoryFileTimestamp",
    ]);
  });

  test("a category is declared only with a reason", () => {
    expect(
      categoriesDeclared({
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
            NSPrivacyAccessedAPITypeReasons: ["C617.1"],
          },
          { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace" },
        ],
      }),
    ).toEqual(["NSPrivacyAccessedAPICategoryFileTimestamp"]);
    expect(categoriesDeclared(null)).toEqual([]);
  });

  test("the app's own manifest declares what it says it does", () => {
    const manifest = readFileSync(
      join(import.meta.dir, "../src-tauri/gen/apple/proscenium_iOS/PrivacyInfo.xcprivacy"),
      "utf8",
    );
    expect(manifest).toContain("NSPrivacyAccessedAPICategoryFileTimestamp");
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  });
});

describe("nothing of a test build", () => {
  const found = (text: string) => TEST_WORDS.filter(([, re]) => re.test(text)).map(([w]) => w);

  test("each test build's words are caught", () => {
    expect(found("PROSCENIUM_IPAD_PROBE_WORDS")).toEqual(["the iPad probe"]);
    expect(found("fn ipad_probe_report")).toEqual(["the iPad probe"]);
    expect(found("selftest_fixture")).toEqual(["self-test code"]);
    expect(found("tauri_plugin_updater::Builder")).toEqual(["the updater"]);
    expect(found("developerExtrasEnabled")).toEqual(["the web view's developer tools"]);
  });

  test("a release build's own words are not", () => {
    expect(found("org.habiby.proscenium vault_open leaving_settled")).toEqual([]);
  });
});
