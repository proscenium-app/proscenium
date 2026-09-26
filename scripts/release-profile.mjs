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
  if (!/^[A-Z0-9]{10}$/.test(team ?? "")) fail("missing or invalid signing team");
  if (profile.team !== team || profile.appId !== `${team}.${identifier}`)
    fail("application or team identifier does not match");
  if (!profile.allDevices) fail("not a Developer ID profile");
  const expires = Date.parse(profile.expires);
  if (!Number.isFinite(expires) || expires <= now)
    fail("profile expiry is missing, invalid or past");
  if (!certificate || !profile.certificates.includes(certificate))
    fail("signing certificate is not authorised by the profile");
  if (!signed || typeof signed !== "object" || Array.isArray(signed))
    fail("signed entitlements are missing");
  if ("com.apple.security.app-sandbox" in signed) fail("the Developer ID build is sandboxed");
  for (const [key, expected] of Object.entries(requiredEntitlements(identifier, team))) {
    if (!isDeepStrictEqual(signed[key], expected))
      fail(`signed ${key} does not match the download's required value`);
  }
  for (const [key, value] of Object.entries(signed)) {
    if (!UNRESTRICTED.has(key) && !authorizes(profile.entitlements?.[key], value)) {
      fail(`the profile does not authorise signed ${key}`);
    }
  }
}
