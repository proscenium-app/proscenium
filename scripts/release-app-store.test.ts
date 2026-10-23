// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, test } from "bun:test";
import {
  bundleVersion,
  installerSignatureWrong,
  missingMaterial,
  readAltool,
  standInRefusal,
} from "./release-app-store.mjs";
import { identitiesIn, pemFingerprints, profileKind } from "./release-keychain.mjs";
import { assertStoreProfileAuthorizes, storeEntitlements } from "./release-profile.mjs";

describe("the store's build number (docs/engineering/release-engineering.md#REL-56)", () => {
  test("X.Y.(Z×1000+N): three integers, rising with every upload and every release", () => {
    expect(bundleVersion("1.0.3", 1)).toBe("1.0.3001");
    expect(bundleVersion("1.0.3", 2)).toBe("1.0.3002");
    expect(bundleVersion("1.1.0", 1)).toBe("1.1.1");
    expect(bundleVersion("2.0.0", 999)).toBe("2.0.999");
    // Compared as macOS and App Store Connect compare them, a part at a time.
    const order = ["1.0.2001", "1.0.2002", "1.0.3001", "1.1.1", "1.1.1001", "2.0.1"];
    const parts = (v: string) => v.split(".").map(Number);
    for (let i = 1; i < order.length; i++) {
      const [a, b] = [parts(order[i - 1]), parts(order[i])];
      const first = a.findIndex((x, j) => x !== b[j]);
      expect(a[first]).toBeLessThan(b[first]);
    }
  });

  test("only a stable release, and only an upload's number", () => {
    expect(() => bundleVersion("1.0.3-beta.2", 1)).toThrow("only those go to the store");
    expect(() => bundleVersion("1.0", 1)).toThrow();
    for (const n of [0, 1000, 1.5, Number.NaN]) expect(() => bundleVersion("1.0.3", n)).toThrow();
  });
});

describe("what the build host lacks, by name", () => {
  const one = [{ sha1: "A".repeat(40), identity: "x", team: "ABCDEFGHIJ" }];
  test("everything there: nothing missing", () => {
    expect(missingMaterial({ distribution: one, installer: one, profile: "/p", key: {} })).toEqual(
      [],
    );
  });
  test("with every certificate, the app's record is still the maintainer's to make", () => {
    expect(
      missingMaterial({ distribution: one, installer: one, profile: "/p", key: {}, record: false }),
    ).toEqual(["the app's record in App Store Connect"]);
  });
  test("each missing piece is named, and two of a kind is not one", () => {
    expect(missingMaterial({ distribution: [], installer: [], profile: null, key: null })).toEqual([
      "the Apple Distribution certificate",
      "the Mac Installer Distribution certificate",
      "the Mac App Store provisioning profile",
      "the App Store Connect API key",
    ]);
    expect(
      missingMaterial({ distribution: [...one, ...one], installer: one, profile: "/p", key: {} }),
    ).toEqual(["one Apple Distribution identity (the keychain has 2)"]);
  });
});

describe("altool's answers", () => {
  test("a success, with its delivery", () => {
    const r = readAltool(
      0,
      'Running altool at path…\n{"success-message":"No errors uploading","delivery-uuid":"d-1","tool-version":"26.40.1"}',
    );
    expect(r).toMatchObject({ ok: true, errors: [], delivery: "d-1" });
  });
  test("product errors, each with its code and words", () => {
    const r = readAltool(
      1,
      JSON.stringify({
        "product-errors": [
          {
            code: -19201,
            message: "Validation failed",
            userInfo: { NSLocalizedFailureReason: "No suitable application records were found." },
          },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([
      {
        code: -19201,
        message: "Validation failed",
        reason: "No suitable application records were found.",
      },
    ]);
  });
  test("a failure with no JSON is one error of its last words", () => {
    expect(readAltool(1, "", "first\nsecond\nauthentication failed").errors).toEqual([
      { code: null, message: "first second authentication failed", reason: "" },
    ]);
  });
});

describe("a stand-in's refusal reads as a stand-in's", () => {
  const e = (message: string, reason = "") => [{ code: 1, message, reason }];
  test("no app, a signature or a profile not Apple's: expected", () => {
    for (const said of [
      e(
        "Validation failed",
        "No suitable application records were found. Verify your bundle identifier",
      ),
      e("Invalid Code Signing", "The executable is not signed with a valid certificate"),
      e("Invalid Provisioning Profile", "The provisioning profile is invalid"),
      // What App Store Connect said on 2026-10-18, before the app had its record.
      e(
        "ERROR: Cannot determine the Apple ID from Bundle ID 'org.habiby.proscenium' and platform 'MAC_OS'. (19)",
      ),
    ])
      expect(standInRefusal(said).expected).toBe(true);
  });
  test("the key refused is never expected: a real upload would meet it too", () => {
    expect(standInRefusal(e("Authentication failed", "NOT_AUTHORIZED")).expected).toBe(false);
    expect(standInRefusal(e("Unable to upload", "401 Unauthorized")).why).toContain("key");
  });
  test("a reason a stand-in does not explain is not expected", () => {
    expect(standInRefusal(e("The network connection was lost")).expected).toBe(false);
  });
});

describe("the store's profile audit (docs/engineering/release-engineering.md#REL-56)", () => {
  const fixture = () => {
    const identifier = "org.habiby.proscenium";
    const team = "ABCDEFGHIJ";
    const certificate = "A".repeat(40);
    const signed: Record<string, unknown> = {
      ...storeEntitlements(identifier, team),
      "com.apple.security.files.user-selected.read-write": true,
      "com.apple.security.files.bookmarks.app-scope": true,
      "com.apple.security.network.client": true,
      "com.apple.security.print": true,
    };
    return {
      identifier,
      team,
      certificate,
      signed,
      now: 1,
      profile: {
        appId: `${team}.${identifier}`,
        team,
        certificates: [certificate],
        allDevices: false,
        devices: 0,
        expires: "2099-01-01",
        entitlements: {
          "com.apple.application-identifier": `${team}.${identifier}`,
          "com.apple.developer.team-identifier": team,
          "com.apple.developer.icloud-container-identifiers": [`iCloud.${identifier}`],
          "com.apple.developer.ubiquity-container-identifiers": [`iCloud.${identifier}`],
          "com.apple.developer.icloud-services": ["CloudDocuments", "CloudKit"],
          "com.apple.developer.icloud-container-environment": ["Development", "Production"],
          "keychain-access-groups": [`${team}.*`],
        } as Record<string, unknown>,
      },
    };
  };

  test("a Mac App Store profile authorises the sandboxed build, its sandbox keys needing no profile", () => {
    expect(() => assertStoreProfileAuthorizes(fixture())).not.toThrow();
  });

  test("not the store's profile: Developer ID's, or a development one", () => {
    const d = fixture();
    d.profile.allDevices = true;
    expect(() => assertStoreProfileAuthorizes(d)).toThrow("a Developer ID profile");
    const dev = fixture();
    dev.profile.devices = 3;
    expect(() => assertStoreProfileAuthorizes(dev)).toThrow("development profile");
  });

  test("unsandboxed, debuggable, or another container: refused", () => {
    const a = fixture();
    delete a.signed["com.apple.security.app-sandbox"];
    expect(() => assertStoreProfileAuthorizes(a)).toThrow("app-sandbox");
    const b = fixture();
    b.signed["com.apple.security.get-task-allow"] = true;
    expect(() => assertStoreProfileAuthorizes(b)).toThrow("get-task-allow");
    const c = fixture();
    c.signed["com.apple.developer.icloud-container-identifiers"] = ["iCloud.other"];
    expect(() => assertStoreProfileAuthorizes(c)).toThrow("icloud-container-identifiers");
  });

  test("a restricted key the profile does not authorise, a certificate it does not name, a profile out of date", () => {
    const a = fixture();
    a.signed["com.apple.developer.associated-domains"] = ["applinks:example.com"];
    expect(() => assertStoreProfileAuthorizes(a)).toThrow("associated-domains");
    const b = fixture();
    b.certificate = "B".repeat(40);
    expect(() => assertStoreProfileAuthorizes(b)).toThrow("certificate");
    const c = fixture();
    c.profile.expires = "1970-01-01";
    expect(() => assertStoreProfileAuthorizes(c)).toThrow("expiry");
  });
});

describe("the keychain's store identities and profiles", () => {
  const listed = [
    '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Habiby LLC (HJZUKD696G)"',
    '  2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Apple Distribution: Habiby LLC (HJZUKD696G)"',
    '  3) CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC "3rd Party Mac Developer Installer: Habiby LLC (HJZUKD696G)"',
    '  3) CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC "3rd Party Mac Developer Installer: Habiby LLC (HJZUKD696G)"',
    "     3 valid identities found",
  ].join("\n");
  test("each identity found by its kind, once", () => {
    const installer =
      /\b([0-9A-F]{40}) "((?:3rd Party Mac Developer Installer|Mac Installer Distribution): (.+) \(([A-Z0-9]{10})\))"/;
    expect(identitiesIn(listed, installer)).toEqual([
      {
        sha1: "C".repeat(40),
        identity: "3rd Party Mac Developer Installer: Habiby LLC (HJZUKD696G)",
        name: "Habiby LLC",
        team: "HJZUKD696G",
      },
    ]);
  });
  test("a profile filed by what it provisions", () => {
    expect(profileKind({ allDevices: true, devices: 0 }).kind).toBe("Developer ID");
    expect(profileKind({ allDevices: false, devices: 0 }).kind).toBe("Mac App Store");
    expect(() => profileKind({ allDevices: false, devices: 2 })).toThrow("development profile");
  });
  test("a PEM of several certificates gives each fingerprint", () => {
    expect(pemFingerprints("no certificate here")).toEqual([]);
  });
});

test("the installer package's signature: the App Store's own certificate, Apple's chain, as pkgutil says it", () => {
  const ID = "3rd Party Mac Developer Installer: Habiby LLC (HJZUKD696G)";
  // pkgutil's words for 1.0.3's real store package, 2026-10-22.
  const real = [
    'Package "Proscenium_1.0.3_1.0.3001.pkg":',
    "   Status: signed by a developer certificate issued by Apple (Development)",
    "   Certificate Chain:",
    `    1. ${ID}`,
    "       Expires: 2027-10-19 17:15:42 +0000",
    "    2. Apple Worldwide Developer Relations Certification Authority",
    "    3. Apple Root CA",
  ].join("\n");
  expect(installerSignatureWrong(real, 0, ID)).toBeNull();
  expect(
    installerSignatureWrong(
      real.replace(
        "a developer certificate issued by Apple (Development)",
        "a certificate trusted by macOS",
      ),
      0,
      ID,
    ),
  ).toBeNull();
  expect(installerSignatureWrong(real, 1, ID)).toBe(
    "pkgutil refuses the package's signature (exit 1)",
  );
  expect(installerSignatureWrong(real, 0, "Mac Installer Distribution: Someone Else")).toMatch(
    /not say the package is signed by/,
  );
  expect(
    installerSignatureWrong(
      real.replace(/Status: .*/, "Status: signed by an untrusted certificate"),
      0,
      ID,
    ),
  ).toMatch(/not say Apple issued .*untrusted/);
  expect(installerSignatureWrong("   Status: no signature", 0, ID)).toMatch(
    /not say the package is signed by/,
  );
  expect(installerSignatureWrong(real.replace("    3. Apple Root CA", ""), 0, ID)).toBe(
    "pkgutil's chain for the package names no Apple Root CA",
  );
});
