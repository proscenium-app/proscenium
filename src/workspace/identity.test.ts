// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "bun:test";
import { isUlid, ulid } from "./ulid";

describe("ulid", () => {
  it("is 26 Crockford-base32 chars and validates", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("is lexicographically sortable by time", () => {
    const a = ulid(1_000_000_000_000);
    const b = ulid(1_000_000_001_000);
    expect(a < b).toBe(true);
  });

  it("is unique across mints in the same millisecond", () => {
    const t = 1_700_000_000_000;
    const ids = new Set(Array.from({ length: 1000 }, () => ulid(t)));
    expect(ids.size).toBe(1000);
  });
});
