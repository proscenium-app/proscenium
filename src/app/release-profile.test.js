// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "bun:test";
import { assertProfileAuthorizes, requiredEntitlements } from "../../scripts/release-profile.mjs";

const fixture = () => {
  const identifier = "org.habiby.proscenium",
    team = "ABCDEFGHIJ",
    certificate = "A".repeat(40);
  const signed = requiredEntitlements(identifier, team);
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
      allDevices: true,
      expires: "2099-01-01",
      entitlements: structuredClone(signed),
    },
  };
};

test("the embedded profile authorises iCloud: the valid profile authorises the concrete signed iCloud values", () => {
  const f = fixture();
  f.profile.entitlements["com.apple.developer.icloud-services"].push("CloudKit");
  f.profile.entitlements["com.apple.developer.icloud-container-environment"] = [
    "Development",
    "Production",
  ];
  expect(() => assertProfileAuthorizes(f)).not.toThrow();
});

test("the embedded profile authorises iCloud: every required entitlement must be signed exactly and authorised", () => {
  for (const key of Object.keys(fixture().signed)) {
    for (const where of ["signed", "profile"]) {
      for (const mutation of ["missing", "wrong"]) {
        const f = fixture();
        const target = where === "signed" ? f.signed : f.profile.entitlements;
        if (mutation === "missing") delete target[key];
        else target[key] = "unrelated";
        expect(() => assertProfileAuthorizes(f)).toThrow();
      }
    }
  }
});

test("the embedded profile authorises iCloud: a CI or final bundle certificate outside the profile is refused", () => {
  const f = fixture();
  f.certificate = "B".repeat(40);
  expect(() => assertProfileAuthorizes(f)).toThrow("certificate");
});

test("the embedded profile authorises iCloud: extra restricted entitlements also need authorisation", () => {
  const f = fixture();
  f.signed["keychain-access-groups"] = ["ABCDEFGHIJ.private"];
  expect(() => assertProfileAuthorizes(f)).toThrow("keychain-access-groups");
  f.profile.entitlements["keychain-access-groups"] = ["ABCDEFGHIJ.*"];
  expect(() => assertProfileAuthorizes(f)).not.toThrow();
  f.signed["keychain-access-groups"] = ["ABCDEFGHIJ.*"];
  expect(() => assertProfileAuthorizes(f)).toThrow();
});

test("the embedded profile authorises iCloud: invalid dates, wrong teams and sandbox profiles fail closed", () => {
  for (const expires of [null, "garbage", "1970-01-01"]) {
    const f = fixture();
    f.profile.expires = expires;
    expect(() => assertProfileAuthorizes(f)).toThrow("expiry");
  }
  const f = fixture();
  f.profile.team = "KLMNOPQRST";
  expect(() => assertProfileAuthorizes(f)).toThrow("identifier");
  const g = fixture();
  g.signed["com.apple.security.app-sandbox"] = true;
  expect(() => assertProfileAuthorizes(g)).toThrow("sandboxed");
});
