// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from "bun:test";
import { HOST_ITEMS, ITEMS, sentryToken } from "./release-keychain.mjs";

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

test("the Sentry token is the build host's alone: never moved, never an Actions secret", () => {
  expect(Object.keys(HOST_ITEMS)).toEqual(["SENTRY_READ_TOKEN"]);
  expect(Object.keys(ITEMS)).not.toContain("SENTRY_READ_TOKEN");
});
