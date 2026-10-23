// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isDeepStrictEqual } from "node:util";

// The download's existing iCloud contract. Signed values must be concrete;
// the profile may authorise a superset (including Apple's suffix wildcards).
export function requiredEntitlements(identifier, team) {
  return {
    "com.apple.application-identifier": `${team}.${identifier}`,
    "com.apple.developer.team-identifier": team,
    "com.apple.developer.icloud-container-identifiers": [`iCloud.${identifier}`],
    "com.apple.developer.ubiquity-container-identifiers": [`iCloud.${identifier}`],
    "com.apple.developer.icloud-services": ["CloudDocuments"],
    "com.apple.developer.icloud-container-environment": "Production",
  };
}

function authorizes(allowed, claimed) {
  if (Array.isArray(claimed)) return claimed.every((value) => authorizes(allowed, value));
  if (Array.isArray(allowed)) return allowed.some((value) => authorizes(value, claimed));
  if (typeof claimed === "string") {
    if (claimed.includes("*") || typeof allowed !== "string") return false;
    return (
      claimed === allowed || (allowed.endsWith("*") && claimed.startsWith(allowed.slice(0, -1)))
    );
  }
  return claimed !== undefined && isDeepStrictEqual(allowed, claimed);
}

// TN3125: these macOS hardened-runtime keys need no provisioning profile.
// Unknown keys must have profile authorisation; adding an unrestricted key
// requires naming it here, rather than silently exempting an entire namespace.
const UNRESTRICTED = new Set([
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.disable-library-validation",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.disable-executable-page-protection",
  "com.apple.security.cs.debugger",
  "com.apple.security.get-task-allow",
  "com.apple.security.application-groups",
]);

/**
 * The Mac App Store build's contract (src-tauri/Entitlements.plist,
 * docs/engineering/release-engineering.md#REL-56): the sandbox, and the same
 * iCloud container as the download. No container environment: a store
 * build's is Production by being the store's.
 */
export function storeEntitlements(identifier, team) {
  return {
    "com.apple.application-identifier": `${team}.${identifier}`,
    "com.apple.developer.team-identifier": team,
    "com.apple.security.app-sandbox": true,
    "com.apple.developer.icloud-container-identifiers": [`iCloud.${identifier}`],
    "com.apple.developer.ubiquity-container-identifiers": [`iCloud.${identifier}`],
    "com.apple.developer.icloud-services": ["CloudDocuments"],
  };
}

// App Sandbox's own keys, which a profile never lists: each is in
// Entitlements.plist for one thing the app needs, and a key not named here
// still needs the profile's authorisation.
const SANDBOX = new Set([
  "com.apple.security.app-sandbox",
  "com.apple.security.files.user-selected.read-write",
  "com.apple.security.files.bookmarks.app-scope",
  "com.apple.security.network.client",
  "com.apple.security.print",
]);

/** What both channels' profiles must hold, said for `channel`. */
function assertAuthorizes(
  { profile, signed, identifier, team, certificate, now },
  { required, exempt, fail },
) {
  if (!/^[A-Z0-9]{10}$/.test(team ?? "")) fail("missing or invalid signing team");
  if (profile.team !== team || profile.appId !== `${team}.${identifier}`)
    fail("application or team identifier does not match");
  const expires = Date.parse(profile.expires);
  if (!Number.isFinite(expires) || expires <= now)
    fail("profile expiry is missing, invalid or past");
  if (!certificate || !profile.certificates.includes(certificate))
    fail("signing certificate is not authorised by the profile");
  if (!signed || typeof signed !== "object" || Array.isArray(signed))
    fail("signed entitlements are missing");
  for (const [key, expected] of Object.entries(required)) {
    if (!isDeepStrictEqual(signed[key], expected))
      fail(`signed ${key} does not match the required value`);
  }
  for (const [key, value] of Object.entries(signed)) {
    if (!exempt.has(key) && !authorizes(profile.entitlements?.[key], value)) {
      fail(`the profile does not authorise signed ${key}`);
    }
  }
}

/** A valid profile need not authorise what the app signs (docs/engineering/release-engineering.md#REL-38): used both before building and on the actual signed app, including CI. */
export function assertProfileAuthorizes({
  profile,
  signed,
  identifier,
  team,
  certificate,
  now = Date.now(),
}) {
  const fail = (message) => {
    throw new Error(`release profile: ${message}`);
  };
  if (!profile.allDevices) fail("not a Developer ID profile");
  if (signed && "com.apple.security.app-sandbox" in signed)
    fail("the Developer ID build is sandboxed");
  assertAuthorizes(
    { profile, signed, identifier, team, certificate, now },
    { required: requiredEntitlements(identifier, team), exempt: UNRESTRICTED, fail },
  );
}

/**
 * The same audit for the Mac App Store build (docs/engineering/release-engineering.md#REL-56):
 * a Mac App Store profile, which names no devices and does not provision them
 * all; the sandbox signed; and nothing App Review refuses, a debuggable build
 * first. Before the build, and on the signed app.
 */
export function assertStoreProfileAuthorizes({
  profile,
  signed,
  identifier,
  team,
  certificate,
  now = Date.now(),
}) {
  const fail = (message) => {
    throw new Error(`store profile: ${message}`);
  };
  if (profile.allDevices) fail("a Developer ID profile, not the Mac App Store's");
  if ((profile.devices ?? 0) > 0) fail("a development profile: it names devices");
  if (signed?.["com.apple.security.get-task-allow"])
    fail("get-task-allow is signed: App Review refuses a build a debugger can attach to");
  assertAuthorizes(
    { profile, signed, identifier, team, certificate, now },
    {
      required: storeEntitlements(identifier, team),
      exempt: new Set([...UNRESTRICTED, ...SANDBOX]),
      fail,
    },
  );
}
