// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOST_ITEMS,
  ITEMS,
  keychainPath,
  msStoreKey,
  salesKey,
  sentryToken,
} from "./release-keychain.mjs";

const homes = mkdtempSync(join(tmpdir(), "keychain-"));
afterAll(() => rmSync(homes, { recursive: true, force: true }));

test("a keychain named bare is opened by its file's full path, which a daemon's job needs", () => {
  const home = mkdtempSync(join(homes, "home-"));
  mkdirSync(join(home, "Library", "Keychains"), { recursive: true });
  const file = join(home, "Library", "Keychains", "proscenium-release.keychain-db");
  writeFileSync(file, "");
  expect(keychainPath("proscenium-release.keychain", home)).toBe(file);
  expect(keychainPath("proscenium-release.keychain-db", home)).toBe(file);
});

test("a full path is kept, a keychain this Mac does not hold keeps its name, and none is none", () => {
  const home = mkdtempSync(join(homes, "home-"));
  expect(keychainPath("/elsewhere/other.keychain-db", home)).toBe("/elsewhere/other.keychain-db");
  expect(keychainPath("other.keychain", home)).toBe("other.keychain");
  expect(keychainPath(undefined, home)).toBeNull();
  expect(keychainPath("", home)).toBeNull();
});

test("a Sentry auth token is taken as Sentry makes one, trimmed", () => {
  const user = `sntryu_${"0a".repeat(32)}`;
  expect(sentryToken(`${user}\n`)).toBe(user);
  expect(sentryToken("f".repeat(64))).toBe("f".repeat(64));
});

test("anything else is refused whole, and the refusal names no part of it", () => {
  for (const bad of ["", "sntryu_short", `sntrys_${"a".repeat(64)}`, `${"g".repeat(64)}`]) {
    expect(() => sentryToken(bad)).toThrow("That is not a Sentry auth token. Nothing was stored.");
  }
});

test("the Sentry token, the Microsoft Store's key and the sales reports key are the build host's alone: never moved, never an Actions secret", () => {
  expect(Object.keys(HOST_ITEMS)).toEqual([
    "SENTRY_READ_TOKEN",
    "MS_STORE_TENANT_ID",
    "MS_STORE_CLIENT_ID",
    "MS_STORE_CLIENT_SECRET",
    "APPLE_SALES_KEY",
    "APPLE_SALES_KEY_P8",
  ]);
  for (const name of Object.keys(HOST_ITEMS)) expect(Object.keys(ITEMS)).not.toContain(name);
});

const TENANT = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const CLIENT = "11111111-2222-3333-4444-555555555555";
const SECRET = `Ab1~${"x".repeat(36)}.-_`;

test("the Microsoft Store's key is taken as Partner Center gives it: two GUIDs and a secret, trimmed", () => {
  expect(msStoreKey({ tenant: ` ${TENANT}`, client: CLIENT, secret: `${SECRET}\n` })).toEqual({
    tenant: TENANT,
    client: CLIENT,
    secret: SECRET,
  });
});

test("a key that is not one is refused whole, and no refusal repeats the secret", () => {
  const cases = [
    { tenant: "not-a-guid", client: CLIENT, secret: SECRET, says: "--tenant" },
    { tenant: TENANT, client: "", secret: SECRET, says: "--client" },
    { tenant: TENANT, client: CLIENT, secret: "short", says: "That is not a key" },
    { tenant: TENANT, client: CLIENT, secret: `${SECRET} ${SECRET}`, says: "That is not a key" },
  ];
  for (const { says, ...key } of cases) {
    let message = "";
    try {
      msStoreKey(key);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(says);
    expect(message).toContain("Nothing was stored.");
    expect(message).not.toContain(SECRET);
  }
});

const P8 = `-----BEGIN PRIVATE KEY-----\n${"QUJD".repeat(16)}\n${"REVG".repeat(8)}\n-----END PRIVATE KEY-----\n`;

test("the sales reports key is taken as App Store Connect gives it: a Key ID and one PEM private key", () => {
  const key = salesKey({ keyId: " ABCDE12345\n", p8: Buffer.from(P8) });
  expect(key.keyId).toBe("ABCDE12345");
  expect(key.p8.toString()).toBe(P8);
});

test("a sales key that is not one is refused whole, and no refusal repeats the key", () => {
  const cases = [
    { keyId: "abcde12345", p8: P8, says: "--key" },
    { keyId: "", p8: P8, says: "--key" },
    { keyId: "ABCDE12345", p8: "", says: "not a key" },
    { keyId: "ABCDE12345", p8: P8.replace("PRIVATE KEY", "CERTIFICATE"), says: "not a key" },
    { keyId: "ABCDE12345", p8: `${P8}${P8}`, says: "not a key" },
  ];
  for (const { says, ...key } of cases) {
    let message = "";
    try {
      salesKey(key);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(says);
    expect(message).toContain("Nothing was stored.");
    expect(message).not.toContain("QUJD");
  }
});
